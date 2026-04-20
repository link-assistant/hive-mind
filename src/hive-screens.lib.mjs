#!/usr/bin/env node

/**
 * Shared runner for the `hive-screens` bin command. Scans detached GNU
 * screen sessions for completed solve runs and lists, enters, or closes
 * them. Ports the `hive-screens.sh` script that previously lived in
 * README.md, and keeps a single matching function so that `--list` is
 * a safe preview for `--close` / `--enter`.
 *
 * See issue #1649.
 */

import { exec as execCallback } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execAsync = promisify(execCallback);

export const HIVE_SCREENS_HELP = `Usage: hive-screens (--list | --enter | --close) [--oldest|--newest|--all]

Scan detached GNU screen sessions for completed solve runs and either list,
enter, or close them. A session matches when its scrollback contains both
"process completed" and either "pr is mergeable!" or "pr merged!" (case
insensitive) — the exact predicate from the legacy hive-screens.sh script.

Actions (one required):
      --list           Print matching sessions without touching them
      --enter          Attach to the selected match (blocking)
      --close          Send \`exit\\n\` to the selected match so it terminates

Selection (optional, default: --oldest):
      --oldest         Act on the oldest match (default)
      --newest         Act on the newest match
      --all            Act on every match in oldest-first order

Options:
  -h, --help           Show this help and exit

Examples:
  hive-screens --list                   # safe preview of matches
  hive-screens --list --all             # preview every match
  hive-screens --close --oldest         # close the oldest finished run
  hive-screens --enter --newest         # attach to the newest finished run

Reference: https://github.com/link-assistant/hive-mind/issues/1649
`;

const ACTION_FLAGS = new Set(['--enter', '--close', '--list']);
const SELECTION_FLAGS = new Set(['--oldest', '--newest', '--all']);

/**
 * Parse the argv for `hive-screens`. Returns the parsed flags plus an
 * `error` string when validation fails (so callers can print it and exit
 * with a non-zero status without throwing).
 */
export const parseHiveScreensArgs = argv => {
  const result = {
    enter: false,
    close: false,
    list: false,
    selection: null,
    help: false,
    error: null,
  };

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      result.help = true;
      continue;
    }
    if (ACTION_FLAGS.has(arg)) {
      if (arg === '--enter') result.enter = true;
      else if (arg === '--close') result.close = true;
      else result.list = true;
      continue;
    }
    if (SELECTION_FLAGS.has(arg)) {
      if (result.selection && result.selection !== arg.slice(2)) {
        result.error = `Conflicting selection flags: --${result.selection} and ${arg}`;
        return result;
      }
      result.selection = arg.slice(2);
      continue;
    }
    result.error = `Unknown option: ${arg}`;
    return result;
  }

  if (result.help) return result;

  const actions = [result.enter, result.close, result.list].filter(Boolean).length;
  if (actions === 0) {
    result.error = 'Must specify --list, --enter, or --close';
    return result;
  }
  if (actions > 1) {
    result.error = 'Specify only one of --list, --enter, --close';
    return result;
  }

  if (!result.selection) result.selection = 'oldest';
  return result;
};

/**
 * List detached screen sessions in oldest-first order. GNU screen prints
 * them newest-first, so we reverse to mirror `sort -n` (ascending PID) on
 * the typical `NNNNN.name` session names.
 */
export const listDetachedSessions = async ({ exec = execAsync } = {}) => {
  let stdout = '';
  try {
    ({ stdout } = await exec('screen -ls'));
  } catch (err) {
    // `screen -ls` exits 1 when there are no sessions. It still prints the
    // session header to stdout, so keep parsing whatever we got.
    stdout = err.stdout || '';
  }
  const sessions = [];
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim();
    if (!/\((?:Detached|Attached)\)/i.test(line)) continue;
    if (!/Detached/i.test(line)) continue;
    const match = line.match(/^(\S+)/);
    if (match) sessions.push(match[1]);
  }
  return sessions.sort((a, b) => {
    const na = parseInt(a, 10);
    const nb = parseInt(b, 10);
    if (Number.isNaN(na) || Number.isNaN(nb)) return a.localeCompare(b);
    return na - nb;
  });
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const stripNonPrintable = text => text.replace(/[^\t\n\r\x20-\x7E]/g, '');

/**
 * Capture the scrollback of a single screen session. Mirrors the sh
 * script: bump scrollback to 200000, settle, `hardcopy -h`, read, strip.
 */
export const captureSessionScrollback = async (session, { exec = execAsync, fsModule = fs, tmpDir = os.tmpdir(), scrollback = 200000, settleMs = 150 } = {}) => {
  const tmpFile = path.join(tmpDir, `hive-screens-${session}-${Date.now()}-${Math.random().toString(36).slice(2)}.hardcopy`);
  const shellSession = session.replace(/'/g, "'\\''");
  const shellTmp = tmpFile.replace(/'/g, "'\\''");
  try {
    await exec(`screen -S '${shellSession}' -X scrollback ${scrollback}`).catch(() => {});
    if (settleMs > 0) await sleep(settleMs);
    await exec(`screen -S '${shellSession}' -X hardcopy -h '${shellTmp}'`).catch(() => {});
    let raw = '';
    try {
      raw = await fsModule.readFile(tmpFile, 'utf-8');
    } catch {
      raw = '';
    }
    return stripNonPrintable(raw);
  } finally {
    await fsModule.unlink(tmpFile).catch(() => {});
  }
};

/**
 * The single source of truth for session matching. `--list`, `--enter`,
 * and `--close` all route through this predicate, so a session visible in
 * `--list` is guaranteed to be actionable by the other two flags.
 */
export const sessionMatches = text => {
  if (!text) return { matched: false, logPath: null, issueUrl: null };
  const hasCompletion = /process completed/i.test(text);
  const hasMerge = /pr is mergeable!|pr merged!/i.test(text);
  if (!hasCompletion || !hasMerge) {
    return { matched: false, logPath: null, issueUrl: null };
  }
  const logMatches = [...text.matchAll(/Full log file:\s*(\S+)/gi)];
  const issueMatches = [...text.matchAll(/Issue:\s*(https:\/\/github\.com\/\S+)/gi)];
  return {
    matched: true,
    logPath: logMatches.length ? logMatches[logMatches.length - 1][1] : null,
    issueUrl: issueMatches.length ? issueMatches[issueMatches.length - 1][1] : null,
  };
};

/**
 * Scan every detached session and return the ones that pass
 * `sessionMatches`, in the requested order.
 */
export const findMatchingSessions = async ({ exec = execAsync, fsModule = fs, tmpDir = os.tmpdir(), order = 'oldest', captureOptions = {} } = {}) => {
  const sessions = await listDetachedSessions({ exec });
  const ordered = order === 'newest' ? [...sessions].reverse() : sessions;
  const matches = [];
  for (const session of ordered) {
    const text = await captureSessionScrollback(session, { exec, fsModule, tmpDir, ...captureOptions });
    const result = sessionMatches(text);
    if (result.matched) {
      matches.push({ session, logPath: result.logPath, issueUrl: result.issueUrl });
    }
  }
  return matches;
};

/**
 * Apply `--oldest / --newest / --all` to the ordered match list produced
 * by `findMatchingSessions`. The orderer already did the directional
 * sort, so picking element 0 is always "the selected one" in that order.
 */
export const selectMatches = (matches, selection) => {
  if (!matches.length) return [];
  if (selection === 'all') return matches;
  return [matches[0]];
};

const printSession = ({ session, logPath, issueUrl }, { log }) => {
  log(`Session: ${session}`);
  log(logPath ? `Log: ${logPath}` : 'Log: (not found)');
  log(issueUrl ? `Issue: ${issueUrl}` : 'Issue: (not found)');
};

const SEPARATOR = '-----------------------------------';

/**
 * Top-level orchestrator used by the bin. `deps` is injected so tests can
 * stub `exec`, `fs`, stdio, and process spawning without touching real
 * screen sessions.
 */
export const runHiveScreens = async (argv, deps = {}) => {
  const { exec = execAsync, fsModule = fs, tmpDir = os.tmpdir(), log = (...args) => console.log(...args), error = (...args) => console.error(...args), spawnScreen, captureOptions } = deps;

  const args = parseHiveScreensArgs(argv);
  if (args.help) {
    log(HIVE_SCREENS_HELP);
    return 0;
  }
  if (args.error) {
    error(args.error);
    return 1;
  }

  const order = args.selection === 'newest' ? 'newest' : 'oldest';
  const matches = await findMatchingSessions({ exec, fsModule, tmpDir, order, captureOptions });

  if (!matches.length) {
    log('No matching sessions');
    return 0;
  }

  const selected = selectMatches(matches, args.selection);

  for (const match of selected) {
    printSession(match, { log });
    if (args.enter) {
      log(`Entering ${match.session}`);
      if (spawnScreen) {
        await spawnScreen(match.session);
      } else {
        await attachScreen(match.session);
      }
      log(`Left ${match.session}`);
    }
    if (args.close) {
      log(`Closing ${match.session}`);
      const shellSession = match.session.replace(/'/g, "'\\''");
      await exec(`screen -S '${shellSession}' -X stuff $'exit\\n'`).catch(err => {
        error(`Failed to send exit to ${match.session}: ${err.message}`);
      });
    }
    log(SEPARATOR);
  }

  return 0;
};

/**
 * Default `--enter` side-effect: spawn `screen -r <session>` attached to
 * the parent stdio so the user can actually interact with it. Split from
 * `runHiveScreens` so tests can inject a no-op spawn.
 */
const attachScreen = async session => {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve, reject) => {
    const child = spawn('screen', ['-r', session], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', () => resolve());
  });
};
