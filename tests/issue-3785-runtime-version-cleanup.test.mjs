/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { verifyToolDataRuntimeVersions } from '../src/verify-agent-runtime.mjs';

async function live(pid) {
  try {
    const value = await readFile(`/proc/${pid}/stat`, 'utf8');
    return (
      value
        .slice(value.lastIndexOf(')') + 1)
        .trim()
        .split(/\s+/u)[0] !== 'Z'
    );
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ESRCH') return false;
    throw error;
  }
}

for (const outcome of ['success', 'exit-error', 'output-overflow']) {
  test(`version admission stops native helpers after ${outcome}`, { skip: process.platform !== 'linux', timeout: 10000 }, async t => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'hive-3785-version-cleanup-'));
    const trace = path.join(root, 'helper.pid');
    let pid;
    t.after(async () => {
      pid ||= Number(await readFile(trace, 'utf8').catch(() => '0'));
      if (pid && (await live(pid))) process.kill(pid, 'SIGKILL');
      const deadline = Date.now() + 2000;
      while (pid && (await live(pid)) && Date.now() < deadline) await delay(10);
      await rm(root, { recursive: true, force: true });
    });
    const homeDir = path.join(root, 'home');
    const cwd = path.join(root, 'project');
    await mkdir(homeDir);
    await mkdir(cwd);
    const helper = path.join(root, 'helper.mjs');
    await writeFile(helper, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(trace)}, String(process.pid)); process.send('ready'); setInterval(() => {}, 100); setTimeout(() => process.exit(0), 5000);`);
    const agentCommand = path.join(root, 'agent.mjs');
    await writeFile(
      agentCommand,
      `#!${process.execPath}
import {spawn} from 'node:child_process';
const helper = spawn(process.execPath, [${JSON.stringify(helper)}], {stdio: ['ignore', 'ignore', 'ignore', 'ipc']});
helper.once('message', () => {
  helper.disconnect(); helper.unref();
  if (${JSON.stringify(outcome)} === 'exit-error') process.exit(7);
  const output = ${JSON.stringify(outcome)} === 'output-overflow' ? 'x'.repeat(128 * 1024) : '0.27.0';
  process.stdout.write(output + '\\n', () => process.exit(0));
});
`,
      { mode: 0o700 }
    );
    const commands = { homeDir, cwd, agentCommand };
    for (const [name, version] of [
      ['opencode', '1.19.4'],
      ['gemini', '0.65.0'],
      ['qwen', '0.26.1'],
      ['rg', 'ripgrep 15.1.0'],
    ]) {
      const command = path.join(root, name);
      await writeFile(command, `#!/bin/sh\nprintf '%s\\n' '${version}'\n`, { mode: 0o700 });
      commands[`${name}Command`] = command;
    }
    if (outcome === 'success') await verifyToolDataRuntimeVersions(commands);
    else await assert.rejects(verifyToolDataRuntimeVersions(commands));
    pid = Number(await readFile(trace, 'utf8'));
    assert.ok(Number.isSafeInteger(pid) && pid > 1);
    assert.equal(await live(pid), false, 'Version helpers must stop before returning or removing their disposable home.');
  });
}
