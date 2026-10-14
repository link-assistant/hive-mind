/**
 * Exit codes of `solve` that are not plain success or failure. Kept free of
 * imports so the Telegram bot and hive can read them without loading solve.
 *
 *   0 - finished, and this run made progress (or its pull request was merged);
 *   5 - finished without changes: no new commit, no file change and no comment
 *       by this run (issue #3211, see session-changes.lib.mjs);
 *   any other non-zero code - failed.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3211
 */

/** `solve` exit code: the run finished, but changed nothing. */
export const EXIT_CODE_SOLVE_NO_CHANGES = 5;

export default { EXIT_CODE_SOLVE_NO_CHANGES };
