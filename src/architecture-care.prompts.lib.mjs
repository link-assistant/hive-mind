import { promptText } from './prompt-text.lib.mjs';
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
  return promptText('prompt.system.templates.architecture-care-prompts.buildArchitectureCareSubPrompt.text1');
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
