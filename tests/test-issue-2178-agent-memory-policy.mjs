#!/usr/bin/env node
/**
 * Issue #2178 — no AI tool keeps memory between hive-mind tasks, and no tool
 * pays for a permission classifier it can never need.
 *
 * These assertions are about *policy*, not about the CLIs: they run without
 * claude, codex, gemini or qwen installed. What they protect is the wiring —
 * that every launch path consults the policy, that `--no-agent-memory-disabled`
 * really is the only way to opt out, and that an operator's existing settings
 * survive the merge.
 *
 * The knob names themselves were read out of the shipped binaries
 * (claude-code 2.1.246, codex-cli 0.148.0, gemini-cli 0.51.0, qwen-code 0.7.1,
 * opencode 1.18.5) and the provenance is written down in
 * `docs/case-studies/issue-2178/README.md`, because a name that is right today
 * is only right until the next release.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2178
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { AGENT_MEMORY_POLICY_TOOLS, CLAUDE_AUTO_MODE_DISABLE_PERMISSIONS, CLAUDE_MEMORY_DISABLE_ENV, CLAUDE_MEMORY_DISABLE_SETTINGS, CODEX_MEMORY_DISABLE_FEATURES, GEMINI_FAMILY_MEMORY_DISABLE_SETTINGS, GEMINI_FAMILY_MEMORY_TOOL, TOOLS_WITHOUT_MEMORY_FEATURE, buildCodexMemoryDisableConfigArgs, describeAgentMemoryPolicy, ensureGeminiFamilyMemoryDisabled, isAgentMemoryDisabled, resolveGeminiFamilySettingsPath } from '../src/agent-memory-policy.lib.mjs';
import { REQUIRED_CLAUDE_QUIET_ENV, REQUIRED_CLAUDE_QUIET_PERMISSIONS, REQUIRED_CLAUDE_QUIET_SETTINGS, ensureClaudeQuietConfig } from '../src/claude-quiet-config.lib.mjs';
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

// ---------------------------------------------------------------------------
// The policy covers every tool solve can launch
// ---------------------------------------------------------------------------

check('every --tool choice has a policy entry', () => {
  for (const tool of TASK_TOOL_CHOICES) {
    assert.ok(AGENT_MEMORY_POLICY_TOOLS.includes(tool), `${tool} is a --tool choice but has no memory policy entry`);
  }
});

check('every policy tool either has a knob or is recorded as having no memory feature', () => {
  for (const tool of AGENT_MEMORY_POLICY_TOOLS) {
    const description = describeAgentMemoryPolicy(tool);
    assert.notEqual(description, 'no policy recorded for this tool', `${tool} needs either a knob or a TOOLS_WITHOUT_MEMORY_FEATURE entry`);
  }
  assert.deepEqual([...TOOLS_WITHOUT_MEMORY_FEATURE], ['opencode', 'agent'], 'opencode and agent were checked and have no cross-session memory feature; changing this list means re-checking them');
});

// ---------------------------------------------------------------------------
// Claude Code: memory off, auto mode (and therefore its classifier) off
// ---------------------------------------------------------------------------

check('Claude quiet env carries both memory kill switches', () => {
  for (const [key, value] of Object.entries(CLAUDE_MEMORY_DISABLE_ENV)) {
    assert.equal(REQUIRED_CLAUDE_QUIET_ENV[key], value, `REQUIRED_CLAUDE_QUIET_ENV must force ${key}=${value}`);
  }
  assert.equal(CLAUDE_MEMORY_DISABLE_ENV.CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1', 'per-project and team memory stores are gated by CLAUDE_CODE_DISABLE_AUTO_MEMORY');
  assert.equal(CLAUDE_MEMORY_DISABLE_ENV.CLAUDE_CODE_DISABLE_ORG_MEMORY, '1', 'organization memory sync is gated separately from auto memory');
});

check('getClaudeEnv hands the memory kill switches to the spawned CLI', () => {
  const env = getClaudeEnv();
  for (const [key, value] of Object.entries(CLAUDE_MEMORY_DISABLE_ENV)) {
    assert.equal(env[key], value, `getClaudeEnv should export ${key}=${value}`);
  }
});

check('Claude settings disable auto memory and auto mode', () => {
  assert.equal(REQUIRED_CLAUDE_QUIET_SETTINGS.autoMemoryEnabled, false, 'autoMemoryEnabled must stay false');
  assert.equal(CLAUDE_MEMORY_DISABLE_SETTINGS.autoMemoryEnabled, false, 'the settings-file gate is set alongside the env gate, not instead of it');
  // "disable" is the only value Claude Code accepts here; anything else leaves
  // auto mode reachable, which is what pays for the per-tool-use classifier.
  assert.equal(CLAUDE_AUTO_MODE_DISABLE_PERMISSIONS.disableAutoMode, 'disable', 'disableAutoMode must be the literal string "disable"');
  assert.equal(REQUIRED_CLAUDE_QUIET_PERMISSIONS.disableAutoMode, 'disable', 'the quiet permissions block must carry disableAutoMode');
  assert.equal(REQUIRED_CLAUDE_QUIET_PERMISSIONS.defaultMode, 'bypassPermissions', 'bypassPermissions stays: it is what makes the classifier unnecessary in the first place');
});

await checkAsync('ensureClaudeQuietConfig writes disableAutoMode into a fresh settings file', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-2178-claude-'));
  try {
    const settingsPath = path.join(tmp, 'settings.json');
    await ensureClaudeQuietConfig({ settingsPath });
    const written = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
    assert.equal(written.permissions.disableAutoMode, 'disable', 'a fresh settings file must come out with auto mode disabled');
    assert.equal(written.autoMemoryEnabled, false, 'a fresh settings file must come out with auto memory disabled');
    assert.equal(written.env.CLAUDE_CODE_DISABLE_ORG_MEMORY, '1', 'a fresh settings file must come out with org memory disabled');
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

await checkAsync('ensureClaudeQuietConfig repairs a settings file that re-enabled auto mode', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-2178-claude-repair-'));
  try {
    const settingsPath = path.join(tmp, 'settings.json');
    // An operator's own file: auto mode on, plus a key we must not clobber.
    await fs.writeFile(settingsPath, JSON.stringify({ model: 'opus', autoMemoryEnabled: true, permissions: { defaultMode: 'auto', allow: ['Bash(ls:*)'] } }, null, 2));
    const result = await ensureClaudeQuietConfig({ settingsPath });
    const written = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
    assert.equal(result.changed, true, 'a file with auto mode on must be reported as changed');
    assert.equal(written.permissions.disableAutoMode, 'disable', 'auto mode must be turned back off');
    assert.equal(written.permissions.defaultMode, 'bypassPermissions', 'defaultMode=auto must be overridden');
    assert.equal(written.autoMemoryEnabled, false, 'auto memory must be turned back off');
    assert.deepEqual(written.permissions.allow, ['Bash(ls:*)'], 'unrelated permission entries must survive');
    assert.equal(written.model, 'opus', 'unrelated settings must survive');
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------

check('Codex memory features are pinned off as -c overrides', () => {
  assert.deepEqual(buildCodexMemoryDisableConfigArgs(true), ['-c', 'features.memories=false', '-c', 'features.external_agent_memory_import=false'], 'both the local store and the cross-agent import must be pinned off');
  assert.deepEqual(CODEX_MEMORY_DISABLE_FEATURES, ['memories', 'external_agent_memory_import']);
});

check('--no-agent-memory-disabled leaves the Codex command line untouched', () => {
  assert.deepEqual(buildCodexMemoryDisableConfigArgs(false), [], 'opting out must add no arguments at all, not arguments set to true');
});

await checkAsync('codex.lib appends the memory overrides to the exec command', async () => {
  const source = await readSource('src/codex.lib.mjs');
  assert.ok(source.includes('buildCodexMemoryDisableConfigArgs(isAgentMemoryDisabled(argv))'), 'codex.lib must build the memory overrides from argv, not unconditionally');
  assert.ok(/const memoryDisableArgs[\s\S]{0,240}codexArgs \+= ` \$\{shellQuote\(arg\)\}`/.test(source), 'codex.lib must append the memory overrides onto codexArgs');
});

await checkAsync('agent-commander passes the same overrides on the --use-agent-commander path', async () => {
  const source = await readSource('src/agent-commander.lib.mjs');
  assert.ok(source.includes('buildCodexMemoryDisableConfigArgs(isAgentMemoryDisabled(argv))'), 'the agent-commander codex path must disable memory too');
  assert.ok(source.includes('Object.assign(extraEnv, CLAUDE_MEMORY_DISABLE_ENV)'), 'agent-commander spawns claude itself, so it must export the memory env');
});

// ---------------------------------------------------------------------------
// Gemini family (gemini, qwen)
// ---------------------------------------------------------------------------

check('the Gemini-family settings name the memory tool and the background extractor', () => {
  assert.deepEqual(GEMINI_FAMILY_MEMORY_DISABLE_SETTINGS.tools.exclude, [GEMINI_FAMILY_MEMORY_TOOL], 'tools.exclude is the nested form both CLIs resolve to');
  assert.equal(GEMINI_FAMILY_MEMORY_DISABLE_SETTINGS.experimental.autoMemory, false, 'experimental.autoMemory gates the background extraction agent, which is the expensive one');
  assert.equal(GEMINI_FAMILY_MEMORY_TOOL, 'save_memory');
});

check('settings paths resolve per tool and nowhere else', () => {
  assert.equal(resolveGeminiFamilySettingsPath('gemini', { homeDir: '/home/box' }), path.join('/home/box', '.gemini', 'settings.json'));
  assert.equal(resolveGeminiFamilySettingsPath('qwen', { homeDir: '/home/box' }), path.join('/home/box', '.qwen', 'settings.json'));
  assert.equal(resolveGeminiFamilySettingsPath('claude', { homeDir: '/home/box' }), null, 'claude has its own config path and must not be written here');
});

await checkAsync('a missing settings file is created with the policy in it', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-2178-gemini-'));
  try {
    const result = await ensureGeminiFamilyMemoryDisabled({ tool: 'gemini', homeDir: tmp });
    assert.equal(result.applied, true);
    assert.equal(result.error, null);
    const written = JSON.parse(await fs.readFile(path.join(tmp, '.gemini', 'settings.json'), 'utf-8'));
    assert.deepEqual(written.tools.exclude, ['save_memory']);
    assert.equal(written.experimental.autoMemory, false);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

await checkAsync("an operator's own settings survive the merge", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-2178-qwen-'));
  try {
    const settingsPath = path.join(tmp, '.qwen', 'settings.json');
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(settingsPath, JSON.stringify({ theme: 'dark', tools: { exclude: ['web_fetch'], useRipgrep: true }, experimental: { autoMemory: true, gemma: true } }, null, 2));
    const result = await ensureGeminiFamilyMemoryDisabled({ tool: 'qwen', homeDir: tmp });
    const written = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
    assert.equal(result.applied, true);
    assert.deepEqual(written.tools.exclude, ['web_fetch', 'save_memory'], 'exclusions are unioned, never replaced');
    assert.equal(written.tools.useRipgrep, true, 'sibling tool settings must survive');
    assert.equal(written.experimental.autoMemory, false, 'an operator who turned auto memory on gets it turned back off for the task');
    assert.equal(written.experimental.gemma, true, 'sibling experimental flags must survive');
    assert.equal(written.theme, 'dark', 'unrelated settings must survive');
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

await checkAsync('a settings file carrying __proto__ cannot reach Object.prototype', async () => {
  // No current caller can produce such a key — the merge source is a frozen
  // literal — so this asserts the guard rather than a reachable bug (CodeQL
  // js/prototype-pollution-utility). It exists so removing the guard fails a
  // test instead of waiting for a future caller to make it reachable.
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-2178-proto-'));
  try {
    const settingsPath = path.join(tmp, '.gemini', 'settings.json');
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(settingsPath, '{"__proto__": {"polluted": "yes"}, "constructor": {"polluted": "yes"}, "theme": "dark"}');
    const result = await ensureGeminiFamilyMemoryDisabled({ tool: 'gemini', homeDir: tmp });
    assert.equal(result.applied, true);
    assert.equal({}.polluted, undefined, 'Object.prototype must be untouched');
    assert.equal(Object.prototype.polluted, undefined, 'Object.prototype must be untouched');
    const written = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
    assert.deepEqual(written.tools.exclude, ['save_memory'], 'the policy still applies to a file with odd keys in it');
    assert.equal(written.theme, 'dark', 'ordinary keys alongside them still survive');
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

await checkAsync('an already-compliant settings file is left byte-identical', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-2178-noop-'));
  try {
    const settingsPath = path.join(tmp, '.gemini', 'settings.json');
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    const original = JSON.stringify({ tools: { exclude: ['save_memory'] }, experimental: { autoMemory: false } }, null, 2);
    await fs.writeFile(settingsPath, original);
    const result = await ensureGeminiFamilyMemoryDisabled({ tool: 'gemini', homeDir: tmp });
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
  const result = await ensureGeminiFamilyMemoryDisabled({ tool: 'gemini', homeDir: '/nonexistent', fsImpl: failing, log: async line => logs.push(line) });
  assert.equal(result.applied, false);
  assert.match(result.error, /EACCES/);
  assert.ok(
    logs.some(line => line.includes('EACCES')),
    'the operator must be told the policy could not be written'
  );
});

await checkAsync('malformed JSON is replaced rather than crashing the run', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-2178-broken-'));
  try {
    const settingsPath = path.join(tmp, '.gemini', 'settings.json');
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(settingsPath, '{ not json');
    const result = await ensureGeminiFamilyMemoryDisabled({ tool: 'gemini', homeDir: tmp });
    assert.equal(result.applied, true);
    const written = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
    assert.deepEqual(written.tools.exclude, ['save_memory']);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

await checkAsync('gemini and qwen apply the policy before launching the CLI', async () => {
  for (const tool of ['gemini', 'qwen']) {
    const source = await readSource(`src/${tool}.lib.mjs`);
    assert.ok(source.includes(`ensureGeminiFamilyMemoryDisabled({ tool: '${tool}', log })`), `${tool}.lib must apply the policy`);
    assert.ok(source.includes('if (isAgentMemoryDisabled(argv))'), `${tool}.lib must respect --no-agent-memory-disabled`);
  }
});

// ---------------------------------------------------------------------------
// The flag itself
// ---------------------------------------------------------------------------

check('the policy is on unless explicitly turned off', () => {
  assert.equal(isAgentMemoryDisabled({}), true, 'an argv that predates the flag still gets the policy');
  assert.equal(isAgentMemoryDisabled(), true, 'a missing argv still gets the policy');
  assert.equal(isAgentMemoryDisabled({ agentMemoryDisabled: true }), true);
  assert.equal(isAgentMemoryDisabled({ agentMemoryDisabled: false }), false, '--no-agent-memory-disabled is the only opt-out');
  assert.equal(isAgentMemoryDisabled({ agentMemoryDisabled: undefined }), true, 'undefined is not an opt-out');
});

await checkAsync('solve exposes --agent-memory-disabled, defaulting to true', async () => {
  const source = await readSource('src/solve.config.lib.mjs');
  assert.ok(source.includes("'agent-memory-disabled': {"), 'solve.config must define the option');
  const block = source.slice(source.indexOf("'agent-memory-disabled': {"), source.indexOf("'agent-memory-disabled': {") + 1200);
  assert.match(block, /default: true/, 'the option must default to true');
  // The opt-out cannot reach claude: those switches are ENV lines in the image
  // and settings written by `configure-claude`, neither of which sees argv. The
  // description has to say so rather than implying a control that is not there.
  assert.match(block, /regardless of this flag/, 'the description must say the claude switches are not flag-controlled');
});

check('the claude switches are baked into the image, not gated on argv', () => {
  // A settings/ENV baseline that argv cannot reach is a deliberate asymmetry, so
  // it is asserted here rather than left for a reader to infer from its absence.
  assert.equal(REQUIRED_CLAUDE_QUIET_PERMISSIONS.disableAutoMode, 'disable', 'the baseline holds with or without the flag');
  for (const key of Object.keys(CLAUDE_MEMORY_DISABLE_ENV)) {
    assert.equal(getClaudeEnv()[key], CLAUDE_MEMORY_DISABLE_ENV[key], `${key} is unconditional for claude`);
  }
});

console.log(`\n🧠 ${passed} issue-2178 assertions passed`);
