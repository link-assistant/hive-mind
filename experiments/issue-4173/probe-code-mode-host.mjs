/** Execute a constant Code Mode cell through Codex and a loopback Responses fixture. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import console from 'node:console';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const [binary, mode] = process.argv.slice(2);
assert.ok(path.isAbsolute(binary ?? ''), 'Supply an absolute Codex executable path.');
assert.ok(mode === undefined || mode === '--expect-unavailable');
const expectUnavailable = mode === '--expect-unavailable';
const marker = 'hive_code_mode_cell_ran';
const callId = 'local_cell';
const requests = [];
const server = http.createServer(async (request, reply) => {
  if (request.method !== 'POST' || request.url !== '/v1/responses' || requests.length >= 2) {
    reply.writeHead(404).end('{}');
    return;
  }
  let payload = '';
  for await (const chunk of request) {
    payload += chunk;
    if (payload.length > 256 * 1024) {
      reply.writeHead(413).end();
      return;
    }
  }
  requests.push(JSON.parse(payload));
  const first = requests.length === 1;
  const id = `response_${requests.length}`;
  const item = first ? { type: 'custom_tool_call', call_id: callId, name: 'exec', input: `text('${marker}')` } : { type: 'message', id: 'done', role: 'assistant', content: [{ type: 'output_text', text: 'Done' }] };
  const events = [
    { type: 'response.created', response: { id } },
    { type: 'response.output_item.done', item },
    { type: 'response.completed', response: { id, usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } } },
  ];
  reply.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close' }).end(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''));
});
server.on('connect', (_request, socket) => socket.destroy());
const work = await mkdtemp(path.join(os.tmpdir(), 'hive-4173-code-mode-'));
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const offline = `model_providers.offline={name="Fixture",base_url="${endpoint}/v1",wire_api="responses",request_max_retries=0,stream_max_retries=0}`;
  const env = { PATH: '/usr/bin:/bin', HOME: work, CODEX_HOME: work, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', TOKIO_WORKER_THREADS: '2', HTTP_PROXY: endpoint, HTTPS_PROXY: endpoint, ALL_PROXY: endpoint, NO_PROXY: '127.0.0.1', RUST_LOG: 'off' };
  const args = ['exec', '--json', '--skip-git-repo-check', '--enable', 'code_mode_only', '--enable', 'code_mode_host', '--disable', 'remote_plugin', '--disable', 'apps', '-m', 'gpt-5.5', '-c', 'model_provider="offline"', '-c', offline, '-c', `chatgpt_base_url="${endpoint}"`, 'Run one local Code Mode cell.'];
  const command = execute('prlimit', ['--data=1073741824', '--stack=16777216', '--core=0', '--', binary, ...args], { cwd: work, env, timeout: 30_000, maxBuffer: 256 * 1024 });
  command.child.stdin.end();
  const { stdout } = await command;
  const events = stdout
    .trim()
    .split('\n')
    .map(line => JSON.parse(line));
  assert.ok(
    events.some(event => event.type === 'turn.completed'),
    stdout
  );
  assert.equal(requests.length, 2, stdout);
  const output = requests[1].input.find(item => item.type === 'custom_tool_call_output' && item.call_id === callId)?.output;
  const diagnostic = events.find(event => event.item?.type === 'error' && event.item.message.includes('Code mode will fail closed'));
  if (expectUnavailable) {
    assert.match(diagnostic?.item.message ?? '', /host executable was not found/u, JSON.stringify({ events, tools: requests[0].tools?.map(tool => tool.name ?? tool.type), output }));
    assert.doesNotMatch(JSON.stringify(output) ?? '', new RegExp(marker, 'u'));
    console.log('PASS: CLI-only generation rejects the cell but still emits turn.completed and exits zero.');
  } else {
    assert.equal(diagnostic, undefined, stdout);
    assert.match(JSON.stringify(output) ?? '', new RegExp(marker, 'u'));
    console.log('PASS: installed sibling executes the cell and returns its output to Codex.');
  }
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(work, { recursive: true, force: true });
}
