#!/usr/bin/env node

// Validation module for solve command
// Extracted from solve.mjs to keep files under 1500 lines

// Use use-m to dynamically import modules for cross-runtime compatibility
// Check if use is already defined globally (when imported from solve.mjs)
// If not, fetch it (when running standalone)
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const use = globalThis.use;

const path = (await use('path')).default;
const fs = (await use('fs')).promises;

// Import memory check functions (RAM, swap, disk)
const memoryCheck = await import('./memory-check.mjs');

// Import shared library functions
const lib = await import('./lib.mjs');
const {
  log,
  setLogFile
  // getLogFile - not currently used
} = lib;

// Import GitHub-related functions
const githubLib = await import('./github.lib.mjs');
const {
  checkGitHubPermissions,
  parseGitHubUrl
  // isGitHubUrlType - not currently used
} = githubLib;

// Import Claude-related functions
const claudeLib = await import('./claude.lib.mjs');
// Import Sentry integration
const sentryLib = await import('./sentry.lib.mjs');
const { reportError } = sentryLib;

const {
  validateClaudeConnection
} = claudeLib;

// Wrapper function for disk space check using imported module
const checkDiskSpace = async (minSpaceMB = 500) => {
  const result = await memoryCheck.checkDiskSpace(minSpaceMB, { log });
  return result.success;
};

// Wrapper function for memory check using imported module
const checkMemory = async (minMemoryMB = 256) => {
  const result = await memoryCheck.checkMemory(minMemoryMB, { log });
  return result.success;
};

// Validate GitHub issue or pull request URL format
export const validateGitHubUrl = (issueUrl) => {
  if (!issueUrl) {
    return { isValid: false, isIssueUrl: null, isPrUrl: null };
  }

  // Use the universal GitHub URL parser
  const parsedUrl = parseGitHubUrl(issueUrl);

  if (!parsedUrl.valid) {
    console.error('Error: Invalid GitHub URL format');
    if (parsedUrl.error) {
      console.error(`  ${parsedUrl.error}`);
    }
    console.error('  Please provide a valid GitHub issue or pull request URL');
    console.error('  Examples:');
    console.error('    https://github.com/owner/repo/issues/123 (issue)');
    console.error('    https://github.com/owner/repo/pull/456 (pull request)');
    console.error('  You can also use:');
    console.error('    http://github.com/owner/repo/issues/123 (will be converted to https)');
    console.error('    github.com/owner/repo/issues/123 (will add https://)');
    console.error('    owner/repo/issues/123 (will be converted to full URL)');
    return { isValid: false, isIssueUrl: null, isPrUrl: null };
  }

  // Check if it's an issue or pull request
  const isIssueUrl = parsedUrl.type === 'issue';
  const isPrUrl = parsedUrl.type === 'pull';

  if (!isIssueUrl && !isPrUrl) {
    console.error('Error: Invalid GitHub URL for solve command');
    console.error(`  URL type '${parsedUrl.type}' is not supported`);
    console.error('  Please provide a valid GitHub issue or pull request URL');
    console.error('  Examples:');
    console.error('    https://github.com/owner/repo/issues/123 (issue)');
    console.error('    https://github.com/owner/repo/pull/456 (pull request)');
    return { isValid: false, isIssueUrl: null, isPrUrl: null };
  }

  return {
    isValid: true,
    isIssueUrl,
    isPrUrl,
    normalizedUrl: parsedUrl.normalized,
    owner: parsedUrl.owner,
    repo: parsedUrl.repo,
    number: parsedUrl.number
  };
};

// Show security warning for attach-logs option
export const showAttachLogsWarning = async (shouldAttachLogs) => {
  if (!shouldAttachLogs) return;

  await log('');
  await log('⚠️  SECURITY WARNING: --attach-logs is ENABLED', { level: 'warning' });
  await log('');
  await log('   This option will upload the complete solution draft log file to the Pull Request.');
  await log('   The log may contain sensitive information such as:');
  await log('   • API keys, tokens, or secrets');
  await log('   • File paths and directory structures');
  await log('   • Command outputs and error messages');
  await log('   • Internal system information');
  await log('');
  await log('   ⚠️  DO NOT use this option with public repositories or if the log');
  await log('       might contain sensitive data that should not be shared publicly.');
  await log('');
  await log('   Continuing in 5 seconds... (Press Ctrl+C to abort)');
  await log('');

  // Give user time to abort if they realize this might be dangerous
  for (let i = 5; i > 0; i--) {
    process.stdout.write(`\r   Countdown: ${i} seconds remaining...`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  process.stdout.write('\r   Proceeding with log attachment enabled.                    \n');
  await log('');
};

// Create and initialize log file
export const initializeLogFile = async (logDir = null) => {
  // Determine log directory:
  // 1. Use provided logDir if specified
  // 2. Otherwise use current working directory (not script directory)
  let targetDir = logDir || process.cwd();

  // Verify the directory exists
  try {
    await fs.access(targetDir);
  } catch (error) {
    reportError(error, {
      context: 'create_log_directory',
      operation: 'mkdir_log_dir'
    });
    // If directory doesn't exist, try to create it
    try {
      await fs.mkdir(targetDir, { recursive: true });
    } catch (mkdirError) {
      reportError(mkdirError, {
        context: 'create_log_directory_fallback',
        targetDir,
        operation: 'mkdir_recursive'
      });
      await log(`⚠️  Unable to create log directory: ${targetDir}`, { level: 'error' });
      await log('   Falling back to current working directory', { level: 'error' });
      // Fall back to current working directory
      targetDir = process.cwd();
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(targetDir, `solve-${timestamp}.log`);
  setLogFile(logFile);

  // Create the log file immediately
  await fs.writeFile(logFile, `# Solve.mjs Log - ${new Date().toISOString()}\n\n`);
  // Always use absolute path for log file display
  const absoluteLogPath = path.resolve(logFile);
  await log(`📁 Log file: ${absoluteLogPath}`);
  await log('   (All output will be logged here)');

  return logFile;
};

// Validate GitHub URL requirement
export const validateUrlRequirement = async (issueUrl) => {
  if (!issueUrl) {
    await log('❌ GitHub issue URL is required', { level: 'error' });
    await log('   Usage: solve <github-issue-url> [options]', { level: 'error' });
    return false;
  }
  return true;
};

// Validate --continue-only-on-feedback option requirements
export const validateContinueOnlyOnFeedback = async (argv, isPrUrl, isIssueUrl) => {
  if (argv.continueOnlyOnFeedback) {
    if (!isPrUrl && !(isIssueUrl && argv.autoContinue)) {
      await log('❌ --continue-only-on-feedback option requirements not met', { level: 'error' });
      await log('   This option works only with:', { level: 'error' });
      await log('   • Pull request URL, OR', { level: 'error' });
      await log('   • Issue URL with --auto-continue option', { level: 'error' });
      await log(`   Current: ${isPrUrl ? 'PR URL' : 'Issue URL'} ${argv.autoContinue ? 'with --auto-continue' : 'without --auto-continue'}`, { level: 'error' });
      return false;
    }
  }
  return true;
};

// Perform all system checks (disk space, memory, tool connection, GitHub permissions)
export const performSystemChecks = async (minDiskSpace = 500, skipTool = false, model = 'sonnet', argv = {}) => {
  // Check disk space before proceeding
  const hasEnoughSpace = await checkDiskSpace(minDiskSpace);
  if (!hasEnoughSpace) {
    return false;
  }

  // Check memory before proceeding (early check to prevent Claude kills)
  const hasEnoughMemory = await checkMemory(256);
  if (!hasEnoughMemory) {
    return false;
  }

  // Skip tool validation if in dry-run mode or explicitly requested
  if (!skipTool) {
    let isToolConnected = false;
    if (argv.tool === 'opencode') {
      // Validate OpenCode connection
      const opencodeLib = await import('./opencode.lib.mjs');
      isToolConnected = await opencodeLib.validateOpenCodeConnection(model);
      if (!isToolConnected) {
        await log('❌ Cannot proceed without OpenCode connection', { level: 'error' });
        return false;
      }
    } else if (argv.tool === 'codex') {
      // Validate Codex connection
      const codexLib = await import('./codex.lib.mjs');
      isToolConnected = await codexLib.validateCodexConnection(model);
      if (!isToolConnected) {
        await log('❌ Cannot proceed without Codex connection', { level: 'error' });
        return false;
      }
    } else if (argv.tool === 'openai') {
      // Validate OpenAI-compatible endpoint
      const openaiLib = await import('./openai.lib.mjs');
      isToolConnected = await openaiLib.validateOpenAIConnection(model, argv);
      if (!isToolConnected) {
        await log('❌ Cannot proceed without OpenAI-compatible endpoint configured', { level: 'error' });
        return false;
      }
    } else {
      // Validate Claude CLI connection (default)
      const isClaudeConnected = await validateClaudeConnection(model);
      if (!isClaudeConnected) {
        await log('❌ Cannot proceed without Claude CLI connection', { level: 'error' });
        return false;
      }
      isToolConnected = true;
    }

    // Check GitHub permissions (only when tool check is not skipped)
    // Skip in dry-run mode to allow CI tests without authentication
    const hasValidAuth = await checkGitHubPermissions();
    if (!hasValidAuth) {
      return false;
    }
  } else {
    await log('⏩ Skipping tool validation (dry-run mode)', { verbose: true });
    await log('⏩ Skipping GitHub authentication check (dry-run mode)', { verbose: true });
  }

  return true;
};

// Parse URL components
export const parseUrlComponents = (issueUrl) => {
  const urlParts = issueUrl.split('/');
  return {
    owner: urlParts[3],
    repo: urlParts[4],
    urlNumber: urlParts[6] // Could be issue or PR number
  };
};

// Helper function to parse time string and calculate wait time
export const parseResetTime = (timeStr) => {
  // Normalize and parse time formats like:
  // "5:30am", "11:45pm", "12:16 PM", "07:05 Am", "5am", "5 AM"
  const normalized = (timeStr || '').toString().trim();

  // Accept both HH:MM am/pm and HH am/pm
  let match = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap]m)$/i);
  if (!match) {
    throw new Error(`Invalid time format: ${timeStr}`);
  }

  const [, hourStr, minuteMaybe, ampm] = match;
  const minuteStr = minuteMaybe || '00';
  let hour = parseInt(hourStr);
  const minute = parseInt(minuteStr);

  // Convert to 24-hour format
  if (ampm.toLowerCase() === 'pm' && hour !== 12) {
    hour += 12;
  } else if (ampm.toLowerCase() === 'am' && hour === 12) {
    hour = 0;
  }

  return { hour, minute };
};

// Calculate milliseconds until the next occurrence of the specified time
export const calculateWaitTime = (resetTime) => {
  const { hour, minute } = parseResetTime(resetTime);

  const now = new Date();
  const today = new Date(now);
  today.setHours(hour, minute, 0, 0);

  // If the time has already passed today, schedule for tomorrow
  if (today <= now) {
    today.setDate(today.getDate() + 1);
  }

  return today.getTime() - now.getTime();
};
