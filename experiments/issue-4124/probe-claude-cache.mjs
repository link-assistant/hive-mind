#!/usr/bin/env node
// Usage: node experiments/issue-4124/probe-claude-cache.mjs [claude-binary]
// Uses synthetic credentials and a local Messages API. Only TTLs are recorded.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { buildClaudeQuietEnv, ensureClaudeQuietConfig } from '../../src/claude-quiet-config.lib.mjs';

const run = promisify(execFile);
const claude = process.argv[2] || 'claude';
const root = await mkdtemp(join(tmpdir(), 'hive-cache-probe-'));
const marker = 'CACHE_PROBE_SUBAGENT';
let observations;
let issuedAgentCall;

function getTtls(value) {
  if (!value || typeof value !== 'object') return [];
  const markerTtl = value.cache_control?.type === 'ephemeral' ? [value.cache_control.ttl ?? '5m'] : [];
  return [...markerTtl, ...Object.values(value).flatMap(getTtls)];
}

const server = createServer(async (request, response) => {
  if (request.method !== 'POST' || !request.url.startsWith('/v1/messages')) {
    response.writeHead(404).end();
    return;
  }
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    const firstUserMessage = body.messages.find(message => message.role === 'user');
    const subagent = JSON.stringify(firstUserMessage?.content).includes(marker);
    const bucket = subagent ? 'subagent' : 'main';
    observations[bucket].push(...getTtls(body));
    const agentTool = body.tools?.find(tool => tool.name === 'Agent' || tool.name === 'Task');
    const callAgent = !issuedAgentCall && !subagent && agentTool;
    if (callAgent) issuedAgentCall = true;

    const contentBlock = callAgent ? { type: 'tool_use', id: 'toolu_cache_probe', name: agentTool.name, input: {} } : { type: 'text', text: '' };
    const delta = callAgent ? { type: 'input_json_delta', partial_json: JSON.stringify({ description: 'Probe subagent cache', subagent_type: 'general-purpose', prompt: marker }) } : { type: 'text_delta', text: 'ok' };
    const message = { id: 'msg_cache_probe', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } };
    const events = {
      message_start: { message },
      content_block_start: { index: 0, content_block: contentBlock },
      content_block_delta: { index: 0, delta },
      content_block_stop: { index: 0 },
      message_delta: { delta: { stop_reason: callAgent ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } },
      message_stop: {},
    };
    response.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'close' });
    response.end(
      Object.entries(events)
        .map(([type, event]) => `event: ${type}\ndata: ${JSON.stringify({ type, ...event })}\n\n`)
        .join('')
    );
  } catch (error) {
    console.error(error.message);
    response.writeHead(400).end();
  }
});
server.on('connect', (_request, socket) => socket.end('HTTP/1.1 502 Loopback fixture refuses external traffic\r\n\r\n'));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

try {
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const { stdout: version } = await run(claude, ['--version'], { env: { PATH: process.env.PATH, HOME: root } });
  console.log(version.trim());
  for (const scenario of [
    { name: 'before', expected: ['5m', '5m'] },
    { name: 'managed', managed: true, expected: ['1h', '1h'] },
    { name: 'native-settings', settings: true, expected: ['1h', '1h'] },
    { name: 'split', managed: true, overrides: { CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL: '5m' }, expected: ['1h', '5m'] },
    { name: 'forced-short', managed: true, overrides: { FORCE_PROMPT_CACHING_5M: '1' }, expected: ['5m', '5m'] },
  ]) {
    const home = join(root, scenario.name);
    const work = join(home, 'work');
    const config = join(home, '.claude');
    await mkdir(work, { recursive: true });
    await mkdir(config);
    const settingsPath = join(config, 'settings.json');
    await writeFile(settingsPath, '{}');
    if (scenario.settings) await ensureClaudeQuietConfig({ settingsPath });
    const env = {
      PATH: process.env.PATH,
      HOME: home,
      CLAUDE_CONFIG_DIR: config,
      ANTHROPIC_API_KEY: 'fixture-key',
      ANTHROPIC_BASE_URL: endpoint,
      HTTP_PROXY: endpoint,
      HTTPS_PROXY: endpoint,
      NO_PROXY: '127.0.0.1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      DISABLE_AUTOUPDATER: '1',
      ...scenario.overrides,
    };
    observations = { main: [], subagent: [] };
    issuedAgentCall = false;
    await run(claude, ['-p', 'Check the cache with a general-purpose subagent.', '--model', 'haiku', '--tools', 'Agent', '--permission-mode', 'dontAsk', '--max-turns', '3', '--output-format', 'json'], { cwd: work, env: scenario.managed ? buildClaudeQuietEnv(env) : env, maxBuffer: 256 * 1024 });
    const { main, subagent } = Object.fromEntries(Object.entries(observations).map(([bucket, ttls]) => [bucket, [...new Set(ttls)].sort()]));
    console.log(JSON.stringify({ scenario: scenario.name, main, subagent }));
    assert.deepEqual(
      [main, subagent],
      scenario.expected.map(ttl => [ttl])
    );
  }
} finally {
  server.close();
  await rm(root, { recursive: true, force: true });
}
