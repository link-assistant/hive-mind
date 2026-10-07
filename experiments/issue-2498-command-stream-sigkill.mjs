// Issue #2498: how does a command-stream version report a child killed by SIGKILL / SIGTERM?
// Usage: node experiments/issue-2498-command-stream-sigkill.mjs /abs/path/to/node_modules/command-stream
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
const dir = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
const entry = typeof pkg.exports === 'string' ? pkg.exports : pkg.exports?.['.']?.import || pkg.exports?.['.']?.default || pkg.module || pkg.main;
const { $ } = await import(pathToFileURL(path.join(dir, typeof entry === 'string' ? entry : entry.default)).href);
const out = { version: pkg.version };
for (const sig of ['KILL', 'TERM']) {
  const r = await $({ mirror: false, capture: true })`sh -c ${`kill -${sig} $$`}`.catch(e => e);
  out[sig] = { code: r?.code, exitCode: r?.exitCode, signal: r?.signal ?? null };
  let chunks = [];
  for await (const chunk of $({ mirror: false })`sh -c ${`kill -${sig} $$`}`.stream()) if (chunk.type === 'exit') chunks.push({ code: chunk.code, signal: chunk.signal ?? null });
  out[`${sig}-stream-exit`] = chunks;
}
for (const sig of ['SIGKILL', 'SIGTERM']) {
  const r = await $({ mirror: false, capture: true })`node -e ${`process.kill(process.pid, '${sig}')`}`.catch(e => e);
  out[`direct-${sig}`] = { code: r?.code, exitCode: r?.exitCode, signal: r?.signal ?? null };
}
console.log(JSON.stringify(out));
