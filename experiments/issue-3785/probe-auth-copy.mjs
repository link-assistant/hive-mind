// Offline structural reproduction. Expected to report the still-unfixed defect.
// All credentials are synthetic; this does not contact a provider.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCodexCapabilityPreflight } from '../../src/codex-capability-preflight.lib.mjs';

const root = await mkdtemp(join(tmpdir(), 'hive-3785-copy-'));
const baseCodexHome = join(root, 'base');
const generation = async home => JSON.parse(await readFile(join(home, 'auth.json'), 'utf8')).generation;
const preflight = repo =>
  runCodexCapabilityPreflight({
    owner: 'synthetic',
    repo,
    baseCodexHome,
    env: {},
    runCommand: async ({ args }) => {
      assert.equal(args[0], 'debug');
      return { stdout: JSON.stringify({ text: '<skills_instructions>\n### Available skills\n</skills_instructions>' }), stderr: '', code: 0 };
    },
  });
try {
  await mkdir(baseCodexHome);
  await writeFile(join(baseCodexHome, 'auth.json'), JSON.stringify({ generation: 0 }));
  const a = await preflight('a');
  await writeFile(join(a.codexHome, 'auth.json'), JSON.stringify({ generation: 1 }));
  const b = await preflight('b');
  assert.equal(await generation(a.codexHome), 1);
  assert.equal(await generation(baseCodexHome), 0);
  assert.equal(await generation(b.codexHome), 0);
  console.log('REPRODUCED: task A rotation is invisible to the base and task B.');
  await preflight('a');
  assert.equal(await generation(a.codexHome), 0);
  console.log('REPRODUCED: repeated preflight overwrites task A with stale base state.');
} finally {
  await rm(root, { recursive: true, force: true });
}
