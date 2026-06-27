/**
 * Prompt snippets for command-line options that hive-mind owns outside the
 * agent session. These options must remain stable even if an agent tries to
 * simplify the workflow by changing the PR target or merge plan.
 */

export function buildLockedSolveOptionsDirective(argv = {}) {
  const lines = [];

  if (argv?.baseBranch) {
    lines.push(`Requested base branch is locked: --base-branch ${argv.baseBranch}`);
    lines.push('Do not retarget the pull request with gh pr edit --base, GitHub UI changes, or any equivalent API call.');
    lines.push('Do not switch the PR to the default branch to avoid conflicts, failing checks, or missing commits.');
    lines.push('If the requested base branch has conflicts or failing checks, fix the branch against that base or ask for human help.');
  }

  if (argv?.autoMerge) {
    lines.push('--auto-merge was requested and is handled by hive-mind after verification.');
    lines.push('Do not replace --auto-merge with a manual merge, a manual "ready to merge" handoff, or by disabling auto-merge behavior.');
  }

  if (lines.length === 0) {
    return '';
  }

  return `
Locked solve options.
${lines.map(line => `   - ${line}`).join('\n')}
`;
}
