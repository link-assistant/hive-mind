// Actual pinned CLI and production builders; synthetic credentials, no provider.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { prepareMountedNativeRuntime } from './mounted-native-runtime.lib.mjs';

const execute = promisify(execFile);
const source = path.dirname(await fs.realpath(process.argv[2]));
const { buildDockerIsolationStartArgs, prepareDockerIsolationHostPaths, resolveDockerIsolationMountSources } = await import(pathToFileURL(path.join(source, 'isolation-runner.lib.mjs')));
const image = process.env.HIVE_MOUNT_TEST_IMAGE;
assert.ok(image, 'Supply the daemon-local Node fixture image.');
const experimental = process.argv[3];
const entrypoint = await fs.realpath(experimental || (await execute('sh', ['-c', 'command -v claude'], { env: { PATH: process.env.PATH }, maxBuffer: 4096 })).stdout.trim());
const fixture = await fs.mkdtemp(path.join(process.env.HIVE_MOUNT_TEST_FIXTURE || '/mount-fixture', 'claude-auth-'));
const canonical = path.join(fixture, 'canonical');
const homeDir = path.join(fixture, 'operator');
const rootConfig = path.join(fixture, 'root-config');
const runtime = path.join(fixture, 'runtime');
const names = Array.from({ length: 3 }, () => `hive-claude-auth-${randomUUID()}`);
const baseEnv = { PATH: process.env.PATH, DOCKER_HOST: 'unix:///var/run/docker.sock', HIVE_MIND_DOCKER_ISOLATION_IMAGE: image };
const docker = args => execute('docker', args, { env: baseEnv, maxBuffer: 262144, signal: AbortSignal.timeout(30_000) });
const credential = plan => JSON.stringify({ claudeAiOauth: { accessToken: 'SYNTHETIC_NOT_A_PROVIDER_TOKEN', refreshToken: 'SYNTHETIC_NOT_A_REFRESH_TOKEN', expiresAt: Date.now() + 3600000, scopes: ['user:inference', 'user:profile'], subscriptionType: plan, rateLimitTier: 'default_claude_max_5x' } });
const auth = path.join(canonical, '.credentials.json');
const publish = async (plan, atomic = true) => {
  const filename = atomic ? `${auth}.new` : auth;
  await fs.writeFile(filename, credential(plan), { mode: 0o600 });
  if (atomic) await fs.rename(filename, auth);
};
const traffic = { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
let rootEnv;
let command;
let runtimeMount;

async function invoke(side, args) {
  let pending;
  if (side === 'root') {
    pending = execute('prlimit', ['--data=1610612736', '--stack=16777216', '--core=0', '--', entrypoint, ...args], { env: rootEnv, cwd: homeDir, maxBuffer: 262144, signal: AbortSignal.timeout(20_000), killSignal: 'SIGKILL' });
  } else {
    const index = Number(side);
    const environment = { HOME: `/tmp/claude-home-${index}`, CLAUDE_CONFIG_DIR: `/tmp/claude-config-${index}`, ...traffic };
    const configure = `mkdir -p -m 700 "$CLAUDE_CONFIG_DIR" "$HOME"; exec ${command} "$@"`;
    pending = execute('docker', ['exec', '-i', ...Object.entries(environment).flatMap(([name, value]) => ['--env', `${name}=${value}`]), names[index], 'sh', '-c', configure, 'sh', ...args], { env: baseEnv, maxBuffer: 262144, signal: AbortSignal.timeout(25_000) });
  }
  pending.child.stdin.end();
  return pending.catch(error => {
    if (Number.isInteger(error.code)) return { code: error.code, stdout: error.stdout, stderr: error.stderr };
    throw new Error('Bounded native Claude authentication process failed to complete.');
  });
}

async function status(side, plan) {
  const result = await invoke(side, ['auth', 'status', '--json']);
  const state = JSON.parse(result.stdout);
  assert.equal(state.loggedIn, plan !== null, 'Native status selected the wrong authentication state.');
  if (plan !== null) assert.equal(state.subscriptionType, plan, 'Native status read a different credential generation.');
}

// All three CLI processes are sequential to bound peak resident memory.
async function peers(plan) {
  for (const side of ['root', 0, 1]) await status(side, plan);
}

try {
  for (const directory of [canonical, homeDir, rootConfig, runtime]) await fs.mkdir(directory, { mode: 0o700 });
  command = await prepareMountedNativeRuntime(entrypoint, runtime, 'claude');
  await publish('max');
  const selectedEnv = { ...baseEnv, CLAUDE_SECURESTORAGE_CONFIG_DIR: canonical };
  const prepared = await prepareDockerIsolationHostPaths({ tool: 'claude', homeDir, env: selectedEnv });
  rootEnv = { PATH: process.env.PATH, HOME: homeDir, CLAUDE_CONFIG_DIR: rootConfig, CLAUDE_SECURESTORAGE_CONFIG_DIR: canonical, HIVE_MIND_CLAUDE_AUTH_IDENTITY: prepared.nativeAuthIdentity, ...traffic };
  assert.equal((await invoke('root', ['--version'])).stdout.trim(), '2.1.310 (Claude Code)', 'Installed Claude differs from the pinned runtime.');
  const args = await buildDockerIsolationStartArgs('solve', [], {
    tool: 'claude',
    homeDir,
    env: selectedEnv,
    nativeAuthIdentity: prepared.nativeAuthIdentity,
    sessionId: 'native-claude-auth-gate',
    resolveMountSources: async options => {
      const resolved = await resolveDockerIsolationMountSources({ ...options, mounts: [...options.mounts, { source: runtime, target: '/__native_runtime', readOnly: true }] });
      runtimeMount = resolved.find(mount => mount.target === '/__native_runtime');
      return resolved;
    },
  });
  const flags = args.flatMap((arg, index) => (['--volume', '-e'].includes(arg) ? [arg, args[index + 1]] : []));
  const common = ['run', '--detach', '--pull', 'never', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '64', '--ulimit', 'data=1610612736:1610612736', '--ulimit', 'stack=16777216:16777216', '--ulimit', 'core=0:0', '--user', `${process.getuid()}:${process.getgid()}`, '--tmpfs', '/tmp:rw,exec,size=33554432,mode=1777', '--entrypoint', 'sh'];
  // This delegated local cgroup is threaded; release runners use a memory cap.
  if (experimental) common.push('--cgroup-parent', '/');
  else common.push('--memory', '268435456');
  for (const name of names.slice(0, 2)) await docker([...common, '--name', name, ...flags, image, '-c', 'exec sleep 240']);
  for (const name of names.slice(0, 2)) assert.equal((await docker(['exec', name, 'stat', '-c', '%d:%i', '/home/box/.hive-mind/canonical/claude-auth'])).stdout.trim(), prepared.nativeAuthIdentity);
  const authVolume = flags.find((arg, index) => flags[index - 1] === '--volume' && arg.endsWith(':/home/box/.hive-mind/canonical/claude-auth'));
  assert.ok(authVolume, 'The production builder omitted the canonical parent.');
  const daemonAuth = authVolume.slice(0, authVolume.indexOf(':'));
  await docker([...common, '--name', names[2], '--tmpfs', `/__legacy_auth:rw,uid=${process.getuid()},gid=${process.getgid()},mode=700,size=1048576`, '--mount', `type=bind,source=${daemonAuth}/.credentials.json,target=/__legacy_auth/.credentials.json,readonly`, '--mount', `type=bind,source=${runtimeMount.source},target=/__native_runtime,readonly`, '--env', 'CLAUDE_SECURESTORAGE_CONFIG_DIR=/__legacy_auth', image, '-c', 'exec sleep 240']);
  await peers('max');
  await status(2, 'max');
  await publish('pro');
  await peers('pro');
  // Stock Claude reads the retired inode retained by a single-file bind.
  await status(2, 'max');
  await invoke(0, ['auth', 'logout']);
  await peers(null);
  await status(2, 'max');
  // Synthetic publication represents a provider login's replacement; no OAuth
  // login or refresh protocol is claimed by this network-disabled control.
  await publish('max');
  await peers('max');
  await invoke('root', ['auth', 'logout']);
  await peers(null);
  await publish('pro');
  await peers('pro');
  await publish('max', false);
  await peers('max');
  for (const [index, name] of names.slice(0, 2).entries()) await docker(['exec', name, 'rm', '-rf', `/tmp/claude-config-${index}`, `/tmp/claude-home-${index}`]);
  await fs.rm(rootConfig, { recursive: true });
  await fs.mkdir(rootConfig, { mode: 0o700 });
  await peers('max');
  for (const directory of [rootConfig, path.join(homeDir, '.claude')]) await assert.rejects(fs.lstat(path.join(directory, '.credentials.json')), { code: 'ENOENT' });
  assert.equal(JSON.parse(await fs.readFile(auth, 'utf8')).claudeAiOauth.subscriptionType, 'max');
  console.log('PASS: pinned native Claude root and two Docker peers retain parent-backed replacement, task/root logout, synthetic reauthentication and private-config disposal; the file-bind control continues to read retired credentials.');
} finally {
  await Promise.allSettled(names.map(name => docker(['rm', '-f', name])));
  const remaining = await docker(['ps', '--all', ...names.flatMap(name => ['--filter', `name=^/${name}$`]), '--format', '{{.Names}}']);
  assert.equal(remaining.stdout.trim(), '', 'Native Claude peers remain; retain the private fixture until they stop.');
  await fs.rm(fixture, { recursive: true, force: true });
}
