// Reproduces the unprefixed `response <status> <url> Headers {…} ReadableStream {…}` debug line that
// @anthropic-ai/sdk prints for streaming responses when ANTHROPIC_LOG=debug (issue #4077).
// Usage: ANTHROPIC_LOG=debug node experiments/issue-4077/sdk-stream-debug-log.mjs <path-to-sdk-package-dir>
// No network: a fake fetch returns a minimal SSE stream.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const sdkDir = process.argv[2];
if (!sdkDir) throw new Error('pass the unpacked @anthropic-ai/sdk package directory');
const { default: Anthropic } = await import(pathToFileURL(path.join(sdkDir, 'index.mjs')).href);

const sse = ['event: message_start', `data: ${JSON.stringify({ type: 'message_start', message: { id: 'msg_x', type: 'message', role: 'assistant', model: 'm', content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } })}`, '', 'event: message_stop', 'data: {"type":"message_stop"}', '', ''].join('\n');
const fakeFetch = async () => new Response(new Blob([sse]).stream(), { status: 200, headers: { 'content-type': 'text/event-stream', 'request-id': 'req_example' } });

const client = new Anthropic({ apiKey: 'sk-test', fetch: fakeFetch, maxRetries: 0 });
const stream = await client.messages.create({ model: 'm', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }], stream: true });
for await (const _event of stream) {
  // drain
}
