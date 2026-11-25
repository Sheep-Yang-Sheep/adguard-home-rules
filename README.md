# AdGuard Home 合并规则合集

把 5 个独立上游（5 个订阅地址）的广告 / 追踪域名规则，合并成**一个** `.txt` 文件，每 **4 小时**自动更新一次，软路由只需订阅一条链接。

规则主体全部来自各上游作者，本仓库只做抓取、去重、父子域收敛与格式化；唯一的人工增删是根目录里的 `allowlist.txt`（强制白名单，见[第五节](#五强制白名单allowlisttxt)）。

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

- **本合集更新时间（北京时间）**：`2026-11-25 08:34` 周三
- **上次自动任务运行时间（北京时间）**：`2026-11-25 08:34`

| 指标 | 数值 |
| --- | --- |
| 合并前规则数（各上游合计，含重复） | 571,360 |
| 去重后规则数 | 304,278 |
| 被父域规则覆盖而移除的冗余规则 | 6,790 |
| **合并后规则数** | **297,376** |
| └ 屏蔽规则 | 296,635 |
| └ 白名单例外 `@@` | 260 |
| └ 通配 / 特殊规则 | 481 |
| 白名单因与黑名单冲突而失效（已剔除） | 141 |
| └ 同域既屏蔽又放行 | 46 |
| └ 白名单位于被屏蔽父域之下 | 89 |
| └ 白名单解开了黑名单里的子域 | 6 |
| 因剔除白名单而恢复生效的屏蔽规则 | 13 |
| **强制白名单条目（`allowlist.txt`）** | **77** |
| └ 其中命中上游屏蔽、已移除对应屏蔽规则 | 46（移除 50 条） |
| **强制黑名单条目（`denylist.txt`）** | **11** |
| └ 其中上游缺失、由人工补进屏蔽区 | 3 |
| └ 上游 App 作用域规则（`$app=`，DNS 层无法表达，已丢弃） | 18 |
| **实际不生效的屏蔽规则合计** | **0** |
| 解析阶段丢弃的行（DNS 层无效） | 6,036 |

> 「本合集更新时间」只在规则内容真的发生变化时才刷新，「上次任务运行时间」由定时任务刷新，可据此判断自动任务是否正常。
> 若「上次任务运行时间」超过 **12 小时**没动，说明自动任务真的停摆了，请到 Actions 页面查看失败原因。
> GitHub 自带的 `schedule` 只是 best-effort，丢单并不罕见，本仓库因此挂了两条错开的定时 + 提供外部触发兜底，原因和补救办法见[第七节](#七常见问题)。


---

## 三、上游订阅源

| # | 源 | 订阅地址 | 本次有效规则 |
| --- | --- | --- | --- |
| 1 | ADgk 手机去广告规则 | https://cdn.jsdelivr.net/gh/banbendalao/ADgk@latest/ADgk.txt | 3,208 |
| 2 | AdGuard HostlistsRegistry filter_29 | https://adguardteam.github.io/HostlistsRegistry/assets/filter_29.txt | 214,905 |
| 3 | QY Ads Rule | https://raw.githubusercontent.com/rssvcn/qy-Ads-Rule/main/black.txt | 566 |
| 4 | 217heidai 广告过滤合并规则 | https://github.com/217heidai/adblockfilters/releases/download/rule/adblockdns.txt | 255,515 |
| 5 | anti-AD | https://anti-ad.net/easylist.txt | 97,166 |

各源版权归原作者所有，请遵守各自的使用条款。

---

## 四、合并规则说明

每 4 小时由 GitHub Actions 自动执行一次：

1. **抓取**：并发拉取全部上游源，GitHub raw 直连失败时自动回退到 `ghfast.top` / `gh-proxy.com` / `ghproxy.net` / `gitmirror` / `jsDelivr` 等镜像。
   - 以 `cdn.jsdelivr.net` 地址订阅的源（如 HaGeZi），会依次尝试 `fastly` / `gcore` 两个备用 CDN，全挂再回退到 GitHub raw，不押在单一入口上
   - 每份响应都会做内容体检：HTML 错误页、限流页、被截断的半截文件一律判为失败，不会混进合并结果
   - 单源规则数若比上一轮骤降超过 50%，同样判为失败（防止上游故障时悄悄少掉十几万条）
   - 配置里的**每一个上游**都必须至少有一个地址抓取成功，否则整轮放弃、**一个文件都不写** —— 少一个源就等于少一批拦截规则，静默发布出去是看不见的
   - 增删源不受这条限制：判定只看 `sources.json` 里当前配了哪些上游，删掉的不再参与判定，新增的必须能连上
2. **归一化**：统一转成 AdGuard Home 的 DNS 过滤语法 `||domain^`。
   - `0.0.0.0 domain` 等 hosts 写法 → `||domain^`（行尾 `#` 注释会被剥掉）
   - `||*.example.com^` → `||example.com^`（`||` 本身已覆盖全部子域）
   - 中文域名自动转 punycode
   - 剔除元素隐藏规则（`##`）与 URL 路径规则，这两类在 DNS 过滤里永远不会命中
   - **正则规则 `/regex/` 原样保留**（含上游 50～60 条形如 `/^guanggao\./`、`/^adservice\./` 的「广告标签前缀」规则）。它们拦的是 `<广告标签>.<App 自己的域名>` 这类动态广告位——贴吧、酷安等 App 内广告就靠它，域名清单永远写不出来。早期版本把正则一并丢掉，结果是「域名规则一条不少、App 内广告却全回来」
   - `$third-party`、`$~first-party` 这类**只描述请求上下文**的修饰符会被剥掉、域名规则保留 —— DNS 过滤不区分 referrer，留着修饰符没有任何意义，但为了它丢掉整条规则就太亏了
   - **`$app=` 例外，必须整条丢弃**：它不是上下文而是**作用域**。`||baidu.com^$app=com.tencent.qqlive` 是「只在腾讯视频里拦百度」，剥掉修饰符就变成「全世界拦百度」——`||baidu.com^` 会把整个百度主域连同 `tieba.baidu.com` 的全部子域一起 NXDOMAIN，贴吧 App 首页热榜就是这么消失的；同一批里还有 `||img1.360buyimg.com^$app=...`（京东商品图被全网拦掉）。AdGuard Home 不支持 `$app=`，留着会被它整条忽略，剥掉会放大成全网规则，两种都错，所以丢弃并计数（本轮 18 条）
   - `$popup`、`$document`、`$domain=`、`$removeparam` 这类会改变「对哪个域名、做哪种处理」的修饰符无法降级，带它们的整条规则会被丢弃（剥掉会把「限站点放行 / 只去参数」变成「全站硬屏蔽」）
   - `$important`、`$badfilter`、`$client`、`$denyallow` 等有效修饰符原样保留
3. **跨源去重**：5 个地址互相重叠极高，按域名去重，同一域名保留最强的那条（有 `$important` 的优先）。
   - 内容完全相同的镜像地址（同一份规则的两个入口）只计一次，不会让「合并前规则数」虚高
4. **父子域收敛**：若 `||a.com^` 已被屏蔽，则 `||b.a.com^`、`||c.b.a.com^` 这类子域规则属于冗余（`||a.com^` 已覆盖全部子域），直接剔除。这一步通常能砍掉 3%～8% 的冗余条目。
   - 白名单例外 `@@` **只去重、不做父子域收敛**，避免连带误放行；随后由第 5 步单独判定是否该整条剔除
   - 带 `$important` 的屏蔽规则不参与父子域剔除，始终单独保留（优先级更高，删掉会改变实际拦截行为）
   - `co.uk`、`com.cn`、`github.io` 这类 **共享后缀**不充当收敛父域：一条 `||co.uk^` 就能把几万条子域规则一次删光，拦截效果虽然不变，但规则数会瞬间塌陷、掩盖真实变化
5. **黑名单优先（仅针对上游自带的 `@@`）**：白名单与黑名单只要有任何交集，这条例外就**整条失效**，屏蔽规则照常生效。
   - 同域：`||a.com^` 与 `@@||a.com^` 同时存在 → 白名单剔除，a.com 被屏蔽
   - 白名单位于被屏蔽的父域之下：`||a.com^` + `@@||x.a.com^` → 白名单剔除（`||a.com^` 本来就覆盖全部子域，例外等于把父域规则挖了个洞）
   - 白名单解开了黑名单里的子域：`@@||a.com^` + `||ads.a.com^` → 白名单剔除，ads.a.com 恢复拦截
   - 剔除白名单**不会**凭空增加拦截：例外本身不屏蔽任何东西，去掉它只是让原有的屏蔽规则重新生效；a.com 自身若没有屏蔽规则，照样能访问
   - 每轮都把剔除了多少条、其中各类原因多少条、因此恢复生效多少条屏蔽规则，写进上面表格与规则文件头部
   - **例外**：`allowlist.txt` 里的强制白名单不参与这条判定，它是无条件放行，覆盖到的屏蔽规则会被直接删掉，见[第五节](#五强制白名单allowlisttxt)
6. **输出**：按字母序排序后写出，保证同样内容生成同样的文件，`git diff` 只反映真实变化。
   - 写文件之前先做一次全量自检：35 万条输出行必须逐条都是 AdGuard Home 认得的规则，任何一行不合规就整轮失败、不写文件，宁可不更新也不推一份加载不了的黑名单

---

## 五、强制白名单（`allowlist.txt`）

「黑名单优先」加上多源合并，必然产生一类**误杀**：某个上游为了拦广告，把某个子域名写进黑名单，而这个子域名其实是客户的 **HTTPDNS、长连接接入点、API 网关或日志网关**。DNS 层看不出「这条请求是广告还是心跳」，于是：

- 微信 / QQ 明明连着 Wi-Fi 却显示**「无网络连接」**（HTTPDNS 与 MSF 接入点被拦，客户端拿不到接入点又不会回退）
- 淘宝 / 京东 / 支付宝**登录态异常、接口全挂**（`mapi.m.jd.com`、`acs.wapa.taobao.com` 这类主网关被当成广告域拦掉）
- 部分 App **后台异常耗电**（日志网关被拦，日志堆在本地无限重试）
- 拼多多商品图、高德定位、百度实时路况等**功能直接失效**
- 微信支付 / 云闪付 / 手机银行**付款卡在「处理中」或提示系统繁忙**（收银台与风控网关被当成广告域拦掉）

上游自带的 `@@` 例外本来是用来修这类误杀的，但本项目「黑名单优先」会把它整条剔除（本次合并共剔除 141 条），所以修不回来。

### 5.1 它是什么

根目录的 [`allowlist.txt`](allowlist.txt) 是本仓库唯一的人工维护清单。里面每个域名都是**无条件放行**：

- **不参与「黑名单优先」判定** —— 与黑名单怎么冲突都不会被剔除；
- **覆盖到的屏蔽规则会被直接删除** —— 产物里只剩一条 `@@||域名^`，不会出现「既屏蔽又放行」的自相矛盾，也不会被统计成「不生效的屏蔽规则」；
- **优先级最高** —— `@@` 例外在 AdGuard Home 里本就压过普通屏蔽规则（只有带 `$important` 的屏蔽规则能压过它，本项目会把这类规则一并删除）。

合并时对每个强制白名单域名 D，会删掉所有「等于 D 或以 `.D` 结尾」的屏蔽规则，然后写出一条 `@@||D^`。当前共 77 条，其中 46 条真的命中了上游屏蔽，一共移除 50 条误杀规则。

### 5.2 为什么不会被自动任务覆盖

`allowlist.txt` 是仓库里的**普通源码文件**，不是生成物：GitHub Actions 只写 `dist/`、`README.md`、`status.json`，从不写它。因此每 4 小时的自动合并只会**读取**它，不会重置它；改它就等于改配置，提交后会触发一次立即重建（工作流 `paths` 里已包含该文件）。

写入格式一行一个域名，`domain`、`||domain^`、`@@||domain^` 三种写法都认，`#` 后面可以写理由：

```
dns.weixin.qq.com        # 微信 HTTPDNS，拦了会显示「无网络连接」
@@||mapi.m.jd.com^      # 京东 App 主 API 网关
```

合并前会校验每一条：域名非法、写错（比如多打了个点）会直接让整轮失败并指出行号，**不会静默跳过**——白名单写错却看起来「已经修好」，比报错更糟。两段式注册域名（如 `qq.com`）会连带放行全部子域，加载时会打印告警。

### 5.3 收录标准

只放「拦了就会坏功能」的域名，不放纯广告 / 纯埋点。目前按 App 分组：

| App | 放行的类型 | 典型域名 |
| --- | --- | --- |
| 微信 | HTTPDNS、长短连接、公众号内容链路、日志网关 | `dns.weixin.qq.com`、`long.weixin.qq.com`、`mp.weixin.qq.com`、`mmbiz.qpic.cn` |
| QQ | MSF 接入点（WiFi / 移动网络分域名）、登录日志、聊天图片、广告隐私设置页 | `configsvr.msf.3g.qq.com`、`msfwifi.3g.qq.com`、`tcpconn.tencent.com`、`imgcache.qq.com` |
| 支付宝 | 链路自检、日志网关、mPaaS 网关 | `tracert.alipay.com`、`loggw.alipay.com`、`mgw.mpaas.cn-hangzhou.aliyuncs.com` |
| 淘宝 / 天猫 | HTTPDNS、MTOP/百川网关、SDK 初始化 | `httpdns.alicdn.com`、`acs.wapa.taobao.com`、`sdkinit.taobao.com` |
| 京东 | 主 API 网关、HTTPDNS、日志 | `mapi.m.jd.com`、`dns.jd.com`、`xlog.jd.com` |
| 美团 / 点评 | HTTPDNS、日志上报、前端监控 | `httpdns.meituan.com`、`report.meituan.com` |
| 百度地图 | HTTPDNS、实时路况 | `httpsdns.baidu.com`、`itsdata.map.baidu.com` |
| 百度贴吧 | 前端静态资源域（含广告素材，拦了会白屏） | `static.tieba.baidu.com` |
| 高德 | 逆地理编码、服务信息、日志 | `apsrgeo.amap.com`、`amap-aos-info-nogw.amap.com` |
| 拼多多 | 商品图 CDN | `images.pinduoduo.com` |
| 微信支付 / 财付通 | 收银台、支付调起、财付通主域（整域） | `wx.tenpay.com`、`payapp.weixin.qq.com`、`tenpay.com` |
| 云闪付 / 银联 | 主域整域放行（子域随版本变动） | `95516.com`、`unionpay.com` |
| 手机银行 | 工行 / 建行 / 农行 / 中行 / 交行 / 招行 / 邮储 / 中信 / 民生 / 兴业 / 浦发 / 光大 / 华夏 / 广发 / 平安，主域整域放行 | `icbc.com.cn`、`ccb.com`、`cmbchina.com`、`bank.pingan.com` |

被剔掉的仍然是真广告：`adashx.ut.*`、`simba.*`、`optimus-ads.*`、`mads.*`、`dspsdk.*`、`ta/th.pinduoduo.com` 之类一条没动。

### 5.4 其他上游白名单仍是「黑名单优先」

强制白名单只覆盖 `allowlist.txt` 里那 77 条。其余上游自带的 `@@` 仍然按老规矩处理：

- 只要与黑名单有交集（同域 / 位于被屏蔽父域之下 / 覆盖了黑名单里的子域），整条剔除
- 代价：上游想用这条例外修的「误杀站点」，在你这里可能还是打不开 —— 这是设计的必然结果，不是 bug
- 遇到这种情况有两条路：把它加进 `allowlist.txt`（推荐，能长期生效），或在本地 AdGuard Home 的**自定义规则**里加一条 `@@||站点^`（只对你这一台设备生效）

**`$important` 不再是冲突判定的变量。** 上游屏蔽规则带不带 `$important`，都不会改变「上游白名单失效」的结论；但强制白名单会连同 `$important` 的屏蔽规则一起删除，所以它始终生效。因此「实际不生效的屏蔽规则合计」按设计应当为 **0**；一旦不为 0，说明合并层有漏判，可以从这个数字直接看出来。

---

## 六、强制黑名单（`denylist.txt`）

`allowlist.txt` 解决「拦错了」，`denylist.txt` 解决「该拦没拦」—— 两份清单是对称的，格式、校验、生效方式完全一致，只有方向相反。

### 6.1 为什么需要它

上游 5 个源都是**大而全的域名清单**，收的是广告平台的交易域与埋点域。有一类广告链路它们一致不碰：域名本身属于正规电商 / 大厂，拦掉要担责（可能误伤正常购物），于是干脆不收。

结果是一种很别扭的状态：**广告请求已经被拦了，广告却还在** —— 因为让广告「点得动、跳得转、算得清」的那几条落地链路，一条规则都没有。

典型是贴吧 / 微博 / 头条信息流里的「京东好物」卡片：

| 链路环节 | 域名 | 上游是否收录 |
| --- | --- | --- |
| 广告请求（百度联盟下发） | `cpro.tieba.baidu.com`、`cpro.baidu.com` | 有 |
| 素材图片 | `img*.360buyimg.com`（与正常商品图同一 CDN） | 无（共用域，没法只拦广告） |
| 落地跳转 | `u.jd.com`（京东联盟短链） | **无** |
| 点击归因 / 佣金 | `union.click.jd.com`、`cps.jd.com` | **无** |

前两行属于「共用域」，DNS 层无法区分广告与正常内容，只能在 HTTPS 层处理；后两行是**纯广告链路，正常购物一次都不会经过**，拦它们零副作用 —— 但必须有人写进去，这就是 `denylist.txt` 的职责。

### 6.2 它和父子域收敛的关系

`denylist.txt` 里的每一条都以 `||域名^$important` 输出，**不参与父子域收敛**。这不是多余的保险，是踩过的坑：

某个上游曾混进一条只在单个 App 内生效的宽规则，被错误地放大成 `||baidu.com^` 之后，几百条精确的百度广告子域（`mobads.baidu.com`、`cpro.baidu.com`、`pos.baidu.com`…）全部被判为「父域已覆盖」而剔除。宽规则一旦被修掉，这些精确规则本该回来；但只要收敛这一步还在，任何一条新的宽规则都能再把它们吃掉一次。用 `$important` 钉住，等于把这条路径堵死。

### 6.3 优先级与冲突

**denylist 优先于 allowlist。** 同一个域名同时出现在两份清单里属于配置错误，合并会直接中止并打印域名，不会静默二选一 —— 「拦不住」比「误放行」更难被发现，所以宁可报错。

当前共 11 条，其中 8 条上游本来就拦（写进来是「钉住」，防将来的宽规则吞掉），3 条是上游完全缺失、由人工补进屏蔽区的。

### 6.4 想更激进怎么办

DNS 层能拦的只有域名。如果连素材图都要挡，只有两条路：

1. 把图片 CDN 整域写进 `denylist.txt`（例如 `360buyimg.com`）—— **会连带废掉京东 App 的商品图**，不建议；
2. 上行到 HTTPS 层：AdGuard Home 只做 DNS，拦不了同一域名下的 `?ad=` 请求；这种情况要用 AdGuard 客户端 / Surge / sing-box 之类的 URL 规则，或开启 AdGuard Home 的加密 DNS + 客户端证书过滤（代价是 CPU 与配置复杂度）。

---

## 七、常见问题

**Q：为什么订阅链接偶尔更新滞后？**
jsDelivr 通道有 CDN 缓存，可能延迟数小时。要即时更新请用 ghfast.top / gh-proxy.com 通道。

**Q：规则数量比上游加起来少很多，是不是漏了？**
不是。5 个地址高度重叠，去重 + 父子域收敛后留存的都是有效规则，拦截效果不变而查询性能更好。少掉多少、为什么少，规则文件头部注释里都有明细。

**Q：软路由性能吃紧怎么办？**
本项目已剔除元素隐藏规则与 URL 路径规则（DNS 层无效），但保留了上游那几十条正则规则——App 内广告位只能靠它们。x86 软路由跑 30 万条域名规则 + 几十条正则几乎没有额外开销。若内存很紧张，可在 `sources.json` 的 `sources` 数组里删掉 `adgk` 或 `adguard-dns` 后重新运行。

**Q：微信 / QQ 显示「无网络连接」，或者某个 App 登录不上、后台耗电？**
先看是不是被本合集拦了。这几类域名最常见：HTTPDNS（`dns.weixin.qq.com`、`dns.jd.com` 等）、长连接接入点（`szlong.weixin.qq.com`、`configsvr.msf.3g.qq.com`）、主 API 网关（`mapi.m.jd.com`）、日志网关（`loggw.alipay.com`、`xlog.jd.com`）。支付类同理：微信支付走 `tenpay.com` / `wx.tenpay.com`，云闪付走 `95516.com`，手机银行走各家银行主域。它们**已经在 `allowlist.txt` 里强制放行**，如果你还遇到，说明是这台设备的旧缓存或上游新增了变体域名：

1. 在 AdGuard Home 的**查询日志**里按时间点筛「已拦截」，找到被拦的那个域名
2. 判断它是功能域名还是广告域名（`adashx` / `simba` / `dsp` / `mtt` 开头基本都是广告）
3. 功能域名就加进 `allowlist.txt` 并提交，4 小时内全量生效；只是自己用也可以在**自定义过滤规则**里加 `@@||域名^` 立即生效

**Q：单独订阅上游能拦住贴吧 / 酷安等 App 里的广告，订阅这个合集就拦不住了？**
这是早期版本的一个真实缺陷，已修复（规则文件头部能看到「保留的正则规则: 63」）。

原因是这类 App 的广告位不是固定域名，而是 `<广告标签>.<App 自己的域名>`：`guanggao.coolapk.com`、`adservice.tieba.baidu.com` 这一类的广告标签随版本变，任何域名清单都写不出来，上游只能靠 `/^guanggao\./`、`/^adservice\./`、`/^admaster\./`、`/^adgmta\./` 这样的**正则规则**去覆盖。早期版本为了省 CPU 把所有 `/regex/` 规则一律丢弃，而 `||域名^` 那一侧又是完整的并集——于是「域名规则一条不少、App 内广告却全回来」，且只影响这类靠标签式子域投广告的 App，非常难看出是规则类型被砍了。

现在正则规则原样保留（并做了语法 / RE2 兼容性预检），`$dnstype` 这类 DNS 级修饰符也不再被当成「无效修饰符」丢掉。已经订阅的，等 AdGuard Home 更新一次列表，或在过滤器页面点「立即更新」即可生效。

**Q：百度贴吧 App 首页热榜 / 推荐卡片整块消失了，是不是我订阅错了？**
不是订阅的问题，是上游一条只在单个 App 内生效的宽规则被错误放大了：

ADgk 里有一条 `||baidu.com^$app=com.tencent.qqlive`，本意是「只在腾讯视频里拦百度」。旧版本把 `$app=` 当成「请求上下文」剥掉，于是它变成 `||baidu.com^`——DNS 层直接把**整个百度主域**（含 `tieba.baidu.com` 的全部子域）判为不存在。贴吧的主信息流还能靠 HTTPDNS 自行解析刷出来，热榜卡片这类走系统 DNS 的子请求却全部 NXDOMAIN，表现就是「帖子能看、热榜没了」。

现在这类 `$app=` 规则一律整条丢弃并计数（规则文件头部能看到「App 作用域规则 N 条」）。订阅更新后热榜即恢复，不用清缓存。

**Q：贴吧帖子之间那种「京东购物」广告还在，规则里明明有 `im-x.jd.com`？**
因为那条广告不走 `im-x.jd.com`。它是**百度联盟**投放的原生广告：请求由 `cpro.tieba.baidu.com` 一类百度域下发，素材落在京东图床 `img*.360buyimg.com`（和正常商品图同一个 CDN），落地页走京东联盟短链 `u.jd.com`。

三段里，`img*.360buyimg.com` 属于共用域，DNS 层分不出广告图和商品图；`u.jd.com` / `union.click.jd.com` / `cps.jd.com` 是纯广告链路、拦了没有副作用，但 5 个上游**一条都不收**（域名属于正规电商）。所以本仓库新增了 [`denylist.txt`](denylist.txt) 强制拦截这几条链路 —— 广告点不动、归因不成立。

剩下的「卡片本身还在显示」是 DNS 过滤的边界：广告数据跟帖子列表一起下发，图片在共用 CDN 上，域名清单拦不掉。要彻底去掉只能上 HTTPS 层（见[第六节](#六强制黑名单denylisttxt)）。

**Q：某个网站上游明明放行了，我这里还是被拦？**
上游的 `@@` 例外走「黑名单优先」：只要别的源屏蔽了这个域名（或它的父域/子域），那条例外就被剔除了。要长期放行，把它写进 `allowlist.txt`（见[第五节](#五强制白名单allowlisttxt)）；只给自己这台设备放行，可以在 AdGuard Home 的**自定义过滤规则**里加 `@@||站点域名^`，它的优先级高于订阅列表。

**Q：某个上游打不开，为什么整轮都不更新了？**
这是发布闸门：`sources.json` 里的**每个上游**都必须至少有一个地址抓取成功，少一个就整轮放弃、不写任何文件——发布一份少了十万条规则的订阅，比停更更难发现。处理办法：

- 只是临时抖动（超时、限流、CDN 故障）→ 不用管，下一轮自动重试，恢复后自动继续
- 该源已永久下线 → 从 `sources.json` 里删掉它并提交，下一轮恢复正常（**删源不会触发这条闸门**）
- 想先发一版救急 → Actions 页面 **Run workflow** 勾选 `force`，或 dispatch 时传 `force=true`

> 增删源本身不会被拦住：闸门只看「当前配置了哪些上游」，删掉的不参与判定，新增的只要能连上就正常发布。原先「比上轮少 20% 就拒绝发布」的熔断已经移除，正是因为增删单个源会让总数正常变化，那种熔断会导致长期停更且必须人工解卡。

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

## 八、本地运行

```bash
# 需要 Node.js >= 20，无第三方依赖，不需要 npm install
npm test                                  # 单元测试（含 allowlist.txt / denylist.txt 校验）
node src/index.js                         # 在线抓取并合并（会写 dist / README / status）
node src/index.js --dry-run               # 只跑不写文件
npm run cache                             # 抓一次并把各源原文存到 .cache/（不写 dist）
npm run build:offline                     # 断网复盘：只用 .cache/ 里的原文重新生成
```

人工清单有两份：`allowlist.txt`（强制放行）与 `denylist.txt`（强制拦截）。改完直接跑 `npm test && node src/index.js` 即可看到效果；条目写错会让整轮合并失败并打印行号，同一个域名同时出现在两份清单里也会直接中止。

`--cache=DIR` 保存的是**本轮实际拿到的原文**（可能来自镜像），因此离线复盘出来的结果
与在线运行逐字节一致，适合排查「同样的输入为什么输出变了」。

发布闸门在本地同样生效：只要有上游抓不到，`node src/index.js` 就会退出码 1、不写文件。
确认要忽略时加环境变量 `FORCE=true`（PowerShell：`$env:FORCE="true"; node src/index.js`）。

---

<sub>本仓库由 GitHub Actions 自动维护，请勿直接编辑 `dist/` 与 `README.md` 中的统计区块，下次运行会被覆盖。</sub>
