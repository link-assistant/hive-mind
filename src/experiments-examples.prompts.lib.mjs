/**
 * Experiments and examples folder prompts module
 * Handles building configurable prompts for experiments/examples folders
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1199
 */

/**
 * Build the experiments/examples sub-prompt based on configuration
 * @param {Object} argv - Command line arguments
 * @param {string} argv.promptExperimentsFolder - Path to experiments folder (empty string to disable)
 * @param {string} argv.promptExamplesFolder - Path to examples folder (empty string to disable)
 * @returns {string} The formatted sub-prompt for experiments/examples folders
 */
export const getExperimentsExamplesSubPrompt = argv => {
  const experimentsFolder = argv?.promptExperimentsFolder ?? './experiments';
  const examplesFolder = argv?.promptExamplesFolder ?? './examples';

  // If both are disabled, return empty string
  if (!experimentsFolder && !examplesFolder) {
    return '';
  }

  const lines = [];

  // Both folders are enabled (with their respective paths)
  if (experimentsFolder && examplesFolder) {
    lines.push(`   - When you create debug, test, or example scripts while fixing an issue, keep them in ${examplesFolder} and/or ${experimentsFolder} so you can reuse them later.`);
    lines.push(`   - When you test assumptions, keep experiment scripts in ${experimentsFolder}.`);
    lines.push(`   - When an experiment demonstrates a real-world use case of the software, add it to ${examplesFolder}.`);
  }
  // Only experiments folder is enabled
  else if (experimentsFolder) {
    lines.push(`   - When you create debug or test scripts while fixing an issue, keep them in ${experimentsFolder} so you can reuse them later.`);
    lines.push(`   - When you test assumptions, keep experiment scripts in ${experimentsFolder}.`);
  }
  // Only examples folder is enabled
  else if (examplesFolder) {
    lines.push(`   - When you create example scripts that show real-world use cases, keep them in ${examplesFolder}.`);
    lines.push(`   - When an experiment demonstrates a real-world use case of the software, add it to ${examplesFolder}.`);
  }

  return lines.join('\n');
};

export default {
  getExperimentsExamplesSubPrompt,
};
