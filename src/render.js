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

const SKIP_LABELS = {
  'element-hide': '元素隐藏规则',
  path: '带路径的 URL 规则',
  'no-anchor': '缺少 ^ 锚定的域名规则',
  regex: '正则规则',
  'url-anchor': '|http:// 锚定规则',
  'unsupported-modifier': 'DNS 层无效修饰符',
  'invalid-domain': '非法域名/IP',
  empty: '空行',
  comment: '注释',
  unknown: '无法识别',
};

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
  const { updatedAt, homepage, failedSources = [] } = ctx;

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
  out.push('! ================= 体检报告 =================');
  out.push(`! 被父域白名单 @@ 架空的屏蔽规则: ${n(stats.allowShadowed)}（仍在文件中，但实际不会拦截）`);
  out.push(`! 同域既屏蔽又放行（按 @@ 生效）: ${n(stats.conflicts)}`);
  out.push(`!   其中带 $important、会压过 @@ 的: ${n(stats.importantOverAllow)}`);
  out.push(`! 实际不生效的屏蔽规则合计: ${n(stats.deadRules ?? 0)}（= 架空 + 同域放行 - $important 压制）`);
  if (stats.badfilterKept) {
    out.push(`! 因 $badfilter 点名而保留、未参与父子域收敛的规则: ${n(stats.badfilterKept)}`);
  }
  if (stats.sharedSuffixKept) {
    out.push(`! 父域是共享后缀（co.uk / github.io 等）而保留的子域规则: ${n(stats.sharedSuffixKept)}`);
  }
  if (stats.skippedTotal) {
    const detail = Object.entries(stats.skipped)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${SKIP_LABELS[k] || k} ${n(v)}`)
      .join(' · ');
    out.push(`! 解析阶段丢弃 ${n(stats.skippedTotal)} 行: ${detail}`);
  }
  out.push('!');
  out.push(
    `! ================= 上游订阅源（${sources.length} 个地址 / ${stats.upstreams} 个独立上游）=================`
  );
  sources.forEach((s, i) => {
    out.push(`! ${i + 1}. ${s.name}${s.mirror ? '（同上游镜像）' : ''}`);
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

  out.push('! ============ 白名单例外规则（@@ 优先级高于普通屏蔽规则）============');
  for (const a of allow) out.push(a.important ? `@@||${a.domain}^$important` : `@@||${a.domain}^`);
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

/**
 * 产物自检：确认要写进 dist 的每一行都是 AdGuard Home 认得的规则。
 *
 * 规则主体是本仓库自己生成的（`||domain^` / `@@||domain^`，最多再带一个 `$important`），
 * 其余原样透传的通配 / 特殊规则必须来自上游的白名单集合。这是最后一道闸门：
 * 渲染逻辑将来若被改坏（例如把带非法字符的域名拼进去），任务会直接失败，
 * 而不是把一份 AdGuard Home 拒绝加载的文件推给所有订阅者。
 *
 * @param {string} text renderRules 的输出
 * @param {string[]} rawRules 允许原样出现的通配 / 特殊规则
 * @returns {{bad:string[]}} 不合规的行（最多 10 条，够定位问题）
 */
export function verifyRenderedRules(text, rawRules = []) {
  const allowedRaw = new Set(rawRules);
  // 生成规则只可能是这四种形态：||d^、||d^$important、@@||d^、@@||d^$important
  const GENERATED_RE = /^(?:@@)?\|\|[a-z0-9_-]+(?:\.[a-z0-9_-]+)+\^(?:\$important)?$/;
  const bad = [];

  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('!')) continue;
    if (GENERATED_RE.test(line) || allowedRaw.has(line)) continue;
    bad.push(line);
    if (bad.length >= 10) break;
  }

  return { bad };
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
    ...sources.map((s, i) => {
      const tag = s.mirror ? ' <sub>镜像</sub>' : '';
      return `| ${i + 1} | ${s.name}${tag} | ${s.url} | ${n(s.effective)} |`;
    }),
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
    '{{SHADOWED}}': n(stats.allowShadowed),
    '{{CONFLICTS}}': n(stats.conflicts),
    '{{IMPORTANT_OVER_ALLOW}}': n(stats.importantOverAllow),
    '{{DEAD_RULES}}': n(stats.deadRules ?? 0),
    '{{SKIPPED_TOTAL}}': n(stats.skippedTotal),
    '{{SOURCE_COUNT}}': String(sources.length),
    '{{UPSTREAM_COUNT}}': String(stats.upstreams),
    '{{LINKS}}': linkTable,
    '{{PRIMARY_URL}}': links[1].url,
    '{{SOURCES}}': sourceTable,
    '{{FAILED}}': failBlock,
    '{{HOMEPAGE}}': repo.homepage,
    '{{REPO_SLUG}}': repo.slug,
  };

  let md = tpl;
  for (const [k, v] of Object.entries(vars)) md = md.split(k).join(v);
  return md;
}

/**
 * 运行状态快照，便于外部监控与下一轮基线对比。
 * sources 字段存各源本轮有效规则数，下一轮据此判断「规则数骤降」。
 */
export function renderStatus(result, ctx) {
  const { stats } = result;
  // 由调用方决定：成功源用本轮值，失败源沿用上一轮基线，避免「基线被抹掉」
  const sourceStats = ctx.sourceStats || {};

  return (
    JSON.stringify(
      {
        updatedAtBeijing: ctx.updatedAt.minute,
        runAtBeijing: ctx.runAt.minute,
        // 内容真正变化的时间（UTC）；以前这里错填了 run 时间，两者含义不同
        updatedAtUtc: ctx.contentUpdatedAtUtc || ctx.runAtUtc,
        runAtUtc: ctx.runAtUtc,
        upstreams: stats.upstreams,
        before: stats.before,
        after: stats.after,
        subsumeRemoved: stats.subsumeRemoved,
        rawCovered: stats.rawCovered,
        block: result.block.length,
        allow: result.allow.length,
        raw: result.raw.length,
        allowShadowed: stats.allowShadowed,
        conflicts: stats.conflicts,
        importantOverAllow: stats.importantOverAllow,
        deadRules: stats.deadRules,
        badfilterKept: stats.badfilterKept,
        sharedSuffixKept: stats.sharedSuffixKept ?? 0,
        skippedTotal: stats.skippedTotal,
        skipped: stats.skipped,
        failedSources: (ctx.failedSources || []).map((f) => `${f.name}: ${f.error}`),
        sources: sourceStats,
      },
      null,
      2
    ) + '\n'
  );
}
