/**
 * Make the AI CLI's tool shells the OOM killer's first choice (issue #3125).
 *
 * When a task's cgroup runs out of memory, the kernel kills the process with
 * the highest badness score. That was often the AI CLI itself (`claude`), so
 * the whole session died, although a build or test suite it had started was
 * the process that used the memory. Losing one build is recoverable; losing
 * the CLI ends the session.
 *
 * Linux lets any process raise its own `/proc/self/oom_score_adj` without
 * privileges. Lowering it below `oom_score_adj_min` needs CAP_SYS_RESOURCE,
 * so the CLI cannot be protected by lowering its score. Instead every bash
 * shell the CLI starts raises its own score through a `BASH_ENV` hook, and the
 * builds and tests the shell starts inherit the raised score. The CLI keeps
 * the score it was launched with.
 *
 * `BASH_ENV` is read by every non-interactive bash (`bash -c`, `bash -lc`).
 * The Bash tools of Claude Code, Codex, Gemini, Qwen, OpenCode and Agent run
 * their commands that way. dash (`/bin/sh` on Debian and Ubuntu) and zsh do
 * not read `BASH_ENV`, so their shells keep the default score. A top-level
 * bash (no SHLVL in its environment) whose stdin is a socket takes bash's
 * "run by sshd" path and reads ~/.bashrc instead of `BASH_ENV`; solve is
 * normally started from a shell, so its tools' shells are nested and read it.
 *
 * The hook skips a shell whose parent is the process that armed it. That is
 * the launcher shell solve uses to start the CLI (command-stream runs
 * `sh -l -c '<cli> ...'`). If that shell is bash, raising it would raise the
 * CLI it starts as well.
 *
 * Set HIVE_MIND_TOOL_SHELL_OOM_SCORE_ADJ to a value from 1 to 1000 to change
 * the score, or to `off` or `0` to disable the hook.
 */
import fsDefault from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_TOOL_SHELL_OOM_SCORE_ADJ = 500;
export const TOOL_SHELL_OOM_SCORE_ADJ_ENV = 'HIVE_MIND_TOOL_SHELL_OOM_SCORE_ADJ';
export const OOM_SCORE_ADJ_LAUNCHER_PID_ENV = 'HIVE_MIND_OOM_SCORE_ADJ_LAUNCHER_PID';
export const PREVIOUS_BASH_ENV_ENV = 'HIVE_MIND_PREVIOUS_BASH_ENV';
export const TOOL_SHELL_OOM_HOOK_FILE = 'hive-mind-tool-shell-oom-score.sh';

/** Score for tool shells, or null when the hook is disabled or the value is invalid. */
export function resolveToolShellOomScoreAdj(env = process.env) {
  const raw = String(env?.[TOOL_SHELL_OOM_SCORE_ADJ_ENV] ?? '')
    .trim()
    .toLowerCase();
  if (!raw) return DEFAULT_TOOL_SHELL_OOM_SCORE_ADJ;
  if (raw === 'off' || raw === 'false' || raw === 'no') return null;
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return value >= 1 && value <= 1000 ? value : null;
}

/**
 * The `BASH_ENV` hook. It reads the score and the launcher PID from the
 * environment, so one file serves every score. It never prints anything and
 * never fails, and it sources the BASH_ENV that was set before it.
 */
export function buildToolShellOomHookScript() {
  return `# hive-mind (issue #3125): raise this shell's OOM score so the OOM killer
# picks the builds and tests an AI tool shell starts before the AI CLI itself.
# Children inherit the score; the CLI keeps its own.
__hive_mind_oom_target="\${${TOOL_SHELL_OOM_SCORE_ADJ_ENV}:-${DEFAULT_TOOL_SHELL_OOM_SCORE_ADJ}}"
case "$__hive_mind_oom_target" in
  ''|*[!0-9]*) __hive_mind_oom_target='' ;;
esac
if [ -n "$__hive_mind_oom_target" ] && [ "$PPID" != "\${${OOM_SCORE_ADJ_LAUNCHER_PID_ENV}:-}" ] && [ -w /proc/self/oom_score_adj ]; then
  __hive_mind_oom_current=''
  { read -r __hive_mind_oom_current < /proc/self/oom_score_adj; } 2>/dev/null
  case "$__hive_mind_oom_current" in
    ''|*[!0-9-]*) ;;
    *) if [ "$__hive_mind_oom_current" -lt "$__hive_mind_oom_target" ]; then { echo "$__hive_mind_oom_target" > /proc/self/oom_score_adj; } 2>/dev/null; fi ;;
  esac
fi
unset __hive_mind_oom_target __hive_mind_oom_current
if [ -n "\${${PREVIOUS_BASH_ENV_ENV}:-}" ] && [ -f "\${${PREVIOUS_BASH_ENV_ENV}}" ]; then
  . "\${${PREVIOUS_BASH_ENV_ENV}}"
fi
`;
}

/** Per-user directory for the hook, so no other user can plant or change it. */
export function defaultToolShellOomHookDir(uid = process.getuid?.()) {
  return path.join(os.tmpdir(), uid === undefined ? 'hive-mind' : `hive-mind-${uid}`);
}

// A directory that is a symlink, owned by another user, or writable by others
// could have the hook swapped under us, and every tool shell would source it.
function isPrivateDirectory(fs, dir, uid) {
  if (uid === undefined || typeof fs.lstatSync !== 'function') return true;
  const stat = fs.lstatSync(dir);
  return stat.isDirectory() && stat.uid === uid && (stat.mode & 0o022) === 0;
}

/** Write the hook once; returns its path, or null when it cannot be written safely. */
export function ensureToolShellOomHook({ fs = fsDefault, dir = defaultToolShellOomHookDir(), uid = process.getuid?.() } = {}) {
  const hookPath = path.join(dir, TOOL_SHELL_OOM_HOOK_FILE);
  const script = buildToolShellOomHookScript();
  try {
    if (typeof fs.mkdirSync === 'function') fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (!isPrivateDirectory(fs, dir, uid)) return null;
    let current = null;
    try {
      current = fs.readFileSync(hookPath, 'utf8');
    } catch {
      current = null;
    }
    if (current !== script) fs.writeFileSync(hookPath, script, { mode: 0o644 });
    return hookPath;
  } catch {
    return null;
  }
}

/** Environment entries that arm the hook for the AI CLI started by `launcherPid`. */
export function buildToolShellOomEnv(env = process.env, { hookPath, launcherPid = process.pid, score = resolveToolShellOomScoreAdj(env) } = {}) {
  if (!hookPath || score === null) return {};
  const previous = env?.BASH_ENV && env.BASH_ENV !== hookPath ? env.BASH_ENV : env?.[PREVIOUS_BASH_ENV_ENV] || '';
  const entries = { BASH_ENV: hookPath, [TOOL_SHELL_OOM_SCORE_ADJ_ENV]: String(score), [OOM_SCORE_ADJ_LAUNCHER_PID_ENV]: String(launcherPid) };
  if (previous && previous !== hookPath) entries[PREVIOUS_BASH_ENV_ENV] = previous;
  return entries;
}

/**
 * Arm the hook in `env` (process.env by default), so every AI CLI solve starts
 * inherits it. Linux only; returns the applied entries, or null when skipped.
 */
export function armToolShellOomScoreAdj({ env = process.env, platform = process.platform, fs = fsDefault, dir = defaultToolShellOomHookDir(), launcherPid = process.pid } = {}) {
  if (platform !== 'linux') return null;
  const score = resolveToolShellOomScoreAdj(env);
  if (score === null) return null;
  const hookPath = ensureToolShellOomHook({ fs, dir });
  const entries = buildToolShellOomEnv(env, { hookPath, launcherPid, score });
  if (!entries.BASH_ENV) return null;
  Object.assign(env, entries);
  return entries;
}
