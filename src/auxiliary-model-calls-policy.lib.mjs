#!/usr/bin/env node
/**
 * Non-essential auxiliary model calls are off for every agentic CLI hive-mind
 * drives — except summarization, which stays on (issue #2236).
 *
 * Every one of these CLIs grew a second class of model calls that has nothing to
 * do with the task: a classifier that decides whether a command is safe, a
 * generator that invents a title for the conversation, a "recap" of what
 * happened while you were away, a narrator that writes a sentence about each
 * tool call, a suggester that proposes your next prompt. They exist because a
 * human is watching a terminal. In hive-mind nobody is watching: a container is
 * created, an issue is solved, a pull request is opened, the container is
 * destroyed. Each of those calls is an extra billed request against the same
 * rate limit the actual task needs, producing output that is written to a
 * session store nobody will ever open.
 *
 * The permission classifiers are the clearest case: hive-mind tasks already run
 * with unrestricted access inside a disposable container
 * (`--dangerously-skip-permissions`, `--dangerously-bypass-approvals-and-sandbox`,
 * `--approval-mode yolo`), so a classifier can only ever answer a question
 * nobody asked.
 *
 * Summarization is the exception, and it is an exception on purpose. Compaction
 * is what lets a run survive a long-horizon task instead of dying at the context
 * limit, so it is more than "allowed" — it is load-bearing. This module names the
 * knobs that must never be touched ({@link CLAUDE_SUMMARIZATION_KEEP_ENV},
 * {@link CODEX_SUMMARIZATION_KEEP_FEATURES},
 * {@link GEMINI_FAMILY_SUMMARIZATION_KEEP_SETTINGS},
 * {@link OPENCODE_KEEP_AGENTS}) alongside the ones it turns off, so "keep
 * compaction" is a tested fact rather than an omission someone has to notice.
 *
 * Verified against claude-code 2.1.269, codex-cli 0.153.4, gemini-cli 0.58.0,
 * qwen-code 0.23.0, opencode 1.18.29 and agent 0.26.1; every knob name below was
 * read out of the shipped binary and the provenance is written down in
 * `docs/case-studies/issue-2236/README.md`.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2236
 */

import { ensureGeminiFamilySettings } from './gemini-family-settings.lib.mjs';

/** Tools `solve --tool` accepts that this policy has something to say about. */
export const AUXILIARY_MODEL_CALLS_POLICY_TOOLS = Object.freeze(['claude', 'codex', 'gemini', 'qwen', 'opencode', 'agent']);

/**
 * Claude Code environment variables that switch off its non-essential model calls.
 *
 * Each name is a gate the shipped bundle reads directly; `'0'` is used rather
 * than unsetting because three of them are *remote* flags — the bundle falls
 * through to a GrowthBook lookup when the variable is undefined, so a rollout can
 * switch the feature on in a container that never opted in. Pinning the value is
 * what makes "off" hold. Claude Code parses these with a Zod `stringbool` whose
 * falsy set is `false|0|no|off|n|disabled`, so `'0'` is unambiguous.
 *
 * - `CLAUDE_CODE_CLASSIFIER_SUMMARY` selects the engine behind the
 *   `agent_classifier` query. `'0'` selects the `"heuristic"` engine, which makes
 *   the decision locally with no model call at all — this is the issue's
 *   "auto classifier".
 * - `CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES` gates `tool_use_summary_generation`,
 *   one model call per tool batch to label it for a UI hive-mind does not render.
 * - `CLAUDE_CODE_ENABLE_NARRATION` gates the `narration` query.
 * - `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION` gates `prompt_suggestion`, which
 *   drafts the *next* prompt for a human who is not there.
 * - `CLAUDE_CODE_ENABLE_REMOTE_RECAP` gates the remote recap — the issue's
 *   "recap" — and is the clearest remote-flag case: undefined falls through to
 *   the `tengu_harbor_moth` rollout.
 */
export const CLAUDE_AUXILIARY_DISABLE_ENV = Object.freeze({
  CLAUDE_CODE_CLASSIFIER_SUMMARY: '0',
  CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES: '0',
  CLAUDE_CODE_ENABLE_NARRATION: '0',
  CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: '0',
  CLAUDE_CODE_ENABLE_REMOTE_RECAP: '0',
});

/**
 * Claude Code environment variables that must never be set by hive-mind.
 *
 * Both exist in the shipped bundle and both would switch off the compaction the
 * issue explicitly carves out. They are listed so the test can assert their
 * absence: an unset variable looks the same whether it was considered and
 * rejected or simply never thought about, and only the first of those stays true.
 */
export const CLAUDE_SUMMARIZATION_KEEP_ENV = Object.freeze(['DISABLE_AUTO_COMPACT', 'DISABLE_COMPACT']);

/**
 * Codex feature flags pinned off for `codex exec`.
 *
 * - `goals` is the goal-tracking subsystem (`goal/src/{runtime,steering,tool}.rs`,
 *   `state/src/runtime/goals.rs`): it keeps a running model-maintained statement
 *   of what the thread is trying to do. A hive-mind task's goal is the issue, it
 *   is already in the prompt, and it does not change mid-run.
 * - `personality` injects a `personality.spec_instructions` block into the
 *   system prompt of every request. It is style for a human reader, paid for on
 *   each turn of a run no human reads.
 *
 * Codex's own title, recap and branch-summary generators live under `tui/src/`
 * (`tui/src/app/thread_title.rs`, `tui/src/app/recap.rs`,
 * `tui/src/branch_summary.rs`) and are unreachable from `codex exec`, so there is
 * no flag to set for them — see the case study for the full path inventory.
 */
export const CODEX_AUXILIARY_DISABLE_FEATURES = Object.freeze(['goals', 'personality']);

/**
 * Codex feature flags that must stay on: these are the compaction path.
 *
 * `remote_compaction_v2` performs the compaction itself and
 * `compaction_image_budget` is what keeps images from crowding the compacted
 * context. Both ship `true`; this list exists so a future "disable more Codex
 * features" change has to argue with a test.
 */
export const CODEX_SUMMARIZATION_KEEP_FEATURES = Object.freeze(['remote_compaction_v2', 'compaction_image_budget']);

/**
 * `-c features.<name>=false` overrides that turn
 * {@link CODEX_AUXILIARY_DISABLE_FEATURES} off.
 *
 * `-c` is used rather than the `--disable <name>` alias for the same reason
 * `buildCodexMemoryDisableConfigArgs` uses it: `-c` is accepted by every
 * `codex exec` version hive-mind supports.
 *
 * @param {boolean} [disabled=true] - false returns [] so the opt-out is a true no-op.
 * @returns {string[]}
 */
export const buildCodexAuxiliaryDisableConfigArgs = (disabled = true) => {
  if (!disabled) return [];
  return CODEX_AUXILIARY_DISABLE_FEATURES.flatMap(feature => ['-c', `features.${feature}=false`]);
};

/**
 * Gemini CLI settings that remove its two non-essential model calls.
 *
 * - `model.skipNextSpeakerCheck` skips the "who speaks next?" probe Gemini makes
 *   after a turn to decide whether to keep going on its own. In a
 *   `--yolo`/non-interactive run the answer is fixed.
 * - `tools.disableLLMCorrection` stops Gemini from re-asking a model to repair a
 *   malformed tool call. The correction is a second full call for an error the
 *   task's own retry path already handles.
 *
 * `model.summarizeToolOutput` is already undefined (off) by default and is left
 * alone rather than pinned, because pinning it would mean writing a
 * per-tool-name map that is wrong the moment Gemini renames a tool.
 */
export const GEMINI_AUXILIARY_DISABLE_SETTINGS = Object.freeze({
  model: Object.freeze({ skipNextSpeakerCheck: true }),
  tools: Object.freeze({ disableLLMCorrection: true }),
});

/**
 * Qwen Code settings that remove its non-essential model calls.
 *
 * Qwen forked Gemini CLI before several of these keys existed and has since
 * diverged: it has `model.skipNextSpeakerCheck` but no `tools.disableLLMCorrection`,
 * and it added two of its own.
 *
 * - `experimental.emitToolUseSummaries` is Qwen's own description: "Generate a
 *   short LLM-based label after each tool batch completes."
 * - `ui.enableFollowupSuggestions` drafts follow-up prompts for a human.
 */
export const QWEN_AUXILIARY_DISABLE_SETTINGS = Object.freeze({
  model: Object.freeze({ skipNextSpeakerCheck: true }),
  experimental: Object.freeze({ emitToolUseSummaries: false }),
  ui: Object.freeze({ enableFollowupSuggestions: false }),
});

/** Which auxiliary settings each Gemini-family CLI gets. */
export const GEMINI_FAMILY_AUXILIARY_DISABLE_SETTINGS = Object.freeze({
  gemini: GEMINI_AUXILIARY_DISABLE_SETTINGS,
  qwen: QWEN_AUXILIARY_DISABLE_SETTINGS,
});

/**
 * Gemini-family settings keys that must never be written by this policy.
 *
 * These are the compaction controls: Gemini compacts when the context reaches
 * `model.compressionThreshold` (0.5 by default), Qwen at
 * `context.autoCompactThreshold` (0.85) using `model.chatCompression` /
 * `model.compactionModel`. The test asserts that no key under any dotted path
 * here appears in the settings this module merges.
 */
export const GEMINI_FAMILY_SUMMARIZATION_KEEP_SETTINGS = Object.freeze({
  gemini: Object.freeze(['model.compressionThreshold', 'model.disableLoopDetection']),
  qwen: Object.freeze(['model.chatCompression', 'model.compactionModel', 'context.autoCompactThreshold']),
});

/**
 * Write the auxiliary-call policy into a Gemini-family settings file, preserving
 * everything already there. Never throws.
 *
 * @param {Object} [params]
 * @param {'gemini'|'qwen'} params.tool
 * @param {string} [params.settingsPath]
 * @param {string} [params.homeDir]
 * @param {Function} [params.log]
 * @param {Object} [params.fsImpl]
 * @returns {Promise<{applied: boolean, path: string|null, changed: string[], error: string|null}>}
 */
export const ensureGeminiFamilyAuxiliaryDisabled = async ({ tool, settingsPath, homeDir, log, fsImpl } = {}) => {
  const settings = GEMINI_FAMILY_AUXILIARY_DISABLE_SETTINGS[tool];
  if (!settings) return { applied: false, path: null, changed: [], error: null };
  return ensureGeminiFamilySettings({ tool, settings, settingsPath, homeDir, log, describe: '\u{1F515} Non-essential model calls policy (issue #2236)', fsImpl });
};

/**
 * OpenCode built-in agents disabled for hive-mind runs.
 *
 * OpenCode ships three hidden internal agents — `compaction`, `title` and
 * `summary` — each of which is a separate model call with its own system prompt.
 * `SessionPrompt.ensureTitle` resolves the `title` agent and returns early when
 * it is absent, so removing the agent removes the call; on a fresh `opencode run`
 * that call fires unconditionally, because the session's title is still the
 * generated default (`"New session - <ISO timestamp>"`). The `summary` agent
 * ("Summarize what was done in this conversation. Write like a pull request
 * description.") writes a blurb for a session list hive-mind never shows.
 *
 * Verified on opencode 1.18.29: with this config `opencode agent list` reports
 * `build`, `plan`, `explore`, `general` and `compaction`, and no longer reports
 * `title` or `summary`.
 */
export const OPENCODE_DISABLED_AGENTS = Object.freeze(['title', 'summary']);

/**
 * OpenCode built-in agents that must stay: `compaction` is the summarization the
 * issue carves out. `SessionCompaction.process` resolves it by name, so
 * disabling it would not make compaction cheaper — it would remove it.
 */
export const OPENCODE_KEEP_AGENTS = Object.freeze(['compaction']);

/**
 * The `agent` block hive-mind merges into the per-task `opencode.json`.
 *
 * @param {boolean} [disabled=true] - false returns {} so the opt-out writes nothing.
 * @returns {Object}
 */
export const buildOpencodeAuxiliaryAgentConfig = (disabled = true) => {
  if (!disabled) return {};
  return Object.fromEntries(OPENCODE_DISABLED_AGENTS.map(name => [name, { disable: true }]));
};

/**
 * Tools that already ship compliant with this policy.
 *
 * `agent` (`@link-assistant/agent`) defaults `--generate-title` to false — its
 * own help text says "Disabling saves tokens and prevents rate limit issues" —
 * and keeps `--summarize-session` on, which is exactly the split this issue
 * asks for. Recorded explicitly because "we looked and there was nothing to fix"
 * and "nobody looked" are different states, and only the first stays true.
 */
export const TOOLS_ALREADY_COMPLIANT = Object.freeze(['agent']);

/**
 * Is the policy on for this run?
 *
 * Reads `--auxiliary-model-calls-disabled`, which defaults to true. Only an
 * explicit `--no-auxiliary-model-calls-disabled` turns it off, so an argv object
 * that predates the flag still gets the policy.
 *
 * @param {Object} [argv]
 */
export const isAuxiliaryModelCallsDisabled = (argv = {}) => argv?.auxiliaryModelCallsDisabled !== false;

/**
 * One line describing what the policy does for a tool, for `--verbose` logs and
 * for the docs to quote without drifting from the code.
 *
 * @param {string} tool
 * @returns {string}
 */
export const describeAuxiliaryModelCallsPolicy = tool => {
  switch (tool) {
    case 'claude':
      return `env ${Object.entries(CLAUDE_AUXILIARY_DISABLE_ENV)
        .map(([key, value]) => `${key}=${value}`)
        .join(', ')}`;
    case 'codex':
      return buildCodexAuxiliaryDisableConfigArgs(true).join(' ');
    case 'gemini':
    case 'qwen':
      return `settings ${JSON.stringify(GEMINI_FAMILY_AUXILIARY_DISABLE_SETTINGS[tool])}`;
    case 'opencode':
      return `opencode.json agent ${JSON.stringify(buildOpencodeAuxiliaryAgentConfig(true))}`;
    default:
      return TOOLS_ALREADY_COMPLIANT.includes(tool) ? 'ships with non-essential model calls already off' : 'no policy recorded for this tool';
  }
};

export default {
  AUXILIARY_MODEL_CALLS_POLICY_TOOLS,
  CLAUDE_AUXILIARY_DISABLE_ENV,
  CLAUDE_SUMMARIZATION_KEEP_ENV,
  CODEX_AUXILIARY_DISABLE_FEATURES,
  CODEX_SUMMARIZATION_KEEP_FEATURES,
  GEMINI_AUXILIARY_DISABLE_SETTINGS,
  GEMINI_FAMILY_AUXILIARY_DISABLE_SETTINGS,
  GEMINI_FAMILY_SUMMARIZATION_KEEP_SETTINGS,
  OPENCODE_DISABLED_AGENTS,
  OPENCODE_KEEP_AGENTS,
  QWEN_AUXILIARY_DISABLE_SETTINGS,
  TOOLS_ALREADY_COMPLIANT,
  buildCodexAuxiliaryDisableConfigArgs,
  buildOpencodeAuxiliaryAgentConfig,
  describeAuxiliaryModelCallsPolicy,
  ensureGeminiFamilyAuxiliaryDisabled,
  isAuxiliaryModelCallsDisabled,
};
