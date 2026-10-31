// Real pinned Codex reads system MCP defaults even with a pristine user home.
// Synthetic, disposable inputs only; no MCP process or model request is started.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { runAgentConfigAudit } from '../../src/agent-config-audit.lib.mjs';

const execute = promisify(execFile);
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-managed-native-'));
const label = `hive-managed-native=${process.pid}`;
const binary = process.env.CODEX_PROBE_BINARY || '/home/box/.bun/install/global/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex';
try {
  const homeDir = path.join(root, 'home');
  const systemRoots = { claude: path.join(root, 'claude'), codex: path.join(root, 'codex') };
  for (const directory of [path.join(homeDir, '.codex'), ...Object.values(systemRoots)]) await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(homeDir, '.codex/config.toml'), '[features]\nremote_plugin = false\n');
  const target = path.join(systemRoots.codex, 'config.toml');
  const bytes = '[mcp_servers.synthetic_managed]\ncommand = "/bin/false"\n';
  await fs.writeFile(target, bytes);
  const before = await fs.stat(target);
  const { stdout } = await execute('docker', ['run', '--rm', '--label', label, '--cgroup-parent', '/', '--pids-limit', '64', '--network', 'none', '--user', `${process.getuid()}:${process.getgid()}`, '--ulimit', 'data=536870912:536870912', '--mount', `type=bind,source=${binary},target=/usr/local/bin/codex,readonly`, '--mount', `type=bind,source=${systemRoots.codex},target=/etc/codex,readonly`, '--mount', `type=bind,source=${homeDir},target=/home/probe`, '--env', 'HOME=/home/probe', '--env', 'CODEX_HOME=/home/probe/.codex', '--env', 'TOKIO_WORKER_THREADS=2', 'alpine:3.22', '/usr/local/bin/codex', 'mcp', 'list', '--json'], { maxBuffer: 128 * 1024, signal: AbortSignal.timeout(30_000) });
  const servers = JSON.parse(stdout);
  assert.ok(Array.isArray(servers) && servers.some(server => server.name === 'synthetic_managed'), 'the pinned CLI must discover the system registration');
  await assert.rejects(runAgentConfigAudit({ homeDir, systemRoots, tool: 'codex', requireClean: true }), /managed.*not clean/iu);
  assert.equal(await fs.readFile(target, 'utf8'), bytes);
  assert.equal((await fs.stat(target)).ino, before.ino);
  console.log('Verified: real offline Codex discovers the synthetic system MCP registration; launcher admission rejects it and preserves managed policy identity.');
} finally {
  const { stdout } = await execute('docker', ['ps', '-aq', '--filter', `label=${label}`]);
  const names = stdout.trim().split(/\s+/u).filter(Boolean);
  if (names.length) await execute('docker', ['rm', '-f', ...names]);
  await fs.rm(root, { recursive: true, force: true });
}
