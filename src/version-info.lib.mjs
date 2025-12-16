#!/usr/bin/env node

// Version information library for hive-mind project
// Provides comprehensive version information for bot, commands, and runtime

import { getVersion } from './version.lib.mjs';

/**
 * Get comprehensive version information for all components
 * @param {boolean} verbose - Enable verbose logging
 * @returns {Promise<Object>} Version information object
 */
export async function getVersionInfo(verbose = false) {
  try {
    if (verbose) {
      console.log('[VERBOSE] Gathering version information...');
    }

    // Get hive-mind package version
    const packageVersion = await getVersion();

    if (verbose) {
      console.log(`[VERBOSE] Package version: ${packageVersion}`);
    }

    // Get Node.js runtime version
    const nodeVersion = process.version;

    if (verbose) {
      console.log(`[VERBOSE] Node.js version: ${nodeVersion}`);
    }

    // Get platform information
    const platform = process.platform;
    const arch = process.arch;

    if (verbose) {
      console.log(`[VERBOSE] Platform: ${platform} (${arch})`);
    }

    // Build version info object
    const versionInfo = {
      success: true,
      versions: {
        bot: packageVersion,
        solve: packageVersion,
        hive: packageVersion,
        node: nodeVersion,
        platform: `${platform} (${arch})`,
      },
    };

    if (verbose) {
      console.log('[VERBOSE] Version info gathered successfully:', JSON.stringify(versionInfo, null, 2));
    }

    return versionInfo;
  } catch (error) {
    if (verbose) {
      console.error('[VERBOSE] Error gathering version info:', error);
    }

    return {
      success: false,
      error: error.message || 'Failed to gather version information',
    };
  }
}

/**
 * Format version information as a Telegram message
 * @param {Object} versions - Version information object
 * @returns {string} Formatted message
 */
export function formatVersionMessage(versions) {
  const lines = [];

  // Bot version
  if (versions.bot) {
    lines.push(`*Bot:* \`${versions.bot}\``);
  }

  // Command versions
  if (versions.solve) {
    lines.push(`*solve:* \`${versions.solve}\``);
  }

  if (versions.hive) {
    lines.push(`*hive:* \`${versions.hive}\``);
  }

  // Runtime information
  if (versions.node) {
    lines.push('');
    lines.push('*Runtime:*');
    lines.push(`• Node.js: \`${versions.node}\``);
  }

  if (versions.platform) {
    lines.push(`• Platform: \`${versions.platform}\``);
  }

  return lines.join('\n');
}

export default {
  getVersionInfo,
  formatVersionMessage,
};
