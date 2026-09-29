// Issue #2301: turn repro-ceiling.sh captures (captured/run-<name>.tsv + .stderr.txt) into the compact
// replay fixtures tests/fixtures/issue-2301/live-<name>.jsonl. Long strings are cut to 400 characters;
// the stderr ceiling line is placed before the first stopped notification, where Claude Code writes it.
// Usage: node live-fixtures.mjs agent-ceiling agent-raised agent-resumed
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cut = value => (typeof value === 'string' ? (value.length > 400 ? `${value.slice(0, 400)}…` : value) : Array.isArray(value) ? value.map(cut) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cut(v)])) : value);
for (const name of process.argv.slice(2)) {
  const stderr = readFileSync(path.join(here, 'captured', `run-${name}.stderr.txt`), 'utf8')
    .split('\n')
    .filter(line => /Background tasks still running/.test(line));
  const out = [];
  for (const line of readFileSync(path.join(here, 'captured', `run-${name}.tsv`), 'utf8')
    .split('\n')
    .filter(Boolean)) {
    const [ts, json] = [line.slice(0, line.indexOf('\t')), line.slice(line.indexOf('\t') + 1)];
    const event = JSON.parse(json);
    const __logTs = new Date(Number(ts) * 1000).toISOString();
    if (stderr.length && event.subtype === 'task_notification' && event.status === 'stopped') out.push({ __logTs, __stderr: stderr.shift() });
    out.push({ __logTs, ...cut(event) });
  }
  const file = path.join(here, '..', '..', 'tests', 'fixtures', 'issue-2301', `live-${name}.jsonl`);
  writeFileSync(file, out.map(event => JSON.stringify(event)).join('\n') + '\n');
  console.log(`${file}: ${out.length} events`);
}
