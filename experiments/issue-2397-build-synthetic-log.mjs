// Build synthetic logs from a checkout of konard/vietnam-accomodation-search
// (default /tmp/vas): raw concatenation and Codex-JSON-wrapped variants.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repo = process.argv[2] || '/tmp/vas';
const outDir = process.argv[3] || '/tmp/issue-2397';
fs.mkdirSync(outDir, { recursive: true });
const files = execFileSync('git', ['ls-files'], { cwd: repo, encoding: 'utf8' }).split('\n').filter(Boolean);
const parts = [];
for (const f of files) {
  const p = path.join(repo, f);
  let buf;
  try {
    buf = fs.readFileSync(p);
  } catch {
    continue;
  }
  if (buf.length > 2_000_000 || buf.includes(0)) continue; // skip binaries / huge
  parts.push({ name: f, text: buf.toString('utf8') });
}
let gitLog = '';
try {
  gitLog = execFileSync('git', ['log', '-p', '-7'], { cwd: repo, encoding: 'utf8', maxBuffer: 200e6 });
} catch {}
parts.push({ name: 'GIT_LOG_P', text: gitLog });

const raw = parts.map(p => `===== ${p.name} =====\n${p.text}\n`).join('');
fs.writeFileSync(path.join(outDir, 'raw.log'), raw);
const json = parts.map(p => JSON.stringify({ type: 'item.completed', item: { id: 'item_1', type: 'command_execution', command: `bash -lc 'cat ${p.name}'`, aggregated_output: p.text, exit_code: 0, status: 'completed' } }) + '\n').join('');
fs.writeFileSync(path.join(outDir, 'codex-json.log'), json);
// per-file inputs for bisect
fs.writeFileSync(path.join(outDir, 'parts.json'), JSON.stringify(parts));
console.log('files', parts.length, 'raw bytes', Buffer.byteLength(raw), 'json bytes', Buffer.byteLength(json));
