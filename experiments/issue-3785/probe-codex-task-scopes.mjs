// Actual pinned Codex discovery in concurrent, private task scopes; no inference.
/* global AbortSignal */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { promisify } from 'node:util';
import { runCodexCapabilityPreflight, verifyCodexCapabilityExecutionCatalog } from '../../src/codex-capability-preflight.lib.mjs';

const execute = promisify(execFile);
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-3785-task-scopes-'));
const label = `hive-3785-task-scopes=${process.pid}`;
const binary = process.env.CODEX_PROBE_BINARY || '/home/box/.bun/install/global/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex';
const preflights = [];

try {
  const homeDir = path.join(root, 'home');
  const baseCodexHome = path.join(homeDir, '.codex');
  await fs.mkdir(baseCodexHome, { recursive: true, mode: 0o700 });
  const config = 'model = "gpt-5"\n[features]\nremote_plugin = false\n';
  const auth = '{"OPENAI_API_KEY":"synthetic-offline-fixture"}\n';
  await fs.writeFile(path.join(baseCodexHome, 'config.toml'), config);
  await fs.writeFile(path.join(baseCodexHome, 'auth.json'), auth, { mode: 0o600 });
  const before = await fs.stat(path.join(baseCodexHome, 'auth.json'));

  const runCommand = async ({ command, args, env, cwd }) => {
    assert.equal(command, 'codex');
    const minimal = { HOME: homeDir, CODEX_HOME: env.CODEX_HOME, TOKIO_WORKER_THREADS: '2', RUST_LOG: 'off' };
    const dockerArgs = ['run', '--rm', '--label', label, '--cgroup-parent', '/', '--network', 'none', '--read-only', '--pids-limit', '64', '--user', `${process.getuid()}:${process.getgid()}`, '--ulimit', 'data=536870912:536870912', '--ulimit', 'stack=16777216:16777216', '--mount', `type=bind,source=${binary},target=/usr/local/bin/codex,readonly`, '--mount', `type=bind,source=${root},target=${root}`, '-w', cwd || root];
    for (const [name, value] of Object.entries(minimal)) dockerArgs.push('-e', `${name}=${value}`);
    try {
      const result = await execute('docker', [...dockerArgs, 'alpine:3.22', 'codex', ...args], { maxBuffer: 2 * 1024 * 1024, signal: AbortSignal.timeout(45_000) });
      return { ...result, code: 0 };
    } catch (error) {
      // The fixture is synthetic, but the failure need not quote native output.
      return { code: Number.isInteger(error.code) ? error.code : 1, stdout: '', stderr: 'Bounded native task-scope invocation failed.' };
    }
  };

  const version = await runCommand({ command: 'codex', args: ['--version'], env: { CODEX_HOME: baseCodexHome } });
  assert.equal(version.code, 0);
  assert.match(version.stdout.trim(), /^codex(?:-cli)? 0\.164\.0$/u);

  const tasks = [];
  for (const skill of ['fixture-alpha', 'fixture-beta']) {
    const projectDir = path.join(root, skill);
    const skillFile = path.join(projectDir, '.agents', 'skills', skill, 'SKILL.md');
    await fs.mkdir(path.dirname(skillFile), { recursive: true });
    await execute('git', ['init', '--quiet', projectDir], { env: { PATH: '/usr/bin:/bin', HOME: homeDir } });
    await fs.writeFile(skillFile, `---\nname: ${skill}\ndescription: Offline task-scope fixture.\n---\nSynthetic instructions.\n`);
    await fs.writeFile(path.join(projectDir, 'AGENTS.md'), `Use $${skill}.\n`);
    tasks.push({ owner: 'fixture', repo: 'same-repository', projectDir, baseCodexHome, env: {}, runCommand, skill });
  }
  const settled = await Promise.allSettled(tasks.map(task => runCodexCapabilityPreflight(task)));
  for (const result of settled) if (result.status === 'fulfilled') preflights.push(result.value);
  assert.ok(
    settled.every(result => result.status === 'fulfilled'),
    'both actual native preflights must succeed'
  );
  assert.notEqual(preflights[0].codexHome, preflights[1].codexHome);

  for (let index = 0; index < tasks.length; index++) {
    const task = tasks[index];
    const preflight = preflights[index];
    assert.deepEqual(preflight.skills, [task.skill]);
    const names = preflight.skillCatalog.map(entry => entry.name);
    assert.ok(names.includes(task.skill));
    assert.ok(!names.includes(tasks[1 - index].skill), 'a peer capability must not enter native discovery');
    assert.equal((await fs.stat(preflight.codexHome)).mode & 0o777, 0o700);
    await verifyCodexCapabilityExecutionCatalog({ capabilityPreflight: preflight, projectDir: task.projectDir, env: {}, runCommand });
  }
  const firstConfig = await fs.readFile(path.join(preflights[0].codexHome, 'config.toml'), 'utf8');
  const repeat = await runCodexCapabilityPreflight(tasks[0]);
  preflights.push(repeat);
  assert.ok(!preflights.slice(0, 2).some(previous => previous.codexHome === repeat.codexHome));
  assert.equal(await fs.readFile(path.join(preflights[0].codexHome, 'config.toml'), 'utf8'), firstConfig);
  assert.equal(await fs.readFile(path.join(baseCodexHome, 'config.toml'), 'utf8'), config);
  assert.equal(await fs.readFile(path.join(baseCodexHome, 'auth.json'), 'utf8'), auth);
  const after = await fs.stat(path.join(baseCodexHome, 'auth.json'));
  assert.equal(after.ino, before.ino);
  assert.equal(after.dev, before.dev);
  assert.deepEqual((await fs.readdir(baseCodexHome)).sort(), ['auth.json', 'config.toml', 'sessions']);
  console.log('Verified: pinned native Codex uses distinct concurrent same-repository task homes, exposes only each checkout capability, rechecks both catalogs and preserves operator state.');
  console.log('Limits: discovery only; no inference, auth refresh, full history/resume or production lifecycle cleanup is certified.');
} finally {
  const { stdout } = await execute('docker', ['ps', '-aq', '--filter', `label=${label}`]);
  const remaining = stdout.trim().split(/\s+/u).filter(Boolean);
  if (remaining.length) await execute('docker', ['rm', '-f', ...remaining]);
  for (const preflight of preflights) await preflight.dispose();
  await fs.rm(root, { recursive: true, force: true });
}
