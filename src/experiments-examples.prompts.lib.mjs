import { promptText } from './prompt-text.lib.mjs';
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
    lines.push(promptText('prompt.system.templates.experiments-examples-prompts.getExperimentsExamplesSubPrompt.text1', { examplesFolder: String(examplesFolder), experimentsFolder: String(experimentsFolder) }));
    lines.push(promptText('prompt.system.templates.experiments-examples-prompts.getExperimentsExamplesSubPrompt.text2', { experimentsFolder: String(experimentsFolder) }));
    lines.push(promptText('prompt.system.templates.experiments-examples-prompts.getExperimentsExamplesSubPrompt.text3', { examplesFolder: String(examplesFolder) }));
  }
  // Only experiments folder is enabled
  else if (experimentsFolder) {
    lines.push(promptText('prompt.system.templates.experiments-examples-prompts.getExperimentsExamplesSubPrompt.text4', { experimentsFolder: String(experimentsFolder) }));
    lines.push(promptText('prompt.system.templates.experiments-examples-prompts.getExperimentsExamplesSubPrompt.text5', { experimentsFolder: String(experimentsFolder) }));
  }
  // Only examples folder is enabled
  else if (examplesFolder) {
    lines.push(promptText('prompt.system.templates.experiments-examples-prompts.getExperimentsExamplesSubPrompt.text6', { examplesFolder: String(examplesFolder) }));
    lines.push(promptText('prompt.system.templates.experiments-examples-prompts.getExperimentsExamplesSubPrompt.text7', { examplesFolder: String(examplesFolder) }));
  }

  return lines.join('\n');
};

export default {
  getExperimentsExamplesSubPrompt,
};
