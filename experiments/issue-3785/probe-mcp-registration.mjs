// Verify native registration formats using disposable homes and no credentials.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { assertApprovedPlaywrightRegistration } from '../../src/agent-mcp-baseline.lib.mjs';
import { runAgentConfigAudit } from '../../src/agent-config-audit.lib.mjs';

const execute = promisify(execFile);
const root = await mkdtemp(path.join(os.tmpdir(), 'hive-3785-native-mcp-'));
const label = `hive-3785-native-mcp=${process.pid}`;
const home = path.join(root, 'home');
const codex = process.env.CODEX_PROBE_BINARY || '/home/box/.bun/install/global/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex';
const registration = ['npx', '-y', '@playwright/mcp@latest', '--isolated', '--headless', '--no-sandbox', '--timeout-action=600000', '--viewport-size', '1920x1080'];
const env = { PATH: process.env.PATH, HOME: home, CLAUDE_CONFIG_DIR: path.join(home, '.claude'), CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1', DISABLE_AUTOUPDATER: '1' };
try {
  await mkdir(path.join(home, '.claude'), { recursive: true });
  await mkdir(path.join(home, '.codex'), { recursive: true });
  await writeFile(path.join(home, '.codex/config.toml'), '[features]\nremote_plugin = false\n');
  const { stdout: version } = await execute('claude', ['--version'], { env, timeout: 30_000, maxBuffer: 65536 });
  assert.match(version, /^2\.1\.310 /u);
  await execute('claude', ['mcp', 'add', 'playwright', '-s', 'user', '--', ...registration], { env, cwd: root, timeout: 30_000, maxBuffer: 65536 });
  // CLAUDE_CONFIG_DIR also relocates the user MCP state file in this CLI.
  const config = JSON.parse(await readFile(path.join(home, '.claude/.claude.json'), 'utf8'));
  assertApprovedPlaywrightRegistration(config.mcpServers.playwright, 'claude');
  const args = ['run', '--rm', '--label', label, '--cgroup-parent', '/', '--network', 'none', '--pids-limit', '64', '--ulimit', 'data=536870912:536870912', '--user', `${process.getuid()}:${process.getgid()}`, '--mount', `type=bind,source=${root},target=${root}`, '--mount', `type=bind,source=${codex},target=/usr/local/bin/codex,readonly`, '-e', `HOME=${home}`, '-e', `CODEX_HOME=${home}/.codex`, '-e', 'TOKIO_WORKER_THREADS=2', '-w', root, 'alpine:3.22', '/usr/local/bin/codex', 'mcp', 'add', 'playwright', '--', ...registration];
  await execute('docker', args, { timeout: 30_000, maxBuffer: 65536 });
  const codexConfig = parseToml(await readFile(path.join(home, '.codex/config.toml'), 'utf8'));
  assertApprovedPlaywrightRegistration(codexConfig.mcp_servers.playwright, 'codex');
  await runAgentConfigAudit({ homeDir: home, autoRepair: false, requireClean: true });
  console.log('Verified actual Claude 2.1.310 and Codex 0.164.0 saved Playwright registrations against the command baseline.');
  console.log('Only disposable homes were used; this does not attest effective native search paths or package integrity.');
} finally {
  const { stdout } = await execute('docker', ['ps', '-aq', '--filter', `label=${label}`]);
  const containers = stdout.trim().split(/\s+/u).filter(Boolean);
  if (containers.length) await execute('docker', ['rm', '-f', ...containers]);
  await rm(root, { recursive: true, force: true });
}
