/**
 * 合并器
 *
 * 职责：
 *   1. 跨源去重（域名级）
 *   2. 父子域收敛：父域已被屏蔽时，其子域的独立屏蔽规则属于冗余，直接剔除
 *   3. 白名单例外 @@ 只做去重，永不收敛
 *   4. 体检报告：白名单架空了多少屏蔽规则、同域冲突、被丢弃的行——全部量化输出
 */

/**
 * 共享后缀保护名单
 *
 * 父子域收敛的前提是「这个父域确实属于同一个人」。`co.uk`、`com.cn` 这类二级公共后缀，
 * 以及 `github.io`、`netlify.app` 这类由无数陌生人共用的平台域名，都不满足这个前提。
 *
 * 一旦某个上游混进一条 `||co.uk^`，收敛会把名下几万条子域规则一次性删光。拦截效果其实
 * 没变（父域规则本来就覆盖全部子域），但规则数会瞬间塌陷，直接触发工作流「比上轮少 20%
 * 就拒绝发布」的熔断，导致整轮失败、订阅停更 —— 一条脏数据放大成全局故障。
 *
 * 所以这类域名只正常参与屏蔽，不充当收敛的父域。
 */
const CC_GENERIC_SLD = new Set([
  'com', 'co', 'net', 'org', 'gov', 'ac', 'edu', 'or', 'ne', 'go',
  'nic', 'gen', 'web', 'sch', 'mil', 'nom', 'gob', 'gouv', 'biz', 'idv',
]);

const PLATFORM_SUFFIXES = new Set([
  'github.io', 'gitlab.io', 'netlify.app', 'vercel.app', 'pages.dev', 'workers.dev',
  'blogspot.com', 'herokuapp.com', 'azurewebsites.net', 'cloudfront.net', 'onrender.com',
  'fly.dev', 'web.app', 'firebaseapp.com', 'r2.dev', 'trycloudflare.com',
  'readthedocs.io', 'surge.sh', 'glitch.me', 's3.amazonaws.com',
]);

/**
 * 是否是「多人共用、不该拿来收敛」的后缀
 * @param {string} domain 已归一化的小写域名
 */
export function isSharedSuffix(domain) {
  if (PLATFORM_SUFFIXES.has(domain)) return true;
  const parts = domain.split('.');
  if (parts.length !== 2) return false;
  const [sld, tld] = parts;
  // 两级 ccTLD：co.uk / com.cn / com.au / or.jp ……
  // 只匹配「通用二级标签 + 两字母国别后缀」，不会误伤 example.de 这类正常域名
  return tld.length === 2 && CC_GENERIC_SLD.has(sld);
}

/**
 * 找出被父域规则覆盖的域名
 * @param {string[]} domains 已去重的屏蔽域名
 * @returns {{keep:string[], removed:Array<{domain:string, parent:string}>, protectedHits:number}}
 */
export function subsumeByParent(domains) {
  const set = new Set(domains);
  const keep = [];
  const removed = [];
  let protectedHits = 0;

  for (const d of domains) {
    let parent = null;
    let idx = d.indexOf('.');
    while (idx !== -1) {
      const candidate = d.slice(idx + 1);
      if (set.has(candidate)) {
        if (isSharedSuffix(candidate)) {
          // 共享后缀只屏蔽自己，不吞掉别人的子域；继续往上找真正的归属父域
          protectedHits += 1;
        } else {
          parent = candidate;
          break;
        }
      }
      idx = d.indexOf('.', idx + 1);
    }
    if (parent) removed.push({ domain: d, parent });
    else keep.push(d);
  }

  return { keep, removed, protectedHits };
}

/**
 * 判断一条通配规则是否已被某个父域屏蔽规则完整覆盖
 * 仅处理 `||...^` 且不带 `$` 修饰符的规则；`@@` 例外规则不参与
 */
function isRawCoveredByBlock(rule, blockedSet) {
  if (!rule.startsWith('||') || rule.includes('$') || !rule.endsWith('^')) return false;
  const body = rule.slice(2, -1);
  let idx = body.indexOf('.');
  while (idx !== -1) {
    if (blockedSet.has(body.slice(idx + 1))) return true;
    idx = body.indexOf('.', idx + 1);
  }
  return false;
}

/**
 * 白名单父域会把它名下所有子域的屏蔽规则架空。
 *
 * 例：A 源为了修误杀加了 `@@||example.com^`，B 源屏蔽了 `ads.example.com`，
 * 合并后 `@@` 生效，`||ads.example.com^` 成了死规则 —— 文件里看着有，实际不拦。
 * 这部分必须量化出来，否则合并白名单等于静默漏水。
 *
 * @returns {{count:number, sample:Array<{domain:string, allow:string}>}}
 */
export function findAllowShadowed(blockDomains, allowSet, sampleSize = 5) {
  let count = 0;
  const sample = [];

  for (const d of blockDomains) {
    let idx = d.indexOf('.');
    while (idx !== -1) {
      const parent = d.slice(idx + 1);
      if (allowSet.has(parent)) {
        count += 1;
        if (sample.length < sampleSize) sample.push({ domain: d, allow: parent });
        break;
      }
      idx = d.indexOf('.', idx + 1);
    }
  }

  return { count, sample };
}

/**
 * 收集被 `$badfilter` 点名取消的域名
 *
 * `||ads.a.com^$badfilter` 的语义是「不要屏蔽 ads.a.com」。若 `||ads.a.com^` 因父域
 * `||a.com^` 已存在而被收敛剔除，badfilter 就变成空取消，父域照样把它挡住 ——
 * 上游明确放行的意图被静默破坏。因此被 badfilter 点名的域名不参与父子域收敛。
 *
 * @param {string[]} rawRules
 * @returns {Set<string>}
 */
export function badfilterTargets(rawRules) {
  const set = new Set();
  for (const rule of rawRules) {
    if (!/\$.*\bbadfilter\b/.test(rule)) continue;
    const m = /^\|\|([^$^*]+)\^/.exec(rule);
    if (m) set.add(m[1].trim().toLowerCase());
  }
  return set;
}

/**
 * @param {Array<{id:string,name:string,url:string,homepage:string,upstream?:string,parsed:object}>} sources
 */
export function mergeSources(sources) {
  /** @type {Map<string,{important:boolean,count:number}>} */
  const blockMap = new Map();
  /** @type {Map<string,{sources:Set<string>,important:boolean}>} 只对 200 多条例外规则记来源，成本可忽略 */
  const allowMap = new Map();
  /** @type {Map<string,number>} */
  const rawMap = new Map();

  const skipped = Object.create(null);
  let before = 0;

  for (const src of sources) {
    const { parsed } = src;

    // 内容完全相同的镜像条目只用来做抓取冗余，不参与合并、
    // 也不计入「合并前规则数」，否则统计会凭空虚高几十万条
    if (src.mirror) continue;

    before += parsed.effective;

    for (const r of parsed.block) {
      const cur = blockMap.get(r.domain);
      if (cur) {
        cur.important = cur.important || Boolean(r.important);
        cur.count += 1;
      } else {
        blockMap.set(r.domain, { important: Boolean(r.important), count: 1 });
      }
    }

    for (const r of parsed.allow) {
      const cur = allowMap.get(r.domain);
      if (cur) {
        cur.sources.add(src.id);
        cur.important = cur.important || Boolean(r.important);
      } else {
        allowMap.set(r.domain, { sources: new Set([src.id]), important: Boolean(r.important) });
      }
    }

    for (const text of parsed.raw) {
      rawMap.set(text, (rawMap.get(text) || 0) + 1);
    }

    for (const [reason, count] of Object.entries(parsed.skipped || {})) {
      skipped[reason] = (skipped[reason] || 0) + count;
    }
  }

  const blockUnique = blockMap.size;
  const allowUnique = allowMap.size;
  const rawUnique = rawMap.size;

  // 只有普通屏蔽规则可被父域覆盖；$important 规则优先级高于 @@ 例外，
  // 一旦剔除会改变实际拦截行为，因此始终原样保留。
  // 被 $badfilter 点名的域名同样不参与收敛，否则上游「明确放行」会被父域规则推翻。
  const keepForBadfilter = badfilterTargets([...rawMap.keys()]);
  const subsumeCandidates = [];
  const pinnedDomains = [];
  for (const [domain, meta] of blockMap) {
    if (meta.important) pinnedDomains.push(domain);
    else if (keepForBadfilter.has(domain)) pinnedDomains.push(domain);
    else subsumeCandidates.push(domain);
  }
  const { keep, removed, protectedHits } = subsumeByParent(subsumeCandidates);

  const finalBlock = [
    ...keep.map((d) => ({ domain: d, important: false })),
    ...pinnedDomains.map((d) => ({ domain: d, important: blockMap.get(d)?.important || false })),
  ];

  // 排序保证同内容生成同结果，避免无谓的 diff
  finalBlock.sort((a, b) => (a.domain < b.domain ? -1 : a.domain > b.domain ? 1 : 0));

  const finalAllow = [...allowMap.entries()]
    .map(([domain, meta]) => ({ domain, important: meta.important }))
    .sort((a, b) => (a.domain < b.domain ? -1 : a.domain > b.domain ? 1 : 0));
  const sortedRaw = [...rawMap.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  // 通配类规则（如 `||*-sdk.rum.aliyuncs.com^`）若其尾部父域已被屏蔽，
  // 匹配目标必然是父域的子域，同样属于冗余，可安全剔除
  const blockedSet = new Set(finalBlock.map((b) => b.domain));
  const finalRaw = [];
  let rawCovered = 0;
  for (const rule of sortedRaw) {
    if (isRawCoveredByBlock(rule, blockedSet)) rawCovered += 1;
    else finalRaw.push(rule);
  }

  // 同一域名既屏蔽又放行，AdGuard Home 以 @@ 为准（除非屏蔽带了 $important）
  // 注意：必须用收敛后的 finalBlock 判断，否则把已经被父域收敛掉的屏蔽规则也算成冲突
  const finalBlockSet = new Set(finalBlock.map((b) => b.domain));
  const allowDomains = finalAllow.map((a) => a.domain);
  const importantSet = new Set(finalBlock.filter((b) => b.important).map((b) => b.domain));
  const conflicts = allowDomains.filter((d) => finalBlockSet.has(d));
  const importantOverAllow = conflicts.filter((d) => importantSet.has(d));

  const shadowed = findAllowShadowed(finalBlock.map((b) => b.domain), new Set(allowDomains));

  // 文件里存在但实际不会拦截的规则总数：白名单架空 + 同域被 @@ 压过
  const deadRules = shadowed.count + conflicts.length - importantOverAllow.length;

  const after = finalBlock.length + finalAllow.length + finalRaw.length;

  const upstreams = new Set(sources.map((s) => s.upstream || s.id));
  const skippedTotal = Object.values(skipped).reduce((a, b) => a + b, 0);

  return {
    block: finalBlock,
    allow: finalAllow,
    raw: finalRaw,
    sources: sources.map((s) => ({
      id: s.id,
      name: s.name,
      url: s.url,
      homepage: s.homepage,
      upstream: s.upstream || s.id,
      mirror: Boolean(s.mirror),
      totalLines: s.parsed.totalLines,
      effective: s.parsed.effective,
      block: s.parsed.block.length,
      allow: s.parsed.allow.length,
      raw: s.parsed.raw.length,
      skippedTotal: Object.values(s.parsed.skipped || {}).reduce((a, b) => a + b, 0),
    })),
    stats: {
      before,
      after,
      blockUnique,
      allowUnique,
      rawUnique,
      subsumeRemoved: removed.length,
      rawCovered,
      // 命中共享后缀保护、因而没被父域吞掉的子域规则条数
      sharedSuffixKept: protectedHits,
      allowShadowed: shadowed.count,
      allowShadowedSample: shadowed.sample,
      conflicts: conflicts.length,
      importantOverAllow: importantOverAllow.length,
      deadRules,
      badfilterKept: pinnedDomains.filter((d) => keepForBadfilter.has(d) && !blockMap.get(d)?.important).length,
      skipped,
      skippedTotal,
      upstreams: upstreams.size,
    },
  };
}
