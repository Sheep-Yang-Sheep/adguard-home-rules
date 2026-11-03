/**
 * 发布闸门
 *
 * 规则：**配置里的每一个上游，本轮都必须至少有一个地址抓取成功**，否则整轮放弃、
 * 一个文件都不写。少一个源就等于少了一批拦截规则，静默发布出去用户是看不见的。
 *
 * 为什么按「上游」而不是「地址」判定：`adrules` 与 `cat` 是同一份规则的两个入口，
 * 互为抓取备份。备份地址挂掉但主地址成功时，数据是完整的，没必要整轮罢工 ——
 * 那会让备份设计变成负担。只有同一个上游的所有入口全挂，才算这个源不可用。
 *
 * 增删源不受影响：判定只针对 `sources.json` 里**当前配置**的上游。
 * 删掉一个源 → 它不在 totalUpstreams 里，不参与判定；新增一个源 → 它必须能连上，
 * 否则本轮不发布（这正是本闸门要的效果）。两种情况都不会「因为数量变化而卡死」。
 *
 * @param {object} opts
 * @param {Iterable<string>} opts.totalUpstreams 配置里的全部上游
 * @param {Iterable<string>} opts.okUpstreams 本轮至少有一个地址成功的上游
 * @param {boolean} [opts.force] 救急开关：确认某个源已永久下线、就是要先发一版时置 true
 * @returns {{abort:boolean, missing:string[], forced:boolean}}
 */
export function evaluateSourceGate({ totalUpstreams, okUpstreams, force = false }) {
  const ok = new Set(okUpstreams);
  const missing = [...new Set(totalUpstreams)].filter((u) => !ok.has(u)).sort();
  if (missing.length === 0) return { abort: false, missing, forced: false };
  return { abort: !force, missing, forced: Boolean(force) };
}

/** 从环境变量读 force（GitHub Actions 的 inputs 传进来是字符串） */
export function forceFromEnv(env = process.env) {
  return /^(1|true|yes|on)$/i.test(String(env.FORCE || '').trim());
}
