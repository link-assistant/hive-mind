#!/usr/bin/env node
/**
 * Issue #2130 — record the exact request a CLI sends to Formal AI.
 *
 * Sits between the CLI and `formal-ai serve --agent-mode`, appends every request
 * body to a capture file, and forwards verbatim. Used to explain why the gemini
 * CLI makes Formal AI run `date` when synthetic requests over the same protocol
 * are answered correctly.
 *
 * Usage: node proxy-capture.mjs <listenPort> <upstreamBaseUrl> <captureFile>
 */
import { createServer } from 'node:http';
import { appendFile } from 'node:fs/promises';

const [listenPort, upstream, captureFile] = process.argv.slice(2);

const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  await appendFile(captureFile, `\n===== ${req.method} ${req.url} (${body.length} bytes)\n${body.toString('utf8')}\n`);

  const headers = { ...req.headers };
  delete headers.host;
  delete headers['content-length'];
  let upstreamResponse;
  try {
    upstreamResponse = await fetch(new URL(req.url, upstream), { method: req.method, headers, body: body.length ? body : undefined });
  } catch (error) {
    res.writeHead(502).end(String(error));
    return;
  }
  const responseBody = Buffer.from(await upstreamResponse.arrayBuffer());
  await appendFile(captureFile, `----- response ${upstreamResponse.status} (${responseBody.length} bytes)\n${responseBody.toString('utf8').slice(0, 4000)}\n`);
  res.writeHead(upstreamResponse.status, Object.fromEntries([...upstreamResponse.headers].filter(([name]) => !['content-encoding', 'content-length', 'transfer-encoding'].includes(name))));
  res.end(responseBody);
});
server.listen(Number(listenPort), '127.0.0.1', () => console.log(`proxy on ${listenPort} → ${upstream}`));
