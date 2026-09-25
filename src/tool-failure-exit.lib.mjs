#!/usr/bin/env node

/**
 * Issue #2296: a run whose AI tool failed must not end with exit code 0, and
 * the work it leaves behind must not be lost with the container.
 *
 * In the incident the auto-restart-until-mergeable loop stopped on
 * `tool_failure` ("OAuth session expired and could not be refreshed"), returned
 * `{ success: false }` to solve.mjs, which ignored it, and `finalizeSolveProcess`
 * called `safeExit(0)`. start-command removes a container that exits 0 (and
 * keeps one that exits non-zero, see docs/case-studies/issue-2296), so the
 * workspace with four uncommitted files was deleted together with the "kept"
 * temporary directory.
 *
 * Same shape as auto-restart-exhaustion.lib.mjs (#2119): the loop that stops on
 * a tool failure calls {@link failOnToolFailure}, which commits and pushes the
 * uncommitted work as a WIP commit and records the failure, and
 * `finalizeSolveProcess` exits 1 when a failure was recorded.
 */

import { commitUncommittedChangesOnCriticalError } from './critical-error-commit.lib.mjs';

// Module-level singleton: the loops run sequentially inside one solve process
// and their result objects do not reach finalizeSolveProcess.
let toolFailure = null;

/** @returns {boolean} true once a loop stopped because the AI tool failed */
export const hasToolFailureExit = () => Boolean(toolFailure);

/** @returns {{reason: string, subsystem: string, committed: boolean, pushed: boolean}|null} */
export const getToolFailureExit = () => toolFailure;

/** Clear the recorded failure. Intended for tests. */
export const resetToolFailureExit = () => {
  toolFailure = null;
};

/** One line for the "Automation stopped" comment saying what happened to the uncommitted work. */
export const describePreservedWork = ({ committed, pushed }) => {
  if (!committed) return 'No uncommitted changes were left in the working tree.';
  return pushed ? 'The uncommitted changes were saved as a WIP commit and pushed to the pull request branch, so no work is lost.' : 'The uncommitted changes were saved as a WIP commit locally, but the push failed (see the log).';
};

/**
 * Record that the run failed because the AI tool failed, preserving any
 * uncommitted work first. Never throws.
 *
 * @param {Object} params
 * @param {string} params.tempDir working tree holding the uncommitted work
 * @param {string|null} params.branchName branch to push the WIP commit to
 * @param {Function} params.$ command-stream tagged-template executor
 * @param {Function} params.log async logger
 * @param {string} params.reason stop reason (e.g. `tool_failure`, `auth_failure_after_retry`)
 * @param {string} [params.subsystem] which loop stopped, for the commit message
 * @param {Function} [params.commit] preservation helper (injectable for tests)
 * @returns {Promise<{reason: string, subsystem: string, committed: boolean, pushed: boolean}>}
 */
export const failOnToolFailure = async ({ tempDir, branchName, $, log, reason = 'tool_failure', subsystem = 'solve', commit = commitUncommittedChangesOnCriticalError }) => {
  let preserved = { committed: false, pushed: false };
  try {
    preserved = await commit({ tempDir, branchName, $, log, reason: `${subsystem} stopped: AI tool failed (${reason})`, push: true });
  } catch (error) {
    await log(`⚠️  Could not preserve uncommitted work: ${error?.message || error}`, { level: 'warning' });
  }
  toolFailure = { reason, subsystem, committed: Boolean(preserved.committed), pushed: Boolean(preserved.pushed) };
  return toolFailure;
};

/**
 * Work in `tempDir` that exists nowhere else: uncommitted changes and commits
 * that are on no remote. Run before the workspace is cleaned up; the container
 * that holds it is removed on exit 0. Never throws; `null` means unknown.
 *
 * @returns {Promise<{uncommitted: string[], unpushedCommits: number}|null>}
 */
export const inspectUnsavedWork = async ({ tempDir, $ }) => {
  if (!tempDir || typeof $ !== 'function') return null;
  try {
    const status = await $({ cwd: tempDir })`git status --porcelain 2>/dev/null`;
    if (status.code !== 0) return null;
    const uncommitted = String(status.stdout || '')
      .split('\n')
      .map(line => line.trimEnd())
      .filter(Boolean);
    const unpushed = await $({ cwd: tempDir })`git rev-list --count HEAD --not --remotes 2>/dev/null`;
    const unpushedCommits = unpushed.code === 0 ? Number.parseInt(String(unpushed.stdout).trim(), 10) || 0 : 0;
    return { uncommitted, unpushedCommits };
  } catch {
    return null;
  }
};

/** True when {@link inspectUnsavedWork} found something that would be lost with the workspace. */
export const hasUnsavedWork = work => Boolean(work && (work.uncommitted.length > 0 || work.unpushedCommits > 0));

export default { describePreservedWork, failOnToolFailure, getToolFailureExit, hasToolFailureExit, hasUnsavedWork, inspectUnsavedWork, resetToolFailureExit };
