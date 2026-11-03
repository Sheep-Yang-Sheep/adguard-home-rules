# 外部定时触发（让「每 4 小时」真的成立）

GitHub 的 `schedule` 是 best-effort，**不能当作 SLA**。本仓库实测数据：

| 时间窗 | 按 cron 应触发 | 实际触发 | 触达率 |
| --- | --- | --- | --- |
| 2026-11-01 07:02 → 2026-11-02 14:40（约 32 小时） | 约 30 次 | 2 次 | **~7%** |

工作流状态正常（`active`）、每次运行都是 success，丢的是**调度**，不是执行。
所以再怎么写 cron 表达式都补不回来，只能换一个不经过 GitHub 调度器的触发源。

本目录的做法：**Cloudflare Worker + Cron Trigger** 每小时检查一次仓库，
只有当仓库超过 3 小时没有新提交时才 `POST /repos/{owner}/{repo}/dispatches`，
把任务重新点起来。这样：

- 不和 GitHub 自己的 schedule 打架（数据是新的就跳过，零成本）
- 不产生垃圾提交（跳过时什么都不做）
- Cloudflare 免费额度足够（每天 24 次唤醒，免费额度 10 万次/天）

---

## 一、准备一个只够用的令牌

**不要用现在这个全权限 PAT。** 新建一个 **fine-grained token**：

1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token
2. Repository access → **Only select repositories** → 只勾 `adguard-home-rules`
3. Permissions → Repository permissions：
   - **Contents: Read and write** ← `repository_dispatch` 需要它
   - 其余全部保持 No access
4. 有效期建议 90 天，到期前换新（换新只需重跑一次 `wrangler secret put`）

> 为什么不要 classic PAT：classic 的 `repo` 权限等于这个账号下**所有**仓库的读写权，
> 而这个令牌要长期放在第三方平台上。

---

## 二、部署 Worker（约 3 分钟）

```bash
npm install -g wrangler        # 只需一次
cd ops/cron-trigger
wrangler login                 # 浏览器里点一下授权

wrangler secret put GITHUB_TOKEN     # 粘贴上一步的 fine-grained token
wrangler secret put TRIGGER_SECRET   # 自己编一个随机串，用于手动触发的鉴权

wrangler deploy
```

部署成功后会打印一个地址，形如 `https://adguard-rules-cron.<你的子域>.workers.dev`。

---

## 三、验证

```bash
BASE=https://adguard-rules-cron.<你的子域>.workers.dev

curl "$BASE/health"                          # {"ok":true}
curl "$BASE/status?token=<TRIGGER_SECRET>"   # 看上次提交距今多久、是否 stale
curl "$BASE/?token=<TRIGGER_SECRET>"         # 立刻派发一次
```

派发成功后，GitHub Actions 页面会在几秒内出现一条 `repository_dispatch` 记录。

**缺源兜底**：发布闸门要求 `sources.json` 里每个上游都能抓取成功，缺一个就整轮不发布。
若某个源已确认永久下线、想先发一版，不用登录 GitHub 点按钮，直接：

```bash
curl "$BASE/?token=<TRIGGER_SECRET>&force=1"
```

这一次会带 `client_payload.force=true` 跳过熔断、把基线重置到新水位。

---

## 四、不想上 Cloudflare 的话

任何「能按点发 HTTP 请求」的服务都行，本质就是这一条请求：

```
POST https://api.github.com/repos/Sheep-Yang-Sheep/adguard-home-rules/dispatches
Authorization: Bearer <fine-grained token>
Accept: application/vnd.github+json
Content-Type: application/json

{"event_type":"update-rules","client_payload":{"force":"false"}}
```

- **cron-job.org**（免费，网页点点就行）：新建 cron job → 每 4 小时 →
  Method `POST` → 上面三个 header + body。
- **自己的 VPS / NAS / 软路由**：`crontab -e` 加一行
  `7 */4 * * * curl -sS -X POST ...`
  注意设备必须能直连 `api.github.com`（国内家宽常常不能，这正是推荐 Cloudflare 的原因）。

---

## 五、成本与副作用

- Cloudflare：免费额度内，24 次唤醒/天 + 每次 1 次 GET + 偶发 1 次 POST。
- 仓库：GitHub 自己的 schedule 与外部触发并存时，最坏情况一小时多跑一两次，
  但**规则没变时不会提交**，只多出一个 20 秒的 job。
- 若连续失败（例如上游长期故障），worker 会每小时重试一次，日志在
  Cloudflare Dashboard → Workers → 该 Worker → Logs 里看。
