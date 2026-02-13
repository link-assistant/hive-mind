#!/usr/bin/env node
// Agent-related utility functions

// Check if use is already defined (when imported from solve.mjs)
// If not, fetch it (when running standalone)
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const { $ } = await use('command-stream');
const fs = (await use('fs')).promises;
const path = (await use('path')).default;
const os = (await use('os')).default;

// Import log from general lib
import { log } from './lib.mjs';
import { reportError } from './sentry.lib.mjs';
import { timeouts } from './config.lib.mjs';
import { detectUsageLimit, formatUsageLimitMessage } from './usage-limit.lib.mjs';

// Import pricing functions from claude.lib.mjs
// We reuse fetchModelInfo and checkModelVisionCapability to get data from models.dev API
const claudeLib = await import('./claude.lib.mjs');
const { fetchModelInfo, checkModelVisionCapability } = claudeLib;

/**
 * Parse agent JSON output to extract token usage from step_finish events
 * Agent outputs NDJSON (newline-delimited JSON) with step_finish events containing token data
 * @param {string} output - Raw stdout output from agent command
 * @returns {Object} Aggregated token usage and cost data
 */
export const parseAgentTokenUsage = output => {
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalCost: 0,
    stepCount: 0,
  };

  // Try to parse each line as JSON (agent outputs NDJSON format)
  const lines = output.split('\n');
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || !trimmedLine.startsWith('{')) continue;

    try {
      const parsed = JSON.parse(trimmedLine);

      // Look for step_finish events which contain token usage
      if (parsed.type === 'step_finish' && parsed.part?.tokens) {
        const tokens = parsed.part.tokens;
        usage.stepCount++;

        // Add token counts
        if (tokens.input) usage.inputTokens += tokens.input;
        if (tokens.output) usage.outputTokens += tokens.output;
        if (tokens.reasoning) usage.reasoningTokens += tokens.reasoning;

        // Handle cache tokens (can be in different formats)
        if (tokens.cache) {
          if (tokens.cache.read) usage.cacheReadTokens += tokens.cache.read;
          if (tokens.cache.write) usage.cacheWriteTokens += tokens.cache.write;
        }

        // Add cost from step_finish (usually 0 for free models like grok-code)
        if (parsed.part.cost !== undefined) {
          usage.totalCost += parsed.part.cost;
        }
      }
    } catch {
      // Skip lines that aren't valid JSON
      continue;
    }
  }

  return usage;
};

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
  // Known mappings for free models to their base paid versions
  const freeToBaseMap = {
    'kimi-k2.5-free': 'kimi-k2.5',
    'glm-4.7-free': 'glm-4.7',
    'minimax-m2.1-free': 'minimax-m2.1',
    'trinity-large-preview-free': 'trinity-large-preview',
    // Grok models don't have a paid equivalent with same name
    // These are kept as-is since they're truly free
  };

  // Check if there's a direct mapping
  if (freeToBaseMap[modelName]) {
    return {
      baseModelName: freeToBaseMap[modelName],
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
      const inputCost = (tokenUsage.inputTokens * (cost.input || 0)) / 1_000_000;
      const outputCost = (tokenUsage.outputTokens * (cost.output || 0)) / 1_000_000;
      const cacheReadCost = (tokenUsage.cacheReadTokens * (cost.cache_read || 0)) / 1_000_000;
      const cacheWriteCost = (tokenUsage.cacheWriteTokens * (cost.cache_write || 0)) / 1_000_000;
      const reasoningCost = (tokenUsage.reasoningTokens * (cost.reasoning || 0)) / 1_000_000;

      const totalCost = inputCost + outputCost + cacheReadCost + cacheWriteCost + reasoningCost;

      // Determine if this is a free model from OpenCode Zen
      // Models accessed via OpenCode Zen are free, regardless of original provider pricing
      const isOpencodeFreeModel = providerFromModel === 'opencode' || isFreeVariant || modelName.toLowerCase().includes('free') || modelName.toLowerCase().includes('grok') || providerFromModel === 'moonshot' || providerFromModel === 'openai' || providerFromModel === 'anthropic';

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
// Agent uses OpenCode Zen's JSON interface and models
// Issue #1185: Free models use opencode/ prefix (not openai/)
export const mapModelToId = model => {
  const modelMap = {
    grok: 'opencode/grok-code',
    'grok-code': 'opencode/grok-code',
    'grok-code-fast-1': 'opencode/grok-code',
    'big-pickle': 'opencode/big-pickle',
    'gpt-5-nano': 'opencode/gpt-5-nano',
    sonnet: 'anthropic/claude-3-5-sonnet',
    haiku: 'anthropic/claude-3-5-haiku',
    opus: 'anthropic/claude-3-opus',
    'gemini-3-pro': 'google/gemini-3-pro',
    // Free models mapping for issue #1250
    'kimi-k2.5-free': 'moonshot/kimi-k2.5-free',
    'gpt-4o-mini': 'openai/gpt-4o-mini',
    'gpt-4o': 'openai/gpt-4o',
    'claude-3.5-haiku': 'anthropic/claude-3.5-haiku',
    'claude-3.5-sonnet': 'anthropic/claude-3.5-sonnet',
  };

  // Return mapped model ID if it's an alias, otherwise return as-is
  return modelMap[model] || model;
};

// Function to validate Agent connection
export const validateAgentConnection = async (model = 'grok-code-fast-1') => {
  // Map model alias to full ID
  const mappedModel = mapModelToId(model);

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
      try {
        const versionResult = await $`timeout ${Math.floor(timeouts.opencodeCli / 1000)} agent --version`;
        if (versionResult.code === 0) {
          const version = versionResult.stdout?.toString().trim();
          if (retryCount === 0) {
            await log(`📦 Agent CLI version: ${version}`);
          }
        }
      } catch (versionError) {
        if (retryCount === 0) {
          await log(`⚠️  Agent CLI version check failed (${versionError.code}), proceeding with connection test...`);
        }
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
    agentPath,
    $,
  });
};

export const executeAgentCommand = async params => {
  const { tempDir, branchName, prompt, systemPrompt, argv, log, formatAligned, getResourceSnapshot, forkedRepo, feedbackLines, agentPath, $ } = params;

  // Retry configuration
  const maxRetries = 3;
  let retryCount = 0;

  const executeWithRetry = async () => {
    // Execute agent command from the cloned repository directory
    if (retryCount === 0) {
      await log(`\n${formatAligned('🤖', 'Executing Agent:', argv.model.toUpperCase())}`);
    } else {
      await log(`\n${formatAligned('🔄', 'Retry attempt:', `${retryCount}/${maxRetries}`)}`);
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

    // Build Agent command
    let execCommand;

    // Map model alias to full ID
    const mappedModel = mapModelToId(argv.model);

    // Build agent command arguments
    let agentArgs = `--model ${mappedModel}`;

    // Propagate verbose flag to agent for detailed debugging output
    if (argv.verbose) {
      agentArgs += ' --verbose';
    }

    // Agent supports stdin in both plain text and JSON format
    // We'll combine system and user prompts into a single message
    const combinedPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;

    // Write the combined prompt to a file for piping
    // Use OS temporary directory instead of repository workspace to avoid polluting the repo
    const promptFile = path.join(os.tmpdir(), `agent_prompt_${Date.now()}_${process.pid}.txt`);
    await fs.writeFile(promptFile, combinedPrompt);

    // Build the full command - pipe the prompt file to agent
    const fullCommand = `(cd "${tempDir}" && cat "${promptFile}" | ${agentPath} ${agentArgs})`;

    await log(`\n${formatAligned('📝', 'Raw command:', '')}`);
    await log(`${fullCommand}`);
    await log('');

    try {
      // Pipe the prompt file to agent via stdin
      // Use agentArgs which includes --model and optionally --verbose
      execCommand = $({
        cwd: tempDir,
        mirror: false,
      })`cat ${promptFile} | ${agentPath} ${agentArgs}`;

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
      // Issue #1276: Track successful completion events to clear error flags
      // When agent emits session.idle or disposal events, it means it recovered and completed successfully
      let agentCompletedSuccessfully = false;
      // Issue #1250: Accumulate token usage during streaming instead of parsing fullOutput later
      // This fixes the issue where NDJSON lines get concatenated without newlines, breaking JSON.parse
      const streamingTokenUsage = {
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalCost: 0,
        stepCount: 0,
      };
      // Helper to accumulate tokens from step_finish events during streaming
      const accumulateTokenUsage = data => {
        if (data.type === 'step_finish' && data.part?.tokens) {
          const tokens = data.part.tokens;
          streamingTokenUsage.stepCount++;
          if (tokens.input) streamingTokenUsage.inputTokens += tokens.input;
          if (tokens.output) streamingTokenUsage.outputTokens += tokens.output;
          if (tokens.reasoning) streamingTokenUsage.reasoningTokens += tokens.reasoning;
          if (tokens.cache) {
            if (tokens.cache.read) streamingTokenUsage.cacheReadTokens += tokens.cache.read;
            if (tokens.cache.write) streamingTokenUsage.cacheWriteTokens += tokens.cache.write;
          }
          if (data.part.cost !== undefined) {
            streamingTokenUsage.totalCost += data.part.cost;
          }
        }
      };

      for await (const chunk of execCommand.stream()) {
        if (chunk.type === 'stdout') {
          const output = chunk.data.toString();
          // Split output into individual lines for NDJSON parsing
          // Agent outputs NDJSON (newline-delimited JSON) format where each line is a separate JSON object
          // This allows us to parse each event independently and extract structured data like session IDs
          const lines = output.split('\n');
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const data = JSON.parse(line);
              // Output formatted JSON
              await log(JSON.stringify(data, null, 2));
              // Capture session ID from the first message
              if (!sessionId && data.sessionID) {
                sessionId = data.sessionID;
                await log(`📌 Session ID: ${sessionId}`);
              }
              // Issue #1250: Accumulate token usage during streaming
              accumulateTokenUsage(data);
              // Issue #1201: Detect error events during streaming for reliable detection
              if (data.type === 'error' || data.type === 'step_error') {
                streamingErrorDetected = true;
                streamingErrorMessage = data.message || data.error || line.substring(0, 100);
                await log(`⚠️  Error event detected in stream: ${streamingErrorMessage}`, { level: 'warning' });
              }
              // Issue #1263: Track text content for result summary
              // Agent outputs text via 'text', 'assistant', or 'message' type events
              if (data.type === 'text' && data.text) {
                lastTextContent = data.text;
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
              // Issue #1276: Detect successful completion events
              // When agent emits session.idle or log with "exiting loop" message, it completed successfully
              // This means any previous error events were recovered from (e.g., timeout then retry)
              if (data.type === 'session.idle' || (data.type === 'log' && data.message === 'exiting loop')) {
                agentCompletedSuccessfully = true;
              }
            } catch {
              // Not JSON - log as plain text
              await log(line);
            }
          }
          lastMessage = output;
          fullOutput += output; // Collect for both pricing calculation and error detection
        }

        if (chunk.type === 'stderr') {
          const errorOutput = chunk.data.toString();
          if (errorOutput) {
            // Agent sends all output (including verbose logs and structured events) to stderr
            // Process each line as NDJSON, same as stdout handling
            const stderrLines = errorOutput.split('\n');
            for (const stderrLine of stderrLines) {
              if (!stderrLine.trim()) continue;
              try {
                const stderrData = JSON.parse(stderrLine);
                // Output formatted JSON (same formatting as stdout)
                await log(JSON.stringify(stderrData, null, 2));
                // Capture session ID from stderr too (agent sends it via stderr)
                if (!sessionId && stderrData.sessionID) {
                  sessionId = stderrData.sessionID;
                  await log(`📌 Session ID: ${sessionId}`);
                }
                // Issue #1250: Accumulate token usage during streaming (stderr)
                accumulateTokenUsage(stderrData);
                // Issue #1201: Detect error events during streaming (stderr) for reliable detection
                if (stderrData.type === 'error' || stderrData.type === 'step_error') {
                  streamingErrorDetected = true;
                  streamingErrorMessage = stderrData.message || stderrData.error || stderrLine.substring(0, 100);
                  await log(`⚠️  Error event detected in stream: ${streamingErrorMessage}`, { level: 'warning' });
                }
                // Issue #1263: Track text content for result summary (stderr)
                if (stderrData.type === 'text' && stderrData.text) {
                  lastTextContent = stderrData.text;
                } else if (stderrData.type === 'assistant' && stderrData.message?.content) {
                  const content = Array.isArray(stderrData.message.content) ? stderrData.message.content : [stderrData.message.content];
                  for (const item of content) {
                    if (item.type === 'text' && item.text) {
                      lastTextContent = item.text;
                    }
                  }
                } else if (stderrData.type === 'message' && stderrData.content) {
                  if (typeof stderrData.content === 'string') {
                    lastTextContent = stderrData.content;
                  } else if (Array.isArray(stderrData.content)) {
                    for (const item of stderrData.content) {
                      if (item.type === 'text' && item.text) {
                        lastTextContent = item.text;
                      }
                    }
                  }
                } else if (stderrData.type === 'result' && stderrData.result) {
                  lastTextContent = stderrData.result;
                }
                // Issue #1276: Detect successful completion events (stderr)
                // When agent emits session.idle or log with "exiting loop" message, it completed successfully
                if (stderrData.type === 'session.idle' || (stderrData.type === 'log' && stderrData.message === 'exiting loop')) {
                  agentCompletedSuccessfully = true;
                }
              } catch {
                // Not JSON - log as plain text
                await log(stderrLine);
              }
            }
            // Also collect stderr for error detection
            fullOutput += errorOutput;
          }
        } else if (chunk.type === 'exit') {
          exitCode = chunk.code;
        }
      }

      // Simplified error detection for agent tool
      // Issue #886: Trust exit code - agent now properly returns code 1 on errors with JSON error response
      // Don't scan output for error patterns as this causes false positives during normal operation
      // (e.g., AI executing bash commands that produce "Permission denied" warnings but succeed)
      //
      // Error detection is now based on:
      // 1. Non-zero exit code (agent returns 1 on errors)
      // 2. Explicit JSON error messages from agent (type: "error")
      // 3. Usage limit detection (handled separately)
      const detectAgentErrors = stdoutOutput => {
        const lines = stdoutOutput.split('\n');

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const msg = JSON.parse(line);

            // Check for explicit error message types from agent
            if (msg.type === 'error' || msg.type === 'step_error') {
              return { detected: true, type: 'AgentError', match: msg.message || msg.error || line.substring(0, 100) };
            }
          } catch {
            // Not JSON - ignore for error detection
            continue;
          }
        }

        return { detected: false };
      };

      // Only check for JSON error messages, not pattern matching in output
      const outputError = detectAgentErrors(fullOutput);

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
      if (!outputError.detected && !streamingErrorDetected) {
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

      if (exitCode !== 0 || outputError.detected) {
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
        const limitInfo = detectUsageLimit(lastMessage);
        if (limitInfo.isUsageLimit) {
          limitReached = true;
          limitResetTime = limitInfo.resetTime;
          errorInfo.limitReached = true;
          errorInfo.limitResetTime = limitResetTime;
          errorInfo.errorType = 'UsageLimit';

          // Format and display user-friendly message
          const messageLines = formatUsageLimitMessage({
            tool: 'Agent',
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
        const pricingInfo = await calculateAgentPricing(mappedModel, tokenUsage);

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
      const pricingInfo = await calculateAgentPricing(mappedModel, tokenUsage);

      // Log pricing information (similar to --tool claude breakdown)
      if (tokenUsage.stepCount > 0) {
        await log('\n💰 Token Usage Summary:');
        await log(`   📊 ${pricingInfo.modelName || mappedModel} (${tokenUsage.stepCount} steps):`);
        await log(`      Input tokens:     ${tokenUsage.inputTokens.toLocaleString()}`);
        await log(`      Output tokens:    ${tokenUsage.outputTokens.toLocaleString()}`);
        if (tokenUsage.reasoningTokens > 0) {
          await log(`      Reasoning tokens: ${tokenUsage.reasoningTokens.toLocaleString()}`);
        }
        if (tokenUsage.cacheReadTokens > 0 || tokenUsage.cacheWriteTokens > 0) {
          await log(`      Cache read:       ${tokenUsage.cacheReadTokens.toLocaleString()}`);
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
            const commitMessage = 'Auto-commit: Changes made by Agent during problem-solving session';
            const commitResult = await $({ cwd: tempDir })`git commit -m ${commitMessage}`;

            if (commitResult.code === 0) {
              await log('✅ Changes committed successfully');

              const pushResult = await $({ cwd: tempDir })`git push origin ${branchName}`;

              if (pushResult.code === 0) {
                await log('✅ Changes pushed successfully');
              } else {
                await log(`⚠️ Warning: Could not push changes: ${pushResult.stderr?.toString().trim()}`, {
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
  executeAgent,
  executeAgentCommand,
  checkForUncommittedChanges,
  parseAgentTokenUsage,
  calculateAgentPricing,
};
