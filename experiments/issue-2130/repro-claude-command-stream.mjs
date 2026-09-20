#!/usr/bin/env node
// Reproduce issue #2130: prompt delivered via command-stream `stdin` option to
// `formal-ai with claude` (Hive Mind's src/claude.lib.mjs:693 execution path).
import { $ } from 'command-stream';

const tempDir = process.cwd();
const prompt = process.argv[2] || 'Say hello.';
const cmd = $({ cwd: tempDir, stdin: prompt, mirror: false })`formal-ai with claude --output-format stream-json --verbose --dangerously-skip-permissions --model formal-ai`;

let out = '';
for await (const chunk of cmd.stream()) {
  if (chunk.type === 'stdout' || chunk.type === 'stderr') out += chunk.data.toString();
  if (chunk.type === 'exit') console.log('EXIT CODE:', chunk.code);
}
console.log(out.slice(0, 2000));
