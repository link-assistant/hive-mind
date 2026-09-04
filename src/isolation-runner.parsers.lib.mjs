/**
 * Parsers for start-command (`$`) output.
 *
 * Extracted from src/isolation-runner.lib.mjs (issue #2175) so that file stays
 * under the 1350-line early-warning threshold that protects concurrent merges
 * (#1593). Behaviour is unchanged, and isolation-runner.lib.mjs re-exports
 * every symbol so existing importers are unaffected.
 *
 * These are pure functions over `$ --status` / `$ --list` output and execution
 * log tails: no process spawning, and no filesystem access beyond the
 * injectable `fsImpl` used to read a log footer.
 */

import fs from 'fs';

// Sentinel start-command's detached docker logger records when it cannot capture the container's real exit code. A terminal `$ --status` carrying this value is ambiguous — the container may still be running — so we cross-check it against a live `docker inspect` before concluding the session finished. See #1939. The upstream emission of this premature sentinel was fixed in start-command 0.29.1 (link-foundation/start#136), which the Hive Mind images now pin; this cross-check is retained as defense-in-depth so an older `$` on an operator's PATH cannot resurrect the bug.
const DOCKER_UNKNOWN_EXIT_CODE = -1;
function normalizeProcessIds(value) {
  if (!value || typeof value !== 'object') return {};
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    const number = Number(raw);
    if (Number.isInteger(number) && number > 0) out[key] = number;
  }
  return out;
}
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * Extract start-command's own execution UUID from a launch banner.
 *
 * Issue #2154: an isolated task has two UUIDs. Hive Mind generates the session
 * name and passes it as `--session` (it also becomes the container name);
 * start-command mints a separate execution UUID and prints it as the `session`
 * field of its launch banner:
 *
 * ```
 * │ session   edc7b051-e12f-4f7b-b677-c885f3208407
 * │ container 0a3627ef-f1f1-4801-a073-3678b9453db7
 * ```
 *
 * `$ --list` shows the execution UUID, while Telegram and the logs showed the
 * session UUID, so the two views could not be joined — which is why three
 * refused tasks and two healthy ones looked equally unaccounted for. Returning
 * it lets the caller record both.
 *
 * Only a well-formed UUID is returned; a banner we do not recognise yields
 * null rather than a guess, because a wrong correlation is worse than none.
 *
 * @param {string} output - Raw stdout from the detached `$` launch
 * @returns {string|null}
 */
export function parseStartCommandExecutionUuid(output) {
  const raw = (output || '').trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const data = Array.isArray(parsed) ? parsed[0] : parsed;
    const uuid = data?.uuid || data?.session || null;
    if (typeof uuid === 'string' && UUID_PATTERN.test(uuid.trim())) return uuid.trim();
  } catch {
    // Human-readable banner — fall through.
  }
  // The banner is box-drawn (`│ session   <uuid>`); tolerate the prefix, an
  // ASCII `|`, or no prefix at all.
  const match = raw.match(/^[\s│|]*session\s+([^\s]+)\s*$/im);
  const candidate = match?.[1]?.trim();
  return candidate && UUID_PATTERN.test(candidate) ? candidate : null;
}
/**
 * Parse output from `$ --status <session>`.
 *
 * start-command versions used in the wild may return JSON when
 * `--output-format json` is supported, or human-readable key/value text.
 * Keep the parser tolerant so completion monitoring survives either format.
 *
 * start-command 0.33.0 (link-foundation/start#164, #165) added three additive
 * hint fields to a finished record: `exitReason` (e.g.
 * `memory-exhaustion (v8-heap-limit)` or `signal (SIGSEGV)`),
 * `memoryExhausted` and `memoryExhaustedReason` (the log line carrying the
 * evidence). They are hints, never verdicts — upstream never lets them change
 * `status`, `exitCode` or `oomKilled` — and they are absent on older `$`
 * binaries, so they are parsed as nullable and every consumer keeps its own
 * log-marker classification as defense in depth (issue #2189).
 *
 * @param {string} output - Raw stdout from `$ --status`
 * @returns {{exists: boolean, uuid: string|null, status: string|null, exitCode: number|null, startTime: string|null, endTime: string|null, currentTime: string|null, logPath: string|null, command: string|null, isolation: string|null, workingDirectory: string|null, sessionName: string|null, processIds: Object, oomKilled: boolean|null, exitReason: string|null, memoryExhausted: boolean|null, memoryExhaustedReason: string|null, raw: string}}
 */
export function parseSessionStatusOutput(output) {
  const raw = (output || '').trim();
  if (!raw) {
    return { exists: false, uuid: null, status: null, exitCode: null, startTime: null, endTime: null, currentTime: null, logPath: null, command: null, isolation: null, workingDirectory: null, sessionName: null, processIds: {}, oomKilled: null, exitReason: null, memoryExhausted: null, memoryExhaustedReason: null, raw: '' };
  }
  const normalizeBooleanField = value => {
    if (typeof value === 'boolean') return value;
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim().toLowerCase();
    if (['true', '1', 'yes'].includes(normalized)) return true;
    if (['false', '0', 'no'].includes(normalized)) return false;
    return null;
  };
  try {
    const parsed = JSON.parse(raw);
    const data = Array.isArray(parsed) ? parsed[0] : parsed;
    // start-command (link-foundation/start) reports the isolation backend at `options.isolated` in both JSON and links-notation output. Older hypothetical layouts used `options.isolation` or a top-level `isolation` field — keep accepting all three so we are tolerant of future renames. See https://github.com/link-assistant/hive-mind/issues/1700.
    const isolationCandidate = (typeof data?.isolation === 'string' && data.isolation) || (typeof data?.options?.isolated === 'string' && data.options.isolated) || (typeof data?.options?.isolation === 'string' && data.options.isolation) || null;
    const topPid = Number(data?.pid);
    const processIds = normalizeProcessIds(data?.processIds);
    if (Number.isInteger(topPid) && topPid > 0 && processIds.pid == null) processIds.pid = topPid;
    return {
      exists: true,
      uuid: data?.uuid || null,
      status: typeof data?.status === 'string' ? data.status.toLowerCase() : null,
      exitCode: data?.exitCode !== undefined && data?.exitCode !== null ? Number(data.exitCode) : null,
      startTime: data?.startTime || null,
      endTime: data?.endTime || null,
      currentTime: data?.currentTime || null,
      logPath: data?.logPath || null,
      command: data?.command || null,
      isolation: isolationCandidate ? isolationCandidate.toLowerCase() : null,
      workingDirectory: data?.workingDirectory || null,
      sessionName: data?.sessionName || data?.options?.sessionName || null,
      processIds,
      oomKilled: normalizeBooleanField(data?.oomKilled ?? data?.OOMKilled ?? data?.options?.oomKilled ?? data?.state?.oomKilled ?? data?.State?.OOMKilled),
      exitReason: typeof data?.exitReason === 'string' && data.exitReason.trim() ? data.exitReason.trim() : null,
      memoryExhausted: normalizeBooleanField(data?.memoryExhausted),
      memoryExhaustedReason: typeof data?.memoryExhaustedReason === 'string' && data.memoryExhaustedReason.trim() ? data.memoryExhaustedReason.trim() : null,
      raw,
    };
  } catch {
    // Fall through to text parsing.
  }
  const firstLine =
    raw
      .split('\n')
      .find(line => line.trim() && !line.includes(' '))
      ?.trim() || null;
  const readField = name => {
    // Links notation separates key and value with whitespace (`  exitReason x`);
    // `--output-format text` uses a padded colon (`Exit Reason:       x`). Accept
    // both — the colon is optional, so every existing camelCase lookup is
    // unchanged and the text labels (which contain a space) become readable too.
    const match = raw.match(new RegExp(`^\\s*${name}\\s*:?\\s+"?([^"\\n]+)"?\\s*$`, 'mi'));
    return match ? match[1].trim() : null;
  };
  const readBooleanField = name => normalizeBooleanField(readField(name));
  const status = readField('status')?.toLowerCase() || null;
  const exitCodeText = readField('exitCode');
  // `start-command` links-notation output nests the isolation backend under `options` as `isolated <backend>` (not `isolation`). The leading indent varies by depth, but `readField` is anchored with `^\s*` which already matches indented lines. Older code only looked for `isolation`, which
  // returned null for every real session and made /log + /terminal_watch
  // reject screen/tmux/docker sessions. See issue #1700.
  const isolationText = readField('isolated') || readField('isolation');
  const processIds = {};
  for (const name of ['pid', 'wrapperPid', 'childPid', 'processPid', 'commandPid']) {
    const value = readField(name);
    const number = Number(value);
    if (Number.isInteger(number) && number > 0) processIds[name] = number;
  }
  return {
    exists: Boolean(status || firstLine),
    uuid: readField('uuid') || firstLine,
    status,
    exitCode: exitCodeText !== null ? Number(exitCodeText) : null,
    startTime: readField('startTime'),
    endTime: readField('endTime'),
    currentTime: readField('currentTime'),
    logPath: readField('logPath'),
    command: readField('command'),
    isolation: isolationText?.toLowerCase() || null,
    workingDirectory: readField('workingDirectory'),
    sessionName: readField('sessionName'),
    processIds,
    oomKilled: readBooleanField('oomKilled'),
    // `--output-format text` labels the same three fields `Exit Reason:`,
    // `Memory Exhausted:` and `Memory Evidence:`; links notation uses the camelCase
    // keys. Accept both so the parser does not depend on the output format.
    exitReason: readField('exitReason') || readField('Exit Reason'),
    memoryExhausted: readBooleanField('memoryExhausted') ?? readBooleanField('Memory Exhausted'),
    memoryExhaustedReason: readField('memoryExhaustedReason') || readField('Memory Evidence'),
    raw,
  };
}
/**
 * Decide whether a detached-docker exit code is "unknown" (not a real result).
 *
 * start-command's detached docker logger writes the exit-code footer only after
 * `docker logs -f` returns, capturing the real code via `docker inspect`. When
 * it cannot capture one it records the sentinel `-1`. A `$ --status` that
 * reports a terminal status ("executed") while still carrying that sentinel — or
 * no exit code at all — is therefore ambiguous: the container may actually still
 * be running. Callers treat such a status as provisional and cross-check the
 * live container before declaring the session finished. See issue #1939.
 *
 * @param {number|null|undefined} exitCode
 * @returns {boolean} True when the exit code carries no real result.
 */
export function isUnknownDockerExitCode(exitCode) {
  return exitCode === null || exitCode === undefined || Number(exitCode) === DOCKER_UNKNOWN_EXIT_CODE;
}
export function shouldFallbackToScreenStatus(statusResult) {
  return !statusResult?.exists || !statusResult?.status;
}
/**
 * Parse the footer start-command appends to every execution log when the wrapped
 * command exits. The footer is authoritative about the terminal exit code even
 * when `$ --status` is wrong: start-command writes it from the command's own
 * `close`/`exited` handler, so its presence proves the command terminated.
 *
 * Footer shape (see start-command spawn-helpers.js):
 *
 *     ==================================================
 *     Finished: 2026-06-14 19:10:49.822
 *     Exit Code: 137
 *
 * Issue #1927: start-command's `enrichDetachedStatus` can flip a completed
 * `executed/137` record back to `executing` (nulling the exit code) when a
 * lingering shell keeps the screen session alive — so `$ --status` reports
 * `executing` forever and the bot never notices the kill. Reading this footer
 * lets hive-mind detect the real terminal exit regardless of that flip.
 *
 * @param {string} text - Log text (typically the tail of the log file)
 * @returns {{finished: boolean, exitCode: number|null, endTime: string|null}}
 */
export function parseSessionExitFooter(text) {
  if (!text) return { finished: false, exitCode: null, endTime: null };
  // Match the LAST footer block in the text (a re-run could append more than
  // one). Anchor on the `=` separator so command output that merely prints
  // "Exit Code: N" mid-stream is not mistaken for the footer.
  const re = /={10,}\s*\r?\nFinished:\s*([^\r\n]+)\r?\nExit Code:\s*(-?\d+)/g;
  let match;
  let last = null;
  while ((match = re.exec(text)) !== null) last = match;
  if (!last) return { finished: false, exitCode: null, endTime: null };
  return { finished: true, exitCode: Number(last[2]), endTime: last[1].trim() };
}
/**
 * Read the terminal exit code from the tail of a start-command execution log.
 *
 * Only the last `tailBytes` of the file are read (the footer lives at the end),
 * so this is cheap even for multi-megabyte logs. Never throws — a missing or
 * unreadable log yields `{ finished: false }`.
 *
 * @param {string} logPath
 * @param {Object} [options]
 * @param {Object} [options.fsImpl=fs] - Injectable fs (for tests)
 * @param {number} [options.tailBytes=16384] - How many trailing bytes to scan
 * @param {boolean} [options.verbose]
 * @returns {{finished: boolean, exitCode: number|null, endTime: string|null}}
 */
export function readSessionExitFromLog(logPath, options = {}) {
  const { fsImpl = fs, tailBytes = 16384, verbose = false } = options;
  if (!logPath) return { finished: false, exitCode: null, endTime: null };
  try {
    const { size } = fsImpl.statSync(logPath);
    if (!size) return { finished: false, exitCode: null, endTime: null };
    const start = Math.max(0, size - tailBytes);
    const length = size - start;
    const buffer = Buffer.alloc(length);
    const fd = fsImpl.openSync(logPath, 'r');
    try {
      fsImpl.readSync(fd, buffer, 0, length, start);
    } finally {
      fsImpl.closeSync(fd);
    }
    const result = parseSessionExitFooter(buffer.toString('utf8'));
    if (verbose && result.finished) {
      console.log(`[VERBOSE] isolation-runner: log footer for ${logPath} reports exit ${result.exitCode} (finished ${result.endTime})`);
    }
    return result;
  } catch (error) {
    if (verbose) {
      console.log(`[VERBOSE] isolation-runner: could not read exit footer from ${logPath}: ${error.message}`);
    }
    return { finished: false, exitCode: null, endTime: null };
  }
}
/**
 * Parse output from `$ --list --output-format json`.
 *
 * start-command may return a top-level array, or an object with an
 * `executions`/`sessions` array. Each entry is normalized to the same shape used
 * by {@link parseSessionStatusOutput} (uuid/status/exitCode/command/isolation/…).
 * Tolerant of unknown layouts — anything unparseable yields an empty list.
 *
 * @param {string} output - Raw stdout from `$ --list`
 * @returns {Array<{uuid: string|null, status: string|null, exitCode: number|null, startTime: string|null, endTime: string|null, command: string|null, isolation: string|null, workingDirectory: string|null, sessionName: string|null}>}
 */
export function parseSessionListOutput(output) {
  const raw = (output || '').trim();
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const records = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.executions) ? parsed.executions : Array.isArray(parsed?.sessions) ? parsed.sessions : parsed && typeof parsed === 'object' ? [parsed] : [];
  return records
    .map(data => {
      if (!data || typeof data !== 'object') return null;
      const isolationCandidate = (typeof data.isolation === 'string' && data.isolation) || (typeof data.options?.isolated === 'string' && data.options.isolated) || (typeof data.options?.isolation === 'string' && data.options.isolation) || null;
      return {
        uuid: data.uuid || data.session || data.sessionId || null,
        status: typeof data.status === 'string' ? data.status.toLowerCase() : null,
        exitCode: data.exitCode !== undefined && data.exitCode !== null ? Number(data.exitCode) : null,
        startTime: data.startTime || null,
        endTime: data.endTime || null,
        command: data.command || null,
        isolation: isolationCandidate ? isolationCandidate.toLowerCase() : null,
        workingDirectory: data.workingDirectory || null,
        sessionName: data.sessionName || data.options?.sessionName || null,
        // Additive 0.33.0 hints (link-foundation/start#164, #165); null on older `$`.
        exitReason: typeof data.exitReason === 'string' && data.exitReason.trim() ? data.exitReason.trim() : null,
        memoryExhausted: typeof data.memoryExhausted === 'boolean' ? data.memoryExhausted : null,
        memoryExhaustedReason: typeof data.memoryExhaustedReason === 'string' && data.memoryExhaustedReason.trim() ? data.memoryExhaustedReason.trim() : null,
      };
    })
    .filter(Boolean);
}
