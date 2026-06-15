#!/usr/bin/env node

/**
 * Unit tests for the `/fix --ci-cd` pure helpers (issue #1733).
 *
 * @hive-mind-test-suite default
 */

import assert from 'assert/strict';
import { buildCiCdIssueBody, buildCiCdIssueTitle, buildRunsSection, buildSolveArgs, buildTemplatesSection, CI_CD_TEMPLATES, mapLanguagesToTemplates, normalizeLanguages, parseFixRepository, partitionFixArgs, summarizeRunFailures, templateUrl } from '../src/fix.ci-cd.lib.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (error) {
    console.log(`FAIL: ${name}`);
    console.log(`  ${error.message}`);
    failed++;
  }
}

await test('CI_CD_TEMPLATES includes the PHP template (issue #1733)', () => {
  const php = CI_CD_TEMPLATES.find(t => t.key === 'php');
  assert.ok(php, 'PHP template must be present');
  assert.equal(php.repo, 'link-foundation/php-ai-driven-development-pipeline-template');
  assert.equal(templateUrl(php.repo), 'https://github.com/link-foundation/php-ai-driven-development-pipeline-template');
});

await test('parseFixRepository accepts repo URLs and shorthand, rejects issues', () => {
  assert.equal(parseFixRepository('https://github.com/link-assistant/hive-mind').fullName, 'link-assistant/hive-mind');
  assert.equal(parseFixRepository('link-assistant/hive-mind').fullName, 'link-assistant/hive-mind');
  assert.equal(parseFixRepository('https://github.com/link-assistant/hive-mind/issues/1'), null);
  assert.equal(parseFixRepository('not a url'), null);
});

await test('normalizeLanguages sorts by bytes descending', () => {
  const sorted = normalizeLanguages({ Shell: 100, JavaScript: 9000, Python: 500 });
  assert.deepEqual(
    sorted.map(l => l.name),
    ['JavaScript', 'Python', 'Shell']
  );
});

await test('mapLanguagesToTemplates sorts templates by detected bytes', () => {
  const { sortedTemplates } = mapLanguagesToTemplates({ Python: 100, JavaScript: 9000, Rust: 50 });
  assert.deepEqual(
    sortedTemplates.map(e => e.template.key),
    ['javascript', 'python', 'rust']
  );
});

await test('mapLanguagesToTemplates merges JavaScript and TypeScript into one template', () => {
  const { sortedTemplates } = mapLanguagesToTemplates({ JavaScript: 4000, TypeScript: 4000, Go: 1000 });
  const js = sortedTemplates.find(e => e.template.key === 'javascript');
  assert.ok(js);
  assert.equal(js.bytes, 8000);
  assert.deepEqual(js.languages.sort(), ['JavaScript', 'TypeScript']);
  // Only one JS template entry even though two languages mapped to it
  assert.equal(sortedTemplates.filter(e => e.template.key === 'javascript').length, 1);
});

await test('mapLanguagesToTemplates reports unmatched languages', () => {
  const { sortedTemplates, unmatchedLanguages } = mapLanguagesToTemplates({ Shell: 1000, JavaScript: 2000 });
  assert.deepEqual(
    sortedTemplates.map(e => e.template.key),
    ['javascript']
  );
  assert.deepEqual(unmatchedLanguages, ['Shell']);
});

await test('buildTemplatesSection prioritizes most-used language and falls back when none match', () => {
  const section = buildTemplatesSection({ Python: 9000, JavaScript: 100 });
  const pythonIndex = section.indexOf('Python');
  const jsIndex = section.indexOf('JavaScript / TypeScript');
  assert.ok(pythonIndex >= 0 && jsIndex >= 0);
  assert.ok(pythonIndex < jsIndex, 'Python template should come first');

  const fallback = buildTemplatesSection({ Shell: 100 });
  assert.match(fallback, /No language-specific template matched/);
  // All templates listed in fallback, including PHP
  assert.match(fallback, /php-ai-driven-development-pipeline-template/);
});

await test('summarizeRunFailures counts only completed non-passing runs', () => {
  const runs = [
    { status: 'completed', conclusion: 'success' },
    { status: 'completed', conclusion: 'failure' },
    { status: 'completed', conclusion: 'cancelled' },
    { status: 'completed', conclusion: 'skipped' },
    { status: 'in_progress', conclusion: null },
  ];
  const { total, failing } = summarizeRunFailures(runs);
  assert.equal(total, 5);
  assert.equal(failing, 2);
});

await test('buildRunsSection renders a table or a no-runs message', () => {
  assert.match(buildRunsSection([]), /No CI\/CD runs were found/);
  const table = buildRunsSection([{ name: 'CI', status: 'completed', conclusion: 'failure', html_url: 'https://example.com/run/1' }]);
  assert.match(table, /\| Workflow \| Status \| Conclusion \| Run \|/);
  assert.match(table, /\| CI \| completed \| failure \| \[run\]\(https:\/\/example.com\/run\/1\) \|/);
});

await test('buildCiCdIssueTitle includes repository name', () => {
  const title = buildCiCdIssueTitle({ fullName: 'owner/repo' });
  assert.match(title, /owner\/repo/);
  assert.match(title, /CI\/CD/);
});

await test('buildCiCdIssueBody contains all required sections and best-practices link', () => {
  const body = buildCiCdIssueBody({
    repository: { fullName: 'owner/repo', url: 'https://github.com/owner/repo' },
    defaultBranch: 'main',
    commit: { sha: 'abcdef1234567890', message: 'Fix things\nmore detail', url: 'https://github.com/owner/repo/commit/abcdef1' },
    runs: [{ name: 'CI', status: 'completed', conclusion: 'failure', html_url: 'https://example.com/run/1' }],
    languages: { JavaScript: 9000, Python: 1000 },
  });
  assert.match(body, /Detected languages/);
  assert.match(body, /Recommended CI\/CD templates/);
  assert.match(body, /Latest default-branch CI\/CD runs/);
  assert.match(body, /docs\/CI-CD-BEST-PRACTICES\.md/);
  assert.match(body, /abcdef1/); // short sha
  // Templates sorted by detected languages: JS first
  const jsIndex = body.indexOf('js-ai-driven-development-pipeline-template');
  const pyIndex = body.indexOf('python-ai-driven-development-pipeline-template');
  assert.ok(jsIndex >= 0 && pyIndex >= 0 && jsIndex < pyIndex);
});

await test('buildCiCdIssueBody uses a branch-fallback heading when runsSource is branch', () => {
  const body = buildCiCdIssueBody({
    repository: { fullName: 'owner/repo', url: 'https://github.com/owner/repo' },
    defaultBranch: 'main',
    commit: { sha: 'abcdef1234567890' },
    runs: [{ name: 'CI', status: 'completed', conclusion: 'failure', html_url: 'https://example.com/run/1' }],
    languages: { JavaScript: 9000 },
    runsSource: 'branch',
  });
  assert.match(body, /Recent CI\/CD runs on `main`/);
  assert.ok(!body.includes('Latest default-branch CI/CD runs'));
});

await test('buildRunsSection honors a custom empty message', () => {
  assert.match(buildRunsSection([], { emptyMessage: 'nothing here' }), /nothing here/);
});

await test('partitionFixArgs extracts repo + flags and forwards the rest to solve', () => {
  const parsed = partitionFixArgs(['https://github.com/owner/repo', '--ci-cd', '--tool', 'codex', '--model', 'gpt-5.5', '--think', 'max']);
  assert.equal(parsed.repository.fullName, 'owner/repo');
  assert.equal(parsed.ciCd, true);
  assert.equal(parsed.runSolve, true);
  assert.deepEqual(parsed.passthrough, ['--tool', 'codex', '--model', 'gpt-5.5', '--think', 'max']);
});

await test('partitionFixArgs honors --dry-run and --no-solve without forwarding them', () => {
  const parsed = partitionFixArgs(['owner/repo', '--ci-cd', '--dry-run', '--no-solve', '--verbose']);
  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.runSolve, false);
  assert.deepEqual(parsed.passthrough, ['--verbose']); // --verbose forwarded to solve
  assert.ok(!parsed.passthrough.includes('--dry-run'));
  assert.ok(!parsed.passthrough.includes('--no-solve'));
});

await test('buildSolveArgs prepends issue URL and adds --auto-merge once', () => {
  assert.deepEqual(buildSolveArgs({ issueUrl: 'https://github.com/o/r/issues/5', passthrough: ['--tool', 'codex'] }), ['https://github.com/o/r/issues/5', '--auto-merge', '--tool', 'codex']);
  // does not duplicate --auto-merge
  assert.deepEqual(buildSolveArgs({ issueUrl: 'https://github.com/o/r/issues/5', passthrough: ['--auto-merge', '--think', 'max'] }), ['https://github.com/o/r/issues/5', '--auto-merge', '--think', 'max']);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
