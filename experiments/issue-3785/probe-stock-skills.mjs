// Generate a content manifest from a pristine, network-disabled real CLI home.
// Only relative file paths and SHA-256 digests are emitted, never file contents.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import os from 'node:os';
import path from 'node:path';
import { CODEX_STOCK_SKILLS, validateCodexStockSkills } from '../../src/codex-stock-skills.lib.mjs';
import { runAgentConfigAudit } from '../../src/agent-config-audit.lib.mjs';

const execute = promisify(execFile);
const root = await mkdtemp(path.join(os.tmpdir(), 'hive-3785-pristine-'));
const name = `hive-3785-pristine-${process.pid}`;
const binary = process.env.CODEX_PROBE_BINARY || '/home/box/.bun/install/global/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex';
let child;
let timer;
let sequence = 0;
const pending = new Map();
const request = (method, params) =>
  new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
try {
  await mkdir(path.join(root, 'home', '.codex'), { recursive: true });
  await mkdir(path.join(root, 'project'));
  child = spawn('docker', ['run', '--rm', '-i', '--name', name, '--cgroup-parent', '/', '--pids-limit', '64', '--network', 'none', '--user', `${process.getuid()}:${process.getgid()}`, '--ulimit', 'data=536870912:536870912', '--mount', `type=bind,source=${binary},target=/usr/local/bin/codex,readonly`, '--mount', `type=bind,source=${root},target=/probe`, '-e', 'HOME=/probe/home', '-e', 'CODEX_HOME=/probe/home/.codex', '-e', 'TOKIO_WORKER_THREADS=2', 'alpine:3.22', 'sh', '-c', 'codex --version > /probe/version; exec codex -c features.remote_plugin=false app-server'], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.resume();
  createInterface({ input: child.stdout }).on('line', line => {
    const message = JSON.parse(line);
    if (pending.has(message.id)) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(`Pristine CLI request failed: ${message.error.code}`));
      else waiter.resolve(message.result);
    }
  });
  await Promise.race([
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Finite pristine CLI probe deadline exceeded.')), 30000);
    }),
    (async () => {
      await request('initialize', { clientInfo: { name: 'hive-3785-pristine-probe', version: '0.0.0' } });
      child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`);
      const skills = await request('skills/list', { cwds: ['/probe/project'], forceReload: true });
      assert.ok(skills.data?.length, 'real CLI must discover its stock skills');
      const files = {};
      const base = path.join(root, 'home', '.codex', 'skills', '.system');
      async function scan(directory, prefix = '') {
        for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
          const relative = prefix + entry.name;
          const fullPath = path.join(directory, entry.name);
          if (entry.isDirectory()) await scan(fullPath, `${relative}/`);
          else {
            assert.ok(entry.isFile(), 'pristine stock entries must be regular files');
            files[relative] = createHash('sha256')
              .update(await readFile(fullPath))
              .digest('hex');
          }
        }
      }
      await scan(base);
      assert.ok(
        Object.keys(files).some(file => file.endsWith('/SKILL.md')),
        'pristine CLI must materialize stock skills'
      );
      const version = await readFile(path.join(root, 'version'), 'utf8');
      if (process.argv.includes('--verify')) {
        assert.equal(version.trim(), CODEX_STOCK_SKILLS.cliVersion);
        await validateCodexStockSkills({ directory: base });
        await writeFile(path.join(root, 'home', '.codex', 'config.toml'), '[features]\nremote_plugin = false\n');
        await runAgentConfigAudit({ tool: 'codex', homeDir: path.join(root, 'home'), requireClean: true });
        console.error('Verified: pristine native stock tree matches the bundled pinned manifest.');
      }
      console.log(JSON.stringify({ cliVersion: version.trim(), files }, null, 2));
    })(),
  ]);
} finally {
  clearTimeout(timer);
  child?.stdin.end();
  await execute('docker', ['rm', '-f', name]).catch(() => {});
  if (child && child.exitCode === null) await new Promise(resolve => child.once('close', resolve));
  await rm(root, { recursive: true, force: true });
}
