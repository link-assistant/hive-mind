import fs from 'node:fs';
import os from 'node:os';

export const RESOURCE_MARKER_PREFIX = '📈 [RESOURCES]';

export const RESOURCE_PHASE_SOLVE_START = 'solve_start';
export const RESOURCE_PHASE_AFTER_CLONE = 'after_clone';
export const RESOURCE_PHASE_AFTER_AGENT = 'after_agent';
export const RESOURCE_PHASE_SOLVE_EXIT = 'solve_exit';
export const RESOURCE_PHASE_RESTART_BEFORE = 'restart_before';
export const RESOURCE_PHASE_RESTART_AFTER = 'restart_after';
export const RESOURCE_PHASE_BOT_HEARTBEAT = 'bot_heartbeat';

const RESOURCE_PHASES_BY_PREFERENCE = [RESOURCE_PHASE_SOLVE_EXIT, RESOURCE_PHASE_AFTER_AGENT, RESOURCE_PHASE_RESTART_AFTER, RESOURCE_PHASE_AFTER_CLONE, RESOURCE_PHASE_SOLVE_START, RESOURCE_PHASE_RESTART_BEFORE];

function finiteNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function clampPercent(value) {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
}

function readLinuxMemAvailableBytes(readFileSync = fs.readFileSync, platform = process.platform) {
  if (platform !== 'linux') return null;
  try {
    const text = readFileSync('/proc/meminfo', 'utf8');
    const match = text.match(/^MemAvailable:\s+(\d+)\s+kB$/m);
    if (!match) return null;
    return Number.parseInt(match[1], 10) * 1024;
  } catch {
    return null;
  }
}

export function captureResourceSnapshot(options = {}) {
  const { phase = 'snapshot', diskPath = '/', now = () => new Date(), osImpl = os, fsImpl = fs, processImpl = process } = options;

  const timestamp = (() => {
    try {
      return now().toISOString();
    } catch {
      return new Date().toISOString();
    }
  })();

  const load = (() => {
    try {
      const values = osImpl.loadavg();
      return {
        load1: finiteNumber(values[0]),
        load5: finiteNumber(values[1]),
        load15: finiteNumber(values[2]),
      };
    } catch {
      return { load1: null, load5: null, load15: null };
    }
  })();

  const cpuCount = (() => {
    try {
      const cpus = osImpl.cpus();
      return Array.isArray(cpus) ? cpus.length : null;
    } catch {
      return null;
    }
  })();

  const totalMemoryBytes = (() => {
    try {
      return finiteNumber(osImpl.totalmem());
    } catch {
      return null;
    }
  })();

  const freeMemoryBytes = (() => {
    try {
      return finiteNumber(osImpl.freemem());
    } catch {
      return null;
    }
  })();

  const availableMemoryBytes = readLinuxMemAvailableBytes(fsImpl.readFileSync?.bind(fsImpl), processImpl.platform || process.platform) ?? freeMemoryBytes;
  const usedMemoryBytes = totalMemoryBytes !== null && availableMemoryBytes !== null ? Math.max(0, totalMemoryBytes - availableMemoryBytes) : null;

  const processMemory = (() => {
    try {
      const usage = processImpl.memoryUsage();
      return {
        rssBytes: finiteNumber(usage.rss),
        heapUsedBytes: finiteNumber(usage.heapUsed),
      };
    } catch {
      return { rssBytes: null, heapUsedBytes: null };
    }
  })();

  const disk = (() => {
    const path = String(diskPath || '/');
    try {
      if (typeof fsImpl.statfsSync !== 'function') {
        return { path, totalBytes: null, freeBytes: null, availableBytes: null, usedBytes: null, usedPercent: null, error: 'statfs unavailable' };
      }
      const stat = fsImpl.statfsSync(path);
      const blockSize = Number(stat.bsize || stat.frsize || 0);
      const blocks = Number(stat.blocks);
      const bfree = Number(stat.bfree);
      const bavail = Number(stat.bavail);
      const totalBytes = Number.isFinite(blockSize) && Number.isFinite(blocks) ? blockSize * blocks : null;
      const freeBytes = Number.isFinite(blockSize) && Number.isFinite(bfree) ? blockSize * bfree : null;
      const availableBytes = Number.isFinite(blockSize) && Number.isFinite(bavail) ? blockSize * bavail : freeBytes;
      const usedBytes = totalBytes !== null && freeBytes !== null ? Math.max(0, totalBytes - freeBytes) : null;
      const usedPercent = totalBytes && usedBytes !== null ? clampPercent((usedBytes / totalBytes) * 100) : null;
      return { path, totalBytes, freeBytes, availableBytes, usedBytes, usedPercent, error: null };
    } catch (error) {
      return {
        path,
        totalBytes: null,
        freeBytes: null,
        availableBytes: null,
        usedBytes: null,
        usedPercent: null,
        error: error?.message || String(error),
      };
    }
  })();

  return {
    phase: String(phase || 'snapshot'),
    timestamp,
    cpu: { ...load, cpuCount },
    memory: {
      totalBytes: totalMemoryBytes,
      freeBytes: freeMemoryBytes,
      availableBytes: availableMemoryBytes,
      usedBytes: usedMemoryBytes,
      processRssBytes: processMemory.rssBytes,
      processHeapUsedBytes: processMemory.heapUsedBytes,
    },
    disk,
  };
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '? B';
  const abs = Math.abs(bytes);
  if (abs >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (abs >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  if (abs >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes)} B`;
}

function formatNumber(value, decimals = 2) {
  return Number.isFinite(value) ? value.toFixed(decimals) : '?';
}

function encodeValue(value) {
  if (value === null || value === undefined) return 'null';
  return encodeURIComponent(String(value));
}

function numberField(name, value) {
  return Number.isFinite(value) ? `${name}=${value}` : `${name}=null`;
}

export function buildResourceMarker(snapshot) {
  const s = snapshot || {};
  const cpu = s.cpu || {};
  const memory = s.memory || {};
  const disk = s.disk || {};
  return [
    RESOURCE_MARKER_PREFIX,
    `phase=${encodeValue(s.phase || 'snapshot')}`,
    `ts=${encodeValue(s.timestamp || new Date().toISOString())}`,
    numberField('load1', cpu.load1),
    numberField('load5', cpu.load5),
    numberField('load15', cpu.load15),
    numberField('cpuCount', cpu.cpuCount),
    numberField('memTotalBytes', memory.totalBytes),
    numberField('memAvailableBytes', memory.availableBytes),
    numberField('memUsedBytes', memory.usedBytes),
    numberField('processRssBytes', memory.processRssBytes),
    `diskPath=${encodeValue(disk.path || '/')}`,
    numberField('diskTotalBytes', disk.totalBytes),
    numberField('diskAvailableBytes', disk.availableBytes),
    numberField('diskUsedBytes', disk.usedBytes),
    numberField('diskUsedPercent', disk.usedPercent),
    disk.error ? `error=${encodeValue(disk.error)}` : null,
    `mem=${encodeValue(`${formatBytes(memory.availableBytes)} available / ${formatBytes(memory.totalBytes)} total`)}`,
    `disk=${encodeValue(`${formatBytes(disk.availableBytes)} available / ${formatBytes(disk.totalBytes)} total`)}`,
  ]
    .filter(Boolean)
    .join(' ');
}

function parseNumber(value) {
  if (value === 'null' || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseMarkerLine(line) {
  const idx = line.indexOf(RESOURCE_MARKER_PREFIX);
  if (idx < 0) return null;
  const payload = line.slice(idx + RESOURCE_MARKER_PREFIX.length).trim();
  const parts = payload.split(/\s+/).filter(Boolean);
  const fields = {};
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    fields[part.slice(0, eq)] = part.slice(eq + 1);
  }
  const phase = decodeURIComponent(fields.phase || 'snapshot');
  return {
    phase,
    timestamp: decodeURIComponent(fields.ts || ''),
    cpu: {
      load1: parseNumber(fields.load1),
      load5: parseNumber(fields.load5),
      load15: parseNumber(fields.load15),
      cpuCount: parseNumber(fields.cpuCount),
    },
    memory: {
      totalBytes: parseNumber(fields.memTotalBytes),
      availableBytes: parseNumber(fields.memAvailableBytes),
      usedBytes: parseNumber(fields.memUsedBytes),
      processRssBytes: parseNumber(fields.processRssBytes),
    },
    disk: {
      path: decodeURIComponent(fields.diskPath || '/'),
      totalBytes: parseNumber(fields.diskTotalBytes),
      availableBytes: parseNumber(fields.diskAvailableBytes),
      usedBytes: parseNumber(fields.diskUsedBytes),
      usedPercent: parseNumber(fields.diskUsedPercent),
      error: fields.error ? decodeURIComponent(fields.error) : null,
    },
  };
}

export function parseResourceMarkers(logText) {
  if (typeof logText !== 'string' || !logText) return { markers: [], byPhase: {} };
  const markers = [];
  const byPhase = {};
  for (const line of logText.split(/\r?\n/)) {
    const marker = parseMarkerLine(line);
    if (!marker) continue;
    markers.push(marker);
    byPhase[marker.phase] = marker;
  }
  return { markers, byPhase };
}

export function selectBestDiskResourceMarker(parsed) {
  const byPhase = parsed?.byPhase || {};
  for (const phase of RESOURCE_PHASES_BY_PREFERENCE) {
    const marker = byPhase[phase];
    if (Number.isFinite(marker?.disk?.usedBytes)) return marker;
  }
  const markers = Array.isArray(parsed?.markers) ? parsed.markers : [];
  for (let i = markers.length - 1; i >= 0; i--) {
    if (Number.isFinite(markers[i]?.disk?.usedBytes)) return markers[i];
  }
  return null;
}

export function formatResourceSnapshotForLog(snapshot, label = null) {
  const s = snapshot || {};
  const phaseLabel = label || String(s.phase || 'snapshot').replace(/_/g, ' ');
  const cpu = s.cpu || {};
  const memory = s.memory || {};
  const disk = s.disk || {};
  const lines = [`📈 Resource usage (${phaseLabel}):`, `   CPU load: ${formatNumber(cpu.load1)} ${formatNumber(cpu.load5)} ${formatNumber(cpu.load15)}${Number.isFinite(cpu.cpuCount) ? ` (${cpu.cpuCount} CPUs)` : ''}`, `   Memory: ${formatBytes(memory.availableBytes)} available / ${formatBytes(memory.totalBytes)} total (${formatBytes(memory.usedBytes)} used)`, `   Process RSS: ${formatBytes(memory.processRssBytes)}${Number.isFinite(memory.processHeapUsedBytes) ? `, heap ${formatBytes(memory.processHeapUsedBytes)}` : ''}`, `   Disk (${disk.path || '/'}): ${formatBytes(disk.availableBytes)} available / ${formatBytes(disk.totalBytes)} total${Number.isFinite(disk.usedPercent) ? ` (${disk.usedPercent.toFixed(1)}% used)` : ''}`];
  if (disk.error) lines.push(`   Disk probe error: ${disk.error}`);
  lines.push(buildResourceMarker(snapshot));
  return lines.join('\n');
}

export async function recordResourceSnapshot({ phase, log, diskPath = '/', label = null, capture = captureResourceSnapshot } = {}) {
  if (typeof log !== 'function') return null;
  try {
    const snapshot = capture({ phase, diskPath });
    await log(formatResourceSnapshotForLog(snapshot, label));
    return snapshot;
  } catch (error) {
    await log(`⚠️  Resource usage measurement failed (${phase || 'snapshot'}): ${error?.message || error}`, { level: 'warning', verbose: true });
    return null;
  }
}

export function summarizeResourceSnapshot(snapshot) {
  if (!snapshot) return null;
  const cpu = snapshot.cpu || {};
  const memory = snapshot.memory || {};
  const disk = snapshot.disk || {};
  return {
    phase: snapshot.phase || null,
    timestamp: snapshot.timestamp || null,
    cpu: {
      load1: cpu.load1,
      load5: cpu.load5,
      load15: cpu.load15,
      cpuCount: cpu.cpuCount,
    },
    memory: {
      totalBytes: memory.totalBytes,
      availableBytes: memory.availableBytes,
      usedBytes: memory.usedBytes,
      processRssBytes: memory.processRssBytes,
    },
    disk: {
      path: disk.path,
      totalBytes: disk.totalBytes,
      availableBytes: disk.availableBytes,
      usedBytes: disk.usedBytes,
      usedPercent: disk.usedPercent,
      error: disk.error || null,
    },
  };
}
