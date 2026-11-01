#!/usr/bin/env node
// Issue #3785: actual pinned Claude CLI, production default-authority migration
// and Docker builders, and a strict synthetic rotating OAuth provider that
// accepts each refresh generation exactly once. Only synthetic credentials are
// used; the provider is loopback-only and never forwards traffic.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import tls from 'node:tls';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { prepareMountedNativeRuntime } from './mounted-native-runtime.lib.mjs';

const PINNED = '2.1.310 (Claude Code)';
const OAUTH_ORIGINS = new Set(['platform.claude.com:443', 'api.anthropic.com:443']);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Strict rotating provider: generation n's refresh token is accepted once and yields n + 1. */
export function createRotatingProvider({ key, cert }) {
  const state = { current: null, consumed: new Set(), revoked: new Set(), exchanges: [], duplicates: [], models: [], failures: [], hold: null, entered: null };
  const send = (response, status, value) => {
    const body = JSON.stringify(value);
    response.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Connection: 'close' });
    response.end(body);
  };
  const server = http.createServer(async (request, response) => {
    try {
      let text = '';
      for await (const chunk of request) {
        text += chunk;
        assert.ok(Buffer.byteLength(text) <= 262144);
      }
      const endpoint = request.url.split('?')[0];
      if (request.method === 'POST' && endpoint === '/v1/oauth/token' && request.socket.encrypted) {
        const payload = JSON.parse(text);
        assert.equal(payload.grant_type, 'refresh_token');
        const match = /^SYNTHETIC-REFRESH-G([0-9]{1,4})$/u.exec(payload.refresh_token);
        assert.ok(match, 'Unknown synthetic refresh generation.');
        const generation = Number(match[1]);
        state.exchanges.push(generation);
        if (state.consumed.has(generation) || generation !== state.current) {
          state.duplicates.push(generation);
          return send(response, 400, { error: 'invalid_grant', error_description: 'Synthetic refresh generation already consumed' });
        }
        state.consumed.add(generation);
        if (state.revoked.has(generation)) return send(response, 400, { error: 'invalid_grant', error_description: 'Synthetic refresh grant revoked' });
        state.entered?.();
        if (state.hold) await state.hold;
        state.current = generation + 1;
        return send(response, 200, { access_token: `SYNTHETIC-ACCESS-G${generation + 1}`, refresh_token: `SYNTHETIC-REFRESH-G${generation + 1}`, expires_in: 3600, scope: 'user:inference user:profile' });
      }
      if (request.method === 'POST' && endpoint === '/v1/messages' && !request.socket.encrypted) {
        const match = /^Bearer SYNTHETIC-ACCESS-G([0-9]{1,4})$/u.exec(request.headers.authorization || '');
        assert.ok(match, 'Model request without a synthetic access generation.');
        state.models.push(Number(match[1]));
        const message = { id: `synthetic-${state.models.length}`, type: 'message', role: 'assistant', content: [], model: 'synthetic-model', stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } };
        const events = [
          ['message_start', { type: 'message_start', message }],
          ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
          ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Synthetic response.' } }],
          ['content_block_stop', { type: 'content_block_stop', index: 0 }],
          ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }],
          ['message_stop', { type: 'message_stop' }],
        ];
        response.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'close' });
        return response.end(events.map(([kind, value]) => `event: ${kind}\ndata: ${JSON.stringify(value)}\n\n`).join(''));
      }
      send(response, 404, { error: 'Synthetic endpoint unavailable' });
    } catch {
      state.failures.push('Invalid synthetic request');
      if (!response.headersSent) send(response, 400, {});
    }
  });
  server.on('connect', (request, socket, head) => {
    if (!OAUTH_ORIGINS.has(request.url)) return socket.end('HTTP/1.1 502 Synthetic proxy refuses external origin\r\nConnection: close\r\n\r\n');
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head?.length) socket.unshift(head);
    const secure = new tls.TLSSocket(socket, { isServer: true, key, cert });
    secure.on('error', () => secure.destroy());
    server.emit('connection', secure);
  });
  server.on('clientError', (_error, socket) => socket.destroy());
  server.requestTimeout = 20000;
  server.headersTimeout = 20000;
  server.maxConnections = 32;
  /** Reset per scenario and publish the provider's expectation for generation `n`. */
  state.expect = (generation, { revoked = false } = {}) => {
    state.current = generation;
    state.exchanges = [];
    state.duplicates = [];
    state.models = [];
    if (revoked) state.revoked.add(generation);
  };
  /** Hold the first accepted exchange until released; resolves `entered` when it arrives. */
  state.pause = () => {
    let release;
    let entered;
    state.hold = new Promise(resolve => (release = resolve));
    const arrived = new Promise(resolve => (entered = resolve));
    state.entered = entered;
    return {
      arrived,
      release: () => {
        state.hold = null;
        state.entered = null;
        release();
      },
    };
  };
  return { server, state };
}

export async function verifyMountedClaudeRefresh({ launcher = fileURLToPath(new URL('../src/hive.mjs', import.meta.url)), nativeBinary, experimental = false, fixtureParent = process.env.HIVE_MOUNT_TEST_FIXTURE || '/mount-fixture', image = process.env.HIVE_MOUNT_TEST_IMAGE || 'node:24-alpine', network = process.env.HIVE_MOUNT_TEST_NETWORK || 'host', log = message => console.log(message) } = {}) {
  const exec = promisify(execFile);
  const execute = (command, args, options) => {
    const pending = exec(command, args, { ...options, detached: true });
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
  const settle = pending => pending.catch(error => (Number.isInteger(error.code) ? error : Promise.reject(new Error('Bounded native Claude process failed to complete.'))));
  const source = path.dirname(await fs.realpath(launcher));
  const { buildDockerIsolationStartArgs, prepareDockerIsolationHostPaths, resolveDockerIsolationMountSources } = await import(pathToFileURL(path.join(source, 'isolation-runner.lib.mjs')));
  const { ensureClaudeAuthAuthority, defaultClaudeAuthorityHome } = await import(pathToFileURL(path.join(source, 'claude-auth-authority.lib.mjs')));
  const { getClaudeUsageLimits } = await import(pathToFileURL(path.join(source, 'limits.lib.mjs')));
  const binary = await fs.realpath(nativeBinary || (await execute('sh', ['-c', 'command -v claude'], { env: { PATH: process.env.PATH }, maxBuffer: 4096, signal: AbortSignal.timeout(5000) })).stdout.trim());
  assert.match(network, /^(host|container:[a-zA-Z0-9][a-zA-Z0-9_.-]*)$/u);
  const root = await fs.mkdtemp(path.join(fixtureParent, 'claude-docker-refresh-'));
  const homeDir = path.join(root, 'operator');
  const configHome = path.join(homeDir, '.claude');
  const workspace = path.join(root, 'workspace');
  const runtime = path.join(root, 'runtime');
  const tlsDirectory = path.join(root, 'tls');
  const caDirectory = path.join(root, 'ca');
  const names = { shared: [0, 1].map(() => `hive-claude-refresh-${randomUUID()}`), file: [0, 1].map(() => `hive-claude-refresh-file-${randomUUID()}`) };
  const all = [...names.shared, ...names.file];
  const dockerEnv = { PATH: process.env.PATH, DOCKER_HOST: 'unix:///var/run/docker.sock' };
  const docker = args => execute('docker', args, { env: dockerEnv, maxBuffer: 262144, signal: AbortSignal.timeout(40_000), killSignal: 'SIGKILL' });
  const settings = JSON.stringify({ hasCompletedOnboarding: true, numStartups: 3, oauthAccount: { accountUuid: 'synthetic-account', emailAddress: 'synthetic@example.invalid' } });
  const credential = (generation, expired) => JSON.stringify({ claudeAiOauth: { accessToken: `SYNTHETIC-ACCESS-G${generation}`, refreshToken: `SYNTHETIC-REFRESH-G${generation}`, expiresAt: Date.now() + (expired ? -60000 : 3600000), scopes: ['user:inference', 'user:profile'], subscriptionType: 'max', rateLimitTier: 'default_claude_max_5x' } });
  let provider;
  let server;
  try {
    for (const directory of [root, homeDir, configHome, workspace, runtime, tlsDirectory, caDirectory]) await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await execute('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=platform.claude.com', '-addext', 'subjectAltName=DNS:platform.claude.com,DNS:api.anthropic.com', '-keyout', path.join(tlsDirectory, 'key.pem'), '-out', path.join(tlsDirectory, 'ca.pem')], { env: { PATH: process.env.PATH }, maxBuffer: 65536, signal: AbortSignal.timeout(30_000) });
    const [key, cert] = await Promise.all([fs.readFile(path.join(tlsDirectory, 'key.pem')), fs.readFile(path.join(tlsDirectory, 'ca.pem'))]);
    // Peers receive only the certificate, never its private key.
    await fs.writeFile(path.join(caDirectory, 'ca.pem'), cert, { mode: 0o600 });
    ({ server, state: provider } = createRotatingProvider({ key, cert }));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const proxy = `http://127.0.0.1:${server.address().port}`;
    const traffic = { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1', MAX_RETRIES: '0', ANTHROPIC_BASE_URL: proxy, HTTP_PROXY: proxy, HTTPS_PROXY: proxy, ALL_PROXY: proxy, http_proxy: proxy, https_proxy: proxy, all_proxy: proxy, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };

    // An existing deployment: credentials in the conventional location, no selector, no new flag.
    await fs.writeFile(path.join(configHome, '.credentials.json'), credential(0, true), { mode: 0o600 });
    await fs.writeFile(path.join(homeDir, '.claude.json'), settings, { mode: 0o600 });
    await fs.writeFile(path.join(configHome, 'settings.json'), '{"env":{"SYNTHETIC_OPERATOR_ONLY":"retained"}}', { mode: 0o600 });
    const selected = { ...dockerEnv, HIVE_MIND_DOCKER_ISOLATION_IMAGE: image };
    const prepared = await prepareDockerIsolationHostPaths({ tool: 'claude', homeDir, env: selected });
    const authority = defaultClaudeAuthorityHome({}, homeDir);
    const auth = path.join(authority, '.credentials.json');
    assert.equal(selected.CLAUDE_SECURESTORAGE_CONFIG_DIR, authority, 'Default preparation must select the shared authority.');
    await assert.rejects(fs.lstat(path.join(configHome, '.credentials.json')), { code: 'ENOENT' }, 'The conventional copy must be migrated, not duplicated.');
    assert.ok(prepared.nativeAuthIdentity, 'The default authority must carry an admitted identity.');
    // The direct (root) launch path admits the same authority without establishing a new one.
    const rootEnv = { PATH: process.env.PATH, HOME: homeDir, ...traffic, NODE_EXTRA_CA_CERTS: path.join(caDirectory, 'ca.pem') };
    const admitted = await ensureClaudeAuthAuthority({ env: rootEnv, homeDir });
    assert.equal(admitted.mode, 'shared');
    assert.equal(rootEnv.CLAUDE_SECURESTORAGE_CONFIG_DIR, authority);
    const version = (await execute(binary, ['--version'], { env: rootEnv, maxBuffer: 4096, signal: AbortSignal.timeout(15_000) })).stdout.trim();
    if (!experimental) assert.equal(version, PINNED, 'Installed Claude differs from the pinned runtime.');

    const command = await prepareMountedNativeRuntime(binary, runtime, 'claude');
    let runtimeMount;
    let caMount;
    const args = await buildDockerIsolationStartArgs('solve', [], {
      tool: 'claude',
      homeDir,
      env: selected,
      nativeAuthIdentity: prepared.nativeAuthIdentity,
      sessionId: 'claude-native-refresh',
      resolveMountSources: async options => {
        const resolved = await resolveDockerIsolationMountSources({ ...options, mounts: [...options.mounts, { source: runtime, target: '/__native_runtime', readOnly: true }, { source: caDirectory, target: '/__synthetic_ca', readOnly: true }, { source: workspace, target: workspace, readOnly: true }] });
        runtimeMount = resolved.find(mount => mount.target === '/__native_runtime');
        caMount = resolved.find(mount => mount.target === '/__synthetic_ca');
        return resolved;
      },
    });
    const flags = args.flatMap((arg, index) => (['--volume', '-e'].includes(arg) ? [arg, args[index + 1]] : []));
    const parentVolume = flags.find((arg, index) => flags[index - 1] === '--volume' && arg.endsWith(':/home/box/.hive-mind/canonical/claude-authority'));
    assert.ok(parentVolume, 'The production builder must share the lock-bearing credential parent.');
    assert.ok(!flags.some((arg, index) => flags[index - 1] === '--volume' && arg.includes('.credentials.json')), 'The default projection must not bind the credential file alone.');
    const daemonAuthority = `${parentVolume.slice(0, parentVolume.indexOf(':'))}/claude`;
    const common = ['run', '--detach', '--pull', 'never', '--network', network, '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '64', ...(experimental ? ['--cgroup-parent', '/'] : ['--memory', '402653184']), '--ulimit', 'data=1610612736:1610612736', '--ulimit', 'stack=16777216:16777216', '--ulimit', 'core=0:0', '--user', `${process.getuid()}:${process.getgid()}`, '--tmpfs', '/tmp:rw,exec,size=33554432,mode=1777', '--tmpfs', `/home/box:rw,uid=${process.getuid()},gid=${process.getgid()},mode=700,size=16777216`, '--tmpfs', `/home/box/.claude:rw,uid=${process.getuid()},gid=${process.getgid()},mode=700,size=16777216`, '--entrypoint', 'sh'];
    for (const name of names.shared) await docker([...common, '--name', name, ...flags, image, '-c', 'exec sleep 600']);
    for (const name of names.shared) assert.equal((await docker(['exec', name, 'sh', '-c', 'stat -c %d:%i "$CLAUDE_SECURESTORAGE_CONFIG_DIR"'])).stdout.trim(), prepared.nativeAuthIdentity, 'Peers must see the admitted authority directory.');
    // Negative control: the legacy file-only bind shares bytes but not the refresh locks.
    const fileOnly = ['--tmpfs', `/__legacy_auth:rw,uid=${process.getuid()},gid=${process.getgid()},mode=700,size=1048576`, '--mount', `type=bind,source=${daemonAuthority}/.credentials.json,target=/__legacy_auth/.credentials.json`, '--mount', `type=bind,source=${runtimeMount.source},target=/__native_runtime,readonly`, '--mount', `type=bind,source=${caMount.source},target=/__synthetic_ca,readonly`, '--env', 'CLAUDE_SECURESTORAGE_CONFIG_DIR=/__legacy_auth'];

    const peerEnv = { HOME: '/home/box', CLAUDE_CONFIG_DIR: '/home/box/.claude', ...traffic, NODE_EXTRA_CA_CERTS: '/__synthetic_ca/ca.pem' };
    const nativeArgs = label => ['-p', `SYNTHETIC-REFRESH-${label}-3785`, '--output-format', 'json', '--max-turns', '1', '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'];
    const invoke = (side, argv) => {
      if (side === 'root') return settle(execute('prlimit', ['--data=1610612736', '--stack=16777216', '--core=0', '--', binary, ...argv], { env: rootEnv, cwd: workspace, maxBuffer: 262144, signal: AbortSignal.timeout(35_000), killSignal: 'SIGKILL' }));
      const script = `printf '%s' "$SYNTHETIC_ONBOARDING" > /home/box/.claude/.claude.json; cd "$SYNTHETIC_WORKSPACE"; exec ${command} "$@"`;
      return settle(docker(['exec', '-i', ...Object.entries({ ...peerEnv, SYNTHETIC_ONBOARDING: settings, SYNTHETIC_WORKSPACE: workspace }).flatMap(([name, value]) => ['--env', `${name}=${value}`]), side, 'sh', '-c', script, 'sh', ...argv]));
    };
    const loggedIn = async side => JSON.parse((await invoke(side, ['auth', 'status', '--json'])).stdout).loggedIn;
    const publish = async (generation, expired) => {
      await fs.writeFile(`${auth}.next`, credential(generation, expired), { mode: 0o600 });
      await fs.rename(`${auth}.next`, auth);
    };
    const stored = async () => JSON.parse(await fs.readFile(auth, 'utf8')).claudeAiOauth;
    const diagnose = (phase, outputs = []) => {
      if (process.env.HIVE_MOUNT_TEST_DIAGNOSTICS !== '1') return;
      // Synthetic generations and bounded native output only; no real credentials exist here.
      console.error(JSON.stringify({ phase, exchanges: provider.exchanges, duplicates: provider.duplicates, models: provider.models, outputs: outputs.map(output => `${output?.stdout || ''}${output?.stderr || ''}`.slice(0, 2048)) }));
    };
    const [peer0, peer1] = names.shared;
    const results = [];

    // A. Positive control: root and two Docker peers refresh one expired generation concurrently.
    await publish(0, true);
    provider.expect(0);
    let gate = provider.pause();
    let pending = ['root', peer0, peer1].map(side => invoke(side, nativeArgs('SHARED')));
    await Promise.race([gate.arrived, sleep(20_000)]);
    // Give every peer time to reach its own refresh decision while the owner's exchange is outstanding.
    await sleep(6000);
    gate.release();
    diagnose('shared', await Promise.all(pending));
    assert.deepEqual(provider.exchanges, [0], 'Shared-parent peers must exchange each generation exactly once.');
    assert.deepEqual(provider.models, [1, 1, 1], 'All three processes must use the single rotated generation.');
    assert.equal((await stored()).refreshToken, 'SYNTHETIC-REFRESH-G1');
    results.push('shared-parent: 1 exchange, 3 model requests');

    // B. Negative control: the same timing with file-only binds duplicates the exchange.
    // Publish first: a file bind pins the inode current at container creation.
    await publish(10, true);
    for (const name of names.file) await docker([...common, '--name', name, ...fileOnly, image, '-c', 'exec sleep 600']);
    provider.expect(10);
    gate = provider.pause();
    pending = ['root', ...names.file].map(side => invoke(side, nativeArgs('FILE-ONLY')));
    await Promise.race([gate.arrived, sleep(20_000)]);
    await sleep(6000);
    gate.release();
    diagnose('file-only', await Promise.all(pending));
    assert.ok(provider.duplicates.length >= 1, 'The file-only control must reproduce an uncoordinated duplicate exchange.');
    results.push(`file-only control: ${provider.exchanges.length} exchanges, ${provider.duplicates.length} rejected duplicates`);
    for (const name of names.file) await docker(['rm', '-f', name]);

    // C. A newer login published during a pending refresh is preserved and used.
    await publish(20, true);
    provider.expect(20);
    gate = provider.pause();
    const owner = invoke(peer0, nativeArgs('REPLACED-OWNER'));
    await Promise.race([gate.arrived, sleep(20_000)]);
    assert.deepEqual(provider.exchanges, [20], 'The Docker owner must enter refresh.');
    const waiters = ['root', peer1].map(side => invoke(side, nativeArgs('REPLACED-WAITER')));
    await sleep(3000);
    await publish(30, false);
    gate.release();
    await Promise.all([owner, ...waiters]);
    assert.equal((await stored()).refreshToken, 'SYNTHETIC-REFRESH-G30', 'A late refresh response must not replace a newer login.');
    assert.deepEqual(provider.exchanges, [20]);
    assert.ok(provider.models.length >= 2 && provider.models.every(generation => generation === 30), 'Waiters must execute with the newer login only.');
    results.push(`newer login: preserved, ${provider.models.length} model requests on it`);

    // D. Logout during a pending refresh is not undone; a new login is then shared by every peer.
    await publish(40, true);
    provider.expect(40);
    gate = provider.pause();
    const loggingOut = invoke(peer0, nativeArgs('LOGOUT-OWNER'));
    await Promise.race([gate.arrived, sleep(20_000)]);
    const blocked = ['root', peer1].map(side => invoke(side, nativeArgs('LOGOUT-WAITER')));
    await sleep(3000);
    await fs.unlink(auth);
    gate.release();
    await Promise.all([loggingOut, ...blocked]);
    await assert.rejects(fs.lstat(auth), { code: 'ENOENT' }, 'A pending refresh must not recreate logged-out credentials.');
    assert.deepEqual(provider.models, [], 'No process may execute after logout.');
    for (const side of ['root', peer0, peer1]) assert.equal(await loggedIn(side), false);
    await publish(50, false);
    provider.expect(50);
    for (const side of ['root', peer0, peer1]) assert.equal(await loggedIn(side), true, 'Re-login must reach every peer without restarting it.');
    await invoke(peer1, nativeArgs('RELOGIN'));
    assert.deepEqual(provider.models, [50]);
    results.push('logout/re-login: not resurrected, re-login visible to root and both peers');

    // E. A rejected (revoked) refresh is exchanged once and leaves every process requiring re-auth.
    await publish(60, true);
    provider.expect(60, { revoked: true });
    await Promise.all(['root', peer0, peer1].map(side => invoke(side, nativeArgs('REVOKED'))));
    assert.deepEqual(provider.models, [], 'A rejected refresh must not execute with stale credentials.');
    assert.ok(provider.exchanges.filter(generation => generation === 60).length >= 1);
    assert.deepEqual(
      provider.duplicates.filter(generation => generation !== 60),
      []
    );
    const after = await fs.readFile(auth, 'utf8').then(
      text => JSON.parse(text).claudeAiOauth,
      () => null
    );
    assert.ok(!after?.refreshToken || after.refreshToken === 'SYNTHETIC-REFRESH-G60', 'A rejected refresh must not invent credentials.');
    for (const side of ['root', peer0, peer1]) assert.equal(await loggedIn(side), false, 'An unrefreshable grant must require re-authentication everywhere.');
    const limits = await getClaudeUsageLimits(false, auth);
    assert.equal(limits.success, false);
    assert.equal(limits.failureKind, 'auth', '/limits must classify the cleared authority as re-authentication required.');
    results.push(`revoked: ${provider.exchanges.length} exchange attempt(s), 0 model requests, stored refresh ${after?.refreshToken ? 'retained' : 'cleared'}, re-authentication required by native status and /limits`);

    assert.deepEqual(provider.failures, []);
    assert.equal(await fs.readFile(path.join(configHome, 'settings.json'), 'utf8'), '{"env":{"SYNTHETIC_OPERATOR_ONLY":"retained"}}', 'Private configuration must stay untouched.');
    await assert.rejects(fs.lstat(path.join(configHome, '.credentials.json')), { code: 'ENOENT' }, 'No private credential copy may reappear.');
    log(`PASS: default Claude authority (migrated, no new flags) with ${experimental ? version : 'pinned'} native root and two Docker peers; ${results.join('; ')}.`);
  } finally {
    let remaining;
    try {
      await Promise.allSettled(all.map(name => docker(['rm', '-f', name])));
      remaining = await docker(['ps', '--all', ...all.flatMap(name => ['--filter', `name=^/${name}$`]), '--format', '{{.Names}}']);
    } finally {
      if (server) {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
      }
    }
    assert.equal(remaining.stdout.trim(), '', 'Native refresh peers remain; retain the fixture.');
    await fs.rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await verifyMountedClaudeRefresh({ launcher: process.argv[2], nativeBinary: process.argv[3], experimental: Boolean(process.argv[3]) });
}
