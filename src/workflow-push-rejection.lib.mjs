/**
 * Issue #3332: GitHub rejects a whole push that creates or updates
 * `.github/workflows/*` when the credential has no `workflows` permission
 * (GitHub App, Actions token) or `workflow` scope (OAuth, personal token).
 *
 * A task that has to ship a workflow then never reaches the branch, however
 * correct it is, and the run used to look like a model failure. solve and the
 * e2e harness share this detection, so the cause is reported as the
 * credential problem it is, with the fix a maintainer has to make.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3332
 */

import { postTrackedComment, WORKFLOW_PUSH_REJECTED_MARKER } from './tool-comments.lib.mjs';

const WORKFLOW_PUSH_REJECTION = /refusing to allow an? (GitHub App|OAuth App|Personal Access Token|integration) to create or update workflow `?([^`\s)\\"]+)`? without `?workflows?`? (?:permission|scope)/gi;

/**
 * Every workflow GitHub refused, in log order and without repeats.
 *
 * @param {string} logText a solve log (plain or tool JSON)
 * @returns {Array<{workflow: string, credential: string}>}
 */
export const detectWorkflowPushRejections = logText => {
  const seen = new Map();
  for (const match of String(logText ?? '').matchAll(WORKFLOW_PUSH_REJECTION)) if (!seen.has(match[2])) seen.set(match[2], { workflow: match[2], credential: match[1] });
  return [...seen.values()];
};

/**
 * The first rejection that the branch never recovered from: a workflow that
 * a later push (with another credential, or by a person) did deliver is no
 * longer missing. Without `files` every rejection is unresolved.
 *
 * @param {string} logText
 * @param {{files?: (string[]|null)}} [options] paths on the pull request
 * @returns {{workflow: string, credential: string}|null}
 */
export const detectWorkflowPushRejection = (logText, { files = null } = {}) => detectWorkflowPushRejections(logText).find(rejection => !files?.includes(rejection.workflow)) ?? null;

/** What a maintainer must change, by credential kind. */
export const describeWorkflowPermissionFix = credential => (/GitHub App|integration/i.test(credential) ? 'grant the GitHub App "Workflows: read and write" (the default Actions GITHUB_TOKEN can never push workflows)' : 'give the token the `workflow` scope (`gh auth refresh -s workflow`)');

export const buildWorkflowPushRejectedComment = ({ workflow, credential }) => [`⚠️ **${WORKFLOW_PUSH_REJECTED_MARKER}**`, '', `GitHub refused a push from this run because the ${credential} credential may not create or update \`${workflow}\` without the workflows permission. GitHub rejects the whole push, so the commits in it are not on this branch.`, '', `This is a credential problem, not a problem with the solution: ${describeWorkflowPermissionFix(credential)}, then rerun the solver or push the workflow yourself.`].join('\n');

/**
 * Report an unrecovered workflow push rejection on the pull request.
 *
 * Best-effort: a failure to read the files or post the comment is logged and
 * never fails the run.
 *
 * @returns {Promise<{workflow: string, credential: string}|null>}
 */
export const reportWorkflowPushRejection = async ({ owner, repo, prNumber, logText, $, log = async () => {} }) => {
  if (!detectWorkflowPushRejections(logText).length) return null;
  let files = null;
  try {
    const result = await $({ mirror: false, capture: true, signal: AbortSignal.timeout(60_000) })`gh api repos/${owner}/${repo}/pulls/${prNumber}/files --paginate --jq ${'.[].filename'}`;
    if (result?.code === 0) files = (result.stdout ?? '').toString().split('\n').filter(Boolean);
  } catch {
    files = null;
  }
  const rejection = detectWorkflowPushRejection(logText, { files });
  if (!rejection) return null;
  await log(`\n⚠️  ${WORKFLOW_PUSH_REJECTED_MARKER}: the ${rejection.credential} credential cannot create or update ${rejection.workflow}; ${describeWorkflowPermissionFix(rejection.credential)}`, { level: 'warning' });
  try {
    const { ok, stderr } = (await postTrackedComment({ $, owner, repo, targetNumber: prNumber, body: buildWorkflowPushRejectedComment(rejection) })) || {};
    if (!ok) await log(`  ⚠️  Could not post the workflow push notice: ${stderr || 'unknown error'}`, { level: 'warning' });
  } catch (error) {
    await log(`  ⚠️  Could not post the workflow push notice: ${error.message}`, { level: 'warning' });
  }
  return rejection;
};

export default { buildWorkflowPushRejectedComment, describeWorkflowPermissionFix, detectWorkflowPushRejection, detectWorkflowPushRejections, reportWorkflowPushRejection };
