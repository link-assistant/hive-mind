/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { verifyToolDataRuntimeVersions } from '../src/verify-agent-runtime.mjs';

for (const mismatch of [false, true]) {
  test(`data-layout runtime verification ${mismatch ? 'rejects a changed CLI' : 'checks both native versions in disposable state'}`, { timeout: 8000 }, async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-data-versions-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const capture = path.join(root, 'children.jsonl');
    const commands = {};
    for (const [tool, version] of [
      ['agent', '0.27.0'],
      ['opencode', mismatch ? '1.19.5' : '1.19.4'],
      ['gemini', '0.65.0'],
      ['qwen', '0.26.1'],
      ['rg', 'ripgrep 14.1.1'],
    ]) {
      const command = path.join(root, `${tool}.mjs`);
      await fs.writeFile(command, `#!${process.execPath}\nimport fs from 'node:fs';\nfs.appendFileSync(${JSON.stringify(capture)}, JSON.stringify({args: process.argv.slice(2), home: process.env.HOME, data: process.env.XDG_DATA_HOME, inherited: Object.hasOwn(process.env, 'CODEX_API_KEY') || Object.hasOwn(process.env, 'NODE_OPTIONS')})+'\\n');\nconsole.log(${JSON.stringify(version)});\n`, { mode: 0o700 });
      commands[`${tool}Command`] = command;
    }
    const check = verifyToolDataRuntimeVersions({ ...commands, homeDir: root, cwd: root });
    if (mismatch) await assert.rejects(check, /data-storage CLI version/iu);
    else await check;
    const children = (await fs.readFile(capture, 'utf8'))
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    assert.equal(children.length, mismatch ? 2 : 5);
    for (const child of children) {
      assert.deepEqual(child.args, ['--version']);
      assert.equal(child.home, root);
      assert.equal(child.data, path.join(root, '.local/share'));
      assert.equal(child.inherited, false);
    }
  });
}

for (const search of ['missing', 'broken', 'working']) {
  test(`masked Agent cache requires a ${search} PATH search runtime`, { timeout: 8000 }, async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-search-runtime-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const commands = {};
    for (const [name, version] of [
      ['agent', '0.27.0'],
      ['opencode', '1.19.4'],
      ['gemini', '0.65.0'],
      ['qwen', '0.26.1'],
      ['rg', search === 'working' ? 'ripgrep 14.1.1' : ''],
    ]) {
      const command = path.join(root, name);
      if (name !== 'rg' || search !== 'missing') await fs.writeFile(command, `#!${process.execPath}\nconsole.log(${JSON.stringify(version)});\n`, { mode: 0o700 });
      commands[`${name}Command`] = command;
    }
    const check = verifyToolDataRuntimeVersions({ ...commands, homeDir: root, cwd: root });
    if (search === 'working') await check;
    else await assert.rejects(check);
  });
}

for (const changed of ['gemini', 'qwen']) {
  test(`runtime verification refuses an unattested ${changed} version`, { timeout: 8000 }, async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-oauth-versions-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const commands = {};
    for (const [name, version] of [
      ['agent', '0.27.0'],
      ['opencode', '1.19.4'],
      ['gemini', '0.65.0'],
      ['qwen', '0.26.1'],
      ['rg', 'ripgrep 14.1.1'],
    ]) {
      const command = path.join(root, name);
      await fs.writeFile(command, `#!${process.execPath}\nconsole.log(${JSON.stringify(name === changed ? '999.0.0' : version)});\n`, { mode: 0o700 });
      commands[`${name}Command`] = command;
    }
    await assert.rejects(verifyToolDataRuntimeVersions({ ...commands, homeDir: root, cwd: root }), /data-storage CLI version/iu);
  });
}
