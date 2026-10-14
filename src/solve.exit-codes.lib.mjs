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

/**
 * The code `solve` actually exits with when it finished without changes.
 * Before #3211 such a run exited 0; a script that treats every nonzero exit
 * as an error can keep that with `HIVE_MIND_SOLVE_NO_CHANGES_EXIT_CODE=0`
 * (any code from 0 to 255). The run is still reported as ⚠️ finished without
 * changes and its draft stays a draft; only the process exit code differs.
 */
export const getSolveNoChangesExitCode = (env = process.env) => {
  const raw = String(env.HIVE_MIND_SOLVE_NO_CHANGES_EXIT_CODE ?? '').trim();
  if (!/^\d{1,3}$/.test(raw) || Number(raw) > 255) return EXIT_CODE_SOLVE_NO_CHANGES;
  return Number(raw);
};

export default { EXIT_CODE_SOLVE_NO_CHANGES, getSolveNoChangesExitCode };
