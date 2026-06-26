/**
 * OS-interaction layer for the `hive-cleanup` command (issue #1848).
 *
 * Everything that touches the real filesystem, the process table (/proc),
 * isolation session state (`$ --status` from start-command), git metadata of a
 * clone, GitHub (`gh`) and system package caches lives here. The pure
 * classification logic lives in `cleanup.lib.mjs` and is unit-tested without any
 * of this.
 *
 * Implemented with `node:` built-ins + `node:child_process` so it does not
 * depend on `use-m` / `command-stream` being reachable, except for the optional
 * `$ --status` session query which reuses isolation-runner.lib.mjs.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1848
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

import { extractTaskRefsFromCommand, isDockerIsolationSessionName, parseDockerContainerExitCode, parseRemoteUrl } from './cleanup.lib.mjs';
import { correlateProcesses, parseStartCommandLogMetadata, redactProcessText } from './process-debug.lib.mjs';

/** Run a command, returning trimmed stdout or null on any failure. */
function tryExec(cmd, args, options = {}) {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: options.timeout ?? 20000,
      maxBuffer: 64 * 1024 * 1024,
      ...options,
    }).trim();
  } catch {
    return null;
  }
}

/** The tmp root cleanup operates on (honours TMPDIR via os.tmpdir()). */
export function getTempRoot() {
  return os.tmpdir();
}

/**
 * List immediate children of the tmp root as candidate entries.
 *
 * @param {string} tempRoot
 * @returns {Array<{name: string, path: string, isDirectory: boolean}>}
 */
export function listTempEntries(tempRoot) {
  let dirents;
  try {
    dirents = fs.readdirSync(tempRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return dirents.map(d => {
    const full = path.join(tempRoot, d.name);
    let isDirectory = d.isDirectory();
    // Resolve symlinks defensively (don't follow into them for deletion though).
    if (d.isSymbolicLink()) {
      try {
        isDirectory = fs.statSync(full).isDirectory();
      } catch {
        isDirectory = false;
      }
    }
    return { name: d.name, path: full, isDirectory };
  });
}

/**
 * Size of a path in bytes. Uses `du -sk` (fast, handles dirs) with a small
 * fs.statSync fallback for plain files.
 *
 * @param {string} targetPath
 * @returns {number|null}
 */
export function getPathSize(targetPath) {
  const out = tryExec('du', ['-sk', targetPath]);
  if (out) {
    const kb = parseInt(out.split(/\s+/)[0], 10);
    if (!Number.isNaN(kb)) return kb * 1024;
  }
  try {
    return fs.statSync(targetPath).size;
  } catch {
    return null;
  }
}

/**
 * Read the git branch, remotes and dirty state of a clone directory.
 *
 * @param {string} dir
 * @returns {{branch: string|null, remotes: Array<{owner, repo, url}>, dirty: boolean}|null}
 */
export function readFolderGitInfo(dir) {
  // Cheap check: is it a git work tree?
  const isRepo = tryExec('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree']);
  if (isRepo !== 'true') return null;

  const branch = tryExec('git', ['-C', dir, 'branch', '--show-current']) || null;

  const remotesRaw = tryExec('git', ['-C', dir, 'remote', '-v']) || '';
  const remotes = [];
  const seen = new Set();
  for (const line of remotesRaw.split('\n')) {
    const m = line.match(/^\S+\s+(\S+)\s+\((?:fetch|push)\)/);
    if (!m) continue;
    const parsed = parseRemoteUrl(m[1]);
    if (parsed) {
      const key = `${parsed.owner}/${parsed.repo}`.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        remotes.push({ ...parsed, url: m[1] });
      }
    }
  }

  // Dirty if there are uncommitted changes OR commits not present on any remote.
  const status = tryExec('git', ['-C', dir, 'status', '--porcelain']);
  let dirty = Boolean(status && status.length > 0);
  if (!dirty && branch) {
    // Unpushed local commits: branch exists but has no upstream, or is ahead.
    const upstream = tryExec('git', ['-C', dir, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
    if (!upstream) {
      // No upstream tracking: check whether the branch commit exists on a remote.
      const head = tryExec('git', ['-C', dir, 'rev-parse', 'HEAD']);
      const onRemote = head ? tryExec('git', ['-C', dir, 'branch', '-r', '--contains', head]) : null;
      dirty = !onRemote;
    } else {
      const counts = tryExec('git', ['-C', dir, 'rev-list', '--left-right', '--count', `${upstream}...HEAD`]);
      if (counts) {
        const ahead = parseInt(counts.split(/\s+/)[1] || '0', 10);
        dirty = ahead > 0;
      }
    }
  }

  return { branch, remotes, dirty };
}

/**
 * Scan /proc to find paths under tempRoot that are the cwd of, or an open fd /
 * mapped file of, a running process. Linux-only; returns an empty set elsewhere.
 *
 * @param {string} tempRoot
 * @returns {Set<string>} absolute top-level entry paths under tempRoot
 */
export function listProcessHeldPaths(tempRoot) {
  const held = new Set();
  let pids;
  try {
    pids = fs.readdirSync('/proc').filter(name => /^\d+$/.test(name));
  } catch {
    return held; // Not Linux / no procfs.
  }

  const normalizedRoot = tempRoot.endsWith(path.sep) ? tempRoot : tempRoot + path.sep;
  const recordIfUnderRoot = target => {
    if (!target) return;
    if (target === tempRoot || target.startsWith(normalizedRoot)) {
      // Reduce to the top-level entry directly under tempRoot.
      const rest = target.slice(normalizedRoot.length);
      const first = rest.split(path.sep)[0];
      if (first) held.add(path.join(tempRoot, first));
    }
  };

  for (const pid of pids) {
    // cwd of the process (covers git/claude children that chdir into the clone).
    try {
      recordIfUnderRoot(fs.readlinkSync(`/proc/${pid}/cwd`));
    } catch {
      /* process gone or permission denied */
    }
    // open file descriptors.
    try {
      for (const fd of fs.readdirSync(`/proc/${pid}/fd`)) {
        try {
          recordIfUnderRoot(fs.readlinkSync(`/proc/${pid}/fd/${fd}`));
        } catch {
          /* fd vanished */
        }
      }
    } catch {
      /* no fd dir / permission */
    }
  }
  return held;
}

function parseProcStat(raw) {
  if (!raw) return null;
  const open = raw.indexOf('(');
  const close = raw.lastIndexOf(')');
  if (open < 0 || close < open) return null;
  const commandName = raw.slice(open + 1, close);
  const fields = raw
    .slice(close + 2)
    .trim()
    .split(/\s+/);
  return {
    commandName,
    state: fields[0] || null,
    ppid: Number(fields[1]) || 0,
    pgid: Number(fields[2]) || null,
    sid: Number(fields[3]) || null,
  };
}

function readProcText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function readProcLink(filePath) {
  try {
    return fs.readlinkSync(filePath);
  } catch {
    return null;
  }
}

function readProcCmdline(pid, fallbackName) {
  const raw = readProcText(`/proc/${pid}/cmdline`);
  const cmdline = raw ? raw.replace(/\0/g, ' ').trim() : '';
  return cmdline || fallbackName || '';
}

function readProcScreenSessionName(pid) {
  const raw = readProcText(`/proc/${pid}/environ`);
  if (!raw) return null;
  const sty = raw
    .split('\0')
    .find(line => line.startsWith('STY='))
    ?.slice(4)
    ?.trim();
  if (!sty) return null;
  return sty.replace(/^\d+\./, '') || sty;
}

/**
 * Snapshot Linux process records used by process diagnostics and orphan
 * cleanup. Returns an empty list when procfs is unavailable.
 *
 * @returns {Array<{pid: number, ppid: number, pgid: number|null, sid: number|null, state: string|null, commandName: string|null, cmdline: string, cwd: string|null, exe: string|null, screenSessionName: string|null}>}
 */
export function listProcessRecords() {
  let pids;
  try {
    pids = fs.readdirSync('/proc').filter(name => /^\d+$/.test(name));
  } catch {
    return [];
  }

  const records = [];
  for (const pidText of pids) {
    const pid = Number(pidText);
    const stat = parseProcStat(readProcText(`/proc/${pid}/stat`));
    if (!stat) continue;
    records.push({
      pid,
      ppid: stat.ppid,
      pgid: stat.pgid,
      sid: stat.sid,
      state: stat.state,
      commandName: stat.commandName,
      cmdline: readProcCmdline(pid, stat.commandName),
      cwd: readProcLink(`/proc/${pid}/cwd`),
      exe: readProcLink(`/proc/${pid}/exe`),
      screenSessionName: readProcScreenSessionName(pid),
    });
  }
  return records;
}

/**
 * Discover GNU screen sessions and their backing screen PIDs.
 *
 * @returns {Array<{screenPid: number, sessionName: string, displayName: string, attached: boolean, live: boolean}>}
 */
export function listScreenSessions() {
  const out = tryExec('screen', ['-ls']);
  if (!out) return [];
  const sessions = [];
  for (const line of out.split('\n')) {
    const match = line.match(/^\s*(\d+)\.([^\s]+)\s+\((Attached|Detached)\)/i);
    if (!match) continue;
    sessions.push({
      screenPid: Number(match[1]),
      sessionName: match[2],
      displayName: `${match[1]}.${match[2]}`,
      attached: match[3].toLowerCase() === 'attached',
      live: true,
    });
  }
  return sessions;
}

function splitDockerNames(value) {
  return String(value || '')
    .split(',')
    .map(name => name.trim().replace(/^\/+/, ''))
    .filter(Boolean);
}

/**
 * Parse `docker ps -a --format '{{json .}}'` output into docker-isolation task
 * containers. start-command names native Docker isolation containers after the
 * session UUID, so unrelated host containers are ignored.
 *
 * @param {string} output
 * @returns {Array<{id: string|null, name: string, image: string|null, state: string, status: string, exitCode: number|null, running: boolean}>}
 */
export function parseDockerPsJsonLines(output) {
  const containers = [];
  const seen = new Set();

  for (const line of String(output || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let data;
    try {
      data = JSON.parse(trimmed);
    } catch {
      continue;
    }

    const state = String(data.State || data.state || '')
      .trim()
      .toLowerCase();
    const status = String(data.Status || data.status || '').trim();
    const exitCode = parseDockerContainerExitCode(status);
    const running = state === 'running' || /^Up\b/i.test(status);

    for (const name of splitDockerNames(data.Names || data.Name || data.names || data.name)) {
      if (!isDockerIsolationSessionName(name)) continue;
      if (seen.has(name)) continue;
      seen.add(name);
      containers.push({
        id: data.ID || data.Id || data.id || null,
        name,
        image: data.Image || data.image || null,
        state,
        status,
        exitCode,
        running,
      });
    }
  }

  return containers;
}

/**
 * Enumerate Docker-isolation task containers from the local Docker daemon.
 * Returns an empty list when docker is unavailable.
 *
 * @returns {Array}
 */
export function listDockerIsolationContainers() {
  const out = tryExec('docker', ['ps', '-a', '--format', '{{json .}}']);
  return out ? parseDockerPsJsonLines(out) : [];
}

function listStartCommandLogFiles(logRoot, maxFiles) {
  const files = [];
  const stack = [logRoot];
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
        entries = fs.readdirSync(current);
      } catch {
        continue;
      }
      for (const entry of entries) stack.push(path.join(current, entry));
    } else if (stat.isFile() && current.endsWith('.log')) {
      files.push({ path: current, mtimeMs: stat.mtimeMs });
    }
  }
  return files
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, maxFiles)
    .map(file => file.path);
}

function readFilePrefix(filePath, maxBytes) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = fs.readSync(fd, buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

function mergeSession(map, session) {
  if (!session) return;
  const key = session.sessionId || session.uuid || session.sessionName || session.screenSessionName || session.logPath;
  if (!key) return;
  const existing = map.get(key) || {};
  const mergedProcessIds = { ...(existing.processIds || {}), ...(session.processIds || {}) };
  map.set(key, {
    ...existing,
    ...session,
    processIds: mergedProcessIds,
    sessionId: session.sessionId || existing.sessionId || session.uuid || existing.uuid || null,
    uuid: session.uuid || existing.uuid || session.sessionId || existing.sessionId || null,
    sessionName: session.sessionName || existing.sessionName || session.screenSessionName || existing.screenSessionName || null,
    screenSessionName: session.screenSessionName || existing.screenSessionName || session.sessionName || existing.sessionName || null,
    live: session.live === true || existing.live === true,
    command: session.command || existing.command || null,
    taskUrl: session.taskUrl || existing.taskUrl || null,
    workspace: session.workspace || existing.workspace || session.workingDirectory || existing.workingDirectory || null,
    logPath: session.logPath || existing.logPath || null,
    tool: session.tool || existing.tool || null,
    status: session.status || existing.status || null,
  });
}

/**
 * Collect start-command session/task metadata from logs, live screen sessions,
 * and optional `$ --status` lookups.
 *
 * @param {Object} [options]
 * @param {string} [options.logRoot='/tmp/start-command/logs']
 * @param {number} [options.maxLogFiles=500]
 * @param {number} [options.maxLogBytes=262144]
 * @param {number} [options.maxStatusQueries=200]
 * @param {boolean} [options.useSessions=true]
 * @returns {Promise<Array>}
 */
export async function collectProcessDebugSessions(options = {}) {
  const { logRoot = '/tmp/start-command/logs', maxLogFiles = 500, maxLogBytes = 256 * 1024, maxStatusQueries = 200, useSessions = true } = options;

  const sessions = new Map();

  for (const logPath of listStartCommandLogFiles(logRoot, maxLogFiles)) {
    const metadata = parseStartCommandLogMetadata({
      logPath,
      text: readFilePrefix(logPath, maxLogBytes),
    });
    mergeSession(sessions, metadata);
  }

  for (const screenSession of listScreenSessions()) {
    mergeSession(sessions, {
      sessionId: screenSession.sessionName,
      sessionName: screenSession.sessionName,
      screenSessionName: screenSession.sessionName,
      processIds: { screenPid: screenSession.screenPid },
      live: true,
    });
  }

  if (!useSessions || sessions.size === 0) return [...sessions.values()];

  let querySessionStatus;
  try {
    ({ querySessionStatus } = await import('./isolation-runner.lib.mjs'));
  } catch {
    return [...sessions.values()];
  }

  const queryCandidates = [...sessions.values()].sort((a, b) => (b.live === true) - (a.live === true)).slice(0, maxStatusQueries);

  for (const session of queryCandidates) {
    const id = session.sessionId || session.uuid || session.sessionName;
    if (!id) continue;
    let status;
    try {
      status = await querySessionStatus(id);
    } catch {
      continue;
    }
    if (!status?.exists) continue;
    mergeSession(sessions, {
      sessionId: status.uuid || id,
      uuid: status.uuid || id,
      status: status.status || session.status || null,
      command: status.command ? redactProcessText(status.command) : session.command || null,
      taskUrl: status.command ? extractTaskRefsFromCommand(status.command).map(ref => `https://github.com/${ref.owner}/${ref.repo}/${ref.type === 'pull' ? 'pull' : 'issues'}/${ref.number}`)[0] : session.taskUrl || null,
      workspace: status.workingDirectory || session.workspace || null,
      workingDirectory: status.workingDirectory || null,
      logPath: status.logPath || session.logPath || null,
      sessionName: status.sessionName || session.sessionName || id,
      screenSessionName: status.sessionName || session.screenSessionName || session.sessionName || id,
      processIds: status.processIds || {},
      live: session.live === true || status.status === 'executing' || status.status === 'running',
    });
  }

  return [...sessions.values()];
}

/**
 * Build a redacted process debug report from the real OS state.
 *
 * @param {Object} [options]
 * @returns {Promise<{items: Array, orphans: Array, sessions: Array}>}
 */
export async function collectProcessDebugReport(options = {}) {
  const processes = listProcessRecords();
  const sessions = await collectProcessDebugSessions(options);
  const report = correlateProcesses({ processes, sessions, currentPid: process.pid, targetPids: options.targetPids || [] });
  return {
    ...report,
    processCount: processes.length,
    sessionCount: sessions.length,
  };
}

function buildChildrenMap(processes) {
  const children = new Map();
  for (const record of processes || []) {
    if (!record?.pid || !record?.ppid) continue;
    if (!children.has(record.ppid)) children.set(record.ppid, []);
    children.get(record.ppid).push(record.pid);
  }
  return children;
}

function collectProcessTree(rootPid, children) {
  const seen = new Set();
  const ordered = [];
  const visit = pid => {
    if (!pid || seen.has(pid)) return;
    seen.add(pid);
    for (const child of children.get(pid) || []) visit(child);
    ordered.push(pid);
  };
  visit(rootPid);
  return ordered;
}

/**
 * Send a signal to a process tree, children first.
 *
 * @param {number} rootPid
 * @param {Array} processes
 * @param {{signal?: string, currentPid?: number}} [options]
 * @returns {Array<{pid: number, signal: string, ok: boolean, error?: string}>}
 */
export function signalProcessTree(rootPid, processes, options = {}) {
  const signal = options.signal || 'SIGTERM';
  const currentPid = options.currentPid || process.pid;
  const children = buildChildrenMap(processes);
  const targets = collectProcessTree(Number(rootPid), children).filter(pid => pid !== currentPid && pid > 1);
  const results = [];

  for (const pid of targets) {
    try {
      process.kill(pid, signal);
      results.push({ pid, signal, ok: true });
    } catch (error) {
      results.push({ pid, signal, ok: false, error: error.message });
    }
  }
  return results;
}

/**
 * Signal every orphaned agent tree from a previously collected report.
 *
 * @param {{orphans?: Array}} report
 * @param {Object} [options]
 * @returns {Array<{rootPid: number, results: Array}>}
 */
export function signalOrphanedAgentTrees(report, options = {}) {
  const processes = listProcessRecords();
  return (report.orphans || []).map(orphan => ({
    rootPid: orphan.pid,
    results: signalProcessTree(orphan.pid, processes, options),
  }));
}

/**
 * Collect task references (owner/repo/number/type) from running solve/hive
 * processes by scanning /proc/<pid>/cmdline.
 *
 * @returns {Array<{owner, repo, type, number}>}
 */
export function listActiveTaskRefsFromProc() {
  const refs = [];
  const seen = new Set();
  let pids;
  try {
    pids = fs.readdirSync('/proc').filter(name => /^\d+$/.test(name));
  } catch {
    return refs;
  }
  for (const pid of pids) {
    let cmdline;
    try {
      cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim();
    } catch {
      continue;
    }
    if (!cmdline || !/github\.com/.test(cmdline)) continue;
    for (const ref of extractTaskRefsFromCommand(cmdline)) {
      const key = `${ref.owner}/${ref.repo}#${ref.number}:${ref.type}`;
      if (!seen.has(key)) {
        seen.add(key);
        refs.push(ref);
      }
    }
  }
  return refs;
}

/**
 * Discover currently-running isolation session UUIDs from start-command's live
 * session managers (screen / tmux). These names are the session UUIDs.
 *
 * @deprecated Superseded by {@link listSessionTasks}, which sources every
 * session (active *and* finished) from the single `$ --list` catalog rather
 * than re-deriving liveness from `screen -ls`/`tmux ls`. Retained as a
 * documented building block (issue #1848 case study) and for callers that only
 * want live screen/tmux UUIDs without start-command.
 *
 * @returns {string[]}
 */
export function listLiveSessionIds() {
  const ids = new Set();

  const screenOut = tryExec('screen', ['-ls']);
  if (screenOut) {
    for (const m of screenOut.matchAll(/^\s*\d+\.([0-9a-f-]{8,})\s/gim)) {
      ids.add(m[1]);
    }
  }

  const tmuxOut = tryExec('tmux', ['ls', '-F', '#{session_name}']);
  if (tmuxOut) {
    for (const line of tmuxOut.split('\n')) {
      const name = line.trim();
      if (/^[0-9a-f-]{8,}$/i.test(name)) ids.add(name);
    }
  }

  return [...ids];
}

/**
 * Query `$ --status <uuid>` for each live session and extract task references
 * from executing sessions' command lines. Optional; reuses isolation-runner.
 *
 * @deprecated Superseded by {@link listSessionTasks} (issue #1927 review), which
 * reads the whole catalog from one `$ --list` call instead of N per-session
 * `$ --status` queries and also surfaces finished sessions. Kept for the issue
 * #1848 case study and backward compatibility.
 *
 * @param {string[]} sessionIds
 * @returns {Promise<Array<{owner, repo, type, number}>>}
 */
export async function listActiveTaskRefsFromSessions(sessionIds) {
  if (!sessionIds || sessionIds.length === 0) return [];
  let querySessionStatus;
  let isTerminalSessionStatus;
  try {
    ({ querySessionStatus, isTerminalSessionStatus } = await import('./isolation-runner.lib.mjs'));
  } catch {
    return [];
  }
  const refs = [];
  const seen = new Set();
  for (const id of sessionIds) {
    let status;
    try {
      status = await querySessionStatus(id);
    } catch {
      continue;
    }
    if (!status || !status.exists) continue;
    if (status.status && isTerminalSessionStatus(status.status)) continue;
    if (!status.command) continue;
    for (const ref of extractTaskRefsFromCommand(status.command)) {
      const key = `${ref.owner}/${ref.repo}#${ref.number}:${ref.type}`;
      if (!seen.has(key)) {
        seen.add(key);
        refs.push({
          ...ref,
          sessionId: status.uuid || id,
          sessionName: status.sessionName || id,
          status: status.status || null,
          workspace: status.workingDirectory || null,
        });
      }
    }
  }
  return refs;
}

/**
 * Resolve the head branch of a PR via `gh pr view`. Returns null on failure
 * (offline, no gh, not found) — callers fall back to issue-prefix matching.
 *
 * @param {{owner, repo, number}} ref
 * @returns {string|null}
 */
export function resolvePrHeadBranch(ref) {
  const out = tryExec('gh', ['pr', 'view', String(ref.number), '--repo', `${ref.owner}/${ref.repo}`, '--json', 'headRefName', '--jq', '.headRefName']);
  return out || null;
}

/**
 * Enumerate ALL tasks known to start-command from the single `$ --list` source
 * (issue #1927 review): one record per GitHub issue/PR reference found in each
 * session's command line, carrying that session's id/name/status/workspace and a
 * `terminal` flag (whether the session has finished). Unlike
 * {@link listActiveTaskRefsFromSessions}, this includes *completed* sessions so a
 * stale `gh-issue-solver-*` folder can be annotated with the PR and session it
 * once belonged to — even after the task is no longer running.
 *
 * This consolidates session enumeration onto start-command's own `$ --list`
 * (which knows every session, not just the ones still alive in screen/tmux) so
 * `/queue`, `/limits`, the monitor and cleanup all read the same `$` data.
 *
 * @param {Object} [options]
 * @param {boolean} [options.verbose=false]
 * @param {boolean} [options.resolveBranches=false] - resolve PR head branches via gh
 * @returns {Promise<Array<{owner, repo, type, number, branch: string|null, sessionId: string|null, sessionName: string|null, status: string|null, exitCode: number|null, isolation: string|null, workspace: string|null, terminal: boolean, startTime: string|null}>>}
 */
export async function listSessionTasks(options = {}) {
  const { verbose = false, resolveBranches = false } = options;
  let listIsolationSessions;
  let isTerminalSessionStatus;
  try {
    ({ listIsolationSessions, isTerminalSessionStatus } = await import('./isolation-runner.lib.mjs'));
  } catch {
    return [];
  }

  let sessions;
  try {
    sessions = await listIsolationSessions(verbose);
  } catch {
    return [];
  }

  // Newest session first, so when several sessions worked the same issue/PR the
  // most recent one is the match a folder gets annotated with.
  const sorted = [...sessions].sort((a, b) => new Date(b.startTime || 0).getTime() - new Date(a.startTime || 0).getTime());

  const tasks = [];
  for (const session of sorted) {
    if (!session || !session.command) continue;
    const terminal = !!(session.status && isTerminalSessionStatus(session.status));
    for (const ref of extractTaskRefsFromCommand(session.command)) {
      tasks.push({
        ...ref,
        branch: null,
        sessionId: session.uuid || null,
        sessionName: session.sessionName || null,
        status: session.status || null,
        exitCode: session.exitCode ?? null,
        isolation: session.isolation || null,
        workspace: session.workingDirectory || null,
        terminal,
        startTime: session.startTime || null,
      });
    }
  }

  if (resolveBranches) {
    const branchCache = new Map();
    for (const task of tasks) {
      if (task.type !== 'pull') continue;
      const key = `${task.owner}/${task.repo}#${task.number}`;
      if (!branchCache.has(key)) branchCache.set(key, resolvePrHeadBranch(task));
      task.branch = branchCache.get(key);
    }
  }

  return tasks;
}

/**
 * Build the full active-task list, resolving PR head branches where possible.
 *
 * @param {Object} [options]
 * @param {boolean} [options.useSessions=true] - also consult `$ --list` sessions
 * @param {boolean} [options.resolveBranches=true] - resolve PR head branches via gh
 * @param {Array} [options.sessionTasks] - pre-fetched `listSessionTasks()` result to reuse
 * @returns {Promise<Array<{owner, repo, type, number, branch: string|null}>>}
 */
export async function getActiveTasks(options = {}) {
  const { useSessions = true, resolveBranches = true, sessionTasks = null } = options;
  const refs = [...listActiveTaskRefsFromProc()];
  const seen = new Set(refs.map(r => `${r.owner}/${r.repo}#${r.number}:${r.type}`));

  if (useSessions) {
    // Active = sessions start-command still reports as non-terminal. Reuse the
    // shared `$ --list` enumeration (optionally pre-fetched by the caller so the
    // catalog is read only once).
    const allSessionTasks = sessionTasks || (await listSessionTasks({ verbose: false, resolveBranches: false }));
    for (const task of allSessionTasks) {
      if (task.terminal) continue;
      const key = `${task.owner}/${task.repo}#${task.number}:${task.type}`;
      if (!seen.has(key)) {
        seen.add(key);
        refs.push(task);
      }
    }
  }

  return refs.map(ref => {
    let branch = ref.branch || null;
    if (!branch && ref.type === 'pull' && resolveBranches) {
      branch = resolvePrHeadBranch(ref);
    }
    return { ...ref, branch };
  });
}

/**
 * Permanently remove a path (recursive, force). Returns true on success.
 *
 * @param {string} targetPath
 * @returns {boolean}
 */
export function removePath(targetPath) {
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove a Docker-isolation task container by session UUID. Returns false for
 * invalid names, missing docker, missing containers, or docker errors.
 *
 * @param {string} containerName
 * @returns {boolean}
 */
export function removeDockerContainer(containerName) {
  if (!isDockerIsolationSessionName(containerName)) return false;
  return tryExec('docker', ['rm', '-f', containerName], { timeout: 180000, stdio: ['ignore', 'pipe', 'pipe'] }) !== null;
}

/**
 * System / Ubuntu cleanup actions. Each is opt-in. In dry-run mode the commands
 * are only described, never executed.
 *
 * @param {Object} options
 * @param {boolean} [options.apt] - apt-get clean / autoclean / autoremove
 * @param {boolean} [options.journal] - journalctl --vacuum-time
 * @param {boolean} [options.docker] - docker system prune
 * @param {boolean} [options.npm] - npm cache clean --force
 * @param {string} [options.journalVacuumTime='2weeks']
 * @param {boolean} [options.dryRun]
 * @param {boolean} [options.useSudo] - prefix package commands with sudo
 * @param {(msg: string) => void} [options.logFn]
 * @returns {Array<{command: string, executed: boolean, ok: boolean|null}>}
 */
export function runSystemCleanup(options = {}) {
  const { apt = false, journal = false, docker = false, npm = false, journalVacuumTime = '2weeks', dryRun = false, useSudo = false, logFn = () => {} } = options;

  const plan = [];
  const sudo = useSudo ? ['sudo'] : [];
  if (apt) {
    plan.push([...sudo, 'apt-get', 'clean']);
    plan.push([...sudo, 'apt-get', 'autoclean', '-y']);
    plan.push([...sudo, 'apt-get', 'autoremove', '-y']);
  }
  if (journal) {
    plan.push([...sudo, 'journalctl', `--vacuum-time=${journalVacuumTime}`]);
  }
  if (docker) {
    plan.push(['docker', 'system', 'prune', '-f']);
  }
  if (npm) {
    plan.push(['npm', 'cache', 'clean', '--force']);
  }

  const results = [];
  for (const argv of plan) {
    const display = argv.join(' ');
    if (dryRun) {
      logFn(`   [dry-run] would run: ${display}`);
      results.push({ command: display, executed: false, ok: null });
      continue;
    }
    logFn(`   running: ${display}`);
    const out = tryExec(argv[0], argv.slice(1), { timeout: 180000, stdio: ['ignore', 'pipe', 'pipe'] });
    const ok = out !== null;
    logFn(ok ? `   ✓ ${display}` : `   ✗ ${display} (failed or unavailable)`);
    results.push({ command: display, executed: true, ok });
  }
  return results;
}
