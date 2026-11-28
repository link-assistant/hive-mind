/** Exercise the selected Codex command through the external Code Mode host. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const command = path.resolve(process.argv[2]);
const home = await fs.mkdtemp(path.join(os.tmpdir(), 'native-code-mode-'));
const marker = `codex-host-ok-${randomUUID()}`;
const requests = [];
const call = {
  type: 'custom_tool_call',
  call_id: 'call_native_host',
  name: 'exec',
  input: `text((await tools.exec_command({ cmd: "printf ${marker}" })).output);`,
};
const server = http.createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/v1/responses' || requests.length >= 2) {
    response.writeHead(404).end();
    return;
  }
  let body = '';
  for await (const chunk of request) body += chunk;
  requests.push(JSON.parse(body));
  const id = `response_${requests.length}`;
  const item = requests.length === 1 ? call : { type: 'message', role: 'assistant', id: 'done', content: [{ type: 'output_text', text: 'done' }] };
  const events = [
    { type: 'response.created', response: { id } },
    { type: 'response.output_item.done', item },
    { type: 'response.completed', response: { id, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
  ];
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  response.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
});

try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  await fs.writeFile(
    path.join(home, 'config.toml'),
    `model_provider = "fixture"
web_search = "disabled"
[features]
code_mode_host = true
code_mode_only = true
remote_plugin = false
plugins = false
apps = false
[code_mode]
disable_in_process_fallback = true
[model_providers.fixture]
name = "Loopback Responses fixture"
base_url = "http://127.0.0.1:${server.address().port}/v1"
wire_api = "responses"
request_max_retries = 0
stream_max_retries = 0
`
  );
  const running = execute('prlimit', ['--data=1610612736', '--stack=16777216', '--core=0', '--', command, 'exec', '--model', 'gpt-5.5', '--json', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'danger-full-access', 'Run the requested local smoke test.'], { cwd: home, env: { PATH: '/usr/bin:/bin', HOME: home, CODEX_HOME: home }, maxBuffer: 262144, timeout: 30000 });
  running.child.stdin.end();
  const { stdout, stderr } = await running;
  assert.equal(requests.length, 2, stdout);
  assert.ok(
    requests[0].tools.some(tool => tool.type === 'custom' && tool.name === 'exec'),
    'Codex did not expose the Code Mode tool'
  );
  const output = requests[1].input.find(item => item.type === 'custom_tool_call_output' && item.call_id === call.call_id)?.output;
  const text = Array.isArray(output) ? output.map(item => item.text).join('\n') : output;
  assert.ok(text?.includes(marker), `Code Mode did not return the command output: ${text}\n${stderr}`);
  assert.doesNotMatch(stdout, /Code Mode is unavailable/u);
  assert.ok(
    stdout.split('\n').some(line => line.includes('"type":"turn.completed"')),
    stdout
  );
  process.stdout.write('PASS: installed Codex ran a shell command through its external Code Mode host.\n');
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await fs.rm(home, { recursive: true, force: true });
}
