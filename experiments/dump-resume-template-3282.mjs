// Issue #3282: dump the resume-path template executeClaudeCommand hands to $.
import { quote } from 'command-stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
globalThis.use = async name => {
  const n = name.replace(/@\d[^/]*$/, '');
  if (n === 'command-stream') return { $: () => ({ stream: async function* () {} }) };
  if (n === 'fs') return { ...fs, default: fs };
  if (n === 'os') return { ...os, default: os };
  if (n === 'path') return { ...path, default: path };
  if (n === 'getenv') return (k, f) => process.env[k] ?? f;
  return import(n);
};
const { executeClaudeCommand } = await import('../src/claude.lib.mjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dump-3282-'));
let t;
const S = 'aaaa';
const ev = [
  { type: 'system', subtype: 'init', session_id: S },
  { type: 'result', subtype: 'success', is_error: false, session_id: S, result: 'ok', num_turns: 1 },
];
await executeClaudeCommand({
  tempDir: dir,
  branchName: 'b',
  prompt: process.argv[2] || 'p',
  systemPrompt: process.argv[3] || 's',
  argv: { model: 'opus', tool: 'claude', url: 'https://github.com/o/r/issues/1', resume: S, fallbackModel: null },
  log: async () => {},
  getLogFile: () => path.join(dir, 'l'),
  setLogFile: () => {},
  formatAligned: (_i, l, v = '') => `${l} ${v}`,
  getResourceSnapshot: async () => ({ memory: '', load: '' }),
  feedbackLines: [],
  claudePath: 'claude',
  owner: 'o',
  repo: 'r',
  prNumber: 1,
  issueNumber: 1,
  $:
    () =>
    (strings, ...values) => {
      t = { strings, values };
      return {
        result: { code: 0 },
        kill() {},
        async *stream() {
          yield { type: 'stdout', data: Buffer.from(ev.map(e => JSON.stringify(e)).join('\n') + '\n') };
        },
      };
    },
});
let out = '';
t.strings.forEach((s, i) => {
  out += s;
  if (i < t.values.length) out += quote(t.values[i]);
});
console.log(JSON.stringify(t.values, null, 1));
console.log(out);
fs.rmSync(dir, { recursive: true, force: true });
