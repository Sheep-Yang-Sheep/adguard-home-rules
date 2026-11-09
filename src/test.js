import test from 'node:test';
import assert from 'node:assert/strict';

import { parseLine, parseList, normalizeDomain } from './parser.js';
import { subsumeByParent, mergeSources, findAllowShadowed, pruneBlockedAllows, isSelfOrSubdomain } from './merger.js';
import { parseAllowlist, loadAllowlist } from './allowlist.js';
import { beijingNow, renderRules, verifyRenderedRules } from './render.js';
import { buildCandidates, looksLikeRuleList } from './network.js';
import { evaluateSourceGate, forceFromEnv } from './gate.js';

test('标准屏蔽规则', () => {
  const r = parseLine('||example.com^');
  assert.equal(r.kind, 'block');
  assert.equal(r.domain, 'example.com');
  assert.equal(r.important, false);
});

test('白名单例外规则', () => {
  assert.deepEqual(parseLine('@@||ad.azure.com^'), {
    kind: 'allow',
    domain: 'ad.azure.com',
    important: false,
  });
});

test('白名单的 $important 不能被丢掉', () => {
  // @@||x^$important 用来压过带 $important 的屏蔽规则，降级成 @@||x^ 会失去这个能力
  const r = parseLine('@@||ad.azure.com^$important');
  assert.equal(r.kind, 'allow');
  assert.equal(r.important, true);
});

test('$important 标记', () => {
  const r = parseLine('||example.com^$important');
  assert.equal(r.kind, 'block');
  assert.equal(r.domain, 'example.com');
  assert.equal(r.important, true);
});

test('DNS 层无意义的修饰符被剥掉、规则本体保留', () => {
  // $third-party / $app= 只描述请求上下文（是否第三方、来自哪个 App），DNS 过滤无法区分，
  // 剥掉修饰符后域名规则依然成立。以前这里整条丢弃，上游一旦混入 adblock 格式就会静默少一批。
  const a = parseLine('||example.com^$third-party');
  assert.equal(a.kind, 'block');
  assert.equal(a.domain, 'example.com');
  assert.equal(parseLine('||example.com^$app=com.tencent.mm').kind, 'block');
  assert.equal(parseLine('||example.com^$~third-party').kind, 'block');

  // 与 $important 组合时，$important 不能被顺手丢掉
  const b = parseLine('||example.com^$important,third-party');
  assert.equal(b.kind, 'block');
  assert.equal(b.important, true);
});

test('会改变拦截语义的修饰符仍然整条丢弃', () => {
  // $domain= 只对指定站点生效、$removeparam 只是去掉参数，剥掉修饰符会变成全站硬屏蔽
  assert.equal(parseLine('||example.com^$domain=foo.com').kind, 'skip');
  assert.equal(parseLine('||example.com^$removeparam=utm_source').kind, 'skip');
  assert.equal(parseLine('||example.com^$popup').kind, 'skip');
});

test('无空格的行尾 # 注释也能剥掉', () => {
  const r = parseLine('||a.com^#说明文字');
  assert.equal(r.kind, 'block');
  assert.equal(r.domain, 'a.com');
  assert.equal(parseLine('0.0.0.0 b.com#注释').domain, 'b.com');
});

test('共享后缀不参与父子域收敛', () => {
  // co.uk / github.io 被屏蔽时，收敛不能把名下所有子域规则一起删掉，
  // 否则规则数瞬间塌陷，把真实变化淹没在噪音里。
  const { keep, removed, protectedHits } = subsumeByParent([
    'co.uk',
    'a.co.uk',
    'b.a.co.uk',
    'github.io',
    'foo.github.io',
    'example.de',
    'x.example.de',
  ]);
  // 共享后缀自己保留，其直接子域也保留
  assert.ok(keep.includes('a.co.uk'));
  assert.ok(keep.includes('foo.github.io'));
  // 但更深的子域仍可被「真正的父域」收起
  assert.ok(removed.some((r) => r.domain === 'b.a.co.uk' && r.parent === 'a.co.uk'));
  // 普通域名照旧收敛
  assert.ok(removed.some((r) => r.domain === 'x.example.de' && r.parent === 'example.de'));
  assert.equal(protectedHits, 2);
});

test('$badfilter 原样保留', () => {
  const r = parseLine('||example.com^$badfilter');
  assert.equal(r.kind, 'raw');
  assert.equal(r.rule, '||example.com^$badfilter');
});

test('前导通配归一化', () => {
  const r = parseLine('||*.exaapi.com^');
  assert.equal(r.kind, 'block');
  assert.equal(r.domain, 'exaapi.com');
  assert.equal(r.normalizedFromWildcard, true);
});

test('域名内部通配保持原样', () => {
  const r = parseLine('||*-ad-sign.byteimg.com^');
  assert.equal(r.kind, 'raw');
});

test('白名单通配不做归一化', () => {
  const r = parseLine('@@||*.example.com^');
  assert.equal(r.kind, 'raw');
});

test('hosts 格式转换', () => {
  assert.equal(parseLine('0.0.0.0 ads.example.com').domain, 'ads.example.com');
  assert.equal(parseLine('127.0.0.1 x.example.com').domain, 'x.example.com');
});

test('行尾误拼的 ! 注释被截断', () => {
  const r = parseLine('||zzzmxvoxooaat.site^! Description: 反馈群538268498');
  assert.equal(r.kind, 'block');
  assert.equal(r.domain, 'zzzmxvoxooaat.site');
});

test('注释与元素隐藏规则被丢弃', () => {
  assert.equal(parseLine('! Title: xxx').kind, 'skip');
  assert.equal(parseLine('# 注释').kind, 'skip');
  assert.equal(parseLine('example.com##.ad-banner').kind, 'skip');
  assert.equal(parseLine('[Adblock Plus 2.0]').kind, 'skip');
});

test('正则规则必须原样保留（App 内广告位只能靠它覆盖）', () => {
  // `/^guanggao\./` 拦的是「广告标签.任意域名」，域名清单写不出这类广告位；
  // 丢掉它就会重现「单独订阅能拦、合并后拦不住」的问题
  const r = parseLine('/^guanggao\\./');
  assert.equal(r.kind, 'raw');
  assert.equal(r.rule, '/^guanggao\\./');

  const stat = parseLine('/^.+stat\\.kugou\\.com/');
  assert.equal(stat.kind, 'raw');

  // 带 AdGuard Home 认识的 DNS 级修饰符时，正则 + 修饰符要一起保留
  const dnstype = parseLine('/^adservice\\./$dnstype=A');
  assert.equal(dnstype.kind, 'raw');
  assert.equal(dnstype.rule, '/^adservice\\./$dnstype=A');

  // 正则里合法出现 `!` / `#` 时不能被当成注释截断
  const bangHash = parseLine('/^ad[!#]\\./');
  assert.equal(bangHash.kind, 'raw');
  assert.equal(bangHash.rule, '/^ad[!#]\\./');

  // 语法编译不过、或带 DNS 层无效修饰符的正则，整条丢弃（AdGuard Home 也会整条忽略）
  assert.equal(parseLine('/^ad[/').reason, 'regex');
  assert.equal(parseLine('/^ads\\./$popup').reason, 'regex-modifier');

  // `@@` 正则例外无法静态判定交集，按「黑名单优先」整条剔除
  assert.equal(parseLine('@@/^ad\\./').reason, 'regex-allow');
});

test('路径与 URL 锚定规则被丢弃', () => {
  assert.equal(parseLine('||api.zhihu.com/ad-style-service').reason, 'path');
  assert.equal(parseLine('|http://example.com/ad').reason, 'url-anchor');
});

test('无效域名被丢弃', () => {
  assert.equal(parseLine('||1.2.3.4^').kind, 'skip');
  assert.equal(parseLine('||localhost^').kind, 'skip');
});

test('中文域名转 punycode', () => {
  assert.equal(normalizeDomain('广告.中国'), 'xn--4rr70v.xn--fiqs8s');
});

test('大小写与首尾点归一化', () => {
  assert.equal(normalizeDomain('  ADS.Example.COM.  '), 'ads.example.com');
});

test('父域覆盖子域', () => {
  const { keep, removed } = subsumeByParent(['a.com', 'b.a.com', 'c.b.a.com', 'other.net']);
  assert.deepEqual(keep.sort(), ['a.com', 'other.net']);
  assert.equal(removed.length, 2);
  assert.equal(removed[0].parent, 'a.com');
});

test('非后缀匹配的相似域名不被误伤', () => {
  const { keep } = subsumeByParent(['a.com', 'nota.com', 'xa.com']);
  assert.equal(keep.length, 3);
});

test('$important 规则不被父域吞掉', () => {
  const result = mergeSources([
    {
      id: 's1',
      name: 's1',
      url: 'u',
      homepage: 'h',
      parsed: {
        block: [{ kind: 'block', domain: 'a.com' }],
        allow: [],
        raw: [],
        skipped: {},
        totalLines: 1,
        effective: 1,
      },
    },
    {
      id: 's2',
      name: 's2',
      url: 'u',
      homepage: 'h',
      parsed: {
        block: [{ kind: 'block', domain: 'b.a.com', important: true }],
        allow: [],
        raw: [],
        skipped: {},
        totalLines: 1,
        effective: 1,
      },
    },
  ]);
  assert.equal(result.block.length, 2);
  assert.equal(result.stats.subsumeRemoved, 0);
});

test('白名单只去重不收敛', () => {
  const result = mergeSources([
    {
      id: 's1',
      name: 's1',
      url: 'u',
      homepage: 'h',
      parsed: {
        block: [],
        allow: [
          { kind: 'allow', domain: 'a.com' },
          { kind: 'allow', domain: 'b.a.com' },
          { kind: 'allow', domain: 'b.a.com' },
        ],
        raw: [],
        skipped: {},
        totalLines: 3,
        effective: 3,
      },
    },
  ]);
  assert.deepEqual(
    result.allow.map((a) => a.domain),
    ['a.com', 'b.a.com']
  );
  assert.equal(result.stats.before, 3);
});

test('跨源同域去重并升级 important', () => {
  const mk = (id, block) => ({
    id,
    name: id,
    url: 'u',
    homepage: 'h',
    parsed: { block, allow: [], raw: [], skipped: {}, totalLines: block.length, effective: block.length },
  });
  const result = mergeSources([
    mk('s1', [{ kind: 'block', domain: 'a.com' }]),
    mk('s2', [{ kind: 'block', domain: 'a.com', important: true }]),
  ]);
  assert.equal(result.block.length, 1);
  assert.equal(result.block[0].important, true);
});

test('北京时间格式化', () => {
  const t = beijingNow(new Date('2026-11-01T06:47:00Z'));
  assert.equal(t.minute, '2026-11-01 14:47');
});

// ---------- 抓取层：内容体检 / 候选地址 ----------

test('错误页不会被当成规则文本', () => {
  const html =
    '<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body>' +
    'upstream connect error'.repeat(40) +
    '</body></html>';
  assert.equal(looksLikeRuleList(html), false);
  assert.equal(looksLikeRuleList(''), false);
  assert.equal(looksLikeRuleList('ok'), false);
});

test('正常规则文本通过体检', () => {
  const text = [
    '! Title: test',
    '! Last modified: 2026-11-01',
    ...Array.from({ length: 40 }, (_, i) => `||ad${i}.example.com^`),
    '0.0.0.0 tracker.example.net',
    '@@||safe.example.com^',
  ].join('\n');
  assert.equal(looksLikeRuleList(text), true);
});

test('非 GitHub 域名不生成无效镜像候选', () => {
  assert.deepEqual(buildCandidates('https://adrules.top/dns.txt'), [
    'https://adrules.top/dns.txt',
  ]);

  const gh = buildCandidates('https://raw.githubusercontent.com/a/b/main/c.txt');
  assert.ok(gh.length >= 6);
  assert.ok(gh.includes('https://cdn.jsdelivr.net/gh/a/b@main/c.txt'));
  assert.ok(gh[0].startsWith('https://raw.githubusercontent.com/'));
});

test('jsDelivr 地址有备用 CDN 与 raw 回退，不押在单一入口', () => {
  const url = 'https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/adblock/pro.txt';
  const list = buildCandidates(url);

  assert.equal(list[0], url, '原始地址必须排第一，优先按配置的链接抓');
  assert.ok(list.includes('https://fastly.jsdelivr.net/gh/hagezi/dns-blocklists@latest/adblock/pro.txt'));
  assert.ok(list.includes('https://gcore.jsdelivr.net/gh/hagezi/dns-blocklists@latest/adblock/pro.txt'));

  // @latest 是 jsDelivr 的别名，raw 不认识，必须换成 HEAD 才能拿到默认分支内容
  const rawUrl = 'https://raw.githubusercontent.com/hagezi/dns-blocklists/HEAD/adblock/pro.txt';
  assert.ok(list.includes(rawUrl), 'jsDelivr 全挂时要能回退到 GitHub raw');
  assert.ok(list.includes(`https://ghfast.top/${rawUrl}`));
  assert.equal(new Set(list).size, list.length, '候选地址不能重复');

  // 显式分支的写法不被改写成 HEAD
  const pinned = buildCandidates('https://cdn.jsdelivr.net/gh/a/b@main/c/d.txt');
  assert.ok(pinned.includes('https://raw.githubusercontent.com/a/b/main/c/d.txt'));
});

// ---------- 解析层：hosts 行尾注释 ----------

test('hosts 行尾的 # 注释不影响解析', () => {
  const r = parseLine('0.0.0.0 ads.example.com # 广告域名');
  assert.equal(r.kind, 'block');
  assert.equal(r.domain, 'ads.example.com');
  assert.equal(parseLine('127.0.0.1 x.example.com\t#xx').domain, 'x.example.com');
});

// ---------- 合并层：镜像去重 / 白名单架空 ----------

test('同内容镜像不重复计入合并前规则数', () => {
  const mk = (id, mirror, domains) => ({
    id,
    name: id,
    url: 'u',
    homepage: 'h',
    mirror,
    parsed: {
      block: domains.map((d) => ({ kind: 'block', domain: d })),
      allow: [],
      raw: [],
      skipped: {},
      totalLines: domains.length,
      effective: domains.length,
    },
  });

  const result = mergeSources([
    mk('adrules', false, ['x.com', 'y.com']),
    mk('cat', true, ['x.com', 'y.com']),
  ]);

  assert.equal(result.stats.before, 2, '镜像的 2 条不应重复计入');
  assert.equal(result.block.length, 2);
  assert.equal(result.sources.length, 2, '源清单仍要保留镜像条目');
  assert.equal(result.sources[1].mirror, true);
});

test('上游数量按 upstream 分组，不按地址条数', () => {
  const mk = (id, upstream) => ({
    id,
    name: id,
    url: 'u',
    homepage: 'h',
    upstream,
    parsed: { block: [{ kind: 'block', domain: `${id}.com` }], allow: [], raw: [], skipped: {}, totalLines: 1, effective: 1 },
  });

  const result = mergeSources([mk('adrules', 'adrules'), mk('cat', 'adrules'), mk('oisd', 'oisd')]);
  assert.equal(result.stats.upstreams, 2);
});

test('白名单父域架空子域屏蔽规则能被统计出来', () => {
  const { count, sample } = findAllowShadowed(
    ['ads.a.com', 'b.a.com', 'c.net', 'com'],
    new Set(['a.com'])
  );
  assert.equal(count, 2);
  assert.equal(sample.length, 2);
  assert.equal(sample[0].allow, 'a.com');
});

test('解析阶段丢弃的行按原因汇总', () => {
  const result = mergeSources([
    {
      id: 's1',
      name: 's1',
      url: 'u',
      homepage: 'h',
      parsed: {
        block: [{ kind: 'block', domain: 'a.com' }],
        allow: [],
        raw: [],
        skipped: { regex: 3, path: 2, 'element-hide': 1 },
        totalLines: 7,
        effective: 1,
      },
    },
    {
      id: 's2',
      name: 's2',
      url: 'u',
      homepage: 'h',
      parsed: {
        block: [],
        allow: [],
        raw: [],
        skipped: { regex: 1 },
        totalLines: 1,
        effective: 0,
      },
    },
  ]);

  assert.equal(result.stats.skipped.regex, 4);
  assert.equal(result.stats.skipped.path, 2);
  assert.equal(result.stats.skippedTotal, 7);
});

// ---------- 回归：本次修复的 6 个问题 ----------

test('一个 IP 挂多个域名的 hosts 行不再整行丢弃', () => {
  const r = parseLine('0.0.0.0 a.com b.com c.example.net');
  assert.equal(r.kind, 'block');
  assert.deepEqual(r.domains, ['a.com', 'b.com', 'c.example.net']);

  const parsed = parseList('0.0.0.0 a.com b.com\n');
  assert.equal(parsed.block.length, 2, '应当展开成 2 条屏蔽规则');
  assert.equal(parsed.skipped.unknown, undefined);
});

test('纯域名列表能通过内容体检', () => {
  // parser 支持裸域名行，体检却只认 || 前缀，会把合法列表判成错误页
  const bare = Array.from({ length: 600 }, (_, i) => `ad${i}.example.com`).join('\n');
  assert.equal(looksLikeRuleList(bare), true);
  assert.equal(looksLikeRuleList('{"message":"Not Found"}'), false);
});

test('缺 ^ 锚定与带路径分开统计', () => {
  assert.equal(parseLine('||example.com').reason, 'no-anchor');
  assert.equal(parseLine('||example.com/ad.js').reason, 'path');
});

test('同域冲突按黑名单优先处理后归零，且只统计收敛后仍在文件里的规则', () => {
  // x.a.com 的屏蔽规则会被 a.com 收敛掉，文件里只剩 a.com 和 y.com；
  // 两个白名单都与黑名单相交（x.a.com 落在 a.com 之下、y.com 同域），全部剔除
  const mk = (id, block, allow) => ({
    id,
    name: id,
    url: 'u',
    homepage: 'h',
    parsed: {
      block,
      allow,
      raw: [],
      skipped: {},
      totalLines: block.length + allow.length,
      effective: block.length + allow.length,
    },
  });
  const result = mergeSources([
    mk(
      's1',
      [
        { kind: 'block', domain: 'a.com' },
        { kind: 'block', domain: 'x.a.com' },
        { kind: 'block', domain: 'y.com' },
      ],
      [
        { kind: 'allow', domain: 'x.a.com' },
        { kind: 'allow', domain: 'y.com' },
      ]
    ),
  ]);
  assert.deepEqual(result.block.map((b) => b.domain), ['a.com', 'y.com']);
  assert.deepEqual(result.allow, [], '与黑名单相交的白名单必须全部剔除');
  assert.equal(result.stats.conflicts, 0, '剔除后不应再有同域既屏蔽又放行');
  assert.equal(
    result.stats.conflictsResolved,
    1,
    'x.a.com 的屏蔽规则已被收敛，真实同域冲突只有 y.com 一条'
  );
  assert.equal(result.stats.allowDropped, 2);
});

test('被 $badfilter 点名的域名不参与父子域收敛', () => {
  // 上游用 ||ads.a.com^$badfilter 明确放行，若 ||ads.a.com^ 被父域 a.com 收敛掉，
  // badfilter 就成了空取消，父域照样挡住它
  const r = mergeSources([
    {
      id: 's1',
      name: 's1',
      url: 'u',
      homepage: 'h',
      parsed: {
        block: [
          { kind: 'block', domain: 'a.com' },
          { kind: 'block', domain: 'ads.a.com' },
        ],
        allow: [],
        raw: ['||ads.a.com^$badfilter'],
        skipped: {},
        totalLines: 3,
        effective: 3,
      },
    },
  ]);
  assert.ok(
    r.block.some((b) => b.domain === 'ads.a.com'),
    '被 badfilter 取消的规则必须保留，让 badfilter 有东西可取消'
  );
  assert.equal(r.block.find((b) => b.domain === 'ads.a.com').important, false);
  assert.equal(r.stats.badfilterKept, 1);
});

test('白名单 $important 跨源合并且能渲染出来', () => {
  const mk = (id, allow) => ({
    id,
    name: id,
    url: 'u',
    homepage: 'h',
    parsed: { block: [], allow, raw: [], skipped: {}, totalLines: 1, effective: 1 },
  });
  const result = mergeSources([
    mk('s1', [{ kind: 'allow', domain: 'a.com', important: false }]),
    mk('s2', [{ kind: 'allow', domain: 'a.com', important: true }]),
  ]);
  assert.equal(result.allow.length, 1);
  assert.equal(result.allow[0].important, true);

  const out = renderRules(result, { updatedAt: beijingNow(), homepage: 'h' });
  assert.ok(out.includes('@@||a.com^$important'));
});

test('黑名单优先后「实际不生效的屏蔽规则」归零', () => {
  const mk = (id, block, allow) => ({
    id,
    name: id,
    url: 'u',
    homepage: 'h',
    parsed: {
      block,
      allow,
      raw: [],
      skipped: {},
      totalLines: block.length + allow.length,
      effective: block.length + allow.length,
    },
  });
  const result = mergeSources([
    mk(
      's1',
      [
        { kind: 'block', domain: 'ads.a.com' }, // 原本被 @@||a.com^ 架空
        { kind: 'block', domain: 'b.com' }, // 同域既有屏蔽又有 @@
      ],
      [
        { kind: 'allow', domain: 'a.com' },
        { kind: 'allow', domain: 'b.com' },
      ]
    ),
  ]);
  // a.com 的白名单解开了黑名单子域 ads.a.com，b.com 是同域冲突 → 两条都剔除
  assert.equal(result.stats.allowDropped, 2);
  assert.equal(result.stats.allowDroppedByReason['shadows-block'], 1);
  assert.equal(result.stats.allowDroppedByReason['same-domain'], 1);
  // 剔除白名单后，原本被架空的 ads.a.com 重新生效
  assert.equal(result.stats.shadowRestored, 1);
  assert.equal(result.stats.allowShadowed, 0);
  assert.equal(result.stats.conflicts, 0);
  assert.equal(result.stats.deadRules, 0);
  assert.deepEqual(result.allow, []);
  assert.equal(result.block.length, 2, '屏蔽规则一条都不能少');
});

test('抓取预算耗尽时能区分单源预算与全局预算', async () => {
  const { fetchText } = await import('./network.js');
  await assert.rejects(
    () => fetchText('https://adrules.top/dns.txt', { deadline: Date.now() - 1, budgetScope: '单源' }),
    /已超单源抓取预算/
  );
  await assert.rejects(
    () => fetchText('https://adrules.top/dns.txt', { deadline: Date.now() - 1 }),
    /已超全局抓取预算/
  );
});

// ---------- 回归：注释里的 ## 不再吞掉有效规则 ----------

test('hosts 行尾的 ## 注释不会把整条规则判成元素隐藏', () => {
  // 元素隐藏规则从不以 0.0.0.0 / || 开头，因此这类行里的 # 只能是注释
  const r = parseLine('0.0.0.0 ads.example.com ## 广告域名');
  assert.equal(r.kind, 'block');
  assert.equal(r.domain, 'ads.example.com');

  const n = parseLine('||a.com^##注释');
  assert.equal(n.kind, 'block');
  assert.equal(n.domain, 'a.com');

  const p = parseLine('127.0.0.1 b.example.net#备注');
  assert.equal(p.domain, 'b.example.net');
});

test('真正的元素隐藏规则仍然被丢弃', () => {
  assert.equal(parseLine('example.com##.ad-banner').reason, 'element-hide');
  assert.equal(parseLine('example.com#@#.ad-banner').reason, 'element-hide');
  assert.equal(parseLine('example.com#?#div:has(.ad)').reason, 'element-hide');
});

// ---------- 产物自检 ----------

test('产物自检能放过合法规则、拦住非法行', () => {
  const ok = renderRules(
    {
      block: [
        { domain: 'a.com', important: false },
        { domain: 'b.com', important: true },
      ],
      allow: [{ domain: 'safe.example.com', important: false }],
      raw: ['||*-ad-sign.byteimg.com^'],
      sources: [],
      stats: {
        before: 3,
        after: 4,
        blockUnique: 2,
        allowUnique: 1,
        rawUnique: 1,
        subsumeRemoved: 0,
        rawCovered: 0,
        sharedSuffixKept: 0,
        allowShadowed: 0,
        conflicts: 0,
        importantOverAllow: 0,
        deadRules: 0,
        badfilterKept: 0,
        skipped: {},
        skippedTotal: 0,
        upstreams: 1,
      },
    },
    { updatedAt: beijingNow(), homepage: 'h' }
  );
  assert.deepEqual(verifyRenderedRules(ok, ['||*-ad-sign.byteimg.com^']).bad, []);

  // 域名里混进非法字符（渲染层被改坏的典型后果）必须被拦住
  const broken = `${ok}\n||bad domain.com^\n`;
  const { bad } = verifyRenderedRules(broken, ['||*-ad-sign.byteimg.com^']);
  assert.equal(bad.length, 1);
  assert.equal(bad[0], '||bad domain.com^');
});

// ---------- 黑名单优先：白名单与黑名单相交即整条失效 ----------

test('三种交集都剔除：同域 / 落在被屏蔽父域下 / 解开了黑名单子域', () => {
  const { dropped, byReason } = pruneBlockedAllows(
    ['ads.com', 'a.com', 'x.b.com', 'keep.com'],
    ['ads.com', 'y.a.com', 'b.com', 'safe.com']
  );
  const reasonOf = new Map(dropped.map((d) => [d.domain, d.reason]));
  assert.equal(reasonOf.get('ads.com'), 'same-domain');
  assert.equal(reasonOf.get('y.a.com'), 'under-block', 'a.com 被屏蔽，其子域白名单等于给父域规则挖洞');
  assert.equal(reasonOf.get('b.com'), 'shadows-block', 'x.b.com 被屏蔽，b.com 的白名单会把它解开');
  assert.equal(reasonOf.has('safe.com'), false, '无交集的白名单必须保留');
  assert.deepEqual(byReason, { 'same-domain': 1, 'under-block': 1, 'shadows-block': 1 });
});

test('白名单剔除后被屏蔽域名一条不少、且 @@ 不再出现在产物里', () => {
  const result = mergeSources([
    {
      id: 's1',
      name: 's1',
      url: 'u',
      homepage: 'h',
      parsed: {
        block: [
          { kind: 'block', domain: 'ads.example.com' },
          { kind: 'block', domain: 'tracker.example.net' },
        ],
        allow: [
          { kind: 'allow', domain: 'example.com' }, // 覆盖了 ads.example.com
          { kind: 'allow', domain: 'tracker.example.net' }, // 同域
          { kind: 'allow', domain: 'safe.example.org' }, // 无冲突
        ],
        raw: [],
        skipped: {},
        totalLines: 5,
        effective: 5,
      },
    },
  ]);

  assert.deepEqual(result.allow.map((a) => a.domain), ['safe.example.org']);
  assert.equal(result.block.length, 2, '屏蔽规则不能因为剔除白名单而消失');

  const out = renderRules(result, { updatedAt: beijingNow(), homepage: 'h' });
  assert.ok(out.includes('@@||safe.example.org^'));
  assert.ok(!out.includes('@@||example.com^'), '与黑名单冲突的白名单不能渲染进产物');
  assert.ok(out.includes('||ads.example.com^'));
});

test('$important 不再是冲突判定的变量：带它的白名单同样失效', () => {
  const result = mergeSources([
    {
      id: 's1',
      name: 's1',
      url: 'u',
      homepage: 'h',
      parsed: {
        block: [{ kind: 'block', domain: 'a.com' }],
        allow: [{ kind: 'allow', domain: 'a.com', important: true }],
        raw: [],
        skipped: {},
        totalLines: 2,
        effective: 2,
      },
    },
  ]);
  assert.deepEqual(result.allow, []);
  assert.equal(result.stats.allowDropped, 1);
});

// ---------- 发布闸门：缺源不发布，增删源不影响 ----------

test('任一上游没有可用地址就整轮不发布', () => {
  const gate = evaluateSourceGate({
    totalUpstreams: ['awavenue', 'adrules', 'oisd'],
    okUpstreams: ['awavenue', 'oisd'],
  });
  assert.equal(gate.abort, true);
  assert.deepEqual(gate.missing, ['adrules']);
});

test('增删源不影响发布：判定只看当前配置了哪些上游', () => {
  // 删掉 adrules 后配置只剩两个，都成功 → 正常发布（不会因为总数变化而卡住）
  assert.equal(
    evaluateSourceGate({ totalUpstreams: ['awavenue', 'oisd'], okUpstreams: ['awavenue', 'oisd'] })
      .abort,
    false
  );
  // 新增一个源但它连不上 → 不发布，这正是要的效果
  const added = evaluateSourceGate({
    totalUpstreams: ['awavenue', 'oisd', 'newsrc'],
    okUpstreams: ['awavenue', 'oisd'],
  });
  assert.equal(added.abort, true);
  assert.deepEqual(added.missing, ['newsrc']);
});

test('同一上游的多个地址互为备份，主地址成功就不算缺源', () => {
  // adrules 与 cat 是两个地址、同一个 upstream：cat 挂了但 adrules 成功，数据是完整的
  const gate = evaluateSourceGate({
    totalUpstreams: new Set(['adrules', 'oisd']),
    okUpstreams: new Set(['adrules']),
  });
  assert.equal(gate.abort, true, 'oisd 仍然缺失，必须拦住');
  assert.deepEqual(gate.missing, ['oisd']);

  // 补齐 oisd 后，adrules 只有一个地址成功也照样发布
  assert.equal(
    evaluateSourceGate({
      totalUpstreams: ['adrules', 'oisd'],
      okUpstreams: ['adrules', 'oisd'],
    }).abort,
    false
  );
});

test('force 可以临时忽略缺源', () => {
  const gate = evaluateSourceGate({
    totalUpstreams: ['a', 'b'],
    okUpstreams: ['a'],
    force: true,
  });
  assert.equal(gate.abort, false);
  assert.equal(gate.forced, true);
  assert.deepEqual(gate.missing, ['b']);
});

test('forceFromEnv 只认明确的开值', () => {
  assert.equal(forceFromEnv({ FORCE: 'true' }), true);
  assert.equal(forceFromEnv({ FORCE: 'TRUE' }), true);
  assert.equal(forceFromEnv({ FORCE: '1' }), true);
  assert.equal(forceFromEnv({ FORCE: 'yes' }), true);
  assert.equal(forceFromEnv({ FORCE: 'false' }), false);
  assert.equal(forceFromEnv({ FORCE: '' }), false);
  assert.equal(forceFromEnv({}), false);
});

// ---------- 强制白名单：allowlist.txt 覆盖黑名单优先 ----------

const mkSrc = (id, block = [], allow = [], raw = []) => ({
  id,
  name: id,
  url: 'u',
  homepage: 'h',
  parsed: {
    block,
    allow,
    raw,
    skipped: {},
    totalLines: block.length + allow.length + raw.length,
    effective: block.length + allow.length + raw.length,
  },
});

test('allowlist.txt 解析：注释、行内说明、三种写法、去重与非法条目', () => {
  const { entries, errors, warnings } = parseAllowlist(
    [
      '! 整行注释',
      '# 另一种注释',
      '',
      'dns.weixin.qq.com        # 微信 HTTPDNS',
      '||mapi.m.jd.com^',
      '@@||loggw.alipay.com^   # 日志网关',
      'dns.weixin.qq.com', // 重复
      'not a domain',
      'qq.com', // 两段式整域放行 → 告警
    ].join('\n')
  );

  assert.deepEqual(
    entries.map((e) => [e.domain, e.reason]),
    [
      ['dns.weixin.qq.com', '微信 HTTPDNS'],
      ['mapi.m.jd.com', ''],
      ['loggw.alipay.com', '日志网关'],
      ['qq.com', ''],
    ]
  );
  assert.equal(errors.length, 1, '非法行必须报错，不能静默跳过');
  assert.ok(errors[0].includes('第 8 行'));
  assert.equal(warnings.length, 2, '重复 + 整域放行各一条告警');
});

test('强制白名单：同域屏蔽规则被删除，@@ 必定写入产物', () => {
  const result = mergeSources(
    [mkSrc('s1', [{ kind: 'block', domain: 'mapi.m.jd.com' }])],
    { forcedAllow: ['mapi.m.jd.com'] }
  );

  assert.equal(result.block.length, 0, '屏蔽规则必须被移除，否则文件里自相矛盾');
  assert.deepEqual(result.allow.map((a) => a.domain), ['mapi.m.jd.com']);
  assert.equal(result.allow[0].forced, true);
  assert.equal(result.stats.forcedAllow, 1);
  assert.equal(result.stats.forcedAllowActive, 1);
  assert.equal(result.stats.forcedBlockRemoved, 1);
  assert.equal(result.stats.deadRules, 0, '同域既屏蔽又放行必须归零');

  const out = renderRules(result, { updatedAt: beijingNow(), homepage: 'h' });
  assert.ok(out.includes('@@||mapi.m.jd.com^'));
  assert.ok(
    !/^\|\|mapi\.m\.jd\.com\^$/m.test(out),
    '屏蔽侧必须整条消失，而不是留着当死规则'
  );
  assert.deepEqual(verifyRenderedRules(out, result.raw).bad, []);
});

test('强制白名单：父域放行时，其下所有屏蔽子域一并移除', () => {
  const result = mergeSources(
    [
      mkSrc('s1', [
        { kind: 'block', domain: 'dns.weixin.qq.com' },
        { kind: 'block', domain: 'x.dns.weixin.qq.com' },
        { kind: 'block', domain: 'ad.qq.com' },
      ]),
    ],
    { forcedAllow: ['dns.weixin.qq.com'] }
  );

  assert.deepEqual(result.block.map((b) => b.domain), ['ad.qq.com'], '只放行目标域名，不误伤无关域名');
  // x.dns.weixin.qq.com 先被父子域收敛吃掉，真正走到「强制白名单」这一步的只有 1 条
  assert.equal(result.stats.forcedBlockRemoved, 1);
  assert.equal(isSelfOrSubdomain('x.dns.weixin.qq.com', 'dns.weixin.qq.com'), true);
  assert.equal(isSelfOrSubdomain('notdns.weixin.qq.com', 'dns.weixin.qq.com'), false);
});

test('强制白名单不受「黑名单优先」约束，且不被上游白名单重复渲染', () => {
  // 上游 @@ 会因与黑名单冲突被剔除；同一条目写进 allowlist.txt 后必须活下来
  const result = mergeSources(
    [
      mkSrc('s1', [{ kind: 'block', domain: 'ads.privacy.qq.com' }], [
        { kind: 'allow', domain: 'ads.privacy.qq.com' },
      ]),
    ],
    { forcedAllow: ['ads.privacy.qq.com'] }
  );

  assert.equal(result.stats.allowDropped, 0, '强制白名单不参与剔除判定');
  assert.equal(result.allow.length, 1, '同域只能出现一条 @@');
  assert.equal(result.allow[0].forced, true);
  assert.equal(result.block.length, 0);

  const out = renderRules(result, { updatedAt: beijingNow(), homepage: 'h' });
  assert.equal(out.match(/@@\|\|ads\.privacy\.qq\.com\^/g).length, 1);
});

test('强制白名单覆盖到 $important 屏蔽规则也能清掉（否则 @@ 压不过它）', () => {
  const result = mergeSources(
    [mkSrc('s1', [{ kind: 'block', domain: 'a.example.com', important: true }])],
    { forcedAllow: ['a.example.com'] }
  );
  assert.equal(result.block.length, 0);
  assert.equal(result.stats.forcedBlockRemoved, 1);
});

test('裸二级域必须写明确认标记才算整域放行，否则只告警', () => {
  const warned = parseAllowlist('example.com\n');
  assert.deepEqual(warned.errors, []);
  assert.equal(warned.warnings.length, 1);
  assert.match(warned.warnings[0], /整域放行/);

  // 行尾注释写明「整域放行」= 已确认，不再告警，但条目照常生效
  const confirmed = parseAllowlist('example.com   # 整域放行：官方全站\n');
  assert.deepEqual(confirmed.errors, []);
  assert.deepEqual(confirmed.warnings, []);
  assert.equal(confirmed.entries.length, 1);
  assert.equal(confirmed.entries[0].domain, 'example.com');

  // allow-apex 同义，方便英文注释习惯
  assert.deepEqual(parseAllowlist('example.com  # allow-apex\n').warnings, []);

  // 三段式域名本来就不该告警，写不写标记都一样
  assert.deepEqual(parseAllowlist('a.example.com\n').warnings, []);
});

test('仓库自带 allowlist.txt 能通过校验，且每条都是合法域名', () => {
  const { entries, errors, warnings } = loadAllowlist(new URL('../allowlist.txt', import.meta.url));
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.ok(entries.length >= 30, '常见 App 的误杀项应当成规模收录');
  for (const e of entries) {
    assert.ok(e.domain.includes('.'), `${e.domain} 必须是域名`);
  }
  // 关键误杀项必须在内：少任何一条都意味着微信/QQ/京东会复发
  for (const must of [
    'dns.weixin.qq.com',
    'dns.jd.com',
    'mapi.m.jd.com',
    'configsvr.msf.3g.qq.com',
    'loggw.alipay.com',
    'images.pinduoduo.com',
  ]) {
    assert.ok(entries.some((e) => e.domain === must), `allowlist.txt 缺少 ${must}`);
  }
});
