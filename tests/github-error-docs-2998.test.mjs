#!/usr/bin/env node
/**
 * Issue #2998: errors that are fixed by a GitHub setting must link the GitHub
 * Docs page for it — in the CLI log, in merge failure resolutions, and in the
 * comments posted on GitHub.
 *
 * The error texts below are GitHub's own messages (see
 * docs/case-studies/issue-2998/README.md).
 *
 * Run with: node tests/github-error-docs-2998.test.mjs
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { findGitHubDocsForError, formatGitHubDocsLinesForError } from '../src/github-error-docs.lib.mjs';
import { resetDefaultGitHubDocsLocale, setDefaultGitHubDocsLocale } from '../src/github-docs-links.lib.mjs';
import { classifyMergeError } from '../src/merge-error-classification.lib.mjs';
import { buildAutomationStopComment } from '../src/automation-stop-reporting.lib.mjs';
import { buildGitHubDocsSection, buildPrePullRequestFailureComment } from '../src/solve.pre-pr-failure-notifier.lib.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    failed++;
  }
}

const topicsOf = text => findGitHubDocsForError(text, { locale: 'en' }).map(match => match.topic);

const GITHUB_MESSAGES = {
  protectedBranch: 'remote: error: GH006: Protected branch update failed for refs/heads/main.\nremote: error: Changes must be made through a pull request.',
  ruleset: 'remote: error: GH013: Repository rule violations found for refs/heads/main.\nremote: - Changes must be made through a pull request.',
  pushProtection: 'remote: error: GH013: Repository rule violations found for refs/heads/fix.\nremote: - GITHUB PUSH PROTECTION\nremote:   Push cannot contain secrets',
  emailPrivacy: 'remote: error: GH007: Your push would publish a private email address.',
  largeFile: "remote: error: File big.bin is 120.00 MB; this exceeds GitHub's file size limit of 100.00 MB\nremote: error: GH001: Large files detected.",
  workflowScope: '! [remote rejected] fix -> fix (refusing to allow an OAuth App to create or update workflow `.github/workflows/ci.yml` without `workflow` scope)',
  archived: 'remote: This repository was archived so it is read-only.\nfatal: unable to access',
  sso: 'GraphQL: Resource protected by organization SAML enforcement. You must grant your Personal Access token access to this organization.',
  rateLimit: 'HTTP 403: API rate limit exceeded for user ID 1.',
  notAccessible: 'GraphQL: Resource not accessible by integration (mergePullRequest)',
  pushDenied: "remote: Permission to acme/app.git denied to hive-bot.\nfatal: unable to access 'https://github.com/acme/app.git/': The requested URL returned error: 403",
};

await test('every GitHub rejection maps to the page that explains its setting', () => {
  assert.deepEqual(topicsOf(GITHUB_MESSAGES.protectedBranch), ['protectedBranches']);
  assert.deepEqual(topicsOf(GITHUB_MESSAGES.ruleset), ['rulesets', 'protectedBranches']);
  assert.deepEqual(topicsOf(GITHUB_MESSAGES.pushProtection), ['pushProtection'], 'push protection is GH013 too, but is not a ruleset problem');
  assert.deepEqual(topicsOf(GITHUB_MESSAGES.emailPrivacy), ['emailPrivacyPush']);
  assert.deepEqual(topicsOf(GITHUB_MESSAGES.largeFile), ['largeFiles']);
  assert.deepEqual(topicsOf(GITHUB_MESSAGES.workflowScope), ['tokenScopes']);
  assert.deepEqual(topicsOf(GITHUB_MESSAGES.archived), ['archivedRepository']);
  assert.deepEqual(topicsOf(GITHUB_MESSAGES.sso), ['tokenSso']);
  assert.deepEqual(topicsOf(GITHUB_MESSAGES.rateLimit), ['rateLimits', 'changeRepositoryRole']);
  assert.deepEqual(topicsOf(GITHUB_MESSAGES.notAccessible), ['resourceNotAccessible']);
  assert.deepEqual(topicsOf(GITHUB_MESSAGES.pushDenied), ['changeRepositoryRole']);
});

await test('unrelated or empty errors get no links', () => {
  assert.deepEqual(topicsOf('fatal: not a git repository'), []);
  assert.deepEqual(topicsOf(''), []);
  assert.deepEqual(topicsOf(null), []);
  assert.deepEqual(topicsOf(new Error('GH006: Protected branch update failed')), ['protectedBranches'], 'Error objects are read too');
});

await test('lines are "📖 Title: URL", localized and capped', () => {
  const [line] = formatGitHubDocsLinesForError(GITHUB_MESSAGES.archived, { locale: 'ru' });
  assert.equal(line, '📖 Archiving repositories: https://docs.github.com/ru/repositories/archiving-a-github-repository/archiving-repositories');
  assert.equal(formatGitHubDocsLinesForError(Object.values(GITHUB_MESSAGES).join('\n'), { max: 2 }).length, 2);
});

await test('merge failure resolutions link the setting that blocks the merge', () => {
  setDefaultGitHubDocsLocale('de');
  try {
    const blocked = classifyMergeError('GraphQL: At least 1 approving review is required by reviewers with write access. (mergePullRequest)');
    assert.equal(blocked.category, 'blocked');
    assert.ok(blocked.resolution.startsWith('Satisfy the branch protection requirements'), blocked.resolution);
    assert.ok(blocked.resolution.includes('https://docs.github.com/de/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches'), blocked.resolution);
    const permission = classifyMergeError(GITHUB_MESSAGES.notAccessible);
    assert.ok(permission.resolution.includes('#resource-not-accessible'), permission.resolution);
    assert.equal(classifyMergeError('Pull request is closed').resolution, 'The pull request is no longer open — nothing left to merge.', 'no link when no setting is involved');
    assert.equal(classifyMergeError('something completely unexpected').resolution, null);
    assert.ok(classifyMergeError(GITHUB_MESSAGES.rateLimit).resolution.includes('#exceeding-the-rate-limit'), 'unknown categories still get the link');
  } finally {
    resetDefaultGitHubDocsLocale();
  }
});

await test('the "automation stopped" comment has a GitHub Docs section without repeating links', () => {
  const body = buildAutomationStopComment({ reason: 'merge_failed', mode: 'auto-merge', message: GITHUB_MESSAGES.ruleset });
  assert.ok(body.includes('**GitHub Docs:**'), body);
  assert.ok(body.includes('- 📖 About rulesets: https://docs.github.com/'), body);
  assert.ok(body.includes('- 📖 About protected branches: https://docs.github.com/'), body);
  const resolution = classifyMergeError(GITHUB_MESSAGES.ruleset).resolution;
  const withResolution = buildAutomationStopComment({ reason: 'merge_failed', mode: 'auto-merge', message: GITHUB_MESSAGES.ruleset, details: [resolution] });
  const protectedUrl = 'managing-protected-branches/about-protected-branches';
  assert.equal(withResolution.split(protectedUrl).length - 1, 1, 'each page is linked once');
  const unrelated = buildAutomationStopComment({ reason: 'pull_request_closed', message: 'closed' });
  assert.ok(!unrelated.includes('GitHub Docs'), 'no empty section');
});

await test('the "solution draft failed" comment links the setting named in the reason', () => {
  const body = buildPrePullRequestFailureComment({ reason: `Failed to push branch\n${GITHUB_MESSAGES.emailPrivacy}`, owner: 'acme', repo: 'app', issueNumber: 7 });
  assert.ok(body.includes('### GitHub Docs\n- 📖 Blocking command line pushes that expose your personal email address: https://docs.github.com/'), body);
  assert.equal(buildGitHubDocsSection('Auto-restart limit reached'), '');
  assert.equal(buildGitHubDocsSection(GITHUB_MESSAGES.archived, 'see https://docs.github.com/en/repositories/archiving-a-github-repository/archiving-repositories'), '', 'links already in the action section are not repeated');
});

await test('CLI paths print the docs lines (source wiring)', async () => {
  const read = path => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');
  const autoPr = await read('solve.auto-pr.lib.mjs');
  assert.ok(autoPr.includes("formatGitHubDocsLine('archivedRepository')"), 'archived push');
  assert.ok(autoPr.includes('buildWriteAccessRequiredMessage('), 'permission-denied push uses the access guide');
  assert.ok(autoPr.includes('formatGitHubDocsLinesForError(errorOutput)'), 'other push errors');
  assert.ok(autoPr.includes('Option 2: Get write access to the repository itself'), 'the push-denied alternative asks for write access');
  const forkDetection = await read('solve.fork-detection.lib.mjs');
  assert.ok(forkDetection.includes("formatGitHubDocsLine('repositoryForkingPolicy')") && forkDetection.includes("formatGitHubDocsLine('allowMaintainerEdits')"));
  const githubLib = await read('github.lib.mjs');
  assert.ok(githubLib.includes("buildGitHubDocsUrl('allowMaintainerEdits')"), 'the maintainer access comment uses the catalogue');
  assert.ok(githubLib.includes("docs: 'tokenScopes'"), 'missing token scopes');
  assert.ok((await read('github-rate-limit.lib.mjs')).includes("formatGitHubDocsLine('rateLimits')"));
  assert.ok((await read('solve.fork-sync.lib.mjs')).includes('formatGitHubDocsLinesForError(errorMsg)'));
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
