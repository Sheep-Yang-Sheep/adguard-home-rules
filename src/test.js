import test from 'node:test';
import assert from 'node:assert/strict';

import { parseLine, normalizeDomain } from './parser.js';
import { subsumeByParent, mergeSources } from './merger.js';
import { beijingNow } from './render.js';

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
