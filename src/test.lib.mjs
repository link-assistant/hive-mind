/** Pure helpers for documentation-driven manual testing (issue #1702). */
import { parseFixRepository } from './fix.args.lib.mjs';
import { normalizeCliArgs } from './argument-normalization.lib.mjs';

export const TEST_OWN_OPTIONS = Object.freeze(['--dry-run', '--no-solve', '--no-auto-solve', '--solve', '--help', '-h', '--version']);

export function partitionTestArgs(rawArgs) {
  const args = normalizeCliArgs(Array.isArray(rawArgs) ? rawArgs : []);
  const repository = args[0] && !args[0].startsWith('-') ? parseFixRepository(args[0]) : null;
  const result = { repository, dryRun: false, runSolve: true, passthrough: [] };
  for (const arg of repository ? args.slice(1) : args) {
    if (arg === '--dry-run') result.dryRun = true;
    else if (arg === '--no-solve' || arg === '--no-auto-solve') result.runSolve = false;
    else if (arg === '--solve') result.runSolve = true;
    else if (!TEST_OWN_OPTIONS.includes(arg)) result.passthrough.push(arg);
  }
  return result;
}

export function buildTestSolveArgs({ issueUrl, passthrough = [] }) {
  return [issueUrl, ...(passthrough.includes('--attach-logs') || passthrough.includes('--no-attach-logs') ? [] : ['--attach-logs']), ...passthrough];
}

export function selectDocumentationFiles(files = []) {
  return [...new Set(files.filter(file => /(?:^|\/)readme(?:[._-][^/]*)?$/i.test(file) || /(?:^|\/)(?:docs?|documentation)\//i.test(file)))].sort();
}

export function buildTestIssueBody({ repository, defaultBranch = null, commit = null, files = [], filesTruncated = false }) {
  const docs = selectDocumentationFiles(files);
  // The inventory is a starting point, not a limit on what the tester reads.
  const inventory =
    docs
      .slice(0, 200)
      .map(file => `- ${JSON.stringify(file)}`)
      .join('\n') || '- No documentation detected by the API; discover it in the checkout.';
  return `Act as a tester/user of ${repository.url}. Manually test everything described in its README files and documentation, following the instructions as a user would.

Repository: ${repository.fullName}
Default branch: ${defaultBranch || 'discover from the repository'}
Documentation inventory commit: ${commit?.sha || 'unknown; record the tested commit'}

## Documentation inventory

${inventory}
${filesTruncated || docs.length > 200 ? '\nThe inventory is truncated. Enumerate all documentation from the local checkout before testing.\n' : ''}
## Testing procedure

1. Enumerate project documentation from tracked files before installing dependencies (for example, with git ls-files). Read every README (including nested READMEs) and every document in docs/, doc/, documentation/, and other documentation locations referenced by the README. Follow linked project documentation and examples. Build a checklist covering every documented installation, configuration, command, API, feature, example, and user workflow. Include document paths and section or line references. Equivalent translated instructions may share a test; record the mapping. Do not silently omit documentation because it is absent from the API inventory.
2. Record the actual tested commit, branch, operating system, runtime versions, dependencies, setup, and prerequisites. Use a fresh isolated workspace or disposable fixtures where possible. Follow documented setup and commands literally before trying alternatives. Do not rely on static inspection or an automated test suite alone: actually exercise each documented workflow as a user.
3. For each checklist item, record exact steps/commands, expected behavior from the documentation, actual behavior, exit status, and evidence (sanitized logs, output, screenshots for UI workflows). Use a real browser for interactive interfaces. Run the existing automated suite as supporting evidence.
4. Assign every item PASS, FAIL, BLOCKED, or NOT RUN. Missing credentials, unavailable services, unsupported platforms, or unsafe operations are BLOCKED with a specific reason; never count them as passing. Bound resource-heavy probes, clean up processes and disposable fixtures, and do not mutate unrelated repositories or production services.
5. For each failure, provide a minimal reproduction, expected versus actual results, and the relevant documentation reference. Do not fix application code, change documented instructions to make a test pass, or switch to an implementation role. Preserve failures as findings for separate work.
6. Commit a manual testing report at docs/testing/report.md in the prepared pull request branch. Include the full checklist, coverage counts, evidence, failures, blocked prerequisites, and remaining NOT RUN items. Store reusable testing fixtures in experiments/ or examples/ and sanitize evidence before publishing it. Summarize the results and link the report in the pull request description.

Completion requires an outcome for every documented workflow. If full coverage is impossible, clearly report the gaps and reasons without claiming everything passed.`;
}
