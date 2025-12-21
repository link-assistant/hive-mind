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
   - REQUIREMENTS.md is a file that gives high level description on why/what it is for and so on relative to the entire repository.
   - ARCHITECTURE.md is a file that gives high level description on how it was implemented so far.
   - When any issue or comment changes how we see REQUIREMENTS.md or ARCHITECTURE.md, these files should be updated accordingly.
   - When REQUIREMENTS.md or ARCHITECTURE.md files get too large, consider creating additional README.md, REQUIREMENTS.md, and ARCHITECTURE.md files in separate folders.
   - When creating nested documentation files, make sure the root files have references to inner level documentation.
   - When working with documentation, each README.md, REQUIREMENTS.md, and ARCHITECTURE.md scope should be related to the entire folder where such file exists.
   - When you make changes that affect the high-level purpose, goals, or requirements of the project, update REQUIREMENTS.md.
   - When you make changes that affect the implementation, architecture, or design patterns of the project, update ARCHITECTURE.md.
   - When reviewing your changes before committing, check if REQUIREMENTS.md or ARCHITECTURE.md need updates based on the scope of your changes.

TODO.md Workflow Management.
   - At the start of each working session, check if TODO.md exists in the repository root.
   - When TODO.md exists, read it first and continue finishing all items listed in it before starting any new work.
   - When all items in TODO.md are completed, delete the TODO.md file to indicate work is done.
   - When you cannot finish all tasks in the current working session, create or update TODO.md with all remaining tasks that need to be completed.
   - When creating TODO.md, use a clear markdown checklist format with each item as a separate line.
   - When updating TODO.md during a session, remove completed items and add any newly discovered tasks that couldn't be finished.
   - TODO.md serves as a persistent task list across working sessions, ensuring continuity and nothing is forgotten between sessions.
   - When starting work on a repository, the priority is: (1) Check TODO.md, (2) Complete TODO.md items, (3) Work on current issue/task, (4) Update TODO.md if needed before ending session.`;
};

/**
 * Get the architecture care sub-prompt if enabled
 * @param {Object} argv - Command line arguments
 * @returns {string} The sub-prompt content or empty string if disabled
 */
export const getArchitectureCareSubPrompt = (argv) => {
  if (argv && argv.promptArchitectureCare) {
    return buildArchitectureCareSubPrompt();
  }
  return '';
};

// Export all functions as default object too
export default {
  buildArchitectureCareSubPrompt,
  getArchitectureCareSubPrompt
};
