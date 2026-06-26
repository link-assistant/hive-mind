#!/usr/bin/env node
import { ensureUseM } from './use-m-bootstrap.lib.mjs';

// Validation module for solve command
// Extracted from solve.mjs to keep files under 1500 lines

// Use use-m to dynamically import modules for cross-runtime compatibility
// Check if use is already defined globally (when imported from solve.mjs)
// If not, fetch it (when running standalone)
if (typeof globalThis.use === 'undefined') {
  await ensureUseM();
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
  setLogFile,
  // getLogFile - not currently used
} = lib;

// Import GitHub-related functions
const githubLib = await import('./github.lib.mjs');
const {
  checkGitHubPermissions,
  parseGitHubUrl,
  // isGitHubUrlType - not currently used
} = githubLib;

// Import git-related functions for identity validation and repair
const gitLib = await import('./git.lib.mjs');
const { checkGitIdentity, repairGitIdentity } = gitLib;

// Import Claude-related functions
const claudeLib = await import('./claude.lib.mjs');
// Import Sentry integration
const sentryLib = await import('./sentry.lib.mjs');
const { reportError } = sentryLib;

// Import the robust usage-limit reset-time parser.
// This returns a full dayjs date (honoring an explicit year and timezone) so the
// auto-resume wait calculation can respect weekly limits that are days out, rather
// than collapsing every reset to "today/tomorrow at HH:MM" (Issue #1869).
const usageLimitLib = await import('./usage-limit.lib.mjs');
const { parseResetTime: parseResetTimeToDate } = usageLimitLib;

const { validateClaudeConnection } = claudeLib;

// Wrapper function for disk space check using imported module
const checkDiskSpace = async (minSpaceMB = 10240) => {
  const result = await memoryCheck.checkDiskSpace(minSpaceMB, { log });
  return result.success;
};

// Wrapper function for memory check using imported module
const checkMemory = async (minMemoryMB = 256) => {
  const result = await memoryCheck.checkMemory(minMemoryMB, { log });
  return result.success;
};

// Validate GitHub issue or pull request URL format
export const validateGitHubUrl = issueUrl => {
  if (!issueUrl) {
    return { isValid: false, isIssueUrl: null, isPrUrl: null };
  }

  // Use the universal GitHub URL parser
  const parsedUrl = parseGitHubUrl(issueUrl);

  if (!parsedUrl.valid) {
    console.error('Error: Invalid GitHub URL format');
    if (parsedUrl.error) console.error(`  ${parsedUrl.error}`);
    if (parsedUrl.suggestion) console.error(`\n💡 Did you mean: ${parsedUrl.suggestion}`);
    console.error('\n  Please provide a valid GitHub issue or pull request URL');
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
    number: parsedUrl.number,
  };
};

// Show security warning for attach-logs option
export const showAttachLogsWarning = async shouldAttachLogs => {
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
      operation: 'mkdir_log_dir',
    });
    // If directory doesn't exist, try to create it
    try {
      await fs.mkdir(targetDir, { recursive: true });
    } catch (mkdirError) {
      reportError(mkdirError, {
        context: 'create_log_directory_fallback',
        targetDir,
        operation: 'mkdir_recursive',
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
export const validateUrlRequirement = async issueUrl => {
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
// Note: skipToolConnection only skips the connection check, not model validation
// Model validation should be done separately before calling this function
export const performSystemChecks = async (minDiskSpace = 10240, skipToolConnection = false, model = 'sonnet', argv = {}) => {
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

  // Check git identity configuration before proceeding
  // This prevents the "fatal: empty ident name" error during commits
  // See: https://github.com/link-assistant/hive-mind/issues/1131
  let gitIdentity = await checkGitIdentity();
  if (!gitIdentity.isValid) {
    // Check if auto-repair is enabled
    if (argv.autoGhConfigurationRepair) {
      await log('');
      await log('⚠️  Git identity not configured, attempting auto-repair...', { level: 'warning' });
      await log(`   ${gitIdentity.error || 'Configuration is incomplete'}`);
      await log('');

      const repairResult = await repairGitIdentity();
      if (repairResult.success) {
        await log('✅ Git identity successfully repaired using gh-setup-git-identity --repair');
        // Re-check identity to display the configured values
        gitIdentity = await checkGitIdentity();
        await log(`   user.name:  ${gitIdentity.name}`);
        await log(`   user.email: ${gitIdentity.email}`);
        await log('');
      } else {
        await log('');
        await log('❌ Auto-repair failed', { level: 'error' });
        await log(`   ${repairResult.error}`);
        await log('');
        await log('   Current configuration:');
        await log(`     user.name:  ${gitIdentity.name || '(not set)'}`);
        await log(`     user.email: ${gitIdentity.email || '(not set)'}`);
        await log('');
        await log('   🔧 How to fix manually:');
        await log('');
        await log('   Option 1: Install gh-setup-git-identity and use --auto-gh-configuration-repair');
        await log('     npm install -g @link-foundation/gh-setup-git-identity');
        await log('');
        await log('   Option 2: Set identity manually');
        await log('     git config --global user.name "Your Name"');
        await log('     git config --global user.email "you@example.com"');
        await log('');
        await log('   Related error: "fatal: empty ident name (for <>) not allowed"');
        await log('');
        return false;
      }
    } else {
      await log('');
      await log('❌ Git identity not configured', { level: 'error' });
      await log('');
      await log('   Git commits require both user.name and user.email to be set.');
      await log(`   ${gitIdentity.error || 'Configuration is incomplete'}`);
      await log('');
      await log('   Current configuration:');
      await log(`     user.name:  ${gitIdentity.name || '(not set)'}`);
      await log(`     user.email: ${gitIdentity.email || '(not set)'}`);
      await log('');
      await log('   🔧 How to fix:');
      await log('');
      await log('   Option 1: Use GitHub CLI to set identity from your account');
      await log('     gh-setup-git-identity');
      await log('');
      await log('   Option 2: Set identity manually');
      await log('     git config --global user.name "Your Name"');
      await log('     git config --global user.email "you@example.com"');
      await log('');
      await log('   Option 3: Enable auto-repair (requires gh-setup-git-identity)');
      await log('     solve <issue-url> --auto-gh-configuration-repair');
      await log('');
      await log('   Related error: "fatal: empty ident name (for <>) not allowed"');
      await log('');
      return false;
    }
  }

  // Skip tool connection validation if in dry-run mode or explicitly requested
  if (!skipToolConnection) {
    let isToolConnected;
    if (argv.useAgentCommander) {
      const agentCommanderLib = await import('./agent-commander.lib.mjs');
      isToolConnected = await agentCommanderLib.validateAgentCommanderConnection({
        tool: argv.tool || 'claude',
        model,
        log,
      });
      if (!isToolConnected) {
        await log('❌ Cannot proceed without agent-commander tool connection', { level: 'error' });
        return false;
      }
    } else if (argv.tool === 'opencode') {
      // Validate OpenCode connection
      const opencodeLib = await import('./opencode.lib.mjs');
      isToolConnected = await opencodeLib.validateOpenCodeConnection(model);
      if (!isToolConnected) {
        await log('❌ Cannot proceed without OpenCode connection', { level: 'error' });
        return false;
      }
    } else if (argv.tool === 'gemini') {
      // Validate Gemini connection
      const geminiLib = await import('./gemini.lib.mjs');
      isToolConnected = await geminiLib.validateGeminiConnection(model);
      if (!isToolConnected) {
        await log('❌ Cannot proceed without Gemini CLI connection', { level: 'error' });
        return false;
      }
    } else if (argv.tool === 'codex') {
      // Validate Codex connection
      const codexLib = await import('./codex.lib.mjs');
      isToolConnected = await codexLib.validateCodexConnection(model, argv.verbose);
      if (!isToolConnected) {
        await log('❌ Cannot proceed without Codex connection', { level: 'error' });
        return false;
      }
    } else if (argv.tool === 'agent') {
      // Validate Agent connection
      const agentLib = await import('./agent.lib.mjs');
      isToolConnected = await agentLib.validateAgentConnection(model);
      if (!isToolConnected) {
        await log('❌ Cannot proceed without Agent connection', { level: 'error' });
        return false;
      }
    } else if (argv.tool === 'qwen') {
      // Validate Qwen Code connection
      const qwenLib = await import('./qwen.lib.mjs');
      isToolConnected = await qwenLib.validateQwenConnection(model);
      if (!isToolConnected) {
        await log('❌ Cannot proceed without Qwen Code connection', { level: 'error' });
        return false;
      }
    } else {
      // Validate Claude CLI connection (default)
      const isClaudeConnected = await validateClaudeConnection(model);
      if (!isClaudeConnected) {
        await log('❌ Cannot proceed without Claude CLI connection', { level: 'error' });
        return false;
      }
    }

    // Check GitHub permissions (only when tool check is not skipped)
    // Skip in dry-run mode to allow CI tests without authentication
    const hasValidAuth = await checkGitHubPermissions();
    if (!hasValidAuth) {
      return false;
    }
  } else {
    await log('⏩ Skipping tool connection validation (dry-run mode or skip-tool-connection-check enabled)', {
      verbose: true,
    });
    await log('⏩ Skipping GitHub authentication check (dry-run mode or skip-tool-connection-check enabled)', {
      verbose: true,
    });
  }

  return true;
};

// Parse URL components using Node.js URL API
// Note: This function is a simpler alternative to parseGitHubUrl for cases where
// you only need owner, repo, and urlNumber without full validation.
// For full validation, use validateGitHubUrl() which internally uses parseGitHubUrl().
// Uses Node.js URL API (https://nodejs.org/api/url.html) for stable parsing.
export const parseUrlComponents = issueUrl => {
  // Use Node.js URL API for reliable parsing
  // This automatically handles hash fragments, query params, and edge cases
  const urlObj = new globalThis.URL(issueUrl);

  // Extract path segments, filtering out empty strings from leading/trailing slashes
  const pathParts = urlObj.pathname.split('/').filter(p => p);

  return {
    owner: pathParts[0],
    repo: pathParts[1],
    urlNumber: pathParts[3], // Could be issue or PR number (pathParts[2] is 'issues' or 'pull')
  };
};

// Helper function to parse a reset time string into hour/minute components.
//
// Accepts:
//   - Time-only forms: "5:30am", "11:45pm", "12:16 PM", "07:05 Am", "5am", "5 AM"
//   - Date+time forms: "Apr 17, 4:00 AM"  (date portion ignored)
//   - Date+year+time forms: "Jun 11, 2026, 12:27 AM"  (date+year ignored — Issue #1869)
//
// NOTE: This helper only extracts the time-of-day. For computing the actual wait
// duration use calculateWaitTime(), which preserves the full date so weekly limits
// (which can be days away) are honored instead of being collapsed to today/tomorrow.
export const parseResetTime = timeStr => {
  const normalized = (timeStr || '').toString().trim();
  // Strip an optional leading "Month Day," and an optional "Year," so the
  // remaining string is just the time-of-day. The year group (Issue #1869) makes
  // Codex weekly-limit strings like "Jun 11, 2026, 12:27 AM" parse instead of
  // throwing "Invalid time format".
  const timePortion = normalized.replace(/^(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?,\s+(?:\d{4},\s+)?/i, '');

  // Accept both HH:MM am/pm and HH am/pm
  let match = timePortion.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap]m)$/i);
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

// Calculate milliseconds until the limit reset.
//
// Issue #1869: This MUST respect the full reset date (including an explicit year),
// not just the time-of-day. A weekly Codex limit reports "Jun 11th, 2026 12:27 AM"
// which can be days in the future; the previous implementation only looked at the
// hour/minute and scheduled for today/tomorrow, so auto-resume woke up far too early
// and burned an auto-resume iteration without the limit actually having reset.
//
// We delegate to the robust usage-limit parser, which returns a full dayjs date that
// already handles: explicit year, weekly date+time, time-only (rolls forward to the
// next occurrence), and an optional IANA timezone. We then return the real diff.
//
// @param {string} resetTime - Reset time string (time-only, date+time, or date+year+time)
// @param {string|null} timezone - Optional IANA timezone (e.g. "Europe/Berlin")
// @returns {number} - Milliseconds until reset (never negative)
export const calculateWaitTime = (resetTime, timezone = null) => {
  const resetDate = parseResetTimeToDate(resetTime, timezone);

  if (resetDate && resetDate.isValid()) {
    const diffMs = resetDate.valueOf() - Date.now();
    return diffMs > 0 ? diffMs : 0;
  }

  // Fallback: the robust parser could not interpret the string. Fall back to the
  // legacy time-of-day behavior (today/tomorrow) so we still wait a sensible amount
  // rather than throwing — parseResetTime throws for genuinely unparseable input.
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
