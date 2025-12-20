#!/usr/bin/env node

/**
 * YouTrack integration module for solve.mjs
 * Handles YouTrack URL validation, configuration, and issue updates
 */

// Import YouTrack-related functions
const youTrackLib = await import('./youtrack.lib.mjs');
const {
  parseYouTrackIssueId,
  updateYouTrackIssueStage,
  addYouTrackComment,
  createYouTrackConfigFromEnv
} = youTrackLib;

/**
 * Validates YouTrack URLs and extracts issue information
 * @param {string} issueUrl - The URL or issue ID to validate
 * @returns {Object} Validation result with YouTrack info
 */
export async function validateYouTrackUrl(issueUrl) {
  let isYouTrackUrl = null;
  let youTrackIssueId = null;
  let youTrackConfig = null;

  if (!issueUrl) {
    return { isYouTrackUrl: false, youTrackIssueId: null, youTrackConfig: null };
  }

  // Check for YouTrack issue format (youtrack://PROJECT-123 or youtrack://2-123)
  isYouTrackUrl = issueUrl.match(/^youtrack:\/\/([A-Z0-9]+-\d+)$/i);

  // Also check if it's a direct YouTrack issue ID
  if (!isYouTrackUrl) {
    youTrackIssueId = parseYouTrackIssueId(issueUrl);
    if (youTrackIssueId) {
      isYouTrackUrl = [issueUrl, youTrackIssueId];
    }
  } else {
    youTrackIssueId = isYouTrackUrl[1];
  }

  // If YouTrack URL detected, set up YouTrack configuration
  if (isYouTrackUrl) {
    youTrackConfig = createYouTrackConfigFromEnv();
    if (!youTrackConfig) {
      console.error('Error: YouTrack URL detected but YouTrack configuration not found');
      console.error('  Required environment variables:');
      console.error('    YOUTRACK_URL - Your YouTrack instance URL');
      console.error('    YOUTRACK_API_KEY - Your YouTrack API token');
      console.error('    YOUTRACK_PROJECT_CODE - Project code (e.g., PAG)');
      console.error('    YOUTRACK_STAGE - Current stage field value');
      console.error('  Optional:');
      console.error('    YOUTRACK_NEXT_STAGE - Stage to move issue to after PR creation');
      process.exit(1);
    }
  }

  return {
    isYouTrackUrl: !!isYouTrackUrl,
    youTrackIssueId,
    youTrackConfig
  };
}

/**
 * Updates YouTrack issue with PR information and stage changes
 * @param {string} youTrackIssueId - The YouTrack issue ID
 * @param {Object} youTrackConfig - YouTrack configuration
 * @param {string} prUrl - Pull request URL
 * @param {Function} log - Logging function
 */
export async function updateYouTrackIssue(youTrackIssueId, youTrackConfig, prUrl, log) {
  if (!youTrackIssueId || !youTrackConfig || !prUrl) {
    return;
  }

  await log(`\n🔗 Updating YouTrack issue ${youTrackIssueId}...`);

  // Add comment about PR
  const prComment = `Pull Request created: ${prUrl}\n\nPlease review the proposed solution.`;
  const commentAdded = await addYouTrackComment(youTrackIssueId, prComment, youTrackConfig);
  if (commentAdded) {
    await log('✅ Added comment to YouTrack issue');
  } else {
    await log('⚠️ Failed to add comment to YouTrack issue', { level: 'warning' });
  }

  // Update issue stage if nextStage is configured
  if (youTrackConfig.nextStage) {
    const stageUpdated = await updateYouTrackIssueStage(youTrackIssueId, youTrackConfig.nextStage, youTrackConfig);
    if (stageUpdated) {
      await log(`✅ Updated YouTrack issue stage to "${youTrackConfig.nextStage}"`);
    } else {
      await log('⚠️ Failed to update YouTrack issue stage', { level: 'warning' });
    }
  }
}

/**
 * Checks if a URL format could be a YouTrack URL
 * @param {string} url - URL to check
 * @returns {boolean} True if it matches YouTrack patterns
 */
export function isYouTrackFormat(url) {
  if (!url) return false;

  // Check for youtrack:// format
  if (url.match(/^youtrack:\/\//)) return true;

  // Check for direct issue ID format (PROJECT-123 or 2-123)
  if (url.match(/^[A-Z0-9]+-\d+$/i)) return true;

  return false;
}