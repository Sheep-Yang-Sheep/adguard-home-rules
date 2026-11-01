#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
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
} from './render.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);
const offlineDir = (() => {
  const hit = argv.find((a) => a.startsWith('--offline'));
  if (!hit) return null;
  const [, val] = hit.split('=');
  if (val) return path.resolve(ROOT, val);
  const i = argv.indexOf(hit);
  return argv[i + 1] ? path.resolve(ROOT, argv[i + 1]) : null;
})();
const dryRun = argv.includes('--dry-run');

const n = (v) => Number(v).toLocaleString('en-US');
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

async function loadSource(src, config) {
  if (offlineDir) {
    const file = path.join(offlineDir, `${src.id}.txt`);
    if (!existsSync(file)) {
      return { src, ok: false, error: `离线模式缺少文件 ${file}` };
    }
    return { src, ok: true, text: readFileSync(file, 'utf8'), via: 'offline' };
  }

  try {
    const { text, via } = await fetchText(src.url, {
      timeoutMs: config.timeoutMs,
      retries: config.retries,
    });
    return { src, ok: true, text, via };
  } catch (err) {
    return { src, ok: false, error: err.message };
  }
}

async function main() {
  const config = JSON.parse(readFileSync(path.join(ROOT, 'sources.json'), 'utf8'));
  const repo = repoInfo(config);
  const runAtReal = new Date();
  const runAt = beijingNow(runAtReal);

  log(`[1/4] 抓取上游规则源（${config.sources.length} 个）${offlineDir ? ' · 离线模式' : ''}`);
  const fetched = await mapLimit(config.sources, config.concurrency || 4, (src) =>
    loadSource(src, config)
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
    parsedSources.push({ ...item.src, parsed });
    const via = item.via === 'offline' ? '离线文件' : item.via === item.src.url ? '直连' : '镜像';
    log(
      `  [OK]   ${item.src.name.padEnd(28, ' ')} 有效 ${n(parsed.effective).padStart(9, ' ')} 条  (${via})`
    );
  }

  const successRatio = parsedSources.length / config.sources.length;
  const minRatio = config.minSuccessRatio ?? 0.75;
  if (parsedSources.length === 0 || successRatio < minRatio) {
    log(
      `\n[ABORT] 成功源 ${parsedSources.length}/${config.sources.length} 低于阈值 ${minRatio}，放弃本次输出以免发布残缺规则。`
    );
    process.exit(1);
  }

  log(`\n[2/4] 解析完成，开始合并`);
  const result = mergeSources(parsedSources);

  log(
    `[3/4] 合并结果: ${n(result.stats.before)} 条 → 去重 ${n(
      result.stats.blockUnique + result.stats.allowUnique + result.stats.rawUnique
    )} 条 → 父域覆盖移除 ${n(result.stats.subsumeRemoved + result.stats.rawCovered)} 条 → 最终 ${n(result.stats.after)} 条`
  );

  const distPath = path.join(ROOT, repo.file);
  const readmePath = path.join(ROOT, 'README.md');
  const statusPath = path.join(ROOT, 'status.json');

  const oldRules = existsSync(distPath) ? readFileSync(distPath, 'utf8') : '';

  const newRules = renderRules(result, {
    updatedAt: runAt,
    runAt,
    homepage: repo.homepage,
    failedSources: failed,
  });

  const contentChanged = contentSignature(oldRules) !== contentSignature(newRules);

  // 保留上一次真实的内容更新时间：规则没动就不刷新时间戳，避免无意义的提交
  let finalRules = newRules;
  if (!contentChanged && oldRules) {
    finalRules = oldRules;
  }

  const readme = renderReadme(result, {
    updatedAt: contentChanged || !oldRules ? runAt : extractUpdatedAt(oldRules) || runAt,
    runAt,
    repo,
    failedSources: failed,
  });

  const status = renderStatus(result, {
    updatedAt: contentChanged || !oldRules ? runAt : extractUpdatedAt(oldRules) || runAt,
    runAt,
    runAtUtc: runAtReal.toISOString(),
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
  const [date, time] = m[1].split(' ');
  const weekday = '日一二三四五六'[new Date(`${date}T00:00:00Z`).getUTCDay()];
  return { minute: m[1], date, time, weekday, full: `${m[1]} (UTC+8)` };
}

main().catch((err) => {
  log(`[FATAL] ${err.stack || err.message}`);
  process.exit(1);
});
