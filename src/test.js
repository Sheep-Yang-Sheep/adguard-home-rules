import test from 'node:test';
import assert from 'node:assert/strict';

import { parseLine, parseList, normalizeDomain } from './parser.js';
import { subsumeByParent, mergeSources, findAllowShadowed, pruneBlockedAllows } from './merger.js';
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

test('正则与路径规则被丢弃', () => {
  assert.equal(parseLine('/^.+stat\\.kugou\\.com/').reason, 'regex');
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
