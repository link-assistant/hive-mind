#!/usr/bin/env node

/**
 * Issue #2301: an AI session that fails inside the auto-restart or watch loop
 * fails the run.
 *
 * When the first AI session fails, `solve` exits 1 with the tool failure as the
 * exit message. When a later session failed inside `--auto-restart-until-mergeable`
 * or `--watch`, the loop posted "Automation stopped: the AI session failed" and
 * returned, and `solve` exited 0. The bot then announced "Work session finished
 * successfully" for link-foundation/meta-language#196, whose last session had
 * failed and whose log had not been attached.
 *
 * Like the auto-restart budget (issue #2119) and the no-progress stop (#2247),
 * the loops record the failure here and `finalizeSolveProcess` exits non-zero.
 */

// Module-level singleton: the loops return through different result objects,
// and `finalizeSolveProcess` is the one place that decides the exit code.
let loopToolFailure = null;

/**
 * Record that an AI session failed inside a loop and the loop stopped.
 * @param {Object} failure
 * @param {string} failure.reason - Stop reason (`tool_failure`, `tool_failure_after_resume`).
 * @param {string} [failure.mode] - Which loop stopped.
 * @param {string|null} [failure.message] - The session error.
 */
export const recordLoopToolFailure = ({ reason, mode = null, message = null }) => {
  loopToolFailure = { reason, mode, message: message || null };
};

/** @returns {boolean} true once a loop stopped because its AI session failed */
export const hasLoopToolFailure = () => Boolean(loopToolFailure);

/** @returns {{reason: string, mode: string|null, message: string|null}|null} */
export const getLoopToolFailure = () => loopToolFailure;

/** Clear the recorded failure. Intended for tests. */
export const resetLoopToolFailure = () => {
  loopToolFailure = null;
};

export default { recordLoopToolFailure, hasLoopToolFailure, getLoopToolFailure, resetLoopToolFailure };
