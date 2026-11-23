// A pristine stock tree alone must not admit an additional native admin skill.
// Only a real pinned binary and synthetic, disposable state enter the container.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { verifyAgentRuntime } from '../../src/verify-agent-runtime.mjs';

const execute = promisify(execFile);
const root = await mkdtemp(path.join(os.tmpdir(), 'hive-3785-admin-catalog-'));
const label = `hive-3785-admin-catalog=${process.pid}`;
const binary = process.env.CODEX_PROBE_BINARY || '/home/box/.bun/install/global/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex';
const capture = path.join(root, 'discovery.json');
try {
  const home = path.join(root, 'global-home');
  const admin = path.join(root, 'admin');
  await mkdir(path.join(home, '.codex'), { recursive: true });
  await writeFile(path.join(home, '.codex/config.toml'), '[features]\nremote_plugin = false\n');
  await mkdir(path.join(admin, 'skills/operator'), { recursive: true });
  await writeFile(path.join(admin, 'config.toml'), '[features]\nremote_plugin = false\n');
  await writeFile(path.join(admin, 'skills/operator/SKILL.md'), '---\nname: synthetic-admin-skill\ndescription: Synthetic native catalog probe.\n---\nOnly catalog discovery is requested; never execute this fixture.\n');
  const proxy = path.join(root, 'codex.mjs');
  await writeFile(
    proxy,
    `#!${process.execPath}
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {createInterface} from 'node:readline';
const version = process.argv.includes('--version');
const args = ['run', '--rm', '-i', '--label', ${JSON.stringify(label)}, '--cgroup-parent', '/', '--pids-limit', '64', '--network', 'none', '--user', process.getuid() + ':' + process.getgid(), '--ulimit', 'data=536870912:536870912', '--mount', ${JSON.stringify(`type=bind,source=${binary},target=/usr/local/bin/codex,readonly`)}, '--mount', ${JSON.stringify(`type=bind,source=${admin},target=/etc/codex,readonly`)}, '-e', 'TOKIO_WORKER_THREADS=2'];
if (!version) {
  const fixture = path.dirname(process.env.HOME);
  if (!fixture.startsWith('/tmp/hive-stock-gate-')) throw new Error('Only disposable gate state may be mounted.');
  args.push('--mount', 'type=bind,source=' + fixture + ',target=' + fixture, '-w', process.cwd());
  for (const key of ['HOME', 'CODEX_HOME', 'CODEX_SQLITE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME']) args.push('-e', key + '=' + process.env[key]);
} else args.push('-e', 'HOME=/tmp/pristine-version-home', '-e', 'CODEX_HOME=/tmp/pristine-version-home/.codex');
args.push('alpine:3.22', '/usr/local/bin/codex', ...process.argv.slice(2));
const child = spawn('docker', args, {stdio: ['inherit', 'pipe', 'inherit']});
createInterface({input: child.stdout}).on('line', line => {
  if (!version) {
    const response = JSON.parse(line);
    if (response.result?.data) {
      const skills = response.result.data.flatMap(entry => entry.skills || []);
      const stock = skills.filter(skill => skill.scope === 'system');
      fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify({adminVisible: skills.some(skill => skill.name === 'synthetic-admin-skill' && skill.scope === 'admin'), stockCount: stock.length, stockNames: stock.map(skill => skill.name), privateStockPaths: stock.every(skill => skill.path.startsWith(process.env.CODEX_HOME + '/skills/.system/')), stockEnabled: stock.every(skill => skill.enabled === true), noStockPlugins: stock.every(skill => skill.pluginId == null), requestedCwd: response.result.data.every(entry => entry.cwd === process.cwd()), noErrors: response.result.data.every(entry => Array.isArray(entry.errors) && entry.errors.length === 0)}));
    }
  }
  process.stdout.write(line + '\\n');
});
child.on('close', code => process.exit(code ?? 1));
child.on('error', () => process.exit(1));
`,
    { mode: 0o700 }
  );
  let admitted = true;
  try {
    await verifyAgentRuntime({ homeDir: home, codexCommand: proxy });
  } catch (error) {
    admitted = false;
    assert.match(error.message, /catalog|discovery/iu, 'reject because native discovery contains an unapproved skill');
  }
  const discovered = JSON.parse(await readFile(capture, 'utf8'));
  console.log(JSON.stringify(discovered));
  assert.equal(discovered.adminVisible, true, 'the actual native CLI must discover the synthetic admin skill');
  assert.ok(discovered.stockCount > 0, 'the actual native CLI must also discover its pristine stock skills');
  assert.equal(admitted, false, 'the installed runtime gate admitted extra native admin skills alongside pristine stock');
  console.log('Verified: real offline Codex discovers pristine stock plus a synthetic admin skill, and runtime admission rejects the extra catalog entry.');
} finally {
  const { stdout } = await execute('docker', ['ps', '-aq', '--filter', `label=${label}`]);
  const containers = stdout.trim().split(/\s+/u).filter(Boolean);
  if (containers.length) await execute('docker', ['rm', '-f', ...containers]);
  await rm(root, { recursive: true, force: true });
}
