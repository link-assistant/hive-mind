// Actual installed CLI plus production mount builders, inside each root image.
// The optional experimental binary is for bounded local reproduction only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const entry = await fs.realpath(process.argv[2]);
const source = path.dirname(entry);
const { buildDockerIsolationStartArgs, prepareDockerIsolationHostPaths, resolveDockerIsolationMountSources } = await import(pathToFileURL(path.join(source, 'isolation-runner.lib.mjs')));
const { verifyNativeCodexCommand } = await import(pathToFileURL(path.join(source, 'native-codex-command.lib.mjs')));
const image = process.env.HIVE_MOUNT_TEST_IMAGE;
const parentFixture = process.env.HIVE_MOUNT_TEST_FIXTURE || '/mount-fixture';
assert.ok(image, 'Supply the daemon-local Node fixture image.');
const experimental = process.argv[3];
const native = experimental ? { entrypoint: await fs.realpath(experimental) } : await verifyNativeCodexCommand();
const fixture = await fs.mkdtemp(path.join(parentFixture, 'codex-auth-'));
const canonical = path.join(fixture, 'canonical');
const homeDir = path.join(fixture, 'operator');
const rootConfig = path.join(fixture, 'root-config');
const runtime = path.join(fixture, 'runtime');
const names = Array.from({ length: 3 }, () => `hive-codex-auth-${randomUUID()}`);
const baseEnv = { PATH: process.env.PATH, DOCKER_HOST: 'unix:///var/run/docker.sock', HIVE_MIND_DOCKER_ISOLATION_IMAGE: image };
const docker = args => execute('docker', args, { env: baseEnv, maxBuffer: 262144, signal: AbortSignal.timeout(30_000) });
const digest = async filename => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename, { highWaterMark: 65536 })) hash.update(chunk);
  return hash.digest('hex');
};
const key = generation => `sk-SYNTHETIC-PARENT-AUTH-${generation}`;
const auth = path.join(canonical, 'auth.json');
const publish = async (generation, atomic = true) => {
  const filename = atomic ? `${auth}.new` : auth;
  await fs.writeFile(filename, JSON.stringify({ OPENAI_API_KEY: key(generation) }), { mode: 0o600 });
  if (atomic) await fs.rename(filename, auth);
};
let rootEnv;
let command;
let runtimeMount;

async function invoke(side, args, input = '') {
  let pending;
  if (side === 'root') {
    if (!experimental) await verifyNativeCodexCommand();
    pending = execute('prlimit', ['--data=536870912', '--stack=16777216', '--core=0', '--', native.entrypoint, ...args], { env: rootEnv, cwd: homeDir, maxBuffer: 262144, signal: AbortSignal.timeout(15_000), killSignal: 'SIGKILL' });
  } else {
    const index = Number(side);
    const configure = `mkdir -p -m 700 "$CODEX_HOME"; exec ${command} "$@"`;
    pending = execute('docker', ['exec', '-i', '--env', `CODEX_HOME=/tmp/codex-config-${index}`, names[index], 'sh', '-c', configure, 'sh', ...args], { env: baseEnv, maxBuffer: 262144, signal: AbortSignal.timeout(20_000) });
  }
  pending.child.stdin.end(input);
  return pending
    .then(result => ({ ...result, code: 0 }))
    .catch(error => {
      if (Number.isInteger(error.code)) return { code: error.code, stdout: error.stdout, stderr: error.stderr };
      if (process.env.CODEX_PROBE_DIAGNOSTICS === '1') console.error(JSON.stringify({ side, code: error.code, signal: error.signal, killed: error.killed, aborted: error.name === 'AbortError' }));
      throw new Error('Bounded native authentication process failed to complete.');
    });
}

async function status(side, generation) {
  const result = await invoke(side, ['login', 'status']);
  if (process.env.CODEX_PROBE_DIAGNOSTICS === '1') console.error(JSON.stringify({ side, generation, code: result.code, output: `${result.stdout}${result.stderr}`.replace(/sk-[^\s"']+/gu, '<synthetic-key>').slice(0, 2048) }));
  assert.equal(result.code === 0, generation !== null, 'Native status selected the wrong authentication state.');
  if (generation !== null) assert.ok(result.stderr.includes(`***${generation}`), 'Native status read a different credential generation.');
}

async function peers(generation) {
  const results = await Promise.allSettled(['root', 0, 1].map(side => status(side, generation)));
  for (const result of results) if (result.status === 'rejected') throw result.reason;
}

try {
  for (const directory of [canonical, homeDir, rootConfig, runtime]) await fs.mkdir(directory, { mode: 0o700 });
  await fs.mkdir(path.join(runtime, 'lib'), { mode: 0o700 });
  const nativeHash = await digest(native.entrypoint);
  await fs.copyFile(native.entrypoint, path.join(runtime, 'codex'));
  await fs.chmod(path.join(runtime, 'codex'), 0o700);
  assert.equal(await digest(path.join(runtime, 'codex')), nativeHash);
  // Use the exact root-image loader and shared libraries with the admitted
  // binary in the small offline peer image; no second CLI installation occurs.
  const { stdout } = await execute('ldd', [native.entrypoint], { maxBuffer: 65536 });
  const libraries = [...new Set([...stdout.matchAll(/(?:=>\s*)?(\/(?:usr\/)?lib[^\s]*)\s+\(0x[0-9a-f]+\)/gu)].map(match => match[1]))];
  const loader = libraries.find(filename => /^ld-linux[^/]*\.so\./u.test(path.basename(filename)));
  assert.ok(loader && libraries.length < 32, 'Native runtime dependencies are incomplete.');
  const basenames = new Set();
  for (const filename of libraries) {
    const basename = path.basename(filename);
    assert.ok(!basenames.has(basename), 'Ambiguous native runtime dependency.');
    basenames.add(basename);
    await fs.copyFile(filename, path.join(runtime, 'lib', basename));
    await fs.chmod(path.join(runtime, 'lib', basename), 0o500);
  }
  command = `/__native_runtime/lib/${path.basename(loader)} --library-path /__native_runtime/lib /__native_runtime/codex`;
  await publish('G0000');
  const selectedEnv = { ...baseEnv, CODEX_AUTH_HOME: canonical };
  const prepared = await prepareDockerIsolationHostPaths({ tool: 'codex', homeDir, env: selectedEnv });
  rootEnv = { PATH: process.env.PATH, HOME: homeDir, CODEX_HOME: rootConfig, CODEX_AUTH_HOME: canonical, HIVE_MIND_CODEX_AUTH_IDENTITY: prepared.nativeAuthIdentity, RUST_LOG: 'off', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1' };
  const args = await buildDockerIsolationStartArgs('solve', [], {
    tool: 'codex',
    homeDir,
    env: selectedEnv,
    nativeAuthIdentity: prepared.nativeAuthIdentity,
    sessionId: 'native-codex-auth-gate',
    resolveMountSources: async options => {
      const resolved = await resolveDockerIsolationMountSources({ ...options, mounts: [...options.mounts, { source: runtime, target: '/__native_runtime', readOnly: true }] });
      runtimeMount = resolved.find(mount => mount.target === '/__native_runtime');
      return resolved;
    },
  });
  const flags = args.flatMap((arg, index) => (['--volume', '-e'].includes(arg) ? [arg, args[index + 1]] : []));
  const common = ['run', '--detach', '--pull', 'never', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '32', '--ulimit', 'data=536870912:536870912', '--ulimit', 'stack=16777216:16777216', '--ulimit', 'core=0:0', '--user', `${process.getuid()}:${process.getgid()}`, '--tmpfs', '/tmp:rw,exec,size=33554432,mode=1777', '--entrypoint', 'sh'];
  // This workspace's delegated cgroup is threaded. Experimental peers still
  // use a finite 512 MiB data limit; this delegated hierarchy has no memory
  // domain for a per-container controller. Release image peers use both bounds.
  if (experimental) common.push('--cgroup-parent', '/');
  else common.push('--memory', '134217728');
  for (const name of names.slice(0, 2)) await docker([...common, '--name', name, ...flags, image, '-c', 'exec sleep 240']);
  for (const name of names.slice(0, 2)) assert.equal((await docker(['exec', name, 'stat', '-c', '%d:%i', '/home/box/.hive-mind/canonical/codex-auth'])).stdout.trim(), prepared.nativeAuthIdentity, 'Docker mounted a different admitted authentication directory.');
  const authVolume = flags.find((arg, index) => flags[index - 1] === '--volume' && arg.endsWith(':/home/box/.hive-mind/canonical/codex-auth'));
  assert.ok(authVolume, 'The production builder omitted the canonical parent.');
  const daemonAuth = authVolume.slice(0, authVolume.indexOf(':'));
  // Preserve the old single-file bind as a real native negative control.
  await docker([...common, '--name', names[2], '--tmpfs', `/__legacy_auth:rw,uid=${process.getuid()},gid=${process.getgid()},mode=700,size=1048576`, '--mount', `type=bind,source=${daemonAuth}/auth.json,target=/__legacy_auth/auth.json,readonly`, '--mount', `type=bind,source=${runtimeMount.source},target=/__native_runtime,readonly`, '--env', 'CODEX_AUTH_HOME=/__legacy_auth', '--env', 'RUST_LOG=off', image, '-c', 'exec sleep 240']);
  await peers('G0000');
  await status(2, 'G0000');
  await publish('G0001');
  await peers('G0001');
  assert.equal(JSON.parse((await docker(['exec', names[2], 'cat', '/__legacy_auth/auth.json'])).stdout).OPENAI_API_KEY, key('G0000'));
  // The adapter refuses the unlinked predecessor (nlink=0). Its retained bytes
  // prove the file bind has lost the authority, even though it fails closed.
  await status(2, null);
  assert.equal((await invoke(0, ['logout'])).code, 0);
  await peers(null);
  await status(2, null);
  assert.equal((await invoke(1, ['login', '--with-api-key'], `${key('G0002')}\n`)).code, 0);
  await peers('G0002');
  assert.equal((await invoke('root', ['logout'])).code, 0);
  await peers(null);
  assert.equal((await invoke('root', ['login', '--with-api-key'], `${key('G0003')}\n`)).code, 0);
  await peers('G0003');
  await publish('G0004', false);
  await peers('G0004');
  for (const [index, name] of names.slice(0, 2).entries()) await docker(['exec', name, 'rm', '-rf', `/tmp/codex-config-${index}`]);
  await fs.rm(rootConfig, { recursive: true });
  await fs.mkdir(rootConfig, { mode: 0o700 });
  await peers('G0004');
  await assert.rejects(fs.lstat(path.join(homeDir, '.codex/auth.json')), { code: 'ENOENT' });
  assert.ok(JSON.parse(await fs.readFile(auth, 'utf8')).OPENAI_API_KEY === key('G0004'));
  console.log('PASS: actual native Codex root and two Docker peers retain parent-backed replacement, task/root logout, reauthentication and private-home disposal; the file-bind control retains retired bytes and refuses authentication.');
} finally {
  await Promise.allSettled(names.map(name => docker(['rm', '-f', name])));
  const remaining = await docker(['ps', '--all', ...names.flatMap(name => ['--filter', `name=^/${name}$`]), '--format', '{{.Names}}']);
  assert.equal(remaining.stdout.trim(), '', 'Native Docker peers remain; retain the private fixture until they stop.');
  await fs.rm(fixture, { recursive: true, force: true });
}
