import { loadDomainList, parseDomainList } from './domainlist.js';

/**
 * 项目级强制黑名单（denylist.txt）
 *
 * 与 allowlist.txt 正好对称，解决的是另一类问题：**上游没有、但确实该拦**。
 *
 * 为什么需要它：上游 5 个源都是「大而全的域名清单」，覆盖的是各家广告平台的
 * 交易域、埋点域。有一类广告链路它们一致不碰 —— 因为域名本身属于正规电商/大厂，
 * 拦掉会连带毁掉 App 主流程，上游宁可不拦：
 *
 *   京东购物广告（贴吧、微博、头条信息流里那种「京东好物」卡片）
 *     · 广告请求由**百度联盟**在 `<广告标签>.tieba.baidu.com` / cpro 系列下发；
 *     · 素材图直接落在京东图床 `img*.360buyimg.com`（和正常商品图同一个 CDN）；
 *     · 落地页走京东联盟短链 `u.jd.com`，点击归因走 `union.click.jd.com`。
 *   这三段里，前两段「共用域」原则上是没法只拦广告不拦正常内容的，
 *   但**第三段（联盟短链 / 点击 / CPS）是纯广告链路，正常购物一次都不会经过**，
 *   上游却一条都没收 —— 于是广告点得动、跳得转、归因成立，看起来就像没拦住。
 *
 * 与 allowlist 的优先级：denylist 优先。同一个域名同时出现在两份清单里是配置错误，
 * 合并时会告警并以 denylist 为准（拦不住比误放行更难发现）。
 *
 * 与父子域收敛的关系：denylist 里的域名以 `$important` 形式输出，**不参与父子域收敛**。
 * 否则将来某个上游再混进一条 `||jd.com^` 之类的宽规则，这些精确的广告域就会被
 * 「父域已覆盖」静默吃掉，白名单式地重新敞开 —— 这正是本次要修的坑，不能再踩第二遍。
 */

/**
 * @param {string} text denylist.txt 全文
 */
export function parseDenylist(text) {
  return parseDomainList(text, { apexWord: '拦截' });
}

/**
 * 读取 denylist.txt
 * @param {string} file 绝对路径
 */
export function loadDenylist(file) {
  return loadDomainList(file, { apexWord: '拦截' });
}
