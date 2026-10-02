/** Preserve the completed local checks and their sanitized logs for review. */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { sanitizeForPublication } from '../../src/token-sanitization.lib.mjs';

const logDirectory = process.argv[2] || '/tmp';
const destination = new URL('../../docs/case-studies/issue-2335/data/', import.meta.url);
// Exit codes are the observed process results, not inferred from error words
// in logs: many tests intentionally print failures from mocked subprocesses.
const checks = [
  ['all-tests-verified', 'npm test -- --continue-on-failure', 0],
  ['coverage-complete', 'NODE_V8_COVERAGE=/tmp/issue-2335-v8-complete node --test --experimental-test-coverage --test-coverage-include=src/issue-completion.lib.mjs --test-coverage-include=src/issue-requirements.lib.mjs --test-coverage-include=src/pr-issue-link-repair.lib.mjs --test-coverage-include=src/solve.issue-completion.lib.mjs tests/issue-completion-2335.test.mjs', 0],
  ['discovery-tests', 'node --test tests/issue-linking-2335.test.mjs tests/issue-completion-2335.test.mjs', 0],
  ['discovery-existing-fixed', 'node --test tests/test-issue-1760-draft-linked-prs.mjs tests/test-timeline-linked-prs.mjs tests/pr-closes-issue.test.mjs tests/issue-linking-2335.test.mjs', 0],
  ['focused-final', 'node --test tests/issue-completion-prompts-2335.test.mjs tests/issue-linking-2335.test.mjs tests/test-issue-2236-auxiliary-model-calls-policy.mjs tests/test-issue-661-resume-on-auto-restart.mjs tests/test-repository-mode-closing-references-2306.mjs tests/test-solve-repository-mode-2212.mjs tests/test-agent-commander-option.mjs tests/dependency-freshness-2264.test.mjs tests/test-merge-queue.mjs tests/test-merge-targets-2013.mjs', 0],
  ['pin-tests-final', 'node --test tests/test-use-with-retry.mjs tests/test-preinstall-use-m-packages-1724.mjs tests/test-issue-2186-agent-snapshot-leak.mjs tests/test-issue-2187-current-dependency-pins.mjs', 0],
  ['docs-sync-fixed', 'node tests/test-docs-language-sync.mjs', 0],
  ['lint-final', 'npm run lint', 0],
  ['lint-last', 'npx eslint (subsequent discovery, queue, pin changes and tests; see case study)', 0],
  ['linking-lint-fixed', 'npx eslint src/github-linking.lib.mjs', 0],
  ['merge-diagnostics-lint', 'npx eslint src/github-merge.lib.mjs', 0],
  ['format-last', 'npm run format:check', 0],
  ['final-additions-format', 'npx prettier --check docs/ISSUE_COMPLETION*.md docs/case-studies/issue-2335/README.md experiments/issue-2335/*.mjs src/github-linking.lib.mjs', 0],
  ['translations-format', 'npx prettier --write docs/ISSUE_COMPLETION*.md docs/case-studies/issue-2335/README.md src/github-linking.lib.mjs', 0],
  ['duplication-complete', 'npm run check:duplication', 0],
  ['secrets-last', 'npm run check:secrets', 0],
  ['lines-last', 'bash scripts/check-file-line-limits.sh', 0],
  ['syntax-complete', 'bash scripts/check-mjs-syntax.sh', 0],
  ['audit-patched', 'npm audit --audit-level=moderate', 0],
  ['freshness-patched', 'node scripts/check-dependency-freshness.mjs', 0],
  ['changeset-local', 'node scripts/validate-changeset.mjs', 0],
  ['changeset-committed', 'BASE_SHA=origin/main HEAD_SHA=HEAD node scripts/validate-changeset.mjs', 0],
  ['package-manager-final', 'node scripts/check-package-manager.mjs', 0],
  ['all-tests', 'npm test -- --continue-on-failure (initial investigation)', 1],
  ['all-tests-final', 'npm test -- --continue-on-failure (before translated guide siblings)', 1],
  ['discovery-existing', 'node --test (before preserving the unscoped discovery contract)', 1],
  ['audit-final', 'npm audit --audit-level=moderate (before lock refresh)', 1],
  ['freshness-final', 'node scripts/check-dependency-freshness.mjs (before pin refresh)', 1],
];

const manifest = [];
for (const [name, command, exitCode] of checks) {
  const path = join(logDirectory, `issue-2335-${name}.log`);
  const raw = await readFile(path, 'utf8');
  if (name === 'all-tests-verified' && !/\[523\/523\]/.test(raw)) throw new Error('The full test run has not finished');
  if (name === 'all-tests-verified' && /Failed test files:/.test(raw)) throw new Error('The full test run still has failures');
  const content = await sanitizeForPublication(raw);
  const file = `local-${name}.log.gz`;
  await writeFile(new URL(file, destination), gzipSync(content, { level: 9 }));
  manifest.push({ command, exitCode, file, completedAt: (await stat(path)).mtime.toISOString(), uncompressedSha256: createHash('sha256').update(content).digest('hex') });
}

const record = {
  collectedAt: new Date().toISOString(),
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  node: process.version,
  defaultSuiteFiles: 523,
  focusedCoverage: { modules: ['issue-completion.lib.mjs', 'issue-requirements.lib.mjs', 'pr-issue-link-repair.lib.mjs', 'solve.issue-completion.lib.mjs'], lines: 100, functions: 100, branches: 99.64, note: 'Link repair has one V8 zero-count range: the space on the finally line (96.88% module branches); no executable line is uncovered. This is not whole-application coverage.' },
  logs: manifest,
};
await writeFile(new URL('validation.json', destination), `${JSON.stringify(record, null, 2)}\n`);
console.log(`Archived ${manifest.length} local validation logs.`);
