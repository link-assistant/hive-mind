#!/usr/bin/env node
/**
 * Issue #2236 — no AI tool makes an auxiliary model call nobody will read, and
 * every AI tool keeps its summarization.
 *
 * These assertions are about *policy*, not about the CLIs: they run without
 * claude, codex, gemini, qwen or opencode installed. What they protect is the
 * wiring — that every launch path consults the policy, that
 * `--no-auxiliary-model-calls-disabled` really is the only way to opt out, that an
 * operator's own settings survive the merge, and above all that the compaction
 * knobs are still untouched. The last one is the reason half of this file is
 * negative assertions: the issue carves summarization out explicitly, and a
 * carve-out that is only an omission stops being true the first time someone
 * adds "one more thing to disable".
 *
 * The knob names were read out of the shipped binaries (claude-code 2.1.269,
 * codex-cli 0.153.4, gemini-cli 0.58.0, qwen-code 0.23.0, opencode 1.18.29,
 * agent 0.26.1); the provenance is written down in
 * `docs/case-studies/issue-2236/README.md`, because a name that is right today
 * is only right until the next release.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2236
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { AUXILIARY_MODEL_CALLS_POLICY_TOOLS, CLAUDE_AUXILIARY_DISABLE_ENV, CLAUDE_SUMMARIZATION_KEEP_ENV, CODEX_AUXILIARY_DISABLE_FEATURES, CODEX_SUMMARIZATION_KEEP_FEATURES, GEMINI_AUXILIARY_DISABLE_SETTINGS, GEMINI_FAMILY_AUXILIARY_DISABLE_SETTINGS, GEMINI_FAMILY_SUMMARIZATION_KEEP_SETTINGS, OPENCODE_DISABLED_AGENTS, OPENCODE_KEEP_AGENTS, QWEN_AUXILIARY_DISABLE_SETTINGS, TOOLS_ALREADY_COMPLIANT, buildCodexAuxiliaryDisableConfigArgs, buildOpencodeAuxiliaryAgentConfig, describeAuxiliaryModelCallsPolicy, ensureGeminiFamilyAuxiliaryDisabled, isAuxiliaryModelCallsDisabled } from '../src/auxiliary-model-calls-policy.lib.mjs';
import { REQUIRED_CLAUDE_QUIET_ENV, REQUIRED_CLAUDE_QUIET_SETTINGS, ensureClaudeQuietConfig } from '../src/claude-quiet-config.lib.mjs';
import { getClaudeEnv } from '../src/config.lib.mjs';
import { TASK_TOOL_CHOICES } from '../src/task.config.lib.mjs';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const readSource = name => fs.readFile(path.join(repoRoot, name), 'utf-8');

let passed = 0;
const check = (label, fn) => {
  fn();
  passed += 1;
  console.log(`✅ ${label}`);
};
const checkAsync = async (label, fn) => {
  await fn();
  passed += 1;
  console.log(`✅ ${label}`);
};

/** Every leaf value of a nested settings object, as dotted paths. */
const dottedPaths = (object, prefix = '') =>
  Object.entries(object).flatMap(([key, value]) => {
    const dotted = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === 'object' && !Array.isArray(value) ? dottedPaths(value, dotted) : [dotted];
  });

// ---------------------------------------------------------------------------
// The policy covers every tool solve can launch
// ---------------------------------------------------------------------------

check('every --tool choice has an auxiliary-call policy entry', () => {
  for (const tool of TASK_TOOL_CHOICES) {
    assert.ok(AUXILIARY_MODEL_CALLS_POLICY_TOOLS.includes(tool), `${tool} is a --tool choice but has no auxiliary-call policy entry`);
  }
});

check('every policy tool either has a knob or is recorded as already compliant', () => {
  for (const tool of AUXILIARY_MODEL_CALLS_POLICY_TOOLS) {
    assert.notEqual(describeAuxiliaryModelCallsPolicy(tool), 'no policy recorded for this tool', `${tool} needs either a knob or a TOOLS_ALREADY_COMPLIANT entry`);
  }
  // `agent` is @link-assistant/agent: --generate-title already defaults to false
  // and --summarize-session already defaults to true. Changing this list means
  // re-reading its run-options, not just editing the array.
  assert.deepEqual([...TOOLS_ALREADY_COMPLIANT], ['agent'], 'agent was checked and already ships with non-essential model calls off');
});

// ---------------------------------------------------------------------------
// Claude Code
// ---------------------------------------------------------------------------

check('the five Claude auxiliary gates are pinned to 0, not merely unset', () => {
  // Three of these fall through to a GrowthBook rollout when undefined, so
  // "unset" is not "off" — the literal '0' is the whole point. Claude Code parses
  // them with a Zod stringbool whose falsy set is false|0|no|off|n|disabled.
  assert.deepEqual(CLAUDE_AUXILIARY_DISABLE_ENV, {
    CLAUDE_CODE_CLASSIFIER_SUMMARY: '0',
    CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES: '0',
    CLAUDE_CODE_ENABLE_NARRATION: '0',
    CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: '0',
    CLAUDE_CODE_ENABLE_REMOTE_RECAP: '0',
  });
});

check('the quiet config and the spawned CLI both carry the auxiliary gates', () => {
  const env = getClaudeEnv();
  for (const [key, value] of Object.entries(CLAUDE_AUXILIARY_DISABLE_ENV)) {
    assert.equal(REQUIRED_CLAUDE_QUIET_ENV[key], value, `REQUIRED_CLAUDE_QUIET_ENV must force ${key}=${value}`);
    assert.equal(env[key], value, `getClaudeEnv should export ${key}=${value}`);
  }
});

check('Claude compaction is never switched off', () => {
  assert.deepEqual([...CLAUDE_SUMMARIZATION_KEEP_ENV], ['DISABLE_AUTO_COMPACT', 'DISABLE_COMPACT']);
  const env = getClaudeEnv();
  for (const key of CLAUDE_SUMMARIZATION_KEEP_ENV) {
    assert.equal(Object.prototype.hasOwnProperty.call(REQUIRED_CLAUDE_QUIET_ENV, key), false, `${key} must never appear in the quiet env — auto-compaction is the exception this issue carves out`);
    assert.equal(env[key], undefined, `${key} must never reach the spawned CLI`);
    assert.equal(Object.prototype.hasOwnProperty.call(REQUIRED_CLAUDE_QUIET_SETTINGS, key), false, `${key} must never appear in the quiet settings`);
  }
});

await checkAsync('a fresh settings file comes out with the auxiliary gates off and compaction untouched', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-2236-claude-'));
  try {
    const settingsPath = path.join(tmp, 'settings.json');
    await ensureClaudeQuietConfig({ settingsPath });
    const written = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
    for (const [key, value] of Object.entries(CLAUDE_AUXILIARY_DISABLE_ENV)) {
      assert.equal(written.env[key], value, `settings env should force ${key}=${value}`);
    }
    for (const key of CLAUDE_SUMMARIZATION_KEEP_ENV) {
      assert.equal(Object.prototype.hasOwnProperty.call(written.env, key), false, `${key} must not be written into ~/.claude/settings.json`);
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

await checkAsync('every image baseline carries the auxiliary gates and no compaction switch', async () => {
  // Dockerfile.dind is included here even though the quiet-config test only
  // covers Dockerfile and coolify/Dockerfile: a container that opts out of the
  // policy by being built from a different file is the failure mode this guards.
  for (const file of ['Dockerfile', 'coolify/Dockerfile', 'Dockerfile.dind']) {
    const content = await readSource(file);
    for (const [key, value] of Object.entries(CLAUDE_AUXILIARY_DISABLE_ENV)) {
      assert.ok(content.includes(`${key}=${value}`), `${file} should set ${key}=${value} via ENV`);
    }
    for (const key of CLAUDE_SUMMARIZATION_KEEP_ENV) {
      assert.ok(!content.includes(`${key}=`), `${file} must never set ${key} — compaction stays on`);
    }
    assert.ok(content.includes('issue #2236'), `${file} should say why these gates are pinned`);
  }
});

// ---------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------

check('Codex auxiliary features are pinned off as -c overrides', () => {
  assert.deepEqual(buildCodexAuxiliaryDisableConfigArgs(true), ['-c', 'features.goals=false', '-c', 'features.personality=false']);
  assert.deepEqual([...CODEX_AUXILIARY_DISABLE_FEATURES], ['goals', 'personality']);
});

check('--no-auxiliary-model-calls-disabled leaves the Codex command line untouched', () => {
  assert.deepEqual(buildCodexAuxiliaryDisableConfigArgs(false), [], 'opting out must add no arguments at all, not arguments set to true');
});

check('the Codex compaction features are never in the disable list', () => {
  assert.deepEqual([...CODEX_SUMMARIZATION_KEEP_FEATURES], ['remote_compaction_v2', 'compaction_image_budget']);
  for (const feature of CODEX_SUMMARIZATION_KEEP_FEATURES) {
    assert.ok(!CODEX_AUXILIARY_DISABLE_FEATURES.includes(feature), `${feature} performs the compaction — disabling it would remove summarization, not make it cheaper`);
    assert.ok(!buildCodexAuxiliaryDisableConfigArgs(true).includes(`features.${feature}=false`), `${feature} must never appear on the command line`);
  }
});

await checkAsync('both Codex launch paths append the auxiliary overrides', async () => {
  const codexLib = await readSource('src/codex.lib.mjs');
  assert.ok(codexLib.includes('buildCodexAuxiliaryDisableConfigArgs(isAuxiliaryModelCallsDisabled(argv))'), 'codex.lib must build the overrides from argv, not unconditionally');
  assert.ok(/const auxiliaryDisableArgs[\s\S]{0,240}codexArgs \+= ` \$\{shellQuote\(arg\)\}`/.test(codexLib), 'codex.lib must append the overrides onto codexArgs');
  const commanderLib = await readSource('src/agent-commander.lib.mjs');
  assert.ok(commanderLib.includes('buildCodexAuxiliaryDisableConfigArgs(isAuxiliaryModelCallsDisabled(argv))'), 'the --use-agent-commander codex path must disable them too');
});

// ---------------------------------------------------------------------------
// Gemini family (gemini, qwen)
// ---------------------------------------------------------------------------

check('Gemini and Qwen get the knobs each of them actually has', () => {
  assert.equal(GEMINI_AUXILIARY_DISABLE_SETTINGS.model.skipNextSpeakerCheck, true, 'the "who speaks next?" probe is a whole extra call per turn');
  assert.equal(GEMINI_AUXILIARY_DISABLE_SETTINGS.tools.disableLLMCorrection, true, 'a malformed tool call is retried by the task, not repaired by a second model call');
  assert.equal(QWEN_AUXILIARY_DISABLE_SETTINGS.model.skipNextSpeakerCheck, true);
  assert.equal(QWEN_AUXILIARY_DISABLE_SETTINGS.experimental.emitToolUseSummaries, false, "Qwen's own description: a short LLM-based label after each tool batch");
  assert.equal(QWEN_AUXILIARY_DISABLE_SETTINGS.ui.enableFollowupSuggestions, false, 'follow-up prompts are drafted for a human who is not there');
  // qwen-code 0.23.0 has zero occurrences of `disableLLMCorrection`; writing it
  // would be a setting the CLI never reads, which is how stale policy accumulates.
  assert.equal(Object.prototype.hasOwnProperty.call(QWEN_AUXILIARY_DISABLE_SETTINGS.model, 'disableLLMCorrection'), false, 'qwen-code has no LLM tool-call correction to disable');
  assert.equal(GEMINI_FAMILY_AUXILIARY_DISABLE_SETTINGS.gemini, GEMINI_AUXILIARY_DISABLE_SETTINGS);
  assert.equal(GEMINI_FAMILY_AUXILIARY_DISABLE_SETTINGS.qwen, QWEN_AUXILIARY_DISABLE_SETTINGS);
});

check('no compaction setting is ever written for gemini or qwen', () => {
  for (const [tool, keepKeys] of Object.entries(GEMINI_FAMILY_SUMMARIZATION_KEEP_SETTINGS)) {
    const written = dottedPaths(GEMINI_FAMILY_AUXILIARY_DISABLE_SETTINGS[tool]);
    for (const key of keepKeys) {
      assert.ok(!written.includes(key), `${tool}: ${key} controls compaction and must never be written by this policy`);
    }
  }
  assert.ok(GEMINI_FAMILY_SUMMARIZATION_KEEP_SETTINGS.gemini.includes('model.compressionThreshold'), 'gemini compacts at model.compressionThreshold (0.5 by default)');
  assert.ok(GEMINI_FAMILY_SUMMARIZATION_KEEP_SETTINGS.qwen.includes('context.autoCompactThreshold'), 'qwen compacts at context.autoCompactThreshold (0.85 by default)');
});

await checkAsync('a missing settings file is created with the policy in it', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-2236-gemini-'));
  try {
    const result = await ensureGeminiFamilyAuxiliaryDisabled({ tool: 'gemini', homeDir: tmp });
    assert.equal(result.applied, true);
    assert.equal(result.error, null);
    const written = JSON.parse(await fs.readFile(path.join(tmp, '.gemini', 'settings.json'), 'utf-8'));
    assert.equal(written.model.skipNextSpeakerCheck, true);
    assert.equal(written.tools.disableLLMCorrection, true);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

await checkAsync("an operator's own settings — including their compaction threshold — survive", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-2236-qwen-'));
  try {
    const settingsPath = path.join(tmp, '.qwen', 'settings.json');
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(settingsPath, JSON.stringify({ theme: 'dark', model: { compactionModel: 'qwen3-coder-plus', skipNextSpeakerCheck: false }, context: { autoCompactThreshold: 0.7 }, ui: { hideBanner: true } }, null, 2));
    await ensureGeminiFamilyAuxiliaryDisabled({ tool: 'qwen', homeDir: tmp });
    const written = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
    assert.equal(written.model.skipNextSpeakerCheck, true, 'an operator who turned the probe back on gets it turned off for the task');
    assert.equal(written.model.compactionModel, 'qwen3-coder-plus', 'the compaction model must survive untouched');
    assert.equal(written.context.autoCompactThreshold, 0.7, 'the compaction threshold must survive untouched');
    assert.equal(written.ui.hideBanner, true, 'sibling ui settings must survive');
    assert.equal(written.ui.enableFollowupSuggestions, false, 'and the policy still applies alongside them');
    assert.equal(written.theme, 'dark', 'unrelated settings must survive');
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

await checkAsync('an already-compliant settings file is left byte-identical', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-2236-noop-'));
  try {
    const settingsPath = path.join(tmp, '.gemini', 'settings.json');
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    const original = JSON.stringify({ model: { skipNextSpeakerCheck: true }, tools: { disableLLMCorrection: true } }, null, 2);
    await fs.writeFile(settingsPath, original);
    const result = await ensureGeminiFamilyAuxiliaryDisabled({ tool: 'gemini', homeDir: tmp });
    assert.deepEqual(result.changed, [], 'nothing to change means nothing is written');
    assert.equal(await fs.readFile(settingsPath, 'utf-8'), original, 'a compliant file must not be rewritten');
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

await checkAsync('an unwritable settings file degrades to a warning, never a throw', async () => {
  const logs = [];
  const failing = {
    readFile: async () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
    mkdir: async () => {
      throw new Error('EACCES: permission denied');
    },
    writeFile: async () => {
      throw new Error('should not be reached');
    },
  };
  const result = await ensureGeminiFamilyAuxiliaryDisabled({ tool: 'gemini', homeDir: '/nonexistent', fsImpl: failing, log: async line => logs.push(line) });
  assert.equal(result.applied, false);
  assert.match(result.error, /EACCES/);
  assert.ok(
    logs.some(line => line.includes('EACCES')),
    'the operator must be told the policy could not be written'
  );
});

check('a tool with no Gemini-family settings file is a no-op, not a stray write', () => {
  assert.equal(GEMINI_FAMILY_AUXILIARY_DISABLE_SETTINGS.claude, undefined, 'claude has its own config path and must not be written here');
});

await checkAsync('gemini and qwen apply the policy before launching the CLI', async () => {
  for (const tool of ['gemini', 'qwen']) {
    const source = await readSource(`src/${tool}.lib.mjs`);
    assert.ok(source.includes(`ensureGeminiFamilyAuxiliaryDisabled({ tool: '${tool}', log })`), `${tool}.lib must apply the policy`);
    assert.ok(source.includes('if (isAuxiliaryModelCallsDisabled(argv))'), `${tool}.lib must respect --no-auxiliary-model-calls-disabled`);
  }
});

// ---------------------------------------------------------------------------
// OpenCode
// ---------------------------------------------------------------------------

check('the OpenCode title and summary agents are disabled and compaction is not', () => {
  assert.deepEqual([...OPENCODE_DISABLED_AGENTS], ['title', 'summary']);
  assert.deepEqual([...OPENCODE_KEEP_AGENTS], ['compaction']);
  const config = buildOpencodeAuxiliaryAgentConfig(true);
  assert.deepEqual(config, { title: { disable: true }, summary: { disable: true } });
  for (const name of OPENCODE_KEEP_AGENTS) {
    assert.equal(Object.prototype.hasOwnProperty.call(config, name), false, `the ${name} agent performs the summarization this issue keeps; disabling it would remove compaction entirely`);
    assert.ok(!OPENCODE_DISABLED_AGENTS.includes(name), `${name} must never be added to the disable list`);
  }
  assert.deepEqual(buildOpencodeAuxiliaryAgentConfig(false), {}, 'opting out must write no agent block at all');
});

await checkAsync('opencode.lib writes the agent block into the per-task config', async () => {
  const source = await readSource('src/opencode.lib.mjs');
  assert.ok(source.includes('buildOpencodeAuxiliaryAgentConfig(isAuxiliaryModelCallsDisabled(argv))'), 'opencode.lib must build the agent block from argv, not unconditionally');
  assert.ok(source.includes('opencodeConfig.agent = disabledAgents'), 'the block must reach the opencode.json hive-mind writes');
  assert.ok(!source.includes("'compaction'"), 'opencode.lib must not name the compaction agent — it is left alone');
});

// ---------------------------------------------------------------------------
// The flag itself
// ---------------------------------------------------------------------------

check('the policy is on unless explicitly turned off', () => {
  assert.equal(isAuxiliaryModelCallsDisabled({}), true, 'an argv that predates the flag still gets the policy');
  assert.equal(isAuxiliaryModelCallsDisabled(), true, 'a missing argv still gets the policy');
  assert.equal(isAuxiliaryModelCallsDisabled({ auxiliaryModelCallsDisabled: true }), true);
  assert.equal(isAuxiliaryModelCallsDisabled({ auxiliaryModelCallsDisabled: false }), false, '--no-auxiliary-model-calls-disabled is the only opt-out');
  assert.equal(isAuxiliaryModelCallsDisabled({ auxiliaryModelCallsDisabled: undefined }), true, 'undefined is not an opt-out');
});

await checkAsync('solve exposes --auxiliary-model-calls-disabled, defaulting to true', async () => {
  const source = await readSource('src/solve.config.lib.mjs');
  const start = source.indexOf("'auxiliary-model-calls-disabled': {");
  assert.notEqual(start, -1, 'solve.config must define the option');
  const block = source.slice(start, start + 2400);
  assert.match(block, /default: true/, 'the option must default to true');
  // The opt-out cannot reach claude: those switches are ENV lines in the image
  // and settings written by `configure-claude`, neither of which sees argv.
  assert.match(block, /regardless of this flag/, 'the description must say the claude switches are not flag-controlled');
  assert.match(block, /Summarization is the exception and stays on/, 'the description must state the carve-out the issue asks for');
});

check('every tool description mentions something concrete', () => {
  assert.match(describeAuxiliaryModelCallsPolicy('claude'), /CLAUDE_CODE_ENABLE_REMOTE_RECAP=0/);
  assert.equal(describeAuxiliaryModelCallsPolicy('codex'), '-c features.goals=false -c features.personality=false');
  assert.match(describeAuxiliaryModelCallsPolicy('gemini'), /skipNextSpeakerCheck/);
  assert.match(describeAuxiliaryModelCallsPolicy('qwen'), /emitToolUseSummaries/);
  assert.match(describeAuxiliaryModelCallsPolicy('opencode'), /"title":\{"disable":true\}/);
  assert.match(describeAuxiliaryModelCallsPolicy('agent'), /already off/);
});

console.log(`\n🔕 ${passed} issue-2236 assertions passed`);
