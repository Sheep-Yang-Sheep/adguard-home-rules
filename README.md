# AdGuard Home 合并规则合集

把 7 个主流广告 / 追踪域名规则源，合并成**一个** `.txt` 文件，每 **4 小时**自动更新一次，软路由只需订阅一条链接。

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

推荐填这一条（ghfast.top 加速，国内实测可用）：

```
https://ghfast.top/https://raw.githubusercontent.com/Sheep-Yang-Sheep/adguard-home-rules/main/dist/adguard-home-rules.txt
```

### 在 AdGuard Home 中添加

1. 打开 AdGuard Home 管理面板 → **过滤器** → **DNS 黑名单**
2. 点击 **添加黑名单** → **添加自定义列表**
3. 名称填 `合并规则合集`，URL 填上面的订阅地址
4. 保存后点该列表旁的 **∨** → **立即更新**，等待规则加载完毕

建议同时把「过滤器更新间隔」设为 **12 小时**（默认是 24 小时），与上游 4 小时更新节奏匹配。

---

## 二、当前状态

- **本合集更新时间（北京时间）**：`2026-11-01 15:02` 周日
- **上次自动任务运行时间（北京时间）**：`2026-11-01 15:02`

| 指标 | 数值 |
| --- | --- |
| 合并前规则数（各上游合计，含重复） | 823,029 |
| 去重后规则数 | 366,893 |
| 被父域规则覆盖而移除的冗余规则 | 14,045 |
| **合并后规则数** | **352,848** |
| └ 屏蔽规则 | 352,199 |
| └ 白名单例外 `@@` | 243 |
| └ 通配 / 特殊规则 | 406 |

> 「本合集更新时间」只在规则内容真的发生变化时才刷新；「上次任务运行时间」每 4 小时刷新一次，可据此判断自动任务是否正常。


---

## 三、上游订阅源

| # | 源 | 订阅地址 | 本次有效规则 |
| --- | --- | --- | --- |
| 1 | 秋风 AWAvenue Ads Rule | https://raw.githubusercontent.com/TG-Twilight/AWAvenue-Ads-Rule/main/AWAvenue-Ads-Rule.txt | 972 |
| 2 | QY Ads Rule | https://raw.githubusercontent.com/rssvcn/qy-Ads-Rule/main/black.txt | 566 |
| 3 | adrules 国内规则 | https://adrules.top/dns.txt | 206,075 |
| 4 | 217heidai 广告过滤合并规则 | https://raw.githubusercontent.com/217heidai/adblockfilters/main/rules/adblockdns.txt | 241,854 |
| 5 | anti-AD | https://anti-ad.net/adguard.txt | 100,958 |
| 6 | HaGeZi Pro | https://gitlab.com/hagezi/mirror/-/raw/main/dns-blocklists/adblock/pro.txt | 213,387 |
| 7 | OISD Small | https://small.oisd.nl/ | 59,217 |

各源版权归原作者所有，请遵守各自的使用条款。

---

## 四、合并规则说明

每 4 小时由 GitHub Actions 自动执行一次：

1. **抓取**：并发拉取全部上游源，GitHub raw 直连失败时自动回退到 `ghfast.top` / `gh-proxy.com` / `ghproxy.net` / `gitmirror` / `jsDelivr` 等镜像；单个源连续失败只记录告警，成功率低于 75% 则放弃本次发布，避免推送残缺规则。
2. **归一化**：统一转成 AdGuard Home 的 DNS 过滤语法 `||domain^`。
   - `0.0.0.0 domain` 等 hosts 写法 → `||domain^`
   - `||*.example.com^` → `||example.com^`（`||` 本身已覆盖全部子域）
   - 中文域名自动转 punycode
   - 剔除元素隐藏规则（`##`）、URL 路径规则、正则规则与 DNS 层无效的修饰符（如 `$third-party`、`$app=`），这些在 DNS 过滤中不会生效，留着只会拖慢匹配
   - `$important`、`$badfilter`、`$client`、`$denyallow` 等有效修饰符原样保留
3. **跨源去重**：7 个源互相重叠极高，按域名去重，同一域名保留最强的那条（有 `$important` 的优先）。
4. **父子域收敛**：若 `||a.com^` 已被屏蔽，则 `||b.a.com^`、`||c.b.a.com^` 这类子域规则属于冗余（`||a.com^` 已覆盖全部子域），直接剔除。这一步通常能砍掉 3%～8% 的冗余条目。
   - 白名单例外 `@@` **只去重、不收敛**，避免误放行
   - 带 `$important` 的规则不参与剔除（它优先级高于 `@@`，删掉会改变实际拦截行为）
5. **输出**：按字母序排序后写出，保证同样内容生成同样的文件，`git diff` 只反映真实变化。

---

## 五、常见问题

**Q：为什么订阅链接偶尔更新滞后？**
jsDelivr 通道有 CDN 缓存，可能延迟数小时。要即时更新请用 ghfast.top / gh-proxy.com 通道。

**Q：规则数量比上游加起来少很多，是不是漏了？**
不是。7 个源高度重叠，去重 + 父子域收敛后留存的都是有效规则，拦截效果不变而查询性能更好。

**Q：软路由性能吃紧怎么办？**
本项目已剔除全部正则规则，仅保留域名级规则，x86 软路由跑 20 万条域名规则几乎没有额外开销。若内存很紧张，可在 `sources.json` 中注释掉 `hagezi` 或 `oisd` 后重新运行。

**Q：想增删订阅源？**
编辑 `sources.json` 的 `sources` 数组，提交后会自动触发一次合并。

---

## 六、本地运行

```bash
# 需要 Node.js >= 20
node src/index.js            # 在线抓取并合并
node src/index.js --dry-run  # 只跑不写文件
npm test                     # 单元测试
```

---

<sub>本仓库由 GitHub Actions 自动维护，请勿直接编辑 `dist/` 与 `README.md` 中的统计区块，下次运行会被覆盖。</sub>
