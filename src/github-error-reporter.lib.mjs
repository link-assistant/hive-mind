#!/usr/bin/env node
import { ensureUseM } from './use-m-bootstrap.lib.mjs';

/**
 * GitHub error reporter - handles error reporting via GitHub issues and comments
 */

import { createInterface } from 'readline';
import { log, cleanErrorMessage, getAbsoluteLogPath } from './lib.mjs';
import { reportError, isSentryEnabled } from './sentry.lib.mjs';
import { sanitizeForPublication, writeSanitizedPublicationFile } from './token-sanitization.lib.mjs';
import { sanitizeLogFileToFile } from './log-sanitize-stream.lib.mjs';
import { readLogTailText } from './log-bounded-read.lib.mjs';

if (typeof globalThis.use === 'undefined') {
  await ensureUseM();
}

const fs = (await use('fs')).promises;
const { $: __rawDollar$ } = await use('command-stream');
const { wrapDollarWithGhRetry } = await import('./github-rate-limit.lib.mjs');
const { QUIET_PROBE } = await import('./quiet-probe.lib.mjs'); // issue #2130: keep read-only probe payloads out of the attached log
const $ = wrapDollarWithGhRetry(__rawDollar$);
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
    const result = await $(QUIET_PROBE)`gh api user --jq .login`;
    if (result.exitCode === 0) {
      const user = result.stdout.toString().trim();
      if (user) return user;
    }
  } catch (error) {
    reportError(error, {
      context: 'get_github_user',
      operation: 'gh_api_user',
    });
  }
  // Issue #1462: Fallback to gh auth status when gh api user fails
  // This handles OAuth tokens (gho_****) that may lack the 'user' API scope
  try {
    const authResult = await $`gh auth status --hostname github.com 2>&1`;
    const output = (authResult.stdout?.toString() || '') + (authResult.stderr?.toString() || '');
    const userMatch = output.match(/Logged in to github\.com account (\S+)/i) || output.match(/Logged in to github\.com as (\S+)/i);
    if (userMatch) {
      return userMatch[1];
    }
  } catch {
    // Silently ignore - will return null below
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
  const tempFile = `/tmp/${filename}`;
  try {
    await writeSanitizedPublicationFile(tempFile, logContent);

    const result = await $`gh gist create ${tempFile} --secret --desc "Error log for hive-mind"`;
    if (result.exitCode === 0) {
      const gistUrl = result.stdout.toString().trim();
      return gistUrl;
    }
  } catch (error) {
    reportError(error, {
      context: 'create_secret_gist',
      operation: 'gh_gist_create',
    });
  } finally {
    await fs.unlink(tempFile).catch(() => {});
  }
  return null;
};

/**
 * Upload a log FILE as a secret gist without ever holding it in memory.
 *
 * Issue #2189: the error reporter runs when the process is already in trouble —
 * frequently because it just exhausted its heap. Reading the log to sanitize it
 * (`readFile` + `sanitizeForPublication` + write = three full copies) is the one
 * thing that must not happen there.
 *
 * @param {string} logFilePath - Log to upload
 * @param {string} filename - Name for the gist file
 * @returns {Promise<string|null>} Gist URL, or null when the upload failed
 */
const createSecretGistFromFile = async (logFilePath, filename) => {
  const tempFile = `/tmp/${filename}`;
  try {
    await sanitizeLogFileToFile({ sourcePath: logFilePath, destPath: tempFile });
    const result = await $`gh gist create ${tempFile} --secret --desc "Error log for hive-mind"`;
    if (result.exitCode === 0) {
      return result.stdout.toString().trim();
    }
  } catch (error) {
    reportError(error, {
      context: 'create_secret_gist',
      operation: 'gh_gist_create',
    });
  } finally {
    await fs.unlink(tempFile).catch(() => {});
  }
  return null;
};

/**
 * Format a log FILE for an issue body, choosing the attachment method from the
 * file's size before reading any of it (issue #2189).
 *
 * Only the inline branch — by definition below GitHub's 60 kB issue-body limit —
 * ever reads log content, and the truncated fallback reads a bounded tail.
 *
 * @param {string} logFilePath - Path to the log file
 * @returns {Promise<{method: string, content: string}>}
 */
export const formatLogFileForIssue = async logFilePath => {
  const { size } = await fs.stat(logFilePath);

  if (size < GITHUB_ISSUE_BODY_MAX_SIZE) {
    const logContent = await fs.readFile(logFilePath, 'utf8');
    return {
      method: 'inline',
      content: `\`\`\`\n${logContent}\n\`\`\``,
    };
  }

  if (size < GITHUB_FILE_MAX_SIZE) {
    return {
      method: 'file',
      content: `Log file is too large to include inline. Please see the attached log file.\n\nLog file path: \`${logFilePath}\``,
    };
  }

  const gistUrl = await createSecretGistFromFile(logFilePath, `hive-mind-error-${Date.now()}.log`);
  if (gistUrl) {
    return {
      method: 'gist',
      content: `Log file is too large for inline attachment.\n\n📄 View full log: ${gistUrl}`,
    };
  }

  const tail = await readLogTailText(logFilePath, { maxBytes: 5000 });
  return {
    method: 'truncated',
    content: `Log file is too large. Showing last 5000 characters:\n\n\`\`\`\n${tail}\n\`\`\``,
  };
};

/**
 * Format log content for issue body
 *
 * Prefer {@link formatLogFileForIssue} when the log is a file on disk: this
 * variant needs the whole log as a string, which is exactly what issue #2189
 * removed from the publication path.
 *
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
  const { error, errorType, logFile, context = {}, autoReport = false } = options;

  try {
    const currentUser = await getCurrentGitHubUser();
    if (!currentUser) {
      await log('⚠️  Could not determine GitHub user. Cannot create error report issue.', { level: 'warning' });
      return null;
    }

    const errorMessage = cleanErrorMessage(error);

    let shouldCreateIssue;
    if (autoReport) {
      // Auto-report mode: skip prompt, automatically create issue
      console.log('\n❌ An error occurred:');
      console.log(`   ${errorMessage}`);
      if (isSentryEnabled()) {
        console.log('\n✅ Error reported to Sentry successfully');
      }
      console.log('\nℹ️  --auto-report-issue enabled: automatically creating GitHub issue...');
      shouldCreateIssue = true;
    } else {
      shouldCreateIssue = await promptUserForIssueCreation(errorMessage);
    }

    if (!shouldCreateIssue) {
      await log('ℹ️  Issue creation cancelled by user');
      return null;
    }

    await log('\n🔄 Creating GitHub issue...');

    const issueTitle = await sanitizeForPublication(error.message || errorMessage || `${errorType} in hive-mind`);

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
        // Issue #2189: pick the attachment method from the file size first; a
        // log too large for the issue body is never read into memory here.
        const { method, content } = await formatLogFileForIssue(logFile);

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

    if (autoReport) {
      issueBody += '### Instructions\n\n';
      issueBody += 'We need to download all logs and data related about the issue to this repository, ';
      issueBody += 'make sure we compile that data to `./docs/case-studies/issue-{id}` folder, ';
      issueBody += 'and use it to do deep case study analysis (also make sure to search online for additional facts and data), ';
      issueBody += 'in which we will reconstruct timeline/sequence of events, find root causes of the problem, ';
      issueBody += 'and propose possible solutions (including known existing components/libraries, ';
      issueBody += 'that solve similar problem or can help in solutions).\n\n';
      issueBody += 'If there is not enough data to find actual root cause, add debug output and verbose mode if not present, ';
      issueBody += 'that will allow us to find root cause on next iteration.\n\n';
      issueBody += 'If issue related to any other repository/project, where we can report issues on GitHub, please do so. ';
      issueBody += 'Each issue must contain reproducible examples, workarounds and suggestions for fix the issue in code.\n\n';
    }

    issueBody += '---\n';
    issueBody += `*This issue was automatically created by @${currentUser} using hive-mind error reporting*\n`;

    const tempBodyFile = `/tmp/hive-mind-issue-body-${Date.now()}.md`;
    await writeSanitizedPublicationFile(tempBodyFile, issueBody);

    let result;
    try {
      result = await $`gh issue create --repo link-assistant/hive-mind --title ${issueTitle} --body-file ${tempBodyFile} --label bug`;
    } finally {
      await fs.unlink(tempBodyFile).catch(() => {});
    }

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
  const { error, errorType, logFile, context = {}, skipPrompt = false, autoReport = false, disableReport = false } = options;

  // --disable-report-issue takes highest precedence
  if (disableReport) {
    await log('ℹ️  Error issue creation is disabled by CLI configuration.');
    return null;
  }

  // --auto-report-issue: create issue automatically without prompting
  if (autoReport) {
    return await createIssueForError({
      error,
      errorType,
      logFile: logFile || (await getAbsoluteLogPath()),
      context,
      autoReport: true,
    });
  }

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
