/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runAgentConfigAudit } from '../src/agent-config-audit.lib.mjs';
import { CLAUDE_CLOUD_DISABLE_ENV, CLAUDE_CLOUD_DISABLE_SETTINGS } from '../src/claude-cloud-policy.lib.mjs';

const baseline = { ...CLAUDE_CLOUD_DISABLE_SETTINGS, env: CLAUDE_CLOUD_DISABLE_ENV };

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-output-styles-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const homeDir = path.join(root, 'home');
  const alternate = path.join(root, 'alternate');
  const systemRoots = { claude: path.join(root, 'managed-claude'), codex: path.join(root, 'managed-codex') };
  for (const directory of [path.join(homeDir, '.claude'), alternate, ...Object.values(systemRoots)]) {
    await fs.mkdir(directory, { recursive: true });
  }
  for (const directory of [path.join(homeDir, '.claude'), alternate]) await fs.writeFile(path.join(directory, 'settings.json'), JSON.stringify(baseline));
  return { options: { tool: 'claude', homeDir, systemRoots, requireClean: true }, alternate };
}

for (const selected of [false, true]) {
  test(`global output-style files block admission in the ${selected ? 'selected' : 'conventional'} config root`, async t => {
    const { options, alternate } = await fixture(t);
    options.env = { CLAUDE_CONFIG_DIR: alternate };
    const directory = path.join(selected ? alternate : path.join(options.homeDir, '.claude'), 'output-styles');
    await fs.mkdir(directory);
    const target = path.join(directory, 'synthetic.md');
    const bytes = '---\nname: synthetic\n---\nSynthetic global instructions.\n';
    await fs.writeFile(target, bytes);
    await assert.rejects(runAgentConfigAudit(options), /not clean/iu);
    assert.equal(await fs.readFile(target, 'utf8'), bytes);
  });
}

test('repair removes a global output-style selection and preserves provider, security, auth and history', async t => {
  const { options, alternate } = await fixture(t);
  options.env = { CLAUDE_CONFIG_DIR: alternate };
  const target = path.join(alternate, 'settings.json');
  const keep = { ...baseline, model: 'synthetic-model', permissions: { deny: ['Read(secret)'] } };
  await fs.writeFile(target, JSON.stringify({ ...keep, outputStyle: 'synthetic' }));
  const protectedFiles = [path.join(alternate, '.credentials.json'), path.join(alternate, 'projects/session.jsonl')];
  await fs.mkdir(path.join(alternate, 'projects'));
  for (const file of protectedFiles) await fs.writeFile(file, 'synthetic protected state\n');
  const identities = await Promise.all(protectedFiles.map(file => fs.stat(file)));
  await runAgentConfigAudit(options);
  assert.deepEqual(JSON.parse(await fs.readFile(target, 'utf8')), keep);
  for (const [index, file] of protectedFiles.entries()) {
    assert.equal(await fs.readFile(file, 'utf8'), 'synthetic protected state\n');
    assert.equal((await fs.stat(file)).ino, identities[index].ino);
  }
});

for (const relative of ['managed-settings.json', 'managed-settings.d/team.json', '.claude/output-styles/synthetic.md']) {
  test(`managed output styles require reconciliation without rewriting policy: ${relative}`, async t => {
    const { options } = await fixture(t);
    const target = path.join(options.systemRoots.claude, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const bytes = relative.endsWith('.json') ? '{"outputStyle":"synthetic","permissions":{"deny":["Read(secret)"]}}' : 'Synthetic global instructions.\n';
    await fs.writeFile(target, bytes);
    const before = await fs.stat(target);
    await assert.rejects(runAgentConfigAudit(options), /managed.*not clean/iu);
    assert.equal(await fs.readFile(target, 'utf8'), bytes);
    assert.equal((await fs.stat(target)).ino, before.ino);
  });
}

for (const kind of ['symlink', 'hardlink']) {
  test(`${kind} output-style files cannot redirect validation into credentials`, async t => {
    const { options } = await fixture(t);
    const directory = path.join(options.homeDir, '.claude');
    const auth = path.join(directory, '.credentials.json');
    await fs.writeFile(auth, 'synthetic protected state');
    const before = await fs.stat(auth);
    const settings = path.join(directory, 'settings.json');
    const bytes = JSON.stringify({ ...baseline, outputStyle: 'synthetic', hooks: { SessionStart: [] } });
    await fs.writeFile(settings, bytes);
    await fs.mkdir(path.join(directory, 'output-styles'));
    const target = path.join(directory, 'output-styles/synthetic.md');
    await (kind === 'symlink' ? fs.symlink(auth, target) : fs.link(auth, target));
    await assert.rejects(runAgentConfigAudit(options), /unsafe/iu);
    assert.equal(await fs.readFile(settings, 'utf8'), bytes);
    assert.equal(await fs.readFile(auth, 'utf8'), 'synthetic protected state');
    assert.equal((await fs.stat(auth)).ino, before.ino);
  });
}

test('an output-style directory appearing during audit invalidates pending repair', async t => {
  const { options } = await fixture(t);
  const directory = path.join(options.homeDir, '.claude');
  const settings = path.join(directory, 'settings.json');
  const bytes = JSON.stringify({ ...baseline, outputStyle: 'synthetic' });
  await fs.writeFile(settings, bytes);
  let changed = false;
  options.log = async () => {
    if (changed) return;
    changed = true;
    await fs.mkdir(path.join(directory, 'output-styles'));
    await fs.writeFile(path.join(directory, 'output-styles/synthetic.md'), 'Synthetic instructions.');
  };
  await assert.rejects(runAgentConfigAudit(options), /unsafe/iu);
  assert.equal(await fs.readFile(settings, 'utf8'), bytes);
});
