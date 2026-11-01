/**
 * 上游抓取：GitHub raw 直连失败时自动切换公共加速镜像
 * 软路由与国内网络普遍无法直连 raw.githubusercontent.com，因此镜像回退是必需能力
 */

const RAW_GITHUB_RE =
  /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/;

// jsDelivr 的 GitHub 通道：cdn / fastly / gcore 三个 CDN 入口共用同一套路径格式
const JSDELIVR_GH_RE =
  /^https:\/\/(?:cdn|fastly|gcore)\.jsdelivr\.net\/gh\/([^/]+)\/([^/]+)@([^/]+)\/(.+)$/;

const JSDELIVR_HOSTS = [
  'https://cdn.jsdelivr.net/gh',
  'https://fastly.jsdelivr.net/gh',
  'https://gcore.jsdelivr.net/gh',
];

const GH_PROXIES = ['https://ghfast.top/', 'https://gh-proxy.com/', 'https://ghproxy.net/'];

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 adguard-merged-rules/1.0';

const MIN_BYTES = 256;

const HTML_RE = /<!doctype\s+html|<html[\s>]|<head[\s>]/i;

// 纯域名行（`ads.example.com`），不带 `||` 前缀的列表格式。
// parser 支持这种写法，体检也必须认得，否则合法的纯域名列表会被判成错误页。
const BARE_DOMAIN_RE = /^[a-z0-9_*-]+(?:\.[a-z0-9_*-]+)*\.[a-z][a-z0-9-]{1,62}$/i;

/**
 * 为一个 URL 生成候选访问地址（首项为原始地址）
 *
 * 只有 GitHub 上的内容才存在反代/镜像；给 adrules.top / anti-ad.net 这类域名前面
 * 拼 ghfast.top 只会拿到 404，纯属浪费一轮超时等待，因此不生成。
 */
export function buildCandidates(url) {
  const list = [url];

  const raw = RAW_GITHUB_RE.exec(url);
  if (raw) {
    const [, owner, repo, branch, filePath] = raw;
    for (const p of GH_PROXIES) list.push(`${p}${url}`);
    list.push(`https://raw.gitmirror.com/${owner}/${repo}/${branch}/${filePath}`);
    for (const host of JSDELIVR_HOSTS) list.push(`${host}/${owner}/${repo}@${branch}/${filePath}`);
    return [...new Set(list)];
  }

  // jsDelivr 的 gh 通道同样是「一个地址、多个入口」：cdn.jsdelivr.net 区域性故障时
  // fastly / gcore 通常还活着，三个都挂再回退到 GitHub raw。
  // `@latest` 是 jsDelivr 自己的版本别名，raw 不认识，必须先换成 HEAD
  // （raw 会把 HEAD 解析成默认分支的最新提交）。
  const jd = JSDELIVR_GH_RE.exec(url);
  if (jd) {
    const [, owner, repo, ref, filePath] = jd;
    for (const host of JSDELIVR_HOSTS) list.push(`${host}/${owner}/${repo}@${ref}/${filePath}`);
    const rawRef = ref === 'latest' ? 'HEAD' : ref;
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${rawRef}/${filePath}`;
    list.push(rawUrl);
    for (const p of GH_PROXIES) list.push(`${p}${rawUrl}`);
  }

  return [...new Set(list)];
}

/**
 * 内容体检：确认拿到的是规则文本，而不是错误页 / 限流页 / 被截断的半截文件。
 *
 * 这是防线里最关键的一环 —— 镜像挂掉时经常返回 200 + 一张 HTML 错误页，
 * 只看字节数会把它当成抓取成功，最终发布一份悄悄少掉十几万条规则的列表。
 *
 * 只扫前 64KB / 前 400 行，判断格式足够，又不拖慢解析。
 */
export function looksLikeRuleList(text) {
  if (!text || text.length < MIN_BYTES) return false;

  const head = text.slice(0, 65536);
  if (HTML_RE.test(head)) return false;

  let hits = 0;
  let counted = 0;
  for (const raw of head.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    counted += 1;
    if (
      line.startsWith('||') ||
      line.startsWith('@@') ||
      line.startsWith('!') ||
      line.startsWith('#') ||
      line.startsWith('0.0.0.0 ') ||
      line.startsWith('127.0.0.1 ') ||
      line.startsWith('::1 ') ||
      (line.length <= 253 && BARE_DOMAIN_RE.test(line))
    ) {
      hits += 1;
    }
    if (counted >= 400) break;
  }

  return hits >= 10;
}

async function tryFetch(url, timeoutMs, deadline) {
  const budget = Math.max(1000, Math.min(timeoutMs, deadline - Date.now()));
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(budget),
    headers: { 'User-Agent': UA, Accept: 'text/plain,*/*' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const text = await res.text();
  if (!text || text.length < MIN_BYTES) throw new Error(`响应过短 (${text.length} 字节)`);
  if (!looksLikeRuleList(text)) {
    throw new Error('响应不是规则文本（疑似错误页 / 限流页 / 被截断）');
  }
  return text;
}

/**
 * 抓取文本，按候选顺序逐个尝试
 *
 * deadline 是全局预算的绝对时间戳：一旦超出，无论还剩多少候选都立刻放弃，
 * 避免「9 个候选 × 3 轮 × 45 秒超时」把 GitHub Actions 的 job 时间跑穿。
 *
 * @returns {Promise<{text:string, via:string, attempts:Array<{url:string,error:string}>}>}
 */
export async function fetchText(
  url,
  { timeoutMs = 45000, retries = 1, deadline = Date.now() + 15 * 60 * 1000, budgetScope = '全局' } = {}
) {
  const candidates = buildCandidates(url);
  const attempts = [];

  for (let round = 0; round <= retries; round += 1) {
    for (const candidate of candidates) {
      if (Date.now() >= deadline) {
        const last = attempts[attempts.length - 1];
        throw new Error(`已超${budgetScope}抓取预算（最后一次失败: ${last ? last.error : '无'}）`);
      }
      try {
        const text = await tryFetch(candidate, timeoutMs, deadline);
        return { text, via: candidate, attempts };
      } catch (err) {
        const msg =
          err?.name === 'TimeoutError' ? `超时 ${timeoutMs}ms` : err?.message || String(err);
        attempts.push({ url: candidate, error: msg });
      }
    }
  }

  const detail = attempts
    .slice(-3)
    .map((a) => `${a.url} -> ${a.error}`)
    .join('; ');
  throw new Error(`全部候选地址均失败: ${detail}`);
}

/**
 * 有限并发执行
 */
export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}
