#!/usr/bin/env node

/**
 * Issue #2154: is `ghcr.io/link-assistant/formal-ai` actually private?
 *
 * The daemon only ever said `unauthorized`, which is ambiguous — it is also what
 * a typo produces. GHCR's anonymous token endpoint disambiguates it, and the
 * three cases are distinguishable without any credentials:
 *
 *   - public package        → HTTP 200 and a pull token
 *   - private package       → HTTP 401 `UNAUTHORIZED: authentication required`
 *   - no such package /
 *     not visible to us     → HTTP 403 `DENIED: requested access … is denied`
 *
 * Run it (no credentials needed):
 *
 * ```bash
 * node experiments/issue-2154-ghcr-visibility-probe.mjs
 * node experiments/issue-2154-ghcr-visibility-probe.mjs --write docs/case-studies/issue-2154/data/registry-probes
 * ```
 *
 * Tokens in the written output are redacted: they are short-lived anonymous
 * pull tokens for public images, and the interesting part is the status code.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2154
 */

import fs from 'node:fs';
import path from 'node:path';

/** Each probe, with what its result would mean. */
const PROBES = [
  { name: 'token-link-assistant-formal-ai', repository: 'link-assistant/formal-ai', expectation: 'the image the incident could not pull' },
  { name: 'token-link-assistant-agent', repository: 'link-assistant/agent', expectation: 'control: another package in the same org' },
  { name: 'token-link-assistant-hive-mind-does-not-exist', repository: 'link-assistant/hive-mind-does-not-exist', expectation: 'control: a package that certainly does not exist' },
  { name: 'token-public-homebrew-core-hello', repository: 'homebrew/core/hello', expectation: 'control: a known-public package' },
  { name: 'token-public-actions-actions-runner', repository: 'actions/actions-runner', expectation: 'control: a known-public package' },
];

const classify = (status, body) => {
  if (status === 200 && body?.token) return 'public — anonymous pull is allowed';
  if (status === 401) return 'private — the package exists and requires credentials';
  if (status === 403) return 'absent or invisible — no such package for an anonymous caller';
  return `unexpected (HTTP ${status})`;
};

const outDir = process.argv.includes('--write') ? process.argv[process.argv.indexOf('--write') + 1] : null;
if (outDir) fs.mkdirSync(outDir, { recursive: true });

const results = [];
for (const probe of PROBES) {
  const url = `https://ghcr.io/token?service=ghcr.io&scope=repository:${probe.repository}:pull`;
  const response = await fetch(url);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  const verdict = classify(response.status, body);
  results.push({ ...probe, url, status: response.status, verdict, body: body.token ? { token: '<redacted: short-lived anonymous pull token>' } : body });
  console.log(`${String(response.status).padEnd(3)} ${probe.repository.padEnd(45)} ${verdict}`);
  if (outDir) fs.writeFileSync(path.join(outDir, `${probe.name}.json`), `${JSON.stringify(results.at(-1), null, 2)}\n`);
}

if (outDir) {
  fs.writeFileSync(path.join(outDir, 'ghcr-visibility-probe.json'), `${JSON.stringify({ endpoint: 'https://ghcr.io/token', method: 'GET (no credentials)', results }, null, 2)}\n`);
  console.log(`\nWrote ${results.length + 1} file(s) to ${outDir}`);
}
