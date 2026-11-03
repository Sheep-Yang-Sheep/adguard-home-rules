/**
 * Cloudflare Worker：为 adguard-home-rules 提供可靠的外部定时触发
 *
 * 为什么需要它：GitHub 自己的 schedule 是 best-effort。实测本仓库 40 小时里
 * 应触发约 30 次、实际只跑了 2 次（约 7%），"每 4 小时更新"靠它兑现不了。
 * Cloudflare 的 Cron Triggers 走的是独立调度器，稳定得多。
 *
 * 设计要点：
 *   - 每小时唤醒一次，只有「仓库超过 STALE_HOURS 没有新提交」时才真正派发，
 *     因此不会和 GitHub 自己的 schedule 打架、也不会产生垃圾提交。
 *   - 派发走 repository_dispatch，不占用 workflow_dispatch 的手工入口。
 *   - client_payload.force 用于兜底「缺源不发布」闸门：某个上游确认永久下线、
 *     但还没来得及从 sources.json 删掉时，访问 /?token=xxx&force=1 先强制发一版，
 *     不用登录 GitHub 点按钮。
 */

const DEFAULT_EVENT = 'update-rules';

export default {
  /** Cron 触发：只在数据陈旧时派发 */
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(run(env, { reason: 'cron' }));
  },

  /** HTTP 触发：/health 探活；/status 看陈旧情况；/?token=xxx[&force=1] 手动派发 */
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') return json({ ok: true });

    const authorized = !env.TRIGGER_SECRET || url.searchParams.get('token') === env.TRIGGER_SECRET;
    if (!authorized) return json({ error: 'forbidden' }, 403);

    if (url.pathname === '/status') return json(await status(env));

    if (url.pathname === '/' || url.pathname === '/trigger') {
      const force = url.searchParams.get('force') === '1';
      const result = await dispatch(env, force, 'http');
      return json(result, result.ok ? 200 : 502);
    }

    return json({ error: 'not found' }, 404);
  },
};

/** Cron 路径：先判断是否真的陈旧，再决定要不要派发 */
async function run(env, { reason }) {
  const st = await status(env);
  if (st.stale === false) {
    console.log(`[skip] 上次提交 ${st.lastCommitAt}，距今 ${st.ageHours}h < ${st.staleHours}h`);
    return { ok: true, skipped: true, ...st };
  }
  const result = await dispatch(env, false, reason);
  console.log(`[dispatch] no=${result.status} ${result.detail || ''}`);
  return result;
}

/** 查仓库最后一次提交时间，判断数据是否陈旧 */
async function status(env) {
  const staleHours = Number(env.STALE_HOURS || 3);
  const res = await fetch(`https://api.github.com/repos/${env.REPO}/commits?per_page=1`, {
    headers: headers(env),
  });

  if (!res.ok) {
    return { ok: false, stale: true, staleHours, error: `查询提交失败 HTTP ${res.status}` };
  }

  const list = await res.json();
  const last = Array.isArray(list) && list[0] ? list[0] : null;
  const at = last?.commit?.committer?.date || null;
  const ageHours = at ? (Date.now() - new Date(at).getTime()) / 3600000 : Infinity;

  return {
    ok: true,
    repo: env.REPO,
    lastCommitAt: at,
    lastCommitHash: last?.sha?.slice(0, 7) || null,
    lastCommitMessage: last?.commit?.message?.split('\n')[0] || null,
    ageHours: Number.isFinite(ageHours) ? Number(ageHours.toFixed(1)) : null,
    staleHours,
    stale: ageHours >= staleHours,
  };
}

/** 打 repository_dispatch 接口 */
async function dispatch(env, force, reason) {
  if (!env.GITHUB_TOKEN) return { ok: false, error: 'GITHUB_TOKEN 未配置' };
  if (!env.REPO) return { ok: false, error: 'REPO 未配置' };

  const res = await fetch(`https://api.github.com/repos/${env.REPO}/dispatches`, {
    method: 'POST',
    headers: { ...headers(env), 'content-type': 'application/json' },
    body: JSON.stringify({
      event_type: env.EVENT_TYPE || DEFAULT_EVENT,
      client_payload: { force: force ? 'true' : 'false', reason, source: 'cloudflare-cron' },
    }),
  });

  // 成功时是 204 No Content，没有响应体
  const detail = (await res.text()).slice(0, 300);
  return {
    ok: res.ok,
    status: res.status,
    force,
    reason,
    dispatchedAt: new Date().toISOString(),
    detail: detail || undefined,
  };
}

function headers(env) {
  return {
    authorization: `Bearer ${env.GITHUB_TOKEN}`,
    accept: 'application/vnd.github+json',
    'user-agent': 'adguard-rules-cron/1.0',
  };
}

function json(obj, status = 200) {
  return new Response(`${JSON.stringify(obj, null, 2)}\n`, {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
