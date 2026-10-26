// Bounded native read/resume controls for production rollout recovery formats.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { zstdCompressSync } from 'node:zlib';
import { Buffer } from 'node:buffer';
import { setTimeout, clearTimeout } from 'node:timers';
import { shareScopedCodexSessions } from '../../src/codex-sessions.lib.mjs';
import { restoreCodexRolloutFromContainer } from '../../src/session-kill-resume.fresh-session.lib.mjs';

const execute = promisify(execFile);
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-3785-native-rollout-'));
const label = `hive-3785-native-rollout=${process.pid}`;
const binary = process.env.CODEX_PROBE_BINARY || '/home/box/.bun/install/global/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex';
const docker = args => execute('docker', args, { maxBuffer: 128 * 1024, signal: globalThis.AbortSignal.timeout(45_000) });
let sequence = 0;

async function readAndResume({ baseCodexHome, threadId, marker }) {
  const config = path.join(root, `config-${++sequence}`);
  await fs.mkdir(config, { mode: 0o700 });
  await fs.writeFile(path.join(config, 'config.toml'), 'model="synthetic"\nmodel_provider="offline"\n[features]\nremote_plugin=false\n[model_providers.offline]\nname="Offline"\nbase_url="http://127.0.0.1:1/v1"\nwire_api="responses"\nrequires_openai_auth=false\n');
  assert.equal((await shareScopedCodexSessions({ baseCodexHome, codexHome: config })).status, 'shared');
  const name = `hive-3785-rollout-reader-${process.pid}-${sequence}`;
  const args = ['run', '--rm', '-i', '--name', name, '--label', label, '--cgroup-parent', '/', '--pids-limit', '64', '--network', 'none', '--read-only', '--user', `${process.getuid()}:${process.getgid()}`, '--ulimit', 'data=536870912:536870912', '--ulimit', 'stack=16777216:16777216', '--mount', `type=bind,source=${binary},target=/usr/local/bin/codex,readonly`, '--mount', `type=bind,source=${root},target=${root}`, '-w', root, '-e', `HOME=${config}`, '-e', `CODEX_HOME=${config}`, '-e', 'TOKIO_WORKER_THREADS=2', '-e', 'RUST_LOG=off', 'alpine:3.22', 'codex', 'app-server'];
  const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = new Promise(resolve => child.once('close', resolve));
  const pending = new Map();
  const diagnostics = [];
  const rejectPending = error => {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  child.once('error', () => rejectPending(new Error('Native container could not start.')));
  child.once('close', () => rejectPending(new Error('Native process closed before its reply.')));
  child.stderr.resume();
  child.stdin.on('error', () => rejectPending(new Error('Native protocol input closed.')));
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    try {
      const message = JSON.parse(line);
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) {
        diagnostics.push(fs.writeFile('/tmp/issue-3785-native-rollout-private.log', JSON.stringify(message.error), { mode: 0o600 }));
        request.reject(new Error(`Native request rejected (${message.error.code}).`));
      } else request.resolve(message.result);
    } catch {
      rejectPending(new Error('Native protocol output was malformed.'));
    }
  });
  let requestId = 0;
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++requestId;
      pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  const timer = setTimeout(() => rejectPending(new Error('Finite native rollout deadline exceeded.')), 30_000);
  try {
    const init = await request('initialize', { clientInfo: { name: 'hive-3785-rollout-probe', version: '0.0.0' }, capabilities: { experimentalApi: true } });
    assert.match(init.userAgent, /0\.164\.0/u);
    child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`);
    for (const [method, params] of [
      ['thread/read', { threadId, includeTurns: true }],
      ['thread/resume', { threadId, modelProvider: 'offline', approvalPolicy: 'never', sandbox: 'read-only' }],
    ]) {
      const result = await request(method, params);
      assert.equal(result.thread.id, threadId);
      assert.ok(JSON.stringify(result.thread.turns).includes(marker), `${method} must recover prior user content`);
    }
  } finally {
    clearTimeout(timer);
    lines.close();
    child.stdin.end();
    await docker(['rm', '-f', name]).catch(() => {});
    if (child.exitCode === null) child.kill('SIGKILL');
    await closed;
    await Promise.allSettled(diagnostics);
  }
}

try {
  for (const [index, variant] of ['plain', 'compressed', 'reverted', 'reverted-compressed'].entries()) {
    const sourceHome = path.join(root, `stopped-${index}`);
    const sessions = path.join(sourceHome, 'sessions', '2026', '10', '26');
    await fs.mkdir(sessions, { recursive: true });
    const threadId = randomUUID();
    const marker = `Synthetic prior ${variant} conversation.`;
    const stamp = '2026-10-26T00:00:00Z';
    const lines =
      [
        { timestamp: stamp, type: 'session_meta', payload: { id: threadId, session_id: threadId, timestamp: stamp, cwd: root, originator: 'codex', cli_version: '0.164.0', source: 'cli', model_provider: 'offline', base_instructions: null } },
        { timestamp: stamp, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: marker }] } },
        { timestamp: stamp, type: 'event_msg', payload: { type: 'user_message', message: marker, text_elements: [], local_images: [] } },
      ]
        .map(item => JSON.stringify(item))
        .join('\n') + '\n';
    const name = `rollout-2026-10-26T00-00-00-${threadId}${variant.includes('reverted') ? `_${randomUUID()}` : ''}.jsonl${variant.includes('compressed') ? '.zst' : ''}`;
    const originalBytes = variant.includes('compressed') ? zstdCompressSync(Buffer.from(lines)) : Buffer.from(lines);
    await fs.writeFile(path.join(sessions, name), originalBytes, { mode: 0o600 });
    // Establish that the native pinned reader accepts the representation first.
    await readAndResume({ baseCodexHome: sourceHome, threadId, marker });
    // Native resume may materialize compressed bytes or append new metadata.
    // Restore the original representation so recovery must handle that format.
    await fs.rm(path.join(sourceHome, 'sessions'), { recursive: true });
    await fs.mkdir(sessions, { recursive: true });
    await fs.writeFile(path.join(sessions, name), originalBytes, { mode: 0o600 });
    const sourceContainer = `hive-3785-stopped-${process.pid}-${index}`;
    await docker(['run', '--name', sourceContainer, '--label', label, '--cgroup-parent', '/', '--network', 'none', '--pids-limit', '16', '--mount', `type=bind,source=${sourceHome},target=/home/box/.codex`, 'alpine:3.22', 'true']);
    const canonical = path.join(root, `canonical-${index}`);
    const restored = await restoreCodexRolloutFromContainer({
      containerName: sourceContainer,
      sessionInfo: { url: 'https://github.com/link-assistant/hive-mind/issues/3785' },
      threadId,
      hostSessionsDir: path.join(canonical, 'sessions'),
      tmpDir: root,
      runner: {
        copyFromDockerContainer: async (container, source, destination) => {
          await docker(['cp', `${container}:${source}`, destination]);
          return { success: true };
        },
      },
    });
    assert.equal(restored.restored, true, `Production recovery must find native ${variant} evidence`);
    assert.equal(path.basename(restored.file), name);
    assert.deepEqual(await fs.readFile(restored.file), originalBytes);
    await readAndResume({ baseCodexHome: canonical, threadId, marker });
    console.log(`PASS: native ${variant} rollout is read/resumed before and after stopped-container recovery into fresh configuration.`);
  }
} finally {
  const { stdout } = await docker(['ps', '-aq', '--filter', `label=${label}`]);
  const containers = stdout.trim().split(/\s+/u).filter(Boolean);
  if (containers.length) await docker(['rm', '-f', ...containers]);
  await fs.rm(root, { recursive: true, force: true });
}
