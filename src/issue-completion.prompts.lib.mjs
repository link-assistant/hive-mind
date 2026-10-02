import { fileURLToPath } from 'node:url';

export const ISSUE_COMPLETION_GOAL = 'Do not stop until every requirement of the issue and all required sub-issues is fully implemented and verified in this single pull request, in the widest requested scope, with no requested work deferred.';

export function getIssueCompletionSubPrompt({ owner, repo, issueNumber, prNumber } = {}) {
  const snapshotPath = fileURLToPath(new URL('./issue-requirements-snapshot.mjs', import.meta.url));
  const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
  const command = `${quote(process.execPath)} ${quote(snapshotPath)} ${quote(`${owner}/${repo}`)} ${issueNumber || '<issue-number>'} ${prNumber || '<pull-request-number>'}`;
  return `
Issue completion goal.
   - ${ISSUE_COMPLETION_GOAL}
   - Try to set this exact objective with a native goal-setting API or tool before working, and keep it active until every acceptance criterion is verified. Codex exposes thread/goal/set through its app-server API when available; do not invent an exec --goal flag. If the running tool provides no native goal API, keep the objective and checklist in your work plan across turns and compaction.
   - Read the complete issue, every comment, every required sub-issue, and all pull request conversation comments, inline comments, and reviews. Inventory each requirement, including prose requirements and later feedback, and map each one to implementation and verification evidence.
   - Passing CI, a partial implementation, an upstream report, or a workaround does not complete an unmet acceptance criterion. Continue authorized work. If an external blocker cannot be resolved, report the exact blocked criteria and evidence, leave them unfinished, and keep the pull request unmerged.
   - Preserve a positive closing keyword in the pull request description for the original issue and every required issue. Repeat the keyword per issue, use the correct repository for foreign issues, and keep references outside examples or code blocks. A sentence such as "does not close #123" is not a closing reference.
   - Before finishing, run this command after pushing the final code commit to obtain the current requirements report template:
     ${command}
   - Fill every requirement with status "done" only after verifying it, and record concrete test results, files, or other reviewable evidence. Add every prose requirement the template could not extract. Keep blocked requirements as "blocked" with their evidence. Include the complete JSON report between its supplied markers in the pull request description. Preserve those markers on later edits. Refresh the template after any new commit or requirement feedback.
   - The merge guard requires a report for exactly the required issues, the current commit, and current issue/review feedback. It rejects missing criteria, empty evidence, pending or blocked statuses, missing links, and unreadable verification data. Never fabricate evidence to pass this check.
`;
}
