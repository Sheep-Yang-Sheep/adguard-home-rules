/**
 * AdGuard Home 合并规则 · 外部定时触发器（Cloudflare Worker）
 *
 * 为什么需要它：GitHub Actions 的 schedule 只是 best-effort，高峰期会延迟，
 * 负载高时还会整次丢弃 —— 连一条失败的运行记录都不会留下。本仓库实测建仓头 20
 * 小时里 5 个定时点只跑起来 1 次。仓库里的双 cron 只能提高概率，真正的确定性来自
 * 「不经过 GitHub 调度器」的触发：这个 Worker 由 Cloudflare 的 cron 驱动，到点直接
 * 打 repository_dispatch 接口。
 *
 * 部署见同目录 README.md。只需两个密钥：
 *   GH_TOKEN    —— 对该仓库有写权限的 PAT（classic + repo scope 已实测可用）
 *   TRIGGER_KEY —— 手动触发口令，可留空（留空则只保留定时触发，不开放 HTTP 入口）
 */

const REPO = 'Sheep-Yang-Sheep/adguard-home-rules';
const EVENT_TYPE = 'update-rules';
const ENDPOINT = `https://api.github.com/repos/${REPO}/dispatches`;

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 触发一次 repository_dispatch。
 * 204 = 已受理；401/403 = 令牌无效或权限不够；404 = 仓库名写错或令牌看不到该仓库。
 */
async function dispatch(env, source) {
  if (!env.GH_TOKEN) {
    return { ok: false, status: 0, message: '未配置 GH_TOKEN，请执行 wrangler secret put GH_TOKEN' };
  }

  let lastError = '未知错误';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.GH_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
          // GitHub 要求带 UA，Workers 默认的 UA 有时会被拒
          'User-Agent': 'adguard-home-rules-trigger',
        },
        body: JSON.stringify({ event_type: EVENT_TYPE }),
      });

      if (res.status === 204) {
        console.log(`[${source}] 触发成功（第 ${attempt} 次尝试）`);
        return { ok: true, status: 204, message: '已受理，GitHub Actions 开始排队' };
      }

      const body = (await res.text()).slice(0, 300);
      lastError = `HTTP ${res.status}: ${body}`;

      // 4xx 是配置问题，重试没有意义，直接返回
      if (res.status < 500) {
        console.error(`[${source}] 触发失败（不可重试）${lastError}`);
        return { ok: false, status: res.status, message: lastError };
      }
      console.warn(`[${source}] 第 ${attempt} 次失败（服务端错误），准备重试：${lastError}`);
    } catch (err) {
      lastError = err?.message || String(err);
      console.warn(`[${source}] 第 ${attempt} 次请求异常：${lastError}`);
    }

    if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAY_MS * attempt);
  }

  console.error(`[${source}] 重试 ${MAX_ATTEMPTS} 次仍失败：${lastError}`);
  return { ok: false, status: 0, message: lastError };
}

/** 定时触发入口：由 Cloudflare cron 调用 */
async function handleScheduled(controller, env, ctx) {
  const source = `cron ${controller.cron || 'unknown'}`;
  ctx.waitUntil(
    dispatch(env, source).then((r) => {
      // 失败也要留痕，可在 Workers 面板的 Logs / tail 里看到
      console.log(JSON.stringify({ source, ...r, at: new Date().toISOString() }));
    })
  );
}

/** HTTP 入口：手动补触发，需要 ?key=<TRIGGER_KEY> */
async function handleFetch(request, env) {
  const url = new URL(request.url);

  if (url.pathname !== '/trigger') {
    return new Response('Not Found\n用法: POST /trigger?key=<TRIGGER_KEY>', { status: 404 });
  }
  if (request.method !== 'POST' && request.method !== 'GET') {
    return new Response('Method Not Allowed\n', { status: 405 });
  }

  // 没配 TRIGGER_KEY 就等于不开放手动入口，避免任何人都能刷你的 Actions 额度
  if (!env.TRIGGER_KEY) {
    return Response.json({ ok: false, message: '未配置 TRIGGER_KEY，手动触发已关闭' }, { status: 403 });
  }
  if (url.searchParams.get('key') !== env.TRIGGER_KEY) {
    return Response.json({ ok: false, message: 'key 不正确' }, { status: 401 });
  }

  const result = await dispatch(env, 'manual');
  return Response.json({ ...result, at: new Date().toISOString() }, { status: result.ok ? 200 : 502 });
}

export default {
  scheduled: handleScheduled,
  fetch: handleFetch,
};
