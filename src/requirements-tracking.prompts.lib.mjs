/**
 * Requirements tracking sub-prompt module.
 *
 * This experimental feature is enabled via --requirements-tracking.
 */

/**
 * Build the requirements tracking sub-prompt content.
 *
 * @returns {string} The formatted sub-prompt for requirements tracking.
 */
export const buildRequirementsTrackingSubPrompt = () => {
  return `
Requirements Tracking.
   - This repository uses docs/requirements/*.md as the persistent requirements ledger.
   - docs/requirements/README.md is the main index for repository requirements.
   - At the start of work, if docs/requirements/README.md exists, read it and the requirement documents it references before changing code.
   - Keep requirements short, factual, repository-level, and useful for future issue work. Do not duplicate issue transcripts.
   - When an issue, issue comment, pull request comment, or review adds, modifies, or removes a repository requirement, update docs/requirements/*.md in the same pull request.
   - If requirements tracking is enabled and no docs/requirements/ directory exists, create docs/requirements/README.md with the current known requirements.
   - Before finalizing, check the pull request files and confirm docs/requirements/*.md changed when repository requirements changed.
   - If no repository requirement changed, state that explicitly in the pull request description.`;
};

/**
 * Get the requirements tracking sub-prompt if enabled.
 *
 * @param {Object} argv - Command line arguments.
 * @returns {string} The sub-prompt content or empty string if disabled.
 */
export const getRequirementsTrackingSubPrompt = argv => {
  if (argv && argv.requirementsTracking) {
    return buildRequirementsTrackingSubPrompt();
  }
  return '';
};

export default {
  buildRequirementsTrackingSubPrompt,
  getRequirementsTrackingSubPrompt,
};
