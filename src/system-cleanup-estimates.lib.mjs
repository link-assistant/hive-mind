import fs from 'node:fs';
import path from 'node:path';

import { formatBytes } from './cleanup.lib.mjs';

const APT_ARCHIVES_PATH = '/var/cache/apt/archives';
const JOURNAL_ROOTS = ['/var/log/journal', '/run/log/journal'];

const UNIT_MULTIPLIERS = new Map([
  ['', 1],
  ['B', 1],
  ['BYTE', 1],
  ['BYTES', 1],
  ['K', 1024],
  ['KB', 1024],
  ['KIB', 1024],
  ['M', 1024 ** 2],
  ['MB', 1024 ** 2],
  ['MIB', 1024 ** 2],
  ['G', 1024 ** 3],
  ['GB', 1024 ** 3],
  ['GIB', 1024 ** 3],
  ['T', 1024 ** 4],
  ['TB', 1024 ** 4],
  ['TIB', 1024 ** 4],
  ['P', 1024 ** 5],
  ['PB', 1024 ** 5],
  ['PIB', 1024 ** 5],
]);

export function parseHumanBytes(value) {
  const match = String(value ?? '')
    .trim()
    .match(/^([0-9][0-9,]*(?:\.[0-9]+)?)\s*([KMGTPE]?i?B?|bytes?)?/i);
  if (!match) return null;
  const number = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(number)) return null;
  const unit = String(match[2] || 'B')
    .toUpperCase()
    .replace(/IB$/, 'IB');
  const multiplier = UNIT_MULTIPLIERS.get(unit);
  if (!multiplier) return null;
  return Math.round(number * multiplier);
}

export function parseDuBytes(output, blockSize = 1) {
  const token = String(output ?? '')
    .trim()
    .split(/\s+/)[0];
  const value = Number(token?.replace(/,/g, ''));
  return Number.isFinite(value) ? Math.round(value * blockSize) : null;
}

export function parseAptAutoremoveFreedBytes(output) {
  const text = String(output || '');
  const freed = text.match(/After this operation,\s+([0-9][0-9,]*(?:\.[0-9]+)?\s*[KMGTPE]?i?B?)\s+disk space will be freed/i);
  if (freed) return parseHumanBytes(freed[1]);
  if (/\b0\s+to\s+remove\b/i.test(text)) return 0;
  return null;
}

export function parseJournalDiskUsageBytes(output) {
  const match = String(output || '').match(/\btake up\s+([0-9][0-9,]*(?:\.[0-9]+)?\s*[KMGTPE]?i?B?)\b/i);
  return match ? parseHumanBytes(match[1]) : null;
}

export function parseDockerSystemDf(output) {
  const items = [];
  for (const line of String(output ?? '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || /^TYPE\s+/i.test(trimmed)) continue;
    const parts = trimmed.split(/\s{2,}/).filter(Boolean);
    if (parts.length < 5) continue;
    const reclaimable = parts[4];
    const reclaimableBytes = parseHumanBytes(reclaimable);
    if (reclaimableBytes == null) continue;
    items.push({
      type: parts[0],
      total: parts[1],
      active: parts[2],
      size: parts[3],
      reclaimable,
      reclaimableBytes,
    });
  }
  return {
    items,
    totalReclaimableBytes: items.reduce((sum, item) => sum + item.reclaimableBytes, 0),
  };
}

export function buildSystemCleanupPlan(options = {}) {
  const { apt = false, journal = false, docker = false, npm = false, journalVacuumTime = '2weeks', useSudo = false } = options;
  const sudo = useSudo ? ['sudo'] : [];
  const plan = [];
  if (apt) {
    plan.push({ action: 'apt-clean', category: 'apt', argv: [...sudo, 'apt-get', 'clean'] });
    plan.push({ action: 'apt-autoclean', category: 'apt', argv: [...sudo, 'apt-get', 'autoclean', '-y'] });
    plan.push({ action: 'apt-autoremove', category: 'apt', argv: [...sudo, 'apt-get', 'autoremove', '-y'] });
  }
  if (journal) {
    plan.push({
      action: 'journal-vacuum',
      category: 'journal',
      argv: [...sudo, 'journalctl', `--vacuum-time=${journalVacuumTime}`],
      journalVacuumTime,
    });
  }
  if (docker) plan.push({ action: 'docker-prune', category: 'docker', argv: ['docker', 'system', 'prune', '-f'] });
  if (npm) plan.push({ action: 'npm-cache-clean', category: 'npm', argv: ['npm', 'cache', 'clean', '--force'] });
  return plan;
}

function commandDisplay(argv) {
  return argv.join(' ');
}

function measurePathBytes(targetPath, execFn) {
  const exact = parseDuBytes(execFn('du', ['-sb', targetPath]));
  if (exact != null) return exact;
  const kib = parseDuBytes(execFn('du', ['-sk', targetPath]), 1024);
  if (kib != null) return kib;
  try {
    return fs.statSync(targetPath).size;
  } catch {
    return null;
  }
}

function parseDurationMs(spec) {
  let total = 0;
  const pattern = /([0-9]+(?:\.[0-9]+)?)\s*(microseconds?|usec|milliseconds?|msec|ms|seconds?|secs?|sec|s|minutes?|mins?|min|m|hours?|hrs?|hr|h|days?|d|weeks?|w|months?|years?|yrs?|yr|y)/gi;
  let match;
  while ((match = pattern.exec(String(spec || ''))) !== null) {
    const value = Number(match[1]);
    if (!Number.isFinite(value)) continue;
    const unit = match[2].toLowerCase();
    if (unit.startsWith('micro') || unit === 'usec') total += value / 1000;
    else if (unit.startsWith('milli') || unit === 'msec' || unit === 'ms') total += value;
    else if (unit === 'm' || unit.startsWith('min')) total += value * 60 * 1000;
    else if (unit === 'h' || unit.startsWith('h')) total += value * 60 * 60 * 1000;
    else if (unit === 'd' || unit.startsWith('day')) total += value * 24 * 60 * 60 * 1000;
    else if (unit === 'w' || unit.startsWith('week')) total += value * 7 * 24 * 60 * 60 * 1000;
    else if (unit.startsWith('month')) total += value * 30 * 24 * 60 * 60 * 1000;
    else if (unit === 'y' || unit.startsWith('yr') || unit.startsWith('year')) total += value * 365 * 24 * 60 * 60 * 1000;
    else total += value * 1000;
  }
  return total > 0 ? total : null;
}

function listJournalFiles(roots = JOURNAL_ROOTS) {
  const files = [];
  const stack = [...roots];
  while (stack.length > 0) {
    const current = stack.pop();
    let stat;
    try {
      stat = fs.statSync(current);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      let entries;
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) stack.push(path.join(current, entry.name));
    } else if (stat.isFile() && /\.journal~?$/.test(current)) {
      files.push({ path: current, size: stat.size, mtimeMs: stat.mtimeMs });
    }
  }
  return files;
}

function estimateJournalBytes({ execFn, journalVacuumTime, journalFiles, now }) {
  const currentBytes = parseJournalDiskUsageBytes(execFn('journalctl', ['--disk-usage']));
  const durationMs = parseDurationMs(journalVacuumTime);
  const files = journalFiles ?? listJournalFiles();
  if (!durationMs) {
    return {
      estimatedBytes: null,
      detail: currentBytes == null ? `unable to parse --vacuum-time=${journalVacuumTime}` : `current journal usage ${formatBytes(currentBytes)}`,
    };
  }
  if (files.length === 0 && currentBytes > 0 && journalFiles == null) {
    return {
      estimatedBytes: null,
      detail: `current journal usage ${formatBytes(currentBytes)}; journal files not readable`,
    };
  }
  const cutoff = new Date(now).getTime() - durationMs;
  const estimatedBytes = files.filter(file => Number(file.mtimeMs) < cutoff).reduce((sum, file) => sum + (Number(file.size) || 0), 0);
  const detail = currentBytes == null ? `journal files older than ${journalVacuumTime}` : `journal files older than ${journalVacuumTime}; current usage ${formatBytes(currentBytes)}`;
  return { estimatedBytes, detail };
}

function estimateDockerBytes(execFn) {
  const parsed = parseDockerSystemDf(execFn('docker', ['system', 'df']));
  if (parsed.items.length === 0) return { estimatedBytes: null, detail: 'docker system df unavailable' };
  const nonZero = parsed.items.filter(item => item.reclaimableBytes > 0);
  const detail = nonZero.length === 0 ? 'docker system df reclaimable: 0B' : `docker system df reclaimable: ${nonZero.map(item => `${item.type} ${formatBytes(item.reclaimableBytes)}`).join(', ')}`;
  return { estimatedBytes: parsed.totalReclaimableBytes, detail };
}

export function estimateSystemCleanupCommand(item, options = {}) {
  const execFn = options.execFn || (() => null);
  const command = commandDisplay(item.argv);

  if (item.action === 'apt-clean') {
    return { ...item, command, estimatedBytes: measurePathBytes(APT_ARCHIVES_PATH, execFn), detail: APT_ARCHIVES_PATH };
  }
  if (item.action === 'apt-autoclean') {
    return { ...item, command, estimatedBytes: 0, detail: 'already covered by apt-get clean' };
  }
  if (item.action === 'apt-autoremove') {
    const estimatedBytes = parseAptAutoremoveFreedBytes(execFn('apt-get', ['-s', 'autoremove']));
    return { ...item, command, estimatedBytes, detail: estimatedBytes == null ? 'apt-get -s autoremove unavailable' : 'apt-get -s autoremove' };
  }
  if (item.action === 'journal-vacuum') {
    return { ...item, command, ...estimateJournalBytes({ ...options, journalVacuumTime: item.journalVacuumTime }) };
  }
  if (item.action === 'docker-prune') {
    return { ...item, command, ...estimateDockerBytes(execFn) };
  }
  if (item.action === 'npm-cache-clean') {
    const cachePath = execFn('npm', ['config', 'get', 'cache']);
    const trimmedPath = cachePath ? cachePath.trim() : '';
    const estimatedBytes = trimmedPath ? measurePathBytes(trimmedPath, execFn) : null;
    return {
      ...item,
      command,
      estimatedBytes,
      detail: trimmedPath || 'npm cache path unavailable',
    };
  }
  return { ...item, command, estimatedBytes: null, detail: 'estimate unavailable' };
}

export function estimateSystemCleanupPlan(plan, options = {}) {
  return plan.map(item => estimateSystemCleanupCommand(item, options));
}

export function formatSystemCleanupEstimateLine(item) {
  const estimate = item.estimatedBytes == null ? '?' : `~${formatBytes(item.estimatedBytes)}`;
  const detail = item.detail ? `  (${item.detail})` : '';
  return `   ${item.command.padEnd(34)} ${estimate.padStart(8)}${detail}`;
}

export function formatSystemCleanupTotalLine(items) {
  const knownItems = items.filter(item => item.estimatedBytes != null);
  const total = knownItems.reduce((sum, item) => sum + item.estimatedBytes, 0);
  const unknown = knownItems.length < items.length ? ' (known estimates only)' : '';
  return `   estimated system reclaim:        ~${formatBytes(total)}${unknown}`;
}
