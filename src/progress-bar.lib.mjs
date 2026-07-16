/**
 * Text progress bar rendering shared by the /limits sections.
 *
 * Extracted from limits.lib.mjs so that section formatters can render bars
 * without importing limits.lib.mjs itself (which would be a cycle, since
 * limits.lib.mjs imports those formatters).
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1242
 */

/**
 * Generate a text-based progress bar for usage percentage
 * @param {number} percentage - Usage percentage (0-100)
 * @param {number|null} thresholdPercentage - Optional threshold position to show in the bar (0-100)
 * @returns {string} Text-based progress bar
 * @see https://github.com/link-assistant/hive-mind/issues/1242
 */
export function getProgressBar(percentage, thresholdPercentage = null) {
  const totalBlocks = 30;
  const filledBlocks = Math.round((percentage / 100) * totalBlocks);

  if (thresholdPercentage === null) {
    // No threshold - original behavior
    const emptyBlocks = totalBlocks - filledBlocks;
    return '▓'.repeat(filledBlocks) + '░'.repeat(emptyBlocks);
  }

  // With threshold marker
  const thresholdPos = Math.round((thresholdPercentage / 100) * totalBlocks);
  let bar = '';

  for (let i = 0; i < totalBlocks; i++) {
    if (i === thresholdPos) {
      bar += '│'; // Threshold marker (U+2502 Box Drawings Light Vertical)
    } else if (i < filledBlocks) {
      bar += '▓'; // Filled (U+2593)
    } else {
      bar += '░'; // Empty (U+2591)
    }
  }

  return bar;
}

export default { getProgressBar };
