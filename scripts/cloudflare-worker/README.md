# 外部定时触发（Cloudflare Worker）

给主仓库的自动合并加一层「不依赖 GitHub 调度器」的触发。

## 为什么需要

GitHub Actions 的 `schedule` 是 best-effort：高峰期会延迟，负载高时会**整次丢弃**——连一条失败的运行记录都不会留下。本仓库建仓头 20 小时的实测是 **5 个定时点只跑起来 1 次**，其余 4 次在 Actions 里查无此事。

仓库里已经把 cron 加成两条（`:07` 主跑、`:37` 补跑）互为备份，但那只是把概率从 20% 抬到 36%，救不了。真正的确定性来自绕开 GitHub 调度器：由 Cloudflare 的 cron 到点直接打 `repository_dispatch` 接口。

```
Cloudflare cron (:23)  ──POST dispatches──▶  GitHub Actions 立即排队
GitHub cron (:07)      ── 自触发，可能被丢
GitHub cron (:37)      ── 补跑，也可能被丢
```

三条 cron 互不重叠，任意一条活下来更新就不会断。多出来的运行不会制造垃圾提交——工作流里规则没变、且距上次提交不足 2 小时时会跳过心跳提交。

## 部署

### 1. 建令牌

GitHub → Settings → Developer settings → Personal access tokens → **Tokens (classic)** → Generate new token

- Scope 只勾 **`repo`**（本仓库当前用的就是这个组合，已实测能打 `dispatches`）
- 有效期按需，建议 90 天并记好续期

> 用细粒度令牌也行，但需要同时给「Contents: Read and write」；权限组合容易踩坑，只为一个定时器不值得纠结，直接用 classic + `repo`。

### 2. 部署 Worker

```bash
npm install -g wrangler     # 只需一次
cd scripts/cloudflare-worker
wrangler login

wrangler secret put GH_TOKEN       # 粘贴上一步的令牌
wrangler secret put TRIGGER_KEY    # 自定一个口令，用于手动补触发；不想开放就跳过

wrangler deploy
```

部署成功后会看到 cron trigger 已生效（`23 */4 * * *`，UTC）。

### 3. 验证

```bash
curl -X POST "https://<你的-worker>.workers.dev/trigger?key=<TRIGGER_KEY>"
# {"ok":true,"status":204,"message":"已受理，GitHub Actions 开始排队"}
```

然后去仓库 Actions 页面，应该能看到一条 `repository_dispatch` 事件的成功运行。

## 运维

- **本地自测**：`node scripts/cloudflare-worker/test.mjs`（用假 fetch 跑，不需要部署、不碰真实令牌）
- **看日志**：Cloudflare 面板 → Workers → 你的 Worker → Logs，或在本地 `wrangler tail`
- **改频率**：编辑 `wrangler.toml` 的 `crons`，重新 `wrangler deploy`
- **停用**：删掉 `[triggers]` 段再部署，或直接删除 Worker；不会影响仓库本身的定时任务
- **额度**：免费计划每天 10 万次请求。本方案一天只跑 6 次，用不到零头

## 注意

- `GH_TOKEN` 有过期时间的，到期后 Worker 会开始报 `HTTP 401`，记得续期并重新 `wrangler secret put`
- 不要在 `wrangler.toml` 里写密钥；`[vars]` 是明文，会被提交进仓库
