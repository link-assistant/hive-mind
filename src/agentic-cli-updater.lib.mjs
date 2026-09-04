/**
 * Idle-only refresh of the agentic CLIs (issue #2146, PR #2147 review).
 *
 * The maintainer's review closed with:
 *
 *   "Do same auto update for claude, codex, agent and other agentic CLIs (when
 *    no tasks are active and new version is available) or support update inside
 *    each separate task's docker."
 *
 * This module implements the first option: while the host has no active task,
 * compare each CLI's installed version against the registry and reinstall only
 * the ones that moved. The second option is deliberately not taken — updating
 * inside a task's container would change the toolchain mid-run and make the
 * task's own logs unreproducible.
 *
 * Two packages are excluded on purpose:
 *
 *   - `@link-assistant/hive-mind` — replacing the package that owns the running
 *     process mid-flight is how you get a half-swapped bot. Hive Mind is updated
 *     by redeploying its image.
 *   - `start-command` — pinned by exact version in the Dockerfile because each
 *     bump encodes a behavioural fix Hive Mind depends on (see the pin comment
 *     in `Dockerfile`). Bumping it is a reviewed change, not a background one.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2146
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { resolveBotStateDir } from './session-store.lib.mjs';
import { withStateLock } from './state-lock.lib.mjs';

const execFileAsync = promisify(execFile);

const STATE_FILE_NAME = 'agentic-cli-updates.json';
const CLI_UPDATE_LOCK_NAME = 'agentic-cli-update';
const DEFAULT_COMMAND_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_INSTALL_TIMEOUT_MS = 15 * 60 * 1000;

/** Default minimum gap between registry checks, so a busy bot does not poll npm continuously. */
export const DEFAULT_CLI_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * The CLIs Hive Mind drives, in the same order the Dockerfile installs them.
 *
 * `installer: 'self'` is for Claude Code, which ships a native binary through
 * its own installer script; `claude update` is the supported refresh path and
 * `bun install -g` would fight the postinstall link (issue #1633).
 */
export const AGENTIC_CLI_TARGETS = Object.freeze([
  { id: 'claude', package: '@anthropic-ai/claude-code', binary: 'claude', installer: 'self', updateArgs: ['update'] },
  { id: 'codex', package: '@openai/codex', binary: 'codex', installer: 'bun' },
  { id: 'agent', package: '@link-assistant/agent', binary: 'agent', installer: 'bun' },
  { id: 'gemini', package: '@google/gemini-cli', binary: 'gemini', installer: 'bun' },
  { id: 'qwen', package: '@qwen-code/qwen-code', binary: 'qwen', installer: 'bun' },
  { id: 'copilot', package: '@github/copilot', binary: 'copilot', installer: 'bun' },
  { id: 'opencode', package: 'opencode-ai', binary: 'opencode', installer: 'bun' },
]);

/** Auto-update is on by default; operators can disable it or narrow it to a subset. */
export const isAgenticCliAutoUpdateEnabled = (env = process.env) => {
  const raw = String(env.HIVE_MIND_AGENTIC_CLI_AUTO_UPDATE ?? '')
    .trim()
    .toLowerCase();
  if (!raw) return true;
  return !['0', 'false', 'no', 'off'].includes(raw);
};

const parseIdList = value =>
  String(value ?? '')
    .split(',')
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean);

/**
 * Resolve which CLIs this host should refresh.
 *
 * `HIVE_MIND_AGENTIC_CLI_UPDATE_ONLY` is an allow-list and
 * `HIVE_MIND_AGENTIC_CLI_UPDATE_EXCLUDE` a deny-list, both by target id.
 */
export const listAgenticCliUpdateTargets = (env = process.env, { only: requested = [] } = {}) => {
  const only = parseIdList(env.HIVE_MIND_AGENTIC_CLI_UPDATE_ONLY);
  const excluded = new Set(parseIdList(env.HIVE_MIND_AGENTIC_CLI_UPDATE_EXCLUDE));
  // A caller-supplied narrowing (issue #2202, R6: refresh the CLIs a command is
  // about to drive) intersects with the operator's allow-list rather than
  // overriding it — an operator who excluded a CLI still gets it excluded.
  const caller = parseIdList(Array.isArray(requested) ? requested.join(',') : requested);
  return AGENTIC_CLI_TARGETS.filter(target => (only.length === 0 || only.includes(target.id)) && (caller.length === 0 || caller.includes(target.id)) && !excluded.has(target.id));
};

/** First semantic version in a CLI's `--version` output, which is rarely bare. */
export const parseCliVersion = text => String(text ?? '').match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/)?.[0] ?? null;

export const resolveAgenticCliStatePath = (env = process.env) => path.join(resolveBotStateDir(env), STATE_FILE_NAME);

/** Read the refresh journal. A missing or corrupt file is an empty journal, never a throw. */
export const readAgenticCliState = ({ env = process.env, fsImpl = fs } = {}) => {
  try {
    const parsed = JSON.parse(fsImpl.readFileSync(resolveAgenticCliStatePath(env), 'utf8'));
    return { version: 1, lastCheckedAt: null, tools: {}, ...parsed };
  } catch {
    return { version: 1, lastCheckedAt: null, tools: {} };
  }
};

/** Persist the refresh journal atomically. */
export const writeAgenticCliState = (state, { env = process.env, fsImpl = fs } = {}) => {
  const target = resolveAgenticCliStatePath(env);
  fsImpl.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  fsImpl.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  fsImpl.renameSync(temporary, target);
  return state;
};

/** Installed version of one CLI, or null when the binary is absent or mute. */
export const readInstalledCliVersion = async (target, { run = execFileAsync, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS } = {}) => {
  try {
    const result = await run(target.binary, ['--version'], { encoding: 'utf8', timeout: timeoutMs });
    return parseCliVersion(`${result?.stdout ?? ''}${result?.stderr ?? ''}`);
  } catch {
    return null;
  }
};

/** Latest version the npm registry publishes for one CLI, or null when unreachable. */
export const readLatestPublishedVersion = async (target, { run = execFileAsync, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS } = {}) => {
  try {
    const result = await run('npm', ['view', target.package, 'version'], { encoding: 'utf8', timeout: timeoutMs });
    return parseCliVersion(result?.stdout);
  } catch {
    return null;
  }
};

/** Reinstall one CLI at the latest published version. */
export const installAgenticCli = async (target, { run = execFileAsync, timeoutMs = DEFAULT_INSTALL_TIMEOUT_MS } = {}) => {
  if (target.installer === 'self') return run(target.binary, target.updateArgs ?? ['update'], { encoding: 'utf8', timeout: timeoutMs });
  return run('bun', ['install', '-g', `${target.package}@latest`], { encoding: 'utf8', timeout: timeoutMs });
};

/**
 * Refresh every configured agentic CLI, but only while the host is idle.
 *
 * Idleness is the same signal `hive cleanup` trusts: a task is active when it
 * holds a process or a non-terminal start-command session. Replacing a CLI
 * binary under a running task would swap the toolchain mid-run.
 *
 * @returns {Promise<{status: 'disabled'|'busy'|'throttled'|'checked', updated: object[], upToDate: object[], failed: object[]}>}
 */
export const updateAgenticClisWhenIdle = async ({ env = process.env, fsImpl = fs, run = execFileAsync, log = null, verbose = false, getActiveTasksImpl = null, now = () => new Date(), minIntervalMs = DEFAULT_CLI_UPDATE_INTERVAL_MS, force = false, only = [], lockOptions = {} } = {}) => {
  if (!isAgenticCliAutoUpdateEnabled(env)) {
    if (verbose && log) await log('[VERBOSE] agentic-cli-updater: disabled by HIVE_MIND_AGENTIC_CLI_AUTO_UPDATE');
    return { status: 'disabled', updated: [], upToDate: [], failed: [] };
  }

  return withStateLock(
    CLI_UPDATE_LOCK_NAME,
    async () => {
      const state = readAgenticCliState({ env, fsImpl });
      const nowMs = now().getTime();
      const lastCheckedMs = Date.parse(state.lastCheckedAt ?? '') || 0;
      if (!force && lastCheckedMs && nowMs - lastCheckedMs < minIntervalMs) {
        if (verbose && log) await log(`[VERBOSE] agentic-cli-updater: last checked ${Math.round((nowMs - lastCheckedMs) / 60000)} min ago; throttled`);
        return { status: 'throttled', updated: [], upToDate: [], failed: [] };
      }

      const getActiveTasks = getActiveTasksImpl ?? (await import('./cleanup.os.lib.mjs')).getActiveTasks;
      const activeTasks = await getActiveTasks({ resolveBranches: false });
      if (activeTasks.length > 0) {
        if (verbose && log) await log(`[VERBOSE] agentic-cli-updater: ${activeTasks.length} active task(s); deferring the CLI refresh`);
        return { status: 'busy', activeTaskCount: activeTasks.length, updated: [], upToDate: [], failed: [] };
      }

      const updated = [];
      const upToDate = [];
      const failed = [];
      const tools = { ...state.tools };

      for (const target of listAgenticCliUpdateTargets(env, { only })) {
        const installed = await readInstalledCliVersion(target, { run });
        if (!installed) {
          // Not installed on this host (image variants differ); nothing to refresh.
          if (verbose && log) await log(`[VERBOSE] agentic-cli-updater: ${target.id} is not installed here; skipping`);
          continue;
        }

        const latest = await readLatestPublishedVersion(target, { run });
        if (!latest) {
          failed.push({ id: target.id, installed, error: `could not read the published version of ${target.package}` });
          continue;
        }
        if (latest === installed) {
          upToDate.push({ id: target.id, version: installed });
          tools[target.id] = { ...tools[target.id], version: installed, checkedAt: now().toISOString() };
          continue;
        }

        if (log) await log(`⬆️ Updating ${target.id} ${installed} → ${latest}`);
        try {
          await installAgenticCli(target, { run });
        } catch (error) {
          const message = error?.stderr?.toString?.().trim() || error?.message || String(error);
          if (log) await log(`⚠️ Could not update ${target.id}: ${message}`);
          failed.push({ id: target.id, installed, latest, error: message });
          continue;
        }

        // Trust the binary, not the installer's exit code: a package can install
        // and still fail to link its bin.
        const after = await readInstalledCliVersion(target, { run });
        if (after === latest) {
          updated.push({ id: target.id, from: installed, to: after });
          tools[target.id] = { version: after, previousVersion: installed, updatedAt: now().toISOString(), checkedAt: now().toISOString() };
        } else {
          failed.push({ id: target.id, installed, latest, error: `after install the binary reports ${after ?? 'nothing'}` });
        }
      }

      writeAgenticCliState({ ...state, lastCheckedAt: now().toISOString(), tools }, { env, fsImpl });
      if (log && updated.length > 0) await log(`✅ Agentic CLIs updated while idle: ${updated.map(entry => `${entry.id} ${entry.from}→${entry.to}`).join(', ')}`);
      if (verbose && log) await log(`[VERBOSE] agentic-cli-updater: ${updated.length} updated, ${upToDate.length} current, ${failed.length} failed`);
      return { status: 'checked', updated, upToDate, failed };
    },
    { env, fsImpl, log, ...lockOptions }
  );
};

export default {
  AGENTIC_CLI_TARGETS,
  DEFAULT_CLI_UPDATE_INTERVAL_MS,
  installAgenticCli,
  isAgenticCliAutoUpdateEnabled,
  listAgenticCliUpdateTargets,
  parseCliVersion,
  readAgenticCliState,
  readInstalledCliVersion,
  readLatestPublishedVersion,
  resolveAgenticCliStatePath,
  updateAgenticClisWhenIdle,
  writeAgenticCliState,
};
