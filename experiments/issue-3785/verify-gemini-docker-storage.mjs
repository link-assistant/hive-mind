#!/usr/bin/env node
// The existing Python TLS fixture supplies synthetic traffic and validates it.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';
import console from 'node:console';
import { Buffer } from 'node:buffer';

const { AbortSignal } = globalThis;

export async function verifyMountedGeminiStorage(options) {
  const { launcher, nativePackage, homeDir, canonical, history, workspace, certificate, managed, settings, env, firstPrompt, secondPrompt, image = 'node:24-bookworm-slim', network = 'host', experimental = false } = options;
  assert.match(network, /^(host|container:[a-zA-Z0-9][a-zA-Z0-9_.-]*)$/u);
  const executeFile = promisify(execFile);
  const execute = (command, args, executionOptions) => {
    const pending = executeFile(command, args, { ...executionOptions, detached: true });
    pending.child.stdin.end();
    return pending.finally(() => {
      if (pending.child.pid === undefined) return;
      try {
        process.kill(-pending.child.pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    });
  };
  const source = path.dirname(await fs.realpath(launcher));
  // The root image's executable layer is not a host-socket bind source.
  // Copy its installed runtime into the shared fixture and check every source
  // file before exposing that same production code read-only to native peers.
  const peerRuntime = path.join(path.dirname(homeDir), 'docker-runtime');
  // Both Codex platform binaries ship in release packages; this Gemini fixture
  // does not load them and must not duplicate/hash hundreds of unrelated MiB.
  const copiedSource = filename => filename !== 'native-codex/runtime' && !filename.startsWith('native-codex/runtime/');
  await fs.mkdir(peerRuntime, { mode: 0o700 });
  // A Bun global install hoists dependencies beside the package instead of
  // nesting node_modules. Copy exactly the packages Node resolves for the
  // peer's admission entry and keep their layout relative to a shared base.
  const packageRoot = path.dirname(source);
  const loaded = await execute(process.execPath, ['--max-old-space-size=128', '--input-type=module', '-e', 'import {registerHooks} from "node:module";const seen=new Set();registerHooks({resolve(s,c,n){const r=n(s,c);if(r.url.startsWith("file:"))seen.add(r.url);return r;}});await import(process.argv[1]);process.stdout.write(JSON.stringify([...seen]));', pathToFileURL(path.join(source, 'gemini-storage-admission.lib.mjs')).href], { cwd: packageRoot, maxBuffer: 262144, signal: AbortSignal.timeout(45_000), killSignal: 'SIGKILL' });
  const dependencies = new Set();
  for (const url of JSON.parse(loaded.stdout)) {
    const filename = fileURLToPath(url);
    if (!path.relative(source, filename).startsWith('..')) continue;
    const match = /^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)\//u.exec(filename);
    assert.ok(match, 'Peer admission loaded code outside the package and its dependencies.');
    dependencies.add(match[1]);
  }
  let base = packageRoot;
  for (const directory of dependencies) while (path.relative(base, directory).startsWith('..')) base = path.dirname(base);
  // Node only resolves packages inside a node_modules directory.
  const hoisted = base.split(path.sep).indexOf('node_modules');
  if (hoisted !== -1) base = base.split(path.sep).slice(0, hoisted).join(path.sep) || path.sep;
  const runtimeSource = path.join(peerRuntime, path.relative(base, source));
  await fs.cp(source, runtimeSource, { recursive: true, verbatimSymlinks: true, filter: filename => copiedSource(path.relative(source, filename)) });
  await fs.copyFile(path.join(packageRoot, 'package.json'), path.join(path.dirname(runtimeSource), 'package.json'));
  for (const directory of dependencies) await fs.cp(directory, path.join(peerRuntime, path.relative(base, directory)), { recursive: true, verbatimSymlinks: true });
  const peerSource = path.posix.join('/__hive_runtime', ...path.relative(base, source).split(path.sep));
  const digest = async filename =>
    createHash('sha256')
      .update(await fs.readFile(filename))
      .digest('hex');
  for (const filename of await fs.readdir(source, { recursive: true })) {
    if (!copiedSource(filename)) continue;
    const original = path.join(source, filename);
    const info = await fs.lstat(original);
    assert.ok(!info.isSymbolicLink(), 'Installed launcher source must not be symlinked.');
    if (info.isFile()) assert.equal(await digest(path.join(runtimeSource, filename)), await digest(original), 'Peer runtime changed installed launcher bytes.');
  }
  const { prepareDockerIsolationHostPaths, buildDockerIsolationStartArgs, resolveDockerIsolationMountSources } = await import(pathToFileURL(path.join(source, 'isolation-runner.lib.mjs')));
  const { admitNativeGeminiStorage } = await import(pathToFileURL(path.join(source, 'gemini-storage-admission.lib.mjs')));
  const nativeCommand = path.join(nativePackage, 'bundle/gemini.js');
  const dockerEnv = { PATH: process.env.PATH, DOCKER_HOST: 'unix:///var/run/docker.sock' };
  const docker = args => execute('docker', args, { env: dockerEnv, maxBuffer: 262144, signal: AbortSignal.timeout(45_000), killSignal: 'SIGKILL' });
  const names = Array.from({ length: 3 }, () => `hive-gemini-storage-${randomUUID()}`);
  await fs.writeFile(path.join(path.dirname(homeDir), 'docker-peers.json'), JSON.stringify(names), { mode: 0o600, flag: 'wx' });
  const selected = { ...dockerEnv, HOME: homeDir, GEMINI_CLI_HOME: homeDir, GEMINI_AUTH_HOME: canonical, GEMINI_HISTORY_HOME: history, HIVE_MIND_DOCKER_ISOLATION_IMAGE: image };
  const prepared = await prepareDockerIsolationHostPaths({ tool: 'gemini', homeDir, env: selected });
  const firstAdmission = await admitNativeGeminiStorage({ env, homeDir, command: nativeCommand });
  const rootEnv = { ...env, ...firstAdmission.env };
  const canonicalCredentials = path.join(canonical, 'oauth_creds.json');
  const initialCredential = JSON.parse(await fs.readFile(canonicalCredentials, 'utf8'));
  const credential = generation => ({ ...initialCredential, access_token: `synthetic-access-${generation}`, refresh_token: `synthetic-refresh-${generation}` });
  const publish = async generation => {
    await fs.writeFile(`${canonicalCredentials}.new`, JSON.stringify(credential(generation)), { mode: 0o600 });
    await fs.rename(`${canonicalCredentials}.new`, canonicalCredentials);
  };
  const nativeArgs = flags => ['--output-format', 'json', '--model', 'gemini-2.5-flash', '--skip-trust', ...flags];
  const rootInvoke = async flags => {
    const admitted = await admitNativeGeminiStorage({ env: rootEnv, homeDir, command: nativeCommand, expected: firstAdmission });
    return execute('prlimit', ['--data=2147483648', '--stack=16777216', '--core=0', '--', process.execPath, '--max-old-space-size=256', admitted.command, ...nativeArgs(flags)], { env: { ...rootEnv, ...admitted.env }, cwd: workspace, maxBuffer: 262144, signal: AbortSignal.timeout(45_000), killSignal: 'SIGKILL' });
  };
  const response = result => {
    if (process.env.HIVE_MOUNT_TEST_DIAGNOSTICS === '1') console.error(JSON.stringify({ phase: 'native-gemini-output', stdout: result.stdout.slice(0, 8192), stderr: result.stderr.slice(0, 8192) }));
    // Native JSON output is pretty printed and can follow startup warnings.
    const start = result.stdout.search(/^\{/mu);
    assert.notEqual(start, -1, 'The actual native CLI emitted no JSON result.');
    const completion = JSON.parse(result.stdout.slice(start, result.stdout.lastIndexOf('}') + 1));
    assert.ok(completion?.response.includes('SYNTHETIC-GEMINI-COMPLETE'), 'The actual native CLI did not complete its synthetic conversation.');
    assert.match(completion.session_id, /^[a-zA-Z0-9-]{8,128}$/u);
    return completion;
  };
  const childEnv = { ...env, HOME: '/home/box', GEMINI_CLI_HOME: '/home/box', NODE_EXTRA_CA_CERTS: '/__gemini_ca.pem', GEMINI_CLI_SYSTEM_SETTINGS_PATH: '/__gemini_managed.json', GEMINI_CLI_SYSTEM_DEFAULTS_PATH: '/__gemini_managed.json', XDG_CONFIG_HOME: '/home/box/.config', XDG_DATA_HOME: '/home/box/.local/share', XDG_CACHE_HOME: '/home/box/.cache' };
  if (process.env.HIVE_MOUNT_TEST_DIAGNOSTICS === '1') childEnv.GEMINI_HISTORY_DEBUG = '1';
  delete childEnv.GEMINI_AUTH_HOME;
  delete childEnv.GEMINI_HISTORY_HOME;
  const admissionCode = `import {admitNativeGeminiStorage} from ${JSON.stringify(`${peerSource}/gemini-storage-admission.lib.mjs`)};const a=await admitNativeGeminiStorage({command:"/__gemini_runtime/bundle/gemini.js"});process.stdout.write(a.command);`;
  const childScript = 'set -eu; mkdir -p -m 700 /home/box/.gemini; printf "%s" "$SYNTHETIC_GEMINI_SETTINGS" > /home/box/.gemini/settings.json; cd "$SYNTHETIC_GEMINI_WORKSPACE"; admitted=$(node --max-old-space-size=128 --input-type=module -e "$SYNTHETIC_GEMINI_ADMISSION"); exec node --max-old-space-size=256 "$admitted" "$@"';
  const childInvoke = (index, flags, overrides = {}) => docker(['exec', '-i', ...Object.entries({ ...childEnv, SYNTHETIC_GEMINI_SETTINGS: JSON.stringify(settings), SYNTHETIC_GEMINI_WORKSPACE: workspace, SYNTHETIC_GEMINI_ADMISSION: admissionCode, ...overrides }).flatMap(([key, value]) => ['--env', `${key}=${value}`]), names[index], 'sh', '-c', childScript, 'sh', ...nativeArgs(flags)]);
  const common = ['run', '--detach', '--pull', 'never', '--network', network, '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '64', ...(experimental ? ['--cgroup-parent', '/'] : ['--memory', '536870912']), '--ulimit', 'data=2147483648:2147483648', '--ulimit', 'stack=16777216:16777216', '--ulimit', 'core=0:0', '--user', `${process.getuid()}:${process.getgid()}`, '--tmpfs', '/tmp:rw,exec,size=33554432,mode=1777', '--tmpfs', `/home/box:rw,uid=${process.getuid()},gid=${process.getgid()},mode=700,size=33554432`, '--entrypoint', 'sh'];
  let resolved;
  try {
    const initial = response(await rootInvoke(['--prompt', firstPrompt]));
    const args = await buildDockerIsolationStartArgs('solve', [], {
      tool: 'gemini',
      homeDir,
      env: selected,
      nativeAuthIdentity: prepared.nativeAuthIdentity,
      sessionId: 'gemini-native-storage',
      resolveMountSources: async options => {
        const runtimeMounts = [
          { source: peerRuntime, target: '/__hive_runtime', readOnly: true },
          { source: nativePackage, target: '/__gemini_runtime', readOnly: true },
          { source: workspace, target: workspace, readOnly: true },
          { source: certificate, target: '/__gemini_ca.pem', readOnly: true },
          { source: managed, target: '/__gemini_managed.json', readOnly: true },
        ];
        if (process.env.HIVE_MOUNT_TEST_DIAGNOSTICS === '1') {
          for (const mount of [...options.mounts, ...runtimeMounts]) {
            const info = await fs.lstat(mount.source).catch(error => ({ code: error.code }));
            console.error(JSON.stringify({ phase: 'synthetic-mount-input', ...mount, type: info.isDirectory?.() ? 'directory' : info.isFile?.() ? 'file' : info.code || 'other' }));
          }
        }
        resolved = await resolveDockerIsolationMountSources({
          ...options,
          env: { ...options.env, HIVE_MIND_DOCKER_MOUNT_TRACE: process.env.HIVE_MOUNT_TEST_DIAGNOSTICS },
          mounts: [...options.mounts, ...runtimeMounts],
          run: async (...args) =>
            execute(...args).catch(error => {
              if (process.env.HIVE_MOUNT_TEST_DIAGNOSTICS === '1') console.error(String(error.stderr || error.message).slice(0, 8192));
              throw error;
            }),
        });
        return resolved;
      },
    });
    const flags = args.flatMap((arg, index) => (['--volume', '-e'].includes(arg) ? [arg, args[index + 1]] : []));
    for (const name of names.slice(0, 2)) await docker([...common, '--name', name, ...flags, image, '-c', 'exec sleep 240']);
    for (const name of names.slice(0, 2)) {
      for (const kind of ['auth', 'history']) {
        const info = (await docker(['exec', name, 'stat', '-c', '%d:%i', `/home/box/.hive-mind/canonical/gemini-${kind}`])).stdout.trim();
        assert.equal(info, prepared.nativeAuthIdentity.selection[kind].identity, 'Docker mounted a different admitted Gemini parent.');
      }
      await docker(['exec', name, 'sh', '-c', 'test ! -e /home/box/.gemini/settings.json; test ! -e /home/box/.gemini/oauth_creds.json']);
    }
    for (const index of [0, 1]) {
      for (const kind of ['AUTH', 'HISTORY']) await assert.rejects(childInvoke(index, ['--version'], { [`HIVE_MIND_GEMINI_${kind}_IDENTITY`]: '0:0' }), error => Number.isInteger(error.code) && error.stderr.includes('NATIVE_GEMINI_STORAGE_VIOLATION'));
    }
    const helper = path.join(nativePackage, 'bundle/hive-gemini-storage-identity.mjs');
    const helperBytes = await fs.readFile(helper);
    try {
      await fs.appendFile(helper, '\n// SYNTHETIC CHANGED HELPER\n');
      for (const index of [0, 1]) await assert.rejects(childInvoke(index, ['--version']), error => Number.isInteger(error.code) && error.stderr.includes('NATIVE_GEMINI_STORAGE_VIOLATION'));
    } finally {
      await fs.writeFile(helper, helperBytes);
    }
    // Bind the old file separately to retain the defect as a real negative control.
    const authMount = resolved.find(mount => mount.target === '/home/box/.hive-mind/canonical/gemini-auth');
    const runtimeFlags = resolved.filter(mount => !mount.target.startsWith('/home/box/.hive-mind/canonical/')).flatMap(mount => ['--volume', `${mount.source}:${mount.target}${mount.readOnly ? ':ro' : ''}`]);
    await docker([...common, '--name', names[2], ...runtimeFlags, '--tmpfs', `/__legacy_auth:rw,uid=${process.getuid()},gid=${process.getgid()},mode=700,size=1048576`, '--mount', `type=bind,source=${authMount.source}/oauth_creds.json,target=/__legacy_auth/oauth_creds.json,readonly`, '--env', 'GEMINI_AUTH_HOME=/__legacy_auth', image, '-c', 'exec sleep 240']);
    await childInvoke(2, ['--version']);
    await publish('G1');
    const retired = await docker(['exec', names[2], 'cat', '/__legacy_auth/oauth_creds.json']);
    assert.equal(JSON.parse(retired.stdout).access_token, 'synthetic-access-G0');
    await assert.rejects(childInvoke(2, ['--prompt', 'SYNTHETIC-LEGACY-MUST-NOT-INFER']), error => Number.isInteger(error.code) && error.stderr.includes('Selected native Gemini storage or command is unavailable or unsafe'));
    const firstPeerListing = await childInvoke(0, ['--list-sessions']);
    assert.ok(firstPeerListing.stdout.includes(initial.session_id));
    assert.equal(response(await childInvoke(0, ['--resume', initial.session_id, '--prompt', secondPrompt])).session_id, initial.session_id);
    await fs.rm(homeDir, { recursive: true });
    await fs.mkdir(homeDir, { mode: 0o700 });
    await fs.mkdir(path.join(homeDir, '.gemini'), { mode: 0o700 });
    await fs.writeFile(path.join(homeDir, '.gemini/settings.json'), JSON.stringify(settings), { mode: 0o600 });
    for (const name of names.slice(0, 2)) await docker(['exec', name, 'rm', '-rf', '/home/box/.gemini']);
    await publish('G2');
    const secondPeerListing = await childInvoke(1, ['--list-sessions']);
    assert.ok(secondPeerListing.stdout.includes(initial.session_id));
    assert.equal(response(await childInvoke(1, ['--resume', initial.session_id, '--prompt', secondPrompt])).session_id, initial.session_id);
    // External canonical removal and publication simulate operator logout/re-login.
    // Native refresh/logout writer semantics are covered by the separate native controls.
    await fs.unlink(canonicalCredentials);
    await assert.rejects(rootInvoke(['--prompt', 'SYNTHETIC-LOGOUT-MUST-NOT-INFER']), { code: 'NATIVE_GEMINI_STORAGE_VIOLATION' });
    for (const index of [0, 1]) await assert.rejects(childInvoke(index, ['--prompt', 'SYNTHETIC-LOGOUT-MUST-NOT-INFER']), error => Number.isInteger(error.code) && error.stderr.includes('Selected native Gemini storage or command is unavailable or unsafe'));
    await publish('G2');
    assert.equal(response(await rootInvoke(['--resume', initial.session_id, '--prompt', secondPrompt])).session_id, initial.session_id);
    for (const name of names.slice(0, 2)) await docker(['exec', name, 'sh', '-c', 'test ! -e /home/box/.gemini/oauth_creds.json; test ! -e /home/box/.gemini/google_accounts.json; test -z "$(find /home/box/.gemini -name "*.jsonl" -print -quit)"']);
    await assert.rejects(fs.lstat(path.join(homeDir, '.gemini/oauth_creds.json')), { code: 'ENOENT' });
    const records = await fs.readdir(history, { recursive: true });
    let transcript;
    for (const filename of records.filter(filename => filename.endsWith('.jsonl'))) {
      const text = await fs.readFile(path.join(history, filename), 'utf8');
      if (text.includes(firstPrompt) && text.includes(secondPrompt) && text.includes('SYNTHETIC-GEMINI-COMPLETE')) transcript = text;
    }
    assert.ok(transcript, 'The canonical transcript lost prior user/model content.');
    console.log('PASS: actual Gemini root and two live Docker peers retain independently bound auth/history parents, credential replacement, full native resume and private-home disposal; canonical removal refuses all three and re-publication recovers. The legacy file bind retains retired credentials and refuses inference.');
  } finally {
    await Promise.allSettled(names.map(name => docker(['rm', '-f', name])));
    const remaining = await docker(['ps', '--all', ...names.flatMap(name => ['--filter', `name=^/${name}$`]), '--format', '{{.Names}}']);
    assert.equal(remaining.stdout.trim(), '', 'Gemini Docker peers remain; retain the synthetic fixture.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    assert.ok(Buffer.byteLength(input) <= 262144);
  }
  await verifyMountedGeminiStorage(JSON.parse(input));
}
