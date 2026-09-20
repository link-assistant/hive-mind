#!/usr/bin/env node
// Issue #2130: does `formal-ai with claude` receive a prompt written to the
// child's stdin pipe by the parent process (as Hive Mind does), rather than
// through a shell `cat file |` pipeline?
import { spawn } from 'node:child_process';

const size = Number(process.argv[2] || 20);
const prompt = 'Say hello and stop.\n' + '# filler\n'.repeat(size);
const args = ['with', 'claude', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions', '--model', 'formal-ai'];
const child = spawn('formal-ai', args, { stdio: ['pipe', 'pipe', 'pipe'] });
let out = '';
child.stdout.on('data', d => (out += d));
child.stderr.on('data', d => (out += d));
child.stdin.on('error', e => console.log('STDIN ERROR:', e.message));
child.stdin.end(prompt);
child.on('exit', code => {
  console.log('EXIT:', code, '| prompt bytes:', Buffer.byteLength(prompt));
  console.log(out.slice(0, 1200));
});
