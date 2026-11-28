/**
 * Regression coverage for issue #2290.
 *
 * A model advertised by the installed CLI or router must not be rejected just
 * because it post-dates Hive Mind's bundled catalogue. Defaults must also
 * follow the newest Sol model exposed by Codex and Claude Code's rolling Opus
 * alias, so another Hive Mind release is not required for the next rollout.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2290
 */

import assert from 'node:assert/strict';

import { mapModelToId, resolveClaudeModelForExecution } from '../src/claude.model-utils.lib.mjs';
import { runOrganizationClassifier } from '../src/organize.ai.lib.mjs';
import { defaultModels, resolveRuntimeDefaultModel, validateModelName, validateRuntimeModelName } from '../src/models/index.mjs';

const currentSol = validateModelName('gpt-6-sol', 'codex');
assert.equal(currentSol.valid, true, currentSol.message);
assert.equal(currentSol.mappedModel, 'gpt-6-sol');

const currentOpus = validateModelName('claude-opus-5-5', 'claude');
assert.equal(currentOpus.valid, true, currentOpus.message);
assert.equal(currentOpus.mappedModel, 'claude-opus-5-5');

assert.equal(defaultModels.codex, 'gpt-6.2-sol', 'GPT-6.2 Sol is the bundled Codex default');
assert.equal(defaultModels.claude, 'opus', 'Claude stays on the vendor-managed rolling Opus alias');
assert.equal(mapModelToId('opus', { preserveRollingAlias: true }), 'opus', 'direct Claude execution must not pin the rolling alias to an old release');
assert.equal(await resolveClaudeModelForExecution('opus', { useRouter: false }), 'opus', 'Claude Code resolves its rolling alias when used directly');

let organizationInvocation = null;
await runOrganizationClassifier({
  prompts: { system: 'Return a plan.', user: 'Organize these issues.' },
  run: async (command, args) => {
    organizationInvocation = { command, args };
    return { code: 0, stdout: '{"issues":[]}', stderr: '' };
  },
});
assert.equal(organizationInvocation.command, 'claude');
assert.equal(organizationInvocation.args[organizationInvocation.args.indexOf('--model') + 1], 'opus', 'the organize workflow also keeps the latest Opus alias');
assert.equal(
  await resolveClaudeModelForExecution('opus', {
    useRouter: true,
    availableModels: ['claude-opus-5', 'claude-opus-5-5', 'claude-sonnet-5'],
  }),
  'claude-opus-5-5',
  'a router receives the newest concrete Opus ID because router catalogues do not expose aliases'
);

assert.equal(
  await resolveRuntimeDefaultModel('codex', {
    availableCodexModels: ['gpt-5.6-sol', 'gpt-6-sol', 'gpt-6-luna'],
  }),
  'gpt-6-sol'
);

const warnings = [];
const log = (message, { level }) => warnings.push({ message, level });
const previousCatalogue = ['gpt-6-sol', 'gpt-6.1-sol', 'gpt-5.6-sol'];
assert.equal(await resolveRuntimeDefaultModel('codex', { availableCodexModels: previousCatalogue, log }), 'gpt-6.1-sol');
assert.equal(warnings[0]?.level, 'warn');
assert.match(warnings[0]?.message, /gpt-6\.2-sol.*missing.*Using "gpt-6\.1-sol"/u);

const unavailableSol = await validateRuntimeModelName('gpt-6.2-sol', 'codex', { availableModels: previousCatalogue });
assert.equal(unavailableSol.valid, false);
assert.match(unavailableSol.message, /gpt-6\.2-sol.*codex debug models.*Upgrade Codex/u);
const emptyCatalogue = await validateRuntimeModelName('gpt-6.2-sol', 'codex', { availableModels: [] });
assert.equal(emptyCatalogue.valid, false);
assert.match(emptyCatalogue.message, /gpt-6\.2-sol.*codex debug models.*Upgrade Codex/u);
assert.equal((await validateRuntimeModelName('gpt-6.2-sol', 'codex', { availableModels: null })).valid, true);
const oldAlias = await validateRuntimeModelName('openai/sol', 'codex', { availableModels: previousCatalogue });
assert.equal(oldAlias.mappedModel, 'openai/gpt-6.1-sol');
assert.match(oldAlias.warning, /gpt-6\.2-sol.*Using "openai\/gpt-6\.1-sol"/u);
for (let attempt = 0; attempt < 2; attempt++) {
  const alias = await validateRuntimeModelName('sol', 'codex', { availableModels: previousCatalogue });
  assert.match(alias.warning, /gpt-6\.2-sol.*Using "gpt-6\.1-sol"/u);
}

for (const supported of ['gpt-6.2-sol', 'gpt-6.3-sol']) {
  warnings.length = 0;
  const activeCatalogue = [...previousCatalogue, supported];
  assert.equal(await resolveRuntimeDefaultModel('codex', { availableCodexModels: activeCatalogue, log }), supported);
  assert.deepEqual(warnings, []);
}
assert.equal((await validateRuntimeModelName('gpt-6.2-sol', 'codex', { availableModels: ['gpt-6.2-sol'] })).valid, true);

const futureCodex = await validateRuntimeModelName('gpt-6.3-sol', 'codex', {
  availableModels: ['gpt-6-sol', 'gpt-6.3-sol'],
});
assert.deepEqual({ valid: futureCodex.valid, mappedModel: futureCodex.mappedModel, source: futureCodex.source }, { valid: true, mappedModel: 'gpt-6.3-sol', source: 'live' }, 'an installed model is accepted without adding it to the bundled map');

const futureRoutedModel = await validateRuntimeModelName('router-vendor/new-coder-1', 'codex', {
  availableModels: ['router-vendor/new-coder-1'],
});
assert.equal(futureRoutedModel.valid, true, 'a router-advertised exact ID is accepted');
assert.equal(futureRoutedModel.mappedModel, 'router-vendor/new-coder-1');

const catalogueLoadedModel = await validateRuntimeModelName('router-vendor/new-coder-2', 'codex', {
  useRouter: true,
  getCatalogue: async () => ({
    bundledAndLive: [],
    liveOnly: [{ id: 'router-vendor/new-coder-2' }],
  }),
});
assert.equal(catalogueLoadedModel.valid, true, 'runtime validation loads the router catalogue when requested');
assert.equal(catalogueLoadedModel.mappedModel, 'router-vendor/new-coder-2');

const typo = await validateRuntimeModelName('gpt-6-slo', 'codex', {
  availableModels: ['gpt-6-sol', 'gpt-6-luna'],
});
assert.equal(typo.valid, false, 'unknown aliases and typos still fail closed');
assert.match(typo.message, /Did you mean "gpt-6-sol"\?/);

console.log('Issue #2290 dynamic model regression tests passed.');
