#!/usr/bin/env node
// One-off helper used for the command-stream 1.x migration (PR #2297).
// command-stream@1 returns completed results whose stdout/stderr are
// CapturedReadable objects: always truthy, even for empty output. Rewrite
// boolean / fallback uses on the listed lines to compare the captured text.
import { readFileSync, writeFileSync } from 'node:fs';

const listFile = process.argv[2];
const byFile = new Map();
for (const entry of readFileSync(listFile, 'utf8').split('\n').filter(Boolean)) {
  const [file, line] = entry.split(':');
  if (!byFile.has(file)) byFile.set(file, new Set());
  byFile.get(file).add(Number(line));
}

// Error objects keep plain-string stdout/stderr; process/child streams must stay streams.
const skipOwner = /^(?:err|error|e|execError|catchErr|process|child|proc)$/;
const member = /\b([A-Za-z_$][A-Za-z0-9_$]*)(\?\.|\.)(stdout|stderr)\b(?!\s*(?:\?\.|\.)[A-Za-z(])(?!\s*=[^=])/g;
const booleanContext = (source, offset, length) => {
  const before = source.slice(0, offset).trimEnd();
  const after = source.slice(offset + length).trimStart();
  return /(?:\|\||&&|!|\(|\?\?|\?)$/.test(before) || /^(?:\|\||&&|\?(?!\.)|\)\s*\{)/.test(after);
};

for (const [file, lines] of byFile) {
  const source = readFileSync(file, 'utf8').split('\n');
  for (const line of lines) {
    const text = source[line - 1];
    source[line - 1] = text.replace(member, (match, owner, dot, stream, offset) => {
      if (skipOwner.test(owner)) return match;
      if (!booleanContext(text, offset, match.length)) return match;
      return `${owner}${dot}${stream}?.toString()`;
    });
  }
  writeFileSync(file, source.join('\n'));
}
