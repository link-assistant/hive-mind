/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2084.
 *
 * The failing run reported `superpowers@openai-curated` as "installed, enabled"
 * and proceeded, but the model received a prompt with no `superpowers:*` skills
 * in its `<skills_instructions>` block and stalled on the target repository's
 * mandatory Superpowers preflight.
 *
 * Codex exposes a plugin's skills only while the plugin payload is materialized
 * under `CODEX_HOME/plugins/cache/<marketplace>/<plugin>/<version>/skills`;
 * `codex plugin list` tracks enablement, which is not the same thing. The
 * preflight must therefore verify against the catalog the model actually
 * receives. See experiments/issue-2084/reproduce-skill-exposure.sh.
 */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { parseModelVisibleSkills, runCodexCapabilityPreflight } from '../src/codex-capability-preflight.lib.mjs';

// --- parsing the rendered prompt -------------------------------------------

const promptWithSkills = JSON.stringify({
  text: '<skills_instructions>\n### Available skills\n- imagegen: Generate images. (file: /home/box/.codex/skills/.system/imagegen/SKILL.md)\n- superpowers:using-superpowers: Use superpowers. (file: /home/box/.codex/plugins/cache/openai-curated/superpowers/5.1.3/skills/using-superpowers/SKILL.md)\n</skills_instructions>',
});

const visible = parseModelVisibleSkills(promptWithSkills);
assert.deepEqual([...visible].sort(), ['imagegen', 'superpowers:using-superpowers'], 'bare and plugin-namespaced skills are both read from the rendered prompt');

assert.equal(parseModelVisibleSkills('no block here'), null, 'a prompt without a skills block is reported as unknown rather than empty');
assert.deepEqual([...parseModelVisibleSkills('<skills_instructions>\n### Available skills\n</skills_instructions>')], [], 'an empty catalog parses as zero visible skills');

// --- the failing scenario ---------------------------------------------------

const issueText = `
This task must use the official superpowers@openai-curated-remote plugin.
1. Confirm that the official plugin exposes superpowers:using-superpowers.
2. Invoke superpowers:using-superpowers.
`;

const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'issue-2084-'));
const pluginRoot = path.join(fixtureRoot, 'marketplace', 'plugins', 'superpowers');
await mkdir(path.join(pluginRoot, 'skills', 'using-superpowers'), { recursive: true });
await writeFile(path.join(pluginRoot, 'skills', 'using-superpowers', 'SKILL.md'), '---\nname: using-superpowers\n---\n');

const baseCodexHome = path.join(fixtureRoot, 'operator-codex-home');
await mkdir(path.join(baseCodexHome, '.tmp', 'plugins'), { recursive: true });
await writeFile(path.join(baseCodexHome, '.tmp', 'plugins.sha'), 'fixture-sha\n');
await writeFile(path.join(baseCodexHome, 'config.toml'), '[features]\nmulti_agent = true\n');

const entry = { pluginId: 'superpowers@openai-curated', name: 'superpowers', source: { source: 'local', path: pluginRoot } };

// `skillsVisible: false` reproduces issue #2084 exactly: the plugin is enabled,
// the marketplace snapshot resolves and `plugin add` materializes a payload, yet
// the prompt Codex renders lists no superpowers skills. Materializing on `add`
// mirrors the real CLI, so this fixture isolates the visibility defect from
// issue #2088's cache-repair defect.
const scopedCache = path.join(baseCodexHome, 'hive-mind', 'repositories', 'CEHR2005', 'GCS-TS', 'plugins', 'cache', 'openai-curated', 'superpowers', '5.1.3', 'skills');
const makeRunCommand =
  ({ skillsVisible }) =>
  async ({ command, args }) => {
    if (command === 'gh' && args[2]?.endsWith('/comments')) return { stdout: '[]', stderr: '', code: 0 };
    if (command === 'gh') return { stdout: JSON.stringify({ title: 'Task', body: issueText }), stderr: '', code: 0 };
    if (args[0] === 'plugin' && args[1] === 'add') {
      await mkdir(path.join(scopedCache, 'using-superpowers'), { recursive: true });
      await writeFile(path.join(scopedCache, 'using-superpowers', 'SKILL.md'), '---\nname: using-superpowers\n---\n');
      return { stdout: JSON.stringify({ pluginId: args[2] }), stderr: '', code: 0 };
    }
    if (args[0] === 'plugin' && args[1] === 'list') {
      return { stdout: JSON.stringify({ installed: [{ ...entry, installed: true, enabled: true, version: '2f1a8948' }], available: [entry] }), stderr: '', code: 0 };
    }
    if (args[0] === 'debug' && args[1] === 'prompt-input') {
      const rendered = skillsVisible ? '- superpowers:using-superpowers: Use superpowers. (file: /cache/SKILL.md)' : '- imagegen: Generate images. (file: /system/SKILL.md)';
      return { stdout: JSON.stringify({ text: `<skills_instructions>\n### Available skills\n${rendered}\n</skills_instructions>` }), stderr: '', code: 0 };
    }
    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
  };

const run = async ({ skillsVisible, env }) => {
  const logs = [];
  const result = await runCodexCapabilityPreflight({
    owner: 'CEHR2005',
    repo: 'GCS-TS',
    issueNumber: 3,
    baseCodexHome,
    env: env || {},
    runCommand: makeRunCommand({ skillsVisible }),
    log: async (message, options) => logs.push({ message, options }),
  });
  return { result, logs };
};

// Issue #2088 tightened this outcome: the issue names `superpowers:using-superpowers`
// explicitly, repair cannot materialize it here (this fixture's Codex refuses
// `plugin add`), so the preflight stops before `codex exec` instead of degrading.
const blocked = await run({ skillsVisible: false }).then(
  () => null,
  error => error
);
assert(blocked, 'an enabled-but-invisible, explicitly required plugin no longer passes verification silently');
assert.match(blocked.message, /superpowers:using-superpowers/u, 'the diagnostic names the skill the model could not see');
assert.match(blocked.message, /plugins\/cache/u, 'the diagnostic points at the directory that actually carries plugin skills');
assert.equal(blocked.details.failClosed, true, 'an explicitly declared capability fails closed');

// The advisory escape hatch preserves the previous behaviour for operators who
// would rather run degraded than not at all.
const advisory = await run({ skillsVisible: false, env: { HIVE_MIND_CODEX_CAPABILITY_ADVISORY: '1' } });
assert.equal(advisory.result.degraded, true, 'HIVE_MIND_CODEX_CAPABILITY_ADVISORY=1 restores the degraded-run behaviour');
assert.match(advisory.result.error, /superpowers:using-superpowers/u);
assert(
  advisory.logs.some(entry => entry.message.includes('Model-visible skills') && entry.options?.verbose),
  'verbose diagnostics record the catalog the model received so the next run is debuggable'
);

const strict = await run({ skillsVisible: false, env: { HIVE_MIND_CODEX_CAPABILITY_STRICT: '1' } }).then(
  () => null,
  error => error
);
assert(strict, 'strict mode fails the run instead of continuing without the mandated capability');
assert.match(strict.message, /cannot see/u);

const healthy = await run({ skillsVisible: true });
assert.equal(healthy.result.degraded, undefined, 'a genuinely exposed skill passes verification');
assert.deepEqual(healthy.result.plugins, ['superpowers@openai-curated']);
assert(
  healthy.logs.some(entry => entry.message.includes('Verified 1 required skill(s) are visible to the model')),
  'a successful preflight reports positive confirmation rather than silence'
);

// --- the probe must never make things worse ---------------------------------

const withoutProbe = async ({ command, args }) => {
  if (args?.[0] === 'debug') return { stdout: '', stderr: 'error: unrecognized subcommand', code: 2 };
  return makeRunCommand({ skillsVisible: false })({ command, args });
};

const legacy = await runCodexCapabilityPreflight({
  owner: 'CEHR2005',
  repo: 'GCS-TS',
  issueNumber: 3,
  baseCodexHome,
  env: { HIVE_MIND_CODEX_CAPABILITY_STRICT: '1' },
  runCommand: withoutProbe,
});
assert.equal(legacy.required, true, 'a Codex build without `debug prompt-input` keeps the previous behaviour instead of failing every run');

await rm(fixtureRoot, { recursive: true, force: true });
