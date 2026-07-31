#!/usr/bin/env node

/**
 * Unit tests for the `/fix --ci-cd` pure helpers (issue #1733).
 *
 * @hive-mind-test-suite default
 */

import assert from 'assert/strict';
import { buildCiCdIssueBody, buildCiCdIssueTitle, buildRunsSection, buildSolveArgs, buildStandardPrompt, buildStandardPromptParagraphs, buildTemplatesSection, CI_CD_ISSUE_LABELS, CI_CD_ISSUE_TITLE, CI_CD_ISSUE_TYPE, CI_CD_TEMPLATES, DEBUG_OUTPUT_PARAGRAPH, FIX_SOLVE_OPTIONS, mapLanguagesToTemplates, normalizeLanguages, parseFixRepository, partitionFixArgs, REPORT_UPSTREAM_PARAGRAPH, summarizeRunFailures, templateUrl } from '../src/fix.ci-cd.lib.mjs';
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
    if (args[0] === 'api' && endpoint.includes('actions/runs?head_sha=')) {
      return {
        code: 0,
        stdout: JSON.stringify([{ name: 'CI', status: 'completed', conclusion: 'failure', html_url: 'https://github.com/owner/repo/actions/runs/1' }]),
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
  assert.equal(prepared.runsSource, 'commit');
  assert.equal(prepared.title, CI_CD_ISSUE_TITLE);
  assert.match(prepared.body, /Latest default-branch CI\/CD runs/);
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
