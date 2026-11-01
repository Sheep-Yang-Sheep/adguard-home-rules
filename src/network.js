/**
 * 上游抓取：GitHub raw 直连失败时自动切换公共加速镜像
 * 软路由与国内网络普遍无法直连 raw.githubusercontent.com，因此镜像回退是必需能力
 */

const RAW_GITHUB_RE =
  /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/;

const GH_PROXIES = ['https://ghfast.top/', 'https://gh-proxy.com/', 'https://ghproxy.net/'];

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 adguard-merged-rules/1.0';

/**
 * 为一个 URL 生成候选访问地址（首项为原始地址）
 */
export function buildCandidates(url) {
  const list = [url];
  const m = RAW_GITHUB_RE.exec(url);

  if (m) {
    const [, owner, repo, branch, path] = m;
    for (const p of GH_PROXIES) list.push(`${p}${url}`);
    list.push(`https://raw.gitmirror.com/${owner}/${repo}/${branch}/${path}`);
    list.push(`https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${path}`);
    list.push(`https://fastly.jsdelivr.net/gh/${owner}/${repo}@${branch}/${path}`);
    list.push(`https://gcore.jsdelivr.net/gh/${owner}/${repo}@${branch}/${path}`);
  } else {
    list.push(`https://ghfast.top/${url}`);
  }

  return [...new Set(list)];
}

async function tryFetch(url, timeoutMs) {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'User-Agent': UA, Accept: 'text/plain,*/*' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (!text || text.length < 64) throw new Error(`响应过短 (${text.length} 字节)`);
  return text;
}

/**
 * 抓取文本，按候选顺序逐个尝试
 * @returns {Promise<{text:string, via:string, attempts:Array<{url:string,error:string}>}>}
 */
export async function fetchText(url, { timeoutMs = 45000, retries = 2 } = {}) {
  const candidates = buildCandidates(url);
  const attempts = [];

  for (let round = 0; round <= retries; round += 1) {
    for (const candidate of candidates) {
      try {
        const text = await tryFetch(candidate, timeoutMs);
        return { text, via: candidate, attempts };
      } catch (err) {
        const msg = err?.name === 'TimeoutError' ? `超时 ${timeoutMs}ms` : err?.message || String(err);
        attempts.push({ url: candidate, error: msg });
      }
    }
  }

  const detail = attempts.slice(-3).map((a) => `${a.url} -> ${a.error}`).join('; ');
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
