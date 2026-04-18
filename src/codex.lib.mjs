#!/usr/bin/env node
// Codex CLI-related utility functions

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
import { sanitizeObjectStrings } from './unicode-sanitization.lib.mjs';
import { mapModelToId, resolveCodexReasoningEffort } from './codex.options.lib.mjs';
import { createInteractiveHandler } from './interactive-mode.lib.mjs';
import { initProgressMonitoring } from './solve.progress-monitoring.lib.mjs';
import { getCodexPlaywrightMcpDisableConfigArgs } from './playwright-mcp.lib.mjs';
import { fetchModelInfo } from './model-info.lib.mjs';
import Decimal from 'decimal.js-light';

const CODEX_USAGE_FIELD_NAMES = ['input_tokens', 'cached_input_tokens', 'output_tokens', 'cache_write_tokens', 'cache_creation_input_tokens', 'reasoning_tokens', 'input_tokens_details.cached_tokens', 'input_tokens_details.cache_read_tokens', 'input_tokens_details.cache_write_tokens', 'input_tokens_details.cache_creation_tokens', 'input_tokens_details.cache_creation_input_tokens', 'output_tokens_details.reasoning_tokens'];
const CODEX_LONG_CONTEXT_PRICE_THRESHOLD = 272000;
const getCodexExecEnv = (verbose = false) => (verbose ? { ...process.env, RUST_LOG: 'debug' } : { ...process.env });
const CODEX_MODEL_DIAGNOSTIC_PATHS = [
  ['model', data => data?.model],
  ['model_name', data => data?.model_name],
  ['from_model', data => data?.from_model],
  ['to_model', data => data?.to_model],
  ['message.model', data => data?.message?.model],
];

const createCodexTokenFieldAvailability = () => ({
  inputTokens: false,
  outputTokens: false,
  reasoningTokens: false,
  cacheReadTokens: false,
  cacheWriteTokens: false,
});

const hasOwnPath = (object, pathName) => {
  let cursor = object;
  for (const part of pathName.split('.')) {
    if (!cursor || typeof cursor !== 'object' || !Object.hasOwn(cursor, part)) return false;
    cursor = cursor[part];
  }
  return true;
};

const getPathValue = (object, pathName) => pathName.split('.').reduce((cursor, part) => cursor?.[part], object);

const getFirstObservedNumber = (object, pathNames) => {
  for (const pathName of pathNames) {
    if (!hasOwnPath(object, pathName)) continue;
    const value = getPathValue(object, pathName);
    return Number.isFinite(value) ? value : 0;
  }
  return 0;
};

const hasAnyObservedPath = (object, pathNames) => pathNames.some(pathName => hasOwnPath(object, pathName));

const CODEX_CACHE_READ_USAGE_PATHS = ['cached_input_tokens', 'input_tokens_details.cached_tokens', 'input_tokens_details.cache_read_tokens'];
const CODEX_CACHE_WRITE_USAGE_PATHS = ['cache_write_tokens', 'cache_creation_input_tokens', 'input_tokens_details.cache_write_tokens', 'input_tokens_details.cache_creation_tokens', 'input_tokens_details.cache_creation_input_tokens'];
const CODEX_REASONING_USAGE_PATHS = ['reasoning_tokens', 'output_tokens_details.reasoning_tokens'];

export const createCodexTokenUsage = requestedModelId => ({
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 0,
  stepCount: 0,
  requestedModelId: requestedModelId || null,
  respondedModelId: requestedModelId || null,
  contextLimit: null,
  outputLimit: null,
  peakContextUsage: 0,
  tokenFieldAvailability: createCodexTokenFieldAvailability(),
});

const createEmptyCodexItemUsage = () => ({
  inputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 0,
  totalTokens: null,
});

const upsertById = (items, nextItem) => {
  const existingIndex = items.findIndex(item => item.id === nextItem.id);
  if (existingIndex >= 0) {
    items[existingIndex] = { ...items[existingIndex], ...nextItem };
  } else {
    items.push(nextItem);
  }
};

const upsertCodexSubAgentCall = (subAgentCalls, item, requestedModelId = null) => {
  const nextCall = {
    id: item.id || null,
    description: item.prompt || `${item.tool || 'collab_tool_call'} via codex`,
    model: requestedModelId || null,
    tool: item.tool || null,
    senderThreadId: item.sender_thread_id || null,
    receiverThreadIds: Array.isArray(item.receiver_thread_ids) ? item.receiver_thread_ids : [],
    agentsStates: item.agents_states || {},
    status: item.status || null,
    usage: subAgentCalls.find(call => call.id === item.id)?.usage || createEmptyCodexItemUsage(),
  };

  upsertById(subAgentCalls, nextCall);
};

const upsertCodexCommandExecution = (commandExecutions, item) => {
  upsertById(commandExecutions, {
    id: item.id || null,
    command: item.command || null,
    aggregatedOutput: item.aggregated_output || '',
    exitCode: item.exit_code ?? null,
    status: item.status || null,
  });
};

const upsertCodexFileChange = (fileChanges, item) => {
  upsertById(fileChanges, {
    id: item.id || null,
    status: item.status || null,
    changes: Array.isArray(item.changes)
      ? item.changes.map(change => ({
          path: change?.path || null,
          kind: change?.kind || null,
        }))
      : [],
  });
};

const upsertCodexMcpToolCall = (mcpToolCalls, item) => {
  upsertById(mcpToolCalls, {
    id: item.id || null,
    server: item.server || null,
    tool: item.tool || null,
    arguments: item.arguments ?? null,
    result: item.result ?? null,
    error: item.error ?? null,
    status: item.status || null,
  });
};

const upsertCodexWebSearch = (webSearches, item) => {
  upsertById(webSearches, {
    id: item.id || null,
    searchId: item.id || null,
    query: item.query || null,
    action: item.action || null,
  });
};

const upsertCodexTodoList = (todoLists, item) => {
  upsertById(todoLists, {
    id: item.id || null,
    items: Array.isArray(item.items)
      ? item.items.map(todo => ({
          text: todo?.text || '',
          completed: !!todo?.completed,
        }))
      : [],
  });
};

const upsertCodexItemError = (itemErrors, item) => {
  upsertById(itemErrors, {
    id: item.id || null,
    message: item.message || '',
  });
};

export const parseCodexExecJsonOutput = (output, state = {}, requestedModelId = null) => {
  const nextState = {
    sessionId: state.sessionId || null,
    authError: state.authError || false,
    resultSummary: state.resultSummary || '',
    tokenUsage: state.tokenUsage || createCodexTokenUsage(requestedModelId),
    eventCounts: state.eventCounts || {},
    itemTypeCounts: state.itemTypeCounts || {},
    subAgentCalls: state.subAgentCalls || [],
    reasoningSummaries: state.reasoningSummaries || [],
    commandExecutions: state.commandExecutions || [],
    fileChanges: state.fileChanges || [],
    mcpToolCalls: state.mcpToolCalls || [],
    webSearches: state.webSearches || [],
    todoLists: state.todoLists || [],
    itemErrors: state.itemErrors || [],
    turnFailures: state.turnFailures || [],
    streamErrors: state.streamErrors || [],
    observedUsageFieldSets: state.observedUsageFieldSets || [],
    observedModelDiagnosticPaths: state.observedModelDiagnosticPaths || [],
  };

  nextState.tokenUsage.tokenFieldAvailability ||= createCodexTokenFieldAvailability();
  const observedModelPaths = new Set(nextState.observedModelDiagnosticPaths);

  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    let data;
    try {
      data = sanitizeObjectStrings(JSON.parse(line));
    } catch {
      continue;
    }

    const eventType = typeof data.type === 'string' ? data.type : 'unknown';
    nextState.eventCounts[eventType] = (nextState.eventCounts[eventType] || 0) + 1;

    if (eventType === 'thread.started' && typeof data.thread_id === 'string' && !nextState.sessionId) {
      nextState.sessionId = data.thread_id;
    } else if (!nextState.sessionId && typeof data.session_id === 'string') {
      nextState.sessionId = data.session_id;
    }

    for (const [pathName, getter] of CODEX_MODEL_DIAGNOSTIC_PATHS) {
      if (typeof getter(data) === 'string') observedModelPaths.add(pathName);
    }

    if (eventType === 'error' && typeof data.message === 'string' && (data.message.includes('401 Unauthorized') || data.message.includes('401') || data.message.includes('Unauthorized'))) {
      nextState.authError = true;
    }

    if (eventType === 'error' && typeof data.message === 'string') {
      nextState.streamErrors.push({ message: data.message });
    }

    if (eventType === 'turn.failed' && typeof data.error?.message === 'string' && (data.error.message.includes('401 Unauthorized') || data.error.message.includes('401') || data.error.message.includes('Unauthorized'))) {
      nextState.authError = true;
    }

    if (eventType === 'turn.failed' && typeof data.error?.message === 'string') {
      nextState.turnFailures.push({ message: data.error.message });
    }

    if (eventType === 'turn.completed' && data.usage && typeof data.usage === 'object') {
      const inputTokens = getFirstObservedNumber(data.usage, ['input_tokens']);
      const cachedInputTokens = getFirstObservedNumber(data.usage, CODEX_CACHE_READ_USAGE_PATHS);
      const cacheWriteTokens = getFirstObservedNumber(data.usage, CODEX_CACHE_WRITE_USAGE_PATHS);
      const outputTokens = getFirstObservedNumber(data.usage, ['output_tokens']);
      const reasoningTokens = getFirstObservedNumber(data.usage, CODEX_REASONING_USAGE_PATHS);

      if (hasOwnPath(data.usage, 'input_tokens')) nextState.tokenUsage.tokenFieldAvailability.inputTokens = true;
      if (hasAnyObservedPath(data.usage, CODEX_CACHE_READ_USAGE_PATHS)) nextState.tokenUsage.tokenFieldAvailability.cacheReadTokens = true;
      if (hasAnyObservedPath(data.usage, CODEX_CACHE_WRITE_USAGE_PATHS)) nextState.tokenUsage.tokenFieldAvailability.cacheWriteTokens = true;
      if (hasOwnPath(data.usage, 'output_tokens')) nextState.tokenUsage.tokenFieldAvailability.outputTokens = true;
      if (hasAnyObservedPath(data.usage, CODEX_REASONING_USAGE_PATHS)) nextState.tokenUsage.tokenFieldAvailability.reasoningTokens = true;

      const nonCachedInputTokens = Math.max(0, inputTokens - cachedInputTokens);
      nextState.tokenUsage.inputTokens += nonCachedInputTokens;
      nextState.tokenUsage.cacheReadTokens += cachedInputTokens;
      nextState.tokenUsage.cacheWriteTokens += cacheWriteTokens;
      nextState.tokenUsage.outputTokens += outputTokens;
      nextState.tokenUsage.reasoningTokens += reasoningTokens;
      nextState.tokenUsage.totalTokens = nextState.tokenUsage.inputTokens + nextState.tokenUsage.cacheReadTokens + nextState.tokenUsage.outputTokens + nextState.tokenUsage.cacheWriteTokens;
      nextState.tokenUsage.stepCount += 1;
      const turnContextUsage = inputTokens + cacheWriteTokens;
      if (turnContextUsage > (nextState.tokenUsage.peakContextUsage || 0)) {
        nextState.tokenUsage.peakContextUsage = turnContextUsage;
      }

      const usageFieldSet = CODEX_USAGE_FIELD_NAMES.filter(fieldName => hasOwnPath(data.usage, fieldName));
      if (usageFieldSet.length > 0) nextState.observedUsageFieldSets.push(usageFieldSet);
    }

    const item = data.item;
    const itemType = typeof item?.type === 'string' ? item.type : null;
    if (itemType) nextState.itemTypeCounts[itemType] = (nextState.itemTypeCounts[itemType] || 0) + 1;

    if ((eventType === 'item.completed' || eventType === 'item.updated') && itemType === 'agent_message' && typeof item.text === 'string' && item.text.trim()) {
      nextState.resultSummary = item.text;
    }

    if ((eventType === 'item.completed' || eventType === 'item.updated') && itemType === 'reasoning' && typeof item.text === 'string' && item.text.trim()) {
      nextState.reasoningSummaries.push(item.text);
    }

    if ((eventType === 'item.completed' || eventType === 'item.updated') && itemType === 'collab_tool_call' && item && typeof item === 'object') {
      upsertCodexSubAgentCall(nextState.subAgentCalls, item, requestedModelId);
    }

    if ((eventType === 'item.started' || eventType === 'item.updated' || eventType === 'item.completed') && itemType === 'command_execution' && item && typeof item === 'object') {
      upsertCodexCommandExecution(nextState.commandExecutions, item);
    }

    if ((eventType === 'item.started' || eventType === 'item.updated' || eventType === 'item.completed') && itemType === 'file_change' && item && typeof item === 'object') {
      upsertCodexFileChange(nextState.fileChanges, item);
    }

    if ((eventType === 'item.started' || eventType === 'item.updated' || eventType === 'item.completed') && itemType === 'mcp_tool_call' && item && typeof item === 'object') {
      upsertCodexMcpToolCall(nextState.mcpToolCalls, item);
    }

    if ((eventType === 'item.started' || eventType === 'item.updated' || eventType === 'item.completed') && itemType === 'web_search' && item && typeof item === 'object') {
      upsertCodexWebSearch(nextState.webSearches, item);
    }

    if ((eventType === 'item.started' || eventType === 'item.updated' || eventType === 'item.completed') && itemType === 'todo_list' && item && typeof item === 'object') {
      upsertCodexTodoList(nextState.todoLists, item);
    }

    if ((eventType === 'item.started' || eventType === 'item.updated' || eventType === 'item.completed') && itemType === 'error' && item && typeof item === 'object') {
      upsertCodexItemError(nextState.itemErrors, item);
    }
  }

  nextState.observedModelDiagnosticPaths = [...observedModelPaths];
  return nextState;
};

export const buildCodexResultModelUsage = (modelId, tokenUsage, pricingInfo = null) => {
  if (!modelId || !tokenUsage) return null;

  return {
    [modelId]: {
      inputTokens: tokenUsage.inputTokens || 0,
      cacheCreationTokens: tokenUsage.cacheWriteTokens || 0,
      cacheReadTokens: tokenUsage.cacheReadTokens || 0,
      outputTokens: tokenUsage.outputTokens || 0,
      modelName: pricingInfo?.modelName || modelId,
      modelInfo: pricingInfo?.modelInfo || null,
      peakContextUsage: tokenUsage.peakContextUsage || 0,
      costUSD: pricingInfo?.totalCostUSD ?? null,
    },
  };
};

const toCost = (tokens, pricePerMillion) => {
  if (!Number.isFinite(tokens) || !Number.isFinite(pricePerMillion)) return 0;
  return new Decimal(tokens).mul(pricePerMillion).div(1_000_000).toNumber();
};

const buildCodexPricingFallback = (modelId, tokenUsage, error = null) => ({
  modelId,
  modelName: modelId,
  provider: 'OpenAI',
  tokenUsage,
  modelInfo: null,
  totalCostUSD: null,
  error,
});

export const calculateCodexPricingFromModelInfo = (modelId, tokenUsage, modelInfo) => {
  if (!modelId) return null;
  if (!tokenUsage) return buildCodexPricingFallback(modelId, null);
  if (!modelInfo?.cost) return buildCodexPricingFallback(modelId, tokenUsage, 'Model pricing not found in models.dev API');

  const standardCost = modelInfo.cost;
  const usesLongContextPricing = !!standardCost.context_over_200k && (tokenUsage.peakContextUsage || 0) > CODEX_LONG_CONTEXT_PRICE_THRESHOLD;
  const cost = usesLongContextPricing ? { ...standardCost, ...standardCost.context_over_200k } : standardCost;

  const pricing = {
    inputPerMillion: cost.input || 0,
    outputPerMillion: cost.output || 0,
    cacheReadPerMillion: cost.cache_read || 0,
    cacheWritePerMillion: cost.cache_write ?? cost.input ?? 0,
    reasoningPerMillion: cost.reasoning || 0,
  };

  const breakdown = {
    input: toCost(tokenUsage.inputTokens || 0, pricing.inputPerMillion),
    output: toCost(tokenUsage.outputTokens || 0, pricing.outputPerMillion),
    cacheRead: toCost(tokenUsage.cacheReadTokens || 0, pricing.cacheReadPerMillion),
    cacheWrite: toCost(tokenUsage.cacheWriteTokens || 0, pricing.cacheWritePerMillion),
    reasoning: toCost(tokenUsage.reasoningTokens || 0, pricing.reasoningPerMillion),
  };
  const totalCostUSD = Object.values(breakdown).reduce((sum, value) => new Decimal(sum).plus(value).toNumber(), 0);

  tokenUsage.contextLimit = tokenUsage.contextLimit || modelInfo.limit?.context || null;
  tokenUsage.outputLimit = tokenUsage.outputLimit || modelInfo.limit?.output || null;

  return {
    modelId,
    modelName: modelInfo.name || modelId,
    provider: modelInfo.provider || 'OpenAI',
    tokenUsage,
    modelInfo,
    pricing,
    breakdown,
    totalCostUSD,
    usesLongContextPricing,
    longContextThreshold: usesLongContextPricing ? CODEX_LONG_CONTEXT_PRICE_THRESHOLD : null,
  };
};

export const calculateCodexPricing = async (modelId, tokenUsage) => {
  if (!modelId) return null;
  try {
    const modelInfo = await fetchModelInfo(modelId, { preferredProviderIds: ['openai'] });
    return calculateCodexPricingFromModelInfo(modelId, tokenUsage, modelInfo);
  } catch (error) {
    return buildCodexPricingFallback(modelId, tokenUsage, error.message);
  }
};

// Function to validate Codex CLI connection
export const validateCodexConnection = async (model = 'gpt-5.4', verbose = false) => {
  // Map model alias to full ID
  const mappedModel = mapModelToId(model);

  // Retry configuration
  const maxRetries = 3;
  let retryCount = 0;

  const attemptValidation = async () => {
    try {
      if (retryCount === 0) {
        await log('🔍 Validating Codex CLI connection...');
      } else {
        await log(`🔄 Retry attempt ${retryCount}/${maxRetries} for Codex validation...`);
      }

      // Check if Codex CLI is installed and get version
      try {
        const versionResult = await $`timeout ${Math.floor(timeouts.codexCli / 1000)} codex --version`;
        if (versionResult.code === 0) {
          const version = versionResult.stdout?.toString().trim();
          if (retryCount === 0) {
            await log(`📦 Codex CLI version: ${version}`);
          }
        }
      } catch (versionError) {
        if (retryCount === 0) {
          await log(`⚠️  Codex CLI version check failed (${versionError.code}), proceeding with connection test...`);
        }
      }

      // Test basic Codex functionality with a simple "echo hi" command
      // Using exec mode with JSON output for validation
      const testResult = await $({ env: getCodexExecEnv(verbose) })`printf "echo hi" | timeout ${Math.floor(timeouts.codexCli / 1000)} codex exec --model ${mappedModel} --json --skip-git-repo-check -c model_reasoning_effort="none" --dangerously-bypass-approvals-and-sandbox`;

      if (testResult.code !== 0) {
        const stderr = testResult.stderr?.toString() || '';
        const stdout = testResult.stdout?.toString() || '';

        // Check for authentication errors in both stderr and stdout
        // Codex CLI may return auth errors in JSON format on stdout
        if (stderr.includes('auth') || stderr.includes('login') || stdout.includes('Not logged in') || stdout.includes('401 Unauthorized')) {
          const authError = new Error('Codex authentication failed - 401 Unauthorized');
          authError.isAuthError = true;
          await log('❌ Codex authentication failed', { level: 'error' });
          await log('   💡 Please run: codex login', { level: 'error' });
          throw authError;
        }

        await log(`❌ Codex validation failed with exit code ${testResult.code}`, { level: 'error' });
        if (stderr) await log(`   Error: ${stderr.trim()}`, { level: 'error' });
        if (stdout && !stderr) await log(`   Output: ${stdout.trim()}`, { level: 'error' });
        return false;
      }

      // Success
      await log('✅ Codex CLI connection validated successfully');
      return true;
    } catch (error) {
      await log(`❌ Failed to validate Codex CLI connection: ${error.message}`, { level: 'error' });
      await log('   💡 Make sure Codex CLI is installed and accessible', { level: 'error' });
      return false;
    }
  };

  // Start the validation
  return await attemptValidation();
};

// Function to handle Codex runtime switching (if applicable)
export const handleCodexRuntimeSwitch = async () => {
  // Codex is typically run as a CLI tool, runtime switching may not be applicable
  // This function can be used for any runtime-specific configurations if needed
  await log('ℹ️  Codex runtime handling not required for this operation');
};

/** Check if Playwright MCP is available and connected to Codex @returns {Promise<boolean>} */
export const checkPlaywrightMcpAvailability = async () => {
  try {
    const result = await $`timeout 5 codex mcp list 2>&1`.catch(() => null);
    if (!result || result.code !== 0) return false;
    const output = `${result.stdout?.toString() || ''}${result.stderr?.toString() || ''}`;
    return output.toLowerCase().includes('playwright');
  } catch {
    return false;
  }
};

// Main function to execute Codex with prompts and settings
export const executeCodex = async params => {
  const { issueUrl, issueNumber, prNumber, prUrl, branchName, tempDir, workspaceTmpDir, isContinueMode, mergeStateStatus, forkedRepo, feedbackLines, forkActionsUrl, owner, repo, argv, log, formatAligned, getResourceSnapshot, codexPath = 'codex', $ } = params;

  if (argv.promptSubagentsViaAgentCommander) {
    try {
      await $`which start-agent`;
      argv.agentCommanderInstalled = true;
    } catch {
      argv.agentCommanderInstalled = false;
      await log('⚠️  agent-commander not installed; prompt guidance will be skipped (npm i -g @link-assistant/agent-commander)');
    }
  }

  // Import prompt building functions from codex.prompts.lib.mjs
  const { buildUserPrompt, buildSystemPrompt } = await import('./codex.prompts.lib.mjs');
  const { checkModelVisionCapability } = await import('./claude.lib.mjs');
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

  // Execute the Codex command
  return await executeCodexCommand({
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
    codexPath,
    $,
    owner,
    repo,
    prNumber,
  });
};

export const executeCodexCommand = async params => {
  const { tempDir, branchName, prompt, systemPrompt, argv, log, formatAligned, getResourceSnapshot, forkedRepo, feedbackLines, codexPath, $, owner, repo, prNumber } = params;

  const shellQuote = value => `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;

  // Retry configuration
  const maxRetries = 3;
  let retryCount = 0;

  const executeWithRetry = async () => {
    // Execute codex command from the cloned repository directory
    if (retryCount === 0) {
      await log(`\n${formatAligned('🤖', 'Executing Codex:', argv.model.toUpperCase())}`);
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

    let execCommand;
    const mappedModel = mapModelToId(argv.model);
    const { reasoningEffort, source: reasoningEffortSource } = resolveCodexReasoningEffort(argv);
    const isResumeMode = !!argv.resume;
    const codexEnv = getCodexExecEnv(argv.verbose);

    // For Codex, we combine system and user prompts into a single message
    // Codex doesn't have separate system prompt support in CLI mode
    const combinedPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;

    // Write the combined prompt to a file for piping
    // Use OS temporary directory instead of repository workspace to avoid polluting the repo
    const promptFile = path.join(os.tmpdir(), `codex_prompt_${Date.now()}_${process.pid}.txt`);
    const lastMessageFile = path.join(os.tmpdir(), `codex_last_message_${Date.now()}_${process.pid}.txt`);
    await fs.writeFile(promptFile, combinedPrompt);

    await log(`   Resolved model ID: ${mappedModel}`, { verbose: true });
    await log(`   Execution mode: ${isResumeMode ? 'resume' : 'new exec'}`, { verbose: true });
    await log(`   Prompt file: ${promptFile}`, { verbose: true });
    await log(`   Last message file: ${lastMessageFile}`, { verbose: true });
    if (argv.verbose && codexEnv.RUST_LOG) {
      await log(`   Codex debug env: RUST_LOG=${codexEnv.RUST_LOG}`, { verbose: true });
    }

    // Build codex command arguments once so the logged command matches the executed command.
    let codexArgs = 'exec';
    if (isResumeMode) {
      await log(`🔄 Resuming from session: ${argv.resume}`);
      codexArgs += ` resume ${shellQuote(argv.resume)}`;
    } else {
      codexArgs += ` --model ${shellQuote(mappedModel)}`;
    }
    const codexPlaywrightMcpDisableConfigArgs = argv.playwrightMcp === false ? await getCodexPlaywrightMcpDisableConfigArgs(log) : [];
    for (const arg of codexPlaywrightMcpDisableConfigArgs) {
      codexArgs += ` ${shellQuote(arg)}`;
    }
    codexArgs += ` --json --skip-git-repo-check -o ${shellQuote(lastMessageFile)} -c ${shellQuote(`model_reasoning_effort=${reasoningEffort}`)} -c ${shellQuote('model_reasoning_summary=auto')} --dangerously-bypass-approvals-and-sandbox`;

    const fullCommand = `(cd ${shellQuote(tempDir)} && cat ${shellQuote(promptFile)} | ${codexPath} ${codexArgs})`;

    await log(`\n${formatAligned('📝', 'Raw command:', '')}`);
    await log(`${fullCommand}`);
    await log('');

    try {
      let interactiveHandler = null;
      if (argv.interactiveMode && owner && repo && prNumber) {
        await log('🔌 Interactive mode: Creating handler for real-time PR comments', { verbose: true });
        interactiveHandler = createInteractiveHandler({ owner, repo, prNumber, $, log, verbose: argv.verbose });
      } else if (argv.interactiveMode) {
        await log('⚠️ Interactive mode: Disabled - missing PR info (owner/repo/prNumber)', { verbose: true });
      }
      const progressMonitor = await initProgressMonitoring(argv, { owner, repo, prNumber, $, log });

      execCommand = $({
        cwd: tempDir,
        mirror: false,
        env: codexEnv,
      })`sh -lc ${fullCommand}`;

      await log(`${formatAligned('📋', 'Command details:', '')}`);
      await log(formatAligned('📂', 'Working directory:', tempDir, 2));
      await log(formatAligned('🌿', 'Branch:', branchName, 2));
      await log(formatAligned('🤖', 'Model:', `Codex ${argv.model.toUpperCase()}`, 2));
      await log(formatAligned('🧠', 'Reasoning effort:', `${reasoningEffort} (${reasoningEffortSource})`, 2));
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
      let authError = false;
      let codexJsonState = {
        sessionId: null,
        authError: false,
        resultSummary: '',
        tokenUsage: createCodexTokenUsage(mappedModel),
        eventCounts: {},
        itemTypeCounts: {},
        subAgentCalls: [],
        reasoningSummaries: [],
        commandExecutions: [],
        fileChanges: [],
        mcpToolCalls: [],
        webSearches: [],
        todoLists: [],
        itemErrors: [],
        turnFailures: [],
        streamErrors: [],
        observedUsageFieldSets: [],
        observedModelDiagnosticPaths: [],
      };

      for await (const chunk of execCommand.stream()) {
        if (chunk.type === 'stdout') {
          const output = chunk.data.toString();
          if (argv.verbose) {
            await log(output);
          }
          lastMessage = output;

          codexJsonState = parseCodexExecJsonOutput(output, codexJsonState, mappedModel);

          if (interactiveHandler || progressMonitor) {
            for (const rawLine of output.split('\n')) {
              const line = rawLine.trim();
              if (!line) continue;
              try {
                const data = sanitizeObjectStrings(JSON.parse(line));
                if (interactiveHandler) await interactiveHandler.processEvent(data);
                if (progressMonitor) await progressMonitor.processStreamEvent(data);
              } catch {
                // Ignore non-JSON lines
              }
            }
          }

          if (codexJsonState.sessionId && codexJsonState.sessionId !== sessionId) {
            sessionId = codexJsonState.sessionId;
            await log(`📌 Session ID: ${sessionId}`);
          }

          if (codexJsonState.resultSummary) {
            lastTextContent = codexJsonState.resultSummary;
          }

          if (codexJsonState.authError && !authError) {
            authError = true;
            await log('\n❌ Authentication error detected in Codex JSON stream', { level: 'error' });
            await log('   This error cannot be resolved by retrying.', { level: 'error' });
            await log('   💡 Please run: codex login', { level: 'error' });
          }
        }

        if (chunk.type === 'stderr') {
          const errorOutput = chunk.data.toString();
          if (errorOutput && argv.verbose) {
            await log(errorOutput, { stream: 'stderr' });
          }
        } else if (chunk.type === 'exit') {
          exitCode = chunk.code;
        }
      }

      if (interactiveHandler) {
        await interactiveHandler.flush();
      }

      try {
        const lastMessageFromFile = (await fs.readFile(lastMessageFile, 'utf8')).trim();
        if (lastMessageFromFile) {
          await log(`📝 Final Codex message captured in ${lastMessageFile}`, { verbose: true });
          await log(lastMessageFromFile, { verbose: true });
          lastTextContent = lastTextContent || lastMessageFromFile;
        } else {
          await log(`⚠️ Final Codex message file was empty: ${lastMessageFile}`, { level: 'warning', verbose: true });
        }
      } catch (readError) {
        await log(`⚠️ Could not read Codex final message file: ${readError.message}`, { level: 'warning', verbose: true });
      }

      if (Object.keys(codexJsonState.eventCounts).length > 0) {
        const eventSummary = Object.entries(codexJsonState.eventCounts)
          .map(([eventType, count]) => `${eventType}=${count}`)
          .join(', ');
        await log(`📊 Codex JSON events: ${eventSummary}`, { verbose: true });
      }
      if (Object.keys(codexJsonState.itemTypeCounts).length > 0) {
        const itemSummary = Object.entries(codexJsonState.itemTypeCounts)
          .map(([itemType, count]) => `${itemType}=${count}`)
          .join(', ');
        await log(`📦 Codex item types: ${itemSummary}`, { verbose: true });
      }
      if (codexJsonState.tokenUsage.stepCount > 0) {
        await log(`📈 Codex usage from turn.completed: ${codexJsonState.tokenUsage.inputTokens.toLocaleString()} input, ${codexJsonState.tokenUsage.cacheReadTokens.toLocaleString()} cache read, ${codexJsonState.tokenUsage.outputTokens.toLocaleString()} output across ${codexJsonState.tokenUsage.stepCount} turn(s)`, { verbose: true });
      } else {
        await log('📈 No Codex usage found in turn.completed events', { level: 'warning', verbose: true });
      }
      if (codexJsonState.subAgentCalls.length > 0) {
        await log(`🤝 Codex collab/sub-agent calls observed: ${codexJsonState.subAgentCalls.length}`, { verbose: true });
      }
      if (codexJsonState.reasoningSummaries.length > 0) {
        await log(`🧠 Codex reasoning summaries observed: ${codexJsonState.reasoningSummaries.length}`, { verbose: true });
      }
      if (codexJsonState.commandExecutions.length > 0) {
        await log(`💻 Codex command executions observed: ${codexJsonState.commandExecutions.length}`, { verbose: true });
      }
      if (codexJsonState.fileChanges.length > 0) {
        await log(`📝 Codex file change items observed: ${codexJsonState.fileChanges.length}`, { verbose: true });
      }
      if (codexJsonState.mcpToolCalls.length > 0) {
        await log(`🔌 Codex MCP tool calls observed: ${codexJsonState.mcpToolCalls.length}`, { verbose: true });
      }
      if (codexJsonState.webSearches.length > 0) {
        await log(`🌐 Codex web searches observed: ${codexJsonState.webSearches.length}`, { verbose: true });
      }
      if (codexJsonState.todoLists.length > 0) {
        const latestTodoCount = codexJsonState.todoLists.at(-1)?.items?.length || 0;
        await log(`📋 Codex todo list updates observed: ${codexJsonState.todoLists.length} (latest: ${latestTodoCount} items)`, { verbose: true });
      }
      if (codexJsonState.itemErrors.length > 0 || codexJsonState.turnFailures.length > 0 || codexJsonState.streamErrors.length > 0) {
        await log(`⚠️ Codex error events observed: item=${codexJsonState.itemErrors.length}, turn=${codexJsonState.turnFailures.length}, stream=${codexJsonState.streamErrors.length}`, { verbose: true });
      }
      if (codexJsonState.observedUsageFieldSets.length > 0) {
        const lastUsageFieldSet = codexJsonState.observedUsageFieldSets.at(-1);
        await log(`📐 Codex usage fields observed: ${lastUsageFieldSet.join(', ')}`, { verbose: true });
      }
      if (codexJsonState.observedModelDiagnosticPaths.length > 0) {
        await log(`🔎 Undocumented model-related JSON fields observed but ignored for accounting: ${codexJsonState.observedModelDiagnosticPaths.join(', ')}`, { verbose: true });
      } else {
        await log(`🤖 Codex exec JSON did not expose model IDs; using requested model for reporting: ${mappedModel}`, { verbose: true });
      }

      const firstActualModelId = mappedModel;
      const pricingInfo = firstActualModelId ? await calculateCodexPricing(firstActualModelId, codexJsonState.tokenUsage.stepCount > 0 ? codexJsonState.tokenUsage : null) : null;
      if (pricingInfo?.totalCostUSD !== null && pricingInfo?.totalCostUSD !== undefined) {
        await log(`💰 Codex public pricing estimate: $${new Decimal(pricingInfo.totalCostUSD).toFixed(6)}`, { verbose: true });
        if (pricingInfo.usesLongContextPricing) {
          await log(`   Long-context pricing applied because peak prompt exceeded ${pricingInfo.longContextThreshold.toLocaleString()} input tokens`, { verbose: true });
        }
      } else if (pricingInfo?.error) {
        await log(`⚠️ Codex public pricing estimate unavailable: ${pricingInfo.error}`, { level: 'warning', verbose: true });
      }
      const resultModelUsage = pricingInfo?.tokenUsage ? buildCodexResultModelUsage(firstActualModelId, pricingInfo.tokenUsage, pricingInfo) : null;

      // Check for authentication errors first - these should never be retried
      if (authError) {
        const resourcesAfter = await getResourceSnapshot();
        await log('\n📈 System resources after execution:', { verbose: true });
        await log(`   Memory: ${resourcesAfter.memory.split('\n')[1]}`, { verbose: true });
        await log(`   Load: ${resourcesAfter.load}`, { verbose: true });

        // Throw an error to stop retries and propagate the auth failure
        const error = new Error('Codex authentication failed - 401 Unauthorized. Please run: codex login');
        error.isAuthError = true;
        throw error;
      }

      if (exitCode !== 0) {
        // Check for usage limit errors first (more specific)
        const limitInfo = detectUsageLimit(lastMessage);
        if (limitInfo.isUsageLimit) {
          limitReached = true;
          limitResetTime = limitInfo.resetTime;

          // Format and display user-friendly message
          const messageLines = formatUsageLimitMessage({
            tool: 'OpenAI Codex',
            resetTime: limitInfo.resetTime,
            sessionId,
            resumeCommand: sessionId ? `${process.argv[0]} ${process.argv[1]} ${argv.url} --resume ${sessionId}` : null,
          });

          for (const line of messageLines) {
            await log(line, { level: 'warning' });
          }
        } else if (exitCode === 130) {
          await log('\n\n⚠️ Codex command interrupted (CTRL+C)');
        } else {
          await log(`\n\n❌ Codex command failed with exit code ${exitCode}`, { level: 'error' });
        }

        const resourcesAfter = await getResourceSnapshot();
        await log('\n📈 System resources after execution:', { verbose: true });
        await log(`   Memory: ${resourcesAfter.memory.split('\n')[1]}`, { verbose: true });
        await log(`   Load: ${resourcesAfter.load}`, { verbose: true });

        return {
          success: false,
          sessionId,
          limitReached,
          limitResetTime,
          pricingInfo,
          publicPricingEstimate: pricingInfo?.totalCostUSD ?? null,
          resultModelUsage,
          subAgentCalls: codexJsonState.subAgentCalls.length > 0 ? codexJsonState.subAgentCalls : null,
          codexJsonDetails: codexJsonState,
          resultSummary: lastTextContent || null, // Issue #1263: Use last text content from JSON output stream
        };
      }

      await log('\n\n✅ Codex command completed');

      // Issue #1263: Log if result summary was captured
      if (lastTextContent) {
        await log('📝 Captured result summary from Codex output', { verbose: true });
      } else {
        await log('⚠️ No result summary captured from Codex output or last-message file', { level: 'warning', verbose: true });
      }

      return {
        success: true,
        sessionId,
        limitReached,
        limitResetTime,
        pricingInfo,
        publicPricingEstimate: pricingInfo?.totalCostUSD ?? null,
        resultModelUsage,
        subAgentCalls: codexJsonState.subAgentCalls.length > 0 ? codexJsonState.subAgentCalls : null,
        codexJsonDetails: codexJsonState,
        resultSummary: lastTextContent || null, // Issue #1263: Use last text content from JSON output stream
      };
    } catch (error) {
      // Don't report auth errors to Sentry as they are user configuration issues
      if (!error.isAuthError) {
        reportError(error, {
          context: 'execute_codex',
          command: params.command,
          codexPath: params.codexPath,
          operation: 'run_codex_command',
        });
      }

      await log(`\n\n❌ Error executing Codex command: ${error.message}`, { level: 'error' });

      // Re-throw auth errors to stop any outer retry loops
      if (error.isAuthError) {
        throw error;
      }

      return {
        success: false,
        sessionId: null,
        limitReached: false,
        limitResetTime: null,
        pricingInfo: null,
        publicPricingEstimate: null,
        resultSummary: null, // Issue #1263: No result summary available on error
      };
    } finally {
      await log(`🧹 Removing temporary Codex prompt file: ${promptFile}`, { verbose: true });
      await fs.rm(promptFile, { force: true }).catch(() => {});
      await log(`🧹 Removing temporary Codex last-message file: ${lastMessageFile}`, { verbose: true });
      await fs.rm(lastMessageFile, { force: true }).catch(() => {});
    }
  };

  // Start the execution with retry logic
  return await executeWithRetry();
};

export const checkForUncommittedChanges = async (tempDir, owner, repo, branchName, $, log, autoCommit = false, autoRestartEnabled = true) => {
  // Similar to Claude and OpenCode version, check for uncommitted changes
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
            const commitMessage = 'Auto-commit: Changes made by Codex during problem-solving session';
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
          await log('   Codex made changes that were not committed.');
          await log('');
          await log('🔄 AUTO-RESTART: Restarting Codex to handle uncommitted changes...');
          await log('   Codex will review the changes and decide what to commit.');
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
      context: 'check_uncommitted_changes_codex',
      tempDir,
      operation: 'git_status_check',
    });
    await log(`⚠️ Warning: Error checking for uncommitted changes: ${gitError.message}`, { level: 'warning' });
    return false;
  }
};

// Export all functions as default object too
export default {
  validateCodexConnection,
  handleCodexRuntimeSwitch,
  checkPlaywrightMcpAvailability,
  executeCodex,
  executeCodexCommand,
  resolveCodexReasoningEffort,
  checkForUncommittedChanges,
};
