#!/usr/bin/env node
/**
 * Agent Commander Integration Library
 *
 * This module provides a wrapper around the agent-commander library
 * (https://github.com/link-assistant/agent-commander) for executing
 * AI tools (claude, codex, opencode, agent) in hive-mind.
 *
 * This is an EXPERIMENTAL feature enabled via --use-agent-commander flag.
 * When enabled, it delegates tool execution to agent-commander instead of
 * using the embedded logic in claude.lib.mjs, codex.lib.mjs, etc.
 */

// If globalThis.use is not defined, fetch it (when running standalone)
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

import { log as defaultLog } from './lib.mjs';

/**
 * Check if agent-commander is available
 * @returns {Promise<boolean>} True if agent-commander is available
 */
export const isAgentCommanderAvailable = async () => {
  try {
    // Try to import agent-commander
    await import('agent-commander');
    return true;
  } catch {
    // agent-commander not installed
    return false;
  }
};

/**
 * Get the agent-commander library
 * @returns {Promise<Object>} The agent-commander module
 * @throws {Error} If agent-commander is not installed
 */
const getAgentCommander = async () => {
  try {
    return await import('agent-commander');
  } catch (error) {
    throw new Error('agent-commander is not installed. Please install it with: npm install agent-commander\n' + 'Or disable the --use-agent-commander flag to use embedded tool logic.\n' + `Original error: ${error.message}`);
  }
};

/**
 * Validate agent-commander connection for a specific tool
 * @param {Object} options - Options
 * @param {string} options.tool - Tool name (claude, codex, opencode, agent)
 * @param {string} options.model - Model to use
 * @param {Function} [options.log] - Logging function
 * @returns {Promise<boolean>} True if connection is valid
 */
export const validateAgentCommanderConnection = async options => {
  const { tool, model, log = defaultLog } = options;

  try {
    const { agent, isToolSupported } = await getAgentCommander();

    // Check if tool is supported
    if (!isToolSupported({ toolName: tool })) {
      await log(`[agent-commander] Tool '${tool}' is not supported`, { level: 'error' });
      return false;
    }

    await log(`[agent-commander] Validating ${tool} connection...`);

    // Create a minimal agent instance to validate connection
    const agentController = agent({
      tool,
      workingDirectory: process.cwd(),
      prompt: 'hi',
      model,
    });

    // Start in dry-run mode to validate command building
    await agentController.start({ dryRun: true });

    await log(`[agent-commander] ${tool} connection validated successfully`);
    return true;
  } catch (error) {
    await log(`[agent-commander] Connection validation failed: ${error.message}`, { level: 'error' });
    return false;
  }
};

/**
 * Execute a tool using agent-commander
 * This function provides a compatible interface with executeClaude, executeCodex, etc.
 *
 * @param {Object} params - Execution parameters (same as executeClaude/executeCodex/etc.)
 * @returns {Promise<Object>} Result object with success, sessionId, limitReached, etc.
 */
export const executeWithAgentCommander = async params => {
  // Note: setLogFile, getLogFile, formatAligned, getResourceSnapshot, and $ are kept for API compatibility
  // with executeClaude/executeCodex/etc. but not currently used by agent-commander
  const {
    issueUrl,
    issueNumber,
    prNumber,
    prUrl,
    branchName,
    tempDir,
    isContinueMode,
    mergeStateStatus,
    forkedRepo,
    feedbackLines,
    forkActionsUrl,
    owner,
    repo,
    argv,
    log = defaultLog,
    // eslint-disable-next-line no-unused-vars
    setLogFile: _setLogFile,
    // eslint-disable-next-line no-unused-vars
    getLogFile: _getLogFile,
    // eslint-disable-next-line no-unused-vars
    formatAligned: _formatAligned,
    // eslint-disable-next-line no-unused-vars
    getResourceSnapshot: _getResourceSnapshot,
    // eslint-disable-next-line no-unused-vars
    $: _$,
  } = params;

  const tool = argv.tool || 'claude';

  try {
    const { agent } = await getAgentCommander();

    // Import prompt building functions based on tool
    let buildUserPrompt, buildSystemPrompt;
    if (tool === 'claude') {
      const claudePrompts = await import('./claude.prompts.lib.mjs');
      buildUserPrompt = claudePrompts.buildUserPrompt;
      buildSystemPrompt = claudePrompts.buildSystemPrompt;
    } else if (tool === 'opencode') {
      const opencodeLib = await import('./opencode.lib.mjs');
      buildUserPrompt = opencodeLib.buildUserPrompt;
      buildSystemPrompt = opencodeLib.buildSystemPrompt;
    } else if (tool === 'codex') {
      const codexLib = await import('./codex.lib.mjs');
      buildUserPrompt = codexLib.buildUserPrompt;
      buildSystemPrompt = codexLib.buildSystemPrompt;
    } else if (tool === 'agent') {
      const agentLib = await import('./agent.lib.mjs');
      buildUserPrompt = agentLib.buildUserPrompt;
      buildSystemPrompt = agentLib.buildSystemPrompt;
    } else {
      throw new Error(`Unknown tool: ${tool}`);
    }

    // Build prompts using existing prompt building logic
    const prompt = buildUserPrompt({
      issueUrl,
      issueNumber,
      prNumber,
      prUrl,
      branchName,
      tempDir,
      isContinueMode,
      mergeStateStatus,
      forkedRepo,
      feedbackLines,
      forkActionsUrl,
      owner,
      repo,
      argv,
    });

    const systemPrompt = buildSystemPrompt({
      owner,
      repo,
      issueNumber,
      issueUrl,
      prNumber,
      prUrl,
      branchName,
      tempDir,
      isContinueMode,
      forkedRepo,
      argv,
    });

    // Log prompt details in verbose mode
    if (argv.verbose) {
      await log('\n[agent-commander] Final prompt structure:', { verbose: true });
      await log(`   Characters: ${prompt.length}`, { verbose: true });
      await log(`   System prompt characters: ${systemPrompt.length}`, { verbose: true });
    }

    // Handle dry-run mode
    if (argv.dryRun || argv.onlyPrepareCommand) {
      await log('\n[agent-commander] Dry-run mode - command that would be executed:');

      const agentController = agent({
        tool,
        workingDirectory: tempDir,
        prompt,
        systemPrompt,
        model: argv.model,
        json: tool === 'claude', // Claude supports JSON mode
        resume: argv.resume,
      });

      await agentController.start({ dryRun: true });

      return {
        success: true,
        sessionId: null,
        limitReached: false,
        anthropicTotalCostUSD: null,
        publicPricingEstimate: null,
        pricingInfo: null,
      };
    }

    // Create agent controller
    const agentController = agent({
      tool,
      workingDirectory: tempDir,
      prompt,
      systemPrompt,
      model: argv.model,
      json: tool === 'claude', // Claude supports JSON mode
      resume: argv.resume,
    });

    await log(`\n[agent-commander] Starting ${tool} execution...`);

    // Track start time
    const startTime = Date.now();

    // Start the agent
    await agentController.start({
      attached: true,
      onOutput: async chunk => {
        // Stream output to console/log
        if (chunk.type === 'stdout') {
          process.stdout.write(chunk.data);
        } else if (chunk.type === 'stderr') {
          process.stderr.write(chunk.data);
        }
      },
    });

    // Wait for completion and get result
    const result = await agentController.stop();

    const endTime = Date.now();
    const durationSeconds = Math.round((endTime - startTime) / 1000);

    await log(`\n[agent-commander] Execution completed in ${durationSeconds}s with exit code ${result.exitCode}`);

    // Check for limit reached in output
    const limitReached = checkForLimitReached(result.output?.plain || '');
    const limitResetTime = extractLimitResetTime(result.output?.plain || '');

    // Extract session info
    const sessionId = result.sessionId || agentController.getSessionId();

    // Extract usage info if available
    const usage = result.usage;
    let anthropicTotalCostUSD = null;
    let publicPricingEstimate = null;
    let pricingInfo = null;

    if (usage && tool === 'claude') {
      // Calculate cost based on usage (simplified - full calculation in claude.lib.mjs)
      const inputTokens = usage.inputTokens || 0;
      const outputTokens = usage.outputTokens || 0;
      // Using approximate Claude pricing
      anthropicTotalCostUSD = (inputTokens * 0.003 + outputTokens * 0.015) / 1000;
    }

    return {
      success: result.exitCode === 0 && !limitReached,
      sessionId,
      limitReached,
      limitResetTime,
      anthropicTotalCostUSD,
      publicPricingEstimate,
      pricingInfo,
    };
  } catch (error) {
    await log(`\n[agent-commander] Execution failed: ${error.message}`, { level: 'error' });

    return {
      success: false,
      sessionId: null,
      limitReached: false,
      anthropicTotalCostUSD: null,
      publicPricingEstimate: null,
      pricingInfo: null,
      error: error.message,
    };
  }
};

/**
 * Check if output indicates usage limit was reached
 * @param {string} output - Tool output
 * @returns {boolean} True if limit was reached
 */
const checkForLimitReached = output => {
  if (!output) return false;

  const limitPatterns = [/usage limit/i, /rate limit/i, /limit reached/i, /exceeded.*limit/i, /too many requests/i, /quota exceeded/i];

  return limitPatterns.some(pattern => pattern.test(output));
};

/**
 * Extract limit reset time from output
 * @param {string} output - Tool output
 * @returns {string|null} Reset time or null
 */
const extractLimitResetTime = output => {
  if (!output) return null;

  // Look for patterns like "resets at 10:00 AM" or "reset in 2 hours"
  const resetPatterns = [/resets?\s+(?:at\s+)?(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i, /reset\s+in\s+(\d+\s*(?:hour|minute|min|hr)s?)/i];

  for (const pattern of resetPatterns) {
    const match = output.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
};

/**
 * Check for uncommitted changes (compatible with tool-specific checkForUncommittedChanges)
 * @param {Object} options - Options
 * @param {string} options.tempDir - Working directory
 * @param {Object} options.$ - Command stream
 * @param {Function} options.log - Logging function
 * @returns {Promise<Object>} Result with hasChanges and details
 */
export const checkForUncommittedChanges = async options => {
  const { tempDir, $, log = defaultLog } = options;

  try {
    const result = await $`cd "${tempDir}" && git status --porcelain`;
    const output = result.stdout?.toString().trim() || '';

    if (!output) {
      return { hasChanges: false };
    }

    const lines = output.split('\n').filter(line => line.trim());
    return {
      hasChanges: lines.length > 0,
      files: lines,
      count: lines.length,
    };
  } catch (error) {
    await log(`[agent-commander] Failed to check for uncommitted changes: ${error.message}`, { level: 'warning' });
    return { hasChanges: false };
  }
};
