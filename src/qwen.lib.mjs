#!/usr/bin/env node
import { ensureUseM } from './use-m-bootstrap.lib.mjs';
// Qwen Code CLI-related utility functions

// Check if use is already defined (when imported from solve.mjs)
// If not, fetch it (when running standalone)
if (typeof globalThis.use === 'undefined') {
  await ensureUseM();
}

const { $: __rawDollar$ } = await use('command-stream');
// Issue #2168: retry transient git network failures (push/fetch/pull) the same
// way `gh` calls are retried, for every command run through this module's `$`.
const { wrapDollarWithGitRetry } = await import('./git-retry.lib.mjs');
const $ = wrapDollarWithGitRetry(__rawDollar$);
const fs = (await use('fs')).promises;
const path = (await use('path')).default;
const os = (await use('os')).default;

import { log, buildToolErrorMessage } from './lib.mjs';
import { reportError } from './sentry.lib.mjs';
import { timeouts, retryLimits } from './config.lib.mjs';
import { detectUsageLimit, formatUsageLimitMessage } from './usage-limit.lib.mjs';
import { sanitizeObjectStrings } from './unicode-sanitization.lib.mjs';
import { qwenModels, defaultModels, isFormalAiModel } from './models/index.mjs';
import { buildFormalAiEnvExports, isPrepareOnly, logPreparedToolCommand, resolveFormalAiToolExecution } from './formal-ai.lib.mjs';
import { buildFormalAiPricingInfo } from './formal-ai-pricing.lib.mjs'; // Issue #2119
import { checkPlaywrightMcpPackageAvailability } from './playwright-mcp.lib.mjs';
import { classifyRetryableError, createTransientRetryBudget, prepareRetryAfterError, waitWithCountdown } from './tool-retry.lib.mjs';
import { getCumulativeContextInputTokens, getRestoredContextInputTokens, toTokenCount } from './context-fill.lib.mjs';
import { ensureAiToolScratchIgnored, filterAiToolScratchFromStatus } from './ai-tool-scratch.lib.mjs';
import { getTerminalEventCompletionHealth } from './tool-run-health.lib.mjs'; // Issue #1990
import { takeJsonRecords } from './json-stream.lib.mjs'; // Issue #2119
import { stringifyErrorValue } from './error-text.lib.mjs'; // Issue #2141

export const mapModelToId = model => qwenModels[model] || model;

export const checkPlaywrightMcpAvailability = checkPlaywrightMcpPackageAvailability;

const shellQuote = value => `'${String(value).replace(/'/g, "'\\''")}'`;

const getCommandResultOutput = result => `${result?.stdout?.toString() || ''}${result?.stderr?.toString() || ''}`;

const isQwenAuthError = output => {
  const text = (output || '').toString().toLowerCase();
  return text.includes('401') || text.includes('unauthorized') || text.includes('authentication') || text.includes('auth') || text.includes('login') || text.includes('api key') || text.includes('oauth free tier');
};

const getNestedValue = (object, pathParts) => {
  let cursor = object;
  for (const part of pathParts) {
    if (!cursor || typeof cursor !== 'object') return undefined;
    cursor = cursor[part];
  }
  return cursor;
};

const findFirstValue = (object, paths) => {
  for (const pathParts of paths) {
    const value = getNestedValue(object, pathParts);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
};

const createQwenTokenFieldAvailability = () => ({
  inputTokens: false,
  outputTokens: false,
  reasoningTokens: false,
  cacheReadTokens: false,
  cacheWriteTokens: false,
});

const createQwenTokenUsage = modelId => ({
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 0,
  stepCount: 0,
  requestedModelId: modelId || null,
  respondedModelId: modelId || null,
  contextLimit: null,
  outputLimit: null,
  contextFillInputTokens: 0,
  peakContextUsage: 0,
  tokenFieldAvailability: createQwenTokenFieldAvailability(),
});

const cloneQwenTokenUsage = usage => {
  if (!usage) return createQwenTokenUsage();
  return {
    ...usage,
    tokenFieldAvailability: {
      ...createQwenTokenFieldAvailability(),
      ...(usage.tokenFieldAvailability || {}),
    },
  };
};

const getQwenUsageField = (usage, paths) => {
  const value = findFirstValue(usage, paths);
  if (value === null) return { observed: false, value: 0 };
  return { observed: true, value: toTokenCount(value) };
};

const QWEN_USAGE_PATHS = {
  input: [['inputTokens'], ['input_tokens'], ['input'], ['promptTokens'], ['prompt_tokens'], ['prompt']],
  output: [['outputTokens'], ['output_tokens'], ['output'], ['completionTokens'], ['completion_tokens'], ['completion']],
  reasoning: [['reasoningTokens'], ['reasoning_tokens'], ['thoughtsTokens'], ['thoughts_tokens']],
  cacheRead: [['cacheReadTokens'], ['cache_read_tokens'], ['cache_read_input_tokens'], ['cachedInputTokens'], ['cached_input_tokens'], ['prompt_tokens_details', 'cached_tokens'], ['cache', 'read']],
  cacheWrite: [['cacheWriteTokens'], ['cache_write_tokens'], ['cache_creation_input_tokens'], ['cacheCreationTokens'], ['cacheCreationInputTokens'], ['cache', 'write']],
  contextLimit: [['contextLimit'], ['context_limit'], ['limit', 'context'], ['limits', 'context']],
  outputLimit: [['outputLimit'], ['output_limit'], ['limit', 'output'], ['limits', 'output']],
  model: [['model'], ['model_id'], ['modelId'], ['name']],
};

const extractTextFragments = value => {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];

  if (Array.isArray(value)) {
    return value.flatMap(item => extractTextFragments(item));
  }

  const fragments = [];
  for (const key of ['text', 'result', 'response', 'content']) {
    if (Object.hasOwn(value, key)) {
      fragments.push(...extractTextFragments(value[key]));
    }
  }
  if (value.message) fragments.push(...extractTextFragments(value.message));
  return fragments.filter(Boolean);
};

const createQwenParserState = state => ({
  buffer: state?.buffer || '',
  // Issue #2136: stderr is framed independently of stdout — mixing the two into
  // one buffer would splice half of a stdout record onto a stderr line.
  telemetryBuffer: state?.telemetryBuffer || '',
  telemetryEventCounts: { ...(state?.telemetryEventCounts || {}) },
  plainText: state?.plainText || '',
  parsedEvents: Array.isArray(state?.parsedEvents) ? [...state.parsedEvents] : [],
  eventCounts: { ...(state?.eventCounts || {}) },
  errors: Array.isArray(state?.errors) ? [...state.errors] : [],
  sessionId: state?.sessionId || null,
  lastTextContent: state?.lastTextContent || '',
  tokenUsage: cloneQwenTokenUsage(state?.tokenUsage),
  resultModelUsage: state?.resultModelUsage ? { ...state.resultModelUsage } : null,
});

const buildQwenResultModelUsage = tokenUsage => {
  if (!tokenUsage || tokenUsage.stepCount === 0) return null;
  const modelId = tokenUsage.respondedModelId || tokenUsage.requestedModelId || 'qwen';
  const modelInfo = tokenUsage.contextLimit || tokenUsage.outputLimit ? { limit: { context: tokenUsage.contextLimit || null, output: tokenUsage.outputLimit || null } } : null;
  return {
    [modelId]: {
      inputTokens: tokenUsage.inputTokens,
      cacheCreationTokens: tokenUsage.cacheWriteTokens,
      cacheReadTokens: tokenUsage.cacheReadTokens,
      outputTokens: tokenUsage.outputTokens,
      modelName: modelId,
      modelInfo,
      contextFillInputTokens: tokenUsage.contextFillInputTokens,
      peakContextUsage: tokenUsage.peakContextUsage,
      costUSD: null,
    },
  };
};

const applyQwenUsageObject = (state, rawUsage, fallbackModelId = null) => {
  if (!rawUsage || typeof rawUsage !== 'object') return;

  const model = findFirstValue(rawUsage, QWEN_USAGE_PATHS.model) || fallbackModelId;
  if (model) {
    state.tokenUsage.requestedModelId ||= String(model);
    state.tokenUsage.respondedModelId = String(model);
  }

  const input = getQwenUsageField(rawUsage, QWEN_USAGE_PATHS.input);
  const output = getQwenUsageField(rawUsage, QWEN_USAGE_PATHS.output);
  const reasoning = getQwenUsageField(rawUsage, QWEN_USAGE_PATHS.reasoning);
  const cacheRead = getQwenUsageField(rawUsage, QWEN_USAGE_PATHS.cacheRead);
  const cacheWrite = getQwenUsageField(rawUsage, QWEN_USAGE_PATHS.cacheWrite);
  const contextLimit = getQwenUsageField(rawUsage, QWEN_USAGE_PATHS.contextLimit);
  const outputLimit = getQwenUsageField(rawUsage, QWEN_USAGE_PATHS.outputLimit);

  const observedTokenField = input.observed || output.observed || reasoning.observed || cacheRead.observed || cacheWrite.observed;
  if (!observedTokenField) return;

  state.tokenUsage.stepCount += 1;
  if (input.observed) {
    state.tokenUsage.tokenFieldAvailability.inputTokens = true;
    state.tokenUsage.inputTokens += input.value;
  }
  if (output.observed) {
    state.tokenUsage.tokenFieldAvailability.outputTokens = true;
    state.tokenUsage.outputTokens += output.value;
  }
  if (reasoning.observed) {
    state.tokenUsage.tokenFieldAvailability.reasoningTokens = true;
    state.tokenUsage.reasoningTokens += reasoning.value;
  }
  if (cacheRead.observed) {
    state.tokenUsage.tokenFieldAvailability.cacheReadTokens = true;
    state.tokenUsage.cacheReadTokens += cacheRead.value;
  }
  if (cacheWrite.observed) {
    state.tokenUsage.tokenFieldAvailability.cacheWriteTokens = true;
    state.tokenUsage.cacheWriteTokens += cacheWrite.value;
  }
  if (contextLimit.observed) state.tokenUsage.contextLimit = contextLimit.value;
  if (outputLimit.observed) state.tokenUsage.outputLimit = outputLimit.value;

  const stepContextFill = getCumulativeContextInputTokens({
    inputTokens: input.value,
    cacheWriteTokens: cacheWrite.value,
  });
  if (stepContextFill > (state.tokenUsage.contextFillInputTokens || 0)) {
    state.tokenUsage.contextFillInputTokens = stepContextFill;
  }

  const stepRestoredContext = getRestoredContextInputTokens({
    inputTokens: input.value,
    cacheWriteTokens: cacheWrite.value,
    cacheReadTokens: cacheRead.value,
  });
  if (stepRestoredContext > (state.tokenUsage.peakContextUsage || 0)) {
    state.tokenUsage.peakContextUsage = stepRestoredContext;
  }

  state.tokenUsage.totalTokens = state.tokenUsage.inputTokens + state.tokenUsage.cacheReadTokens + state.tokenUsage.cacheWriteTokens + state.tokenUsage.outputTokens;
  state.resultModelUsage = buildQwenResultModelUsage(state.tokenUsage);
};

const applyQwenUsageToState = (state, event) => {
  const rawUsage = event?.usage || event?.stats || event?.tokenUsage || null;
  if (!rawUsage || typeof rawUsage !== 'object') return;

  const modelStats = rawUsage.models && typeof rawUsage.models === 'object' ? rawUsage.models : null;
  if (modelStats) {
    for (const [modelId, data] of Object.entries(modelStats)) {
      applyQwenUsageObject(state, data?.tokens || data?.usage || data, modelId);
    }
    return;
  }

  applyQwenUsageObject(state, rawUsage, findFirstValue(event, QWEN_USAGE_PATHS.model));
};

export const buildQwenPricingInfo = (state, mappedModel) => {
  const tokenUsage = cloneQwenTokenUsage(state?.tokenUsage);
  if (!tokenUsage || tokenUsage.stepCount === 0) {
    return {
      pricingInfo: null,
      publicPricingEstimate: null,
      tokenUsage: null,
      resultModelUsage: null,
    };
  }

  tokenUsage.requestedModelId ||= mappedModel || 'qwen';
  tokenUsage.respondedModelId ||= tokenUsage.requestedModelId;
  const modelId = tokenUsage.respondedModelId || tokenUsage.requestedModelId;

  // Issue #2119: `--model formal-ai` is served by the local Link.Assistant model
  // server, so the session belongs to Link.Assistant at $0.00 - not to Qwen Code.
  if (isFormalAiModel(mappedModel) || isFormalAiModel(modelId)) {
    return {
      pricingInfo: { ...buildFormalAiPricingInfo(modelId, tokenUsage), source: 'qwen-stream-json' },
      publicPricingEstimate: 0,
      tokenUsage,
      resultModelUsage: buildQwenResultModelUsage(tokenUsage),
    };
  }

  return {
    pricingInfo: {
      provider: 'Qwen Code',
      modelId,
      modelName: modelId,
      totalCostUSD: null,
      source: 'qwen-stream-json',
      tokenUsage,
    },
    publicPricingEstimate: null,
    tokenUsage,
    resultModelUsage: buildQwenResultModelUsage(tokenUsage),
  };
};

const addQwenEventToState = (state, rawEvent) => {
  const event = sanitizeObjectStrings(rawEvent);
  state.parsedEvents.push(event);

  const eventType = event?.type || event?.event || 'unknown';
  state.eventCounts[eventType] = (state.eventCounts[eventType] || 0) + 1;

  const sessionId = findFirstValue(event, [['session_id'], ['sessionId'], ['thread_id'], ['threadId'], ['conversation_id'], ['conversationId'], ['session', 'id'], ['message', 'session_id'], ['message', 'sessionId']]);
  if (sessionId) state.sessionId = String(sessionId);

  const isErrorEvent = eventType === 'error' || event?.subtype === 'error' || event?.is_error === true || event?.error;
  if (!isErrorEvent) {
    const textFragments = extractTextFragments(event);
    if (textFragments.length > 0) {
      state.lastTextContent = textFragments[textFragments.length - 1];
    }
  }

  if (isErrorEvent) {
    const errorMessage = stringifyErrorValue(event?.error || event?.message || event?.result || event);
    state.errors.push({
      type: eventType,
      subtype: event?.subtype || null,
      message: errorMessage || 'Qwen Code emitted an error event',
      isAuthError: isQwenAuthError(errorMessage),
    });
  }

  applyQwenUsageToState(state, event);
};

// Issue #2136: qwen-code writes its stream-json protocol to stdout; stderr is
// human/diagnostic text. Feeding stderr through the protocol parser made every
// JSON object a CLI happened to print there — including output a task's own
// commands echoed back — a genuine qwen event, which could invent an `errors`
// entry (an instant run failure), hijack the session id, add phantom token usage
// or satisfy the #1990 terminal-event gate. Codex was bitten by exactly this
// (see docs/case-studies/issue-2136), so qwen now marks non-stdout records as
// telemetry: they are counted for diagnostics and otherwise ignored. Plain-text
// stderr signals are unaffected — auth/usage-limit/retry classification still
// reads the raw combined output.
export const parseQwenStreamJsonOutput = (output, state = {}, { source = 'stdout' } = {}) => {
  const nextState = createQwenParserState(state);
  const text = output?.toString?.() ?? String(output || '');
  nextState.plainText += text;

  const isProtocolStream = source === 'stdout';

  // Issue #2119: frame the stream by balanced JSON values instead of by lines.
  // `formal-ai with qwen` emits pretty-printed, multi-line records, so every
  // line failed to parse and every event - including the token usage - was
  // dropped. Scanning for balanced values also covers records concatenated
  // without a separator and records split across two process chunks.
  const pendingBuffer = isProtocolStream ? nextState.buffer : nextState.telemetryBuffer;
  const { records, rest } = takeJsonRecords(`${pendingBuffer}${text}`);
  if (isProtocolStream) {
    nextState.buffer = rest;
  } else {
    nextState.telemetryBuffer = rest;
  }

  for (const record of records) {
    const items = Array.isArray(record) ? record : [record];
    for (const item of items) {
      if (isProtocolStream) {
        addQwenEventToState(nextState, item);
        continue;
      }
      const eventType = item?.type || item?.event || 'unknown';
      nextState.telemetryEventCounts[eventType] = (nextState.telemetryEventCounts[eventType] || 0) + 1;
    }
  }

  return nextState;
};

// Function to validate Qwen connection
export const validateQwenConnection = async (model = defaultModels.qwen, qwenPath = process.env.QWEN_PATH || 'qwen') => {
  const mappedModel = mapModelToId(model);

  try {
    await log('🔍 Validating Qwen Code connection...');

    try {
      const versionResult = await $`timeout ${Math.floor(timeouts.qwenCli / 1000)} ${qwenPath} --version`;
      if (versionResult.code === 0) {
        const version = versionResult.stdout?.toString().trim();
        await log(`📦 Qwen Code CLI version: ${version}`);
      }
    } catch (versionError) {
      await log(`⚠️  Qwen Code version check failed (${versionError.code}), proceeding with connection test...`, { level: 'warning' });
    }

    const testResult = await $`timeout ${Math.floor(timeouts.qwenCli / 1000)} ${qwenPath} --prompt ${'Respond with exactly: hi'} --model ${mappedModel} --output-format json --yolo`;
    const output = getCommandResultOutput(testResult);

    if (testResult.code !== 0) {
      if (isQwenAuthError(output)) {
        await log('❌ Qwen Code authentication failed', { level: 'error' });
        await log('   💡 Run: qwen auth', { level: 'error' });
        return false;
      }

      await log(`❌ Qwen Code validation failed with exit code ${testResult.code}`, { level: 'error' });
      if (output.trim()) await log(`   Error: ${output.trim()}`, { level: 'error' });
      return false;
    }

    const parsed = parseQwenStreamJsonOutput(output);
    if (parsed.errors.some(error => error.isAuthError)) {
      await log('❌ Qwen Code authentication failed', { level: 'error' });
      await log('   💡 Run: qwen auth', { level: 'error' });
      return false;
    }

    await log('✅ Qwen Code connection validated successfully');
    return true;
  } catch (error) {
    await log(`❌ Failed to validate Qwen Code connection: ${error.message}`, { level: 'error' });
    await log('   💡 Make sure Qwen Code is installed and accessible as qwen', { level: 'error' });
    return false;
  }
};

// Main function to execute Qwen Code with prompts and settings
export const executeQwen = async params => {
  const { issueUrl, issueNumber, prNumber, prUrl, branchName, tempDir, workspaceTmpDir, isContinueMode, mergeStateStatus, forkedRepo, feedbackLines, forkActionsUrl, owner, repo, argv, log, setLogFile, getLogFile, formatAligned, getResourceSnapshot, qwenPath = 'qwen', $ } = params;

  const { buildUserPrompt, buildSystemPrompt } = await import('./qwen.prompts.lib.mjs');

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
  });

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

  return await executeQwenCommand({
    tempDir,
    branchName,
    prompt,
    systemPrompt,
    argv,
    log,
    setLogFile,
    getLogFile,
    formatAligned,
    getResourceSnapshot,
    forkedRepo,
    feedbackLines,
    qwenPath,
    $,
  });
};

export const executeQwenCommand = async params => {
  const { tempDir, branchName, prompt, systemPrompt, argv, log, formatAligned = (_icon, label, value = '') => `${label} ${value}`.trim(), getResourceSnapshot = async () => ({ memory: '\nunknown', load: 'unknown' }), forkedRepo, feedbackLines, qwenPath = 'qwen', $: dollar = $, waitForRetryDelay = waitWithCountdown } = params;

  let retryCount = 0;
  // Issue #2169: retries are bounded by a wall-clock budget (12 h by default, configurable via
  // HIVE_MIND_TRANSIENT_ERROR_RETRY_BUDGET_MS) instead of a low attempt count.
  const transientRetryBudget = createTransientRetryBudget();
  const promptFile = path.join(os.tmpdir(), `qwen_prompt_${Date.now()}_${process.pid}.txt`);
  const systemPromptFile = path.join(os.tmpdir(), `qwen_system_prompt_${Date.now()}_${process.pid}.txt`);

  await fs.writeFile(promptFile, prompt);
  await fs.writeFile(systemPromptFile, systemPrompt || '');

  const executeWithRetry = async () => {
    if (retryCount === 0) {
      await log(`\n${formatAligned('🤖', 'Executing Qwen Code:', argv.model.toUpperCase())}`);
    } else {
      await log(`\n${formatAligned('🔄', 'Retry attempt:', `${retryCount} (${transientRetryBudget.describeProgress()})`)}`);
    }

    if (argv.verbose) {
      await log(`   Model: ${argv.model}`, { verbose: true });
      await log(`   Working directory: ${tempDir}`, { verbose: true });
      await log(`   Branch: ${branchName}`, { verbose: true });
      await log(`   Prompt length: ${prompt.length} chars`, { verbose: true });
      await log(`   System prompt length: ${systemPrompt?.length || 0} chars`, { verbose: true });
      await log(`   Feedback info included: ${feedbackLines && feedbackLines.length > 0 ? `Yes (${feedbackLines.length} lines)` : 'No'}`, { verbose: true });
    }

    const resourcesBefore = await getResourceSnapshot();
    await log('📈 System resources before execution:', { verbose: true });
    await log(`   Memory: ${resourcesBefore.memory.split('\n')[1] || resourcesBefore.memory}`, { verbose: true });
    await log(`   Load: ${resourcesBefore.load}`, { verbose: true });

    const mappedModel = mapModelToId(argv.model || defaultModels.qwen);
    // Issue #2130: Formal AI runs the native CLI against a local Formal AI server (no argv wrapper).
    const toolInvocation = await resolveFormalAiToolExecution({ tool: 'qwen', model: argv.model || defaultModels.qwen, toolPath: qwenPath, workdir: tempDir, log, verbose: argv.verbose, prepareOnly: isPrepareOnly(argv) });
    const qwenEnv = { ...process.env, ...toolInvocation.env };
    const resumeSession = argv.resume || null;
    const resumeArgs = resumeSession ? ` --resume ${shellQuote(resumeSession)}` : '';
    const appendSystemPromptArg = systemPrompt ? ` --append-system-prompt "$(cat ${shellQuote(systemPromptFile)})"` : '';
    // Issue #2130: re-export the Formal AI environment inside the `sh -lc` script so a
    // stale `formal-ai with --global` block in the operator profile cannot override it.
    const commandScript = `${buildFormalAiEnvExports(toolInvocation.env)}cd ${shellQuote(tempDir)} && ${toolInvocation.displayCommand} --model ${shellQuote(mappedModel)} --output-format stream-json --yolo${resumeArgs}${appendSystemPromptArg} --prompt "$(cat ${shellQuote(promptFile)})"`;
    const fullCommand = `(cd "${tempDir}" && ${toolInvocation.displayCommand} --model "${mappedModel}" --output-format stream-json --yolo${resumeSession ? ` --resume "${resumeSession}"` : ''}${systemPrompt ? ` --append-system-prompt "$(cat "${systemPromptFile}")"` : ''} --prompt "$(cat "${promptFile}")")`;

    const preparedResult = await logPreparedToolCommand({ argv, fullCommand, log, formatAligned });
    if (preparedResult) return preparedResult;

    try {
      const execCommand = dollar({
        cwd: tempDir,
        mirror: false,
        env: qwenEnv,
      })`sh -lc ${commandScript}`;

      await log(`${formatAligned('📋', 'Command details:', '')}`);
      await log(formatAligned('📂', 'Working directory:', tempDir, 2));
      await log(formatAligned('🌿', 'Branch:', branchName, 2));
      await log(formatAligned('🤖', 'Model:', `Qwen Code ${argv.model.toUpperCase()}`, 2));
      if (argv.fork && forkedRepo) {
        await log(formatAligned('🍴', 'Fork:', forkedRepo, 2));
      }

      await log(`\n${formatAligned('▶️', 'Streaming output:', '')}\n`);

      let exitCode = 0;
      let qwenState = createQwenParserState();
      let allOutput = '';

      for await (const chunk of execCommand.stream()) {
        if (chunk.type === 'stdout') {
          const output = chunk.data.toString();
          await log(output, { stream: 'stdout' });
          allOutput += output;
          qwenState = parseQwenStreamJsonOutput(output, qwenState);
        }

        if (chunk.type === 'stderr') {
          const errorOutput = chunk.data.toString();
          if (errorOutput) {
            await log(errorOutput, { stream: 'stderr' });
            allOutput += errorOutput;
            // Issue #2136: stderr is diagnostics, not the qwen protocol stream.
            qwenState = parseQwenStreamJsonOutput(errorOutput, qwenState, { source: 'stderr' });
          }
        } else if (chunk.type === 'exit') {
          exitCode = chunk.code;
        }
      }

      if (qwenState.buffer.trim()) {
        qwenState = parseQwenStreamJsonOutput(`${qwenState.buffer}\n`, { ...qwenState, buffer: '' });
      }

      // Issue #2136: make the ignored non-protocol JSON visible, so a future
      // investigation can tell "qwen emitted no result event" apart from "the
      // records in the log came from stderr and were correctly ignored".
      const qwenTelemetryTypes = Object.entries(qwenState.telemetryEventCounts || {});
      if (qwenTelemetryTypes.length > 0) {
        await log(`🪞 JSON records on qwen stderr (ignored, not protocol events): ${qwenTelemetryTypes.map(([type, count]) => `${type}=${count}`).join(', ')}`, { verbose: true });
      }

      const sessionId = qwenState.sessionId || null;
      const resultSummary = qwenState.lastTextContent || null;
      const errorMessage = qwenState.errors
        .map(error => error.message)
        .filter(Boolean)
        .join('\n');
      const combinedErrorText = `${allOutput}\n${errorMessage}`.trim();
      const limitInfo = detectUsageLimit(combinedErrorText);
      const usageResult = buildQwenPricingInfo(qwenState, mappedModel);

      if (limitInfo.isUsageLimit) {
        const messageLines = formatUsageLimitMessage({
          tool: 'Qwen Code',
          resetTime: limitInfo.resetTime,
          sessionId,
          resumeCommand: sessionId ? `${process.argv[0]} ${process.argv[1]} ${argv.url} --tool qwen --resume ${sessionId}` : null,
        });
        for (const line of messageLines) {
          await log(line, { level: 'warning' });
        }

        return {
          success: false,
          sessionId,
          limitReached: true,
          limitResetTime: limitInfo.resetTime,
          ...usageResult,
          resultSummary,
        };
      }

      if (exitCode !== 0 || qwenState.errors.length > 0) {
        if (isQwenAuthError(combinedErrorText) || qwenState.errors.some(error => error.isAuthError)) {
          await log('\n\n❌ Qwen Code authentication failed', { level: 'error' });
          await log('   💡 Run: qwen auth', { level: 'error' });
        } else {
          const retryableError = classifyRetryableError(combinedErrorText);
          if (retryableError.isRetryable) {
            const isRequestTimeoutRetry = retryableError.label === 'Request timeout';
            const maxRetries = isRequestTimeoutRetry ? retryLimits.maxRequestTimeoutRetries : retryLimits.maxTransientErrorRetries;
            // Issue #2169: the attempt count is only a runaway backstop — the 12-hour wall-clock budget
            // (configurable) decides when to stop, and every wait honours the 3-minute minimum.
            const retryDecision = transientRetryBudget.evaluate({
              retryCount,
              maxRetries,
              initialDelayMs: isRequestTimeoutRetry ? retryLimits.initialRequestTimeoutDelayMs : retryLimits.initialTransientErrorDelayMs,
              maxDelayMs: isRequestTimeoutRetry ? retryLimits.maxRequestTimeoutDelayMs : retryLimits.maxTransientErrorDelayMs,
              minDelayMs: retryLimits.minTransientErrorDelayMs,
            });
            if (retryDecision.allowed) {
              transientRetryBudget.grant();
              if (sessionId && !argv.resume) argv.resume = sessionId;
              // Issue #2037: retry the same model on capacity errors before falling back;
              // after a capacity-driven model switch, retry quickly instead of waiting the
              // full transient backoff — the new model may be available now.
              const retryPlan = await prepareRetryAfterError({
                tool: 'qwen',
                argv,
                log,
                errorMessage: retryableError.message,
                retryCount,
                initialDelayMs: isRequestTimeoutRetry ? retryLimits.initialRequestTimeoutDelayMs : retryLimits.initialTransientErrorDelayMs,
                maxDelayMs: isRequestTimeoutRetry ? retryLimits.maxRequestTimeoutDelayMs : retryLimits.maxTransientErrorDelayMs,
                minDelayMs: retryLimits.minTransientErrorDelayMs,
              });
              const delay = retryPlan.delay;
              const delayLabel = delay >= 60000 ? `${Math.round(delay / 60000)} min` : `${Math.round(delay / 1000)}s`;
              await log(`\n⚠️ ${retryableError.label} detected. Retry ${retryCount + 1} in ${delayLabel}${sessionId ? ' (session preserved)' : ''} (${transientRetryBudget.describeProgress()})...`, { level: 'warning' });
              await waitForRetryDelay(delay, log);
              await log('\n🔄 Retrying now...');
              retryCount++;
              return await executeWithRetry();
            }
            await log(`\n\n❌ ${retryableError.label} persisted: ${transientRetryBudget.describeExhaustion(retryDecision)}`, { level: 'error' });
          } else if (exitCode === 130) {
            await log('\n\n⚠️ Qwen Code command interrupted (CTRL+C)');
          } else {
            await log(`\n\n❌ Qwen Code command failed${exitCode !== 0 ? ` with exit code ${exitCode}` : ''}`, { level: 'error' });
            if (errorMessage) await log(errorMessage, { level: 'error' });
          }
        }

        const resourcesAfter = await getResourceSnapshot();
        await log('\n📈 System resources after execution:', { verbose: true });
        await log(`   Memory: ${resourcesAfter.memory.split('\n')[1] || resourcesAfter.memory}`, { verbose: true });
        await log(`   Load: ${resourcesAfter.load}`, { verbose: true });

        return {
          success: false,
          sessionId,
          limitReached: false,
          limitResetTime: null,
          ...usageResult,
          resultSummary,
          // Issue #1845/#1941: surface the actual error, rejecting meaningless fragments (e.g. a lone "}")
          errorInfo: { message: buildToolErrorMessage({ lastMessage: combinedErrorText || errorMessage, exitCode, fallback: `Qwen Code command failed${exitCode !== 0 ? ` with exit code ${exitCode}` : ''}`, toolLabel: 'Qwen Code' }), exitCode },
        };
      }

      // Issue #1990: exit 0 with no error event is necessary but NOT sufficient.
      // qwen-code's stream-json ends with a terminal `result` event; a run that
      // did work but never emitted it was cut off mid-run (e.g. the docker
      // container ran out of disk) and must be registered as a failure so the
      // session is preserved for a context-preserving restart and — under docker
      // isolation — the container filesystem is kept for inspection.
      const completionHealth = getTerminalEventCompletionHealth({
        eventCounts: qwenState.eventCounts,
        terminalEventTypes: ['result'],
        hadActivity: (qwenState.parsedEvents?.length || 0) > 0,
        diskEvidenceTexts: [
          { source: 'output', text: allOutput },
          { source: 'result-summary', text: resultSummary },
        ],
      });
      if (!completionHealth.healthy) {
        await log('\n\n❌ Qwen Code exited 0 but the run did not complete — treating as failure', { level: 'error' });
        for (const reason of completionHealth.reasons) {
          await log(`   • ${reason}`, { level: 'error' });
        }
        if (completionHealth.diskPressureDetected) {
          await log('   💽 Disk-exhaustion evidence (diagnostic):', { level: 'error' });
          for (const evidence of completionHealth.diskEvidence.slice(0, 5)) {
            await log(`      ↳ [${evidence.source}] ${evidence.text}`, { level: 'error' });
          }
          await log('   💡 Free disk space before retrying. Under docker isolation the container is preserved on failure for inspection.', { level: 'error' });
        }
        if (sessionId && !argv.resume) argv.resume = sessionId;
        return {
          success: false,
          sessionId,
          limitReached: false,
          limitResetTime: null,
          ...usageResult,
          resultSummary,
          completionHealth,
          incompleteSession: completionHealth.incompleteSession,
          diskPressureDetected: completionHealth.diskPressureDetected,
          errorInfo: { message: completionHealth.reasons.join(' ') },
        };
      }

      await log('\n\n✅ Qwen Code command completed');
      if (resultSummary) {
        await log('📝 Captured result summary from Qwen Code output', { verbose: true });
      }

      return {
        success: true,
        sessionId,
        limitReached: false,
        limitResetTime: null,
        ...usageResult,
        resultSummary,
      };
    } catch (error) {
      reportError(error, {
        context: 'execute_qwen',
        qwenPath,
        operation: 'run_qwen_command',
      });

      await log(`\n\n❌ Error executing Qwen Code command: ${error.message}`, { level: 'error' });
      return {
        success: false,
        sessionId: null,
        limitReached: false,
        limitResetTime: null,
        pricingInfo: null,
        publicPricingEstimate: null,
        tokenUsage: null,
        resultSummary: null,
        // Issue #1845: surface the actual exception message so callers can show it to users
        errorInfo: { message: error.message || error.toString() },
      };
    }
  };

  try {
    return await executeWithRetry();
  } finally {
    await fs.unlink(promptFile).catch(() => {});
    await fs.unlink(systemPromptFile).catch(() => {});
  }
};

export const checkForUncommittedChanges = async (tempDir, owner, repo, branchName, $, log, autoCommit = false, autoRestartEnabled = true) => {
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
            const commitMessage = 'Auto-commit: Changes made by Qwen Code during problem-solving session';
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
          await log('   Qwen Code made changes that were not committed.');
          await log('');
          await log('🔄 AUTO-RESTART: Restarting Qwen Code to handle uncommitted changes...');
          await log('   Qwen Code will review the changes and decide what to commit.');
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
      context: 'check_uncommitted_changes_qwen',
      tempDir,
      operation: 'git_status_check',
    });
    await log(`⚠️ Warning: Error checking for uncommitted changes: ${gitError.message}`, { level: 'warning' });
    return false;
  }
};

export default {
  validateQwenConnection,
  checkPlaywrightMcpAvailability,
  executeQwen,
  executeQwenCommand,
  checkForUncommittedChanges,
  parseQwenStreamJsonOutput,
  mapModelToId,
};
