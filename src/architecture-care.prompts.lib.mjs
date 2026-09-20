/**
 * Architecture care sub-prompt module
 * Provides guidance for managing REQUIREMENTS.md, ARCHITECTURE.md, and TODO.md files
 *
 * This is an experimental feature enabled via --prompt-architecture-care flag
 */

/**
 * Build the architecture care sub-prompt content
 * @returns {string} The formatted sub-prompt for architecture documentation care
 */
export const buildArchitectureCareSubPrompt = () => {
  return `
Architecture and Requirements Documentation Care.
   - REQUIREMENTS.md describes the high-level purpose and requirements of the repository.
   - ARCHITECTURE.md describes the high-level implementation and architecture of the repository.
   - When an issue or comment changes the understanding of REQUIREMENTS.md or ARCHITECTURE.md, update those files accordingly.
   - When REQUIREMENTS.md or ARCHITECTURE.md files get too large, consider creating additional README.md, REQUIREMENTS.md, and ARCHITECTURE.md files in separate folders.
   - When creating nested documentation files, add references from the root files to the nested documentation.
   - When working with documentation, keep each README.md, REQUIREMENTS.md, and ARCHITECTURE.md focused on the folder where the file lives.
   - When you make changes that affect the high-level purpose, goals, or requirements of the project, update REQUIREMENTS.md.
   - When you make changes that affect the implementation, architecture, or design patterns of the project, update ARCHITECTURE.md.
   - When reviewing your changes before committing, check whether REQUIREMENTS.md or ARCHITECTURE.md need updates based on the scope of the changes.

TODO.md Workflow Management.
   - When you start a working session, check whether TODO.md exists in the repository root.
   - When TODO.md exists, read it first and continue finishing all items listed in it before starting any new work.
   - When all items in TODO.md are completed, delete the TODO.md file to indicate work is done.
   - When you cannot finish all tasks in the current session, create or update TODO.md with the remaining tasks.
   - When creating TODO.md, use a clear markdown checklist format with each item as a separate line.
   - When updating TODO.md during a session, remove completed items and add newly discovered tasks that could not be finished.
   - TODO.md can serve as a persistent task list across working sessions so work remains easy to continue.
   - When you start work on a repository, use this priority order: (1) check TODO.md, (2) complete TODO.md items, (3) work on the current issue or task, (4) update TODO.md if needed before ending the session.`;
};

/**
 * Get the architecture care sub-prompt if enabled
 * @param {Object} argv - Command line arguments
 * @returns {string} The sub-prompt content or empty string if disabled
 */
export const getArchitectureCareSubPrompt = argv => {
  if (argv && argv.promptArchitectureCare) {
    return buildArchitectureCareSubPrompt();
  }
  return '';
};

// Export all functions as default object too
export default {
  buildArchitectureCareSubPrompt,
  getArchitectureCareSubPrompt,
};
