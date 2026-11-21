/** Disposable native-entrypoint probe. Only synthetic state and a loopback provider.
 * Invoke with `node experiments/issue-3785/probe-xdg-native-storage.mjs agent`.
 * This host probe does not attest Docker mounts or refresh coordination.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const tool = process.argv[2];
assert.ok(['agent', 'opencode'].includes(tool));
const app = tool === 'agent' ? 'link-assistant-agent' : 'opencode';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-native-xdg-'));
const shared = path.join(root, 'data');
const data = path.join(shared, app);
const auth = path.join(data, 'auth.json');
const requests = [];
const server = http.createServer(async (req, res) => {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 256 * 1024) {
      res.writeHead(413).end();
      return;
    }
    chunks.push(chunk);
  }
  if (req.url.endsWith('/models')) {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'synthetic-model', object: 'model', created: 0, owned_by: 'synthetic' }] }));
    return;
  }
  if (!req.url.endsWith('/chat/completions')) {
    res.writeHead(404).end();
    return;
  }
  const body = JSON.parse(Buffer.concat(chunks));
  requests.push({ generation: req.headers.authorization, messages: body.messages.length });
  res.setHeader('content-type', 'text/event-stream');
  const base = { id: 'synthetic-completion', object: 'chat.completion.chunk', created: 0, model: 'synthetic-model' };
  for (const chunk of [
    { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: 'Synthetic response.' }, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } },
  ])
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  res.end('data: [DONE]\n\n');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const provider = {
  name: 'Synthetic',
  npm: '@ai-sdk/openai-compatible',
  options: { baseURL: `http://127.0.0.1:${server.address().port}/v1` },
  models: { 'synthetic-model': { name: 'Synthetic', limit: { context: 16000, output: 512 } } },
};

try {
  await fs.mkdir(data, { recursive: true, mode: 0o700 });
  await fs.writeFile(auth, JSON.stringify({ synthetic: { type: 'api', key: 'SYNTHETIC_G0' } }), { mode: 0o600 });
  const project = path.join(root, 'project');
  await fs.mkdir(project);
  const run = async (participant, extra = []) => {
    const home = path.join(root, participant);
    const env = {
      PATH: `${path.dirname(process.execPath)}:/home/box/.bun/bin:/usr/bin:/bin`,
      HOME: home,
      XDG_DATA_HOME: shared,
      XDG_CONFIG_HOME: path.join(home, 'config'),
      XDG_CACHE_HOME: path.join(home, 'cache'),
      XDG_STATE_HOME: path.join(home, 'state'),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      [tool === 'agent' ? 'LINK_ASSISTANT_AGENT_CONFIG_CONTENT' : 'OPENCODE_CONFIG_CONTENT']: JSON.stringify({ provider: { synthetic: provider }, model: 'synthetic/synthetic-model' }),
      OPENCODE_DISABLE_AUTOUPDATE: 'true',
      OPENCODE_PURE: 'true',
      OPENCODE_DISABLE_MODELS_FETCH: 'true',
      // No external plugins are requested. Native startup otherwise attempts
      // registry dependency installation even for an empty private config.
      npm_config_offline: 'true',
      npm_config_fetch_retries: '0',
    };
    await fs.mkdir(home, { recursive: true });
    // Retain native output privately on a failure; never print conversations or
    // authorization headers into the probe's structural report.
    const args = tool === 'agent' ? ['--compact-json', '--no-server', '--no-summarize-session', '--no-generate-title', '--no-always-accept-stdin', '--model', 'synthetic/synthetic-model', '--prompt', 'Synthetic storage probe.', ...extra] : ['--print-logs', '--log-level', 'DEBUG', 'run', '--format', 'json', '--model', 'synthetic/synthetic-model', ...extra, 'Synthetic storage probe.'];
    const pending = execute('python3', ['-c', 'import os,resource,sys; resource.setrlimit(resource.RLIMIT_DATA,(1610612736,1610612736)); resource.setrlimit(resource.RLIMIT_CORE,(0,0)); os.execvpe(sys.argv[1],sys.argv[1:],os.environ)', tool, ...args], { env, cwd: project, detached: true, maxBuffer: 512 * 1024, signal: AbortSignal.timeout(45000), killSignal: 'SIGKILL' });
    // OpenCode consumes piped stdin before making its first model request.
    // An execFile pipe stays open unless the harness explicitly closes it.
    pending.child.stdin.end();
    const reap = () => {
      try {
        process.kill(-pending.child.pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    };
    // A descendant retaining a pipe can delay execFile's callback even after
    // its direct child dies. Kill the dedicated group independently of it.
    const timer = setTimeout(reap, 45000);
    pending.child.once('exit', reap);
    try {
      const result = await pending;
      return result.stdout;
    } catch (error) {
      await fs.writeFile(`/tmp/issue-3785-${tool}-native-private.log`, `${JSON.stringify({ code: error.code, signal: error.signal, killed: error.killed, cause: error.cause?.name })}\n${error.stdout || ''}\n${error.stderr || ''}`, { mode: 0o600 });
      throw new Error('Native storage probe failed; inspect its private synthetic-only log.');
    } finally {
      // Native startup may spawn dependency installers. Reap the dedicated
      // process group before removing its disposable home, even on failure.
      clearTimeout(timer);
      reap();
    }
  };
  const output = await run('task-a');
  const session = [...output.matchAll(/"session(?:ID|_id)"\s*:\s*"(ses_[a-zA-Z0-9_-]+)"/gu)].map(match => match[1])[0];
  assert.ok(session, 'Native CLI must report a persisted session identifier.');
  assert.ok(requests.some(request => request.generation === 'Bearer SYNTHETIC_G0'));
  // Host atomic replacement, then a different native participant's next read.
  await fs.writeFile(`${auth}.new`, JSON.stringify({ synthetic: { type: 'api', key: 'SYNTHETIC_G1' } }), { mode: 0o600 });
  await fs.rename(`${auth}.new`, auth);
  const before = requests.length;
  await run('task-b', tool === 'agent' ? ['--resume', session, '--no-fork'] : ['--session', session]);
  const second = requests.slice(before);
  assert.ok(second.some(request => request.generation === 'Bearer SYNTHETIC_G1'));
  assert.ok(
    second.some(request => request.messages >= 3),
    'Native resume must load previous messages.'
  );
  console.log(`${tool}: native task A writes history; task B resumes it and reads the host atomic credential replacement.`);
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await fs.rm(root, { recursive: true, force: true });
}
