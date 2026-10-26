// Exercise the image's package installer in disposable Bun storage, then run
// the installed verifier against the actual network-disabled Codex binary.
// Claude --version is local; this is not a full release-image lifecycle test.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, realpath, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
const execute = promisify(execFile);
const root = await mkdtemp(path.join(os.tmpdir(), 'hive-3785-package-'));
const label = `hive-3785-package=${process.pid}`;
const binary = process.env.CODEX_PROBE_BINARY || '/home/box/.bun/install/global/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex';
const env = { ...process.env, BUN_INSTALL: path.join(root, 'bun'), PATH: `${path.join(root, 'bun/bin')}:${process.env.PATH}` };
try {
  const { stdout: bin } = await execute('bun', ['pm', 'bin', '-g'], { env });
  assert.equal(bin.trim(), path.join(root, 'bun/bin'), 'Bun global install must be disposable before invoking the installer');
  await execute('bash', ['scripts/install-image-package.sh', process.cwd()], { env, maxBuffer: 1024 * 1024 });
  // Docker installs more global tools after Hive Mind. Its dependency must
  // remain usable after the installer's temporary archive is removed.
  await execute('bun', ['install', '--global', '--ignore-scripts'], { env, maxBuffer: 1024 * 1024 });
  const installed = await realpath(path.join(root, 'bun/bin/hive'));
  assert.ok(installed.startsWith(`${root}/`), 'installed package must not resolve into the checkout or host global installation');
  const modulePath = path.join(path.dirname(installed), 'verify-agent-runtime.mjs');
  const { verifyAgentRuntime } = await import(pathToFileURL(modulePath).href);
  const proxy = path.join(root, 'codex.mjs');
  await writeFile(
    proxy,
    `#!${process.execPath}
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
const version = process.argv.includes('--version');
const args = ['run', '--rm', '-i', '--label', ${JSON.stringify(label)}, '--cgroup-parent', '/', '--pids-limit', '64', '--network', 'none', '--user', process.getuid() + ':' + process.getgid(), '--ulimit', 'data=536870912:536870912', '--mount', ${JSON.stringify(`type=bind,source=${binary},target=/usr/local/bin/codex,readonly`)}, '-e', 'TOKIO_WORKER_THREADS=2'];
if (!version) {
  const fixture = path.dirname(process.env.HOME);
  assert.ok(fixture.startsWith('/tmp/hive-stock-gate-'), 'only disposable gate state may be mounted');
  args.push('--mount', 'type=bind,source=' + fixture + ',target=' + fixture, '-w', process.cwd());
  for (const key of ['HOME', 'CODEX_HOME', 'CODEX_SQLITE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME']) args.push('-e', key + '=' + process.env[key]);
} else args.push('-e', 'HOME=/tmp/pristine-version-home', '-e', 'CODEX_HOME=/tmp/pristine-version-home/.codex');
args.push('alpine:3.22', '/usr/local/bin/codex', ...process.argv.slice(2));
const result = spawnSync('docker', args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
`,
    { mode: 0o700 }
  );
  const home = path.join(root, 'global-home');
  await mkdir(path.join(home, '.codex'), { recursive: true });
  await writeFile(path.join(home, '.codex/config.toml'), '[features]\nremote_plugin = false\n');
  await verifyAgentRuntime({ homeDir: home, codexCommand: proxy });
  console.log('Verified: disposable Bun installation contains the branch package, stock manifest and required runtime verifier.');
  console.log('Its installed verifier passed with the real offline Codex stock tree and local Claude version check.');
  console.log('This does not verify release-image boot, persisted-state migration, auth/history or daemon lifecycle gates.');
} finally {
  const { stdout } = await execute('docker', ['ps', '-aq', '--filter', `label=${label}`]);
  const containers = stdout.trim().split(/\s+/).filter(Boolean);
  if (containers.length) await execute('docker', ['rm', '-f', ...containers]);
  await rm(root, { recursive: true, force: true });
}
