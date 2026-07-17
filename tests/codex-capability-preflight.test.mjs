/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2074. Required Codex plugins and skills must
 * be detected before `codex exec`, provisioned in repository-scoped persistent
 * state, and reported with an actionable error when unavailable.
 */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  CodexCapabilityPreflightError,
  buildCodexCapabilityStatePath,
  detectRequiredCodexCapabilities,
  normalizePluginSelector,
  resolveRequiredPlugins,
  runCodexCapabilityPreflight,
} from '../src/codex-capability-preflight.lib.mjs';
import { getDockerIsolationAuthMounts } from '../src/isolation-runner.lib.mjs';

const issueText = `
This task requires superpowers:using-superpowers before implementation.
Install superpowers@openai-curated-remote if it is absent.
The superpowers:test-driven-development skill is mandatory.
An error example mentions optional@example-marketplace but does not require it.
`;

assert.equal(normalizePluginSelector('superpowers@openai-curated-remote'), 'superpowers@openai-curated');
assert.deepEqual(detectRequiredCodexCapabilities(issueText), {
  plugins: ['superpowers@openai-curated'],
  skills: ['superpowers:test-driven-development', 'superpowers:using-superpowers'],
});

const baseHome = '/persistent/.codex';
const statePath = buildCodexCapabilityStatePath({ baseCodexHome: baseHome, owner: 'CEHR2005', repo: 'GCS-TS' });
assert.equal(statePath, '/persistent/.codex/hive-mind/repositories/CEHR2005/GCS-TS');

const mounts = getDockerIsolationAuthMounts({
  tool: 'codex',
  homeDir: '/persistent',
  existsSync: candidate => candidate === baseHome,
});
assert.deepEqual(mounts, [{ source: baseHome, target: '/home/box/.codex' }]);
assert(statePath.startsWith(`${baseHome}/`), 'repository-scoped capability state is included in the existing Docker .codex mount');

const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-capability-preflight-'));
const pluginRoot = path.join(fixtureRoot, 'marketplace', 'plugins', 'superpowers');
await mkdir(path.join(pluginRoot, 'skills', 'using-superpowers'), { recursive: true });
await mkdir(path.join(pluginRoot, 'skills', 'test-driven-development'), { recursive: true });
await writeFile(path.join(pluginRoot, '.codex-plugin.json'), '{}');

const catalog = {
  installed: [],
  available: [
    {
      pluginId: 'superpowers@openai-curated',
      name: 'superpowers',
      source: { source: 'local', path: pluginRoot },
    },
  ],
};

assert.deepEqual(await resolveRequiredPlugins({ requirements: detectRequiredCodexCapabilities(issueText), catalog }), ['superpowers@openai-curated']);

const commandCalls = [];
const fakeRunCommand = async ({ command, args, env }) => {
  commandCalls.push({ command, args, env });
  if (command === 'gh') return { stdout: JSON.stringify({ title: 'Task', body: issueText, comments: [] }), stderr: '', code: 0 };
  if (args[0] === 'plugin' && args[1] === 'list') return { stdout: JSON.stringify(catalog), stderr: '', code: 0 };
  if (args[0] === 'plugin' && args[1] === 'add') return { stdout: JSON.stringify({ pluginId: args[2] }), stderr: '', code: 0 };
  throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
};

const scopedBaseHome = path.join(fixtureRoot, 'operator-codex-home');
await mkdir(path.join(scopedBaseHome, '.tmp', 'plugins'), { recursive: true });
await writeFile(path.join(scopedBaseHome, '.tmp', 'plugins.sha'), 'fixture-sha\n');
await writeFile(path.join(scopedBaseHome, 'config.toml'), '[features]\nmulti_agent = true\n');
await writeFile(path.join(scopedBaseHome, 'auth.json'), '{}\n');

const preflight = await runCodexCapabilityPreflight({
  owner: 'CEHR2005',
  repo: 'GCS-TS',
  issueNumber: 1,
  baseCodexHome: scopedBaseHome,
  runCommand: fakeRunCommand,
});

assert.equal(preflight.required, true);
assert.deepEqual(preflight.plugins, ['superpowers@openai-curated']);
assert.equal(preflight.codexHome, path.join(scopedBaseHome, 'hive-mind', 'repositories', 'CEHR2005', 'GCS-TS'));
assert(commandCalls.some(call => call.args.join(' ') === 'plugin add superpowers@openai-curated --json'), 'required plugin is installed before execution');
assert(commandCalls.filter(call => call.command === 'codex').every(call => call.env.CODEX_HOME === preflight.codexHome), 'discovery and installation use repository-scoped state');

await assert.rejects(
  () =>
    resolveRequiredPlugins({
      requirements: { plugins: ['missing@openai-curated'], skills: ['missing:workflow'] },
      catalog,
    }),
  error => {
    assert(error instanceof CodexCapabilityPreflightError);
    assert.match(error.message, /missing@openai-curated/);
    assert.match(error.message, /codex plugin list --available/);
    assert.match(error.message, /repository-scoped/);
    return true;
  },
);

console.log('Codex capability preflight regression tests passed.');
