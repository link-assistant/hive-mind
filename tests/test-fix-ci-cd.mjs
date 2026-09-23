#!/usr/bin/env node

/**
 * Unit tests for the `/fix --ci-cd` pure helpers (issue #1733).
 *
 * @hive-mind-test-suite default
 */

import assert from 'assert/strict';
import { buildCiCdIssueBody, buildCiCdIssueTitle, buildRunsSection, buildSolveArgs, buildStandardPrompt, buildStandardPromptParagraphs, buildTemplatesSection, CI_CD_ISSUE_LABELS, CI_CD_ISSUE_TITLE, CI_CD_ISSUE_TYPE, CI_CD_TEMPLATES, countDuplicateRuns, DEBUG_OUTPUT_PARAGRAPH, dedupeRunsByWorkflow, FIX_SOLVE_OPTIONS, mapLanguagesToTemplates, normalizeLanguages, parseFixRepository, partitionFixArgs, REPORT_UPSTREAM_PARAGRAPH, summarizeRunFailures, templateUrl } from '../src/fix.ci-cd.lib.mjs';
import { createCiCdIssue, prepareCiCdIssue } from '../src/fix.ci-cd-issue.lib.mjs';
import { KEEP_WORKING_PROMPT } from '../src/solve.keep-working.detect.lib.mjs';
import { buildCreateIssueArgs, createTaskIssue } from '../src/task.issue-creation.lib.mjs';
import { isBugIssueType } from '../src/development-log.lib.mjs';

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

await test('buildCiCdIssueTitle is the web-capture#139 title verbatim (issue #1733)', () => {
  // Issue #1733: "use title and description exactly". The issue is created in
  // the target repository itself, so it carries no repository suffix.
  assert.equal(buildCiCdIssueTitle(), 'Check for all false positives, false negatives, warnings and errors in CI/CD and fix them all');
  assert.equal(buildCiCdIssueTitle(), CI_CD_ISSUE_TITLE);
});

await test('buildStandardPrompt omits the retired and solve-provided paragraphs', () => {
  const prompt = buildStandardPrompt({ templatesSorted: [] });
  // The old case-study path is retired; /solve re-injects the other omitted
  // instructions through deep analysis.
  assert.doesNotMatch(prompt, /docs\/case-studies\/issue-\{id\}/, 'legacy case-study path must be omitted');
  assert.ok(!prompt.includes(DEBUG_OUTPUT_PARAGRAPH), 'debug-output paragraph must be omitted');
  assert.ok(!prompt.includes(REPORT_UPSTREAM_PARAGRAPH), 'report-upstream paragraph must be omitted');
  // Retained: nothing else provides these.
  assert.match(prompt, /Use all the best practices from CI\/CD templates/);
  assert.match(prompt, /docs\/CI-CD-BEST-PRACTICES\.md/);
  assert.ok(prompt.includes(KEEP_WORKING_PROMPT), 'keep-working paragraph must be retained');
});

await test('buildStandardPrompt never restores the legacy case-study paragraph', () => {
  const prompt = buildStandardPrompt({ templatesSorted: [], omittedOptions: [] });
  assert.doesNotMatch(prompt, /docs\/case-studies\/issue-\{id\}/, 'legacy case-study paragraph conflicts with --development-log');
  assert.ok(prompt.includes(DEBUG_OUTPUT_PARAGRAPH));
  assert.ok(prompt.includes(REPORT_UPSTREAM_PARAGRAPH));
  assert.ok(prompt.includes(KEEP_WORKING_PROMPT));
});

await test('standard prompt has no development-log-controlled fallback paragraph', () => {
  const paragraphs = buildStandardPromptParagraphs({ templatesSorted: [] });
  assert.ok(
    paragraphs.every(paragraph => !paragraph.providedBy.includes('--development-log')),
    'development-log replaces the retired paragraph instead of conditionally hiding it'
  );
});

await test('buildStandardPrompt never restores the legacy paragraph for partial option sets', () => {
  const devLogOnly = buildStandardPrompt({ templatesSorted: [], omittedOptions: ['--development-log'] });
  assert.doesNotMatch(devLogOnly, /docs\/case-studies\/issue-\{id\}/, 'development-log path must replace legacy case studies');
  assert.ok(devLogOnly.includes(DEBUG_OUTPUT_PARAGRAPH), 'debug-output is deep-analysis-only');

  const deepOnly = buildStandardPrompt({ templatesSorted: [], omittedOptions: ['--deep-analysis'] });
  assert.doesNotMatch(deepOnly, /docs\/case-studies\/issue-\{id\}/, 'legacy case studies must never be supported');
  assert.ok(!deepOnly.includes(DEBUG_OUTPUT_PARAGRAPH), 'debug-output is provided by --deep-analysis alone');
});

await test('buildStandardPrompt lists templates sorted by detected languages', () => {
  const { sortedTemplates } = mapLanguagesToTemplates({ Python: 9000, JavaScript: 100 });
  const prompt = buildStandardPrompt({ templatesSorted: sortedTemplates });
  const pyIndex = prompt.indexOf('python-ai-driven-development-pipeline-template');
  const jsIndex = prompt.indexOf('js-ai-driven-development-pipeline-template');
  assert.ok(pyIndex >= 0 && jsIndex >= 0);
  assert.ok(pyIndex < jsIndex, 'Python template link should come first');
  // Unmatched languages fall back to the full template list.
  assert.match(buildStandardPrompt({ templatesSorted: [] }), /php-ai-driven-development-pipeline-template/);
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
  assert.match(body, /Context collected by <code>\/fix --ci-cd<\/code>/);
  // Templates sorted by detected languages: JS first
  const jsIndex = body.indexOf('js-ai-driven-development-pipeline-template');
  const pyIndex = body.indexOf('python-ai-driven-development-pipeline-template');
  assert.ok(jsIndex >= 0 && pyIndex >= 0 && jsIndex < pyIndex);
  // The runs (the evidence) lead; the collected context follows the prompt.
  assert.ok(body.indexOf('Latest default-branch CI/CD runs') < body.indexOf(KEEP_WORKING_PROMPT));
  assert.ok(body.indexOf(KEEP_WORKING_PROMPT) < body.indexOf('<details>'));
});

await test('buildCiCdIssueBody omits the parts /fix re-provides via solve options (issue #1733)', () => {
  const params = {
    repository: { fullName: 'owner/repo', url: 'https://github.com/owner/repo' },
    defaultBranch: 'main',
    commit: { sha: 'abcdef1234567890' },
    runs: [{ name: 'CI', status: 'completed', conclusion: 'failure', html_url: 'https://example.com/run/1' }],
    languages: { JavaScript: 9000 },
  };

  const body = buildCiCdIssueBody(params);
  assert.doesNotMatch(body, /docs\/case-studies\/issue-\{id\}/, 'case-study paragraph must be omitted by default');
  assert.ok(!body.includes(DEBUG_OUTPUT_PARAGRAPH), 'debug-output paragraph must be omitted by default');
  assert.ok(!body.includes(REPORT_UPSTREAM_PARAGRAPH), 'report-upstream paragraph must be omitted by default');

  // Legacy case-study output is never restored, even when no solve option is
  // omitted. Only the paragraphs genuinely controlled by deep-analysis return.
  const full = buildCiCdIssueBody({ ...params, omittedOptions: [] });
  assert.doesNotMatch(full, /docs\/case-studies\/issue-\{id\}/);
  assert.ok(full.includes(DEBUG_OUTPUT_PARAGRAPH));
  assert.ok(full.includes(REPORT_UPSTREAM_PARAGRAPH));
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

await test('dedupeRunsByWorkflow keeps the latest run per workflow (issue #2125)', () => {
  // Reproduces link-assistant/agent#287: the default-branch fallback returned
  // 20 runs of only 2 workflows, and every one of them became a table row.
  const runs = [
    { id: 3, name: 'JS CI/CD Pipeline', workflow_id: 1, status: 'completed', conclusion: 'failure', created_at: '2026-07-30T18:52:56Z', head_sha: 'cff4148471a8' },
    { id: 2, name: 'JS CI/CD Pipeline', workflow_id: 1, status: 'completed', conclusion: 'success', created_at: '2026-07-27T04:04:46Z', head_sha: 'acd21f2552e2' },
    { id: 1, name: 'Rust CI/CD Pipeline', workflow_id: 2, status: 'completed', conclusion: 'failure', created_at: '2026-07-04T00:13:55Z', head_sha: '7af549d416b9' },
  ];
  const deduped = dedupeRunsByWorkflow(runs);
  assert.deepEqual(
    deduped.map(run => run.id),
    [3, 1]
  );
  assert.equal(countDuplicateRuns(runs), 1);

  // Same workflow name, different workflow files — not duplicates.
  assert.equal(
    dedupeRunsByWorkflow([
      { name: 'CI', workflow_id: 10 },
      { name: 'CI', workflow_id: 11 },
    ]).length,
    2
  );
  // Re-run attempts of one workflow collapse to the newest attempt.
  const attempts = dedupeRunsByWorkflow([
    { id: 5, name: 'CI', workflow_id: 1, run_attempt: 1, created_at: '2026-07-30T18:00:00Z' },
    { id: 5, name: 'CI', workflow_id: 1, run_attempt: 2, created_at: '2026-07-30T18:00:00Z' },
  ]);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].run_attempt, 2);
});

await test('buildRunsSection collapses duplicate workflow runs and can show commits (issue #2125)', () => {
  const runs = [
    { name: 'JS CI/CD Pipeline', workflow_id: 1, status: 'completed', conclusion: 'failure', created_at: '2026-07-30T18:52:56Z', head_sha: 'cff4148471a84639', html_url: 'https://example.com/run/3' },
    { name: 'JS CI/CD Pipeline', workflow_id: 1, status: 'completed', conclusion: 'success', created_at: '2026-07-27T04:04:46Z', head_sha: 'acd21f2552e27890', html_url: 'https://example.com/run/2' },
  ];
  const table = buildRunsSection(runs);
  assert.equal(table.split('\n').length, 3, 'header, separator and a single data row');
  assert.match(table, /run\/3/);
  assert.ok(!table.includes('run/2'));

  const withCommit = buildRunsSection(runs, { includeCommit: true });
  assert.match(withCommit, /\| Workflow \| Status \| Conclusion \| Commit \| Run \|/);
  assert.match(withCommit, /`cff4148`/);
});

await test('summarizeRunFailures counts one run per workflow (issue #2125)', () => {
  const runs = [
    { name: 'CI', workflow_id: 1, status: 'completed', conclusion: 'success', created_at: '2026-07-30T00:00:00Z' },
    { name: 'CI', workflow_id: 1, status: 'completed', conclusion: 'failure', created_at: '2026-07-01T00:00:00Z' },
  ];
  assert.deepEqual(summarizeRunFailures(runs), { total: 1, failing: 0 });
});

await test('prepareCiCdIssue deduplicates recent default-branch runs (issue #2125)', async () => {
  const repository = parseFixRepository('owner/repo');
  const logs = [];
  const branchRuns = [
    { id: 3, name: 'JS CI/CD Pipeline', workflow_id: 1, status: 'completed', conclusion: 'failure', created_at: '2026-07-30T18:52:56Z', head_sha: 'cff4148471a84639', html_url: 'https://github.com/owner/repo/actions/runs/3' },
    { id: 2, name: 'JS CI/CD Pipeline', workflow_id: 1, status: 'completed', conclusion: 'failure', created_at: '2026-07-27T04:04:46Z', head_sha: 'acd21f2552e27890', html_url: 'https://github.com/owner/repo/actions/runs/2' },
    { id: 1, name: 'Rust CI/CD Pipeline', workflow_id: 2, status: 'completed', conclusion: 'failure', created_at: '2026-07-04T00:13:55Z', head_sha: '7af549d416b9c22d', html_url: 'https://github.com/owner/repo/actions/runs/1' },
  ];
  const run = async (command, args) => {
    const endpoint = args[1] || '';
    if (endpoint.endsWith('/languages')) return { code: 0, stdout: JSON.stringify({ JavaScript: 900 }), stderr: '' };
    if (endpoint === 'repos/owner/repo') return { code: 0, stdout: 'main\n', stderr: '' };
    if (endpoint === 'repos/owner/repo/commits/main') return { code: 0, stdout: JSON.stringify({ sha: 'abcdef1234567890', message: '0.25.4', url: 'https://github.com/owner/repo/commit/abcdef1234567890' }), stderr: '' };
    // Exercise the paginated combined-history fallback when workflow inventory
    // is unavailable; it must still deduplicate one row per workflow.
    if (endpoint.includes('actions/workflows?')) return { code: 1, stdout: '', stderr: 'inventory unavailable' };
    // The exact-SHA response remains as a fallback if the branch query is empty.
    if (endpoint.includes('actions/runs?head_sha=')) return { code: 0, stdout: '[]', stderr: '' };
    if (endpoint.includes('actions/runs?branch=')) return { code: 0, stdout: JSON.stringify([{ workflow_runs: branchRuns }]), stderr: '' };
    return { code: 1, stdout: '', stderr: `Unexpected command: ${command} ${args.join(' ')}` };
  };

  const prepared = await prepareCiCdIssue({ repository, run, log: message => logs.push(message) });
  assert.equal(prepared.runsSource, 'branch');
  assert.equal(prepared.fetchedRuns, 3);
  assert.equal(prepared.duplicateRuns, 1);
  assert.equal(prepared.runs.length, 2);
  assert.equal(logs.filter(message => message.includes('Collapsed 1')).length, 1, 'verbose line explains the collapse');
  assert.match(prepared.body, /Recent CI\/CD runs on `main`/);
  assert.match(prepared.body, /\*\*CI\/CD runs found:\*\* 2 \(2 not passing\)/);
  assert.ok(!prepared.body.includes('actions/runs/2'), 'the older JS run must not be listed again');
});

await test('prepareCiCdIssue includes failed workflows from the preceding commit (issue #2286)', async () => {
  // The merge commit that opened #2286 had two successful auxiliary workflows.
  // Because the exact-SHA lookup was non-empty, the old fallback never fetched
  // the failed Checks and release run on the commit immediately before it.
  const repository = parseFixRepository('owner/repo');
  const latestSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const failedSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const exactRuns = [
    { id: 3, name: 'Dependabot Updates', workflow_id: 3, status: 'completed', conclusion: 'success', created_at: '2026-09-21T19:40:00Z', head_sha: latestSha },
    { id: 2, name: 'Formal AI Draft', workflow_id: 2, status: 'completed', conclusion: 'success', created_at: '2026-09-21T19:39:00Z', head_sha: latestSha },
  ];
  const branchRuns = [...exactRuns, { id: 1, name: 'Checks and release', workflow_id: 1, status: 'completed', conclusion: 'failure', created_at: '2026-09-21T19:27:06Z', head_branch: 'main', head_sha: failedSha, html_url: 'https://github.com/owner/repo/actions/runs/1' }].map(item => ({ head_branch: 'main', ...item }));
  const calls = [];
  const run = async (command, args) => {
    calls.push({ command, args });
    const endpoint = args[1] || '';
    if (endpoint.endsWith('/languages')) return { code: 0, stdout: JSON.stringify({ JavaScript: 900 }), stderr: '' };
    if (endpoint === 'repos/owner/repo') return { code: 0, stdout: 'main\n', stderr: '' };
    if (endpoint === 'repos/owner/repo/commits/main') return { code: 0, stdout: JSON.stringify({ sha: latestSha, message: 'Merge release', url: `https://github.com/owner/repo/commit/${latestSha}` }), stderr: '' };
    if (endpoint.includes('actions/workflows?')) return { code: 0, stdout: JSON.stringify([{ workflows: [1, 2, 3].map(id => ({ id, state: 'active' })) }]), stderr: '' };
    const workflowMatch = endpoint.match(/actions\/workflows\/(\d+)\/runs\?/);
    if (workflowMatch) return { code: 0, stdout: JSON.stringify({ workflow_runs: branchRuns.filter(item => item.workflow_id === Number(workflowMatch[1])) }), stderr: '' };
    if (endpoint.includes('actions/runs?head_sha=')) return { code: 0, stdout: JSON.stringify(exactRuns), stderr: '' };
    if (endpoint.includes('actions/runs?branch=')) return { code: 0, stdout: JSON.stringify(branchRuns), stderr: '' };
    return { code: 1, stdout: '', stderr: `Unexpected command: ${command} ${args.join(' ')}` };
  };

  const prepared = await prepareCiCdIssue({ repository, run });

  assert.equal(prepared.runsSource, 'branch', 'repository health must come from recent branch runs, not only the newest SHA');
  assert.equal(prepared.runs.length, 3);
  assert.equal(prepared.runs.find(item => item.workflow_id === 1)?.conclusion, 'failure');
  assert.match(prepared.body, /actions\/runs\/1/, 'the omitted failed release run must be included in the generated issue');
  assert.match(prepared.body, /\*\*CI\/CD runs found:\*\* 3 \(1 not passing\)/);
  const workflowCalls = calls.filter(call => call.args[1]?.includes('/actions/workflows/') && call.args[1]?.includes('/runs?'));
  assert.equal(workflowCalls.length, 3, 'the latest run of every active workflow must be fetched even when the latest commit already has runs');
  assert.ok(
    workflowCalls.every(call => call.args[1].includes('per_page=100') && !call.args[1].includes('branch=')),
    'per-workflow queries validate the default branch locally instead of trusting GitHub branch-search freshness'
  );
});

await test('prepareCiCdIssue cannot crowd out a quiet workflow behind 1,000 busy-workflow runs (issue #2286)', async () => {
  // GitHub caps filtered workflow-run searches at 1,000 results. Dependabot
  // can occupy much of that window, and offset pagination can move while new
  // runs arrive. Querying the latest run of each active workflow directly is
  // the only way to prove that a quieter required workflow was inspected.
  const repository = parseFixRepository('owner/repo');
  const calls = [];
  const run = async (command, args) => {
    calls.push({ command, args });
    const endpoint = args[1] || '';
    if (endpoint.endsWith('/languages')) return { code: 0, stdout: JSON.stringify({ JavaScript: 900 }), stderr: '' };
    if (endpoint === 'repos/owner/repo') return { code: 0, stdout: 'main\n', stderr: '' };
    if (endpoint === 'repos/owner/repo/commits/main') return { code: 0, stdout: JSON.stringify({ sha: 'latest', message: 'Latest change' }), stderr: '' };
    if (endpoint.includes('actions/workflows?')) return { code: 0, stdout: JSON.stringify([{ workflows: [1, 2].map(id => ({ id, state: 'active' })) }]), stderr: '' };
    if (endpoint.includes('actions/workflows/1/runs?')) {
      return { code: 0, stdout: JSON.stringify({ workflow_runs: [{ id: 10, workflow_id: 1, name: 'Quiet required workflow', head_branch: 'main', status: 'completed', conclusion: 'failure', created_at: '2026-09-21T19:27:06Z' }] }), stderr: '' };
    }
    if (endpoint.includes('actions/workflows/2/runs?')) {
      return { code: 0, stdout: JSON.stringify({ workflow_runs: [{ id: 20, workflow_id: 2, name: 'Busy workflow', head_branch: 'main', status: 'completed', conclusion: 'success', created_at: '2026-09-23T14:33:33Z' }] }), stderr: '' };
    }
    // Reproduce the capped combined query: only the busy workflow survived.
    if (endpoint.includes('actions/runs?branch=')) {
      return { code: 0, stdout: JSON.stringify([{ workflow_runs: [{ id: 20, workflow_id: 2, name: 'Busy workflow', status: 'completed', conclusion: 'success', created_at: '2026-09-23T14:33:33Z' }] }]), stderr: '' };
    }
    return { code: 1, stdout: '', stderr: `Unexpected command: ${command} ${args.join(' ')}` };
  };

  const prepared = await prepareCiCdIssue({ repository, run });

  assert.deepEqual(
    prepared.runs.map(item => item.workflow_id),
    [2, 1],
    'the latest run of every active workflow must be collected even when the combined history is capped'
  );
  assert.equal(prepared.runs.find(item => item.workflow_id === 1)?.conclusion, 'failure');
  assert.equal(calls.filter(call => call.args[1]?.includes('/actions/workflows/') && call.args[1]?.includes('/runs?')).length, 2);
});

await test('prepareCiCdIssue verifies default-branch recency outside GitHub branch search (issue #2286)', async () => {
  // GitHub's workflow-specific `branch=main` search returned run 35013947631
  // while the same endpoint without that server-side filter returned newer main
  // run 35644890960. Select the branch locally from the workflow's time-ordered
  // runs so a stale search index cannot reintroduce the original omission.
  const repository = parseFixRepository('owner/repo');
  const calls = [];
  const run = async (command, args) => {
    calls.push({ command, args });
    const endpoint = args[1] || '';
    if (endpoint.endsWith('/languages')) return { code: 0, stdout: JSON.stringify({ JavaScript: 900 }), stderr: '' };
    if (endpoint === 'repos/owner/repo') return { code: 0, stdout: 'main\n', stderr: '' };
    if (endpoint === 'repos/owner/repo/commits/main') return { code: 0, stdout: JSON.stringify({ sha: 'latest', message: 'Latest change' }), stderr: '' };
    if (endpoint.includes('actions/workflows?')) return { code: 0, stdout: JSON.stringify([{ workflows: [{ id: 1, state: 'active' }] }]), stderr: '' };
    if (endpoint.includes('actions/workflows/1/runs?branch=main')) {
      return { code: 0, stdout: JSON.stringify({ workflow_runs: [{ id: 35013947631, workflow_id: 1, name: 'Checks and release', head_branch: 'main', conclusion: 'failure', created_at: '2026-09-15T19:29:37Z' }] }), stderr: '' };
    }
    if (endpoint.includes('actions/workflows/1/runs?')) {
      return {
        code: 0,
        stdout: JSON.stringify({
          workflow_runs: [
            { id: 35870842395, workflow_id: 1, name: 'Checks and release', head_branch: 'issue-2286', conclusion: 'failure', created_at: '2026-09-23T13:58:43Z' },
            { id: 35644890960, workflow_id: 1, name: 'Checks and release', head_branch: 'main', conclusion: 'failure', created_at: '2026-09-21T19:27:06Z' },
          ],
        }),
        stderr: '',
      };
    }
    return { code: 1, stdout: '', stderr: `Unexpected command: ${command} ${args.join(' ')}` };
  };

  const prepared = await prepareCiCdIssue({ repository, run });

  assert.equal(prepared.runs[0]?.id, 35644890960, 'local branch selection must retain the newest default-branch run');
  assert.ok(
    calls.some(call => call.args[1]?.includes('actions/workflows/1/runs?') && !call.args[1].includes('branch=')),
    'the collector must not trust the stale server-side branch filter as its primary source'
  );
});

await test('prepareCiCdIssue scans later workflow pages for the default branch (issue #2286)', async () => {
  const repository = parseFixRepository('owner/repo');
  const calls = [];
  const run = async (command, args) => {
    calls.push({ command, args });
    const endpoint = args[1] || '';
    if (endpoint.endsWith('/languages')) return { code: 0, stdout: JSON.stringify({ JavaScript: 900 }), stderr: '' };
    if (endpoint === 'repos/owner/repo') return { code: 0, stdout: 'main\n', stderr: '' };
    if (endpoint === 'repos/owner/repo/commits/main') return { code: 0, stdout: JSON.stringify({ sha: 'latest', message: 'Latest change' }), stderr: '' };
    if (endpoint.includes('actions/workflows?')) return { code: 0, stdout: JSON.stringify([{ workflows: [{ id: 1, state: 'active' }] }]), stderr: '' };
    if (endpoint.includes('actions/workflows/1/runs?') && endpoint.includes('&page=1')) {
      return {
        code: 0,
        stdout: JSON.stringify({
          workflow_runs: Array.from({ length: 100 }, (_, index) => ({ id: 1000 - index, workflow_id: 1, name: 'Busy workflow', head_branch: `feature-${index}`, conclusion: 'success', created_at: '2026-09-23T14:00:00Z' })),
        }),
        stderr: '',
      };
    }
    if (endpoint.includes('actions/workflows/1/runs?') && endpoint.includes('&page=2')) {
      return { code: 0, stdout: JSON.stringify({ workflow_runs: [{ id: 899, workflow_id: 1, name: 'Busy workflow', head_branch: 'main', conclusion: 'failure', created_at: '2026-09-20T14:00:00Z' }] }), stderr: '' };
    }
    return { code: 1, stdout: '', stderr: `Unexpected command: ${command} ${args.join(' ')}` };
  };

  const prepared = await prepareCiCdIssue({ repository, run });

  assert.equal(prepared.runs[0]?.id, 899);
  assert.ok(
    calls.some(call => call.args[1]?.includes('actions/workflows/1/runs?') && call.args[1]?.includes('&page=2')),
    'a full page without the default branch must advance to the next page'
  );
});

await test('prepareCiCdIssue falls back rather than accepting partial per-workflow results (issue #2286)', async () => {
  const repository = parseFixRepository('owner/repo');
  const calls = [];
  const run = async (command, args) => {
    calls.push({ command, args });
    const endpoint = args[1] || '';
    if (endpoint.endsWith('/languages')) return { code: 0, stdout: JSON.stringify({ JavaScript: 900 }), stderr: '' };
    if (endpoint === 'repos/owner/repo') return { code: 0, stdout: 'main\n', stderr: '' };
    if (endpoint === 'repos/owner/repo/commits/main') return { code: 0, stdout: JSON.stringify({ sha: 'latest', message: 'Latest change' }), stderr: '' };
    if (endpoint.includes('actions/workflows?')) return { code: 0, stdout: JSON.stringify([{ workflows: [1, 2].map(id => ({ id, state: 'active' })) }]), stderr: '' };
    if (endpoint.includes('actions/workflows/1/runs?')) return { code: 1, stdout: '', stderr: 'temporary API failure' };
    if (endpoint.includes('actions/workflows/2/runs?')) {
      return { code: 0, stdout: JSON.stringify({ workflow_runs: [{ id: 20, workflow_id: 2, name: 'Successful workflow', head_branch: 'main', conclusion: 'success', created_at: '2026-09-23T14:00:00Z' }] }), stderr: '' };
    }
    if (endpoint.includes('actions/runs?branch=')) {
      return {
        code: 0,
        stdout: JSON.stringify([
          {
            workflow_runs: [
              { id: 20, workflow_id: 2, name: 'Successful workflow', conclusion: 'success', created_at: '2026-09-23T14:00:00Z' },
              { id: 10, workflow_id: 1, name: 'Failed required workflow', conclusion: 'failure', created_at: '2026-09-23T13:00:00Z' },
            ],
          },
        ]),
        stderr: '',
      };
    }
    return { code: 1, stdout: '', stderr: `Unexpected command: ${command} ${args.join(' ')}` };
  };

  const prepared = await prepareCiCdIssue({ repository, run, warn: () => {} });

  assert.equal(prepared.runs.length, 2, 'a failed per-workflow query must not silently omit that workflow');
  assert.equal(prepared.runs.find(item => item.workflow_id === 1)?.conclusion, 'failure');
  assert.ok(
    calls.some(call => call.args[1]?.includes('actions/runs?branch=')),
    'partial results must trigger the combined-history fallback'
  );
});

await test('prepareCiCdIssue excludes deleted workflows from branch history (issue #2286)', async () => {
  const repository = parseFixRepository('owner/repo');
  const run = async (command, args) => {
    const endpoint = args[1] || '';
    if (endpoint.endsWith('/languages')) return { code: 0, stdout: JSON.stringify({ JavaScript: 900 }), stderr: '' };
    if (endpoint === 'repos/owner/repo') return { code: 0, stdout: 'main\n', stderr: '' };
    if (endpoint === 'repos/owner/repo/commits/main') return { code: 0, stdout: JSON.stringify({ sha: 'abcdef1234567890', message: 'Latest change' }), stderr: '' };
    if (endpoint.includes('actions/workflows?')) {
      return { code: 0, stdout: JSON.stringify([{ workflows: [{ id: 1, name: 'Checks and release', path: '.github/workflows/release.yml', state: 'active' }] }]), stderr: '' };
    }
    if (endpoint.includes('actions/workflows/1/runs?')) {
      return {
        code: 0,
        stdout: JSON.stringify({ workflow_runs: [{ id: 2, name: 'Checks and release', workflow_id: 1, head_branch: 'main', status: 'completed', conclusion: 'failure', created_at: '2026-09-21T19:27:06Z' }] }),
        stderr: '',
      };
    }
    if (endpoint.includes('actions/runs?branch=')) {
      return { code: 0, stdout: JSON.stringify([{ workflow_runs: [{ id: 1, name: 'Deleted legacy workflow', workflow_id: 99, status: 'completed', conclusion: 'failure', created_at: '2025-12-11T21:36:26Z' }] }]), stderr: '' };
    }
    return { code: 1, stdout: '', stderr: `Unexpected command: ${command} ${args.join(' ')}` };
  };

  const prepared = await prepareCiCdIssue({ repository, run });

  assert.deepEqual(
    prepared.runs.map(item => item.name),
    ['Checks and release'],
    'a deleted workflow must not remain a permanent false-positive failure'
  );
  assert.equal(prepared.inactiveWorkflowRuns, 0);
  assert.doesNotMatch(prepared.body, /Deleted legacy workflow/);
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

await test('buildSolveArgs prepends issue URL and enables the three /fix options (issue #1733)', () => {
  assert.deepEqual(FIX_SOLVE_OPTIONS, ['--development-log', '--deep-analysis', '--auto-merge']);
  assert.deepEqual(buildSolveArgs({ issueUrl: 'https://github.com/o/r/issues/5', passthrough: ['--tool', 'codex'] }), ['https://github.com/o/r/issues/5', '--development-log', '--deep-analysis', '--auto-merge', '--tool', 'codex']);
});

await test('buildSolveArgs never duplicates an option the caller already passed', () => {
  const args = buildSolveArgs({ issueUrl: 'https://github.com/o/r/issues/5', passthrough: ['--auto-merge', '--deep-analysis', '--think', 'max'] });
  assert.deepEqual(args, ['https://github.com/o/r/issues/5', '--development-log', '--auto-merge', '--deep-analysis', '--think', 'max']);
  for (const option of FIX_SOLVE_OPTIONS) {
    assert.equal(args.filter(arg => arg === option).length, 1, `${option} must appear exactly once`);
  }
});

await test('CI_CD_ISSUE_TYPE is a Bug type /solve recognizes (makes the omission lossless)', () => {
  // /solve --deep-analysis only emits the root-cause / debug-output /
  // report-upstream paragraphs when the issue type is a bug. Creating the issue
  // as a Bug is what lets buildCiCdIssueBody omit them without losing them.
  assert.equal(CI_CD_ISSUE_TYPE, 'Bug');
  assert.ok(isBugIssueType(CI_CD_ISSUE_TYPE), '/solve must recognize the type as a bug');
  assert.deepEqual([...CI_CD_ISSUE_LABELS], ['bug']);
});

await test('buildCreateIssueArgs passes the issue type and labels to gh', () => {
  const args = buildCreateIssueArgs({
    repository: { fullName: 'owner/repo' },
    title: 'T',
    bodyFile: '/tmp/body.md',
    issueType: CI_CD_ISSUE_TYPE,
    labels: [...CI_CD_ISSUE_LABELS],
  });
  assert.deepEqual(args, ['issue', 'create', '--repo', 'owner/repo', '--title', 'T', '--body-file', '/tmp/body.md', '--type', 'Bug', '--label', 'bug']);

  // Without optional metadata the args stay exactly as /task builds them today.
  assert.deepEqual(buildCreateIssueArgs({ repository: { fullName: 'owner/repo' }, title: 'T', bodyFile: '/tmp/body.md' }), ['issue', 'create', '--repo', 'owner/repo', '--title', 'T', '--body-file', '/tmp/body.md']);
});

await test('shared CI/CD issue service collects context and creates the same typed issue', async () => {
  const repository = parseFixRepository('owner/repo');
  const calls = [];
  const run = async (command, args) => {
    calls.push({ command, args });
    const endpoint = args[1] || '';
    if (args[0] === 'api' && endpoint.endsWith('/languages')) {
      return { code: 0, stdout: JSON.stringify({ JavaScript: 900 }), stderr: '' };
    }
    if (args[0] === 'api' && endpoint === 'repos/owner/repo') {
      return { code: 0, stdout: 'main\n', stderr: '' };
    }
    if (args[0] === 'api' && endpoint === 'repos/owner/repo/commits/main') {
      return {
        code: 0,
        stdout: JSON.stringify({
          sha: 'abcdef1234567890',
          message: 'Latest change',
          url: 'https://github.com/owner/repo/commit/abcdef1234567890',
        }),
        stderr: '',
      };
    }
    if (args[0] === 'api' && endpoint.includes('actions/workflows?')) {
      return { code: 0, stdout: JSON.stringify([{ workflows: [{ id: 1, state: 'active' }] }]), stderr: '' };
    }
    if (args[0] === 'api' && endpoint.includes('actions/workflows/1/runs?')) {
      return {
        code: 0,
        stdout: JSON.stringify({ workflow_runs: [{ name: 'CI', workflow_id: 1, head_branch: 'main', status: 'completed', conclusion: 'failure', html_url: 'https://github.com/owner/repo/actions/runs/1' }] }),
        stderr: '',
      };
    }
    if (args[0] === 'issue' && args[1] === 'create') {
      return { code: 0, stdout: 'https://github.com/owner/repo/issues/7\n', stderr: '' };
    }
    return { code: 1, stdout: '', stderr: `Unexpected command: ${command} ${args.join(' ')}` };
  };

  const prepared = await prepareCiCdIssue({ repository, run });
  assert.equal(prepared.defaultBranch, 'main');
  assert.equal(prepared.runsSource, 'branch');
  assert.equal(prepared.title, CI_CD_ISSUE_TITLE);
  assert.match(prepared.body, /Recent CI\/CD runs on `main`/);
  assert.match(prepared.body, /js-ai-driven-development-pipeline-template/);

  const issue = await createCiCdIssue({ repository, prepared, run });
  assert.equal(issue.url, 'https://github.com/owner/repo/issues/7');
  const createCall = calls.find(call => call.args[0] === 'issue' && call.args[1] === 'create');
  assert.ok(createCall);
  assert.ok(createCall.args.includes('--type'));
  assert.ok(createCall.args.includes('Bug'));
  assert.ok(createCall.args.includes('--label'));
  assert.ok(createCall.args.includes('bug'));
});

await test('createTaskIssue retries without type/labels when the repo rejects them', async () => {
  // Issue types are org-scoped and labels repo-scoped, so an arbitrary target
  // repo may have neither. The issue must still be created (issue #1733).
  const calls = [];
  const logged = [];
  const issue = await createTaskIssue({
    repository: { fullName: 'owner/repo' },
    title: 'T',
    body: 'B',
    issueType: 'Bug',
    labels: ['bug'],
    log: message => logged.push(message),
    run: async (command, args) => {
      calls.push(args);
      if (args.includes('--type')) {
        return { code: 1, stdout: '', stderr: "could not add label: 'bug' not found" };
      }
      return { code: 0, stdout: 'https://github.com/owner/repo/issues/7\n', stderr: '' };
    },
  });

  assert.equal(calls.length, 2, 'first attempt with metadata, then a retry without it');
  assert.ok(calls[0].includes('--type') && calls[0].includes('--label'));
  assert.ok(!calls[1].includes('--type') && !calls[1].includes('--label'));
  assert.equal(issue.url, 'https://github.com/owner/repo/issues/7');
  assert.equal(issue.number, 7);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /retrying without them/);
});

await test('createTaskIssue surfaces the error when no optional metadata was used', async () => {
  await assert.rejects(
    createTaskIssue({
      repository: { fullName: 'owner/repo' },
      title: 'T',
      body: 'B',
      run: async () => ({ code: 1, stdout: '', stderr: 'boom' }),
    }),
    /boom/
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
