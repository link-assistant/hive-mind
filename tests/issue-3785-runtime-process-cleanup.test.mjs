/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { verifyAgentRuntime } from '../src/verify-agent-runtime.mjs';

async function live(pid) {
  try {
    const value = await readFile(`/proc/${pid}/stat`, 'utf8');
    const fields = value
      .slice(value.lastIndexOf(')') + 1)
      .trim()
      .split(/\s+/u);
    return fields[0] !== 'Z';
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ESRCH') return false;
    throw error;
  }
}

for (const outcome of ['leader-exit', 'invalid-json', 'catalog-refusal']) {
  test(`runtime admission stops catalog descendants after ${outcome}`, { skip: process.platform !== 'linux', timeout: 10000 }, async t => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'hive-3785-probe-cleanup-'));
    const trace = path.join(root, 'helper.pid');
    let pid;
    t.after(async () => {
      if (pid && (await live(pid))) process.kill(pid, 'SIGKILL');
      const deadline = Date.now() + 2000;
      while (pid && (await live(pid)) && Date.now() < deadline) await delay(10);
      await rm(root, { recursive: true, force: true });
    });
    await mkdir(path.join(root, '.codex'));
    await writeFile(path.join(root, '.codex/config.toml'), '[features]\nremote_plugin = false\n');
    await mkdir(path.join(root, '.claude'));
    await writeFile(path.join(root, '.claude/settings.json'), JSON.stringify({ syncClaudeAiSkills: false, syncClaudeAiPlugins: false, disableClaudeAiConnectors: true, env: { CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1', ENABLE_CLAUDEAI_MCP_SERVERS: 'false' } }));
    const auth = path.join(root, '.codex/auth.json');
    await writeFile(auth, 'protected-synthetic-state');
    const before = await stat(auth);
    const claude = path.join(root, 'claude');
    await writeFile(claude, '#!/bin/sh\nprintf "%s\\n" "2.1.310 (Claude Code)"\n', { mode: 0o700 });
    const helper = path.join(root, 'helper.mjs');
    await writeFile(helper, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(trace)}, String(process.pid)); process.send('ready'); setInterval(() => {}, 100); setTimeout(() => process.exit(0), 5000);`);
    const codex = path.join(root, 'codex.mjs');
    await writeFile(
      codex,
      `#!${process.execPath}
import {spawn} from 'node:child_process';
import readline from 'node:readline';
if (process.argv.includes('--version')) { console.log('codex-cli 0.164.0'); process.exit(0); }
const helper = spawn(process.execPath, [${JSON.stringify(helper)}], {stdio: ['ignore', 'ignore', 'ignore', 'ipc']});
helper.once('message', () => {
  helper.disconnect();
  helper.unref();
  if (${JSON.stringify(outcome)} === 'leader-exit') { process.exit(2); }
  readline.createInterface({input: process.stdin}).on('line', line => {
    const message = JSON.parse(line);
    if (!message.id) return;
    if (${JSON.stringify(outcome)} === 'invalid-json') console.log('invalid synthetic response');
    else console.log(JSON.stringify({id: message.id, result: message.method === 'skills/list' ? {data: []} : {}}));
  });
});
`,
      { mode: 0o700 }
    );
    await assert.rejects(verifyAgentRuntime({ homeDir: root, claudeCommand: claude, codexCommand: codex }), /Stock CLI|stock skill discovery/iu);
    pid = Number(await readFile(trace, 'utf8'));
    assert.ok(Number.isSafeInteger(pid) && pid > 1);
    assert.equal(await live(pid), false, 'A catalog helper must stop before the verifier removes its disposable configuration and returns.');
    assert.equal(await readFile(auth, 'utf8'), 'protected-synthetic-state');
    assert.equal((await stat(auth)).ino, before.ino);
  });
}
