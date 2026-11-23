#!/usr/bin/env node
// Issue #4029: list scripts that docker-pr-check executes or copies into the
// image under test but whose change does not set `docker=true` in
// scripts/detect-code-changes.mjs (false negative: the gate would be skipped).
import fs from 'node:fs';
import path from 'node:path';
const source = fs.readFileSync('scripts/detect-code-changes.mjs', 'utf8');
const dockerPattern = new RegExp(/const dockerPattern = \/(.+)\/;/u.exec(source)[1]);
const workflow = fs.readFileSync('.github/workflows/release.yml', 'utf8');
const job = /\n  docker-pr-check:\n([\s\S]*?)(?=\n  [a-z][\w-]*:\n)/u.exec(workflow)[1];
const seen = new Set();
const queue = [...job.matchAll(/(?:scripts|tests)\/[\w./-]+\.(?:mjs|sh|js)/gu)].map(m => m[0]);
while (queue.length) {
  const file = queue.shift();
  if (seen.has(file) || !fs.existsSync(file)) continue;
  seen.add(file);
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(/(?:scripts|tests)\/[\w./-]+\.(?:mjs|sh|js)|['"`]\.\/([\w.-]+\.(?:mjs|sh))['"`]|\b([\w-]+\.(?:lib\.)?mjs)\b/gu)) {
    const candidate = m[0].startsWith('scripts/') || m[0].startsWith('tests/') ? m[0] : path.join(path.dirname(file), m[1] || m[2]);
    if (fs.existsSync(candidate)) queue.push(candidate);
  }
}
// Runner plumbing that never reaches the image under test.
const plumbing = new Set(['scripts/free-disk-space.mjs', 'scripts/wait-for-npm.mjs', 'scripts/check-file-line-limits.sh']);
const missed = [...seen].filter(file => file.startsWith('scripts/') && !plumbing.has(file) && !dockerPattern.test(file)).sort();
console.log(`docker-pr-check reaches ${seen.size} script/test files; ${missed.length} do not trigger docker=true:`);
for (const file of missed) console.log(`  ${file}`);
process.exitCode = missed.length ? 1 : 0;
