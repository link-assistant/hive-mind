/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parse } from 'smol-toml';
import { runCodexCapabilityPreflight } from '../src/codex-capability-preflight.lib.mjs';

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
});
