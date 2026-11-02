/**
 * Worker 触发逻辑的离线测试：用假 fetch 替掉真实网络，不需要部署就能跑。
 *   node scripts/cloudflare-worker/test.mjs
 */
const { default: worker } = await import('./worker.js');

const realFetch = globalThis.fetch;
const stub = (fn) => { globalThis.fetch = fn; };
const ok204 = () => new Response(null, { status: 204 }); // 204 不能带 body，否则构造即抛错
const req = (path, method = 'POST') => ({ url: `https://worker.dev${path}`, method });

async function call(path, env, method) {
  const res = await worker.fetch(req(path, method), env);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { status: res.status, body };
}

let pass = 0;
let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) {
    pass += 1;
    console.log('  ok   ', name);
  } else {
    fail += 1;
    console.log('  FAIL ', name, '->', extra);
  }
};

console.log('1) 路由与鉴权');
stub(ok204);
check('未知路径 404', (await call('/nope', { GH_TOKEN: 't', TRIGGER_KEY: 'k' })).status === 404);
check('未配 TRIGGER_KEY 时 403', (await call('/trigger', { GH_TOKEN: 't' })).status === 403);
check('key 错误 401', (await call('/trigger?key=bad', { GH_TOKEN: 't', TRIGGER_KEY: 'k' })).status === 401);

console.log('2) 正常触发');
let seen = {};
stub(async (url, init) => {
  seen = { url, body: init.body, auth: init.headers.Authorization };
  return ok204();
});
let r = await call('/trigger?key=k', { GH_TOKEN: 'secret-token', TRIGGER_KEY: 'k' });
check('204 -> 200 ok', r.status === 200 && r.body.ok === true, JSON.stringify(r.body));
check(
  '打到正确端点',
  seen.url === 'https://api.github.com/repos/Sheep-Yang-Sheep/adguard-home-rules/dispatches',
  seen.url
);
check('body 带 event_type', JSON.parse(seen.body).event_type === 'update-rules', seen.body);
check('带 Bearer 头', seen.auth === 'Bearer secret-token', seen.auth);

console.log('3) 令牌无效：4xx 不重试');
let hits = 0;
stub(async () => { hits += 1; return new Response('{"message":"Bad credentials"}', { status: 401 }); });
r = await call('/trigger?key=k', { GH_TOKEN: 'bad', TRIGGER_KEY: 'k' });
check('401 -> 502 且只请求 1 次', r.status === 502 && hits === 1, `status=${r.status} hits=${hits}`);
check('错误信息透出', /401/.test(r.body.message), r.body.message);

console.log('4) 服务端 5xx 会退避重试');
hits = 0;
stub(async () => {
  hits += 1;
  return hits < 3 ? new Response('oops', { status: 502 }) : ok204();
});
r = await call('/trigger?key=k', { GH_TOKEN: 't', TRIGGER_KEY: 'k' });
check('第 3 次成功 -> 200', r.status === 200 && hits === 3, `status=${r.status} hits=${hits}`);

console.log('5) 缺 GH_TOKEN');
stub(ok204);
r = await call('/trigger?key=k', { TRIGGER_KEY: 'k' });
check('直接报配置错误', r.status === 502 && /GH_TOKEN/.test(r.body.message), JSON.stringify(r.body));

console.log('6) 定时入口');
const pending = [];
worker.scheduled({ cron: '23 */4 * * *' }, { GH_TOKEN: 't' }, { waitUntil: (p) => pending.push(p) });
check('通过 waitUntil 派发', pending.length === 1, `pending=${pending.length}`);
await Promise.all(pending);

globalThis.fetch = realFetch;
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
