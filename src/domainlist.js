import { readFileSync } from 'node:fs';

import { normalizeDomain } from './parser.js';

/**
 * 项目级域名清单的公共解析器
 *
 * `allowlist.txt`（强制放行）与 `denylist.txt`（强制拦截）用的是同一套格式与校验，
 * 只有「整域」告警的措辞不同，因此把解析逻辑抽到这里，避免两份实现慢慢跑偏：
 * 白名单那份允许什么、拒绝什么，黑名单那份必须完全一致，否则同一行在两边会得到
 * 不同结果 —— 这种不一致极难发现。
 *
 * 支持的写法（一行一条）：
 *   example.com
 *   ||example.com^
 *   @@||example.com^
 *   example.com   # 行内说明
 * `!` 或 `#` 开头的整行为注释。
 */

const DOMAIN_LIKE = /^(?:@@)?\|*[^\s]+$/;

// 裸二级域（`deepl.com`）等于整站连同全部子域一起处理，绝大多数情况是笔误
// （把 `qq.com` 写进来会一口气放掉/拦掉几十万条子域规则），所以默认只告警。
// 但确实存在「整个域名都是自家服务」的单用途站点，这类条目应当在行尾注释里
// 写明「整域放行 / 整域拦截」，把一条被动告警变成人工确认过的决定。
const APEX_CONFIRM = /整域(放行|拦截)|allow[-_ ]?apex/i;

/**
 * @param {string} text 清单全文
 * @param {{apexWord?: string}} [options] apexWord 决定告警措辞，默认「放行」
 * @returns {{entries:Array<{domain:string, reason:string, line:number}>, errors:string[], warnings:string[]}}
 */
export function parseDomainList(text, options = {}) {
  const apexWord = options.apexWord || '放行';
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

      // 只写两段式注册域名等于把整站及其全部子域一起处理（例如 qq.com 会波及
      // 几十万条子域规则），几乎一定是写错了，必须显式提醒。
      // 行尾注释里写明「整域放行 / 整域拦截」视为已确认，不再告警。
      if (domain.split('.').length < 3 && !APEX_CONFIRM.test(reason)) {
        warnings.push(
          `第 ${lineNo} 行是整域${apexWord}，会连带影响全部子域：${domain}` +
            `（确认无误请在行尾注释写明「整域${apexWord}」）`
        );
      }

      entries.push({ domain, reason, line: lineNo });
    });

  return { entries, errors, warnings };
}

/**
 * 读取一份域名清单文件
 * @param {string} file 绝对路径
 * @param {{apexWord?: string}} [options]
 */
export function loadDomainList(file, options = {}) {
  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    return { entries: [], errors: [`读取 ${file} 失败：${err.message}`], warnings: [], domains: [] };
  }
  const parsed = parseDomainList(text, options);
  return { ...parsed, domains: parsed.entries.map((e) => e.domain) };
}
