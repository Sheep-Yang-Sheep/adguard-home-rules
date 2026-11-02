# AdGuard Home 合并规则合集

把 7 个独立上游（8 个订阅地址）的广告 / 追踪域名规则，合并成**一个** `.txt` 文件，每 **4 小时**自动更新一次，软路由只需订阅一条链接。

规则主体全部来自各上游作者，本仓库只做抓取、去重、父子域收敛与格式化，不做人工增删。

---

## 一、订阅链接（AdGuard Home 直接用）

> 软路由 / 国内网络无法直连 `raw.githubusercontent.com`，**请优先使用加速链接**。

| 通道 | 订阅地址 | 说明 |
| --- | --- | --- |
| GitHub 直连 | `https://raw.githubusercontent.com/Sheep-Yang-Sheep/adguard-home-rules/main/dist/adguard-home-rules.txt` | 境外网络或代理环境 |
| ghfast.top | `https://ghfast.top/https://raw.githubusercontent.com/Sheep-Yang-Sheep/adguard-home-rules/main/dist/adguard-home-rules.txt` | 国内可用，推荐 |
| gh-proxy.com | `https://gh-proxy.com/https://raw.githubusercontent.com/Sheep-Yang-Sheep/adguard-home-rules/main/dist/adguard-home-rules.txt` | 国内可用，备用 |
| ghproxy.net | `https://ghproxy.net/https://raw.githubusercontent.com/Sheep-Yang-Sheep/adguard-home-rules/main/dist/adguard-home-rules.txt` | 国内可用，备用 |
| jsDelivr CDN | `https://cdn.jsdelivr.net/gh/Sheep-Yang-Sheep/adguard-home-rules@main/dist/adguard-home-rules.txt` | CDN 有缓存，更新略有延迟 |

推荐填这一条（ghfast.top 加速）：

```
https://ghfast.top/https://raw.githubusercontent.com/Sheep-Yang-Sheep/adguard-home-rules/main/dist/adguard-home-rules.txt
```

> 加速通道的可用性随网络环境变化，同一时间不同运营商的结果可能不同。若这条打不开，
> 把前缀换成 `https://gh-proxy.com/`、`https://ghproxy.net/` 或
> `https://fastly.jsdelivr.net/gh/<owner>/<repo>@main/<文件路径>` 任选其一即可，后面的路径不用改。

### 在 AdGuard Home 中添加

1. 打开 AdGuard Home 管理面板 → **过滤器** → **DNS 黑名单**
2. 点击 **添加黑名单** → **添加自定义列表**
3. 名称填 `合并规则合集`，URL 填上面的订阅地址
4. 保存后点该列表旁的 **∨** → **立即更新**，等待规则加载完毕

建议同时把「过滤器更新间隔」设为 **12 小时**（默认是 24 小时），与上游 4 小时更新节奏匹配。

---

## 二、当前状态

- **本合集更新时间（北京时间）**：`2026-11-03 00:34` 周二
- **上次自动任务运行时间（北京时间）**：`2026-11-03 00:41`

| 指标 | 数值 |
| --- | --- |
| 合并前规则数（各上游合计，含重复） | 822,653 |
| 去重后规则数 | 365,337 |
| 被父域规则覆盖而移除的冗余规则 | 13,585 |
| **合并后规则数** | **351,752** |
| └ 屏蔽规则 | 351,102 |
| └ 白名单例外 `@@` | 243 |
| └ 通配 / 特殊规则 | 407 |
| 被白名单架空的屏蔽规则（不生效） | 4 |
| 同域既屏蔽又放行（按 `@@` 生效） | 29 |
| └ 其中 `$important` 会压过 `@@` | 0 |
| **实际不生效的屏蔽规则合计** | **33** |
| 解析阶段丢弃的行（DNS 层无效） | 153 |

> 「本合集更新时间」只在规则内容真的发生变化时才刷新，「上次任务运行时间」由定时任务刷新，可据此判断自动任务是否正常。
> 若「上次任务运行时间」超过 **12 小时**没动，说明自动任务真的停摆了，请到 Actions 页面查看失败原因。
> GitHub 自带的 `schedule` 只是 best-effort，丢单并不罕见，本仓库因此挂了两条错开的定时 + 提供外部触发兜底，原因和补救办法见[第六节](#六常见问题)。


---

## 三、上游订阅源

| # | 源 | 订阅地址 | 本次有效规则 |
| --- | --- | --- | --- |
| 1 | 秋风 AWAvenue Ads Rule | https://raw.githubusercontent.com/TG-Twilight/AWAvenue-Ads-Rule/main/AWAvenue-Ads-Rule.txt | 972 |
| 2 | QY Ads Rule | https://raw.githubusercontent.com/rssvcn/qy-Ads-Rule/main/black.txt | 566 |
| 3 | adrules 国内规则（主站） | https://adrules.top/dns.txt | 206,610 |
| 4 | 217heidai 广告过滤合并规则 | https://raw.githubusercontent.com/217heidai/adblockfilters/main/rules/adblockdns.txt | 241,854 |
| 5 | HaGeZi Multi PRO | https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/adblock/pro.txt | 211,778 |
| 6 | anti-AD | https://anti-ad.net/adguard.txt | 101,225 |
| 7 | AdRules（Cats-Team 备份） <sub>镜像</sub> | https://raw.githubusercontent.com/Cats-Team/AdRules/main/dns.txt | 206,610 |
| 8 | OISD Small | https://small.oisd.nl/ | 59,648 |

各源版权归原作者所有，请遵守各自的使用条款。

---

## 四、合并规则说明

每 4 小时由 GitHub Actions 自动执行一次：

1. **抓取**：并发拉取全部上游源，GitHub raw 直连失败时自动回退到 `ghfast.top` / `gh-proxy.com` / `ghproxy.net` / `gitmirror` / `jsDelivr` 等镜像。
   - 以 `cdn.jsdelivr.net` 地址订阅的源（如 HaGeZi），会依次尝试 `fastly` / `gcore` 两个备用 CDN，全挂再回退到 GitHub raw，不押在单一入口上
   - 每份响应都会做内容体检：HTML 错误页、限流页、被截断的半截文件一律判为失败，不会混进合并结果
   - 单源规则数若比上一轮骤降超过 50%，同样判为失败（防止上游故障时悄悄少掉十几万条）
   - 只有低于 **75% 的独立上游**成功时才放弃发布；同一上游的多个镜像地址不会重复扣分
2. **归一化**：统一转成 AdGuard Home 的 DNS 过滤语法 `||domain^`。
   - `0.0.0.0 domain` 等 hosts 写法 → `||domain^`（行尾 `#` 注释会被剥掉）
   - `||*.example.com^` → `||example.com^`（`||` 本身已覆盖全部子域）
   - 中文域名自动转 punycode
   - 剔除元素隐藏规则（`##`）、URL 路径规则与正则规则，这些在 DNS 过滤中不会生效，留着只会拖慢匹配
   - `$third-party`、`$~first-party`、`$app=` 这类**只描述请求上下文**的修饰符会被剥掉、域名规则保留 —— DNS 过滤不区分 referrer 与 App，留着修饰符没有任何意义，但为了它丢掉整条规则就太亏了
   - `$popup`、`$document`、`$domain=`、`$removeparam` 这类会改变「对哪个域名、做哪种处理」的修饰符无法降级，带它们的整条规则会被丢弃（剥掉会把「限站点放行 / 只去参数」变成「全站硬屏蔽」）
   - `$important`、`$badfilter`、`$client`、`$denyallow` 等有效修饰符原样保留
3. **跨源去重**：8 个地址互相重叠极高，按域名去重，同一域名保留最强的那条（有 `$important` 的优先）。
   - 内容完全相同的镜像地址（同一份规则的两个入口）只计一次，不会让「合并前规则数」虚高
4. **父子域收敛**：若 `||a.com^` 已被屏蔽，则 `||b.a.com^`、`||c.b.a.com^` 这类子域规则属于冗余（`||a.com^` 已覆盖全部子域），直接剔除。这一步通常能砍掉 3%～8% 的冗余条目。
   - 白名单例外 `@@` **只去重、不收敛**，避免误放行
   - 带 `$important` 的规则不参与剔除（它优先级高于 `@@`，删掉会改变实际拦截行为）
   - `co.uk`、`com.cn`、`github.io` 这类 **共享后缀**不充当收敛父域：一条 `||co.uk^` 就能把几万条子域规则一次删光，拦截效果虽然不变，但规则数会瞬间塌陷、误触发 20% 熔断导致整轮停更
5. **输出**：按字母序排序后写出，保证同样内容生成同样的文件，`git diff` 只反映真实变化。
   - 写文件之前先做一次全量自检：35 万条输出行必须逐条都是 AdGuard Home 认得的规则，任何一行不合规就整轮失败、不写文件，宁可不更新也不推一份加载不了的黑名单

---

## 五、已知取舍（务必了解）

**合并别人的白名单是有代价的。** 某个上游为了让被误杀的网站恢复访问，会加一条 `@@||example.com^`；这条例外在你本地会把**所有**其它上游对这个域名的拦截一并取消，包括子域。这是任何「多源合并」方案都无法回避的问题，本项目的处理方式是：

- 例外规则只去重、不做父子域收敛，尽量缩小影响面
- 每次运行都把「被白名单架空的屏蔽规则」数量统计出来，写在上面表格和规则文件的头部注释里
- 「实际不生效的屏蔽规则合计」= 父域架空 + 同域被 `@@` 压过 - `$important` 压制，这个数才是真正白干的行数
- 如果这个数字大到你不能接受，可以在 `sources.json` 里删掉带来例外的那个源，再重新运行

**`$important` 与 `@@` 的优先级。** 带 `$important` 的屏蔽规则优先级高于白名单例外，因此这类域名即使有条目放行也仍会被拦截。数量同样在上面表格里统计。

---

## 六、常见问题

**Q：为什么订阅链接偶尔更新滞后？**
jsDelivr 通道有 CDN 缓存，可能延迟数小时。要即时更新请用 ghfast.top / gh-proxy.com 通道。

**Q：规则数量比上游加起来少很多，是不是漏了？**
不是。8 个地址高度重叠，去重 + 父子域收敛后留存的都是有效规则，拦截效果不变而查询性能更好。少掉多少、为什么少，规则文件头部注释里都有明细。

**Q：软路由性能吃紧怎么办？**
本项目已剔除全部正则规则，仅保留域名级规则，x86 软路由跑 30 万条域名规则几乎没有额外开销。若内存很紧张，可在 `sources.json` 的 `sources` 数组里删掉 `hagezi` / `oisd` 后重新运行。

**Q：自动任务一直失败，提示"比上轮少 20% 以上，拒绝发布"怎么办？**
这是熔断保护：上游规则突然少了两成以上时宁可不发，避免把残缺规则推给软路由。若确认是上游**合法瘦身**（或某个大源永久下线导致总量下降），到 Actions 页面手动 **Run workflow** 并勾选 `force`，跑一次即可把基线重置到新水位，之后定时任务恢复正常。

**Q：说好每 4 小时更新，为什么「上次任务运行时间」停了好几个小时？**
不是你这边的问题，是 GitHub 的定时任务丢了。`schedule` 只是 best-effort：高峰期会延迟，负载高时还会**整次丢弃**——连一条失败的运行记录都不会留下。

本仓库的实测数据（2026-11-01 07:02 → 2026-11-02 14:40，约 32 小时）：

| 按 cron 应触发 | 实际触发 | 触达率 |
| --- | --- | --- |
| 约 30 次 | 2 次 | **~7%** |

工作流本身没问题（状态 `active`、每次运行都是 success），丢的是**调度**。所谓「两条交错 cron = 18 次/天」在纸面上成立，实际兑现不了。

**能真正解决的办法只有换触发源**：把任务交给不经过 GitHub 调度器的定时器。本仓库已经放好现成实现——[`ops/cron-trigger`](ops/cron-trigger/README.md)，Cloudflare Worker + Cron Trigger，每小时检查一次，仓库超过 3 小时没提交就自动 dispatch 一次，免费额度内、不用服务器。照着那个 README 走三步（建 fine-grained token → `wrangler deploy` → 验证）就能做到真正的每 4 小时。

不想上 Cloudflare 的话，任何能发 HTTP 请求的定时服务都等价，打这一条就行（需要 Contents: Read and write 权限，classic 令牌勾 `repo`）：

```bash
curl -X POST \
  -H "Authorization: Bearer <token>" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/Sheep-Yang-Sheep/adguard-home-rules/dispatches \
  -d '{"event_type":"update-rules","client_payload":{"force":"false"}}'
```

`cron-job.org`（网页点点就行）、自己的 VPS / NAS 都可以，注意设备要能直连 `api.github.com`。

**Q：想增删订阅源？**
编辑 `sources.json` 的 `sources` 数组，提交后会自动触发一次合并。同一份内容的多个入口可以并存，用 `upstream` 字段标记为同一个上游即可（互为备份、不重复计数）。

---

## 七、本地运行

```bash
# 需要 Node.js >= 20，无第三方依赖，不需要 npm install
npm test                                  # 单元测试
node src/index.js                         # 在线抓取并合并（会写 dist / README / status）
node src/index.js --dry-run               # 只跑不写文件
npm run cache                             # 抓一次并把各源原文存到 .cache/（不写 dist）
npm run build:offline                     # 断网复盘：只用 .cache/ 里的原文重新生成
```

`--cache=DIR` 保存的是**本轮实际拿到的原文**（可能来自镜像），因此离线复盘出来的结果
与在线运行逐字节一致，适合排查「同样的输入为什么输出变了」。

---

<sub>本仓库由 GitHub Actions 自动维护，请勿直接编辑 `dist/` 与 `README.md` 中的统计区块，下次运行会被覆盖。</sub>
