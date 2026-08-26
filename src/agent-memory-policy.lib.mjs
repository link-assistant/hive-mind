#!/usr/bin/env node
/**
 * Cross-task memory is off for every agentic CLI hive-mind drives (issue #2178).
 *
 * A hive-mind task is a one-shot: a container is created, an issue is solved, a
 * pull request is opened, the container is destroyed. Nothing an agent learns in
 * one task is meant to reach the next one. The repository is the memory — commits,
 * issues, pull requests, `docs/case-studies/` — and it is the only memory a
 * reviewer can see, correct, or revert.
 *
 * Every agentic CLI now ships some form of private cross-session memory that
 * works against that. It is not free:
 *
 *   - it burns inference on top of the task (Gemini CLI runs a whole background
 *     extraction agent over past sessions; Claude Code loads a memory index into
 *     every session);
 *   - it carries facts between unrelated repositories with no review step;
 *   - it makes a run irreproducible — the same prompt on the same commit behaves
 *     differently depending on what the tool happened to remember.
 *
 * The permission classifiers are the same kind of waste for the same reason.
 * Claude Code's "auto" mode pays a classifier call per tool use to decide whether
 * an action is safe. Hive-mind tasks already run with unrestricted access inside a
 * disposable Docker container (`--dangerously-skip-permissions`,
 * `--dangerously-bypass-approvals-and-sandbox`, `--approval-mode yolo`), so the
 * classifier can only ever answer a question nobody asked.
 *
 * This module is the single place that knows which knob turns each of these off,
 * so `solve` and the Docker image baseline stay in agreement and a new tool
 * version cannot quietly re-enable one of them without a test noticing.
 *
 * Verified against claude-code 2.1.246, codex-cli 0.148.0, gemini-cli 0.51.0,
 * qwen-code 0.7.1 and opencode 1.18.5; see `docs/case-studies/issue-2178/`.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2178
 */

import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Tools `solve --tool` accepts that this policy has something to say about. */
export const AGENT_MEMORY_POLICY_TOOLS = Object.freeze(['claude', 'codex', 'gemini', 'qwen', 'opencode', 'agent']);

/**
 * Claude Code environment variables that switch off every cross-session memory
 * store it can reach.
 *
 * `CLAUDE_CODE_DISABLE_AUTO_MEMORY` disables the per-project memory directory,
 * and the same branch also refuses the team stores named by
 * `CLAUDE_MEMORY_STORES`. `CLAUDE_CODE_DISABLE_ORG_MEMORY` disables the
 * organization-wide memory sync, which is gated separately.
 */
export const CLAUDE_MEMORY_DISABLE_ENV = Object.freeze({
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
  CLAUDE_CODE_DISABLE_ORG_MEMORY: '1',
});

/**
 * Claude Code settings that switch off memory.
 *
 * `autoMemoryEnabled: false` is the settings-file equivalent of
 * `CLAUDE_CODE_DISABLE_AUTO_MEMORY` — both are checked, and either one is
 * enough, so they are set together rather than one being trusted alone.
 */
export const CLAUDE_MEMORY_DISABLE_SETTINGS = Object.freeze({
  autoMemoryEnabled: false,
});

/**
 * Claude Code `permissions` block that removes auto mode.
 *
 * `"disable"` is the only value the setting accepts, and it is checked before
 * the plan-level, provider-level and model-level gates, so it holds regardless
 * of which provider or model a task runs on. Auto mode is what pays for the
 * classifier; with it gone the classifier has no caller.
 */
export const CLAUDE_AUTO_MODE_DISABLE_PERMISSIONS = Object.freeze({
  disableAutoMode: 'disable',
});

/**
 * Codex feature flags that hold its memory subsystem off.
 *
 * `memories` is the `~/.codex/memories` store Codex writes across sessions;
 * `external_agent_memory_import` pulls another agent's memory in. Both default
 * to off today, but `memories` is stage `stable`, so it can be switched on by a
 * rollout or by an operator's `~/.codex/config.toml` — pinning them per run is
 * what makes the default actually hold.
 */
export const CODEX_MEMORY_DISABLE_FEATURES = Object.freeze(['memories', 'external_agent_memory_import']);

/**
 * `-c key=value` overrides that turn {@link CODEX_MEMORY_DISABLE_FEATURES} off.
 *
 * `-c features.<name>=false` is used rather than the `--disable <name>` alias
 * because `--disable` is documented as exactly equivalent and `-c` is accepted
 * by every `codex exec` version hive-mind supports.
 *
 * @param {boolean} [disabled=true] - false returns [] so `--no-agent-memory-disabled` is a no-op.
 * @returns {string[]}
 */
export const buildCodexMemoryDisableConfigArgs = (disabled = true) => {
  if (!disabled) return [];
  return CODEX_MEMORY_DISABLE_FEATURES.flatMap(feature => ['-c', `features.${feature}=false`]);
};

/**
 * Tool name (as the CLI exposes it) of the Gemini-family memory writer.
 *
 * Gemini CLI dropped `save_memory` in 0.51 in favour of the `experimental.autoMemory`
 * background extractor; Qwen Code, forked earlier, still ships the tool. Excluding
 * the name covers the versions that have it and is inert on the versions that do not.
 */
export const GEMINI_FAMILY_MEMORY_TOOL = 'save_memory';

/**
 * Settings merged into `~/.gemini/settings.json` and `~/.qwen/settings.json`.
 *
 * `tools.exclude` is the nested form both CLIs resolve to (Qwen maps its legacy
 * flat `excludeTools` onto it). `experimental.autoMemory` gates Gemini's
 * background "skill extraction" agent, which re-reads past sessions with a second
 * model and writes a memory index — the most expensive item on this list.
 */
export const GEMINI_FAMILY_MEMORY_DISABLE_SETTINGS = Object.freeze({
  tools: Object.freeze({ exclude: Object.freeze([GEMINI_FAMILY_MEMORY_TOOL]) }),
  experimental: Object.freeze({ autoMemory: false }),
});

/** Where each Gemini-family CLI keeps its user settings. */
export const GEMINI_FAMILY_SETTINGS_PATHS = Object.freeze({
  gemini: Object.freeze(['.gemini', 'settings.json']),
  qwen: Object.freeze(['.qwen', 'settings.json']),
});

/**
 * Tools with no cross-session memory feature to switch off.
 *
 * Recorded explicitly rather than left out: "we looked and there was nothing" and
 * "nobody looked" are different states, and only the first one stays true without
 * someone re-checking. The test for this module asserts the list, so a future
 * reader can see the claim was made deliberately.
 */
export const TOOLS_WITHOUT_MEMORY_FEATURE = Object.freeze(['opencode', 'agent']);

/**
 * Is the policy on for this run?
 *
 * Reads `--agent-memory-disabled`, which defaults to true. Only an explicit
 * `--no-agent-memory-disabled` turns it off, so an argv object that predates the
 * flag (or omits it) still gets the policy.
 *
 * @param {Object} [argv]
 */
export const isAgentMemoryDisabled = (argv = {}) => argv?.agentMemoryDisabled !== false;

const isPlainObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * Merge `desired` into `target` in place, returning the dotted paths that changed.
 *
 * Arrays are unioned rather than replaced so an operator's own `tools.exclude`
 * entries survive; scalars are overwritten, because the whole point is that the
 * policy wins.
 */
const mergeSettings = (target, desired, prefix = '') => {
  const changed = [];
  for (const [key, value] of Object.entries(desired)) {
    const dotted = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) {
      if (!isPlainObject(target[key])) target[key] = {};
      changed.push(...mergeSettings(target[key], value, dotted));
      continue;
    }
    if (Array.isArray(value)) {
      const existing = Array.isArray(target[key]) ? target[key] : [];
      const merged = [...existing];
      let added = false;
      for (const entry of value) {
        if (!merged.includes(entry)) {
          merged.push(entry);
          added = true;
        }
      }
      if (added || !Array.isArray(target[key])) {
        target[key] = merged;
        changed.push(dotted);
      }
      continue;
    }
    if (target[key] !== value) {
      target[key] = value;
      changed.push(dotted);
    }
  }
  return changed;
};

/**
 * Resolve the settings file a Gemini-family CLI reads.
 *
 * @param {'gemini'|'qwen'} tool
 * @param {Object} [options]
 * @param {string} [options.homeDir]
 * @returns {string|null} null when the tool has no Gemini-family settings file.
 */
export const resolveGeminiFamilySettingsPath = (tool, { homeDir = os.homedir() } = {}) => {
  const segments = GEMINI_FAMILY_SETTINGS_PATHS[tool];
  if (!segments) return null;
  return path.join(homeDir, ...segments);
};

/**
 * Write {@link GEMINI_FAMILY_MEMORY_DISABLE_SETTINGS} into a Gemini-family
 * settings file, preserving everything already there.
 *
 * Never throws. A task that cannot write the settings file is still a task worth
 * running: the failure costs inference, not correctness, and the caller logs it.
 *
 * @param {Object} [params]
 * @param {'gemini'|'qwen'} params.tool
 * @param {string} [params.settingsPath] - Overrides the tool's default location (tests).
 * @param {string} [params.homeDir]
 * @param {Function} [params.log]
 * @param {Object} [params.fsImpl] - `node:fs/promises`-shaped, for tests.
 * @returns {Promise<{applied: boolean, path: string|null, changed: string[], error: string|null}>}
 */
export const ensureGeminiFamilyMemoryDisabled = async ({ tool, settingsPath, homeDir = os.homedir(), log, fsImpl = fsPromises } = {}) => {
  const resolvedPath = settingsPath || resolveGeminiFamilySettingsPath(tool, { homeDir });
  if (!resolvedPath) return { applied: false, path: null, changed: [], error: null };

  let settings = {};
  try {
    const parsed = JSON.parse(await fsImpl.readFile(resolvedPath, 'utf-8'));
    if (isPlainObject(parsed)) settings = parsed;
  } catch (error) {
    if (error?.code !== 'ENOENT' && log) {
      await log(`⚠️  Could not read ${resolvedPath}: ${error.message}`, { verbose: true });
    }
  }

  const changed = mergeSettings(settings, GEMINI_FAMILY_MEMORY_DISABLE_SETTINGS);
  try {
    if (changed.length > 0) {
      await fsImpl.mkdir(path.dirname(resolvedPath), { recursive: true });
      await fsImpl.writeFile(resolvedPath, JSON.stringify(settings, null, 2));
    }
    if (log) {
      await log(`🧠 Cross-task memory ${changed.length > 0 ? 'disabled' : 'already disabled'} for ${tool} in ${resolvedPath} (issue #2178)`, { verbose: true });
    }
    return { applied: true, path: resolvedPath, changed, error: null };
  } catch (error) {
    const message = error?.message || String(error);
    if (log) await log(`⚠️  Could not write ${resolvedPath}: ${message}`, { verbose: true });
    return { applied: false, path: resolvedPath, changed: [], error: message };
  }
};

/**
 * One line describing what the policy does for a tool, for `--verbose` logs and
 * for the docs to quote without drifting from the code.
 *
 * @param {string} tool
 * @returns {string}
 */
export const describeAgentMemoryPolicy = tool => {
  switch (tool) {
    case 'claude':
      return `settings ${JSON.stringify({ ...CLAUDE_MEMORY_DISABLE_SETTINGS, permissions: CLAUDE_AUTO_MODE_DISABLE_PERMISSIONS })}, env ${Object.keys(CLAUDE_MEMORY_DISABLE_ENV).join(', ')}`;
    case 'codex':
      return buildCodexMemoryDisableConfigArgs(true).join(' ');
    case 'gemini':
    case 'qwen':
      return `settings ${JSON.stringify(GEMINI_FAMILY_MEMORY_DISABLE_SETTINGS)}`;
    default:
      return TOOLS_WITHOUT_MEMORY_FEATURE.includes(tool) ? 'no cross-session memory feature to disable' : 'no policy recorded for this tool';
  }
};

export default {
  AGENT_MEMORY_POLICY_TOOLS,
  CLAUDE_AUTO_MODE_DISABLE_PERMISSIONS,
  CLAUDE_MEMORY_DISABLE_ENV,
  CLAUDE_MEMORY_DISABLE_SETTINGS,
  CODEX_MEMORY_DISABLE_FEATURES,
  GEMINI_FAMILY_MEMORY_DISABLE_SETTINGS,
  GEMINI_FAMILY_MEMORY_TOOL,
  GEMINI_FAMILY_SETTINGS_PATHS,
  TOOLS_WITHOUT_MEMORY_FEATURE,
  buildCodexMemoryDisableConfigArgs,
  describeAgentMemoryPolicy,
  ensureGeminiFamilyMemoryDisabled,
  isAgentMemoryDisabled,
  resolveGeminiFamilySettingsPath,
};
