#!/usr/bin/env node
// Actual pinned CLI, production mount builders, synthetic loopback-only provider.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { prepareMountedNativeRuntime } from './mounted-native-runtime.lib.mjs';

export async function verifyMountedClaudeHistory({ launcher = fileURLToPath(new URL('../src/hive.mjs', import.meta.url)), nativeBinary, legacy = false, experimental = false, fixtureParent = process.env.HIVE_MOUNT_TEST_FIXTURE || '/mount-fixture', image = process.env.HIVE_MOUNT_TEST_IMAGE || 'node:24-alpine', network = process.env.HIVE_MOUNT_TEST_NETWORK || 'host' } = {}) {
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
  const source = path.dirname(await fs.realpath(launcher));
  const { buildDockerIsolationStartArgs, prepareDockerIsolationHostPaths, resolveDockerIsolationMountSources } = await import(pathToFileURL(path.join(source, 'isolation-runner.lib.mjs')));
  const binary = await fs.realpath(nativeBinary || (await execute('sh', ['-c', 'command -v claude'], { env: { PATH: process.env.PATH }, maxBuffer: 4096, signal: AbortSignal.timeout(5000) })).stdout.trim());
  assert.match(network, /^(host|container:[a-zA-Z0-9][a-zA-Z0-9_.-]*)$/u);
  const root = await fs.mkdtemp(path.join(fixtureParent, 'claude-docker-history-'));
  const homeDir = path.join(root, 'operator');
  const configuration = path.join(root, 'selected-config');
  const canonical = path.join(root, 'credentials');
  const workspace = path.join(root, 'workspace');
  const runtime = path.join(root, 'runtime');
  const names = Array.from({ length: 2 }, () => `hive-claude-history-${randomUUID()}`);
  const dockerEnv = { PATH: process.env.PATH, DOCKER_HOST: 'unix:///var/run/docker.sock' };
  const docker = args => execute('docker', args, { env: dockerEnv, maxBuffer: 262144, signal: AbortSignal.timeout(30_000), killSignal: 'SIGKILL' });
  const firstPrompt = 'SYNTHETIC-DOCKER-HISTORY-FIRST-3785';
  const modelRequests = [];
  const failures = [];
  const settings = JSON.stringify({ hasCompletedOnboarding: true, numStartups: 3, oauthAccount: { accountUuid: 'synthetic-account', emailAddress: 'synthetic@example.invalid' } });
  const server = http.createServer(async (request, response) => {
    try {
      let text = '';
      for await (const chunk of request) {
        text += chunk;
        assert.ok(Buffer.byteLength(text) <= 262144);
      }
      if (request.method !== 'POST' || request.url.split('?')[0] !== '/v1/messages') {
        response.writeHead(404).end('{}');
        return;
      }
      assert.equal(request.headers.authorization, 'Bearer SYNTHETIC-ACCESS-G0');
      const payload = JSON.parse(text);
      modelRequests.push(payload);
      assert.ok(modelRequests.length <= 3);
      assert.ok(JSON.stringify(payload).includes(firstPrompt), 'Native resume lost the original message.');
      const message = { id: `synthetic-${modelRequests.length}`, type: 'message', role: 'assistant', content: [], model: 'synthetic-model', stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } };
      const events = [
        ['message_start', { type: 'message_start', message }],
        ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
        ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Synthetic response.' } }],
        ['content_block_stop', { type: 'content_block_stop', index: 0 }],
        ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }],
        ['message_stop', { type: 'message_stop' }],
      ];
      response.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'close' });
      response.end(events.map(([kind, value]) => `event: ${kind}\ndata: ${JSON.stringify(value)}\n\n`).join(''));
    } catch {
      failures.push('Invalid synthetic model request');
      response.writeHead(400).end('{}');
    }
  });
  server.on('connect', (_request, socket) => socket.end('HTTP/1.1 502 Synthetic proxy refuses external origin\r\nConnection: close\r\n\r\n'));
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.timeout = 5000;
  server.maxConnections = 8;

  function nativeResult(result) {
    if (process.env.HIVE_MOUNT_TEST_DIAGNOSTICS === '1') console.error(JSON.stringify({ phase: 'native-history-output', stdout: result.stdout.slice(0, 8192), stderr: result.stderr.slice(0, 8192) }));
    const values = result.stdout.split('\n').flatMap(line => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
    return values.find(value => value.type === 'result');
  }

  try {
    for (const directory of [homeDir, configuration, canonical, workspace, runtime]) await fs.mkdir(directory, { mode: 0o700 });
    await fs.mkdir(path.join(homeDir, '.claude'), { mode: 0o700 });
    const credential = JSON.stringify({ claudeAiOauth: { accessToken: 'SYNTHETIC-ACCESS-G0', refreshToken: 'SYNTHETIC-REFRESH-G0', expiresAt: Date.now() + 3600000, scopes: ['user:inference', 'user:profile'], subscriptionType: 'max', rateLimitTier: 'default_claude_max_5x' } });
    const auth = path.join(canonical, '.credentials.json');
    await fs.writeFile(auth, credential, { mode: 0o600 });
    const authBefore = await fs.stat(auth);
    for (const filename of [path.join(homeDir, '.claude.json'), path.join(configuration, '.claude.json')]) await fs.writeFile(filename, settings, { mode: 0o600 });
    await fs.writeFile(path.join(configuration, 'settings.json'), '{"env":{"SYNTHETIC_OPERATOR_ONLY":"retained"}}');
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const proxy = `http://127.0.0.1:${server.address().port}`;
    const traffic = { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1', MAX_RETRIES: '0', ANTHROPIC_BASE_URL: proxy, HTTP_PROXY: proxy, HTTPS_PROXY: proxy, ALL_PROXY: proxy, http_proxy: proxy, https_proxy: proxy, all_proxy: proxy, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
    const selected = { ...dockerEnv, HIVE_MIND_DOCKER_ISOLATION_IMAGE: image, CLAUDE_CONFIG_DIR: configuration, CLAUDE_SECURESTORAGE_CONFIG_DIR: canonical };
    const prepared = await prepareDockerIsolationHostPaths({ tool: 'claude', homeDir, env: selected });
    const environment = { PATH: process.env.PATH, HOME: homeDir, CLAUDE_CONFIG_DIR: configuration, CLAUDE_SECURESTORAGE_CONFIG_DIR: canonical, HIVE_MIND_CLAUDE_AUTH_IDENTITY: prepared.nativeAuthIdentity, ...traffic };
    assert.equal((await execute(binary, ['--version'], { env: environment, maxBuffer: 4096, signal: AbortSignal.timeout(10_000) })).stdout.trim(), '2.1.310 (Claude Code)');
    const nativeArgs = prompt => ['-p', prompt, '--output-format', 'json', '--max-turns', '1', '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'];
    const first = await execute('prlimit', ['--data=1610612736', '--stack=16777216', '--core=0', '--', binary, ...nativeArgs(firstPrompt)], { env: environment, cwd: workspace, maxBuffer: 262144, signal: AbortSignal.timeout(25_000), killSignal: 'SIGKILL' });
    const initial = nativeResult(first);
    assert.equal(initial?.is_error, false, 'The actual root CLI must complete its first request.');
    const session = initial.session_id;
    assert.equal(modelRequests.length, 1);
    const command = await prepareMountedNativeRuntime(binary, runtime, 'claude');
    for (const entry of ['projects', 'sessions']) await fs.mkdir(path.join(homeDir, '.claude', entry), { recursive: true, mode: 0o700 });
    const args = await buildDockerIsolationStartArgs('solve', [], {
      tool: 'claude',
      homeDir,
      env: selected,
      nativeAuthIdentity: prepared.nativeAuthIdentity,
      sessionId: 'claude-native-history',
      resolveMountSources: async options => {
        const mounts = options.mounts.map(mount => (legacy && ['/home/box/.claude/projects', '/home/box/.claude/sessions'].includes(mount.target) ? { ...mount, source: path.join(homeDir, '.claude', path.basename(mount.target)) } : mount));
        return resolveDockerIsolationMountSources({ ...options, mounts: [...mounts, { source: runtime, target: '/__native_runtime', readOnly: true }, { source: workspace, target: workspace, readOnly: true }] });
      },
    });
    const flags = args.flatMap((arg, index) => (['--volume', '-e'].includes(arg) ? [arg, args[index + 1]] : []));
    for (const [index, name] of names.entries()) {
      await docker(['run', '--detach', '--pull', 'never', '--name', name, '--network', network, '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '64', ...(experimental ? ['--cgroup-parent', '/'] : ['--memory', '402653184']), '--ulimit', 'data=1610612736:1610612736', '--ulimit', 'stack=16777216:16777216', '--ulimit', 'core=0:0', '--user', `${process.getuid()}:${process.getgid()}`, '--tmpfs', '/tmp:rw,exec,size=33554432,mode=1777', '--tmpfs', `/home/box:rw,uid=${process.getuid()},gid=${process.getgid()},mode=700,size=16777216`, '--tmpfs', `/home/box/.claude:rw,uid=${process.getuid()},gid=${process.getgid()},mode=700,size=16777216`, ...flags, '--entrypoint', 'sh', image, '-c', 'exec sleep 120']);
      const privateEnv = { HOME: '/home/box', CLAUDE_CONFIG_DIR: '/home/box/.claude', ...traffic };
      await docker(['exec', name, 'sh', '-c', 'test ! -e /home/box/.claude/settings.json']);
      const script = `printf '%s' "$SYNTHETIC_ONBOARDING" > /home/box/.claude/.claude.json; cd "$SYNTHETIC_WORKSPACE"; exec ${command} "$@"`;
      const invocation = ['exec', '-i', ...Object.entries({ ...privateEnv, SYNTHETIC_ONBOARDING: settings, SYNTHETIC_WORKSPACE: workspace }).flatMap(([key, value]) => ['--env', `${key}=${value}`]), name, 'sh', '-c', script, 'sh', ...nativeArgs(`SYNTHETIC-DOCKER-HISTORY-PEER-${index}`), '--resume', session];
      let result;
      try {
        result = await docker(invocation);
      } catch (error) {
        if (!legacy) throw error;
        assert.ok(Number.isInteger(error.code), 'Native Docker resume must complete.');
        result = error;
      }
      if (legacy) {
        assert.ok(result.stdout.includes(`No conversation found with session ID: ${session}`) || result.stderr.includes(`No conversation found with session ID: ${session}`));
        assert.equal(modelRequests.length, 1);
      } else {
        const resumed = nativeResult(result);
        assert.equal(resumed?.is_error, false);
        assert.equal(resumed.session_id, session);
        assert.equal(modelRequests.length, index + 2);
      }
      await docker(['rm', '-f', name]);
    }
    assert.deepEqual(failures, []);
    assert.equal(await fs.readFile(auth, 'utf8'), credential);
    assert.equal((await fs.stat(auth)).ino, authBefore.ino);
    assert.equal(await fs.readFile(path.join(configuration, 'settings.json'), 'utf8'), '{"env":{"SYNTHETIC_OPERATOR_ONLY":"retained"}}');
    const files = await fs.readdir(path.join(configuration, 'projects'), { recursive: true });
    assert.ok(files.some(filename => filename.endsWith(`${session}.jsonl`)));
    console.log(legacy ? 'REPRODUCED: conventional-source Docker peers cannot resume selected native history; one model request.' : 'PASS: actual Claude root and two disposable Docker peers resume selected history with the original message; three model requests, private settings and unchanged credential identity.');
  } finally {
    let remaining;
    try {
      await Promise.allSettled(names.map(name => docker(['rm', '-f', name])));
      remaining = await docker(['ps', '--all', ...names.flatMap(name => ['--filter', `name=^/${name}$`]), '--format', '{{.Names}}']);
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    assert.equal(remaining.stdout.trim(), '', 'Native history peers remain; retain the fixture.');
    await fs.rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await verifyMountedClaudeHistory({ launcher: process.argv[2], legacy: process.argv.includes('--expect-legacy-history-gap') });
}
