import { domainToASCII } from 'node:url';

/**
 * 规则行解析器
 *
 * 把任意上游源的一行文本归一化为下面四类之一：
 *   block  — 纯域名屏蔽（可去重、可做父域收敛）
 *   allow  — 纯域名白名单例外 @@（只去重，绝不收敛）
 *   raw    — 需要原样保留的规则（含 * 通配 / $badfilter / $client 等 AdGuard 修飾符）
 *   skip   — 丢弃（注释、元素隐藏、正则、带路径、无效域名……）
 */

// hosts 格式：0.0.0.0 domain / 127.0.0.1 domain / ::1 domain
const HOSTS_RE = /^(?:0\.0\.0\.0|127\.0\.0\.1|::1?|::)\s+(\S+)\s*$/i;
// 一个 IP 后面跟多个域名（hosts 常见写法）：`0.0.0.0 a.com b.com`
const HOSTS_MULTI_RE = /^(?:0\.0\.0\.0|127\.0\.0\.1|::1?|::)\s+(\S+(?:\s+\S+)+)\s*$/i;

// 单条 label 允许字母数字、下划线、连字符；整体至少两级
const DOMAIN_RE = /^(?!-)[a-z0-9_-]{1,63}(?:\.(?!-)[a-z0-9_-]{1,63})+$/;

// hosts 行 / 网络规则行的开头。这类行里的 `#` 只可能是行尾注释，
// 不可能是元素隐藏规则的分隔符（元素隐藏规则从不以 `0.0.0.0` 或 `||` 开头）
const HOSTS_PREFIX_RE = /^(?:0\.0\.0\.0|127\.0\.0\.1|::1?|::)\s/;
const NETWORK_PREFIX_RE = /^(?:\|\||@@)/;

// AdGuard Home 在 DNS 层能够真正生效的修饰符
const DNS_SAFE_MODIFIERS = new Set(['important']);
// 这些修饰符必须连同原规则整体保留，不能只留域名
// `dnstype` 收窄「只拦 A/AAAA 还是连 CNAME 一起拦」，剥掉会从「拦一部分」变成「全拦」，
// 只能原样透传；它属于 AdGuard Home 官方文档列出的 DNS 级修饰符。
const KEEP_AS_RAW_MODIFIERS = /^(badfilter|client|ctag|denyallow|dnsrewrite|dnstype)/;

/**
 * 正则规则的修饰符白名单。
 *
 * AdGuard Home 的约定是「遇到不认识的修饰符，整条规则作废」，所以这里不能放行任意修饰符：
 * 只有官方文档列出的 DNS 级修饰符才随正则一起透传。
 */
const REGEX_SAFE_MODIFIERS = new Set([
  'important',
  'dnstype',
  'denyallow',
  'badfilter',
  'client',
  'ctag',
]);

// `/pattern/` 或 `/pattern/$mod1,mod2`。pattern 取到最后一个 `/`，修饰符部分只允许
// `$name` / `$name=value` 这类形式，避免把 `||a.com/x/y` 这种路径规则误判成正则
const REGEX_RULE_RE = /^\/(.+)\/((?:\$[a-z]+(?:=[^,]*)?(?:,[a-z]+(?:=[^,]*)?)*)?)$/;

/**
 * 解析 `/regex/` 正则规则
 *
 * 为什么必须保留：上游里有几十条形如 `/^guanggao\./`、`/^adservice\./`、`/^admaster\./`
 * 的「标签前缀」规则，它们拦的不是某个固定域名，而是 `<广告标签>.<任意域名>` ——
 * 典型受害者就是贴吧、酷安这类用自家子域做广告位的 App（广告位域名随版本变化，
 * 任何域名清单都写不出来，只有正则能覆盖）。
 *
 * 项目最初一律丢弃正则规则，理由是「几十万条正则会拖死软路由」。但上游实际只有
 * 50～60 条，这点开销可以忽略；而丢掉它们会得到一份「域名规则一条不少、App 内广告
 * 却全回来」的清单 —— 单独订阅上游能拦住、订阅合并结果拦不住，根因就在这里。
 *
 * `@@/regex/` 例外不保留：正则之间是否有交集无法静态判定，保留就可能把别的源的屏蔽
 * 规则整片解开，与本项目「黑名单优先」的策略冲突（上游目前也没有这类规则）。
 */
function parseRegexRule(text) {
  const m = REGEX_RULE_RE.exec(text);
  if (!m) return { kind: 'skip', reason: 'regex' };
  const [, pattern, modifierText] = m;
  if (!pattern) return { kind: 'skip', reason: 'regex' };

  // 语法预检：AdGuard Home 用 Go 的 RE2，JS 能编译通过的正则它基本也认；
  // 编译不过的说明上游这一行本身就是坏的，留着只会让整条规则被 AdGuard Home 忽略
  try {
    // eslint-disable-next-line no-new
    new RegExp(pattern);
  } catch {
    return { kind: 'skip', reason: 'regex' };
  }

  // RE2 不支持环视与反向引用，这类模式 AdGuard Home 会整条忽略 —— 与其带进产物，
  // 不如现在就丢掉，免得「规则在文件里、日志里却一次都没命中」
  if (/\(\?<?[=!]|\\[1-9]/.test(pattern)) return { kind: 'skip', reason: 'regex' };

  if (modifierText) {
    const modifiers = modifierText.slice(1).split(',').filter(Boolean);
    const bad = modifiers.some((mod) => !REGEX_SAFE_MODIFIERS.has(mod.split('=')[0]));
    if (bad) return { kind: 'skip', reason: 'regex-modifier' };
  }

  return { kind: 'raw', rule: text };
}

/**
 * 只描述「请求上下文」的修饰符：是否第三方、来自哪个 App。
 *
 * DNS 过滤没有 referrer、没有 App 归属，这些修饰符对结果毫无影响，剥掉之后规则本体
 * （域名）依然成立。以前这里一律整条丢弃，和 README「剔除 DNS 层无效的修饰符」的说法
 * 正好相反：上游一旦混进 adblock 格式的规则，就会静默少掉一整批，而且只在统计里体现为
 * 「DNS 层无效修饰符」几行字，很难发现是丢了整条规则。
 *
 * 注意 `$popup`、`$document`、`$domain=`、`$removeparam` 这类不在其列 —— 它们改变的是
 * 「对哪个域名、做哪种处理」，剥掉会把「限站点放行 / 只去参数」变成「全站屏蔽」，
 * 属于会改变拦截语义的修饰符，仍按不支持处理（整条丢弃才安全）。
 */
const IGNORABLE_MODIFIERS = new Set([
  'third-party',
  '~third-party',
  'first-party',
  '~first-party',
  'all',
]);
const IGNORABLE_PREFIXES = ['app='];

/**
 * 域名归一化：小写、去首尾点、校验合法性、转 punycode
 * @returns {string|null}
 */
export function normalizeDomain(input) {
  if (!input) return null;
  let s = String(input).trim().toLowerCase();
  s = s.replace(/^\.+/, '').replace(/\.+$/, '');
  if (!s || s.length > 253) return null;
  if (!s.includes('.')) return null;
  if (/^[\d.]+$/.test(s)) return null; // 纯 IP 无意义
  if (!/^[a-z0-9._\-\u0080-\uffff]+$/.test(s)) return null;

  let ascii = s;
  if (/[^\x00-\x7f]/.test(s)) {
    ascii = domainToASCII(s);
    if (!ascii) return null;
  } else {
    const converted = domainToASCII(s);
    if (converted) ascii = converted;
  }

  if (!DOMAIN_RE.test(ascii)) return null;
  return ascii;
}

function makeDomainRule(host, isAllow) {
  const domain = normalizeDomain(host);
  if (!domain) return { kind: 'skip', reason: 'invalid-domain' };
  return { kind: isAllow ? 'allow' : 'block', domain };
}

/**
 * 解析 `||...` 与 `@@||...` 的规则体（已去掉前缀）
 */
function parseNetworkRule(body, isAllow) {
  const dollar = body.indexOf('$');
  const pattern = dollar === -1 ? body : body.slice(0, dollar);
  const modifierText = dollar === -1 ? '' : body.slice(dollar + 1);

  if (!pattern) return { kind: 'skip', reason: 'invalid-domain' };

  // DNS 过滤器不匹配路径，带路径的规则在 AdGuard Home 中无效
  let host = pattern;
  if (host.endsWith('^')) {
    host = host.slice(0, -1);
  } else if (host.includes('/')) {
    return { kind: 'skip', reason: 'path' };
  } else {
    // `||example.com`（漏了 `^`）与路径规则是两回事，分开统计便于定位上游格式问题
    return { kind: 'skip', reason: 'no-anchor' };
  }
  if (host.includes('/')) return { kind: 'skip', reason: 'path' };

  const modifiers = modifierText
    ? modifierText.split(',').map((m) => m.trim()).filter(Boolean)
    : [];

  const mustKeepRaw = modifiers.some((m) => KEEP_AS_RAW_MODIFIERS.test(m));
  if (mustKeepRaw) {
    return { kind: 'raw', rule: `${isAllow ? '@@' : ''}||${body}` };
  }

  const unknownModifiers = modifiers.filter((m) => !DNS_SAFE_MODIFIERS.has(m.split('=')[0]));
  if (unknownModifiers.length) {
    const allIgnorable = unknownModifiers.every(
      (m) => IGNORABLE_MODIFIERS.has(m) || IGNORABLE_PREFIXES.some((p) => m.startsWith(p))
    );
    if (!allIgnorable) return { kind: 'skip', reason: 'unsupported-modifier' };
  }

  const important = modifiers.some((m) => m.split('=')[0] === 'important');

  if (host.includes('*')) {
    // `||*.example.com^` 与 `||example.com^` 在屏蔽场景下等价，可归一化后参与去重
    if (!isAllow && host.startsWith('*.')) {
      const stripped = normalizeDomain(host.slice(2));
      if (stripped) return { kind: 'block', domain: stripped, normalizedFromWildcard: true };
    }
    return { kind: 'raw', rule: `${isAllow ? '@@' : ''}||${body}` };
  }

  const domain = normalizeDomain(host);
  if (!domain) return { kind: 'skip', reason: 'invalid-domain' };

  // `@@||example.com^$important` 的 $important 不能丢：它决定这条例外能否压过
  // 带 $important 的屏蔽规则，丢了就降级成普通例外，和解说文档自相矛盾
  if (isAllow) return { kind: 'allow', domain, important };
  // `$important` 会提高优先级，合并时若同域已存在普通规则需升级
  return { kind: 'block', domain, important };
}

/**
 * 解析单行规则
 * @param {string} input 原始行
 * @returns {{kind:'block'|'allow'|'raw'|'skip', domain?:string, domains?:string[], rule?:string, important?:boolean, reason?:string, normalizedFromWildcard?:boolean}}
 */
export function parseLine(input) {
  let line = String(input).replace(/\r$/, '').trim();
  if (!line) return { kind: 'skip', reason: 'empty' };

  if (line.startsWith('!') || line.startsWith('[')) return { kind: 'skip', reason: 'comment' };

  // 正则规则要在注释截断之前处理：`/^ad[!#]\./` 这类模式本身就带 `!` / `#`，
  // 先截断会把一条好好的正则切成半截。`@@/regex/` 例外按「黑名单优先」整条丢弃。
  if (line.startsWith('/') || line.startsWith('@@/')) {
    if (line.startsWith('@@/')) return { kind: 'skip', reason: 'regex-allow' };
    return parseRegexRule(line);
  }

  // 个别上游源存在把 `!` 注释拼接到规则行尾的瑕疵，截断之
  const bang = line.indexOf('!');
  if (bang > 0) {
    line = line.slice(0, bang).trim();
    if (!line) return { kind: 'skip', reason: 'comment' };
  }

  if (line.startsWith('#')) return { kind: 'skip', reason: 'comment' };
  // ABP 元素隐藏规则对 DNS 过滤无效。
  // 但 hosts 行与 `||domain^` 行里的 `#` / `##` 只是行尾注释 —— 以前这里不区分，
  // 一条 `0.0.0.0 ads.example.com ## 广告` 会被整条当成元素隐藏规则丢掉，
  // 明明是有效的屏蔽规则却静默消失。因此先判掉网络规则 / hosts 行，只对它们走注释截断。
  const networkish = NETWORK_PREFIX_RE.test(line) || HOSTS_PREFIX_RE.test(line);
  if (
    !networkish &&
    (line.includes('##') || line.includes('#@#') || line.includes('#?#') || line.includes('#$#'))
  ) {
    return { kind: 'skip', reason: 'element-hide' };
  }

  // hosts 列表常见写法：`0.0.0.0 ads.example.com # 说明`。
  // 不剥掉行尾注释的话，HOSTS_RE 和裸域名正则都会匹配失败，整条规则被静默丢弃。
  // 有些上游是手工维护的，`#` 前面不带空格（`||a.com^#说明`），以前会一路走到
  // 「缺 ^ 锚定」分支被整条丢掉，这里一并截断。
  // 只在 `$` 修饰符之前找 `#`，避免误伤 `$removeparam=#xxx` 这类合法修饰符。
  const hashAt = line.indexOf('#');
  const dollarAt = line.indexOf('$');
  if (hashAt > 0 && (dollarAt === -1 || hashAt < dollarAt)) {
    line = line.slice(0, hashAt).trim();
    if (!line) return { kind: 'skip', reason: 'comment' };
  }

  const hostsMatch = HOSTS_RE.exec(line);
  if (hostsMatch) return makeDomainRule(hostsMatch[1], false);

  // `0.0.0.0 a.com b.com`：一个 IP 挂多个域名，以前整行被判为 unknown 丢掉，
  // 这里展开成多条，避免上游 hosts 格式的规则静默消失
  const multiMatch = HOSTS_MULTI_RE.exec(line);
  if (multiMatch) {
    const domains = multiMatch[1]
      .split(/\s+/)
      .map((h) => normalizeDomain(h))
      .filter(Boolean);
    if (domains.length) return { kind: 'block', domains };
    return { kind: 'skip', reason: 'invalid-domain' };
  }

  if (line.startsWith('@@')) {
    const rest = line.slice(2);
    // `@@||domain^` 例外规则；`@@|http://` 之类的 URL 例外在 DNS 层无效
    if (rest.startsWith('||')) return parseNetworkRule(rest.slice(2), true);
    return { kind: 'skip', reason: 'url-anchor' };
  }
  if (line.startsWith('||')) return parseNetworkRule(line.slice(2), false);

  // `/regex/` 已在函数开头统一处理（要赶在注释截断之前），走到这里说明不是正则
  // `|http://` 锚定 URL 规则在 DNS 层无效
  if (line.startsWith('|')) return { kind: 'skip', reason: 'url-anchor' };

  // 裸域名行
  if (/^[^\s^|@/$*#!]+$/.test(line)) return makeDomainRule(line, false);

  return { kind: 'skip', reason: 'unknown' };
}

/**
 * 解析整份文本
 */
export function parseList(text) {
  const lines = String(text).split('\n');
  const block = [];
  const allow = [];
  const raw = [];
  const skipped = Object.create(null);
  let totalLines = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    totalLines += 1;
    const r = parseLine(line);
    if (r.kind === 'block') {
      // 多域名 hosts 行会返回 domains 数组，逐条展开
      if (r.domains) {
        for (const domain of r.domains) block.push({ kind: 'block', domain, important: false });
      } else {
        block.push(r);
      }
    } else if (r.kind === 'allow') allow.push(r);
    else if (r.kind === 'raw') raw.push(r.rule);
    else skipped[r.reason] = (skipped[r.reason] || 0) + 1;
  }

  return {
    block,
    allow,
    raw,
    skipped,
    totalLines,
    effective: block.length + allow.length + raw.length,
  };
}
