/**
 * OS-interaction layer for the `cleanup` command (issue #1848).
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

import { extractTaskRefsFromCommand, parseRemoteUrl } from './cleanup.lib.mjs';

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
        refs.push(ref);
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
 * Build the full active-task list, resolving PR head branches where possible.
 *
 * @param {Object} [options]
 * @param {boolean} [options.useSessions=true] - also query `$ --status`
 * @param {boolean} [options.resolveBranches=true] - resolve PR head branches via gh
 * @returns {Promise<Array<{owner, repo, type, number, branch: string|null}>>}
 */
export async function getActiveTasks(options = {}) {
  const { useSessions = true, resolveBranches = true } = options;
  const refs = [...listActiveTaskRefsFromProc()];
  const seen = new Set(refs.map(r => `${r.owner}/${r.repo}#${r.number}:${r.type}`));

  if (useSessions) {
    const sessionRefs = await listActiveTaskRefsFromSessions(listLiveSessionIds());
    for (const ref of sessionRefs) {
      const key = `${ref.owner}/${ref.repo}#${ref.number}:${ref.type}`;
      if (!seen.has(key)) {
        seen.add(key);
        refs.push(ref);
      }
    }
  }

  return refs.map(ref => {
    let branch = null;
    if (ref.type === 'pull' && resolveBranches) {
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
