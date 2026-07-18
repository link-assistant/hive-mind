/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2077.
 *
 * A run against suenot/marketmaker-images#81 aborted with
 * `CodexCapabilityPreflightError: Required Codex capability unavailable: 16:9`.
 * The issue asked for image generation and the prompt line
 *
 *   "... pays a cost that clearly depends on where it sits. ... 16:9. No text."
 *
 * contains the requirement word `depends` and the token `16:9`, which the
 * namespaced-skill regex read as `namespace:name`. No plugin provides a skill
 * called `9`, so the preflight threw and the whole solve was discarded.
 *
 * Two independent defects are covered here:
 *   1. detection accepted tokens that cannot be capability names;
 *   2. a failed detection was fatal instead of degrading to a warning.
 */

import assert from 'node:assert/strict';

import { CodexCapabilityPreflightError, detectRequiredCodexCapabilities, isCapabilityName, resolveRequiredPlugins, runCodexCapabilityPreflight } from '../src/codex-capability-preflight.lib.mjs';

// 1. The exact line from suenot/marketmaker-images#81 that broke the run.
const heroPromptLine = '**hero** — A premium dark abstract contrasting a slippage constant with a slippage curve. An order sliding along the curve pays a cost that clearly depends on where it sits. Deep navy-to-black, glassmorphism, glowing particles, depth of field, subtle grid. 16:9. No text.';

const heroDetection = detectRequiredCodexCapabilities(heroPromptLine);
assert.deepEqual(heroDetection.skills, [], 'an aspect ratio is not an Agent Skill');
assert.deepEqual(heroDetection.plugins, [], 'an aspect ratio is not a plugin selector');
assert(
  heroDetection.rejected.some(entry => entry.capability === '16:9'),
  'the rejected token is recorded so --verbose can explain the decision'
);

// The full acceptance section of the same issue must stay requirement-free.
const acceptanceText = `
## Quality gate
Decode each PNG before committing. Target **1664x936** (exact 16:9). Clean 16:9 is required at 0.5-1.5 MB.
- **16:9** every image. **PNG**, high quality. **No text**.
- Use GPT image generation, commit under \`blog/\`, open a PR.
`;
const acceptance = detectRequiredCodexCapabilities(acceptanceText);
assert.deepEqual({ plugins: acceptance.plugins, skills: acceptance.skills }, { plugins: [], skills: [] }, 'image specifications never request Codex capabilities');

// 2. Neighbouring prose token classes that share the same failure shape.
for (const token of ['16:9', '4:3', '9:30', '3000', '100', '20']) {
  assert.equal(isCapabilityName(token), false, `${token} must not be treated as a capability name`);
}

// The Agent Skills specification permits a leading digit, so validation must be
// no stricter than the spec: rejection is driven by the absence of any letter,
// not by the first character.
for (const token of ['3d-rendering', 'superpowers:2fa-setup', 'k9s@openai-curated', 'plugin_name@market_place']) {
  assert.equal(isCapabilityName(token), true, `${token} is a legal capability name`);
}
for (const line of ['The service must listen on localhost:3000 before the check runs.', 'You need to pay $100 for the required credits.', 'Install node@20 and use the toolchain.', 'Contact ops@example.com if the required build fails.', 'The deploy must finish by 9:30 tomorrow.', 'Note: the required output is a PNG.']) {
  const result = detectRequiredCodexCapabilities(line);
  assert.deepEqual({ plugins: result.plugins, skills: result.skills }, { plugins: [], skills: [] }, `no capability should be inferred from: ${line}`);
}

// 3. Genuine capability references still resolve.
const genuine = detectRequiredCodexCapabilities(`
This task requires superpowers:using-superpowers before implementation.
Install superpowers@openai-curated-remote if it is absent.
`);
assert.deepEqual(genuine.plugins, ['superpowers@openai-curated']);
assert.deepEqual(genuine.skills, ['superpowers:using-superpowers']);
assert(genuine.evidence.length >= 2, 'accepted capabilities record their source line');

// 4. An unresolvable requirement degrades to a warning instead of aborting.
const catalog = { installed: [], available: [] };
await assert.rejects(() => resolveRequiredPlugins({ requirements: { plugins: ['missing@openai-curated'], skills: [] }, catalog }), CodexCapabilityPreflightError, 'the resolver still reports an actionable error to its caller (issue #2074)');

const logs = [];
const runCommand = async ({ command, args }) => {
  if (command === 'gh' && args[2]?.endsWith('/comments')) return { stdout: '[]', stderr: '', code: 0 };
  if (command === 'gh') return { stdout: JSON.stringify({ title: 'Task', body: 'This task requires missing:workflow to run.' }), stderr: '', code: 0 };
  if (args[0] === 'plugin') return { stdout: JSON.stringify(catalog), stderr: '', code: 0 };
  throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
};

const degraded = await runCodexCapabilityPreflight({
  owner: 'suenot',
  repo: 'marketmaker-images',
  issueNumber: 81,
  baseCodexHome: '/nonexistent-codex-home',
  runCommand,
  env: {},
  log: async message => logs.push(String(message)),
});

assert.equal(degraded.required, false, 'an unresolvable requirement does not stop execution');
assert.equal(degraded.degraded, true);
assert.equal(degraded.codexHome, null, 'execution falls back to the operator Codex home');
assert(
  logs.some(message => message.includes('Codex capability preflight skipped')),
  'the operator is warned about the skipped preflight'
);

// 5. Strict mode preserves the hard failure for operators who want it.
await assert.rejects(
  () =>
    runCodexCapabilityPreflight({
      owner: 'suenot',
      repo: 'marketmaker-images',
      issueNumber: 81,
      baseCodexHome: '/nonexistent-codex-home',
      runCommand,
      env: { HIVE_MIND_CODEX_CAPABILITY_STRICT: '1' },
    }),
  CodexCapabilityPreflightError,
  'HIVE_MIND_CODEX_CAPABILITY_STRICT=1 restores the fail-fast behaviour'
);

console.log('✅ issue #2077: Codex capability preflight no longer invents requirements from prose');
