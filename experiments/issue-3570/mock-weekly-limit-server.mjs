// Issue #3570: a mock Anthropic API that answers every /v1/messages request with
// the 429 of the reported run (weekly window rejected, reset 1792494000).
// With MODE=background-task the first conversation turn is answered with a
// `Bash` tool call that starts a background task, and the next turn gets the
// 429, which is the shape of the reported run (a background task was still
// running when print mode exited).
// Usage: [MODE=background-task] node mock-weekly-limit-server.mjs [port]
import http from 'node:http';

const port = Number(process.argv[2] || 8793);
const RESET = '1792494000';
const headers = {
  'content-type': 'application/json',
  'retry-after': '56482',
  'x-should-retry': 'true',
  'anthropic-ratelimit-unified-status': 'rejected',
  'anthropic-ratelimit-unified-reset': RESET,
  'anthropic-ratelimit-unified-representative-claim': 'seven_day',
  'anthropic-ratelimit-unified-5h-status': 'allowed',
  'anthropic-ratelimit-unified-5h-utilization': '0.38',
  'anthropic-ratelimit-unified-5h-reset': '1792446600',
  'anthropic-ratelimit-unified-7d-status': 'rejected',
  'anthropic-ratelimit-unified-7d-utilization': '1.0',
  'anthropic-ratelimit-unified-7d-reset': RESET,
  'anthropic-ratelimit-unified-7d-surpassed-threshold': '1.0',
  'anthropic-ratelimit-unified-overage-status': 'rejected',
  'anthropic-ratelimit-unified-overage-disabled-reason': 'org_level_disabled',
};
const body = JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: "This request would exceed your account's rate limit. Please try again later." } });

const MODE = process.env.MODE || 'plain';
const BG_COMMAND = process.env.BG_COMMAND || 'sleep 120';
// RUN_IN_BACKGROUND=0 runs BG_COMMAND in the foreground (e.g. to produce a large tool_result).
const RUN_IN_BACKGROUND = process.env.RUN_IN_BACKGROUND !== '0';
// TOOL_TURNS=N answers N tool-call turns before the 429, to grow stdout past the pipe buffer.
const TOOL_TURNS = Number(process.env.TOOL_TURNS || 1);
const sse = events => events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
const toolUseStream = () =>
  sse([
    ['message_start', { type: 'message_start', message: { id: 'msg_3570', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `toolu_3570_${Date.now()}`, name: 'Bash', input: {} } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ command: BG_COMMAND, description: 'Start a background task', run_in_background: RUN_IN_BACKGROUND }) } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } }],
    ['message_stop', { type: 'message_stop' }],
  ]);

http
  .createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const toolResults = raw.split('"tool_result"').length - 1;
      const hasToolResult = toolResults > 0;
      console.error(`${new Date().toISOString()} ${req.method} ${req.url} (${raw.length} bytes${hasToolResult ? `, ${toolResults} tool_result(s)` : ''})`);
      if (req.url.startsWith('/v1/messages') && MODE === 'background-task' && toolResults < TOOL_TURNS && raw.includes('"stream":true')) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(toolUseStream());
      } else if (req.url.startsWith('/v1/messages')) {
        res.writeHead(429, headers);
        res.end(body);
      } else {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'not found' } }));
      }
    });
  })
  .listen(port, '127.0.0.1', () => console.error(`mock listening on http://127.0.0.1:${port}`));
