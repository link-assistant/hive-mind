#!/usr/bin/env node
import { ensureUseM } from './use-m-bootstrap.lib.mjs';
// Agent-related utility functions

// Check if use is already defined (when imported from solve.mjs)
// If not, fetch it (when running standalone)
if (typeof globalThis.use === 'undefined') {
  await ensureUseM();
}

const { $ } = await use('command-stream');
const fs = (await use('fs')).promises;
const path = (await use('path')).default;
const os = (await use('os')).default;

// Import log from general lib
import { log } from './lib.mjs';
import { reportError } from './sentry.lib.mjs';
import { timeouts, retryLimits } from './config.lib.mjs';
import { detectUsageLimit, formatUsageLimitMessage } from './usage-limit.lib.mjs';
import { sanitizeObjectStrings } from './unicode-sanitization.lib.mjs';
import Decimal from 'decimal.js-light';
import semver from 'semver';
import { agentModels, defaultModels, freeToBaseModelMap, isFormalAiModel } from './models/index.mjs';
import { isPrepareOnly, logPreparedToolCommand, resolveFormalAiToolExecution } from './formal-ai.lib.mjs';
import { buildFormalAiPricingInfo } from './formal-ai-pricing.lib.mjs'; // Issue #2119
import { checkPlaywrightMcpPackageAvailability, getAgentPlaywrightMcpDisableEnv } from './playwright-mcp.lib.mjs';
import { createAgentTokenUsage, accumulateAgentStepFinishUsage, parseAgentTokenUsage } from './agent-token-usage.lib.mjs';
import { createJsonStreamScanner, parseJsonRecords } from './json-stream.lib.mjs';
import { firstErrorText, stringifyErrorValue } from './error-text.lib.mjs';
import { classifyRetryableError, prepareRetryAfterError, waitWithCountdown } from './tool-retry.lib.mjs';
import { attachStreamingInput, finalizeBidirectionalHandler, setupBidirectionalHandler } from './bidirectional-interactive.lib.mjs';
import { ensureAiToolScratchIgnored, filterAiToolScratchFromStatus } from './ai-tool-scratch.lib.mjs';
import { buildAgentArgs, detectFormalAiAgentRoutingMismatch, formatAgentArgsForDisplay, isAgentIdleEvent, isAgentStrongCompletionEvent } from './agent-command.lib.mjs';

export { createAgentTokenUsage, accumulateAgentStepFinishUsage, parseAgentTokenUsage };

/**
 * Render one streamed agent error record as human-readable text (issue #2141).
 *
 * `@link-assistant/agent` 0.25.x publishes `NamedError.toObject()` under the
 * `error` key: `{"type":"error","error":{"name":"RetryTimeoutExceededError",
 * "data":{"message":"…"}}}`. The previous chain `data.message || data.error ||
 * raw.substring(0, 100)` returned that *object*, and interpolating it into
 * `Agent reported error: ${…}` produced the reason published to GitHub in issue
 * #2141: "AGENT execution failed with Agent reported error: [object Object]".
 *
 * @param {object} record - a sanitized JSON record from the agent stream.
 * @param {string} [raw] - the raw record text, used as a last resort.
 * @returns {string} readable error text, never `[object Object]`.
 */
export const extractAgentErrorText = (record, raw = '') => {
  const fallback = String(raw || '').substring(0, 200) || 'Agent emitted an error event without any details';
  return firstErrorText([record?.message, record?.error, record?.data, record], { fallback });
};

/**
 * Model/provider initialization failures that leave the session unable to do any
 * work at all (issue #2141).
 */
const FATAL_AGENT_LOG_PATTERNS = [/ProviderModelNotFoundError/i, /ProviderInitError/i, /NoSuchModelError/i, /ModelNotFoundError/i, /failed to initialize .*model/i];

/**
 * Detect an agent `log` record that reports a fatal startup failure (issue #2141).
 *
 * Reproduced locally with agent CLI 0.25.5: `agent --model nonexistent/model`
 * prints
 *
 *   {"type":"log","level":"error","service":"session.prompt",
 *    "error":"ProviderModelNotFoundError",
 *    "hint":"Check that the model exists in the provider",
 *    "message":"Failed to initialize specified model - NOT falling back to default"}
 *
 * then `session.idle` and exits **0** without ever emitting `{"type":"error"}`.
 * Hive Mind therefore reported the run as a success with no result summary, which
 * is the same class of undiagnosable outcome as issue #2141's `[object Object]`:
 * the run failed, but nothing said so.
 *
 * @param {object} record - a sanitized JSON record from the agent stream.
 * @returns {string|null} readable failure text, or null when the record is not fatal.
 */
export const detectFatalAgentLogRecord = record => {
  if (!record || typeof record !== 'object') return null;
  if (record.type !== 'log' || record.level !== 'error') return null;

  const text = firstErrorText([record.error, record.message], { fallback: '' });
  if (!text) return null;
  const haystack = `${stringifyErrorValue(record.error)} ${stringifyErrorValue(record.message)}`;
  if (!FATAL_AGENT_LOG_PATTERNS.some(pattern => pattern.test(haystack))) return null;

  const parts = [stringifyErrorValue(record.error), stringifyErrorValue(record.message), record.hint ? `hint: ${stringifyErrorValue(record.hint)}` : ''];
  return parts.filter(Boolean).join(' — ');
};

/**
 * Scan agent stdout for explicit JSON error records (issues #1201, #2119, #2141).
 *
 * Exported so the detection precedence can be tested directly instead of being
 * re-implemented in tests (the old duplicate in tests/test-agent-error-detection.mjs
 * kept the `[object Object]` bug invisible).
 *
 * @param {string} stdoutOutput - captured agent stdout.
 * @returns {{detected: boolean, type?: string, match?: string, record?: object}}
 */
export const detectAgentErrorsInOutput = stdoutOutput => {
  // Issue #2119: frame records by balanced JSON, not by newlines, so
  // pretty-printed and concatenated records are still inspected.
  for (const record of parseJsonRecords(stdoutOutput)) {
    const msg = sanitizeObjectStrings(record);

    // Issue #1968: ignore bare `null`/primitive records (msg.type would throw on null).
    if (msg === null || typeof msg !== 'object') continue;

    // Check for explicit error message types from agent
    if (msg.type === 'error' || msg.type === 'step_error') {
      return { detected: true, type: 'AgentError', match: extractAgentErrorText(msg, JSON.stringify(msg)), record: msg };
    }
  }

  return { detected: false };
};

// Import pricing functions from claude.lib.mjs
// We reuse fetchModelInfo and checkModelVisionCapability to get data from models.dev API
const claudeLib = await import('./claude.lib.mjs');
const { fetchModelInfo, checkModelVisionCapability } = claudeLib;

/**
 * Helper function to get original provider name from provider identifier
 * Used for calculating public pricing estimates based on original provider prices
 * @param {string} providerId - Provider identifier (e.g., 'openai', 'anthropic', 'moonshot')
 * @returns {string} Human-readable provider name for pricing reference
 */
const getOriginalProviderName = providerId => {
  if (!providerId) return null;

  const providerMap = {
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    moonshot: 'Moonshot AI',
    google: 'Google',
    opencode: 'OpenCode Zen',
    kilo: 'Kilo Gateway',
    grok: 'xAI',
  };

  return providerMap[providerId] || providerId.charAt(0).toUpperCase() + providerId.slice(1);
};

/**
 * Issue #1250: Normalize model name and find base model for pricing lookup
 * Free models like "kimi-k2.5-free" should use pricing from base model "kimi-k2.5"
 *
 * @param {string} modelName - The model name (e.g., 'kimi-k2.5-free')
 * @returns {Object} Object with:
 *   - baseModelName: The base model name for pricing lookup
 *   - isFreeVariant: Whether this is a free variant
 */
const getBaseModelForPricing = modelName => {
  // Issue #1473: Use centralized freeToBaseModelMap from models/index.mjs

  // Check if there's a direct mapping
  if (freeToBaseModelMap[modelName]) {
    return {
      baseModelName: freeToBaseModelMap[modelName],
      isFreeVariant: true,
    };
  }

  // Try removing "-free" suffix
  if (modelName.endsWith('-free')) {
    return {
      baseModelName: modelName.replace(/-free$/, ''),
      isFreeVariant: true,
    };
  }

  // Not a free variant
  return {
    baseModelName: modelName,
    isFreeVariant: false,
  };
};

/**
 * Calculate pricing for agent tool usage using models.dev API
 * Issue #1250: Shows actual provider (OpenCode Zen) and calculates public pricing estimate
 * based on original provider prices (Moonshot AI, OpenAI, Anthropic, etc.)
 *
 * For free models like "kimi-k2.5-free", this function:
 * 1. First fetches the free model info to get the model name
 * 2. Then fetches the base model (e.g., "kimi-k2.5") for actual pricing
 * 3. Calculates public pricing estimate based on the base model's cost
 *
 * @param {string} modelId - The model ID used (e.g., 'opencode/grok-code')
 * @param {Object} tokenUsage - Token usage data from parseAgentTokenUsage
 * @returns {Object} Pricing information with:
 *   - provider: Always "OpenCode Zen" (actual provider)
 *   - originalProvider: The original model provider for pricing reference
 *   - totalCostUSD: Public pricing estimate based on original provider prices
 *   - opencodeCost: Actual billed cost from OpenCode Zen (free for most models)
 */
export const calculateAgentPricing = async (modelId, tokenUsage) => {
  // Issue #2119: Formal AI requests never reach OpenCode Zen, so neither the
  // provider label nor a models.dev price lookup applies to them.
  if (isFormalAiModel(modelId)) return buildFormalAiPricingInfo(modelId, tokenUsage);

  // Extract the model name from provider/model format
  // e.g., 'opencode/grok-code' -> 'grok-code'
  const modelName = modelId.includes('/') ? modelId.split('/').pop() : modelId;

  // Extract provider from model ID to determine original provider for pricing
  const providerFromModel = modelId.includes('/') ? modelId.split('/')[0] : null;

  // Get original provider name for pricing reference
  let originalProvider = getOriginalProviderName(providerFromModel);

  try {
    // Fetch model info from models.dev API
    let modelInfo = await fetchModelInfo(modelName);

    // Issue #1250: Check if model has zero pricing (free model from OpenCode Zen)
    // If so, look up the base model for actual public pricing estimate
    const { baseModelName, isFreeVariant } = getBaseModelForPricing(modelName);
    let baseModelInfo = null;
    let pricingCost = modelInfo?.cost;

    if (modelInfo && modelInfo.cost && modelInfo.cost.input === 0 && modelInfo.cost.output === 0 && baseModelName !== modelName) {
      // This is a free model with zero pricing - look up base model for public pricing
      baseModelInfo = await fetchModelInfo(baseModelName);
      if (baseModelInfo && baseModelInfo.cost) {
        // Use base model pricing for public estimate
        pricingCost = baseModelInfo.cost;
        // Update original provider from base model if available
        if (baseModelInfo.provider && !originalProvider) {
          originalProvider = baseModelInfo.provider;
        }
      }
    }

    if (modelInfo || baseModelInfo) {
      const effectiveModelInfo = modelInfo || baseModelInfo;
      const cost = pricingCost || { input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 };

      // Calculate public pricing estimate based on original provider prices
      // Prices are per 1M tokens, so divide by 1,000,000
      // All priced components from models.dev: input, output, cache_read, cache_write, reasoning
      const million = new Decimal(1_000_000);
      const inputCost = new Decimal(tokenUsage.inputTokens)
        .mul(cost.input || 0)
        .div(million)
        .toNumber();
      const outputCost = new Decimal(tokenUsage.outputTokens)
        .mul(cost.output || 0)
        .div(million)
        .toNumber();
      const cacheReadCost = new Decimal(tokenUsage.cacheReadTokens)
        .mul(cost.cache_read || 0)
        .div(million)
        .toNumber();
      const cacheWriteCost = new Decimal(tokenUsage.cacheWriteTokens)
        .mul(cost.cache_write || 0)
        .div(million)
        .toNumber();
      const reasoningCost = new Decimal(tokenUsage.reasoningTokens)
        .mul(cost.reasoning || 0)
        .div(million)
        .toNumber();

      const totalCost = new Decimal(inputCost).plus(outputCost).plus(cacheReadCost).plus(cacheWriteCost).plus(reasoningCost).toNumber();

      // Determine if this is a free model from OpenCode Zen or Kilo Gateway
      // Models accessed via OpenCode Zen or Kilo Gateway are free, regardless of original provider pricing
      // Issue #1300: Added kilo provider detection for Kilo Gateway free models
      const isOpencodeFreeModel = providerFromModel === 'opencode' || providerFromModel === 'kilo' || isFreeVariant || modelName.toLowerCase().includes('free') || modelName.toLowerCase().includes('grok') || providerFromModel === 'moonshot' || providerFromModel === 'openai' || providerFromModel === 'anthropic';

      // Use base model's provider for original provider reference if available
      const effectiveOriginalProvider = baseModelInfo?.provider || originalProvider || effectiveModelInfo?.provider || null;

      return {
        modelId,
        modelName: effectiveModelInfo?.name || modelName,
        // Issue #1250: Always show OpenCode Zen as actual provider
        provider: 'OpenCode Zen',
        // Store original provider for reference in pricing display
        originalProvider: effectiveOriginalProvider,
        pricing: {
          inputPerMillion: cost.input || 0,
          outputPerMillion: cost.output || 0,
          cacheReadPerMillion: cost.cache_read || 0,
          cacheWritePerMillion: cost.cache_write || 0,
          reasoningPerMillion: cost.reasoning || 0,
        },
        tokenUsage,
        breakdown: {
          input: inputCost,
          output: outputCost,
          cacheRead: cacheReadCost,
          cacheWrite: cacheWriteCost,
          reasoning: reasoningCost,
        },
        // Public pricing estimate based on original/base model prices
        totalCostUSD: totalCost,
        // Actual cost from OpenCode Zen (free for supported models)
        opencodeCost: isOpencodeFreeModel ? 0 : totalCost,
        // Keep for backward compatibility - indicates if the accessed model has zero pricing
        isFreeModel: modelInfo?.cost?.input === 0 && modelInfo?.cost?.output === 0,
        // New flag to indicate if OpenCode Zen provides this model for free
        isOpencodeFreeModel,
        // Issue #1250: Include base model info for transparency
        baseModelName: baseModelName !== modelName ? baseModelName : null,
      };
    }
    // Model not found in API, return what we have
    return {
      modelId,
      modelName,
      provider: 'OpenCode Zen',
      originalProvider,
      tokenUsage,
      totalCostUSD: null,
      opencodeCost: 0, // OpenCode Zen is free
      isOpencodeFreeModel: true,
      error: 'Model not found in models.dev API',
    };
  } catch (error) {
    // Error fetching pricing, return with error info
    return {
      modelId,
      modelName,
      provider: 'OpenCode Zen',
      originalProvider,
      tokenUsage,
      totalCostUSD: null,
      opencodeCost: 0, // OpenCode Zen is free
      isOpencodeFreeModel: true,
      error: error.message,
    };
  }
};

// Model mapping to translate aliases to full model IDs for Agent
// Issue #1473: Uses centralized agentModels from models/index.mjs (single source of truth)
export const mapModelToId = model => {
  return agentModels[model] || model;
};

export const MIN_AGENT_LIVE_INPUT_VERSION = '0.24.1';

export const getAgentCliVersion = versionOutput => {
  return semver.clean(versionOutput) || semver.coerce(versionOutput)?.version || null;
};

export const agentCliSupportsLiveInput = versionOutput => {
  const version = getAgentCliVersion(versionOutput);
  return !!version && semver.gte(version, MIN_AGENT_LIVE_INPUT_VERSION);
};

/**
 * Agent only fails closed on a `--model` argv it cannot parse from js-0.25.8
 * onwards (link-assistant/agent#293, fixed by PR #294): earlier releases logged
 * a CRITICAL record and then answered with their *default* model. Issue #2146
 * requires Formal AI to be the only model a task can reach, and a guard that
 * reads the CRITICAL record can only stop the run after Agent has already
 * decided, so a Formal AI task refuses to start below this release.
 */
export const MIN_AGENT_FORMAL_AI_VERSION = '0.25.8';

/** True when this Agent CLI aborts instead of silently picking another model. */
export const agentCliFailsClosedOnModelMismatch = versionOutput => {
  const version = getAgentCliVersion(versionOutput);
  return !!version && semver.gte(version, MIN_AGENT_FORMAL_AI_VERSION);
};

// Function to validate Agent connection
export const validateAgentConnection = async (model = defaultModels.agent, options = {}) => {
  // Map model alias to full ID
  const mappedModel = mapModelToId(model);
  const requireLiveInput = !!options.requireLiveInput;

  // Retry configuration
  const maxRetries = 3;
  let retryCount = 0;

  const attemptValidation = async () => {
    try {
      if (retryCount === 0) {
        await log('🔍 Validating Agent connection...');
      } else {
        await log(`🔄 Retry attempt ${retryCount}/${maxRetries} for Agent validation...`);
      }

      // Check if Agent CLI is installed and get version
      let agentVersion = null;
      try {
        const versionResult = await $`timeout ${Math.floor(timeouts.opencodeCli / 1000)} agent --version`;
        if (versionResult.code === 0) {
          const version = versionResult.stdout?.toString().trim();
          agentVersion = getAgentCliVersion(version);
          if (retryCount === 0) {
            await log(`📦 Agent CLI version: ${version}`);
          }
        }
      } catch (versionError) {
        if (retryCount === 0) {
          await log(`⚠️  Agent CLI version check failed (${versionError.code}), proceeding with connection test...`);
        }
      }

      if (requireLiveInput && (!agentVersion || !semver.gte(agentVersion, MIN_AGENT_LIVE_INPUT_VERSION))) {
        await log(`❌ Agent live stream-json input requires @link-assistant/agent >= ${MIN_AGENT_LIVE_INPUT_VERSION}`, { level: 'error' });
        if (agentVersion) {
          await log(`   Installed Agent CLI version: ${agentVersion}`, { level: 'error' });
        } else {
          await log('   Could not determine the installed Agent CLI version.', { level: 'error' });
        }
        await log('   Update with: bun install -g @link-assistant/agent@latest', { level: 'error' });
        return false;
      }

      if (isFormalAiModel(model) && !(agentVersion && semver.gte(agentVersion, MIN_AGENT_FORMAL_AI_VERSION))) {
        await log(`❌ Formal AI tasks require @link-assistant/agent >= ${MIN_AGENT_FORMAL_AI_VERSION}`, { level: 'error' });
        await log('   Older releases answer with their default model when they cannot parse the requested one', { level: 'error' });
        await log('   (link-assistant/agent#293), and issue #2146 forbids any model other than Formal AI.', { level: 'error' });
        if (agentVersion) {
          await log(`   Installed Agent CLI version: ${agentVersion}`, { level: 'error' });
        } else {
          await log('   Could not determine the installed Agent CLI version.', { level: 'error' });
        }
        await log('   Update with: bun install -g @link-assistant/agent@latest', { level: 'error' });
        return false;
      }

      // Test basic Agent functionality with a simple "hi" message
      // Agent uses the same JSON interface as OpenCode
      const testResult = await $`printf "hi" | timeout ${Math.floor(timeouts.opencodeCli / 1000)} agent --model ${mappedModel}`;

      if (testResult.code !== 0) {
        const stderr = testResult.stderr?.toString() || '';

        if (stderr.includes('auth') || stderr.includes('login')) {
          await log('❌ Agent authentication failed', { level: 'error' });
          await log('   💡 Note: Agent uses OpenCode models. For premium models, you may need: opencode auth', {
            level: 'error',
          });
          return false;
        }

        await log(`❌ Agent validation failed with exit code ${testResult.code}`, { level: 'error' });
        if (stderr) await log(`   Error: ${stderr.trim()}`, { level: 'error' });
        return false;
      }

      // Success
      await log('✅ Agent connection validated successfully');
      return true;
    } catch (error) {
      await log(`❌ Failed to validate Agent connection: ${error.message}`, { level: 'error' });
      await log('   💡 Make sure @link-assistant/agent is installed globally: bun install -g @link-assistant/agent', {
        level: 'error',
      });
      return false;
    }
  };

  // Start the validation
  return await attemptValidation();
};

// Function to handle Agent runtime switching (if applicable)
export const handleAgentRuntimeSwitch = async () => {
  // Agent is run via Bun as a CLI tool, runtime switching may not be applicable
  // This function can be used for any runtime-specific configurations if needed
  await log('ℹ️  Agent runtime handling not required for this operation');
};

/** Check if Playwright MCP is available for Agent @returns {Promise<boolean>} */
export const checkPlaywrightMcpAvailability = checkPlaywrightMcpPackageAvailability;

// Main function to execute Agent with prompts and settings
export const executeAgent = async params => {
  const { issueUrl, issueNumber, prNumber, prUrl, branchName, tempDir, workspaceTmpDir, isContinueMode, mergeStateStatus, forkedRepo, feedbackLines, forkActionsUrl, owner, repo, argv, log, formatAligned, getResourceSnapshot, agentPath = 'agent', $ } = params;

  // Import prompt building functions from agent.prompts.lib.mjs
  const { buildUserPrompt, buildSystemPrompt } = await import('./agent.prompts.lib.mjs');

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
  });

  // Build the system prompt
  const systemPrompt = buildSystemPrompt({
    owner,
    repo,
    issueNumber,
    prNumber,
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

  // Execute the Agent command
  return await executeAgentCommand({
    tempDir,
    branchName,
    prompt,
    systemPrompt,
    argv,
    log,
    formatAligned,
    getResourceSnapshot,
    forkedRepo,
    feedbackLines,
    owner,
    repo,
    prNumber,
    issueNumber,
    agentPath,
    $,
  });
};

export const executeAgentCommand = async params => {
  const { tempDir, branchName, prompt, systemPrompt, argv, log, formatAligned, getResourceSnapshot, forkedRepo, feedbackLines, owner, repo, prNumber, issueNumber, agentPath, $, calculatePricing = calculateAgentPricing, waitForRetryDelay = waitWithCountdown } = params;

  // Retry configuration
  let retryCount = 0;

  const executeWithRetry = async () => {
    // Execute agent command from the cloned repository directory
    if (retryCount === 0) {
      await log(`\n${formatAligned('🤖', 'Executing Agent:', argv.model.toUpperCase())}`);
    } else {
      await log(`\n${formatAligned('🔄', 'Retry attempt:', `${retryCount}/${retryLimits.maxTransientErrorRetries}`)}`);
    }

    if (argv.verbose) {
      await log(`   Model: ${argv.model}`, { verbose: true });
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

    // Take resource snapshot before execution
    const resourcesBefore = await getResourceSnapshot();
    await log('📈 System resources before execution:', { verbose: true });
    await log(`   Memory: ${resourcesBefore.memory.split('\n')[1]}`, { verbose: true });
    await log(`   Load: ${resourcesBefore.load}`, { verbose: true });

    // Issue #1521: Build environment for agent process.
    // Pass LINK_ASSISTANT_AGENT_VERBOSE env var when --verbose is enabled so verbose logging is initialized at module load time.
    const agentEnv = { ...process.env };
    if (argv.verbose) {
      agentEnv.LINK_ASSISTANT_AGENT_VERBOSE = 'true';
    }

    // Apply Playwright MCP session state before launching Agent.
    if (argv.playwrightMcp === false) {
      Object.assign(agentEnv, await getAgentPlaywrightMcpDisableEnv({ env: agentEnv, cwd: tempDir, log }));
      await log('🎭 Playwright MCP physically disabled for this Agent session via --no-playwright-mcp', { verbose: true });
    }

    // Build Agent command
    let execCommand;
    let bidirectionalHandler = null;
    let bidirectionalHandlerFinalized = false;
    let queuedFeedback = [];
    const finalizeAgentBidirectionalHandler = async () => {
      if (bidirectionalHandlerFinalized) return queuedFeedback;
      bidirectionalHandlerFinalized = true;
      queuedFeedback = await finalizeBidirectionalHandler(bidirectionalHandler, log);
      return queuedFeedback;
    };

    // Map model alias to full ID
    const mappedModel = mapModelToId(argv.model);
    // Issue #2130: Formal AI runs the native CLI against a local Formal AI server (no argv wrapper).
    const toolInvocation = await resolveFormalAiToolExecution({ tool: 'agent', model: argv.model, toolPath: agentPath, workdir: tempDir, log, verbose: argv.verbose, prepareOnly: isPrepareOnly(argv), env: agentEnv });
    Object.assign(agentEnv, toolInvocation.env);

    if (argv.resume) {
      await log(`🔄 Resuming from session: ${argv.resume}`);
    }

    // Agent supports stdin in both plain text and JSON format
    // We'll combine system and user prompts into a single message
    const combinedPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;

    try {
      if (argv.acceptIncommingCommentsAsInput) {
        bidirectionalHandler = await setupBidirectionalHandler({
          argv,
          owner,
          repo,
          prNumber,
          issueNumber,
          tempDir,
          $,
          log,
        });
      }
      const streamingInput = !!bidirectionalHandler;
      // Issue #2146: command-stream treats an interpolated string as one argv
      // atom. The old `--model formalai/formal-ai --verbose` string made Agent
      // ignore the requested model and contact its default provider.
      const agentArgs = buildAgentArgs({ model: mappedModel, verbose: argv.verbose, resume: argv.resume, streamingInput });
      const displayedAgentArgs = formatAgentArgsForDisplay(agentArgs);

      let promptFile = null;
      if (!streamingInput) {
        // Write the combined prompt to a file for piping.
        // Use OS temporary directory instead of repository workspace to avoid polluting the repo.
        promptFile = path.join(os.tmpdir(), `agent_prompt_${Date.now()}_${process.pid}.txt`);
        await fs.writeFile(promptFile, combinedPrompt);
      }

      const fullCommand = streamingInput ? `(cd "${tempDir}" && ${toolInvocation.displayCommand} ${displayedAgentArgs})` : `(cd "${tempDir}" && cat "${promptFile}" | ${toolInvocation.displayCommand} ${displayedAgentArgs})`;

      const preparedResult = await logPreparedToolCommand({ argv, fullCommand, log, formatAligned });
      if (preparedResult) return preparedResult;

      if (streamingInput) {
        const commandRunner = $({
          cwd: tempDir,
          stdin: 'pipe',
          mirror: false,
          env: agentEnv,
        });
        execCommand = commandRunner`${toolInvocation.command} ${agentArgs}`;
        const attached = await attachStreamingInput(bidirectionalHandler, execCommand, combinedPrompt, log, !!argv.verbose, { toolLabel: 'Agent' });
        if (!attached) {
          throw new Error('Agent live stream-json input requested, but stdin attachment failed');
        }
      } else {
        // Pipe the prompt file to agent via stdin for the legacy one-shot path.
        const commandRunner = $({
          cwd: tempDir,
          mirror: false,
          env: agentEnv,
        });
        execCommand = commandRunner`cat ${promptFile} | ${toolInvocation.command} ${agentArgs}`;
      }

      await log(`${formatAligned('📋', 'Command details:', '')}`);
      await log(formatAligned('📂', 'Working directory:', tempDir, 2));
      await log(formatAligned('🌿', 'Branch:', branchName, 2));
      await log(formatAligned('🤖', 'Model:', `Agent ${argv.model.toUpperCase()}`, 2));
      if (argv.fork && forkedRepo) {
        await log(formatAligned('🍴', 'Fork:', forkedRepo, 2));
      }

      await log(`\n${formatAligned('▶️', 'Streaming output:', '')}\n`);

      let exitCode = 0;
      let sessionId = null;
      let limitReached = false;
      let limitResetTime = null;
      let lastMessage = '';
      let lastTextContent = ''; // Issue #1263: Track last text content for result summary
      let fullOutput = ''; // Collect all output for error detection (kept for backward compatibility)
      // Issue #1201: Track error events detected during streaming for reliable error detection
      // Post-hoc detection on fullOutput can miss errors if NDJSON lines get concatenated without newlines
      let streamingErrorDetected = false;
      let streamingErrorMessage = null;
      // Only a strong terminal success record may clear a preceding error.
      // `session.idle` is also emitted after terminal API failures (#2146).
      let agentCompletedSuccessfully = false;
      // Issue #2141: a fatal startup log record (e.g. ProviderModelNotFoundError)
      // that the agent CLI reports without any `{"type":"error"}` event.
      let fatalLogErrorMessage = null;
      // A Formal AI run must never continue after Agent resolves another model.
      let formalAiRoutingErrorMessage = null;
      // Issue #1250: Accumulate token usage during streaming instead of parsing fullOutput later
      // This fixes the issue where NDJSON lines get concatenated without newlines, breaking JSON.parse
      const streamingTokenUsage = createAgentTokenUsage();
      const accumulateTokenUsage = data => accumulateAgentStepFinishUsage(streamingTokenUsage, data);
      const markBidirectionalStateFromAgentEvent = async data => {
        if (!bidirectionalHandler) return;
        if (isAgentIdleEvent(data)) {
          if (typeof bidirectionalHandler.markAiIdle === 'function') {
            try {
              await bidirectionalHandler.markAiIdle();
            } catch (idleErr) {
              if (argv.verbose) await log(`⚠️ Bidirectional mode: markAiIdle error: ${idleErr.message}`, { verbose: true });
            }
          }
          return;
        }
        const busyEventTypes = new Set(['init', 'session_start', 'session.started', 'message', 'assistant', 'text', 'tool_use', 'tool_result', 'step_start', 'step_delta']);
        if (busyEventTypes.has(data.type) && typeof bidirectionalHandler.markAiBusy === 'function') {
          bidirectionalHandler.markAiBusy();
        }
      };

      // Issue #2119: agentic CLIs do not all emit strict one-record-per-line
      // NDJSON. `formal-ai with agent --verbose` emits pretty-printed,
      // multi-line records, and records can also be concatenated without a
      // separator (issue #1250) or split across process chunks. A line-based
      // JSON.parse dropped every structured event in those cases, which is how
      // a session that really used 21677/22834 tokens was published as
      // "Token usage: 0 input, 0 output" with no session id and no result
      // summary. The scanner frames records by balanced JSON instead of by
      // newlines, and surfaces anything that is not JSON as plain text.
      const stdoutScanner = createJsonStreamScanner();
      const stderrScanner = createJsonStreamScanner();

      const handleAgentJsonEvent = async (raw, value) => {
        const data = sanitizeObjectStrings(value);
        // Issue #1968: a bare `null`/primitive record must not abort event
        // processing (any data.X access would throw on null).
        if (data === null || typeof data !== 'object') return;
        // Output formatted JSON
        await log(JSON.stringify(data, null, 2));
        // Capture session ID from the first message (agent may use stdout or stderr)
        const eventSessionId = data.sessionID || data.session_id || data.sessionId;
        if (!sessionId && eventSessionId) {
          sessionId = eventSessionId;
          await log(`📌 Session ID: ${sessionId}`);
        }
        // Issue #1250: Accumulate token usage during streaming
        accumulateTokenUsage(data);
        await markBidirectionalStateFromAgentEvent(data);
        if (!formalAiRoutingErrorMessage) {
          const routingMismatch = detectFormalAiAgentRoutingMismatch(data, mappedModel);
          if (routingMismatch) {
            formalAiRoutingErrorMessage = routingMismatch;
            await log(`🛑 ${routingMismatch}`, { level: 'error' });
            // Agent emits its parser warning and selected provider before its
            // first HTTP request. Stop immediately instead of trusting a later
            // error or cost report to reveal that the wrong LLM was used.
            execCommand?.kill?.('SIGTERM');
          }
        }
        // Issue #1201: Detect error events during streaming for reliable detection
        if (data.type === 'error' || data.type === 'step_error') {
          streamingErrorDetected = true;
          // Issue #2141: render `{name, data:{message}}` payloads as text so the
          // published failure reason is diagnosable instead of "[object Object]".
          streamingErrorMessage = extractAgentErrorText(data, raw);
          await log(`⚠️  Error event detected in stream: ${streamingErrorMessage}`, { level: 'warning' });
          // Issue #2141: keep the untouched record so the root cause survives even
          // when the rendering above loses a field. Verbose-only to keep normal
          // logs readable; --attach-logs then carries the full payload.
          await log(`   Raw error record: ${JSON.stringify(data)}`, { level: 'warning', verbose: true });
        }
        // Issue #2141: fail fast when the CLI could not even start the model.
        if (!fatalLogErrorMessage) {
          const fatalLogText = detectFatalAgentLogRecord(data);
          if (fatalLogText) {
            fatalLogErrorMessage = fatalLogText;
            await log(`⚠️  Fatal agent log record detected: ${fatalLogText}`, { level: 'warning' });
            await log(`   Raw log record: ${JSON.stringify(data)}`, { level: 'warning', verbose: true });
          }
        }
        // Issue #1263: Track text content for result summary
        // Agent outputs text via 'text', 'assistant', or 'message' type events
        // Issue #2130: Agent CLI 0.25.x nests the assistant text under `part`
        // (`{"type":"text","part":{"type":"text","text":"…"}}`) and never sets a
        // top-level `data.text`. Reading only `data.text` left `resultSummary`
        // null for every successful run, which surfaced as the false negative
        // "ℹ️  No working session summary available from AI tool output".
        if (data.type === 'text' && (data.text || data.part?.text)) {
          lastTextContent = data.text || data.part.text;
        } else if (data.type === 'assistant' && data.message?.content) {
          // Extract text from assistant message content
          const content = Array.isArray(data.message.content) ? data.message.content : [data.message.content];
          for (const item of content) {
            if (item.type === 'text' && item.text) {
              lastTextContent = item.text;
            }
          }
        } else if (data.type === 'message' && data.content) {
          // Direct message content
          if (typeof data.content === 'string') {
            lastTextContent = data.content;
          } else if (Array.isArray(data.content)) {
            for (const item of data.content) {
              if (item.type === 'text' && item.text) {
                lastTextContent = item.text;
              }
            }
          }
        } else if (data.type === 'result' && data.result) {
          // Explicit result message (like Claude outputs)
          lastTextContent = data.result;
        }
        if (isAgentStrongCompletionEvent(data)) agentCompletedSuccessfully = true;
      };

      const handleAgentStreamEvents = async events => {
        for (const event of events) {
          if (event.type === 'json') await handleAgentJsonEvent(event.raw, event.value);
          // Not JSON - log as plain text
          else await log(event.value);
        }
      };

      for await (const chunk of execCommand.stream()) {
        if (chunk.type === 'stdout') {
          const output = chunk.data.toString();
          await handleAgentStreamEvents(stdoutScanner.write(output));
          lastMessage = output;
          fullOutput += output; // Collect for both pricing calculation and error detection
        }

        if (chunk.type === 'stderr') {
          const errorOutput = chunk.data.toString();
          if (errorOutput) {
            // Agent sends all output (including verbose logs and structured events) to stderr
            // Process it exactly like stdout so telemetry is never stream-specific
            await handleAgentStreamEvents(stderrScanner.write(errorOutput));
            // Also collect stderr for error detection
            fullOutput += errorOutput;
          }
        } else if (chunk.type === 'exit') {
          exitCode = chunk.code;
        }
      }

      // Release any record that was still being assembled when the stream ended.
      await handleAgentStreamEvents(stdoutScanner.flush());
      await handleAgentStreamEvents(stderrScanner.flush());

      // Simplified error detection for agent tool
      // Issue #886: Trust exit code - agent now properly returns code 1 on errors with JSON error response
      // Don't scan output for error patterns as this causes false positives during normal operation
      // (e.g., AI executing bash commands that produce "Permission denied" warnings but succeed)
      //
      // Error detection is now based on:
      // 1. Non-zero exit code (agent returns 1 on errors)
      // 2. Explicit JSON error messages from agent (type: "error")
      // 3. Usage limit detection (handled separately)
      // Only check for JSON error messages, not pattern matching in output
      // Issue #2141: the detection now renders structured payloads as text.
      const outputError = detectAgentErrorsInOutput(fullOutput);

      if (formalAiRoutingErrorMessage) {
        outputError.detected = true;
        outputError.type = 'AgentModelRoutingMismatch';
        outputError.match = formalAiRoutingErrorMessage;
      }

      // Issue #1276: Clear streaming error detection if agent completed successfully
      // When an error occurs during execution (e.g., timeout) but the agent recovers and completes,
      // we should NOT treat it as a failure. The exit code is the authoritative success indicator.
      // Check for: exit code 0 AND (completion event detected OR no streaming error)
      if (exitCode === 0 && (agentCompletedSuccessfully || !streamingErrorDetected)) {
        // Agent exited successfully - clear any streaming errors that were recovered from
        if (streamingErrorDetected && agentCompletedSuccessfully) {
          await log(`ℹ️  Agent recovered from earlier error and completed successfully`, { verbose: true });
        }
        streamingErrorDetected = false;
        streamingErrorMessage = null;
      }

      // Issue #1201: Use streaming detection as primary, post-hoc as fallback
      // Streaming detection is more reliable because it parses each JSON line as it arrives,
      // avoiding issues where NDJSON lines get concatenated without newline delimiters in fullOutput
      if (!outputError.detected && streamingErrorDetected) {
        outputError.detected = true;
        outputError.type = 'AgentError';
        outputError.match = streamingErrorMessage;
      }

      // Issue #1258: Fallback pattern match for error detection
      // When JSON parsing fails (e.g., multi-line pretty-printed JSON in logs),
      // we need to detect error patterns in the raw output string
      // Issue #1290: Skip fallback when agent completed successfully with exit code 0
      // The fallback can cause false positives when error events (like AI_JSONParseError)
      // appear in the output but the agent recovered and completed successfully
      if (!outputError.detected && !streamingErrorDetected && !(exitCode === 0 && agentCompletedSuccessfully)) {
        // Check for error type patterns in raw output (handles pretty-printed JSON)
        const errorTypePatterns = [
          { pattern: '"type": "error"', type: 'AgentError' },
          { pattern: '"type":"error"', type: 'AgentError' },
          { pattern: '"type": "step_error"', type: 'AgentStepError' },
          { pattern: '"type":"step_error"', type: 'AgentStepError' },
        ];

        for (const { pattern, type } of errorTypePatterns) {
          if (fullOutput.includes(pattern)) {
            outputError.detected = true;
            outputError.type = type;
            // Issue #1276: Try to extract the error message from the output
            // First try "error" field (agent error format), then "message" field (generic format)
            // Find the error closest to the "type": "error" pattern for more accurate extraction
            const patternIndex = fullOutput.indexOf(pattern);
            const relevantOutput = patternIndex >= 0 ? fullOutput.substring(patternIndex) : fullOutput;
            // Look for "error" or "message" field near the error type pattern
            const errorFieldMatch = relevantOutput.match(/"error":\s*"([^"]+)"/);
            const messageFieldMatch = relevantOutput.match(/"message":\s*"([^"]+)"/);
            // Prefer "error" field over "message" for agent error events
            outputError.match = errorFieldMatch ? errorFieldMatch[1] : messageFieldMatch ? messageFieldMatch[1] : `Error event detected in output (fallback pattern match for ${pattern})`;
            await log(`⚠️  Error event detected via fallback pattern match: ${outputError.match}`, { level: 'warning' });
            break;
          }
        }

        // Also check for known critical error patterns that indicate failure
        if (!outputError.detected) {
          const criticalErrorPatterns = [
            { pattern: 'AI_RetryError:', extract: /AI_RetryError:\s*(.+?)(?:\n|$)/ },
            { pattern: 'UnhandledRejection', extract: /"errorType":\s*"UnhandledRejection"/ },
            { pattern: 'Failed after 3 attempts', extract: /Failed after \d+ attempts[^"]*/ },
          ];

          for (const { pattern, extract } of criticalErrorPatterns) {
            if (fullOutput.includes(pattern)) {
              outputError.detected = true;
              outputError.type = 'CriticalError';
              const match = fullOutput.match(extract);
              outputError.match = match ? match[0] : `Critical error pattern detected: ${pattern}`;
              await log(`⚠️  Critical error pattern detected via fallback: ${outputError.match}`, { level: 'warning' });
              break;
            }
          }
        }
      }

      // Issue #2141: agent CLI 0.25.5 exits 0 after `ProviderModelNotFoundError`
      // without emitting an error event, so the run was published as a success
      // with no result summary. Treat a fatal startup log record as the failure
      // it is, but only when the session produced no work at all — a recovered
      // error must keep exit code 0 authoritative (issue #1276).
      if (exitCode === 0 && !outputError.detected && fatalLogErrorMessage && !lastTextContent) {
        outputError.detected = true;
        outputError.type = 'AgentFatalLog';
        outputError.match = fatalLogErrorMessage;
        await log(`\n⚠️  Agent exited 0 but never started a model: ${fatalLogErrorMessage}`, { level: 'warning' });
      }

      if (exitCode !== 0 || outputError.detected) {
        const retryableError = classifyRetryableError(outputError.match || streamingErrorMessage || lastMessage || fullOutput);
        if (retryableError.isRetryable) {
          const isRequestTimeoutRetry = retryableError.label === 'Request timeout';
          const maxRetries = isRequestTimeoutRetry ? retryLimits.maxRequestTimeoutRetries : retryLimits.maxTransientErrorRetries;
          if (retryCount < maxRetries) {
            if (sessionId && !argv.resume) argv.resume = sessionId;
            // Issue #2037: retry the same model on capacity errors before falling back;
            // after a capacity-driven model switch, retry quickly instead of waiting the
            // full transient backoff — the new model may be available now.
            const retryPlan = await prepareRetryAfterError({
              tool: 'agent',
              argv,
              log,
              errorMessage: retryableError.message,
              retryCount,
              initialDelayMs: isRequestTimeoutRetry ? retryLimits.initialRequestTimeoutDelayMs : retryLimits.initialTransientErrorDelayMs,
              maxDelayMs: isRequestTimeoutRetry ? retryLimits.maxRequestTimeoutDelayMs : retryLimits.maxTransientErrorDelayMs,
            });
            const delay = retryPlan.delay;
            const delayLabel = delay >= 60000 ? `${Math.round(delay / 60000)} min` : `${Math.round(delay / 1000)}s`;
            await log(`\n⚠️ ${retryableError.label} detected. Retry ${retryCount + 1}/${maxRetries} in ${delayLabel}${sessionId ? ' (session preserved)' : ''}...`, { level: 'warning' });
            await finalizeAgentBidirectionalHandler();
            await waitForRetryDelay(delay, log);
            await log('\n🔄 Retrying now...');
            retryCount++;
            return await executeWithRetry();
          }
          await log(`\n\n❌ ${retryableError.label} persisted after ${maxRetries} retries`, { level: 'error' });
        }

        // Build JSON error structure for consistent error reporting
        const errorInfo = {
          type: 'error',
          exitCode,
          errorDetectedInOutput: outputError.detected,
          errorType: outputError.detected ? outputError.type : exitCode !== 0 ? 'NonZeroExitCode' : null,
          errorMatch: outputError.detected ? outputError.match : null,
          message: null,
          sessionId,
          limitReached: false,
          limitResetTime: null,
        };

        // Check for usage limit errors first (more specific)
        // Issue #1287: Check multiple sources for usage limit detection:
        // 1. lastMessage (the last chunk of output)
        // 2. errorMatch (the extracted error message from JSON output)
        // 3. fullOutput (complete output - fallback)
        let limitInfo = detectUsageLimit(lastMessage);
        if (!limitInfo.isUsageLimit && outputError.match) {
          limitInfo = detectUsageLimit(outputError.match);
        }
        if (!limitInfo.isUsageLimit) {
          // Fallback: scan fullOutput for usage limit patterns
          limitInfo = detectUsageLimit(fullOutput);
        }
        if (limitInfo.isUsageLimit) {
          limitReached = true;
          limitResetTime = limitInfo.resetTime;
          errorInfo.limitReached = true;
          errorInfo.limitResetTime = limitResetTime;
          errorInfo.errorType = 'UsageLimit';

          // Format and display user-friendly message
          const messageLines = formatUsageLimitMessage({
            tool: 'Agent CLI',
            resetTime: limitInfo.resetTime,
            sessionId,
            resumeCommand: sessionId ? `${process.argv[0]} ${process.argv[1]} ${argv.url} --resume ${sessionId}` : null,
          });

          for (const line of messageLines) {
            await log(line, { level: 'warning' });
          }
        } else if (outputError.detected) {
          // Explicit JSON error message from agent (Issue #1201: includes streaming-detected errors)
          errorInfo.message = `Agent reported error: ${outputError.match}`;
          await log(`\n\n❌ ${errorInfo.message}`, { level: 'error' });
        } else if (exitCode === 130) {
          errorInfo.message = 'Agent command interrupted (CTRL+C)';
          await log('\n\n⚠️ Agent command interrupted (CTRL+C)');
        } else {
          errorInfo.message = `Agent command failed with exit code ${exitCode}`;
          await log(`\n\n❌ ${errorInfo.message}`, { level: 'error' });
        }

        // Log error as JSON for structured output (since agent expects JSON input/output)
        await log('\n📋 Error details (JSON):', { level: 'error' });
        await log(JSON.stringify(errorInfo, null, 2), { level: 'error' });

        const resourcesAfter = await getResourceSnapshot();
        await log('\n📈 System resources after execution:', { verbose: true });
        await log(`   Memory: ${resourcesAfter.memory.split('\n')[1]}`, { verbose: true });
        await log(`   Load: ${resourcesAfter.load}`, { verbose: true });

        // Issue #1250: Use streaming-accumulated token usage instead of re-parsing fullOutput
        // This fixes the issue where NDJSON lines get concatenated without newlines, breaking JSON.parse
        const tokenUsage = streamingTokenUsage;
        const pricingInfo = await calculatePricing(mappedModel, tokenUsage);
        await finalizeAgentBidirectionalHandler();

        return {
          success: false,
          sessionId,
          limitReached,
          limitResetTime,
          errorInfo, // Include structured error information
          tokenUsage,
          pricingInfo,
          publicPricingEstimate: pricingInfo.totalCostUSD,
          resultSummary: lastTextContent || null, // Issue #1263: Use last text content from JSON output stream
        };
      }

      await log('\n\n✅ Agent command completed');

      // Issue #1250: Use streaming-accumulated token usage instead of re-parsing fullOutput
      // This fixes the issue where NDJSON lines get concatenated without newlines, breaking JSON.parse
      const tokenUsage = streamingTokenUsage;
      const pricingInfo = await calculatePricing(mappedModel, tokenUsage);

      // Log pricing information (similar to --tool claude breakdown)
      if (tokenUsage.stepCount > 0) {
        await log('\n💰 Token Usage Summary:');
        await log(`   📊 ${pricingInfo.modelName || mappedModel} (${tokenUsage.stepCount} steps):`);
        await log(`      Input tokens:     ${tokenUsage.inputTokens.toLocaleString()}`);
        await log(`      Output tokens:    ${tokenUsage.outputTokens.toLocaleString()}`);
        if (tokenUsage.reasoningTokens > 0) {
          await log(`      Reasoning tokens: ${tokenUsage.reasoningTokens.toLocaleString()}`);
        }
        if (tokenUsage.cacheReadTokens > 0 || tokenUsage.tokenFieldAvailability?.cacheReadTokens) {
          await log(`      Cache read:       ${tokenUsage.cacheReadTokens.toLocaleString()}`);
        }
        if (tokenUsage.cacheWriteTokens > 0 || tokenUsage.tokenFieldAvailability?.cacheWriteTokens) {
          await log(`      Cache write:      ${tokenUsage.cacheWriteTokens.toLocaleString()}`);
        }

        if (pricingInfo.totalCostUSD !== null && pricingInfo.breakdown) {
          // Show per-component cost breakdown (similar to --tool claude)
          await log('      Cost breakdown:');
          await log(`        Input:      $${pricingInfo.breakdown.input.toFixed(6)} (${(pricingInfo.pricing?.inputPerMillion || 0).toFixed(2)}/M tokens)`);
          await log(`        Output:     $${pricingInfo.breakdown.output.toFixed(6)} (${(pricingInfo.pricing?.outputPerMillion || 0).toFixed(2)}/M tokens)`);
          if (tokenUsage.cacheReadTokens > 0) {
            await log(`        Cache read: $${pricingInfo.breakdown.cacheRead.toFixed(6)} (${(pricingInfo.pricing?.cacheReadPerMillion || 0).toFixed(2)}/M tokens)`);
          }
          if (tokenUsage.cacheWriteTokens > 0) {
            await log(`        Cache write: $${pricingInfo.breakdown.cacheWrite.toFixed(6)} (${(pricingInfo.pricing?.cacheWritePerMillion || 0).toFixed(2)}/M tokens)`);
          }
          if (tokenUsage.reasoningTokens > 0 && pricingInfo.breakdown.reasoning > 0) {
            await log(`        Reasoning:  $${pricingInfo.breakdown.reasoning.toFixed(6)} (${(pricingInfo.pricing?.reasoningPerMillion || 0).toFixed(2)}/M tokens)`);
          }
          // Show public pricing estimate
          const pricingRef = pricingInfo.baseModelName && pricingInfo.originalProvider ? ` (based on ${pricingInfo.originalProvider} ${pricingInfo.baseModelName} prices)` : pricingInfo.originalProvider ? ` (based on ${pricingInfo.originalProvider} prices)` : '';
          await log(`      Public pricing estimate: $${pricingInfo.totalCostUSD.toFixed(6)}${pricingRef}`);
          // Show actual OpenCode Zen cost
          if (pricingInfo.isOpencodeFreeModel) {
            await log('      Calculated by OpenCode Zen: $0.00 (Free model)');
          } else if (pricingInfo.opencodeCost !== undefined) {
            await log(`      Calculated by OpenCode Zen: $${pricingInfo.opencodeCost.toFixed(6)}`);
          }
          await log(`      Provider: ${pricingInfo.provider || 'OpenCode Zen'}`);
        } else {
          await log('      Cost: Not available (could not fetch pricing)');
        }
      }

      // Issue #1263: Log if result summary was captured
      if (lastTextContent) {
        await log('📝 Captured result summary from Agent output', { verbose: true });
      }
      await finalizeAgentBidirectionalHandler();

      return {
        success: true,
        sessionId,
        limitReached,
        limitResetTime,
        tokenUsage,
        pricingInfo,
        publicPricingEstimate: pricingInfo.totalCostUSD,
        resultSummary: lastTextContent || null, // Issue #1263: Use last text content from JSON output stream
      };
    } catch (error) {
      reportError(error, {
        context: 'execute_agent',
        command: params.command,
        agentPath: params.agentPath,
        operation: 'run_agent_command',
      });

      await finalizeAgentBidirectionalHandler();
      await log(`\n\n❌ Error executing Agent command: ${error.message}`, { level: 'error' });
      return {
        success: false,
        sessionId: null,
        limitReached: false,
        limitResetTime: null,
        tokenUsage: null,
        pricingInfo: null,
        publicPricingEstimate: null,
        resultSummary: null, // Issue #1263: No result summary available on error
      };
    }
  };

  // Start the execution with retry logic
  return await executeWithRetry();
};

export const checkForUncommittedChanges = async (tempDir, owner, repo, branchName, $, log, autoCommit = false, autoRestartEnabled = true) => {
  // Similar to OpenCode version, check for uncommitted changes
  await log('\n🔍 Checking for uncommitted changes...');
  // Issue #2119: AI tools leave scratch state (.formal-ai/, .playwright-mcp/) in
  // the workspace. Ignoring it here keeps it out of both this check and 'git add -A'.
  await ensureAiToolScratchIgnored(tempDir, log);
  try {
    const gitStatusResult = await $({ cwd: tempDir })`git status --porcelain 2>&1`;

    if (gitStatusResult.code === 0) {
      const statusOutput = filterAiToolScratchFromStatus(gitStatusResult.stdout.toString().trim());

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
            const commitMessage = 'Auto-commit: Changes made by Agent during problem-solving session';
            const commitResult = await $({ cwd: tempDir })`git commit -m ${commitMessage}`;

            if (commitResult.code === 0) {
              await log('✅ Changes committed successfully');

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
          await log('');
          await log('⚠️  IMPORTANT: Uncommitted changes detected!');
          await log('   Agent made changes that were not committed.');
          await log('');
          await log('🔄 AUTO-RESTART: Restarting Agent to handle uncommitted changes...');
          await log('   Agent will review the changes and decide what to commit.');
          await log('');
          return true;
        } else {
          await log('');
          await log('⚠️  Uncommitted changes detected but auto-restart is disabled.');
          await log('   Use --auto-restart-on-uncommitted-changes to enable or commit manually.');
          await log('');
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
    reportError(gitError, {
      context: 'check_uncommitted_changes_agent',
      tempDir,
      operation: 'git_status_check',
    });
    await log(`⚠️ Warning: Error checking for uncommitted changes: ${gitError.message}`, { level: 'warning' });
    return false;
  }
};

// Export all functions as default object too
export default {
  validateAgentConnection,
  handleAgentRuntimeSwitch,
  checkPlaywrightMcpAvailability,
  executeAgent,
  executeAgentCommand,
  checkForUncommittedChanges,
  parseAgentTokenUsage,
  calculateAgentPricing,
};
