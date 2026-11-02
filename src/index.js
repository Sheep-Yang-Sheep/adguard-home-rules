#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchText, mapLimit } from './network.js';
import { parseList } from './parser.js';
import { mergeSources } from './merger.js';
import {
  beijingNow,
  repoInfo,
  renderRules,
  renderReadme,
  renderStatus,
  contentSignature,
  verifyRenderedRules,
} from './render.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);

/**
 * 解析 `--xxx=DIR` / `--xxx DIR` 形式的目录参数
 * @returns {string|null} 绝对路径，未指定时返回 null
 */
function dirArg(name) {
  const hit = argv.find((a) => a.startsWith(`--${name}`));
  if (!hit) return null;
  const [, val] = hit.split('=');
  if (val) return path.resolve(ROOT, val);
  const i = argv.indexOf(hit);
  const next = argv[i + 1];
  // `--offline` 后面若跟的是另一个开关，说明忘了给目录，按未启用处理
  return next && !next.startsWith('--') ? path.resolve(ROOT, next) : null;
}

const offlineDir = dirArg('offline');
// 把本轮抓到的原文落盘；配合 --offline 就能断网复盘上一次的结果
const cacheDir = dirArg('cache');
const dryRun = argv.includes('--dry-run');

const n = (v) => Number(v).toLocaleString('en-US');
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
const pct = (v) => `${(v * 100).toFixed(0)}%`;

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

async function loadSource(src, config, deadline) {
  if (offlineDir) {
    const file = path.join(offlineDir, `${src.id}.txt`);
    if (!existsSync(file)) {
      return { src, ok: false, error: `离线模式缺少文件 ${file}（先用 --cache=${path.basename(offlineDir)} 抓一次）` };
    }
    return { src, ok: true, text: readFileSync(file, 'utf8'), via: 'offline' };
  }

  // 单源预算：并发数小于源数时，一个慢源可能吃光全局预算，把后面的源全部挤成
  // 「已超预算」。给每个源封顶，保证每个源都有公平的抓取机会。
  // 注意必须大于「一轮候选地址的最坏耗时」（候选数 × timeoutMs），否则源还没轮完
  // 镜像就被判失败——raw.githubusercontent 在境内不可达时每个候选都要等满超时。
  const perSourceMs = config.perSourceBudgetMs ?? 8 * 60 * 1000;
  const sourceDeadline = Math.min(deadline, Date.now() + perSourceMs);
  const budgetScope = sourceDeadline < deadline ? '单源' : '全局';

  try {
    const { text, via } = await fetchText(src.url, {
      timeoutMs: config.timeoutMs,
      retries: config.retries,
      deadline: sourceDeadline,
      budgetScope,
    });
    if (cacheDir) {
      // 缓存失败不能影响本轮合并：抓到就是赚到，写不进去只是下次不能离线复盘
      try {
        mkdirSync(cacheDir, { recursive: true });
        writeFileSync(path.join(cacheDir, `${src.id}.txt`), text, 'utf8');
      } catch (err) {
        log(`  [WARN] 缓存写入失败 ${src.id}: ${err.message}`);
      }
    }
    return { src, ok: true, text, via };
  } catch (err) {
    return { src, ok: false, error: err.message };
  }
}

/**
 * 内容指纹：只取归一化后的域名集合，忽略注释 / 空行 / 排序差异。
 * 用来识别「两个地址其实是同一份内容」的镜像源。
 */
function fingerprint(parsed) {
  const h = createHash('sha256');
  h.update(parsed.block.map((r) => r.domain).sort().join('\n'));
  h.update('\u0000');
  h.update(parsed.allow.map((r) => r.domain).sort().join('\n'));
  h.update('\u0000');
  h.update([...parsed.raw].sort().join('\n'));
  return h.digest('hex').slice(0, 16);
}

/**
 * 单源体检：抓到了内容不代表内容是对的。
 *
 * 镜像挂掉时经常返回 200 + 一张错误页，或者返回被截断的前半段；
 * 只要和上一轮的有效规则数相比骤降，就判定该源本次失败，不纳入合并。
 */
function checkSourceHealth(src, parsed, prevSourceStats, config) {
  if (parsed.effective === 0) return '解析后 0 条有效规则';

  const prev = prevSourceStats[src.id];
  if (typeof prev !== 'number' || prev <= 0) return null; // 没有基线，跳过

  const minRetention = config.minSourceRetention ?? 0.5;
  const ratio = parsed.effective / prev;
  if (ratio < minRetention) {
    return `规则数骤降 ${n(parsed.effective)} 条，上轮 ${n(prev)} 条（${pct(ratio)} < ${pct(
      minRetention
    )}），疑似上游异常或抓到残缺内容`;
  }
  return null;
}

async function main() {
  const config = readJson(path.join(ROOT, 'sources.json'));
  if (!config) throw new Error('sources.json 缺失或不是合法 JSON');

  const repo = repoInfo(config);
  const runAtReal = new Date();
  const runAt = beijingNow(runAtReal);

  const statusPath = path.join(ROOT, 'status.json');
  const prevStatus = readJson(statusPath);
  const prevSourceStats = (prevStatus && prevStatus.sources) || {};

  // 全局抓取预算：所有源共享，超出就立刻收尾，避免把 job 时间跑穿后什么都不提交
  const budgetMs = config.fetchBudgetMs ?? 12 * 60 * 1000;
  const deadline = runAtReal.getTime() + budgetMs;

  const upstreamOf = (s) => s.upstream || s.id;
  const totalUpstreams = new Set(config.sources.map(upstreamOf));

  log(
    `[1/4] 抓取上游规则源（${config.sources.length} 个地址 / ${totalUpstreams.size} 个独立上游）` +
      `${offlineDir ? ' · 离线模式' : ''} · 预算 ${Math.round(budgetMs / 60000)} 分钟`
  );

  const fetched = await mapLimit(config.sources, config.concurrency || 4, (src) =>
    loadSource(src, config, deadline)
  );

  const failed = [];
  const parsedSources = [];

  for (const item of fetched) {
    if (!item.ok) {
      failed.push({ name: item.src.name, url: item.src.url, error: item.error });
      log(`  [FAIL] ${item.src.name} — ${item.error}`);
      continue;
    }

    const parsed = parseList(item.text);
    const healthError = checkSourceHealth(item.src, parsed, prevSourceStats, config);
    if (healthError) {
      failed.push({ name: item.src.name, url: item.src.url, error: healthError });
      log(`  [FAIL] ${item.src.name} — ${healthError}`);
      continue;
    }

    parsedSources.push({ ...item.src, parsed });
    const via = item.via === 'offline' ? '离线文件' : item.via === item.src.url ? '直连' : '镜像';
    log(
      `  [OK]   ${item.src.name.padEnd(28, ' ')} 有效 ${n(parsed.effective).padStart(9, ' ')} 条  (${via})`
    );
  }

  // 内容指纹 + 上游分组去重。
  // adrules.top 与 Cats-Team raw 是两个地址、同一份上游规则：抓两份是为了冗余，
  // 但只能有一份进入合并，否则「合并前规则数」凭空虚高十几万条，
  // 而且镜像若返回了滞后的旧版本，还会把上游已经删掉的规则重新带回来。
  const byFingerprint = new Map();
  const byUpstream = new Map();
  for (const src of parsedSources) {
    const fp = fingerprint(src.parsed);
    src.fingerprint = fp;
    const up = upstreamOf(src);

    const sameContent = byFingerprint.get(fp);
    if (sameContent) {
      src.mirror = true;
      src.mirrorOf = sameContent.name;
      log(`  [镜像] ${src.name} 与「${sameContent.name}」内容完全相同，仅作备份`);
      continue;
    }
    byFingerprint.set(fp, src);

    const sameUpstream = byUpstream.get(up);
    if (sameUpstream) {
      src.mirror = true;
      src.mirrorOf = sameUpstream.name;
      log(`  [备份] ${src.name} 与「${sameUpstream.name}」属同一上游，本次仅作备份不参与合并`);
      continue;
    }
    byUpstream.set(up, src);
  }

  // 按「独立上游」而不是「地址条数」算成功率。
  // 否则同一上游挂多个镜像条目会被重复扣分，阈值形同虚设。
  const okUpstreams = new Set(parsedSources.map(upstreamOf));
  const successRatio = okUpstreams.size / totalUpstreams.size;
  const minRatio = config.minSuccessRatio ?? 0.75;

  if (parsedSources.length === 0 || successRatio < minRatio) {
    const missing = [...totalUpstreams].filter((u) => !okUpstreams.has(u));
    log(
      `\n[ABORT] 上游成功 ${okUpstreams.size}/${totalUpstreams.size}（${pct(
        successRatio
      )}）低于阈值 ${pct(minRatio)}，放弃本次输出以免发布残缺规则。`
    );
    log(`        缺失上游: ${missing.join(', ')}`);
    process.exit(1);
  }

  log(`\n[2/4] 解析完成（上游 ${okUpstreams.size}/${totalUpstreams.size}），开始合并`);
  const result = mergeSources(parsedSources);

  const s = result.stats;
  log(
    `[3/4] 合并结果: ${n(s.before)} 条 → 去重 ${n(
      s.blockUnique + s.allowUnique + s.rawUnique
    )} 条 → 父域覆盖移除 ${n(s.subsumeRemoved + s.rawCovered)} 条 → 最终 ${n(s.after)} 条`
  );
  log(
    `      体检: 白名单架空屏蔽 ${n(s.allowShadowed)} 条 · 同域冲突 ${n(
      s.conflicts
    )} 条（其中 $important 压制 ${n(s.importantOverAllow)} 条）· 解析丢弃 ${n(
      s.skippedTotal
    )} 行`
  );

  const distPath = path.join(ROOT, repo.file);
  const readmePath = path.join(ROOT, 'README.md');

  const oldRules = existsSync(distPath) ? readFileSync(distPath, 'utf8') : '';

  const newRules = renderRules(result, {
    updatedAt: runAt,
    runAt,
    homepage: repo.homepage,
    failedSources: failed,
  });

  // 发布前自检：宁可本轮失败，也不要把 AdGuard Home 加载不了的文件推给订阅者
  const { bad } = verifyRenderedRules(newRules, result.raw);
  if (bad.length) {
    log('[ABORT] 产物自检未通过，以下行不是合法规则：');
    for (const line of bad) log(`        ${line}`);
    process.exit(1);
  }

  const contentChanged = contentSignature(oldRules) !== contentSignature(newRules);

  // 保留上一次真实的内容更新时间：规则没动就不刷新时间戳，避免无意义的提交
  const finalRules = !contentChanged && oldRules ? oldRules : newRules;
  const previousUpdatedAt = extractUpdatedAt(oldRules);
  const effectiveUpdatedAt =
    contentChanged || !oldRules ? runAt : previousUpdatedAt || runAt;

  const readme = renderReadme(result, {
    updatedAt: effectiveUpdatedAt,
    runAt,
    repo,
    failedSources: failed,
  });

  // 失败源的基线必须留下来：只写本轮成功的源，下一轮「规则数骤降」检测会因为
  // 找不到基线而直接跳过，等于连续两次异常就没有任何防护。
  const configuredIds = new Set(config.sources.map((s) => s.id));
  const sourceStats = {};
  for (const [id, value] of Object.entries(prevSourceStats)) {
    if (configuredIds.has(id) && typeof value === 'number') sourceStats[id] = value;
  }
  for (const s of result.sources) sourceStats[s.id] = s.effective;

  // 内容没变时，沿用上一次「内容真正变化」的 UTC 时间戳，而不是本轮 run 时间
  const contentUpdatedAtUtc =
    contentChanged || !oldRules
      ? runAtReal.toISOString()
      : (prevStatus && prevStatus.updatedAtUtc) || runAtReal.toISOString();

  const status = renderStatus(result, {
    updatedAt: effectiveUpdatedAt,
    runAt,
    runAtUtc: runAtReal.toISOString(),
    contentUpdatedAtUtc,
    sourceStats,
    failedSources: failed,
  });

  if (dryRun) {
    log('[4/4] dry-run，未写入任何文件');
    log(`  dist 将写入 ${n(finalRules.length)} 字符，内容变化: ${contentChanged ? '是' : '否'}`);
    return;
  }

  if (!existsSync(path.dirname(distPath))) mkdirSync(path.dirname(distPath), { recursive: true });
  if (contentChanged || !oldRules) {
    writeFileSync(distPath, finalRules, 'utf8');
    log(`[4/4] 写入 ${repo.file} · ${mb(statSync(distPath).size)}`);
  } else {
    log(`[4/4] 规则内容无变化，保留原文件 ${repo.file}`);
  }

  writeFileSync(readmePath, readme, 'utf8');
  writeFileSync(statusPath, status, 'utf8');
  log(`      写入 README.md / status.json · 北京时间 ${runAt.minute}`);
}

function extractUpdatedAt(text) {
  const m = /本合集更新时间（北京时间 UTC\+8）:\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/.exec(text);
  if (!m) return null;
  const [date] = m[1].split(' ');
  const weekday = '日一二三四五六'[new Date(`${date}T00:00:00Z`).getUTCDay()];
  return { minute: m[1], date, weekday, full: `${m[1]} (UTC+8)` };
}

main().catch((err) => {
  log(`[FATAL] ${err.stack || err.message}`);
  process.exit(1);
});
