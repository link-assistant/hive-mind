#!/usr/bin/env node
/* global console, process */
// Issue #2837: list the distinct account identifiers committed in tracked files
// (counts and masked previews only — the values themselves are never printed).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const KEY = String.raw`(?:user\.email|user\.account_id|anthropic-organization-id|anthropic-workspace-id|chatgpt-account-id|openai-organization|openai-project|emailAddress|accountUuid|organizationUuid)`;
const FIELD = new RegExp(String.raw`(?:\\?["'])?\b${KEY}(?:\\?["'])?\s*[:=]\s*(?:\\?["'])?([^\s"'\\,;}\]&]+)`, 'g');
const isIdentity = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) || /^(?:wrkspc|org|user|proj)[-_][A-Za-z0-9]{8,}$/.test(value);

export const collectIdentityValues = text => {
  const values = new Set();
  for (const match of text.matchAll(FIELD)) if (isIdentity(match[1])) values.add(match[1]);
  return values;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = execFileSync('git', ['grep', '-lIE', 'user\\.(email|account_id)|anthropic-(organization|workspace)-id|chatgpt-account-id|emailAddress|accountUuid|organizationUuid'], { encoding: 'utf8', maxBuffer: 1 << 26 })
    .split('\n')
    .filter(Boolean);
  const counts = new Map();
  for (const file of files) for (const value of collectIdentityValues(fs.readFileSync(file, 'utf8'))) counts.set(value, (counts.get(value) || 0) + 1);
  const mask = value => `${value.slice(0, 3)}…${value.slice(-3)} (${value.length})`;
  for (const [value, count] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`${String(count).padStart(4)} files  ${mask(value)}`);
}
