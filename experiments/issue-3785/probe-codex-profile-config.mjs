// Real pinned Codex profile-v2 discovery with disposable synthetic state only.
/* global AbortSignal */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { promisify } from 'node:util';
import { runAgentConfigAudit } from '../../src/agent-config-audit.lib.mjs';

const execute = promisify(execFile);
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-3785-native-profile-'));
const label = `hive-3785-native-profile=${process.pid}`;
const binary = process.env.CODEX_PROBE_BINARY || '/home/box/.bun/install/global/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex';
try {
  const homeDir = path.join(root, 'home');
  const configDir = path.join(homeDir, '.codex');
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(path.join(configDir, 'config.toml'), '[features]\nremote_plugin = false\n');
  const profile = path.join(configDir, 'work.config.toml');
  const bytes = '[features]\nremote_plugin = false\n[mcp_servers.synthetic_profile]\ncommand = "/bin/false"\n';
  await fs.writeFile(profile, bytes);
  const { stdout } = await execute('docker', ['run', '--rm', '--label', label, '--cgroup-parent', '/', '--pids-limit', '64', '--network', 'none', '--user', `${process.getuid()}:${process.getgid()}`, '--ulimit', 'data=536870912:536870912', '--mount', `type=bind,source=${binary},target=/usr/local/bin/codex,readonly`, '--mount', `type=bind,source=${homeDir},target=/home/probe`, '-e', 'HOME=/home/probe', '-e', 'CODEX_HOME=/home/probe/.codex', '-e', 'TOKIO_WORKER_THREADS=2', 'alpine:3.22', 'sh', '-c', "codex --version | grep -Ex 'codex(-cli)? 0[.]164[.]0' >/dev/null || exit 1; exec codex --profile work mcp list --json"], { maxBuffer: 128 * 1024, signal: AbortSignal.timeout(30_000) });
  assert.ok(JSON.parse(stdout).some(server => server.name === 'synthetic_profile'));
  console.log('Verified: the actual pinned CLI discovers MCP from a separate profile-v2 file beside a clean base config.');
  await assert.rejects(runAgentConfigAudit({ tool: 'codex', homeDir, systemRoots: { claude: path.join(root, 'system-claude'), codex: path.join(root, 'system-codex') }, autoRepair: false, requireClean: true }), /not clean/iu);
  assert.equal(await fs.readFile(profile, 'utf8'), bytes);
  console.log('Verified: launcher admission refuses the native profile addition without modifying its configuration.');
} finally {
  const { stdout } = await execute('docker', ['ps', '-aq', '--filter', `label=${label}`]);
  const names = stdout.trim().split(/\s+/u).filter(Boolean);
  if (names.length) await execute('docker', ['rm', '-f', ...names]);
  await fs.rm(root, { recursive: true, force: true });
}
