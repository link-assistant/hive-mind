#!/usr/bin/env node
// @hive-mind-test-suite default

/**
 * Test suite for Issue #1774 fix: auto-PR creation must always pass --repo
 * to `gh pr create` so a fork-of-fork target does not silently switch to the
 * upstream parent.
 *
 * Bug: When `solve` runs against an issue in a repository that is itself a
 * GitHub fork (e.g. glsfull/saas is a fork of nuxt-ui-templates/saas) and the
 * user has direct write access, `--auto-fork` does not enable fork mode. The
 * non-fork branch of the auto-PR command builder did not include
 * `--repo ${owner}/${repo}`, so `gh pr create` resolved the base repository
 * via git remotes — picking up the `upstream` remote that `gh repo clone`
 * automatically adds for forks. That made `gh pr create` post the PR against
 * `nuxt-ui-templates/saas` (which lacks the head branch) and surface the
 * misleading error "GraphQL: Head sha can't be blank, ... No commits between
 * main and issue-1-...".
 *
 * Fix: Both the initial command and the assignee-fallback rebuild now include
 * `--repo ${owner}/${repo}` in the non-fork branch, matching the behavior of
 * the fork branch. The fatal error block also detects "No commits between"
 * and prints a fork-aware diagnostic with the resolved remotes so a recurrence
 * (e.g. after manual remote edits) stays self-explanatory.
 */

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const srcDir = join(__dirname, '..', 'src');

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    testFn();
    console.log('✅ PASSED');
    testsPassed++;
  } catch (error) {
    console.log(`❌ FAILED: ${error.message}`);
    testsFailed++;
  }
}

const autoPrContent = execSync(`cat ${srcDir}/solve.auto-pr.lib.mjs`, { encoding: 'utf8' });
const diagnosticContent = execSync(`cat ${srcDir}/solve.auto-pr-fork-diagnostic.lib.mjs`, { encoding: 'utf8' });

// Helper: find the start of every `gh pr create` command line (initial +
// assignee fallback rebuild, both fork and non-fork branches).
function findGhPrCreateCommandLines(source) {
  return source.split('\n').filter(line => line.includes('gh pr create --draft --title'));
}

// Test 1: every gh pr create command line must include --repo ${owner}/${repo}
runTest('every gh pr create command includes --repo ${owner}/${repo}', () => {
  const lines = findGhPrCreateCommandLines(autoPrContent);
  if (lines.length === 0) {
    throw new Error('No `gh pr create --draft --title` command lines found');
  }
  for (const line of lines) {
    if (!line.includes('--repo ${owner}/${repo}')) {
      throw new Error(`gh pr create command missing --repo ${'${owner}/${repo}'}: ${line.trim()}`);
    }
  }
});

// Test 2: there are at least 4 gh pr create command lines (initial + fallback,
// fork + non-fork). This guards against accidental removal of one of them.
runTest('command builder still has fork + non-fork branches in both paths', () => {
  const lines = findGhPrCreateCommandLines(autoPrContent);
  if (lines.length < 4) {
    throw new Error(`Expected at least 4 gh pr create command lines, found ${lines.length}`);
  }
});

// Test 3: the fork-mode head reference (forkUser:branchName) is preserved.
runTest('fork-mode preserves --head ${forkUser}:${branchName}', () => {
  if (!autoPrContent.includes('--head ${forkUser}:${branchName} --repo ${owner}/${repo}')) {
    throw new Error('Fork-mode head reference no longer matches expected pattern');
  }
});

// Test 4: the non-fork branch uses --head ${branchName} --repo ${owner}/${repo}
runTest('non-fork branch uses --head ${branchName} --repo ${owner}/${repo}', () => {
  if (!autoPrContent.includes('--head ${branchName} --repo ${owner}/${repo}')) {
    throw new Error('Non-fork branch is missing --head ${branchName} --repo ${owner}/${repo}');
  }
});

// Test 5: the fix references Issue #1774 for traceability
runTest('fix references Issue #1774 for traceability', () => {
  if (!autoPrContent.includes('Issue #1774')) {
    throw new Error('No Issue #1774 reference found in solve.auto-pr.lib.mjs');
  }
});

// Test 6: the fatal error block delegates to the fork-aware diagnostic, and
// the diagnostic helper detects "No commits between" and inspects local remotes.
runTest('fatal error block emits fork-aware diagnostic on "No commits between"', () => {
  if (!autoPrContent.includes('emitForkAwareDiagnostic(')) {
    throw new Error('Fatal error block does not call emitForkAwareDiagnostic');
  }
  if (!diagnosticContent.includes("'No commits between'")) {
    throw new Error('Diagnostic helper does not check for "No commits between"');
  }
  if (!diagnosticContent.includes('Fork-aware diagnostic')) {
    throw new Error('Diagnostic helper missing fork-aware diagnostic header');
  }
  if (!diagnosticContent.includes('git remote -v')) {
    throw new Error('Diagnostic helper does not collect git remotes');
  }
});

// Test 7: the manual recovery command shown in the fork-aware diagnostic
// includes --repo so the user can copy-paste a working command.
runTest('manual recovery command in fork-aware diagnostic includes --repo', () => {
  if (!diagnosticContent.includes('gh pr create --draft --base ${defaultBranch} --head ${branchName} --repo ${owner}/${repo}')) {
    throw new Error('Manual recovery command in diagnostic missing --repo flag');
  }
});

// Test 8: the "Option 2" and "Option 3" recovery commands also include --repo
runTest('Option 2 and Option 3 recovery commands include --repo', () => {
  // Option 2: gh pr create --draft --title ... --body ... --repo
  const option2Pattern = /gh pr create --draft --title "Fix issue #\$\{issueNumber\}" --body "Fixes #\$\{issueNumber\}" --repo \$\{owner\}\/\$\{repo\}/;
  if (!option2Pattern.test(autoPrContent)) {
    throw new Error('Option 2 recovery command missing --repo flag');
  }
  if (!autoPrContent.includes('gh pr create --draft --repo ${owner}/${repo}')) {
    throw new Error('Option 3 recovery command missing --repo flag');
  }
});

console.log('');
console.log(`Tests passed: ${testsPassed}`);
console.log(`Tests failed: ${testsFailed}`);

if (testsFailed > 0) {
  process.exit(1);
}
