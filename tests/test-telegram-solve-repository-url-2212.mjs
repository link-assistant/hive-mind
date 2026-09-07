#!/usr/bin/env node

/**
 * Regression test for issue #2212 — Telegram side.
 *
 * The issue asks to "allow to pass repository link to /solve commands". The CLI
 * side is covered by tests/test-solve-repository-mode-2212.mjs; this test covers
 * the Telegram bot, where `/solve` used to reject repository URLs *before* solve
 * ever ran, because validateGitHubUrl() was called with the default
 * allowedTypes = ['issue', 'pull'].
 *
 * It checks:
 *   1. a repository URL really parses as type 'repo' (so the gate below is the
 *      only thing that rejected it),
 *   2. the allowedTypes gate rejects it with the old list and accepts it with
 *      the new one, while still rejecting the list URLs it always rejected,
 *   3. the /solve handler in src/telegram-bot.mjs passes 'repo' in allowedTypes,
 *   4. the info block label for a repository URL is the generic "URL" one — a
 *      repository is neither an issue nor a pull request,
 *   5. validateGitHubEntityExistence() skips the issue/PR existence check when
 *      no number is given, so a repository URL passes the pre-flight check.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2212
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseGitHubUrl } from '../src/github-url-parser.lib.mjs';
import { buildTelegramInfoBlock } from '../src/telegram-ui-messages.lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, '..', 'src');

let passed = 0;
let failed = 0;

function pass(name) {
  console.log(`✅ ${name}`);
  passed++;
}

function fail(name, expected, actual) {
  console.log(`❌ ${name}`);
  console.log(`   expected: ${expected}`);
  console.log(`   actual:   ${actual}`);
  failed++;
}

function assertEqual(name, actual, expected) {
  if (actual === expected) pass(name);
  else fail(name, JSON.stringify(expected), JSON.stringify(actual));
}

function assertTrue(name, condition, detail = '') {
  if (condition) pass(name);
  else fail(name, 'true', detail || 'false');
}

console.log('\n================================================================================');
console.log('Issue #2212: /solve accepts a repository URL in the Telegram bot');
console.log('================================================================================\n');

// Standin for the allowedTypes gate of validateGitHubUrl() in telegram-bot.mjs.
// Only the accept/reject decision matters here, not the wording of the error.
function passesTypeGate(url, allowedTypes) {
  const parsed = parseGitHubUrl(url);
  if (!parsed.valid) return false;
  return allowedTypes.includes(parsed.type);
}

const REPO_URL = 'https://github.com/link-assistant/hive-mind';
const ISSUE_URL = 'https://github.com/link-assistant/hive-mind/issues/2212';
const PULL_URL = 'https://github.com/link-assistant/hive-mind/pull/2216';
const ISSUES_LIST_URL = 'https://github.com/link-assistant/hive-mind/issues';

console.log('📋 a repository URL parses as type "repo"\n');
{
  const parsed = parseGitHubUrl(REPO_URL);
  assertEqual('parseGitHubUrl(repo URL).valid', parsed.valid, true);
  assertEqual('parseGitHubUrl(repo URL).type', parsed.type, 'repo');
  assertEqual('parseGitHubUrl(repo URL).owner', parsed.owner, 'link-assistant');
  assertEqual('parseGitHubUrl(repo URL).repo', parsed.repo, 'hive-mind');
  assertEqual('parseGitHubUrl(repo URL).number is absent', parsed.number === undefined || parsed.number === null, true);
}

console.log('\n📋 the allowedTypes gate (reproduction + fix)\n');
{
  // Reproduction: this is what /solve did before the fix.
  assertEqual('OLD allowedTypes ["issue","pull"] rejects a repository URL', passesTypeGate(REPO_URL, ['issue', 'pull']), false);

  const NEW = ['issue', 'pull', 'repo'];
  assertEqual('NEW allowedTypes accepts a repository URL', passesTypeGate(REPO_URL, NEW), true);
  assertEqual('NEW allowedTypes still accepts an issue URL', passesTypeGate(ISSUE_URL, NEW), true);
  assertEqual('NEW allowedTypes still accepts a pull request URL', passesTypeGate(PULL_URL, NEW), true);
  // The issues-list URL is ambiguous (which issue?) and stays rejected.
  assertEqual('NEW allowedTypes still rejects an issues list URL', passesTypeGate(ISSUES_LIST_URL, NEW), false);
}

console.log('\n📋 source guard: the /solve handler allows repository URLs\n');
{
  const source = fs.readFileSync(path.join(srcDir, 'telegram-bot.mjs'), 'utf8');
  const lines = source.split('\n');
  const callLine = lines.find(line => line.includes('validateGitHubUrl(userArgs') && line.includes("positionalNames: ['issue-url']"));

  if (!callLine) {
    fail('locate the /solve validateGitHubUrl call in telegram-bot.mjs', 'one match', 'none');
  } else {
    const match = callLine.match(/allowedTypes:\s*\[([^\]]*)\]/);
    if (!match) {
      fail('/solve validateGitHubUrl call passes allowedTypes including "repo" (issue #2212)', "allowedTypes: ['issue', 'pull', 'repo']", callLine.trim());
    } else {
      const types = match[1]
        .split(',')
        .map(part => part.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
      assertTrue('/solve allowedTypes contains "repo"', types.includes('repo'), types.join(', '));
      assertTrue('/solve allowedTypes still contains "issue"', types.includes('issue'), types.join(', '));
      assertTrue('/solve allowedTypes still contains "pull"', types.includes('pull'), types.join(', '));
    }
  }
}

console.log('\n📋 info block label for a repository URL\n');
{
  // Mirrors the urlKind expression in the /solve handler.
  const urlKindFor = type => (type === 'pull' ? 'pullRequest' : type === 'repo' ? 'url' : 'issue');
  assertEqual('urlKind for "issue"', urlKindFor('issue'), 'issue');
  assertEqual('urlKind for "pull"', urlKindFor('pull'), 'pullRequest');
  assertEqual('urlKind for "repo"', urlKindFor('repo'), 'url');

  // The block is two lines: "<requested-by label>: <requester>" and
  // "<url label>: <url>". Split the second one on its first ": " and compare the
  // parts by equality. Searching the whole block for the URL would also pass for
  // a longer URL that merely contains this one -- which is both weaker than what
  // "the block shows this URL" means and what CodeQL reports as
  // js/incomplete-url-substring-sanitization.
  const urlLineOf = block => {
    const line = block.split('\n')[1] ?? '';
    const separator = line.indexOf(': ');
    return separator === -1 ? { label: line, url: '' } : { label: line.slice(0, separator), url: line.slice(separator + 2) };
  };

  const repoBlock = buildTelegramInfoBlock({ urlKind: urlKindFor('repo'), url: REPO_URL });
  assertEqual('repository info block shows exactly the repository URL', urlLineOf(repoBlock).url, REPO_URL);
  // Same URL, all three labels: the repo block must be the generic-URL one.
  assertEqual('repository info block is the generic-URL block verbatim', repoBlock, buildTelegramInfoBlock({ urlKind: 'url', url: REPO_URL }));
  assertTrue('repository info block is not labelled as an issue', urlLineOf(repoBlock).label !== urlLineOf(buildTelegramInfoBlock({ urlKind: 'issue', url: REPO_URL })).label, urlLineOf(repoBlock).label);
  assertTrue('repository info block is not labelled as a pull request', urlLineOf(repoBlock).label !== urlLineOf(buildTelegramInfoBlock({ urlKind: 'pullRequest', url: REPO_URL })).label, urlLineOf(repoBlock).label);
  // The mislabelling this assertion exists to catch: a handler that kept the
  // issue URL it was given instead of the repository URL /solve was invoked
  // with. That URL is REPO_URL plus a path, so it contains REPO_URL by
  // construction -- a containment check could not tell the two blocks apart,
  // which is why the comparison above is an equality one. See
  // experiments/issue-2212-codeql-url-substring.mjs.
  const mislabelledBlock = buildTelegramInfoBlock({ urlKind: 'url', url: `${REPO_URL}/issues/2212` });
  assertTrue('a block showing a longer URL that starts with the repository URL is rejected', urlLineOf(mislabelledBlock).url !== REPO_URL, urlLineOf(mislabelledBlock).url);

  // The issue label is still applied to an issue URL -- the fix widened the
  // accepted types, it did not relabel anything that already worked.
  const issueBlock = buildTelegramInfoBlock({ urlKind: urlKindFor('issue'), url: ISSUE_URL });
  assertEqual('issue info block shows exactly the issue URL', urlLineOf(issueBlock).url, ISSUE_URL);
  assertEqual('issue info block keeps the issue label', urlLineOf(issueBlock).label, urlLineOf(buildTelegramInfoBlock({ urlKind: 'issue', url: REPO_URL })).label);

  const source = fs.readFileSync(path.join(srcDir, 'telegram-bot.mjs'), 'utf8');
  assertTrue("telegram-bot.mjs maps a repo URL to the generic 'url' label", /urlKind:[^\n]*'repo'\s*\?\s*'url'/.test(source), 'urlKind expression does not handle repo');
}

console.log('\n📋 the entity pre-check tolerates a missing issue/PR number\n');
{
  // A repository URL has no number, so validateGitHubEntityExistence must stop
  // after the user/repo/branch checks instead of looking up issue #undefined.
  const source = fs.readFileSync(path.join(srcDir, 'github-entity-validation.lib.mjs'), 'utf8');
  assertTrue('validateGitHubEntityExistence guards the issue/PR check with `if (number)`', /\/\/ Step 3[^\n]*\n\s*if \(number\) \{/.test(source), 'no `if (number)` guard found before the issue/PR existence check');
}

console.log('\n================================================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('================================================================================\n');

process.exit(failed === 0 ? 0 : 1);
