#!/usr/bin/env node

/**
 * Issue #2194 — recovering GitHub URLs that were damaged in transit.
 *
 * Run: node examples/github-url-recovery-demo.mjs
 *
 * Every line below is a URL a real user could paste into /solve. Before the
 * recovery layer, each one either failed outright or — worse — parsed into
 * something that was not what the user was looking at.
 */

const { parseGitHubUrl } = await import('../src/github-url-parser.lib.mjs');
const { formatUrlRepairs, revealHiddenCharacters } = await import('../src/github-url-recovery.lib.mjs');

const CASES = [
  ['the reported case: "pulls" where "pull" was meant', 'https://github.com/G-Ivan-A/aether-orbis/pulls/30'],
  ['a zero-width space pasted into the repo name', 'https://github.com/G-Ivan-A/aether-orbis​/pull/30'],
  ['a soft hyphen from a line-wrapped copy', 'https://github.com/G-Ivan-A/aether­orbis/pull/30'],
  ['a byte order mark in front of the URL', '﻿https://github.com/G-Ivan-A/aether-orbis/pull/30'],
  ['a non-breaking space instead of a space', 'https://github.com/G-Ivan-A/aether-orbis/pull/30 '],
  ['a tab page instead of the pull request', 'https://github.com/G-Ivan-A/aether-orbis/pull/30/files'],
  ['a full-width colon from an IME', 'https：//github.com/G-Ivan-A/aether-orbis/pull/30'],
  ['full-width digits from an IME', 'https://github.com/G-Ivan-A/aether-orbis/pull/３０'],
  ['a markdown link pasted whole', '[PR 30](https://github.com/G-Ivan-A/aether-orbis/pull/30)'],
  ['a URL in brackets at the end of a sentence', '(https://github.com/G-Ivan-A/aether-orbis/pull/30).'],
  ['an SSH remote instead of a web URL', 'git@github.com:G-Ivan-A/aether-orbis.git'],
  ['an API URL from a script', 'https://api.github.com/repos/G-Ivan-A/aether-orbis/pulls/30'],
  ['a shouted host', 'HTTPS://GITHUB.COM/G-Ivan-A/aether-orbis/PULL/30'],
];

const REJECTED = [
  ['a different forge', 'https://gitlab.com/G-Ivan-A/aether-orbis/-/merge_requests/30'],
  ['a look-alike host', 'https://github.com.evil.example/G-Ivan-A/aether-orbis/pull/30'],
  ['github.com in someone else’s path', 'https://evil.example/github.com/G-Ivan-A/aether-orbis/pull/30'],
  ['an email address at github.com', 'support@github.com'],
  ['a Markdown link that names no host', '[the PR](aether-orbis)'],
];

console.log('Recovered\n=========\n');
for (const [label, url] of CASES) {
  const parsed = parseGitHubUrl(url);
  console.log(`• ${label}`);
  console.log(`    sent:   ${revealHiddenCharacters(url)}`);
  const what = parsed.number === undefined ? parsed.type : `${parsed.type} #${parsed.number}`;
  console.log(`    parsed: ${parsed.valid ? `${what} → ${parsed.canonical}` : `REJECTED (${parsed.error})`}`);
  if (parsed.repairs?.length) console.log(`    repairs: ${formatUrlRepairs(parsed.repairs)}`);
  console.log('');
}

console.log('Still rejected — recovery must never invent a GitHub URL\n===================================================\n');
for (const [label, url] of REJECTED) {
  const parsed = parseGitHubUrl(url);
  console.log(`• ${label}\n    sent:   ${url}\n    parsed: ${parsed.valid ? `ACCEPTED as ${parsed.canonical} — BUG` : `rejected (${parsed.error})`}\n`);
}
