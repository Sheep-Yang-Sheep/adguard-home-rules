import { loadDomainList, parseDomainList } from './domainlist.js';

/**
 * 项目级强制白名单（allowlist.txt）
 *
 * 与上游自带的 `@@` 例外不同，这里的域名是**无条件放行**：
 *   - 不参与「黑名单优先」的判定，与黑名单怎么冲突都不会被剔除；
 *   - 它覆盖到的屏蔽规则会在合并阶段直接删除，产物里不留「写了也不生效」的死规则。
 *
 * 文件由人工维护，自动任务只读不写，因此不会随每 4 小时的合并而丢失。
 *
 * 格式与校验见 domainlist.js（与 denylist.txt 共用同一套解析器）。
 */

/**
 * @param {string} text allowlist.txt 全文
 * @returns {{entries:Array<{domain:string, reason:string, line:number}>, errors:string[], warnings:string[]}}
 */
export function parseAllowlist(text) {
  return parseDomainList(text, { apexWord: '放行' });
}

/**
 * 读取 allowlist.txt
 * @param {string} file 绝对路径
 * @returns {{entries:Array<{domain:string, reason:string, line:number}>, errors:string[], warnings:string[], domains:string[]}}
 */
export function loadAllowlist(file) {
  return loadDomainList(file, { apexWord: '放行' });
}
