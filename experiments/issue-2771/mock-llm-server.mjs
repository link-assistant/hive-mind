#!/usr/bin/env node
// Issue #2771 experiment: a tiny mock LLM endpoint that records every request
// body a CLI sends, so we can see the real `service_tier`, `speed`, context and
// beta headers that Codex CLI / Claude Code put on the wire by default and with
// hive-mind's overrides. Answers both the OpenAI Responses API (SSE) and the
// Anthropic Messages API (SSE) with a one-word reply.
//
// Usage: node mock-llm-server.mjs <port> <capture.jsonl>
import http from 'node:http';
import fs from 'node:fs';

const port = Number(process.argv[2] || 18771);
const capture = process.argv[3] || '/tmp/issue-2771-capture.jsonl';

const sse = (res, events) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  for (const [event, data] of events) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  res.end();
};

const openAiResponse = body => {
  const id = `resp_${Date.now()}`;
  const item = { type: 'message', id: `msg_${Date.now()}`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'OK', annotations: [] }] };
  const response = { id, object: 'response', status: 'completed', model: body.model, output: [item], usage: { input_tokens: 10, input_tokens_details: { cached_tokens: 0 }, output_tokens: 1, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 11 } };
  return [
    ['response.created', { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } }],
    ['response.output_item.done', { type: 'response.output_item.done', output_index: 0, item }],
    ['response.completed', { type: 'response.completed', response }],
  ];
};

const anthropicResponse = body => {
  const message = { id: `msg_${Date.now()}`, type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } };
  return [
    ['message_start', { type: 'message_start', message }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'OK' } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }],
    ['message_stop', { type: 'message_stop' }],
  ];
};

http
  .createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => (raw += chunk));
    req.on('end', () => {
      let body = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        body = { unparsed: raw.slice(0, 200) };
      }
      const record = {
        at: new Date().toISOString(),
        method: req.method,
        url: req.url,
        headers: Object.fromEntries(Object.entries(req.headers).filter(([k]) => /beta|version|tier|speed|model/i.test(k))),
        model: body.model,
        service_tier: body.service_tier,
        speed: body.speed,
        context_management: body.context_management,
        max_tokens: body.max_tokens ?? body.max_output_tokens,
        topLevelKeys: Object.keys(body),
      };
      fs.appendFileSync(capture, `${JSON.stringify(record)}\n`);
      if (req.url.includes('/responses')) return sse(res, openAiResponse(body));
      if (req.url.includes('/messages/count_tokens')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ input_tokens: 10 }));
      }
      if (req.url.includes('/messages')) {
        if (body.stream) return sse(res, anthropicResponse(body));
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ id: 'msg_x', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 1 } }));
      }
      if (req.url.includes('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ data: [], object: 'list' }));
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{}');
    });
  })
  .listen(port, '127.0.0.1', () => console.log(`mock llm on ${port}, capturing to ${capture}`));
