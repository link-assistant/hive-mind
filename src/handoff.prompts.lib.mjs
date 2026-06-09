/**
 * HANDOFF.md support sub-prompt module ("handoff skill")
 *
 * Provides a single, tool-agnostic skill that teaches the AI tool to read and
 * maintain a HANDOFF.md file in the repository root. The goal is cross-session
 * AND cross-tool continuity: a session driven by one tool (e.g. Claude) can be
 * continued by another tool (e.g. Codex) inside the same pull request, because
 * the handoff state travels with the branch.
 *
 * This is an experimental feature enabled via the --use-handoff flag and is
 * intentionally shared verbatim between claude.prompts.lib.mjs and
 * codex.prompts.lib.mjs so both tools follow the exact same protocol (see
 * issue #1877). The full design, research, and best-practice sources are
 * documented in docs/case-studies/issue-1877/.
 *
 * Design rationale specific to hive-mind:
 *   - Each working session runs in an ephemeral temp working directory that is
 *     cloned fresh from the pull request branch. The ONLY state that persists
 *     between sessions (and between different tools) is what is committed to the
 *     branch. Therefore, unlike the general "disposable temp-dir handoff"
 *     convention, the handoff file here MUST be committed to the PR branch so
 *     the next session/tool can read it. We keep a single active HANDOFF.md per
 *     branch to avoid ambiguity.
 *   - The file is named HANDOFF.md (repo root) for discoverability, and is
 *     tracked alongside the code it describes so reviewers can see the working
 *     state of any in-progress PR.
 */

/**
 * The default handoff file name (repository root, relative path).
 * @type {string}
 */
export const HANDOFF_FILE_NAME = 'HANDOFF.md';

/**
 * Build the handoff skill sub-prompt content.
 *
 * @param {Object} [options]
 * @param {string} [options.fileName=HANDOFF_FILE_NAME] - Handoff file name.
 * @returns {string} The formatted sub-prompt for HANDOFF.md continuity.
 */
export const buildHandoffSubPrompt = ({ fileName = HANDOFF_FILE_NAME } = {}) => {
  return `
HANDOFF.md continuity skill (experimental, --use-handoff).
   - ${fileName} is a single shared handoff document in the repository root that lets any session continue the work of any previous session, even when a different AI tool (for example Claude and Codex) is used. It travels with the pull request branch, so it is the cross-tool, cross-session memory for this PR.
   - When you start a working session, read ${fileName} first if it exists. Treat its "Next steps" section as your immediate starting point and honor the decisions and constraints it records before exploring anything else.
   - When ${fileName} does not exist yet and the task is non-trivial, create it early so an interrupted session can always be resumed.
   - When you make meaningful progress, update ${fileName} so it always reflects the current truth. Keep exactly one active ${fileName} per pull request branch (do not create per-session copies).
   - When you write ${fileName}, keep it concise and tool-agnostic: describe state by referencing file paths, function names, branch, and commit SHAs rather than tool-specific commands, so the next tool (Claude or Codex) can act on it directly. Prefer pointers to existing artifacts over duplicating their content.
   - When you write ${fileName}, include these sections: (1) Task — the issue/PR being solved and the goal; (2) Current state — what is done and verified; (3) Decisions — key choices made and why (so they are not re-litigated); (4) Next steps — the concrete, ordered actions the next session should take; (5) Gotchas — known pitfalls, failing checks, or constraints; (6) Critical files — the important paths and what each is for.
   - When you record next steps, make them specific and actionable (a path, a function, a command to run) instead of vague goals, and remove items as they are completed.
   - When you finish a step that changes the state, commit ${fileName} together with the related code changes so the handoff stays in sync with the branch and is never lost if the session is interrupted.
   - When you write ${fileName}, never include secrets, tokens, API keys, passwords, or personal data — it is committed to the repository.
   - When all requirements are fully met and the work is complete, record that completion at the top of ${fileName} (or delete the file) so the next session knows there is nothing left to continue.`;
};

/**
 * Get the handoff skill sub-prompt if enabled.
 *
 * @param {Object} argv - Parsed command line arguments.
 * @returns {string} The sub-prompt content, or an empty string when disabled.
 */
export const getHandoffSubPrompt = argv => {
  if (argv && argv.useHandoff) {
    return buildHandoffSubPrompt();
  }
  return '';
};

// Export all functions as default object too (mirrors architecture-care module)
export default {
  HANDOFF_FILE_NAME,
  buildHandoffSubPrompt,
  getHandoffSubPrompt,
};
