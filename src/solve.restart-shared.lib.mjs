#!/usr/bin/env node
import { ensureUseM } from './use-m-bootstrap.lib.mjs';

/**
 * Shared utilities for watch mode and auto-restart-until-mergeable mode
 *
 * This module contains common functions used by both:
 * - solve.watch.lib.mjs (--watch mode and temporary auto-restart)
 * - solve.auto-merge.lib.mjs (--auto-merge and --auto-restart-until-mergeable)
 *
 * Functions extracted to reduce duplication and ensure consistent behavior.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1190
 */

// Check if use is already defined globally (when imported from solve.mjs)
// If not, fetch it (when running standalone)
if (typeof globalThis.use === 'undefined') {
  await ensureUseM();
}
const use = globalThis.use;

// Use command-stream for consistent $ behavior across runtimes
const { $: __rawDollar$ } = await use('command-stream');
const { wrapDollarWithGhRetry } = await import('./github-rate-limit.lib.mjs');
const $ = wrapDollarWithGhRetry(__rawDollar$);
// Import path and fs for cleanup operations
const path = (await use('path')).default;
const fs = (await use('fs')).promises;

// Import shared library functions
const lib = await import('./lib.mjs');
// Issue #2160: the real log-file accessors must be forwarded to every tool executor. Passing
// no-op stubs (or omitting them entirely) broke session-log renaming in restart/watch iterations
// ("⚠️ Could not rename log file: getLogFile is not a function").
const { log, formatAligned, extractToolErrorCore, getLogFile, setLogFile } = lib;
const { ensurePullRequestBaseBranch } = await import('./solve.pr-base-guard.lib.mjs');
const { ensureAiToolScratchIgnored, filterAiToolScratchFromStatus } = await import('./ai-tool-scratch.lib.mjs');
const { RESOURCE_PHASE_RESTART_AFTER, RESOURCE_PHASE_RESTART_BEFORE, recordResourceSnapshot } = await import('./solve.resource-diagnostics.lib.mjs');
const { classifyFormalAiToolResult } = await import('./formal-ai.lib.mjs');
// Issue #2123: shared draft/ready transitions for working sessions.
const { ensurePullRequestIsDraft, ensurePullRequestIsReady } = await import('./pr-draft-state.lib.mjs');

// Import Sentry integration
const sentryLib = await import('./sentry.lib.mjs');
const { reportError } = sentryLib;

/**
 * Check if PR has been merged
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} prNumber - Pull request number
 * @returns {Promise<boolean>}
 */
export const checkPRMerged = async (owner, repo, prNumber) => {
  try {
    const prResult = await $`gh api repos/${owner}/${repo}/pulls/${prNumber} --jq '.merged'`;
    if (prResult.code === 0) {
      return prResult.stdout.toString().trim() === 'true';
    }
  } catch (error) {
    reportError(error, {
      context: 'check_pr_merged',
      owner,
      repo,
      prNumber,
      operation: 'check_merge_status',
    });
    // If we can't check, assume not merged
    return false;
  }
  return false;
};

/**
 * Check if PR is closed (but not merged)
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} prNumber - Pull request number
 * @returns {Promise<boolean>}
 */
export const checkPRClosed = async (owner, repo, prNumber) => {
  try {
    const prResult = await $`gh api repos/${owner}/${repo}/pulls/${prNumber} --jq '.state'`;
    if (prResult.code === 0) {
      return prResult.stdout.toString().trim() === 'closed';
    }
  } catch (error) {
    reportError(error, {
      context: 'check_pr_closed',
      owner,
      repo,
      prNumber,
      operation: 'check_close_status',
    });
    // If we can't check, assume not closed
    return false;
  }
  return false;
};

/**
 * Clean up .playwright-mcp/ folder to prevent browser automation artifacts
 * from triggering auto-restart (Issue #1124)
 * @param {string} tempDir - Temporary directory path
 * @param {Object} argv - Command line arguments
 */
export const cleanupPlaywrightMcpFolder = async (tempDir, argv = {}) => {
  if (argv.playwrightMcpAutoCleanup !== false) {
    const playwrightMcpDir = path.join(tempDir, '.playwright-mcp');
    try {
      const playwrightMcpExists = await fs
        .stat(playwrightMcpDir)
        .then(() => true)
        .catch(() => false);
      if (playwrightMcpExists) {
        await fs.rm(playwrightMcpDir, { recursive: true, force: true });
        await log('🧹 Cleaned up .playwright-mcp/ folder (browser automation artifacts)', { verbose: true });
      }
    } catch (cleanupError) {
      // Non-critical error, just log and continue
      await log(`⚠️  Could not clean up .playwright-mcp/ folder: ${cleanupError.message}`, { verbose: true });
    }
  }
};

/**
 * Check if there are uncommitted changes in the repository
 * @param {string} tempDir - Temporary directory path
 * @param {Object} argv - Command line arguments (optional)
 * @returns {Promise<boolean>}
 */
export const checkForUncommittedChanges = async (tempDir, argv = {}) => {
  // First, clean up .playwright-mcp/ folder to prevent false positives (Issue #1124)
  await cleanupPlaywrightMcpFolder(tempDir, argv);
  // Issue #2119: the same false positive, generalized - `.formal-ai/` and any
  // other AI tool scratch directory must not read as the AI's uncommitted work.
  await ensureAiToolScratchIgnored(tempDir, log);

  try {
    const gitStatusResult = await $({ cwd: tempDir })`git status --porcelain 2>&1`;
    if (gitStatusResult.code === 0) {
      const statusOutput = filterAiToolScratchFromStatus(gitStatusResult.stdout.toString().trim());
      return statusOutput.length > 0;
    }
  } catch (error) {
    reportError(error, {
      context: 'check_uncommitted_changes',
      tempDir,
      operation: 'git_status',
    });
    // If we can't check, assume no uncommitted changes
  }
  return false;
};

/**
 * Get uncommitted changes details for display
 * @param {string} tempDir - Temporary directory path
 * @returns {Promise<string[]>}
 */
export const getUncommittedChangesDetails = async tempDir => {
  const changes = [];
  try {
    const gitStatusResult = await $({ cwd: tempDir })`git status --porcelain 2>&1`;
    if (gitStatusResult.code === 0) {
      const statusOutput = filterAiToolScratchFromStatus(gitStatusResult.stdout.toString().trim());
      if (statusOutput) {
        changes.push(...statusOutput.split('\n'));
      }
    }
  } catch (error) {
    reportError(error, {
      context: 'get_uncommitted_changes_details',
      tempDir,
      operation: 'git_status',
    });
  }
  return changes;
};

/**
 * Execute the AI tool (Claude, OpenCode, Codex, Agent, Gemini, Qwen) for a restart iteration
 * This is the shared tool execution logic used by both watch mode and auto-restart-until-mergeable mode
 * @param {Object} params - Execution parameters
 * @returns {Promise<Object>} - Tool execution result
 */
export const executeToolIteration = async params => {
  const { issueUrl, owner, repo, issueNumber, prNumber, branchName, tempDir, workspaceTmpDir, mergeStateStatus, feedbackLines, argv } = params;

  await recordResourceSnapshot({
    phase: RESOURCE_PHASE_RESTART_BEFORE,
    log,
    diskPath: '/',
    label: 'before AI restart iteration',
  });

  // Issue #2123: every restart/resume iteration is a new working session, so the PR must be
  // put back into draft before the AI starts changing it. This single call covers watch mode,
  // temporary auto-restart, auto-restart-until-mergeable, escalate, keep-working,
  // auto-ensure-requirements and the PR-placeholder restart, which all funnel through here.
  if (prNumber) {
    await ensurePullRequestIsDraft({
      owner,
      repo,
      prNumber,
      $,
      log,
      formatAligned,
      reason: 'restart iteration',
      reportError,
    });
  }

  // Import necessary modules for tool execution
  const memoryCheck = await import('./memory-check.mjs');
  const { getResourceSnapshot } = memoryCheck;

  const { cascadePlaywrightMcpDisable } = await import('./playwright-mcp.lib.mjs');
  await cascadePlaywrightMcpDisable(argv, log);

  // Issue #2182: the ready conversion below lives in `finally` on purpose. When the AI
  // tool throws (crash, API error, aborted process) the iteration is still over, and a
  // pull request left in draft can never be merged by --auto-merge.
  try {
    let toolResult;
    if (argv.useAgentCommander) {
      const agentCommanderLib = await import('./agent-commander.lib.mjs');
      await agentCommanderLib.resolvePlaywrightMcpForAgentCommander({ argv, log, tool: argv.tool || 'claude' });

      toolResult = await agentCommanderLib.executeWithAgentCommander({
        issueUrl,
        issueNumber,
        prNumber,
        prUrl: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
        branchName,
        tempDir,
        workspaceTmpDir: params.workspaceTmpDir,
        isContinueMode: true,
        mergeStateStatus,
        forkedRepo: argv.fork,
        feedbackLines,
        forkActionsUrl: null,
        owner,
        repo,
        argv,
        log,
        formatAligned,
        getResourceSnapshot,
        setLogFile,
        getLogFile,
        $,
      });
    } else if (argv.tool === 'opencode') {
      // Use OpenCode
      const opencodeExecLib = await import('./opencode.lib.mjs');
      const { executeOpenCode, checkPlaywrightMcpAvailability } = opencodeExecLib;
      const opencodePath = argv.opencodePath || 'opencode';

      if (argv.promptPlaywrightMcp) {
        const playwrightMcpAvailable = await checkPlaywrightMcpAvailability();
        if (playwrightMcpAvailable) {
          await log('🎭 Playwright MCP detected - enabling browser automation hints', { verbose: true });
        } else {
          await log('ℹ️  Playwright MCP not detected - browser automation hints will be disabled', { verbose: true });
          argv.promptPlaywrightMcp = false;
        }
      } else {
        await log('ℹ️  Playwright MCP explicitly disabled via --no-prompt-playwright-mcp', { verbose: true });
      }

      toolResult = await executeOpenCode({
        issueUrl,
        issueNumber,
        prNumber,
        prUrl: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
        branchName,
        tempDir,
        workspaceTmpDir,
        isContinueMode: true,
        mergeStateStatus,
        forkedRepo: argv.fork,
        feedbackLines,
        owner,
        repo,
        argv,
        log,
        formatAligned,
        getResourceSnapshot,
        setLogFile,
        getLogFile,
        opencodePath,
        $,
      });
    } else if (argv.tool === 'codex') {
      // Use Codex
      const codexExecLib = await import('./codex.lib.mjs');
      const { executeCodex, checkPlaywrightMcpAvailability } = codexExecLib;
      const codexPath = argv.codexPath || 'codex';

      if (argv.promptPlaywrightMcp) {
        const playwrightMcpAvailable = await checkPlaywrightMcpAvailability();
        if (playwrightMcpAvailable) {
          await log('🎭 Playwright MCP detected - enabling browser automation hints', { verbose: true });
        } else {
          await log('ℹ️  Playwright MCP not detected - browser automation hints will be disabled', { verbose: true });
          argv.promptPlaywrightMcp = false;
        }
      } else {
        await log('ℹ️  Playwright MCP explicitly disabled via --no-prompt-playwright-mcp', { verbose: true });
      }

      toolResult = await executeCodex({
        issueUrl,
        issueNumber,
        prNumber,
        prUrl: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
        branchName,
        tempDir,
        workspaceTmpDir,
        isContinueMode: true,
        mergeStateStatus,
        forkedRepo: argv.fork,
        feedbackLines,
        forkActionsUrl: null,
        owner,
        repo,
        argv,
        log,
        setLogFile,
        getLogFile,
        formatAligned,
        getResourceSnapshot,
        codexPath,
        $,
      });
    } else if (argv.tool === 'agent') {
      // Use Agent
      const agentExecLib = await import('./agent.lib.mjs');
      const { executeAgent, checkPlaywrightMcpAvailability } = agentExecLib;
      const agentPath = argv.agentPath || 'agent';

      if (argv.promptPlaywrightMcp) {
        const playwrightMcpAvailable = await checkPlaywrightMcpAvailability();
        if (playwrightMcpAvailable) {
          await log('🎭 Playwright MCP detected - enabling browser automation hints', { verbose: true });
        } else {
          await log('ℹ️  Playwright MCP not detected - browser automation hints will be disabled', { verbose: true });
          argv.promptPlaywrightMcp = false;
        }
      } else {
        await log('ℹ️  Playwright MCP explicitly disabled via --no-prompt-playwright-mcp', { verbose: true });
      }

      toolResult = await executeAgent({
        issueUrl,
        issueNumber,
        prNumber,
        prUrl: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
        branchName,
        tempDir,
        workspaceTmpDir,
        isContinueMode: true,
        mergeStateStatus,
        forkedRepo: argv.fork,
        feedbackLines,
        forkActionsUrl: null,
        owner,
        repo,
        argv,
        log,
        formatAligned,
        getResourceSnapshot,
        setLogFile,
        getLogFile,
        agentPath,
        $,
      });
    } else if (argv.tool === 'gemini') {
      // Use Gemini
      const geminiExecLib = await import('./gemini.lib.mjs');
      const { executeGemini, checkPlaywrightMcpAvailability } = geminiExecLib;
      const geminiPath = argv.geminiPath || 'gemini';

      if (argv.promptPlaywrightMcp) {
        const playwrightMcpAvailable = await checkPlaywrightMcpAvailability();
        if (playwrightMcpAvailable) {
          await log('🎭 Playwright MCP detected - enabling browser automation hints', { verbose: true });
        } else {
          await log('ℹ️  Playwright MCP not detected - browser automation hints will be disabled', { verbose: true });
          argv.promptPlaywrightMcp = false;
        }
      } else {
        await log('ℹ️  Playwright MCP explicitly disabled via --no-prompt-playwright-mcp', { verbose: true });
      }

      toolResult = await executeGemini({
        issueUrl,
        issueNumber,
        prNumber,
        prUrl: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
        branchName,
        tempDir,
        workspaceTmpDir,
        isContinueMode: true,
        mergeStateStatus,
        forkedRepo: argv.fork,
        feedbackLines,
        forkActionsUrl: null,
        owner,
        repo,
        argv,
        log,
        setLogFile,
        getLogFile,
        formatAligned,
        getResourceSnapshot,
        geminiPath,
        $,
      });
    } else if (argv.tool === 'qwen') {
      // Use Qwen Code
      const qwenExecLib = await import('./qwen.lib.mjs');
      const { executeQwen, checkPlaywrightMcpAvailability } = qwenExecLib;
      const qwenPath = argv.qwenPath || 'qwen';

      if (argv.promptPlaywrightMcp) {
        const playwrightMcpAvailable = await checkPlaywrightMcpAvailability();
        if (playwrightMcpAvailable) {
          await log('🎭 Playwright MCP detected - enabling browser automation hints', { verbose: true });
        } else {
          await log('ℹ️  Playwright MCP not detected - browser automation hints will be disabled', { verbose: true });
          argv.promptPlaywrightMcp = false;
        }
      } else {
        await log('ℹ️  Playwright MCP explicitly disabled via --no-prompt-playwright-mcp', { verbose: true });
      }

      toolResult = await executeQwen({
        issueUrl,
        issueNumber,
        prNumber,
        prUrl: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
        branchName,
        tempDir,
        workspaceTmpDir,
        isContinueMode: true,
        mergeStateStatus,
        forkedRepo: argv.fork,
        feedbackLines,
        forkActionsUrl: null,
        owner,
        repo,
        argv,
        log,
        setLogFile,
        getLogFile,
        formatAligned,
        getResourceSnapshot,
        qwenPath,
        $,
      });
    } else {
      // Use Claude (default)
      const claudeExecLib = await import('./claude.lib.mjs');
      const { executeClaude, checkPlaywrightMcpAvailability } = claudeExecLib;
      const claudePath = argv.claudePath || 'claude';

      // Check for Playwright MCP availability if using Claude tool
      if (argv.tool === 'claude' || !argv.tool) {
        if (argv.promptPlaywrightMcp) {
          const playwrightMcpAvailable = await checkPlaywrightMcpAvailability();
          if (playwrightMcpAvailable) {
            await log('🎭 Playwright MCP detected - enabling browser automation hints', { verbose: true });
          } else {
            await log('ℹ️  Playwright MCP not detected - browser automation hints will be disabled', { verbose: true });
            argv.promptPlaywrightMcp = false;
          }
        } else {
          await log('ℹ️  Playwright MCP explicitly disabled via --no-prompt-playwright-mcp', { verbose: true });
        }
      }

      toolResult = await executeClaude({
        issueUrl,
        issueNumber,
        prNumber,
        prUrl: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
        branchName,
        tempDir,
        workspaceTmpDir,
        isContinueMode: true,
        mergeStateStatus,
        forkedRepo: argv.fork,
        feedbackLines,
        owner,
        repo,
        argv,
        log,
        formatAligned,
        getResourceSnapshot,
        setLogFile,
        getLogFile,
        claudePath,
        $,
      });
    }

    toolResult = classifyFormalAiToolResult({ model: argv.model, toolResult });
    if (toolResult?.formalAiNonExecution) {
      await log(`❌ ${toolResult.errorInfo.message}`, { level: 'error' });
    }

    await ensurePullRequestBaseBranch({ owner, repo, prNumber, argv, log, formatAligned, $ });
    await recordResourceSnapshot({
      phase: RESOURCE_PHASE_RESTART_AFTER,
      log,
      diskPath: '/',
      label: 'after AI restart iteration',
    });

    // Issue #2090: every restart iteration starts a brand new tool session with
    // its own session UUID. Collect its development log here — this is the single
    // chokepoint shared by watch mode, auto-restart-until-mergeable,
    // keep-working, escalation and auto-ensure — otherwise only the very first
    // session of the process ever reached the pull request.
    // When the tool did not report a session id there is nothing to key a new
    // directory on, so extend the previously collected session instead of losing
    // this iteration's part of the log.
    const { finalizeActiveDevelopmentLog } = await import('./development-log.finalize.lib.mjs');
    await (toolResult?.sessionId ? finalizeActiveDevelopmentLog({ sessionId: toolResult.sessionId }) : finalizeActiveDevelopmentLog({ force: true }));

    return toolResult;
  } finally {
    // Issue #2182: the iteration drafted the pull request above, so it must also
    // undo that when the AI session finishes — exactly like endWorkSession() does
    // for the primary session. Without this the pull request stayed a draft after
    // the last restart iteration and --auto-merge retried `gh pr merge` every
    // 120 seconds for 4d 12h ("Pull Request is still a draft"), because a draft
    // PR still reports mergeable=MERGEABLE / mergeStateStatus=CLEAN.
    if (prNumber) {
      await ensurePullRequestIsReady({
        owner,
        repo,
        prNumber,
        $,
        log,
        formatAligned,
        reason: 'restart iteration finished',
        reportError,
      });
    }
  }
};

/**
 * Build standard instructions for auto-restart modes
 * These instructions ensure the AI agent addresses all aspects needed for mergeability
 * @returns {string[]} Array of instruction lines
 */
export const buildAutoRestartInstructions = () => {
  return [
    '',
    '='.repeat(60),
    '🎯 AUTO-RESTART MODE INSTRUCTIONS:',
    '='.repeat(60),
    '',
    'Ensure to get latest version of default branch to make all conflicts resolved if present.',
    'Ensure you comply with all CI/CD check requirements, and they pass.',
    // Issue #1887: When a CI/CD check is failing — even if the failure looks pre-existing,
    // inherited from another branch, or caused by a change unrelated to your task — attempt
    // to fix it so every check passes instead of only reporting it or asking for a human
    // decision. This session auto-restarts until the pull request is mergeable, so leaving a
    // failing check unaddressed will loop indefinitely. Asking for human help is still fine,
    // but do it in addition to attempting a fix, not instead of it.
    'When any CI/CD check is failing — even if the failure looks pre-existing, inherited from another branch, or caused by a change unrelated to your task — fix it so all checks pass instead of only reporting it. This session auto-restarts until the pull request is mergeable, so leaving a failing check unaddressed will loop indefinitely.',
    'Unless the scope is explicitly restricted, treat fixing repository-wide breakage as in scope and keep the default branch in a clean, working state. If a fix truly requires a human decision, attempt your best fix first, then leave a clear comment explaining what remains and why.',
    'Ensure all changes are correct, consistent and fully meet all discussed requirements',
    '(check issue description and all comments in issue and in pull request).',
    '',
  ];
};

/**
 * Build feedback lines for uncommitted changes
 * @param {string[]} changes - Array of uncommitted change lines from git status
 * @param {number} restartCount - Current restart iteration number
 * @param {number} maxIterations - Maximum restart iterations
 * @returns {string[]} Array of feedback lines
 */
export const buildUncommittedChangesFeedback = (changes, restartCount = 0, maxIterations = 0) => {
  const feedbackLines = [];
  const iterationInfo = maxIterations > 0 ? ` (Auto-restart ${restartCount}/${maxIterations})` : '';

  feedbackLines.push('');
  feedbackLines.push(`⚠️ UNCOMMITTED CHANGES DETECTED${iterationInfo}:`);
  feedbackLines.push('The following uncommitted changes were found in the repository:');
  feedbackLines.push('');

  for (const line of changes) {
    feedbackLines.push(`  ${line}`);
  }

  feedbackLines.push('');
  feedbackLines.push('IMPORTANT: You MUST handle these uncommitted changes by either:');
  feedbackLines.push('1. COMMITTING them if they are part of the solution (git add + git commit + git push)');
  feedbackLines.push('2. REVERTING them if they are not needed (git checkout -- <file> or git clean -fd)');
  feedbackLines.push('');
  feedbackLines.push('DO NOT leave uncommitted changes behind. The session will auto-restart until all changes are resolved.');

  return feedbackLines;
};

/**
 * Check if a tool result indicates an API error
 * @param {Object} toolResult - Tool execution result
 * @returns {boolean}
 */
export const isApiError = toolResult => {
  if (!toolResult) return false;

  // Issue #1845: runners report failures via `errorInfo` (e.g. claude sets
  // `errorInfo.message` but NOT `result`). Use the shared core-error extractor so an
  // "API Error:" is classified correctly regardless of which field the runner populated —
  // otherwise the MAX_API_ERROR_RETRIES guard never trips for claude and watch mode can
  // retry a hard API error indefinitely. `extractToolErrorCore` still falls back to
  // `result`, preserving the original behavior for runners that set it.
  const errorText = extractToolErrorCore({ toolResult });
  if (!errorText) return false;

  const errorPatterns = ['API Error:', 'not_found_error', 'authentication_error', 'invalid_request_error'];

  return errorPatterns.some(pattern => errorText.includes(pattern));
};

/**
 * Issue #1356: Check if a tool result indicates a usage limit was reached
 * This is separate from isApiError because usage limits return different fields
 * (limitReached, limitResetTime) and require different handling (exit loop, not retry).
 * @param {Object} toolResult - Tool execution result
 * @returns {boolean}
 */
export const isUsageLimitReached = toolResult => {
  if (!toolResult) return false;
  return toolResult.limitReached === true;
};

export default {
  checkPRMerged,
  checkPRClosed,
  cleanupPlaywrightMcpFolder,
  checkForUncommittedChanges,
  getUncommittedChangesDetails,
  executeToolIteration,
  buildAutoRestartInstructions,
  buildUncommittedChangesFeedback,
  isApiError,
  isUsageLimitReached,
};
