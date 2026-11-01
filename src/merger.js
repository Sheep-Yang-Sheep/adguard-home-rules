/**
 * 合并器
 *
 * 职责：
 *   1. 跨源去重（域名级，附来源追踪）
 *   2. 父子域收敛：父域已被屏蔽时，其子域的独立屏蔽规则属于冗余，直接剔除
 *   3. 白名单例外 @@ 只做去重，永不收敛
 */

/**
 * 找出被父域规则覆盖的域名
 * @param {string[]} domains 已去重的屏蔽域名
 * @returns {{kept:string[], removed:Array<{domain:string, parent:string}>}}
 */
export function subsumeByParent(domains) {
  const set = new Set(domains);
  const keep = [];
  const removed = [];

  for (const d of domains) {
    let parent = null;
    let idx = d.indexOf('.');
    while (idx !== -1) {
      const candidate = d.slice(idx + 1);
      if (set.has(candidate)) {
        parent = candidate;
        break;
      }
      idx = d.indexOf('.', idx + 1);
    }
    if (parent) removed.push({ domain: d, parent });
    else keep.push(d);
  }

  return { keep, removed };
}

function bumpSource(set, id) {
  if (!set.has(id)) set.add(id);
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
 * @param {Array<{id:string,name:string,url:string,homepage:string,parsed:object}>} sources
 */
export function mergeSources(sources) {
  /** @type {Map<string,{important:boolean,sources:Set<string>}>} */
  const blockMap = new Map();
  const allowMap = new Map();
  const rawMap = new Map();

  let before = 0;

  for (const src of sources) {
    const { parsed } = src;
    before += parsed.effective;

    for (const r of parsed.block) {
      const cur = blockMap.get(r.domain);
      if (cur) {
        cur.important = cur.important || Boolean(r.important);
        bumpSource(cur.sources, src.id);
      } else {
        blockMap.set(r.domain, { important: Boolean(r.important), sources: new Set([src.id]) });
      }
    }

    for (const r of parsed.allow) {
      const cur = allowMap.get(r.domain);
      if (cur) bumpSource(cur.sources, src.id);
      else allowMap.set(r.domain, { sources: new Set([src.id]) });
    }

    for (const text of parsed.raw) {
      const cur = rawMap.get(text);
      if (cur) bumpSource(cur, src.id);
      else rawMap.set(text, new Set([src.id]));
    }
  }

  const blockUnique = blockMap.size;
  const allowUnique = allowMap.size;
  const rawUnique = rawMap.size;

  // 只有普通屏蔽规则可被父域覆盖；$important 规则优先级高于 @@ 例外，
  // 一旦剔除会改变实际拦截行为，因此始终原样保留
  const subsumeCandidates = [];
  const importantDomains = [];
  for (const [domain, meta] of blockMap) {
    if (meta.important) importantDomains.push(domain);
    else subsumeCandidates.push(domain);
  }
  const { keep, removed } = subsumeByParent(subsumeCandidates);

  const finalBlock = [
    ...keep.map((d) => ({ domain: d, important: false })),
    ...importantDomains.map((d) => ({ domain: d, important: true })),
  ];

  // 排序保证同内容生成同结果，避免无谓的 diff
  finalBlock.sort((a, b) => (a.domain < b.domain ? -1 : a.domain > b.domain ? 1 : 0));

  const finalAllow = [...allowMap.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
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

  // 同一域名既屏蔽又放行，AdGuard Home 以 @@ 为准
  const conflicts = finalAllow.filter((d) => blockMap.has(d));

  const after = finalBlock.length + finalAllow.length + finalRaw.length;

  return {
    block: finalBlock,
    allow: finalAllow,
    raw: finalRaw,
    sources: sources.map((s) => ({
      id: s.id,
      name: s.name,
      url: s.url,
      homepage: s.homepage,
      totalLines: s.parsed.totalLines,
      effective: s.parsed.effective,
      block: s.parsed.block.length,
      allow: s.parsed.allow.length,
      raw: s.parsed.raw.length,
      skipped: s.parsed.skipped,
    })),
    stats: {
      before,
      after,
      blockUnique,
      allowUnique,
      rawUnique,
      subsumeRemoved: removed.length,
      rawCovered,
      subsumeSample: removed.slice(0, 5),
      conflicts: conflicts.length,
    },
  };
}
