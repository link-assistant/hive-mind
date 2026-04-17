#!/usr/bin/env node
// Claude CLI-related utility functions. Fetch use-m if not available.
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const { $ } = await use('command-stream');
const fs = (await use('fs')).promises;
const path = (await use('path')).default;
import { log, isENOSPC } from './lib.mjs';
import { reportError } from './sentry.lib.mjs';
import { timeouts, retryLimits, claudeCode, getClaudeEnv, getThinkingLevelToTokens, getTokensToThinkingLevel, supportsThinkingBudget, DEFAULT_MAX_THINKING_BUDGET, getMaxOutputTokensForModel } from './config.lib.mjs';
import { detectUsageLimit, formatUsageLimitMessage } from './usage-limit.lib.mjs';
import { createInteractiveHandler } from './interactive-mode.lib.mjs';
import { initProgressMonitoring } from './solve.progress-monitoring.lib.mjs';
import { sanitizeObjectStrings } from './unicode-sanitization.lib.mjs';
import { displayBudgetStats, createEmptySubSessionUsage, accumulateModelUsage, displayModelUsage, displayCostComparison, mergeResultModelUsage, createSubAgentCallEntry, accumulateSubAgentUsage } from './claude.budget-stats.lib.mjs';
import { buildClaudeResumeCommand } from './claude.command-builder.lib.mjs';
import { handleClaudeRuntimeSwitch } from './claude.runtime-switch.lib.mjs'; // see issue #1141
import { CLAUDE_MODELS as availableModels } from './models/index.mjs'; // Issue #1221
export { availableModels }; // Re-export for backward compatibility
const showResumeCommand = async (sessionId, tempDir, claudePath, model, log) => {
  if (!sessionId || !tempDir) return;
  const cmd = buildClaudeResumeCommand({ tempDir, sessionId, claudePath, model });
  await log('\n💡 To continue this session in Claude Code interactive mode:\n');
  await log(`   ${cmd}\n`);
};
/** Format numbers with spaces as thousands separator (no commas) */
export const formatNumber = num => {
  if (num === null || num === undefined) return 'N/A';
  const parts = num.toString().split('.');
  const integerPart = parts[0];
  const decimalPart = parts[1];
  const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return decimalPart !== undefined ? `${formattedInteger}.${decimalPart}` : formattedInteger;
};
// Model mapping to translate aliases to full model IDs
// Supports [1m] suffix for 1 million token context (Issue #1221)
export const mapModelToId = model => {
  if (!model || typeof model !== 'string') return model;
  // Check for [1m] suffix (case-insensitive)
  const match = model.match(/^(.+?)\[1m\]$/i);
  if (match) {
    const baseModel = match[1];
    const mappedBase = availableModels[baseModel] || baseModel;
    return `${mappedBase}[1m]`;
  }
  return availableModels[model] || model;
};
// Function to validate Claude CLI connection with retry logic
export const validateClaudeConnection = async (model = 'haiku') => {
  // Map model alias to full ID
  const mappedModel = mapModelToId(model);
  const maxRetries = 3;
  const baseDelay = timeouts.retryBaseDelay;
  let retryCount = 0;
  const attemptValidation = async () => {
    try {
      if (retryCount === 0) {
        await log('🔍 Validating Claude CLI connection...');
      } else {
        await log(`🔄 Retry attempt ${retryCount}/${maxRetries} for Claude CLI validation...`);
      }
      try {
        const versionResult = await $`timeout ${Math.floor(timeouts.claudeCli / 6000)} claude --version`;
        if (versionResult.code === 0) {
          const version = versionResult.stdout?.toString().trim();
          detectedClaudeVersion = version; // issue #1146
          if (retryCount === 0) {
            await log(`📦 Claude CLI version: ${version}`);
          }
        }
      } catch (versionError) {
        // Version check failed, but we'll continue with the main validation
        if (retryCount === 0) {
          await log(`⚠️  Claude CLI version check failed (${versionError.code}), proceeding with connection test...`);
        }
      }
      let result;
      try {
        // Primary validation: use printf piping with specified model
        result = await $`printf hi | claude --model ${mappedModel} -p`;
      } catch (pipeError) {
        await log(`⚠️  Pipe validation failed (${pipeError.code}), trying timeout approach...`);
        try {
          result = await $`timeout ${Math.floor(timeouts.claudeCli / 1000)} claude --model ${mappedModel} -p hi`;
        } catch (timeoutError) {
          if (timeoutError.code === 124) {
            await log(`❌ Claude CLI timed out after ${Math.floor(timeouts.claudeCli / 1000)} seconds`, {
              level: 'error',
            });
            await log('   💡 This may indicate Claude CLI is taking too long to respond', { level: 'error' });
            await log(`   💡 Try running 'claude --model ${mappedModel} -p hi' manually to verify it works`, {
              level: 'error',
            });
            return false;
          }
          throw timeoutError;
        }
      }
      const stdout = result.stdout?.toString() || '';
      const stderr = result.stderr?.toString() || '';
      const checkForJsonError = text => {
        try {
          if (text.includes('"error"') && text.includes('"type"')) {
            const jsonMatch = text.match(/\{.*"error".*\}/);
            if (jsonMatch) {
              const errorObj = JSON.parse(jsonMatch[0]);
              return errorObj.error;
            }
          }
        } catch (e) {
          if (global.verboseMode) {
            reportError(e, {
              context: 'claude_json_error_parse',
              level: 'debug',
            });
          }
        }
        return null;
      };
      const jsonError = checkForJsonError(stdout) || checkForJsonError(stderr);
      // Check for API overload error pattern (Issue #1439: also detect 529 overloaded_error)
      const isOverloadError = (stdout.includes('API Error: 500') && stdout.includes('Overloaded')) || (stdout.includes('API Error: 529') && stdout.includes('Overloaded')) || (stderr.includes('API Error: 500') && stderr.includes('Overloaded')) || (stderr.includes('API Error: 529') && stderr.includes('Overloaded')) || (jsonError && (jsonError.type === 'api_error' || jsonError.type === 'overloaded_error') && jsonError.message === 'Overloaded');
      // Handle overload errors with retry
      if (isOverloadError) {
        if (retryCount < maxRetries) {
          const delay = baseDelay * Math.pow(2, retryCount);
          await log(`⚠️ API overload error during validation. Retrying in ${delay / 1000} seconds...`, {
            level: 'warning',
          });
          await new Promise(resolve => setTimeout(resolve, delay));
          retryCount++;
          return await attemptValidation();
        } else {
          await log(`❌ API overload error persisted after ${maxRetries} retries during validation`, {
            level: 'error',
          });
          await log('   The API appears to be heavily loaded. Please try again later.', { level: 'error' });
          return false;
        }
      }
      const exitCode = result.code ?? result.exitCode ?? 0; // Bun shell compat
      if (exitCode !== 0) {
        if (jsonError) {
          await log(`❌ Claude CLI authentication failed: ${jsonError.type} - ${jsonError.message}`, {
            level: 'error',
          });
        } else {
          await log(`❌ Claude CLI failed with exit code ${exitCode}`, { level: 'error' });
          if (stderr) await log(`   Error: ${stderr.trim()}`, { level: 'error' });
        }
        if (stderr.includes('Please run /login') || (jsonError && jsonError.type === 'forbidden')) {
          await log('   💡 Please run: claude login', { level: 'error' });
        }
        return false;
      }
      if (jsonError) {
        if ((jsonError.type === 'api_error' || jsonError.type === 'overloaded_error') && jsonError.message === 'Overloaded') {
          if (retryCount < maxRetries) {
            const delay = baseDelay * Math.pow(2, retryCount);
            await log(`⚠️ API overload error in response. Retrying in ${delay / 1000} seconds...`, {
              level: 'warning',
            });
            await new Promise(resolve => setTimeout(resolve, delay));
            retryCount++;
            return await attemptValidation();
          } else {
            await log(`❌ API overload error persisted after ${maxRetries} retries`, { level: 'error' });
            return false;
          }
        }
        await log(`❌ Claude CLI returned error: ${jsonError.type} - ${jsonError.message}`, { level: 'error' });
        if (jsonError.type === 'forbidden') {
          await log('   💡 Please run: claude login', { level: 'error' });
        }
        return false;
      }
      await log('✅ Claude CLI connection validated successfully');
      return true;
    } catch (error) {
      const errorStr = error.message || error.toString();
      if ((errorStr.includes('API Error: 500') && errorStr.includes('Overloaded')) || (errorStr.includes('API Error: 529') && errorStr.includes('Overloaded')) || (errorStr.includes('api_error') && errorStr.includes('Overloaded')) || (errorStr.includes('overloaded_error') && errorStr.includes('Overloaded'))) {
        if (retryCount < maxRetries) {
          const delay = baseDelay * Math.pow(2, retryCount);
          await log(`⚠️ API overload error during validation. Retrying in ${delay / 1000} seconds...`, {
            level: 'warning',
          });
          await new Promise(resolve => setTimeout(resolve, delay));
          retryCount++;
          return await attemptValidation();
        } else {
          await log(`❌ API overload error persisted after ${maxRetries} retries`, { level: 'error' });
          return false;
        }
      }
      await log(`❌ Failed to validate Claude CLI connection: ${error.message}`, { level: 'error' });
      await log('   💡 Make sure Claude CLI is installed and accessible', { level: 'error' });
      return false;
    }
  }; // End of attemptValidation function
  // Start the validation with retry logic
  return await attemptValidation();
};
export { handleClaudeRuntimeSwitch }; // Re-export from ./claude.runtime-switch.lib.mjs
// Store Claude Code version globally (set during validation)
let detectedClaudeVersion = null;
/** Get the detected Claude Code version @returns {string|null} */
export const getClaudeVersion = () => detectedClaudeVersion;
/** Set the detected Claude Code version (called during validation) @param {string} version */
export const setClaudeVersion = version => {
  detectedClaudeVersion = version;
};
/** Resolve thinking settings based on --think and --thinking-budget options */
export const resolveThinkingSettings = async (argv, log) => {
  const minVersion = argv.thinkingBudgetClaudeMinimumVersion || '2.1.12';
  const version = detectedClaudeVersion || '0.0.0'; // Assume old version if not detected
  const isNewVersion = supportsThinkingBudget(version, minVersion);
  // Get max thinking budget from argv or use default (see issue #1146)
  const maxBudget = argv.maxThinkingBudget ?? DEFAULT_MAX_THINKING_BUDGET;
  // Get thinking level mappings calculated from maxBudget
  const thinkingLevelToTokens = getThinkingLevelToTokens(maxBudget);
  const tokensToThinkingLevel = getTokensToThinkingLevel(maxBudget);
  let thinkingBudget = argv.thinkingBudget;
  let thinkLevel = argv.think;
  let translation = null;
  if (isNewVersion) {
    // Claude Code >= 2.1.12: translate --think to --thinking-budget
    if (thinkLevel !== undefined && thinkingBudget === undefined) {
      thinkingBudget = thinkingLevelToTokens[thinkLevel];
      translation = `--think ${thinkLevel} → --thinking-budget ${thinkingBudget}`;
      if (argv.verbose) {
        await log(`📊 Translating for Claude Code ${version} (>= ${minVersion}):`, { verbose: true });
        await log(`   ${translation}`, { verbose: true });
        if (maxBudget !== DEFAULT_MAX_THINKING_BUDGET) {
          await log(`   Using custom --max-thinking-budget: ${maxBudget}`, { verbose: true });
        }
      }
    }
  } else {
    // Claude Code < 2.1.12: translate --thinking-budget to --think keywords
    if (thinkingBudget !== undefined && thinkLevel === undefined) {
      thinkLevel = tokensToThinkingLevel(thinkingBudget);
      translation = `--thinking-budget ${thinkingBudget} → --think ${thinkLevel}`;
      if (argv.verbose) {
        await log(`📊 Translating for Claude Code ${version} (< ${minVersion}):`, { verbose: true });
        await log(`   ${translation}`, { verbose: true });
      }
      // Clear thinkingBudget since old versions don't support it
      thinkingBudget = undefined;
    }
  }
  return { thinkingBudget, thinkLevel, translation, isNewVersion, maxBudget };
};
/** Check if Playwright MCP is available and connected to Claude @returns {Promise<boolean>} */
export const checkPlaywrightMcpAvailability = async () => {
  try {
    const result = await $`timeout 5 claude mcp list 2>&1`.catch(() => null);
    if (!result || result.code !== 0) return false;
    const output = result.stdout?.toString() || '';
    if (output.toLowerCase().includes('playwright')) return true;
    return false;
  } catch {
    return false;
  }
};
/** Execute Claude with all prompts and settings - main entry point */
export const executeClaude = async params => {
  const { issueUrl, issueNumber, prNumber, prUrl, branchName, tempDir, workspaceTmpDir, isContinueMode, mergeStateStatus, forkedRepo, feedbackLines, forkActionsUrl, owner, repo, argv, log, setLogFile, getLogFile, formatAligned, getResourceSnapshot, claudePath, $ } = params;
  // Check if agent-commander is installed when the option is enabled
  if (argv.promptSubagentsViaAgentCommander) {
    try {
      await $`which start-agent`;
      argv.agentCommanderInstalled = true;
    } catch {
      argv.agentCommanderInstalled = false;
      await log('⚠️  agent-commander not installed; prompt guidance will be skipped (npm i -g @link-assistant/agent-commander)');
    }
  }
  // Import prompt building functions from claude.prompts.lib.mjs
  const { buildUserPrompt, buildSystemPrompt } = await import('./claude.prompts.lib.mjs');
  // Check if the model supports vision using models.dev API
  const mappedModel = mapModelToId(argv.model);
  const modelSupportsVision = await checkModelVisionCapability(mappedModel);
  if (argv.verbose) {
    await log(`👁️  Model vision capability: ${modelSupportsVision ? 'supported' : 'not supported'}`, { verbose: true });
  }
  // Build the user prompt
  const prompt = buildUserPrompt({
    issueUrl,
    issueNumber,
    prNumber,
    prUrl,
    branchName,
    tempDir,
    workspaceTmpDir,
    isContinueMode,
    mergeStateStatus,
    forkedRepo,
    feedbackLines,
    forkActionsUrl,
    owner,
    repo,
    argv,
    claudeVersion: getClaudeVersion(),
  });
  // Build the system prompt
  const systemPrompt = buildSystemPrompt({
    owner,
    repo,
    issueNumber,
    issueUrl,
    prNumber,
    prUrl,
    branchName,
    tempDir,
    workspaceTmpDir,
    isContinueMode,
    forkedRepo,
    argv,
    modelSupportsVision,
  });
  // Log prompt details in verbose mode
  if (argv.verbose) {
    await log('\n📝 Final prompt structure:', { verbose: true });
    await log(`   Characters: ${prompt.length}`, { verbose: true });
    await log(`   System prompt characters: ${systemPrompt.length}`, { verbose: true });
    if (feedbackLines && feedbackLines.length > 0) {
      await log('   Feedback info: Included', { verbose: true });
    }
    // In dry-run mode, output the actual prompts for debugging
    if (argv.dryRun) {
      await log('\n📋 User prompt content:', { verbose: true });
      await log('---BEGIN USER PROMPT---', { verbose: true });
      await log(prompt, { verbose: true });
      await log('---END USER PROMPT---', { verbose: true });
      await log('\n📋 System prompt content:', { verbose: true });
      await log('---BEGIN SYSTEM PROMPT---', { verbose: true });
      await log(systemPrompt, { verbose: true });
      await log('---END SYSTEM PROMPT---', { verbose: true });
    }
  }
  // Escape prompts for shell usage
  const escapedPrompt = prompt.replace(/"/g, '\\"').replace(/\$/g, '\\$');
  const escapedSystemPrompt = systemPrompt.replace(/"/g, '\\"').replace(/\$/g, '\\$');
  // Execute the Claude command
  return await executeClaudeCommand({
    tempDir,
    branchName,
    prompt,
    systemPrompt,
    escapedPrompt,
    escapedSystemPrompt,
    argv,
    log,
    setLogFile,
    getLogFile,
    formatAligned,
    getResourceSnapshot,
    forkedRepo,
    feedbackLines,
    claudePath,
    $,
    // For interactive mode
    owner,
    repo,
    prNumber,
  });
};
/**
 * Fetches model information from pricing API
 * @param {string} modelId - The model ID (e.g., "claude-sonnet-4-5-20250929")
 * @returns {Promise<Object|null>} Model information or null if not found
 */
export const fetchModelInfo = async modelId => {
  try {
    const https = (await use('https')).default;
    return new Promise((resolve, reject) => {
      https
        .get('https://models.dev/api.json', res => {
          let data = '';
          res.on('data', chunk => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              const apiData = JSON.parse(data);
              // For public pricing calculation, prefer Anthropic provider for Claude models
              // Check Anthropic provider first
              if (apiData.anthropic?.models?.[modelId]) {
                const modelInfo = apiData.anthropic.models[modelId];
                modelInfo.provider = apiData.anthropic.name || 'Anthropic';
                resolve(modelInfo);
                return;
              }
              // Search for the model across all other providers
              for (const provider of Object.values(apiData)) {
                if (provider.models && provider.models[modelId]) {
                  const modelInfo = provider.models[modelId];
                  // Add provider info
                  modelInfo.provider = provider.name || provider.id;
                  resolve(modelInfo);
                  return;
                }
              }
              // Model not found
              resolve(null);
            } catch (parseError) {
              reject(parseError);
            }
          });
        })
        .on('error', err => {
          reject(err);
        });
    });
  } catch {
    // If we can't fetch model info, return null and continue without it
    return null;
  }
};
/** Check if a model supports vision (image input) using models.dev API @returns {Promise<boolean>} */
export const checkModelVisionCapability = async modelId => {
  try {
    const modelInfo = await fetchModelInfo(modelId);
    if (!modelInfo) return false;
    const inputModalities = modelInfo.modalities?.input || [];
    return inputModalities.includes('image');
  } catch {
    return false;
  }
};
/** Calculate USD cost for a model's usage with detailed breakdown */
export const calculateModelCost = (usage, modelInfo, includeBreakdown = false) => {
  if (!modelInfo || !modelInfo.cost) {
    return includeBreakdown ? { total: 0, breakdown: null } : 0;
  }
  const cost = modelInfo.cost;
  const breakdown = {
    input: { tokens: 0, costPerMillion: 0, cost: 0 },
    cacheWrite: { tokens: 0, costPerMillion: 0, cost: 0 },
    cacheRead: { tokens: 0, costPerMillion: 0, cost: 0 },
    output: { tokens: 0, costPerMillion: 0, cost: 0 },
  };
  // Input tokens cost (per million tokens)
  if (usage.inputTokens && cost.input) {
    breakdown.input = {
      tokens: usage.inputTokens,
      costPerMillion: cost.input,
      cost: (usage.inputTokens / 1000000) * cost.input,
    };
  }
  // Cache creation tokens cost
  if (usage.cacheCreationTokens && cost.cache_write) {
    breakdown.cacheWrite = {
      tokens: usage.cacheCreationTokens,
      costPerMillion: cost.cache_write,
      cost: (usage.cacheCreationTokens / 1000000) * cost.cache_write,
    };
  }
  // Cache read tokens cost
  if (usage.cacheReadTokens && cost.cache_read) {
    breakdown.cacheRead = {
      tokens: usage.cacheReadTokens,
      costPerMillion: cost.cache_read,
      cost: (usage.cacheReadTokens / 1000000) * cost.cache_read,
    };
  }
  // Output tokens cost
  if (usage.outputTokens && cost.output) {
    breakdown.output = {
      tokens: usage.outputTokens,
      costPerMillion: cost.output,
      cost: (usage.outputTokens / 1000000) * cost.output,
    };
  }
  const totalCost = breakdown.input.cost + breakdown.cacheWrite.cost + breakdown.cacheRead.cost + breakdown.output.cost;
  if (includeBreakdown) {
    return {
      total: totalCost,
      breakdown,
    };
  }
  return totalCost;
};
export const calculateSessionTokens = async (sessionId, tempDir, resultModelUsage = null) => {
  const os = (await use('os')).default;
  const homeDir = os.homedir();
  // Construct the path to the session JSONL file
  // Format: ~/.claude/projects/<project-dir>/<session-id>.jsonl
  // The project directory name is the full path with slashes replaced by dashes
  // e.g., /tmp/gh-issue-solver-123 becomes -tmp-gh-issue-solver-123
  const projectDirName = tempDir.replace(/\//g, '-');
  const sessionFile = path.join(homeDir, '.claude', 'projects', projectDirName, `${sessionId}.jsonl`);
  try {
    await fs.access(sessionFile);
  } catch {
    // File doesn't exist yet or can't be accessed
    return null;
  }
  // Initialize per-model usage tracking
  const modelUsage = {};
  // Issue #1501: Deduplicate JSONL entries by message ID (stream-json splits responses)
  const seenMessageIds = new Set();
  let duplicateCount = 0;
  // Issue #1501: Track peak context usage per request (not cumulative)
  const peakContextByModel = {};
  let globalPeakContext = 0;
  // Issue #1491: Track sub-sessions between compactification events
  const subSessions = [];
  let currentSubSession = createEmptySubSessionUsage();
  const compactifications = [];
  try {
    // Read the entire file
    const fileContent = await fs.readFile(sessionFile, 'utf8');
    const lines = fileContent.trim().split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        // Issue #1491: Detect compactification boundary events
        if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
          // Save current sub-session and start a new one
          if (currentSubSession.messageCount > 0) {
            subSessions.push(currentSubSession);
          }
          compactifications.push({
            timestamp: entry.timestamp || null,
            preTokens: entry.compactMetadata?.preTokens || null,
            trigger: entry.compactMetadata?.trigger || 'unknown',
          });
          currentSubSession = createEmptySubSessionUsage();
          continue;
        }
        if (entry.message && entry.message.usage && entry.message.model) {
          // Issue #1501: Skip duplicate JSONL entries (same message ID = same API response)
          const msgId = entry.message.id;
          if (msgId) {
            if (seenMessageIds.has(msgId)) {
              duplicateCount++;
              continue; // Skip — already counted this message's usage
            }
            seenMessageIds.add(msgId);
          }
          accumulateModelUsage(modelUsage, entry);
          // Issue #1501: Track peak context usage per single API request
          const usage = entry.message.usage;
          const requestContext = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
          const model = entry.message.model;
          if (requestContext > (peakContextByModel[model] || 0)) {
            peakContextByModel[model] = requestContext;
          }
          if (requestContext > globalPeakContext) {
            globalPeakContext = requestContext;
          }
          // Issue #1491: Also track per-sub-session usage
          if (usage.input_tokens) currentSubSession.inputTokens += usage.input_tokens;
          if (usage.cache_creation_input_tokens) currentSubSession.cacheCreationTokens += usage.cache_creation_input_tokens;
          if (usage.cache_read_input_tokens) currentSubSession.cacheReadTokens += usage.cache_read_input_tokens;
          if (usage.output_tokens) currentSubSession.outputTokens += usage.output_tokens;
          currentSubSession.messageCount++;
          // Issue #1501: Track peak context and output per sub-session
          if (requestContext > currentSubSession.peakContextUsage) {
            currentSubSession.peakContextUsage = requestContext;
          }
          if ((usage.output_tokens || 0) > currentSubSession.peakOutputUsage) {
            currentSubSession.peakOutputUsage = usage.output_tokens || 0;
          }
        }
      } catch {
        // Skip lines that aren't valid JSON
        continue;
      }
    }
    // Push the final sub-session
    if (currentSubSession.messageCount > 0) {
      subSessions.push(currentSubSession);
    }
    mergeResultModelUsage(modelUsage, resultModelUsage);
    // If no usage data was found, return null
    if (Object.keys(modelUsage).length === 0) {
      return null;
    }
    // Fetch model information for each model
    const modelInfoPromises = Object.keys(modelUsage).map(async modelId => {
      const modelInfo = await fetchModelInfo(modelId);
      return { modelId, modelInfo };
    });
    const modelInfoResults = await Promise.all(modelInfoPromises);
    const modelInfoMap = {};
    for (const { modelId, modelInfo } of modelInfoResults) {
      if (modelInfo) {
        modelInfoMap[modelId] = modelInfo;
      }
    }
    // Calculate cost for each model and store all characteristics
    for (const [modelId, usage] of Object.entries(modelUsage)) {
      const modelInfo = modelInfoMap[modelId];
      // Issue #1501: Attach peak context usage per model
      usage.peakContextUsage = peakContextByModel[modelId] || 0;
      // Calculate cost using pricing API
      if (modelInfo) {
        const costData = calculateModelCost(usage, modelInfo, true);
        usage.costUSD = costData.total;
        usage.costBreakdown = costData.breakdown;
        usage.modelName = modelInfo.name || modelId;
        usage.modelInfo = modelInfo; // Store complete model info
      } else {
        usage.costUSD = usage._resultCostUSD ?? null;
        usage.costBreakdown = null;
        usage.modelName = modelId;
        // Issue #1539: Use contextWindow/maxOutputTokens from result JSON as fallback model limits
        const ctx = usage._resultContextWindow,
          out = usage._resultMaxOutputTokens;
        usage.modelInfo = ctx || out ? { limit: { context: ctx || null, output: out || null } } : null;
      }
    }
    // Calculate grand totals across all models
    let totalInputTokens = 0;
    let totalCacheCreationTokens = 0;
    let totalCacheReadTokens = 0;
    let totalOutputTokens = 0;
    let totalCostUSD = 0;
    let hasCostData = false;
    for (const usage of Object.values(modelUsage)) {
      totalInputTokens += usage.inputTokens;
      totalCacheCreationTokens += usage.cacheCreationTokens;
      totalCacheReadTokens += usage.cacheReadTokens;
      totalOutputTokens += usage.outputTokens;
      if (usage.costUSD !== null) {
        totalCostUSD += usage.costUSD;
        hasCostData = true;
      }
    }
    // Calculate total tokens (input + cache_creation + output, cache_read doesn't count as new tokens)
    const totalTokens = totalInputTokens + totalCacheCreationTokens + totalOutputTokens;
    return {
      // Per-model breakdown
      modelUsage,
      // Grand totals
      inputTokens: totalInputTokens,
      cacheCreationTokens: totalCacheCreationTokens,
      cacheReadTokens: totalCacheReadTokens,
      outputTokens: totalOutputTokens,
      totalTokens,
      totalCostUSD: hasCostData ? totalCostUSD : null,
      // Issue #1501: Peak context usage (max single-request fill) and dedup stats
      peakContextUsage: globalPeakContext,
      duplicateEntriesSkipped: duplicateCount,
      // Issue #1491/#1501: Sub-session and compactification data (always include for display)
      subSessions,
      compactifications: compactifications.length > 0 ? compactifications : null,
    };
  } catch (readError) {
    throw new Error(`Failed to read session file: ${readError.message}`);
  }
};
// Extracted to claude.stderr.lib.mjs (Issue #477, #1337)
import { isStderrError } from './claude.stderr.lib.mjs';
export { isStderrError };
export const executeClaudeCommand = async params => {
  const {
    tempDir,
    branchName,
    prompt,
    systemPrompt,
    escapedPrompt,
    escapedSystemPrompt,
    argv,
    log,
    setLogFile,
    getLogFile,
    formatAligned,
    getResourceSnapshot,
    forkedRepo,
    feedbackLines,
    claudePath,
    $, // Add command-stream $ to params
    // For interactive mode
    owner,
    repo,
    prNumber,
  } = params;
  // Issue #1331: Unified retry configuration for all transient API errors
  // (Overloaded, 503 Network Error, Internal Server Error) - same params, all with session preservation
  let retryCount = 0;
  // Helper: wait with per-minute countdown for delays >1 minute (Issue #1331)
  const waitWithCountdown = async (delayMs, log) => {
    if (delayMs <= 60000) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
      return;
    }
    let remaining = delayMs;
    const timer = setInterval(async () => {
      remaining -= 60000;
      if (remaining > 0) await log(`⏳ ${Math.round(remaining / 60000)} min remaining...`);
    }, 60000);
    await new Promise(resolve => setTimeout(resolve, delayMs));
    clearInterval(timer);
  };
  // Function to execute with retry logic
  const executeWithRetry = async () => {
    // Execute claude command from the cloned repository directory
    if (retryCount === 0) {
      await log(`\n${formatAligned('🤖', 'Executing Claude:', argv.model.toUpperCase())}`);
    } else {
      await log(`\n${formatAligned('🔄', 'Retry attempt:', `${retryCount}/${retryLimits.maxTransientErrorRetries}`)}`);
    }
    if (argv.verbose) {
      // Output the actual model being used
      const modelName = argv.model === 'opus' ? 'opus' : 'sonnet';
      await log(`   Model: ${modelName}`, { verbose: true });
      await log(`   Working directory: ${tempDir}`, { verbose: true });
      await log(`   Branch: ${branchName}`, { verbose: true });
      await log(`   Prompt length: ${prompt.length} chars`, { verbose: true });
      await log(`   System prompt length: ${systemPrompt.length} chars`, { verbose: true });
      if (feedbackLines && feedbackLines.length > 0) {
        await log(`   Feedback info included: Yes (${feedbackLines.length} lines)`, { verbose: true });
      } else {
        await log('   Feedback info included: No', { verbose: true });
      }
    }
    const resourcesBefore = await getResourceSnapshot();
    await log('📈 System resources before execution:', { verbose: true });
    await log(`   Memory: ${resourcesBefore.memory.split('\n')[1]}`, { verbose: true });
    await log(`   Load: ${resourcesBefore.load}`, { verbose: true });
    let commandFailed = false;
    let sessionId = null;
    let limitReached = false;
    let limitResetTime = null;
    let limitTimezone = null;
    let messageCount = 0;
    let toolUseCount = 0;
    let lastMessage = '';
    let isOverloadError = false;
    let is503Error = false;
    let isInternalServerError = false;
    let isRequestTimeout = false;
    let apiMarkedNotRetryable = false;
    let resultNumTurns = 0;
    let stderrErrors = [];
    let resultSuccessReceived = false;
    let anthropicTotalCostUSD = null;
    let errorDuringExecution = false;
    let resultSummary = null;
    let resultModelUsage = null;
    // Issue #1590: Track sub-agent calls (Agent tool invocations) for per-call stats
    const subAgentCalls = [];
    // Issue #1590: Map tool_use_id -> subAgentCalls index for accumulating per-call usage from parent_tool_use_id events
    const subAgentCallsByToolUseId = new Map();
    // Issue #1491: Track token usage from stream JSON events for independent calculation
    const streamTokenUsage = {
      inputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
      eventCount: 0,
    };
    // Create interactive mode handler if enabled
    let interactiveHandler = null;
    if (argv.interactiveMode && owner && repo && prNumber) {
      await log('🔌 Interactive mode: Creating handler for real-time PR comments', { verbose: true });
      interactiveHandler = createInteractiveHandler({ owner, repo, prNumber, $, log, verbose: argv.verbose });
    } else if (argv.interactiveMode) {
      await log('⚠️ Interactive mode: Disabled - missing PR info (owner/repo/prNumber)', { verbose: true });
    }
    const progressMonitor = await initProgressMonitoring(argv, { owner, repo, prNumber, $, log }); // works with or without --interactive-mode
    let execCommand;
    const mappedModel = mapModelToId(argv.model);
    const resolvedPlanModel = argv.planModel ? mapModelToId(argv.planModel) : undefined; // Issue #1223
    const effectiveModel = resolvedPlanModel ? 'opusplan' : mappedModel;
    const resolvedExecutionModel = resolvedPlanModel ? mappedModel : undefined;
    let claudeArgs = `--output-format stream-json --verbose --dangerously-skip-permissions --model ${effectiveModel}`;
    if (argv.resume) {
      await log(`🔄 Resuming from session: ${argv.resume}`);
      claudeArgs = `--resume ${argv.resume} ${claudeArgs}`;
    }
    claudeArgs += ` -p "${escapedPrompt}" --append-system-prompt "${escapedSystemPrompt}"`;
    const fullCommand = `(cd "${tempDir}" && ${claudePath} ${claudeArgs} | jq -c .)`;
    await log(`\n${formatAligned('📝', 'Raw command:', '')}`);
    await log(`${fullCommand}`);
    await log('');
    if (argv.verbose) {
      await log(`📋 User prompt:\n---BEGIN USER PROMPT---\n${prompt}\n---END USER PROMPT---`, { verbose: true });
      await log(`📋 System prompt:\n---BEGIN SYSTEM PROMPT---\n${systemPrompt}\n---END SYSTEM PROMPT---`, { verbose: true });
    }
    try {
      const { thinkingBudget: resolvedThinkingBudget, thinkLevel, isNewVersion, maxBudget } = await resolveThinkingSettings(argv, log);
      const claudeEnv = getClaudeEnv({ thinkingBudget: resolvedThinkingBudget, model: effectiveModel, thinkLevel, maxBudget, planModel: resolvedPlanModel, executionModel: resolvedExecutionModel, showThinkingContent: argv.showThinkingContent });
      if (argv.verbose) claudeEnv.ANTHROPIC_LOG = 'debug';
      const modelMaxOutputTokens = getMaxOutputTokensForModel(effectiveModel);
      if (argv.verbose) {
        await log(`📊 CLAUDE_CODE_MAX_OUTPUT_TOKENS: ${modelMaxOutputTokens}, MCP_TIMEOUT: ${claudeCode.mcpTimeout}ms, MCP_TOOL_TIMEOUT: ${claudeCode.mcpToolTimeout}ms, ANTHROPIC_LOG: debug`, { verbose: true });
        if (resolvedPlanModel) await log(`📊 opusplan: plan=${resolvedPlanModel}, exec=${resolvedExecutionModel}`, { verbose: true });
        if (resolvedThinkingBudget !== undefined) await log(`📊 MAX_THINKING_TOKENS: ${resolvedThinkingBudget}`, { verbose: true });
        if (claudeEnv.CLAUDE_CODE_EFFORT_LEVEL) await log(`📊 CLAUDE_CODE_EFFORT_LEVEL: ${claudeEnv.CLAUDE_CODE_EFFORT_LEVEL}`, { verbose: true });
        if (claudeEnv.CLAUDE_CODE_SHOW_THINKING) await log(`📊 CLAUDE_CODE_SHOW_THINKING: ${claudeEnv.CLAUDE_CODE_SHOW_THINKING}`, { verbose: true });
        if (!isNewVersion && thinkLevel) await log(`📊 Thinking level (via keywords): ${thinkLevel}`, { verbose: true });
      }
      const simpleEscapedSystem = systemPrompt.replace(/"/g, '\\"');
      if (argv.resume) {
        const simpleEscapedPrompt = prompt.replace(/"/g, '\\"');
        execCommand = $({ cwd: tempDir, mirror: false, env: claudeEnv })`${claudePath} --resume ${argv.resume} --output-format stream-json --verbose --dangerously-skip-permissions --model ${effectiveModel} -p "${simpleEscapedPrompt}" --append-system-prompt "${simpleEscapedSystem}"`;
      } else {
        execCommand = $({ cwd: tempDir, stdin: prompt, mirror: false, env: claudeEnv })`${claudePath} --output-format stream-json --verbose --dangerously-skip-permissions --model ${effectiveModel} --append-system-prompt "${simpleEscapedSystem}"`;
      }
      await log(`${formatAligned('📋', 'Command details:', '')}`);
      await log(formatAligned('📂', 'Working directory:', tempDir, 2));
      await log(formatAligned('🌿', 'Branch:', branchName, 2));
      await log(formatAligned('🤖', 'Model:', `Claude ${argv.model.toUpperCase()}`, 2));
      if (argv.fork && forkedRepo) {
        await log(formatAligned('🍴', 'Fork:', forkedRepo, 2));
      }
      await log(`\n${formatAligned('▶️', 'Streaming output:', '')}\n`);
      let exitCode = 0;
      let stdoutLineBuffer = '';
      let resultEventReceived = false;
      let resultTimeoutId = null;
      let forceExitTriggered = false;
      const streamCloseTimeoutMs = timeouts.resultStreamCloseMs;
      let firstChunkReceived = false;
      let startupTimeoutId = null;
      let isStartupTimeout = false;
      let lastEventTime = null;
      let activityTimeoutId = null;
      let isActivityTimeout = false;
      // Issue #1516: Kill process group (-pid) so leaked /bin/sh children don't survive
      // prettier-ignore
      const killProcessTree = signal => { try { const pid = execCommand.pid || execCommand._pid; if (pid) { process.kill(-pid, signal); return; } } catch { /* not group leader */ } execCommand.kill(signal); };
      const forceExitOnTimeout = async () => {
        if (forceExitTriggered) return;
        forceExitTriggered = true;
        await log(`⚠️ Stream timeout — sending SIGTERM for graceful shutdown (Issue #1280, #1510, #1516)`, { verbose: true });
        try {
          if (execCommand.kill) {
            killProcessTree('SIGTERM');
            // Issue #1346/#1510: Follow up with SIGKILL after 5s if still alive
            const t = setTimeout(() => {
              try {
                if (!execCommand.result?.code) {
                  log(`⚠️ Process tree did not exit after SIGTERM, sending SIGKILL (Issue #1516)`, { verbose: true });
                  killProcessTree('SIGKILL');
                }
              } catch {
                /* exited */
              }
            }, 5000);
            t.unref();
          }
        } catch (e) {
          await log(`   Warning: Could not kill process: ${e.message}`, { verbose: true });
        }
      };
      // Issue #1472/#1475: Startup timeout — force-kill if no output within streamStartupMs
      if (timeouts.streamStartupMs > 0) {
        startupTimeoutId = setTimeout(async () => {
          if (!firstChunkReceived && !forceExitTriggered) {
            isStartupTimeout = true; // Issue #1472/#1475: Flag for retry logic
            await log(`\n⚠️ No output from Claude CLI after ${timeouts.streamStartupMs / 1000}s — force-killing (Issue #1472/#1475)`, { level: 'warning' });
            await forceExitOnTimeout();
          }
        }, timeouts.streamStartupMs);
        startupTimeoutId.unref();
      }
      // Issue #1472: Helper to reset activity timeout on each stdout chunk
      const resetActivityTimeout = () => {
        if (timeouts.streamActivityMs > 0 && !resultEventReceived) {
          if (activityTimeoutId) clearTimeout(activityTimeoutId);
          activityTimeoutId = setTimeout(async () => {
            if (!forceExitTriggered && !resultEventReceived) {
              isActivityTimeout = true;
              const idleSeconds = lastEventTime ? `${Math.round((Date.now() - lastEventTime) / 1000)}s` : 'unknown';
              await log(`\n⚠️ No stream output for ${timeouts.streamActivityMs / 1000}s after previous activity (idle: ${idleSeconds}) — force-killing (Issue #1472)`, { level: 'warning' });
              await forceExitOnTimeout();
            }
          }, timeouts.streamActivityMs);
          activityTimeoutId.unref();
        }
      };
      for await (const chunk of execCommand.stream()) {
        // Issue #1510: Continue processing stream after SIGTERM to capture final output
        // The stream will naturally end when the process exits (SIGTERM) or is force-killed (SIGKILL after 5s)
        if (!firstChunkReceived) {
          // Issue #1472/#1475: Clear startup timeout on first output
          firstChunkReceived = true;
          if (startupTimeoutId) {
            clearTimeout(startupTimeoutId);
            startupTimeoutId = null;
          }
        }
        if (chunk.type === 'stdout') {
          const output = chunk.data.toString();
          resetActivityTimeout(); // Issue #1472: Reset activity timeout on each stdout chunk
          // Append to buffer and split; keep last element (may be incomplete) for next chunk
          stdoutLineBuffer += output;
          const lines = stdoutLineBuffer.split('\n');
          stdoutLineBuffer = lines.pop() || '';
          // Parse each complete NDJSON line
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const data = sanitizeObjectStrings(JSON.parse(line));
              // Issue #1510: Track last event time for all modes (not just interactive)
              // so activity timeout can report accurate idle duration
              lastEventTime = Date.now();
              if (interactiveHandler) {
                if (!interactiveHandler._firstEventLogged) {
                  interactiveHandler._firstEventLogged = true;
                  await log(`🔌 Interactive mode: First event received (type: ${data.type || 'unknown'}) — stream is active`, { verbose: true });
                }
                try {
                  await interactiveHandler.processEvent(data);
                } catch (interactiveError) {
                  await log(`⚠️ Interactive mode error: ${interactiveError.message}`, { verbose: true });
                }
              }
              await log(JSON.stringify(data, null, 2));
              if (!sessionId && data.session_id) {
                sessionId = data.session_id;
                await log(`📌 Session ID: ${sessionId}`);
                let sessionLogFile;
                try {
                  const currentLogFile = getLogFile();
                  sessionLogFile = path.join(path.dirname(currentLogFile), `${sessionId}.log`);
                  await fs.rename(currentLogFile, sessionLogFile);
                  setLogFile(sessionLogFile);
                  await log(`📁 Log renamed to: ${sessionLogFile}`);
                } catch (renameError) {
                  reportError(renameError, { context: 'rename_session_log', sessionId, sessionLogFile, operation: 'rename_log_file' });
                  await log(`⚠️ Could not rename log file: ${renameError.message}`, { verbose: true });
                }
              }
              if (data.type === 'message') messageCount++;
              else if (data.type === 'tool_use') toolUseCount++;
              if (progressMonitor) await progressMonitor.processStreamEvent(data).catch(e => log(`⚠️ Progress: ${e.message}`, { verbose: true }));
              if (data.type === 'result') {
                if (!resultEventReceived) {
                  resultEventReceived = true;
                  await log(`📌 Result event received, starting ${streamCloseTimeoutMs / 1000}s stream close timeout (Issue #1280)`, { verbose: true });
                  resultTimeoutId = setTimeout(forceExitOnTimeout, streamCloseTimeoutMs);
                }
                if (data.subtype === 'success') resultSuccessReceived = true;
                if (data.subtype === 'success' && data.total_cost_usd !== undefined && data.total_cost_usd !== null) {
                  anthropicTotalCostUSD = data.total_cost_usd;
                  await log(`💰 Anthropic official cost captured from success result: $${anthropicTotalCostUSD.toFixed(6)}`, { verbose: true });
                } else if (data.total_cost_usd !== undefined && data.total_cost_usd !== null) {
                  await log(`💰 Anthropic cost from ${data.subtype || 'unknown'} result ignored: $${data.total_cost_usd.toFixed(6)}`, { verbose: true });
                }
                // Issue #1263: Extract result summary (AI's summary of work done) for --attach-solution-summary
                if (data.subtype === 'success' && data.result && typeof data.result === 'string') {
                  resultSummary = data.result;
                  await log('📝 Captured result summary from Claude output', { verbose: true });
                }
                if (data.num_turns !== undefined) {
                  resultNumTurns = data.num_turns;
                  await log(`📊 Session num_turns: ${resultNumTurns}`, { verbose: true });
                }
                if (data.subtype === 'success' && data.modelUsage) resultModelUsage = data.modelUsage; // Issue #1454
                if (data.is_error === true) {
                  lastMessage = data.result || JSON.stringify(data);
                  const subtype = data.subtype || 'unknown';
                  if (subtype === 'error_during_execution') {
                    errorDuringExecution = true;
                    if ((data.errors || []).some(e => isENOSPC(e))) {
                      commandFailed = true;
                      await log('❌ ENOSPC: No space left on device. Free disk space (check ~/.claude/debug).');
                    } else {
                      await log(`⚠️ Error during execution (subtype: ${subtype}) - work may be completed`, { verbose: true });
                    }
                  } else {
                    commandFailed = true;
                    await log(`⚠️ Detected error from Claude CLI (subtype: ${subtype})`, { verbose: true });
                  }
                  if (lastMessage.includes('Session limit reached') || lastMessage.includes('limit reached')) {
                    limitReached = true;
                    await log('⚠️ Detected session limit in result', { verbose: true });
                  }
                  if (lastMessage.includes('Internal server error') && !lastMessage.includes('Overloaded')) {
                    isInternalServerError = true;
                  }
                  // Issue #1353: Detect "Request timed out" from Claude CLI
                  if (lastMessage.includes('Request timed out')) {
                    isRequestTimeout = true;
                    await log('⏱️ Detected request timeout from Claude CLI (will retry with --resume)', { verbose: true });
                  }
                }
              }
              if (data.type === 'text' && data.text) lastMessage = data.text;
              else if (data.type === 'error') {
                lastMessage = data.error || JSON.stringify(data);
                if (lastMessage.includes('Internal server error')) isInternalServerError = true;
              }
              // Issue #1491: Track token usage from stream events for independent calculation
              if (data.type === 'assistant' && data.message && data.message.usage) {
                const u = data.message.usage;
                if (u.input_tokens) streamTokenUsage.inputTokens += u.input_tokens;
                if (u.cache_creation_input_tokens) streamTokenUsage.cacheCreationTokens += u.cache_creation_input_tokens;
                if (u.cache_read_input_tokens) streamTokenUsage.cacheReadTokens += u.cache_read_input_tokens;
                if (u.output_tokens) streamTokenUsage.outputTokens += u.output_tokens;
                streamTokenUsage.eventCount++;
                // Issue #1590: Accumulate per-sub-agent usage from parent_tool_use_id
                if (data.parent_tool_use_id && subAgentCallsByToolUseId.has(data.parent_tool_use_id)) {
                  accumulateSubAgentUsage(subAgentCallsByToolUseId.get(data.parent_tool_use_id), u);
                }
              }
              // Issue #1590: Capture total_tokens from task_notification (completed sub-agent)
              if (data.type === 'system' && data.subtype === 'task_notification' && data.status === 'completed' && data.tool_use_id) {
                const callEntry = subAgentCallsByToolUseId.get(data.tool_use_id);
                if (callEntry && data.usage && data.usage.total_tokens) {
                  callEntry.usage.totalTokens = data.usage.total_tokens;
                  await log(`🤖 Sub-agent "${callEntry.description || 'unknown'}" completed: ${data.usage.total_tokens} total tokens`, { verbose: true });
                }
              }
              if (data.type === 'assistant' && data.message && data.message.content) {
                const content = Array.isArray(data.message.content) ? data.message.content : [data.message.content];
                for (const item of content) {
                  if (item.type === 'text' && item.text) {
                    // Check for the specific 500/529 overload error pattern (Issue #1439: 529 is also an overload)
                    if ((item.text.includes('API Error: 500') || item.text.includes('API Error: 529')) && (item.text.includes('api_error') || item.text.includes('overloaded_error')) && item.text.includes('Overloaded')) {
                      isOverloadError = true;
                      lastMessage = item.text;
                      await log(`⚠️ Detected API overload error${item.text.includes('529') ? ' (529)' : ' (500)'}`, { verbose: true });
                    }
                    if (item.text.includes('API Error: 500') && item.text.includes('Internal server error') && !item.text.includes('Overloaded')) {
                      isInternalServerError = true;
                      lastMessage = item.text;
                    }
                    // Check for 503 errors
                    if (item.text.includes('API Error: 503') || (item.text.includes('503') && item.text.includes('upstream connect error')) || (item.text.includes('503') && item.text.includes('remote connection failure'))) {
                      is503Error = true;
                      lastMessage = item.text;
                      await log('⚠️ Detected 503 network error', { verbose: true });
                    }
                    // Issue #1353: Detect "Request timed out" in assistant text content
                    if (item.text === 'Request timed out' || item.text.includes('Request timed out')) {
                      isRequestTimeout = true;
                      lastMessage = item.text;
                      await log('⏱️ Detected request timeout in assistant message (will retry with --resume)', { verbose: true });
                    }
                  }
                  // Issue #1590: Track sub-agent calls (Agent tool invocations) for per-call stats
                  if (item.type === 'tool_use' && item.name === 'Agent') {
                    const callEntry = createSubAgentCallEntry(item);
                    subAgentCalls.push(callEntry);
                    if (item.id) subAgentCallsByToolUseId.set(item.id, callEntry);
                    await log(`🤖 Sub-agent call #${subAgentCalls.length}: "${callEntry.description || 'unknown'}" (model: ${callEntry.model || 'default'})`, { verbose: true });
                  }
                }
              }
            } catch (parseError) {
              // JSON parse errors are expected for non-JSON output
              // Only report in verbose mode
              if (global.verboseMode) {
                reportError(parseError, {
                  context: 'parse_claude_output',
                  line,
                  operation: 'parse_json_output',
                  level: 'debug',
                });
              }
              // Not JSON or parsing failed, output as-is if it's not empty
              if (line.trim() && !line.includes('node:internal')) {
                await log(line, { stream: 'raw' });
                lastMessage = line;
                // Issue #1015: Detect terms acceptance prompt (non-JSON "[ACTION REQUIRED]..." message)
                const termsAcceptancePattern = /\[ACTION REQUIRED\].*terms|must run.*claude.*review.*terms/i;
                if (termsAcceptancePattern.test(line)) {
                  commandFailed = true;
                  await log('\n❌ Claude Code requires terms acceptance - please run `claude` interactively to accept the updated terms\n   This is not an error in your code, but Claude CLI needs human interaction.', { level: 'error' });
                }
              }
            }
          }
        }
        if (chunk.type === 'stderr') {
          const errorOutput = chunk.data.toString();
          if (errorOutput) {
            await log(errorOutput, { stream: 'stderr' });
            // Issue #1437: Detect x-should-retry: false — non-transient error, fail fast
            if (!apiMarkedNotRetryable && (errorOutput.includes('not retryable') || errorOutput.includes("'x-should-retry': 'false'") || errorOutput.includes('"x-should-retry": "false"'))) {
              apiMarkedNotRetryable = true;
              await log('⚠️ API signaled error is not retryable (x-should-retry: false)', { verbose: true });
            }
            for (const line of errorOutput.split('\n')) {
              if (isStderrError(line)) stderrErrors.push(line.trim());
            }
          }
        } else if (chunk.type === 'exit') {
          // Note: command-stream v0.9.4 stream() does NOT yield exit chunks (Issue #1280) — kept for forward-compat.
          exitCode = chunk.code;
          if (chunk.code !== 0) {
            commandFailed = true;
          }
        }
      }

      // Issue #1183: Process remaining buffer content - extract cost from result type if present
      // Issue #1472: Also forward remaining buffer events to interactive handler
      if (stdoutLineBuffer.trim()) {
        try {
          const data = sanitizeObjectStrings(JSON.parse(stdoutLineBuffer));
          await log(JSON.stringify(data, null, 2));
          if (data.type === 'result' && data.subtype === 'success' && data.total_cost_usd != null) {
            anthropicTotalCostUSD = data.total_cost_usd;
          }
          // Issue #1472: Forward remaining buffer event to interactive handler (was previously missed)
          if (interactiveHandler) {
            try {
              await interactiveHandler.processEvent(data);
            } catch (interactiveError) {
              await log(`⚠️ Interactive mode error (remaining buffer): ${interactiveError.message}`, { verbose: true });
            }
          }
          if (progressMonitor) await progressMonitor.processStreamEvent(data, true).catch(e => log(`⚠️ Progress: ${e.message}`, { verbose: true }));
        } catch {
          if (!stdoutLineBuffer.includes('node:internal')) await log(stdoutLineBuffer, { stream: 'raw' });
        }
      }
      if (startupTimeoutId) {
        clearTimeout(startupTimeoutId);
        startupTimeoutId = null;
      }
      if (activityTimeoutId) {
        clearTimeout(activityTimeoutId);
        activityTimeoutId = null;
      }
      if (resultTimeoutId) {
        clearTimeout(resultTimeoutId); // Issue #1280
        await log(forceExitTriggered ? '⚠️ Stream exited via force-kill timeout' : '✅ Stream closed normally after result event', { verbose: true });
      }
      if (execCommand.result && typeof execCommand.result.code === 'number') {
        const resultExitCode = execCommand.result.code;
        if (exitCode === 0 && resultExitCode !== 0) {
          exitCode = resultExitCode;
          await log(`⚠️ Updated exit code from command result: ${resultExitCode}`, { verbose: true });
        }
        // Specifically detect "command not found" via exit code 127
        if (resultExitCode === 127 && !commandFailed) {
          commandFailed = true;
          await log(`\n❌ Command not found (exit code 127) - "${claudePath}" is not installed or not in PATH\n   Please ensure Claude CLI is installed: npm install -g @anthropic-ai/claude-code`, { level: 'error' });
        }
      }
      // Issue #1472: Flush remaining queued comments, log diagnostic summary, warn on zero events
      if (interactiveHandler) {
        if (!interactiveHandler._firstEventLogged) {
          await log('⚠️ Interactive mode: No events received from Claude CLI — zero comments posted (Issue #1472)', { level: 'warning' });
        }
        try {
          await interactiveHandler.flush();
        } catch (flushError) {
          await log(`⚠️ Interactive mode flush error: ${flushError.message}`, { verbose: true });
        }
        const handlerState = interactiveHandler.getState();
        const durationMin = ((Date.now() - handlerState.startTime) / 60000).toFixed(1);
        const { eventsProcessed: ep, commentsAttempted: ca, commentsPosted: cp, commentsFailed: cf, editsAttempted: ea, editsSucceeded: es, editsFailed: ef, commentQueue: cq } = handlerState;
        await log(`🔌 Interactive mode summary: ${ep} events processed, ${ca} comments attempted, ${cp} posted, ${cf} failed, ${ea} edits attempted, ${es} succeeded, ${ef} failed, ${cq.length} still queued, duration ${durationMin}m`);
        if (handlerState.eventsProcessed > 0 && handlerState.commentsPosted === 0) {
          await log(`⚠️ Interactive mode: Events were received (${handlerState.eventsProcessed}) but zero comments were posted — check GitHub API connectivity and PR access (${handlerState.commentsFailed} failures)`, { level: 'warning' });
        }
      }

      // Issues #1331, #1353, #1472/#1475: Unified transient error retry (exponential backoff, session preservation)
      const isTransientError = isStartupTimeout || isActivityTimeout || isOverloadError || isInternalServerError || is503Error || isRequestTimeout || (lastMessage.includes('API Error: 500') && (lastMessage.includes('Overloaded') || lastMessage.includes('Internal server error'))) || (lastMessage.includes('API Error: 529') && (lastMessage.includes('overloaded_error') || lastMessage.includes('Overloaded'))) || (lastMessage.includes('api_error') && lastMessage.includes('Overloaded')) || (lastMessage.includes('overloaded_error') && lastMessage.includes('Overloaded')) || lastMessage.includes('API Error: 503') || (lastMessage.includes('503') && (lastMessage.includes('upstream connect error') || lastMessage.includes('remote connection failure'))) || lastMessage === 'Request timed out' || lastMessage.includes('Request timed out');
      if ((commandFailed || isTransientError) && isTransientError) {
        // Issue #1472/#1475: Startup/activity timeout → 30s–2min backoff; #1353: Request timeout → 5min–1hr; general → 2min–30min
        const isTimeoutRetry = isStartupTimeout || isActivityTimeout;
        const maxRetries = isTimeoutRetry ? retryLimits.maxTransientErrorRetries : isRequestTimeout ? retryLimits.maxRequestTimeoutRetries : retryLimits.maxTransientErrorRetries;
        const initialDelay = isTimeoutRetry ? 30000 : isRequestTimeout ? retryLimits.initialRequestTimeoutDelayMs : retryLimits.initialTransientErrorDelayMs;
        const maxDelay = isTimeoutRetry ? 120000 : isRequestTimeout ? retryLimits.maxRequestTimeoutDelayMs : retryLimits.maxTransientErrorDelayMs;
        // Issue #1437: Fail fast when API signals x-should-retry: false AND session made no progress
        const isStuckRetry = apiMarkedNotRetryable && retryCount >= retryLimits.maxNotRetryableAttempts && resultNumTurns <= 1;
        if (isStuckRetry) {
          await log(`\n\n❌ API explicitly marked error as not retryable (x-should-retry: false) and session made no progress (num_turns=${resultNumTurns}) after ${retryCount} attempt(s)`, { level: 'error' });
          await log(`   This error is not recoverable. Failing fast to avoid a stuck retry loop (Issue #1437).`, { level: 'error' });
          await log(`   Check https://status.anthropic.com/ for API status.`, { level: 'error' });
          return {
            success: false,
            sessionId,
            limitReached: false,
            limitResetTime: null,
            limitTimezone: null,
            messageCount,
            toolUseCount,
            is503Error,
            anthropicTotalCostUSD,
            resultSummary,
          };
        }
        if (retryCount < maxRetries) {
          const delay = Math.min(initialDelay * Math.pow(retryLimits.retryBackoffMultiplier, retryCount), maxDelay);
          const errorLabel = isStartupTimeout ? 'Stream startup timeout (Issue #1472/#1475)' : isActivityTimeout ? 'Stream activity timeout (Issue #1472)' : isRequestTimeout ? 'Request timeout' : isOverloadError || (lastMessage.includes('API Error: 500') && lastMessage.includes('Overloaded')) || (lastMessage.includes('API Error: 529') && lastMessage.includes('Overloaded')) ? `API overload (${lastMessage.includes('529') ? '529' : '500'})` : isInternalServerError || lastMessage.includes('Internal server error') ? 'Internal server error (500)' : '503 network error';
          const notRetryableHint = apiMarkedNotRetryable ? ' (API says not retryable — will stop early if no progress)' : '';
          const delayLabel = delay >= 60000 ? `${Math.round(delay / 60000)} min` : `${Math.round(delay / 1000)}s`;
          const retryMode = isStartupTimeout ? ' (fresh start)' : ' (session preserved)';
          await log(`\n⚠️ ${errorLabel} detected. Retry ${retryCount + 1}/${maxRetries} in ${delayLabel}${retryMode}${notRetryableHint}...`, { level: 'warning' });
          await log(`   Error: ${isStartupTimeout ? `No output from Claude CLI within ${timeouts.streamStartupMs / 1000}s` : isActivityTimeout ? `No output for ${timeouts.streamActivityMs / 1000}s after previous activity` : lastMessage.substring(0, 200)}`, { verbose: true });
          // Issue #1510: Post PR comment when force-killing and auto-resuming so reviewers can follow the session lifecycle
          if ((isActivityTimeout || isStartupTimeout) && owner && repo && prNumber && $) {
            try {
              const timeoutType = isActivityTimeout ? 'activity' : 'startup';
              const sessionInfo = sessionId ? `\nSession ID: \`${sessionId}\`` : '';
              const resumeInfo = isStartupTimeout ? 'Session will be restarted (fresh start).' : `Session will be resumed with \`--resume\` (context preserved).`;
              const commentBody = `## :warning: Session Force-Killed (${timeoutType} timeout)\n\nThe working session was force-killed due to ${timeoutType} timeout (no stream output for ${isActivityTimeout ? timeouts.streamActivityMs / 1000 : timeouts.streamStartupMs / 1000}s).\n\n**Auto-resuming**: Retry ${retryCount + 1}/${maxRetries} in ${delayLabel}. ${resumeInfo}${sessionInfo}\n\n*This is an automated notification — the session will continue automatically.*`;
              await $`gh pr comment ${prNumber} --repo ${owner}/${repo} --body ${commentBody}`;
              await log(`   Posted force-kill notification to PR #${prNumber}`, { verbose: true });
            } catch (commentError) {
              await log(`   Warning: Could not post force-kill comment to PR: ${commentError.message}`, { verbose: true });
            }
          }
          // Activity timeout preserves session (work was started), startup timeout does not (no session created)
          if (!isStartupTimeout && sessionId && !argv.resume) argv.resume = sessionId;
          await waitWithCountdown(delay, log);
          await log('\n🔄 Retrying now...');
          retryCount++;
          return await executeWithRetry();
        } else {
          await log(`\n\n❌ Transient API error persisted after ${maxRetries} retries\n   Please try again later or check https://status.anthropic.com/`, { level: 'error' });
          return {
            success: false,
            sessionId,
            limitReached: false,
            limitResetTime: null,
            limitTimezone: null,
            messageCount,
            toolUseCount,
            is503Error, // preserve for callers that check this
            anthropicTotalCostUSD, // Issue #1104: Include cost even on failure
            resultSummary, // Issue #1263: Include result summary
          };
        }
      }
      if (commandFailed) {
        // Check for usage limit errors first (more specific)
        const limitInfo = detectUsageLimit(lastMessage);
        if (limitInfo.isUsageLimit) {
          limitReached = true;
          limitResetTime = limitInfo.resetTime;
          limitTimezone = limitInfo.timezone;

          // Format and display user-friendly message
          const messageLines = formatUsageLimitMessage({
            tool: 'Anthropic Claude Code',
            resetTime: limitInfo.resetTime,
            sessionId,
            resumeCommand: argv.url ? `${process.argv[0]} ${process.argv[1]} --auto-continue ${argv.url}` : null,
          });
          for (const line of messageLines) {
            await log(line, { level: 'warning' });
          }
        } else if (lastMessage.includes('context_length_exceeded')) {
          await log('\n\n❌ Context length exceeded. Try with a smaller issue or split the work.', { level: 'error' });
        } else {
          await log(`\n\n❌ Claude command failed with exit code ${exitCode}`, { level: 'error' });
          if (sessionId && !argv.resume) {
            await log(`📌 Session ID for resuming: ${sessionId}`);
            await log('\nTo resume this session, run:');
            await log(`   ${process.argv[0]} ${process.argv[1]} ${argv.url} --resume ${sessionId}`);
          }
        }
      }
      // Issue #1354: Detect silent failures (no messages + stderr errors, skip if result confirmed success)
      if (!commandFailed && !resultSuccessReceived && stderrErrors.length > 0 && messageCount === 0 && toolUseCount === 0) {
        commandFailed = true;
        const errorsPreview = stderrErrors
          .slice(0, 5)
          .map(e => `   ${e.substring(0, 200)}`)
          .join('\n');
        await log(`\n\n❌ Command failed: No messages processed and errors detected in stderr\nStderr errors:\n${errorsPreview}`, { level: 'error' });
      }
      if (commandFailed) {
        // Take resource snapshot after failure
        const resourcesAfter = await getResourceSnapshot();
        await log('\n📈 System resources after execution:', { verbose: true });
        await log(`   Memory: ${resourcesAfter.memory.split('\n')[1]}`, { verbose: true });
        await log(`   Load: ${resourcesAfter.load}`, { verbose: true });
        await showResumeCommand(sessionId, tempDir, claudePath, argv.model, log);
        return {
          success: false,
          sessionId,
          limitReached,
          limitResetTime,
          limitTimezone,
          messageCount,
          toolUseCount,
          errorDuringExecution,
          anthropicTotalCostUSD, // Issue #1104: Include cost even on failure
          resultSummary, // Issue #1263: Include result summary
        };
      }
      // Issue #1088/#1351: Log execution result status
      if (exitCode === 130) {
        await log('\n\n⚠️ Claude command interrupted (CTRL+C)');
      } else if (errorDuringExecution) {
        await log('\n\n⚠️ Claude command finished with errors');
      } else {
        await log('\n\n✅ Claude command completed');
      }
      await log(`📊 Total messages: ${messageCount}, Tool uses: ${toolUseCount}`);
      // Calculate and display total token usage from session JSONL file
      if (sessionId && tempDir) {
        try {
          const tokenUsage = await calculateSessionTokens(sessionId, tempDir, resultModelUsage);
          if (tokenUsage) {
            // Issue #1501: Log deduplication stats in verbose mode
            if (tokenUsage.duplicateEntriesSkipped > 0) {
              await log(`\n⚠️  JSONL deduplication: skipped ${tokenUsage.duplicateEntriesSkipped} duplicate entries (upstream: anthropics/claude-code#6805)`, { verbose: true });
            }
            if (tokenUsage.peakContextUsage > 0) {
              await log(`📊 Peak single-request context: ${formatNumber(tokenUsage.peakContextUsage)} tokens`, { verbose: true });
            }
            await log('\n💰 Token Usage Summary:');
            // Display per-model breakdown
            if (tokenUsage.modelUsage) {
              const modelIds = Object.keys(tokenUsage.modelUsage);
              const modelsFromResult = modelIds.filter(id => tokenUsage.modelUsage[id]._sourceResultJson);
              if (modelsFromResult.length > 0) {
                await log(`📊 Token data supplemented from result JSON for: ${modelsFromResult.join(', ')}`, { verbose: true });
              }
              for (const modelId of modelIds) {
                const usage = tokenUsage.modelUsage[modelId];
                const sourceNote = usage._sourceResultJson ? ' (from result JSON)' : '';
                await log(`\n   📊 ${usage.modelName || modelId}:${sourceNote}`);
                await displayModelUsage(usage, log);
                // Display budget stats if flag is enabled
                if (argv.tokensBudgetStats && usage.modelInfo?.limit) {
                  await displayBudgetStats(usage, tokenUsage, log);
                }
              }
              // Show totals if multiple models were used
              if (modelIds.length > 1) {
                await log('\n   📈 Total across all models:');
              }
              // Show cost comparison (for both single and multiple models)
              await displayCostComparison(tokenUsage.totalCostUSD, anthropicTotalCostUSD, log);
              // Show total tokens for single model only
              if (modelIds.length === 1) {
                await log(`      Total tokens: ${formatNumber(tokenUsage.totalTokens)}`);
              }
            } else {
              // Fallback to old format if modelUsage is not available
              await log(`   Input tokens: ${formatNumber(tokenUsage.inputTokens)}`);
              if (tokenUsage.cacheCreationTokens > 0) {
                await log(`   Cache creation tokens: ${formatNumber(tokenUsage.cacheCreationTokens)}`);
              }
              if (tokenUsage.cacheReadTokens > 0) {
                await log(`   Cache read tokens: ${formatNumber(tokenUsage.cacheReadTokens)}`);
              }
              await log(`   Output tokens: ${formatNumber(tokenUsage.outputTokens)}`);
              await log(`   Total tokens: ${formatNumber(tokenUsage.totalTokens)}`);
            }
          }
        } catch (tokenError) {
          reportError(tokenError, {
            context: 'calculate_session_tokens',
            sessionId,
            operation: 'read_session_jsonl',
          });
          await log(`   ⚠️ Could not calculate token usage: ${tokenError.message}`, { verbose: true });
        }
      }
      await showResumeCommand(sessionId, tempDir, claudePath, argv.model, log);
      return {
        success: true,
        sessionId,
        limitReached,
        limitResetTime,
        limitTimezone,
        messageCount,
        toolUseCount,
        anthropicTotalCostUSD, // Pass Anthropic's official total cost
        errorDuringExecution, // Issue #1088: Track if error_during_execution subtype occurred
        resultSummary, // Issue #1263: Include result summary for --attach-solution-summary
        resultModelUsage, // Issue #1454
        streamTokenUsage: streamTokenUsage.eventCount > 0 ? streamTokenUsage : null, // Issue #1491
        subAgentCalls: subAgentCalls.length > 0 ? subAgentCalls : null, // Issue #1590
      };
    } catch (error) {
      reportError(error, {
        context: 'execute_claude',
        command: params.command,
        claudePath: params.claudePath,
        operation: 'run_claude_command',
      });
      const errorStr = error.message || error.toString();
      // Issue #1331: Unified handler for all transient API errors in exception block
      // Issue #1353: Also handle "Request timed out" in exception block
      // (Overloaded, 503, Internal Server Error, Request timed out) - all with session preservation
      const isTimeoutException = errorStr === 'Request timed out' || errorStr.includes('Request timed out');
      const isTransientException = isTimeoutException || (errorStr.includes('API Error: 500') && (errorStr.includes('Overloaded') || errorStr.includes('Internal server error'))) || (errorStr.includes('API Error: 529') && (errorStr.includes('overloaded_error') || errorStr.includes('Overloaded'))) || (errorStr.includes('api_error') && errorStr.includes('Overloaded')) || (errorStr.includes('overloaded_error') && errorStr.includes('Overloaded')) || errorStr.includes('API Error: 503') || (errorStr.includes('503') && (errorStr.includes('upstream connect error') || errorStr.includes('remote connection failure')));
      if (isTransientException) {
        // Issue #1353: Use timeout-specific backoff for request timeouts
        const maxRetries = isTimeoutException ? retryLimits.maxRequestTimeoutRetries : retryLimits.maxTransientErrorRetries;
        const initialDelay = isTimeoutException ? retryLimits.initialRequestTimeoutDelayMs : retryLimits.initialTransientErrorDelayMs;
        const maxDelay = isTimeoutException ? retryLimits.maxRequestTimeoutDelayMs : retryLimits.maxTransientErrorDelayMs;
        if (retryCount < maxRetries) {
          const delay = Math.min(initialDelay * Math.pow(retryLimits.retryBackoffMultiplier, retryCount), maxDelay);
          const errorLabel = isTimeoutException ? 'Request timeout' : errorStr.includes('Overloaded') ? `API overload (${errorStr.includes('529') ? '529' : '500'})` : errorStr.includes('Internal server error') ? 'Internal server error (500)' : '503 network error';
          await log(`\n⚠️ ${errorLabel} in exception. Retry ${retryCount + 1}/${maxRetries} in ${Math.round(delay / 60000)} min (session preserved)...`, { level: 'warning' });
          if (sessionId && !argv.resume) argv.resume = sessionId;
          await waitWithCountdown(delay, log);
          await log('\n🔄 Retrying now...');
          retryCount++;
          return await executeWithRetry();
        }
      }
      await log(`\n\n❌ Error executing Claude command: ${error.message}`, { level: 'error' });
      return {
        success: false,
        sessionId,
        limitReached,
        limitResetTime: null,
        limitTimezone: null,
        messageCount,
        toolUseCount,
        anthropicTotalCostUSD, // Issue #1104: Include cost even on failure
        resultSummary, // Issue #1263: Include result summary
      };
    }
  }; // End of executeWithRetry function
  // Start the execution with retry logic
  return await executeWithRetry();
};
export const checkForUncommittedChanges = async (tempDir, owner, repo, branchName, $, log, autoCommit = false, autoRestartEnabled = true) => {
  await log('\n🔍 Checking for uncommitted changes...');
  try {
    const gitStatusResult = await $({ cwd: tempDir })`git status --porcelain 2>&1`;
    if (gitStatusResult.code === 0) {
      const statusOutput = gitStatusResult.stdout.toString().trim();
      if (statusOutput) {
        await log('📝 Found uncommitted changes');
        await log('Changes:');
        for (const line of statusOutput.split('\n')) {
          await log(`   ${line}`);
        }
        if (autoCommit) {
          await log('💾 Auto-committing changes (--auto-commit-uncommitted-changes is enabled)...');
          const addResult = await $({ cwd: tempDir })`git add -A`;
          if (addResult.code === 0) {
            const commitMessage = 'Auto-commit: Changes made by Claude during problem-solving session';
            const commitResult = await $({ cwd: tempDir })`git commit -m ${commitMessage}`;
            if (commitResult.code === 0) {
              await log('✅ Changes committed successfully');
              await log('📤 Pushing changes to remote...');
              const pushResult = await $({ cwd: tempDir })`git push origin ${branchName} 2>&1`;
              if (pushResult.code === 0) {
                await log('✅ Changes pushed successfully');
              } else {
                await log(`⚠️ Warning: Could not push changes: ${pushResult.stderr?.toString().trim() || pushResult.stdout?.toString().trim()}`, {
                  level: 'warning',
                });
              }
            } else {
              await log(`⚠️ Warning: Could not commit changes: ${commitResult.stderr?.toString().trim()}`, {
                level: 'warning',
              });
            }
          } else {
            await log(`⚠️ Warning: Could not stage changes: ${addResult.stderr?.toString().trim()}`, {
              level: 'warning',
            });
          }
          return false;
        } else if (autoRestartEnabled) {
          await log('\n⚠️  IMPORTANT: Uncommitted changes detected!');
          await log('   Claude made changes that were not committed.\n');
          await log('🔄 AUTO-RESTART: Restarting Claude to handle uncommitted changes...');
          await log('   Claude will review the changes and decide what to commit.\n');
          return true;
        } else {
          await log('\n⚠️  Uncommitted changes detected but auto-restart is disabled.');
          await log('   Use --auto-restart-on-uncommitted-changes to enable or commit manually.\n');
          return false;
        }
      } else {
        await log('✅ No uncommitted changes found');
        return false;
      }
    } else {
      await log(`⚠️ Warning: Could not check git status: ${gitStatusResult.stderr?.toString().trim()}`, {
        level: 'warning',
      });
      return false;
    }
  } catch (gitError) {
    reportError(gitError, { context: 'check_uncommitted_changes', tempDir, operation: 'git_status_check' });
    await log(`⚠️ Warning: Error checking for uncommitted changes: ${gitError.message}`, { level: 'warning' });
    return false;
  }
};
// Export all functions as default object too
// prettier-ignore
export default { validateClaudeConnection, handleClaudeRuntimeSwitch, executeClaude, executeClaudeCommand, checkForUncommittedChanges, calculateSessionTokens, getClaudeVersion, setClaudeVersion, resolveThinkingSettings, checkModelVisionCapability };
