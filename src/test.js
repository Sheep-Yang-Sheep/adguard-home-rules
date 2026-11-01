import test from 'node:test';
import assert from 'node:assert/strict';

import { parseLine, normalizeDomain } from './parser.js';
import { subsumeByParent, mergeSources, findAllowShadowed } from './merger.js';
import { beijingNow } from './render.js';
import { buildCandidates, looksLikeRuleList } from './network.js';

test('标准屏蔽规则', () => {
  const r = parseLine('||example.com^');
  assert.equal(r.kind, 'block');
  assert.equal(r.domain, 'example.com');
  assert.equal(r.important, false);
});

test('白名单例外规则', () => {
  assert.deepEqual(parseLine('@@||ad.azure.com^'), { kind: 'allow', domain: 'ad.azure.com' });
});

test('$important 标记', () => {
  const r = parseLine('||example.com^$important');
  assert.equal(r.kind, 'block');
  assert.equal(r.domain, 'example.com');
  assert.equal(r.important, true);
});

test('DNS 层无效的修饰符被丢弃', () => {
  assert.equal(parseLine('||example.com^$third-party').kind, 'skip');
  assert.equal(parseLine('||example.com^$app=com.tencent.mm').kind, 'skip');
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
  assert.deepEqual(result.allow, ['a.com', 'b.a.com']);
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
