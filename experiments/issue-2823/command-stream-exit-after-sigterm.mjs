#!/usr/bin/env node
// Does command-stream's stream() yield an `exit` chunk with code 143 when the
// process group is SIGTERMed after it already printed its final output?
// (Reproduces the solve wrapper seeing "exit code 143" after a successful
// Claude result, PR #2824 session log.) Usage: node <this> [command-stream dir]
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const dir = process.argv[2];
const mod = dir ? await import(pathToFileURL(path.join(dir, 'node_modules/command-stream/src/$.mjs')).href) : await import('command-stream');
const { $ } = mod;
const cmd = $({ mirror: false, detached: true })`sh -c 'echo "{\\"type\\":\\"result\\",\\"subtype\\":\\"success\\"}"; sleep 30'`;
const started = Date.now();
setTimeout(() => {
  const pid = cmd.child?.pid;
  console.log('sending SIGTERM to process group', pid);
  try {
    process.kill(-pid, 'SIGTERM');
  } catch (e) {
    console.log('group kill failed', e.message);
    cmd.kill('SIGTERM');
  }
}, 1000);
for await (const chunk of cmd.stream()) {
  console.log('chunk', chunk.type, chunk.type === 'exit' ? chunk.code : JSON.stringify(String(chunk.data || '')).slice(0, 80));
}
console.log('result code', cmd.result?.code, 'after', Date.now() - started, 'ms');
