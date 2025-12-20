#!/usr/bin/env node
// YouTrack-related utility functions

// Check if use is already defined (when imported from other modules)
// If not, fetch it (when running standalone)
if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

// Import log and other utilities from general lib
import { log, cleanErrorMessage } from '../lib.mjs';

/**
 * YouTrack API configuration object
 * @typedef {Object} YouTrackConfig
 * @property {string} url - YouTrack instance URL (e.g., https://mycompany.youtrack.cloud)
 * @property {string} apiKey - YouTrack API token/key for authentication
 * @property {string} projectCode - Project code to monitor (e.g., PROJECT-1)
 * @property {string} stage - Stage to monitor for issues (e.g., "Ready for Development")
 * @property {string} nextStage - Stage to move issues to after PR creation (e.g., "In Review")
 */

/**
 * YouTrack issue object
 * @typedef {Object} YouTrackIssue
 * @property {string} id - Issue ID (e.g., PROJECT-123)
 * @property {string} summary - Issue title/summary
 * @property {string} description - Issue description
 * @property {string} stage - Current stage/status
 * @property {string} url - Direct URL to the issue
 * @property {string} reporter - Issue reporter
 * @property {string} assignee - Issue assignee (if any)
 * @property {Date} created - Creation date
 * @property {Date} updated - Last update date
 */

/**
 * Validate YouTrack configuration
 * @param {YouTrackConfig} config - YouTrack configuration
 * @throws {Error} If configuration is invalid
 */
export function validateYouTrackConfig(config) {
  if (!config) {
    throw new Error('YouTrack configuration is required');
  }

  if (!config.url) {
    throw new Error('YOUTRACK_URL is required');
  }

  if (!config.apiKey) {
    throw new Error('YOUTRACK_API_KEY is required');
  }

  if (!config.projectCode) {
    throw new Error('YOUTRACK_PROJECT_CODE is required');
  }

  if (!config.stage) {
    throw new Error('YOUTRACK_STAGE is required');
  }

  // Validate URL format
  try {
    new URL(config.url);
  } catch {
    throw new Error(`Invalid YOUTRACK_URL format: ${config.url}`);
  }

  // Ensure URL ends with proper format
  if (!config.url.includes('.youtrack.')) {
    throw new Error(`YouTrack URL should contain '.youtrack.': ${config.url}`);
  }
}

/**
 * Make authenticated request to YouTrack API
 * @param {string} endpoint - API endpoint (relative to /api)
 * @param {YouTrackConfig} config - YouTrack configuration
 * @param {Object} options - Additional options (method, body, etc.)
 * @returns {Promise<Object>} API response
 */
async function makeYouTrackRequest(endpoint, config, options = {}) {
  const { method = 'GET', body = null, headers = {} } = options;

  // Construct full API URL
  const baseUrl = config.url.endsWith('/') ? config.url.slice(0, -1) : config.url;
  const fullUrl = `${baseUrl}/api${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;

  // Debug logging for API calls
  if (global.verboseMode || process.env.VERBOSE === 'true') {
    await log(`   YouTrack API call: ${method} ${fullUrl}`, { verbose: true });
  }

  // Prepare headers
  const requestHeaders = {
    'Authorization': `Bearer ${config.apiKey}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    ...headers
  };

  // Prepare request options
  const requestOptions = {
    method,
    headers: requestHeaders
  };

  if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    requestOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  try {
    const response = await fetch(fullUrl, requestOptions);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`YouTrack API error (${response.status}): ${errorText}`);
    }

    // Handle empty responses (e.g., from POST requests)
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      return {};
    }

    return await response.json();
  } catch (error) {
    if (error.message.includes('fetch')) {
      throw new Error(`Failed to connect to YouTrack at ${config.url}: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Test YouTrack API connection
 * @param {YouTrackConfig} config - YouTrack configuration
 * @returns {Promise<boolean>} True if connection is successful
 */
export async function testYouTrackConnection(config) {
  try {
    validateYouTrackConfig(config);

    // Add debug logging
    await log(`🔍 Testing YouTrack connection to: ${config.url}`);
    await log(`   Project: ${config.projectCode}`);
    await log(`   Stage: ${config.stage}`);

    // Test connection by fetching user info
    // Note: YouTrack Cloud uses /users/me, not /admin/users/me
    await makeYouTrackRequest('/users/me', config);
    await log(`✅ YouTrack connection successful: ${config.url}`);
    return true;
  } catch (error) {
    await log(`❌ YouTrack connection failed: ${cleanErrorMessage(error)}`, { level: 'error' });
    await log(`   URL: ${config.url}`);
    await log('   Endpoint tested: /api/users/me');
    return false;
  }
}

/**
 * Fetch issues from YouTrack project by stage
 * @param {YouTrackConfig} config - YouTrack configuration
 * @returns {Promise<YouTrackIssue[]>} Array of matching issues
 */
export async function fetchYouTrackIssues(config) {
  try {
    validateYouTrackConfig(config);

    await log(`🔍 Fetching YouTrack issues from project ${config.projectCode} with stage "${config.stage}"`);

    // Construct search query
    // YouTrack query syntax: project: {PROJECT} State: {STAGE}
    const query = `project: {${config.projectCode}} State: {${config.stage}}`;

    // Fetch issues with detailed fields including idReadable
    const endpoint = `/issues?query=${encodeURIComponent(query)}&fields=id,idReadable,summary,description,created,updated,reporter(login,fullName),assignee(login,fullName),customFields(name,value(name))`;

    const response = await makeYouTrackRequest(endpoint, config);

    if (!response || !Array.isArray(response)) {
      await log('⚠️  Unexpected response format from YouTrack API', { verbose: true });
      return [];
    }

    // Transform YouTrack issues to our standard format
    const issues = response.map(issue => ({
      id: issue.idReadable || issue.id,  // Use readable ID (PAG-45) if available
      summary: issue.summary || 'No title',
      description: issue.description || '',
      stage: config.stage, // Current stage (what we filtered by)
      url: `${config.url}/issue/${issue.idReadable || issue.id}`,
      reporter: issue.reporter ? (issue.reporter.fullName || issue.reporter.login) : 'Unknown',
      assignee: issue.assignee ? (issue.assignee.fullName || issue.assignee.login) : null,
      created: issue.created ? new Date(issue.created) : new Date(),
      updated: issue.updated ? new Date(issue.updated) : new Date()
    }));

    await log(`📋 Found ${issues.length} YouTrack issue(s) in stage "${config.stage}"`);

    if (issues.length > 0) {
      await log('   Issues found:');
      for (const issue of issues) {
        await log(`   - ${issue.id}: ${issue.summary}`);
      }
    }

    return issues;
  } catch (error) {
    await log(`❌ Error fetching YouTrack issues: ${cleanErrorMessage(error)}`, { level: 'error' });
    return [];
  }
}

/**
 * Get detailed information about a specific YouTrack issue
 * @param {string} issueId - Issue ID (e.g., PROJECT-123)
 * @param {YouTrackConfig} config - YouTrack configuration
 * @returns {Promise<YouTrackIssue|null>} Issue details or null if not found
 */
export async function getYouTrackIssue(issueId, config) {
  try {
    validateYouTrackConfig(config);

    await log(`🔍 Fetching YouTrack issue details: ${issueId}`);

    // Fetch issue with detailed fields including idReadable
    const endpoint = `/issues/${issueId}?fields=id,idReadable,summary,description,created,updated,reporter(login,fullName),assignee(login,fullName),customFields(name,value(name))`;

    const issue = await makeYouTrackRequest(endpoint, config);

    if (!issue || !issue.id) {
      await log(`❌ YouTrack issue not found: ${issueId}`, { level: 'error' });
      return null;
    }

    // Find the State/Stage custom field (check both possible names)
    let currentStage = 'Unknown';
    if (issue.customFields && Array.isArray(issue.customFields)) {
      const stateField = issue.customFields.find(field =>
        field.name === 'State' || field.name === 'Stage'
      );
      if (stateField && stateField.value && stateField.value.name) {
        currentStage = stateField.value.name;
      }
    }

    // Transform to our standard format
    const transformedIssue = {
      id: issue.idReadable || issue.id,  // Use readable ID (PAG-45) as primary ID
      idReadable: issue.idReadable || issue.id, // User-friendly ID like PAG-55
      summary: issue.summary || 'No title',
      description: issue.description || '',
      stage: currentStage,
      url: `${config.url}/issue/${issue.idReadable || issue.id}`,
      reporter: issue.reporter ? (issue.reporter.fullName || issue.reporter.login) : 'Unknown',
      assignee: issue.assignee ? (issue.assignee.fullName || issue.assignee.login) : null,
      created: issue.created ? new Date(issue.created) : new Date(),
      updated: issue.updated ? new Date(issue.updated) : new Date()
    };

    await log(`✅ Retrieved YouTrack issue: ${transformedIssue.id} - ${transformedIssue.summary}`);

    return transformedIssue;
  } catch (error) {
    await log(`❌ Error fetching YouTrack issue ${issueId}: ${cleanErrorMessage(error)}`, { level: 'error' });
    return null;
  }
}

/**
 * Update YouTrack issue stage/status
 * @param {string} issueId - Issue ID (e.g., PROJECT-123)
 * @param {string} newStage - New stage name
 * @param {YouTrackConfig} config - YouTrack configuration
 * @returns {Promise<boolean>} True if update was successful
 */
export async function updateYouTrackIssueStage(issueId, newStage, config) {
  try {
    validateYouTrackConfig(config);

    await log(`🔄 Updating YouTrack issue ${issueId} stage to "${newStage}"`);

    // Update the Stage custom field (note: might be 'Stage' or 'State' depending on setup)
    const endpoint = `/issues/${issueId}`;
    const updateData = {
      customFields: [
        {
          $type: 'StateIssueCustomField',
          name: 'Stage',
          value: {
            $type: 'StateBundleElement',
            name: newStage
          }
        }
      ]
    };

    await makeYouTrackRequest(endpoint, config, {
      method: 'POST',
      body: updateData
    });

    await log(`✅ Updated YouTrack issue ${issueId} stage to "${newStage}"`);
    return true;
  } catch (error) {
    await log(`❌ Error updating YouTrack issue ${issueId} stage: ${cleanErrorMessage(error)}`, { level: 'error' });
    return false;
  }
}

/**
 * Add comment to YouTrack issue
 * @param {string} issueId - Issue ID (e.g., PROJECT-123)
 * @param {string} comment - Comment text (supports markdown)
 * @param {YouTrackConfig} config - YouTrack configuration
 * @returns {Promise<boolean>} True if comment was added successfully
 */
export async function addYouTrackComment(issueId, comment, config) {
  try {
    validateYouTrackConfig(config);

    await log(`💬 Adding comment to YouTrack issue ${issueId}`);

    // Add comment using the comments API
    const endpoint = `/issues/${issueId}/comments`;
    const commentData = {
      text: comment,
      usesMarkdown: true
    };

    await makeYouTrackRequest(endpoint, config, {
      method: 'POST',
      body: commentData
    });

    await log(`✅ Added comment to YouTrack issue ${issueId}`);
    return true;
  } catch (error) {
    await log(`❌ Error adding comment to YouTrack issue ${issueId}: ${cleanErrorMessage(error)}`, { level: 'error' });
    return false;
  }
}

/**
 * Create YouTrack configuration from environment variables
 * @returns {YouTrackConfig|null} Configuration object or null if not properly configured
 */
export function createYouTrackConfigFromEnv() {
  const config = {
    url: process.env.YOUTRACK_URL,
    apiKey: process.env.YOUTRACK_API_KEY,
    projectCode: process.env.YOUTRACK_PROJECT_CODE,
    stage: process.env.YOUTRACK_STAGE,
    nextStage: process.env.YOUTRACK_NEXT_STAGE
  };

  // Check if basic configuration is available
  if (!config.url || !config.apiKey || !config.projectCode || !config.stage) {
    return null;
  }

  return config;
}

/**
 * Parse YouTrack issue ID from URL or text
 * @param {string} input - URL or text containing YouTrack issue ID
 * @returns {string|null} Issue ID or null if not found
 */
export function parseYouTrackIssueId(input) {
  if (!input || typeof input !== 'string') {
    return null;
  }

  // Pattern to match YouTrack issue IDs (PROJECT-123 or 2-123 format)
  // Some YouTrack instances use numeric project codes
  const patterns = [
    // Direct ID format (allows numeric or alphanumeric project codes)
    /^([A-Z0-9][A-Z0-9]*-\d+)$/i,
    // URL format: https://company.youtrack.cloud/issue/PROJECT-123
    /\/issue\/([A-Z0-9][A-Z0-9]*-\d+)/i,
    // Text containing issue ID
    /\b([A-Z0-9][A-Z0-9]*-\d+)\b/i
  ];

  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) {
      return match[1].toUpperCase();
    }
  }

  return null;
}

/**
 * Convert YouTrack issue to GitHub-compatible format for solve.mjs
 * @param {YouTrackIssue} youTrackIssue - YouTrack issue
 * @param {string} githubRepoUrl - Target GitHub repository URL
 * @returns {Object} GitHub-compatible issue format
 */
export function convertYouTrackIssueForGitHub(youTrackIssue, githubRepoUrl) {
  return {
    // Use a special URL format that solve.mjs can recognize as YouTrack
    url: `youtrack://${youTrackIssue.id}`,
    title: youTrackIssue.summary,
    body: youTrackIssue.description,
    number: youTrackIssue.id,
    // Store original YouTrack data for later use
    youtrack: {
      id: youTrackIssue.id,
      url: youTrackIssue.url,
      stage: youTrackIssue.stage,
      reporter: youTrackIssue.reporter,
      assignee: youTrackIssue.assignee
    },
    // Store GitHub repo info for PR creation
    github: {
      repoUrl: githubRepoUrl
    }
  };
}