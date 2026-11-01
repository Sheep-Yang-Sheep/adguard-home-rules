import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

/** 北京时间（UTC+8，无夏令时）各字段 */
export function beijingNow(date = new Date()) {
  const t = new Date(date.getTime() + 8 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  const y = t.getUTCFullYear();
  const mo = pad(t.getUTCMonth() + 1);
  const d = pad(t.getUTCDate());
  const h = pad(t.getUTCHours());
  const mi = pad(t.getUTCMinutes());
  return {
    date: `${y}-${mo}-${d}`,
    time: `${h}:${mi}`,
    minute: `${y}-${mo}-${d} ${h}:${mi}`,
    weekday: WEEKDAYS[t.getUTCDay()],
    full: `${y}-${mo}-${d} ${h}:${mi} (UTC+8)`,
  };
}

const n = (v) => Number(v).toLocaleString('en-US');

/** 从环境变量或配置推导仓库信息 */
export function repoInfo(config) {
  const slug =
    process.env.GITHUB_REPOSITORY ||
    (config.output && config.output.repo) ||
    'OWNER/REPO';
  const branch = process.env.GITHUB_REF_NAME || (config.output && config.output.branch) || 'main';
  const file = (config.output && config.output.file) || 'dist/adguard-home-rules.txt';
  const homepage =
    (config.output && config.output.homepage) || `https://github.com/${slug}`;
  return { slug, branch, file, homepage };
}

/** 生成各加速通道的订阅地址 */
export function subscriptionLinks({ slug, branch, file }) {
  const raw = `https://raw.githubusercontent.com/${slug}/${branch}/${file}`;
  return [
    { label: 'GitHub 直连', url: raw, note: '境外网络或代理环境' },
    { label: 'ghfast.top', url: `https://ghfast.top/${raw}`, note: '国内可用，推荐' },
    { label: 'gh-proxy.com', url: `https://gh-proxy.com/${raw}`, note: '国内可用，备用' },
    { label: 'ghproxy.net', url: `https://ghproxy.net/${raw}`, note: '国内可用，备用' },
    { label: 'jsDelivr CDN', url: `https://cdn.jsdelivr.net/gh/${slug}@${branch}/${file}`, note: 'CDN 有缓存，更新略有延迟' },
  ];
}

/** 生成 dist 规则文件正文 */
export function renderRules(result, ctx) {
  const { stats, block, allow, raw, sources } = result;
  const { updatedAt, runAt, homepage, failedSources = [] } = ctx;

  const out = [];
  out.push('! Title: AdGuard Home 合并规则合集');
  out.push('! Description: 多个上游规则源自动合并、去重并做父子域收敛后的单一 DNS 过滤规则');
  out.push('! Homepage: ' + homepage);
  out.push('!');
  out.push('! ================= 更新时间 =================');
  out.push(`! 本合集更新时间（北京时间 UTC+8）: ${updatedAt.minute}`);
  out.push('! 说明: 以上时间仅在规则内容实际发生变化时刷新；无变化时不重写本文件。');
  out.push('!');
  out.push('! ================= 规则统计 =================');
  out.push(`! 合并前规则数（各上游合计，含重复）: ${n(stats.before)}`);
  out.push(`! 去重后规则数: ${n(stats.blockUnique + stats.allowUnique + stats.rawUnique)}`);
  out.push(`!   其中屏蔽规则去重后: ${n(stats.blockUnique)}`);
  out.push(`!   其中白名单例外去重后: ${n(stats.allowUnique)}`);
  out.push(`!   其中通配/特殊规则去重后: ${n(stats.rawUnique)}`);
  out.push(`! 被父域规则覆盖而移除的冗余规则: ${n(stats.subsumeRemoved + stats.rawCovered)}`);
  out.push(`!   其中子域规则: ${n(stats.subsumeRemoved)} · 通配规则: ${n(stats.rawCovered)}`);
  out.push(`! 合并后规则数: ${n(stats.after)}`);
  out.push(`!   其中屏蔽规则: ${n(block.length)}`);
  out.push(`!   其中白名单例外: ${n(allow.length)}`);
  out.push(`!   其中通配/特殊规则: ${n(raw.length)}`);
  out.push('!');
  out.push(`! ================= 上游订阅源（${sources.length} 个）=================`);
  sources.forEach((s, i) => {
    out.push(`! ${i + 1}. ${s.name}`);
    out.push(`!    ${s.url}`);
    if (s.homepage && s.homepage !== s.url) out.push(`!    主页 ${s.homepage}`);
    out.push(`!    本次解析有效规则 ${n(s.effective)} 条`);
  });
  if (failedSources.length) {
    out.push('!');
    out.push('! 本次抓取失败的源（其规则未纳入本次合集）:');
    for (const f of failedSources) out.push(`!   - ${f.name} (${f.url}) : ${f.error}`);
  }
  out.push('!');
  out.push('! 规则版权归各上游作者所有，本仓库仅做合并整理，仅供个人学习研究使用。');
  out.push('');

  out.push('! ============ 白名单例外规则（@@ 优先级高于任何屏蔽规则）============');
  for (const d of allow) out.push(`@@||${d}^`);
  out.push('');

  out.push('! ============ 通配与特殊规则 ============');
  for (const r of raw) out.push(r);
  out.push('');

  out.push('! ============ 屏蔽规则（父域已覆盖的子域已剔除）============');
  for (const item of block) out.push(item.important ? `||${item.domain}^$important` : `||${item.domain}^`);
  out.push('');

  return out.join('\n');
}

/**
 * 内容指纹：抹掉时间戳后比较全文。
 * 只要规则主体、统计数字或说明文案有任何变化都应重写文件，
 * 唯独「更新时间」本身不应触发重写（否则每次运行都会产生一次提交）。
 */
export function contentSignature(text) {
  if (!text) return '';
  return text.replace(/^! 本合集更新时间（北京时间 UTC\+8）:.*$/m, '! 本合集更新时间: <ts>');
}

/** 渲染 README */
export function renderReadme(result, ctx) {
  const { stats, sources } = result;
  const { updatedAt, runAt, repo, failedSources = [] } = ctx;
  const tpl = readFileSync(path.join(ROOT, 'src', 'readme.template.md'), 'utf8');

  const links = subscriptionLinks(repo);
  const linkTable = [
    '| 通道 | 订阅地址 | 说明 |',
    '| --- | --- | --- |',
    ...links.map((l) => `| ${l.label} | \`${l.url}\` | ${l.note} |`),
  ].join('\n');

  const sourceTable = [
    '| # | 源 | 订阅地址 | 本次有效规则 |',
    '| --- | --- | --- | --- |',
    ...sources.map(
      (s, i) => `| ${i + 1} | ${s.name} | ${s.url} | ${n(s.effective)} |`
    ),
  ].join('\n');

  const failBlock = failedSources.length
    ? [
        '',
        '> ⚠️ 本次运行有源抓取失败，以下源未纳入本次合集：',
        ...failedSources.map((f) => `> - ${f.name} — ${f.error}`),
      ].join('\n')
    : '';

  const vars = {
    '{{UPDATED_AT}}': updatedAt.minute,
    '{{UPDATED_WEEKDAY}}': updatedAt.weekday,
    '{{RUN_AT}}': runAt.minute,
    '{{BEFORE}}': n(stats.before),
    '{{AFTER}}': n(stats.after),
    '{{DEDUP}}': n(stats.blockUnique + stats.allowUnique + stats.rawUnique),
    '{{SUBSUMED}}': n(stats.subsumeRemoved + stats.rawCovered),
    '{{BLOCK}}': n(result.block.length),
    '{{ALLOW}}': n(result.allow.length),
    '{{RAW}}': n(result.raw.length),
    '{{SOURCE_COUNT}}': String(sources.length),
    '{{LINKS}}': linkTable,
    '{{PRIMARY_URL}}': links[1].url,
    '{{SOURCES}}': sourceTable,
    '{{FAILED}}': failBlock,
    '{{HOMEPAGE}}': repo.homepage,
  };

  let md = tpl;
  for (const [k, v] of Object.entries(vars)) md = md.split(k).join(v);
  return md;
}

/** 运行状态快照，便于外部监控 */
export function renderStatus(result, ctx) {
  const { stats } = result;
  return JSON.stringify(
    {
      updatedAtBeijing: ctx.updatedAt.minute,
      runAtBeijing: ctx.runAt.minute,
      updatedAtUtc: ctx.runAtUtc,
      before: stats.before,
      after: stats.after,
      subsumeRemoved: stats.subsumeRemoved,
      block: result.block.length,
      allow: result.allow.length,
      raw: result.raw.length,
      failedSources: (ctx.failedSources || []).map((f) => f.name),
    },
    null,
    2
  ) + '\n';
}
