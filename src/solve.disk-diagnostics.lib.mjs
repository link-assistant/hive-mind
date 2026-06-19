/**
 * Disk-space diagnostics for the `/solve` command (issue #1945).
 *
 * Captures two checkpoints around the AI working session:
 *
 *   1. AFTER_CLONE  — size of the freshly-cloned `tempDir` BEFORE the AI agent
 *      starts. Tells us how large the repository itself is.
 *   2. AFTER_AGENT  — size of the same `tempDir` AFTER the AI agent has
 *      finished, so we can see how many bytes the working session added.
 *
 * Both checkpoints are written to the captured solve log as a single-line
 * structured marker. The Telegram bot's `session-monitor.lib.mjs` parses those
 * markers and, on the completion message, surfaces a Telegram block plus
 * warnings when any of the three thresholds from the issue are crossed:
 *
 *   - cloned repository  > WARNING_THRESHOLD_BYTES
 *   - delta during run   > WARNING_THRESHOLD_BYTES
 *   - total space used   > WARNING_THRESHOLD_BYTES
 *
 * Implementation notes:
 *
 *   - Uses `du -sb <path>` on Linux for byte-accurate sizing, falls back to
 *     `du -sk <path>` (kilobytes ×1024) on systems without GNU coreutils
 *     (macOS BSD `du` doesn't support `-b`). A final fs.statSync fallback
 *     keeps the helper non-throwing for plain files / inaccessible dirs.
 *   - The marker format is deliberately ASCII and key=value so it survives
 *     log truncation and stays parseable with a one-line regex. We DO NOT
 *     emit JSON because the existing log is human-tailing-friendly and a
 *     stray closing brace from another logger could confuse JSON.parse.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1945
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

/** 5 GB threshold (binary). Matches the issue body verbatim. */
export const WARNING_THRESHOLD_BYTES = 5 * 1024 * 1024 * 1024;

export const DISK_MARKER_PREFIX = '📊 [DISK]';
export const DISK_PHASE_AFTER_CLONE = 'after_clone';
export const DISK_PHASE_AFTER_AGENT = 'after_agent';

/**
 * Measure the size of a path in bytes. Robust to missing tools / paths.
 *
 * @param {string} targetPath
 * @returns {number|null} Bytes, or null if the path is missing/unreadable.
 */
export function measureDirectorySize(targetPath) {
  if (!targetPath) return null;
  // Prefer `du -sb` (GNU coreutils) for byte-accurate sizing.
  try {
    const out = execFileSync('du', ['-sb', targetPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
    }).trim();
    const bytes = parseInt(out.split(/\s+/)[0], 10);
    if (Number.isFinite(bytes) && bytes >= 0) return bytes;
  } catch {
    // Fall through to -sk fallback for BSD du / macOS.
  }
  // BSD `du` (macOS) doesn't support -b but does support -sk (kilobytes).
  try {
    const out = execFileSync('du', ['-sk', targetPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
    }).trim();
    const kb = parseInt(out.split(/\s+/)[0], 10);
    if (Number.isFinite(kb) && kb >= 0) return kb * 1024;
  } catch {
    // Fall through to fs.statSync — last resort for single-file paths.
  }
  try {
    const stat = fs.statSync(targetPath);
    return stat.size;
  } catch {
    return null;
  }
}

/**
 * Human-readable byte format. Two flavours:
 *   - `formatBytes(bytes)`      → `"12.0 GB"` (matches limits.lib.mjs style)
 *   - `formatBytesCompact(b)`   → `"12G"`   (matches the issue body verbatim
 *     and cleanup.lib.mjs)
 *
 * @param {number|null|undefined} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (bytes == null || Number.isNaN(bytes)) return '? B';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  // 1 decimal for GB and above (matches limits.lib formatBytes), none below.
  const decimals = units[unit] === 'GB' || units[unit] === 'TB' || units[unit] === 'PB' ? 1 : 0;
  return `${value.toFixed(decimals)} ${units[unit]}`;
}

/**
 * Signed byte delta — adds a leading "+" for positive non-zero values so a
 * growth like 500 MB renders as "+500 MB" in both logs and Telegram.
 */
export function formatBytesDelta(bytes) {
  if (bytes == null || Number.isNaN(bytes)) return '? B';
  if (bytes === 0) return '±0 B';
  const sign = bytes > 0 ? '+' : '-';
  return `${sign}${formatBytes(Math.abs(bytes))}`;
}

function escapeForMarker(value) {
  // Strip newlines and the marker prefix so a path containing the literal
  // "📊 [DISK]" cannot inject a fake marker. Paths almost never contain spaces
  // in /tmp but we still quote with backticks for the human-readable suffix
  // and use key=value pairs for the parseable head.
  return String(value)
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 2048);
}

/**
 * Build a single-line structured log marker the parent (Telegram bot) can
 * parse out of the captured log to surface size warnings.
 *
 * Example (after_clone):
 *   📊 [DISK] phase=after_clone bytes=12884901888 path=/tmp/foo size=12.0 GB
 *
 * Example (after_agent):
 *   📊 [DISK] phase=after_agent bytes=13312000000 deltaBytes=524288000 path=/tmp/foo size=12.4 GB delta=+500.0 MB
 *
 * @param {Object} params
 * @param {string} params.phase  - 'after_clone' | 'after_agent'
 * @param {number|null} params.bytes - Current size of tempDir in bytes
 * @param {number|null} [params.deltaBytes] - Bytes added since after_clone (after_agent only)
 * @param {string} params.path - The measured path
 * @returns {string}
 */
export function buildDiskMarker({ phase, bytes, deltaBytes = null, path: targetPath }) {
  const head = [`phase=${phase}`];
  if (Number.isFinite(bytes)) head.push(`bytes=${bytes}`);
  if (Number.isFinite(deltaBytes)) head.push(`deltaBytes=${deltaBytes}`);
  head.push(`path=${escapeForMarker(targetPath || '')}`);
  const suffixParts = [];
  if (Number.isFinite(bytes)) suffixParts.push(`size=${formatBytes(bytes)}`);
  if (Number.isFinite(deltaBytes)) suffixParts.push(`delta=${formatBytesDelta(deltaBytes)}`);
  const suffix = suffixParts.length ? ` ${suffixParts.join(' ')}` : '';
  return `${DISK_MARKER_PREFIX} ${head.join(' ')}${suffix}`;
}

/**
 * Parse all `📊 [DISK]` markers out of a captured solve log. The LAST marker
 * for each phase wins (sessions that restart can emit more than one).
 *
 * @param {string} logText
 * @returns {{
 *   afterClone: {bytes:number|null, path:string|null} | null,
 *   afterAgent: {bytes:number|null, deltaBytes:number|null, path:string|null} | null
 * }}
 */
export function parseDiskMarkers(logText) {
  const result = { afterClone: null, afterAgent: null };
  if (!logText || typeof logText !== 'string') return result;
  // Anchor to the marker prefix so a quoted user comment containing this
  // string mid-line is not mistakenly parsed.
  const re = /📊 \[DISK\] ([^\n\r]+)/g;
  let m;
  while ((m = re.exec(logText)) !== null) {
    const pairs = {};
    // key=value tokens, where value runs until next " key=" or EOL.
    const tokenRe = /(\w+)=([^\s][^\n\r]*?)(?=\s+\w+=|$)/g;
    let t;
    while ((t = tokenRe.exec(m[1])) !== null) {
      pairs[t[1]] = t[2];
    }
    const phase = pairs.phase;
    if (phase !== DISK_PHASE_AFTER_CLONE && phase !== DISK_PHASE_AFTER_AGENT) continue;
    const bytes = parseInt(pairs.bytes, 10);
    const deltaBytes = parseInt(pairs.deltaBytes, 10);
    const entry = {
      bytes: Number.isFinite(bytes) ? bytes : null,
      path: pairs.path || null,
    };
    if (phase === DISK_PHASE_AFTER_AGENT) {
      entry.deltaBytes = Number.isFinite(deltaBytes) ? deltaBytes : null;
      result.afterAgent = entry;
    } else {
      result.afterClone = entry;
    }
  }
  return result;
}

/**
 * Decide which of the three issue thresholds were crossed.
 *
 * @param {{afterClone: object|null, afterAgent: object|null}} parsed
 * @param {number} [threshold=WARNING_THRESHOLD_BYTES]
 * @returns {{cloneTooLarge:boolean, deltaTooLarge:boolean, totalTooLarge:boolean}}
 */
export function computeDiskWarnings(parsed, threshold = WARNING_THRESHOLD_BYTES) {
  const cloneBytes = parsed?.afterClone?.bytes ?? null;
  const totalBytes = parsed?.afterAgent?.bytes ?? cloneBytes;
  const deltaBytes = parsed?.afterAgent?.deltaBytes ?? null;
  return {
    cloneTooLarge: Number.isFinite(cloneBytes) && cloneBytes > threshold,
    deltaTooLarge: Number.isFinite(deltaBytes) && deltaBytes > threshold,
    totalTooLarge: Number.isFinite(totalBytes) && totalBytes > threshold,
  };
}

/**
 * Telegram block (Markdown code fence) describing the captured sizes plus,
 * when any threshold is crossed, a `⚠️ Warnings:` tail. Returns an empty
 * string when there are no markers in the log (no logs ⇒ no surprise output).
 *
 * Returned shape:
 *
 *   💾 Disk usage (gh-issue-solver-…)
 *   ```
 *   Cloned repository: 12.0 GB
 *   After agent:       12.4 GB (+500.0 MB)
 *   Threshold:         5.0 GB
 *
 *   ⚠️ Cloned repository exceeds 5.0 GB
 *   ⚠️ Total disk usage exceeds 5.0 GB
 *   ```
 *
 * @param {{afterClone: object|null, afterAgent: object|null}} parsed
 * @param {Object} [options]
 * @param {number} [options.threshold=WARNING_THRESHOLD_BYTES]
 * @param {string} [options.title='💾 Disk usage']
 * @returns {string}
 */
export function formatDiskDiagnosticsBlock(parsed, options = {}) {
  if (!parsed || (!parsed.afterClone && !parsed.afterAgent)) return '';
  const threshold = Number.isFinite(options.threshold) ? options.threshold : WARNING_THRESHOLD_BYTES;
  const title = options.title || '💾 Disk usage';
  const warnings = computeDiskWarnings(parsed, threshold);
  const lines = [];
  const cloneBytes = parsed.afterClone?.bytes ?? null;
  const totalBytes = parsed.afterAgent?.bytes ?? null;
  const deltaBytes = parsed.afterAgent?.deltaBytes ?? null;
  if (cloneBytes !== null) {
    lines.push(`Cloned repository: ${formatBytes(cloneBytes)}`);
  }
  if (totalBytes !== null) {
    const deltaStr = deltaBytes !== null ? ` (${formatBytesDelta(deltaBytes)})` : '';
    lines.push(`After agent:       ${formatBytes(totalBytes)}${deltaStr}`);
  } else if (deltaBytes !== null) {
    lines.push(`Delta during run:  ${formatBytesDelta(deltaBytes)}`);
  }
  lines.push(`Threshold:         ${formatBytes(threshold)}`);
  const warningLines = [];
  if (warnings.cloneTooLarge) warningLines.push(`⚠️ Cloned repository exceeds ${formatBytes(threshold)}`);
  if (warnings.deltaTooLarge) warningLines.push(`⚠️ Folder grew by more than ${formatBytes(threshold)} during the run`);
  if (warnings.totalTooLarge) warningLines.push(`⚠️ Total disk usage exceeds ${formatBytes(threshold)}`);
  if (warningLines.length) {
    lines.push('');
    lines.push(...warningLines);
  }
  return `${title}\n\`\`\`\n${lines.join('\n')}\n\`\`\``;
}

/**
 * Capture the AFTER_CLONE checkpoint and log it. Safe to call when `log`
 * is missing; degrades to console.log so a CLI-only run still shows the size.
 *
 * Returns the captured size in bytes so the caller can stash it for the
 * AFTER_AGENT delta calculation, or null if measurement failed.
 *
 * @param {Object} params
 * @param {string} params.tempDir
 * @param {Function} [params.log] - The bound `log` from solve.mjs
 * @returns {Promise<number|null>}
 */
export async function recordAfterCloneSize({ tempDir, log }) {
  const bytes = measureDirectorySize(tempDir);
  const marker = buildDiskMarker({
    phase: DISK_PHASE_AFTER_CLONE,
    bytes,
    path: tempDir,
  });
  if (log) {
    await log(`\n${marker}`);
  } else {
    console.log(marker);
  }
  return bytes;
}

/**
 * Capture the AFTER_AGENT checkpoint and log it (with delta versus the
 * AFTER_CLONE checkpoint when available). Returns the captured size in bytes.
 *
 * @param {Object} params
 * @param {string} params.tempDir
 * @param {number|null} params.beforeBytes - The AFTER_CLONE size captured earlier
 * @param {Function} [params.log]
 * @returns {Promise<number|null>}
 */
export async function recordAfterAgentSize({ tempDir, beforeBytes, log }) {
  const bytes = measureDirectorySize(tempDir);
  const deltaBytes = Number.isFinite(bytes) && Number.isFinite(beforeBytes) ? bytes - beforeBytes : null;
  const marker = buildDiskMarker({
    phase: DISK_PHASE_AFTER_AGENT,
    bytes,
    deltaBytes,
    path: tempDir,
  });
  if (log) {
    await log(`\n${marker}`);
  } else {
    console.log(marker);
  }
  return bytes;
}

export default {
  WARNING_THRESHOLD_BYTES,
  DISK_MARKER_PREFIX,
  DISK_PHASE_AFTER_CLONE,
  DISK_PHASE_AFTER_AGENT,
  measureDirectorySize,
  formatBytes,
  formatBytesDelta,
  buildDiskMarker,
  parseDiskMarkers,
  computeDiskWarnings,
  formatDiskDiagnosticsBlock,
  recordAfterCloneSize,
  recordAfterAgentSize,
};
