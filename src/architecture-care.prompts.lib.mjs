/**
 * Architecture care sub-prompt module
 * Provides guidance for managing REQUIREMENTS.md and ARCHITECTURE.md files
 *
 * This is an experimental feature enabled via --enable-architecture-care-sub-prompt flag
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
   - When reviewing your changes before committing, check if REQUIREMENTS.md or ARCHITECTURE.md need updates based on the scope of your changes.`;
};

/**
 * Get the architecture care sub-prompt if enabled
 * @param {Object} argv - Command line arguments
 * @returns {string} The sub-prompt content or empty string if disabled
 */
export const getArchitectureCareSubPrompt = (argv) => {
  if (argv && argv.enableArchitectureCareSubPrompt) {
    return buildArchitectureCareSubPrompt();
  }
  return '';
};

// Export all functions as default object too
export default {
  buildArchitectureCareSubPrompt,
  getArchitectureCareSubPrompt
};
