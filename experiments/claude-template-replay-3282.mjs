// Issue #3282: replay the command executeClaudeCommand hands to `$` through a given
// command-stream build (argv[2]: path to its src/$.mjs) into a fake claude; print the
// --append-system-prompt / -p it receives. Usage: node … <$.mjs> [resume]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const cs = await import(process.argv[2]);
globalThis.use = async name => {
  const n = name.replace(/@\d[^/]*$/, '');
  if (n === 'command-stream') return { $: () => ({ stream: async function* () {} }) };
  if (n === 'fs') return { ...fs, default: fs };
  if (n === 'os') return { ...os, default: os };
  if (n === 'path') return { ...path, default: path };
  if (n === 'getenv') return (k, f) => process.env[k] ?? f;
  return import(n);
};
const { executeClaudeCommand } = await import(new URL('../src/claude.lib.mjs', import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-3282-'));
const fake = path.join(dir, 'claude');
const out = path.join(dir, 'argv.json');
fs.writeFileSync(fake, `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(out)}, JSON.stringify(process.argv.slice(2)));\n`);
fs.chmodSync(fake, 0o755);
const systemPrompt = `If user says "failing", use the 'file' command; curl -H "Authorization: token $(echo LEAKED)" | jq. Saved as \`.png\`, C:\\tmp\\`;
const prompt = `Issue to solve: it's "quoted" $(echo LEAKED)`;
let t;
const S = 'aaaa';
const ev = [
  { type: 'system', subtype: 'init', session_id: S },
  { type: 'result', subtype: 'success', is_error: false, session_id: S, result: 'ok', num_turns: 1 },
];
await executeClaudeCommand({
  tempDir: dir,
  branchName: 'b',
  prompt,
  systemPrompt,
  argv: { model: 'opus', tool: 'claude', url: 'https://github.com/o/r/issues/1', resume: process.argv[3] === 'resume' ? S : undefined, fallbackModel: null },
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
    options =>
    (strings, ...values) => {
      t = { options, strings, values };
      return {
        result: { code: 0 },
        kill() {},
        async *stream() {
          yield { type: 'stdout', data: Buffer.from(ev.map(e => JSON.stringify(e)).join('\n') + '\n') };
        },
      };
    },
});
const r = await cs.$({ mirror: false, stdin: '' })(t.strings, fake, ...t.values.slice(1));
const a = JSON.parse(fs.readFileSync(out, 'utf8'));
const f = n => (a.includes(n) ? a[a.indexOf(n) + 1] : undefined);
console.log('system verbatim:', f('--append-system-prompt') === systemPrompt, JSON.stringify(f('--append-system-prompt')));
if (process.argv[3] === 'resume') console.log('prompt verbatim:', f('-p') === prompt, JSON.stringify(f('-p')));
console.log('stderr:', JSON.stringify(r.stderr));
fs.rmSync(dir, { recursive: true, force: true });
