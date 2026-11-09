import { readFileSync } from 'node:fs';

import { normalizeDomain } from './parser.js';

/**
 * 项目级强制白名单
 *
 * 与上游自带的 `@@` 例外不同，这里的域名是**无条件放行**：
 *   - 不参与「黑名单优先」的判定，与黑名单怎么冲突都不会被剔除；
 *   - 它覆盖到的屏蔽规则会在合并阶段直接删除，产物里不留「写了也不生效」的死规则。
 *
 * 文件由人工维护，自动任务只读不写，因此不会随每 4 小时的合并而丢失。
 *
 * 支持的写法（一行一条）：
 *   example.com
 *   ||example.com^
 *   @@||example.com^
 *   example.com   # 行内说明
 * `!` 或 `#` 开头的整行为注释。
 *
 * 裸二级域（如 `deepl.com`）会连带放行全部子域，默认只告警；确认要整域放行时，
 * 在行尾注释里写明「整域放行」，告警即消失，CI 才会放行这一条。
 */

const DOMAIN_LIKE = /^(?:@@)?\|*[^\s]+$/;

// 裸二级域（`deepl.com`）等于整站连同全部子域一起放行，绝大多数情况是笔误
// （把 `qq.com` 写进来会一口气放掉几十万条子域规则），所以默认只告警。
// 但确实存在「整个域名都是自家服务」的单用途站点，这类条目应当在行尾注释里
// 写明「整域放行」，把一条被动告警变成人工确认过的决定。
const APEX_CONFIRM = /整域放行|allow[-_ ]?apex/i;

/**
 * @param {string} text allowlist.txt 全文
 * @returns {{entries:Array<{domain:string, reason:string, line:number}>, errors:string[], warnings:string[]}}
 */
export function parseAllowlist(text) {
  const entries = [];
  const errors = [];
  const warnings = [];
  const seen = new Map();

  String(text)
    .split('\n')
    .forEach((raw, index) => {
      const lineNo = index + 1;
      let line = raw.replace(/\r$/, '').trim();
      if (!line || line.startsWith('!') || line.startsWith('#')) return;

      // 行内说明：域名里不可能出现 `#`，可以安全截断
      let reason = '';
      const hash = line.indexOf('#');
      if (hash > 0) {
        reason = line.slice(hash + 1).trim();
        line = line.slice(0, hash).trim();
      }
      if (!DOMAIN_LIKE.test(line)) {
        errors.push(`第 ${lineNo} 行不是合法域名：${raw.trim()}`);
        return;
      }

      let host = line;
      if (host.startsWith('@@')) host = host.slice(2);
      if (host.startsWith('||')) host = host.slice(2);
      if (host.endsWith('^')) host = host.slice(0, -1);

      const domain = normalizeDomain(host);
      if (!domain) {
        errors.push(`第 ${lineNo} 行域名非法：${raw.trim()}`);
        return;
      }

      if (seen.has(domain)) {
        warnings.push(`第 ${lineNo} 行与第 ${seen.get(domain)} 行重复：${domain}`);
        return;
      }
      seen.set(domain, lineNo);

      // 只写两段式注册域名等于把整站及其全部子域一起放行（例如 qq.com 会放掉
      // 几十万条子域规则），几乎一定是写错了，必须显式提醒。
      // 行尾注释里写明「整域放行」视为已确认，不再告警。
      if (domain.split('.').length < 3 && !APEX_CONFIRM.test(reason)) {
        warnings.push(
          `第 ${lineNo} 行是整域放行，会连带放行全部子域：${domain}` +
            '（确认无误请在行尾注释写明「整域放行」）'
        );
      }

      entries.push({ domain, reason, line: lineNo });
    });

  return { entries, errors, warnings };
}

/**
 * 读取 allowlist.txt
 * @param {string} file 绝对路径
 * @returns {{entries:Array<{domain:string, reason:string, line:number}>, errors:string[], warnings:string[], domains:string[]}}
 */
export function loadAllowlist(file) {
  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    return { entries: [], errors: [`读取 ${file} 失败：${err.message}`], warnings: [], domains: [] };
  }
  const parsed = parseAllowlist(text);
  return { ...parsed, domains: parsed.entries.map((e) => e.domain) };
}
