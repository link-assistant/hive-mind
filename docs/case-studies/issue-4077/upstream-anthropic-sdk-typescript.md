<!-- Filed as https://github.com/anthropics/anthropic-sdk-typescript/issues/1299 -->

Title: Streaming `response` debug log has no `[log_<id>]` prefix and logs the raw `Headers`/`ReadableStream` objects

## Summary

With `ANTHROPIC_LOG=debug` (or `logLevel: 'debug'`), every SDK debug line starts with the request log ID, for example `[log_345fb5] sending request`, `[log_345fb5] response parsed` and `[log_345fb5, request-id: "req_…"] post … succeeded with status 200 in 612ms`. Streamed responses have one exception. `src/internal/parse.ts` (line 24 in 0.128.0 and in 1.8.0) contains:

```ts
if (props.options.stream) {
  loggerFor(client).debug('response', response.status, response.url, response.headers, response.body);
```

That call:

1. has no `[${requestLogID}]` prefix, so the line cannot be tied to its request and does not look like SDK debug output;
2. passes the raw `Headers` and `ReadableStream` objects to the logger instead of going through `debugLogRequestDetails`. Header redaction and formatting are skipped, so the console output depends on the runtime. Node prints one line. Bun, which the Claude Code binary uses, prints a multi-line block whose last line is `} ReadableStream { locked: false, state: 'readable', supportsBYOB: false }`.

Tools that read a process's output and must tell debug lines apart from real messages cannot recognise this block by its prefix. In our case a CLI that embeds the SDK was killed by SIGKILL right after such a block. The wrapper then reported the block's last line, `} ReadableStream { locked: false, state: 'readable', supportsBYOB: false }`, as the failure reason.

## Reproduction (Node 20+, `@anthropic-ai/sdk` 1.8.0, no network)

```js
// repro.mjs — run with: ANTHROPIC_LOG=debug node repro.mjs
import Anthropic from '@anthropic-ai/sdk';

const sse = ['event: message_start', `data: ${JSON.stringify({ type: 'message_start', message: { id: 'msg_x', type: 'message', role: 'assistant', model: 'm', content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } })}`, '', 'event: message_stop', 'data: {"type":"message_stop"}', '', ''].join('\n');
const fetch = async () => new Response(new Blob([sse]).stream(), { status: 200, headers: { 'content-type': 'text/event-stream', 'request-id': 'req_example' } });

const client = new Anthropic({ apiKey: 'sk-test', fetch, maxRetries: 0 });
const stream = await client.messages.create({ model: 'm', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }], stream: true });
for await (const _event of stream);
```

Output, after the `sending request` block:

```
[log_f0e866, request-id: "req_example"] post https://api.anthropic.com/v1/messages succeeded with status 200 in 7ms
[log_f0e866] response start {
  url: '',
  status: 200,
  headers: { 'content-type': 'text/event-stream', 'request-id': 'req_example' },
  durationMs: 7
}
response 200  Headers { 'content-type': 'text/event-stream', 'request-id': 'req_example' } ReadableStream { locked: false, state: 'readable', supportsBYOB: true }
[log_f0e866] response parsed {
  ...
}
```

(`url` is empty only because the fake `Response` has no URL.) The unprefixed `response 200 …` line repeats what `[log_f0e866] response start` has just logged, without the prefix and without redaction.

Expected: no unprefixed line. Every debug line of the request starts with `[log_f0e866]`.

## Workaround

- Do not set `ANTHROPIC_LOG=debug` for processes whose output is parsed, or
- pass a custom `logger` whose `debug` drops calls whose first argument is `'response'`, or
- when you parse the output of a tool that embeds the SDK, treat a line matching `/^response \d{3}\s.*\bHeaders\s*\{/` as debug output. If it ends with `{`, also treat the following lines up to the line that starts with `}` as debug output.

## Suggested fix

`[${requestLogID}] response start` already logs the status, URL, headers (redacted) and duration for every response. The streaming branch can drop its own call:

```diff
   const body = await (async () => {
     if (props.options.stream) {
-      loggerFor(client).debug('response', response.status, response.url, response.headers, response.body);
-
       // Note: there is an invariant here that isn't represented in the type system
```

Or, if a separate stream marker is wanted, keep the prefix and the shared formatter:

```ts
debugLogRequestDetails(loggerFor(client), `[${requestLogID}] response stream`, {
  retryOfRequestLogID,
  url: response.url,
  status: response.status,
  headers: response.headers,
  durationMs: Date.now() - startTime,
});
```

Related: anthropics/claude-agent-sdk-typescript#157 (debug output goes to stdout).
