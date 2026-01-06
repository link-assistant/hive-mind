#!/usr/bin/env node

/**
 * Automatic GitHub issue creation for error reporting
 */

import { createInterface } from 'readline';
import { log, cleanErrorMessage, getAbsoluteLogPath } from './lib.mjs';
import { reportError, isSentryEnabled } from './sentry.lib.mjs';

if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const fs = (await use('fs')).promises;
const { $ } = await use('command-stream');

const GITHUB_ISSUE_BODY_MAX_SIZE = 60000;
const GITHUB_FILE_MAX_SIZE = 10 * 1024 * 1024;

/**
 * Prompt user for confirmation to create GitHub issue
 * @param {string} errorMessage - The error message to display
 * @returns {Promise<boolean>} True if user agrees, false otherwise
 */
export const promptUserForIssueCreation = async errorMessage => {
  return new Promise(resolve => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log('\n❌ An error occurred:');
    console.log(`   ${errorMessage}`);

    if (isSentryEnabled()) {
      console.log('\n✅ Error reported to Sentry successfully');
    }

    rl.question('\n❓ Would you like to create a GitHub issue for this error? (y/n): ', answer => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
};

/**
 * Get current GitHub user
 * @returns {Promise<string|null>} GitHub username or null
 */
const getCurrentGitHubUser = async () => {
  try {
    const result = await $`gh api user --jq .login`;
    if (result.exitCode === 0) {
      return result.stdout.toString().trim();
    }
  } catch (error) {
    reportError(error, {
      context: 'get_github_user',
      operation: 'gh_api_user',
    });
  }
  return null;
};

/**
 * Create a secret gist with log content
 * @param {string} logContent - Content to upload
 * @param {string} filename - Filename for the gist
 * @returns {Promise<string|null>} Gist URL or null on failure
 */
const createSecretGist = async (logContent, filename) => {
  try {
    const tempFile = `/tmp/${filename}`;
    await fs.writeFile(tempFile, logContent);

    const result = await $`gh gist create ${tempFile} --secret --desc "Error log for hive-mind"`;
    if (result.exitCode === 0) {
      const gistUrl = result.stdout.toString().trim();
      await fs.unlink(tempFile).catch(() => {});
      return gistUrl;
    }
  } catch (error) {
    reportError(error, {
      context: 'create_secret_gist',
      operation: 'gh_gist_create',
    });
  }
  return null;
};

/**
 * Format log content for issue body
 * @param {string} logContent - Log file content
 * @param {string} logFilePath - Path to log file
 * @returns {Promise<Object>} Object with formatted content and attachment method
 */
export const formatLogForIssue = async (logContent, logFilePath) => {
  const logSize = Buffer.byteLength(logContent, 'utf8');

  if (logSize < GITHUB_ISSUE_BODY_MAX_SIZE) {
    return {
      method: 'inline',
      content: `\`\`\`\n${logContent}\n\`\`\``,
    };
  }

  if (logSize < GITHUB_FILE_MAX_SIZE) {
    return {
      method: 'file',
      content: `Log file is too large to include inline. Please see the attached log file.\n\nLog file path: \`${logFilePath}\``,
    };
  }

  const gistUrl = await createSecretGist(logContent, `hive-mind-error-${Date.now()}.log`);
  if (gistUrl) {
    return {
      method: 'gist',
      content: `Log file is too large for inline attachment.\n\n📄 View full log: ${gistUrl}`,
    };
  }

  return {
    method: 'truncated',
    content: `Log file is too large. Showing last 5000 characters:\n\n\`\`\`\n${logContent.slice(-5000)}\n\`\`\``,
  };
};

/**
 * Create GitHub issue for error
 * @param {Object} options - Issue creation options
 * @param {Error} options.error - The error object
 * @param {string} options.errorType - Type of error (uncaughtException, unhandledRejection, execution)
 * @param {string} options.logFile - Path to log file
 * @param {Object} options.context - Additional context about the error
 * @returns {Promise<string|null>} Issue URL or null on failure
 */
export const createIssueForError = async options => {
  const { error, errorType, logFile, context = {} } = options;

  try {
    const currentUser = await getCurrentGitHubUser();
    if (!currentUser) {
      await log('⚠️  Could not determine GitHub user. Cannot create error report issue.', { level: 'warning' });
      return null;
    }

    const errorMessage = cleanErrorMessage(error);
    const shouldCreateIssue = await promptUserForIssueCreation(errorMessage);

    if (!shouldCreateIssue) {
      await log('ℹ️  Issue creation cancelled by user');
      return null;
    }

    await log('\n🔄 Creating GitHub issue...');

    const issueTitle = error.message || errorMessage || `${errorType} in hive-mind`;

    let issueBody = '## Error Details\n\n';
    issueBody += `**Type**: ${errorType}\n`;
    issueBody += `**Message**: ${errorMessage}\n\n`;

    if (error.stack) {
      issueBody += `### Stack Trace\n\n\`\`\`\n${error.stack}\n\`\`\`\n\n`;
    }

    if (Object.keys(context).length > 0) {
      issueBody += `### Context\n\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\`\n\n`;
    }

    if (logFile) {
      try {
        const logContent = await fs.readFile(logFile, 'utf8');
        const { method, content } = await formatLogForIssue(logContent, logFile);

        issueBody += `### Log File\n\n${content}\n\n`;
        await log(`📄 Log attached via: ${method}`);
      } catch (readError) {
        reportError(readError, {
          context: 'read_log_file',
          operation: 'fs_read_file',
          logFile,
        });
        issueBody += `### Log File\n\nCould not read log file: ${logFile}\n\n`;
      }
    }

    issueBody += '---\n';
    issueBody += `*This issue was automatically created by @${currentUser} using hive-mind error reporting*\n`;

    const tempBodyFile = `/tmp/hive-mind-issue-body-${Date.now()}.md`;
    await fs.writeFile(tempBodyFile, issueBody);

    const result = await $`gh issue create --repo link-assistant/hive-mind --title ${issueTitle} --body-file ${tempBodyFile} --label bug`;

    await fs.unlink(tempBodyFile).catch(() => {});

    if (result.exitCode === 0) {
      const issueUrl = result.stdout.toString().trim();
      await log(`✅ Issue created: ${issueUrl}`);
      return issueUrl;
    } else {
      await log(`❌ Failed to create issue: ${result.stderr || 'Unknown error'}`, { level: 'error' });
      return null;
    }
  } catch (createError) {
    reportError(createError, {
      context: 'create_github_issue',
      operation: 'gh_issue_create',
      originalError: error.message,
    });
    await log(`❌ Error creating issue: ${cleanErrorMessage(createError)}`, { level: 'error' });
    return null;
  }
};

/**
 * Handle error with optional automatic issue creation
 * @param {Object} options - Error handling options
 * @param {Error} options.error - The error object
 * @param {string} options.errorType - Type of error
 * @param {string} options.logFile - Path to log file
 * @param {Object} options.context - Additional context
 * @param {boolean} options.skipPrompt - Skip user prompt (for non-interactive mode)
 * @returns {Promise<string|null>} Issue URL if created, null otherwise
 */
export const handleErrorWithIssueCreation = async options => {
  const { error, errorType, logFile, context = {}, skipPrompt = false } = options;

  if (skipPrompt) {
    return null;
  }

  if (!process.stdin.isTTY) {
    await log('ℹ️  Non-interactive mode detected. Skipping issue creation prompt.');
    return null;
  }

  return await createIssueForError({
    error,
    errorType,
    logFile: logFile || (await getAbsoluteLogPath()),
    context,
  });
};
