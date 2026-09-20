/**
 * Structural checks for GitHub Actions workflow files.
 *
 * Why this exists (issue #2082, finding F6):
 *   A job without `timeout-minutes` inherits GitHub's 360-minute default, so a
 *   hung job burns six hours of runner time and then reports as a generic
 *   failure. docs/CI-CD-BEST-PRACTICES.md requires an explicit timeout on every
 *   job, but nothing enforced it and 21 of 25 jobs had none.
 *
 *   No off-the-shelf linter covers this: zizmorcore/zizmor#1023 and
 *   rhysd/actionlint#49 are both open. Hence this check.
 *
 * The scanner is deliberately line-based rather than a real YAML parse: js-yaml
 * is only a transitive dependency here, and these checks must keep working when
 * node_modules is in an unknown state (the same constraint that shaped
 * scripts/run-command.lib.mjs). Workflow files are machine-written and uniformly
 * indented, so scanning at fixed indentation is reliable; the tests pin the
 * cases where it could go wrong.
 */

/**
 * A job declared in a workflow file.
 * @typedef {object} WorkflowJob
 * @property {string} name
 * @property {number} line 1-indexed line where the job is declared.
 * @property {number|null} timeoutMinutes
 * @property {boolean} reusable Whether the job calls a reusable workflow.
 * @property {string} condition The job-level `if:` expression, flattened to one line.
 */

/**
 * List the jobs declared in a workflow document.
 *
 * @param {string} yaml
 * @returns {WorkflowJob[]}
 */
export function findJobs(yaml) {
  const lines = String(yaml || '').split('\n');
  const jobs = [];

  let inJobs = false;
  let current = null;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];

    // A top-level key ends the `jobs:` mapping.
    if (/^\S/.test(line)) {
      inJobs = /^jobs:\s*(#.*)?$/.test(line);
      current = null;
      continue;
    }

    if (!inJobs) {
      continue;
    }

    // A job name: exactly two spaces of indentation.
    const jobMatch = line.match(/^ {2}([A-Za-z_][A-Za-z0-9_-]*):\s*(#.*)?$/);
    if (jobMatch) {
      current = { name: jobMatch[1], line: index + 1, timeoutMinutes: null, reusable: false, condition: '' };
      jobs.push(current);
      continue;
    }

    if (!current) {
      continue;
    }

    // Job-level keys: exactly four spaces. Anything deeper belongs to a step,
    // which is why a step's `uses:` cannot be mistaken for a reusable-workflow
    // call and a step's `timeout-minutes:` cannot satisfy the job.
    const keyMatch = line.match(/^ {4}([a-z-]+):\s*(.*)$/);
    if (!keyMatch) {
      continue;
    }

    if (keyMatch[1] === 'timeout-minutes') {
      const value = Number.parseInt(keyMatch[2], 10);
      current.timeoutMinutes = Number.isNaN(value) ? null : value;
    } else if (keyMatch[1] === 'uses') {
      current.reusable = true;
    } else if (keyMatch[1] === 'if') {
      // `if:` is usually written as a block scalar (`if: |`) spanning many lines.
      // Gather the continuation so the condition can be inspected as a whole.
      const parts = [keyMatch[2].replace(/^[|>]-?\s*/, '')];
      while (index + 1 < lines.length && /^ {6,}\S/.test(lines[index + 1])) {
        parts.push(lines[++index].trim());
      }
      current.condition = parts.join(' ').trim();
    }
  }

  return jobs;
}

/**
 * Jobs that must declare `timeout-minutes` but do not.
 *
 * Jobs that call a reusable workflow are exempt: GitHub does not support
 * `timeout-minutes` on them, so the timeout has to live in the called workflow.
 * Reporting those would trade a false negative for a false positive.
 *
 * @param {string} yaml
 * @returns {WorkflowJob[]}
 */
export function findJobsMissingTimeout(yaml) {
  return findJobs(yaml).filter(job => !job.reusable && job.timeoutMinutes === null);
}

/**
 * Jobs whose `if:` uses `always()` (issue #2082, finding F13).
 *
 * `always()` is true even when the run has been cancelled, so a job guarded by
 * it keeps going after a cancellation instead of stopping. release.yml already
 * documents this at the top of the file — "Docker jobs use !cancelled() instead
 * of always() ... Using always() prevents workflow cancellation entirely", from
 * the issue #1274 and #1278 case studies — but the rule was applied only to the
 * Docker jobs and nothing enforced it elsewhere.
 *
 * `!cancelled()` expresses the actual intent in every case here: run regardless
 * of whether the dependencies succeeded, but not after a cancellation.
 *
 * @param {string} yaml
 * @returns {WorkflowJob[]}
 */
export function findJobsUsingAlways(yaml) {
  return findJobs(yaml).filter(job => /\balways\(\)/.test(job.condition));
}

/**
 * Check the workflow-level `concurrency:` policy (issue #2082, finding F14).
 *
 * Cancelling an in-progress run on the release branch can interrupt a release
 * between `npm publish` and the `git push` of the version bump, leaving the
 * registry ahead of the repository. Superseded pull-request runs, by contrast,
 * should be cancelled — nothing is published from them and the runners are
 * better spent elsewhere.
 *
 * @param {string} yaml
 * @param {string} [releaseBranch]
 * @returns {{hasConcurrency: boolean, cancelInProgress: string|null, cancelsReleaseBranch: boolean}}
 */
export function inspectConcurrency(yaml, releaseBranch = 'main') {
  const match = String(yaml || '').match(/^concurrency:\s*\n(?: {2}.*\n?)*/m);
  if (!match) {
    return { hasConcurrency: false, cancelInProgress: null, cancelsReleaseBranch: false };
  }

  const cancel = match[0].match(/^ {2}cancel-in-progress:\s*(.+)$/m);
  const cancelInProgress = cancel ? cancel[1].trim() : null;

  // `== 'refs/heads/main'` cancels the release branch; `!=` cancels everything else.
  const cancelsReleaseBranch = cancelInProgress === 'true' || new RegExp(`==\\s*'refs/heads/${releaseBranch}'`).test(cancelInProgress || '');

  return { hasConcurrency: true, cancelInProgress, cancelsReleaseBranch };
}
