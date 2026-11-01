/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parse } from 'smol-toml';
import { buildCodexTaskScopeNamespace, runCodexCapabilityPreflight } from '../src/codex-capability-preflight.lib.mjs';

const parseConfig = text => parse(text, { integersAsBigInt: 'asNeeded' });

async function fixture(t, content) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scoped-codex-config-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const baseCodexHome = path.join(root, 'operator');
  const projectDir = path.join(root, 'checkout');
  await fs.mkdir(baseCodexHome);
  await fs.mkdir(projectDir);
  await fs.writeFile(path.join(baseCodexHome, 'config.toml'), content);
  const calls = [];
  const runCommand = async invocation => {
    calls.push(invocation);
    assert.equal(invocation.command, 'codex');
    assert.deepEqual(invocation.args.slice(0, 2), ['debug', 'prompt-input']);
    const skill = path.join(invocation.env.CODEX_HOME, 'skills/.system/imagegen/SKILL.md');
    await fs.mkdir(path.dirname(skill), { recursive: true });
    await fs.writeFile(skill, '---\nname: imagegen\n---\n');
    return { code: 0, stdout: JSON.stringify({ text: `<skills_instructions>\n### Available skills\n- imagegen: Fixture. (file: ${skill})\n</skills_instructions>` }), stderr: '' };
  };
  return { calls, baseCodexHome, run: () => runCodexCapabilityPreflight({ owner: 'fixture', repo: 'task', baseCodexHome, projectDir, env: {}, runCommand }) };
}

for (const declaration of ['[plugins."unrequested@fixture"]\nenabled = true', "[plugins.'unrequested@fixture']\nenabled = true", '[ "plugins" . "unrequested@fixture" ]\nenabled = true', 'plugins."unrequested@fixture".enabled = true', 'plugins = { "unrequested@fixture" = { enabled = true } }', '[plugins]\n"unrequested@fixture" = { enabled = true }', '[plugins."unrequested@fixture".nested]\nsetting = true']) {
  test(`task config removes the semantic plugin table: ${declaration.split('\n')[0]}`, async t => {
    const content = `model = "synthetic-model"\n${declaration}\n`;
    const f = await fixture(t, content);
    const result = await f.run();
    const config = parseConfig(await fs.readFile(path.join(result.codexHome, 'config.toml'), 'utf8'));
    assert.equal(config.plugins, undefined, 'unrequested plugin declarations cannot reach native discovery');
    assert.equal(config.model, 'synthetic-model');
    assert.equal(config.features.remote_plugin, false);
    assert.equal(await fs.readFile(path.join(f.baseCodexHome, 'config.toml'), 'utf8'), content, 'operator config is unchanged');
  });
}

test('task config preserves header-looking string data and typed runtime settings', async t => {
  const content = 'model = "synthetic-model"\nnotes = """\n[plugins."literal-string-data"]\nenabled = true\n"""\nlarge = 9223372036854775807\ndate = 2026-10-26T12:00:00Z\n[model_providers.fixture]\nbase_url = "http://127.0.0.1:1234"\n[features]\nremote_plugin = true\n';
  const f = await fixture(t, content);
  const result = await f.run();
  const expected = parseConfig(content);
  expected.features.remote_plugin = false;
  // Issue #3785: a scope without selected plugins keeps the loader off.
  expected.features.plugins = false;
  // ...and the hosted ChatGPT connectors MCP server off.
  expected.features.apps = false;
  assert.deepEqual(parseConfig(await fs.readFile(path.join(result.codexHome, 'config.toml'), 'utf8')), expected);
});

test('malformed operator TOML fails before native discovery without exposing input', async t => {
  const f = await fixture(t, 'model = "synthetic-private-parser-value"\nplugins = [ invalid\n');
  await assert.rejects(f.run(), error => {
    assert.match(error.message, /configuration|config/iu);
    assert.doesNotMatch(error.message, /synthetic-private-parser-value|invalid|plugins =/u);
    return true;
  });
  assert.equal(f.calls.length, 0);
  const namespace = buildCodexTaskScopeNamespace({ baseCodexHome: f.baseCodexHome, owner: 'fixture', repo: 'task' });
  assert.deepEqual(await fs.readdir(namespace), [], 'a failed preflight disposes its configuration scope');
});

test('two tasks for the same repository receive independent configuration and discovery state', async t => {
  const f = await fixture(t, 'model = "task-one-model"\n');
  const first = await f.run();
  const firstConfig = await fs.readFile(path.join(first.codexHome, 'config.toml'), 'utf8');
  const profile = path.join(first.codexHome, 'profiles', 'task-one', 'config.toml');
  await fs.mkdir(path.dirname(profile), { recursive: true });
  await fs.writeFile(profile, 'model = "task-one-private-profile"\n');
  const instruction = path.join(first.codexHome, 'skills', 'task-one', 'SKILL.md');
  await fs.mkdir(path.dirname(instruction), { recursive: true });
  await fs.writeFile(instruction, 'Task one instructions.\n');

  await fs.writeFile(path.join(f.baseCodexHome, 'config.toml'), 'model = "task-two-model"\n');
  const second = await f.run();
  assert.notEqual(second.codexHome, first.codexHome, 'another task must not reuse or erase an active task home');
  assert.match(path.relative(f.baseCodexHome, second.codexHome), /^\.\./u, 'task discovery state lives outside the operator tool home');
  assert.equal((await fs.stat(second.codexHome)).mode & 0o777, 0o700);
  assert.equal(await fs.readFile(path.join(first.codexHome, 'config.toml'), 'utf8'), firstConfig);
  assert.equal(await fs.readFile(instruction, 'utf8'), 'Task one instructions.\n');
  await assert.rejects(fs.stat(path.join(second.codexHome, 'profiles', 'task-one')), { code: 'ENOENT' });
  assert.equal(parseConfig(await fs.readFile(path.join(second.codexHome, 'config.toml'), 'utf8')).model, 'task-two-model');
});

test('concurrent preflights for the same repository retain distinct native discovery roots', async t => {
  const f = await fixture(t, 'model = "synthetic-model"\n');
  const results = await Promise.all([f.run(), f.run()]);
  assert.notEqual(results[0].codexHome, results[1].codexHome);
  for (const result of results) {
    assert.equal(result.skillCatalog.length, 1);
    assert.equal(await fs.readFile(path.join(result.codexHome, 'skills/.system/imagegen/SKILL.md'), 'utf8'), '---\nname: imagegen\n---\n');
  }
});

test('task disposal preserves shared sessions, operator credentials and another active task', async t => {
  const f = await fixture(t, 'model = "synthetic-model"\n');
  const auth = '{"OPENAI_API_KEY":"synthetic-fixture-key"}\n';
  await fs.writeFile(path.join(f.baseCodexHome, 'auth.json'), auth, { mode: 0o600 });
  const first = await f.run();
  const second = await f.run();
  await fs.writeFile(path.join(first.codexHome, 'sessions', 'synthetic-rollout.jsonl'), '{"synthetic":true}\n');
  await first.dispose();
  await first.dispose();
  await assert.rejects(fs.stat(first.codexHome), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(f.baseCodexHome, 'auth.json'), 'utf8'), auth);
  assert.equal(await fs.readFile(path.join(second.codexHome, 'sessions', 'synthetic-rollout.jsonl'), 'utf8'), '{"synthetic":true}\n');
  assert.equal(parseConfig(await fs.readFile(path.join(second.codexHome, 'config.toml'), 'utf8')).model, 'synthetic-model');
  await second.dispose();
  assert.equal(await fs.readFile(path.join(f.baseCodexHome, 'sessions', 'synthetic-rollout.jsonl'), 'utf8'), '{"synthetic":true}\n');
});

test('linked allocation namespaces are rejected before native discovery or operator mutation', async t => {
  const original = 'model = "synthetic-model"\n';
  const f = await fixture(t, original);
  const namespace = buildCodexTaskScopeNamespace({ baseCodexHome: f.baseCodexHome, owner: 'fixture', repo: 'task' });
  await fs.mkdir(path.dirname(namespace), { recursive: true });
  await fs.symlink(f.baseCodexHome, namespace);
  await assert.rejects(f.run(), /unsafe.*task|task.*unsafe/iu);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await fs.readdir(f.baseCodexHome), ['config.toml']);
  assert.equal(await fs.readFile(path.join(f.baseCodexHome, 'config.toml'), 'utf8'), original);
});

test('disposal refuses a task-home replacement without deleting its target', async t => {
  const original = 'model = "synthetic-model"\n';
  const f = await fixture(t, original);
  const result = await f.run();
  await fs.rename(result.codexHome, `${result.codexHome}-saved`);
  await fs.symlink(f.baseCodexHome, result.codexHome);
  await assert.rejects(result.dispose(), /replaced Codex task scope/u);
  assert.equal(await fs.readFile(path.join(f.baseCodexHome, 'config.toml'), 'utf8'), original);
});

test('unavailable shared sessions refuse native discovery instead of creating private history', async t => {
  const f = await fixture(t, 'model = "synthetic-model"\n');
  await fs.writeFile(path.join(f.baseCodexHome, 'sessions'), 'synthetic-obstruction');
  await assert.rejects(f.run(), /shared.*session|session.*shared/iu);
  assert.equal(f.calls.length, 0);
  assert.equal(await fs.readFile(path.join(f.baseCodexHome, 'sessions'), 'utf8'), 'synthetic-obstruction');
});
