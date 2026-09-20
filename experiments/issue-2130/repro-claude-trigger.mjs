#!/usr/bin/env node
// Issue #2130: narrow down which passthrough argument makes `formal-ai with claude`
// swallow stdin instead of forwarding it to the wrapped CLI.
import { spawn } from 'node:child_process';
const extra = JSON.parse(process.argv[2]);
const args = ['with', 'claude', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions', '--model', 'formal-ai', ...extra];
const child = spawn('formal-ai', args, { stdio: ['pipe', 'pipe', 'pipe'] });
let out = '';
child.stdout.on('data', d => (out += d));
child.stderr.on('data', d => (out += d));
child.stdin.end('Say hello and stop.');
child.on('exit', code => {
  const failed = /Input must be provided/.test(out);
  console.log(`${failed ? 'STDIN-LOST' : 'stdin-ok  '} exit=${code} extra=${JSON.stringify(extra)}`);
});
