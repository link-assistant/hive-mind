// Bounded, offline reproduction against the installed upstream binary.
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { resolve, join } from 'node:path';

const evidence = resolve('docs/case-studies/issue-2613/evidence');
await mkdir(evidence, { recursive: true });
const directory = await mkdtemp(join(tmpdir(), 'formal-ai-2613-'));
const listener = createServer();
listener.listen(0, '127.0.0.1');
await once(listener, 'listening');
const port = listener.address().port;
await new Promise(resolveClose => listener.close(resolveClose));
const trace = createWriteStream(join(evidence, 'formal-ai-replay-server.log'));
const child = spawn('python3', ['-c', 'import os,resource,sys; resource.setrlimit(resource.RLIMIT_AS,(2*1024**3,2*1024**3)); resource.setrlimit(resource.RLIMIT_STACK,(16*1024**2,16*1024**2)); resource.setrlimit(resource.RLIMIT_CPU,(30,30)); os.execv(sys.argv[1],sys.argv[1:])', '/usr/local/bin/formal-ai', 'serve', '--agent-mode', '--host', '127.0.0.1', '--port', String(port)], { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.pipe(trace, { end: false });
child.stderr.pipe(trace, { end: false });
const finished = once(child, 'close');
const watchdog = setTimeout(() => child.kill('SIGKILL'), 30_000);
const sleep = ms => new Promise(done => setTimeout(done, ms));
try {
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/models`, { signal: AbortSignal.timeout(500) });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* server is starting */
    }
    if (child.exitCode !== null) break;
    await sleep(100);
  }
  if (!ready) throw new Error('Bounded Formal AI server did not start; inspect the saved trace');
  const tools = [{ type: 'function', function: { name: 'read', description: 'Read a local file', parameters: { type: 'object', properties: { filePath: { type: 'string' } }, required: ['filePath'] } } }];
  const request = async messages => {
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'formal-ai', temperature: 0, max_tokens: 256, messages, tools }), signal: AbortSignal.timeout(5000) });
    const result = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(result));
    return result;
  };
  const results = [];
  for (const prompt of ['Read README.md (e.g., the project documentation).', 'Read README.md, for example the project documentation.']) {
    const messages = [{ role: 'user', content: prompt }];
    const response = await request(messages);
    results.push({ prompt, response });
    if (prompt.includes('e.g.')) {
      const answer = response.choices?.[0]?.message;
      const calls = answer?.tool_calls || [];
      if (!calls.some(call => JSON.parse(call.function.arguments).filePath === 'e.g')) throw new Error('The upstream abbreviation bug did not reproduce');
      if (calls.length) results.push({ afterMissingFile: await request([...messages, answer, ...calls.map(call => ({ role: 'tool', tool_call_id: call.id, content: JSON.parse(call.function.arguments).filePath === 'e.g' ? 'Error: File not found: e.g' : '# Project documentation\nThis is a fixture.' }))]) });
    }
  }
  console.log(JSON.stringify({ binary: 'formal-ai 0.352.1', limits: { requests: 3, memoryBytes: 2 * 1024 ** 3, stackBytes: 16 * 1024 ** 2, cpuSeconds: 30 }, results }, null, 2));
} finally {
  child.kill('SIGTERM');
  await finished;
  clearTimeout(watchdog);
  trace.end();
  await once(trace, 'finish');
  await rm(directory, { recursive: true, force: true });
}
