#!/usr/bin/env node
import { ensureUseM } from './use-m-bootstrap.lib.mjs';
// Codex CLI-related utility functions

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
// Import log from general lib
import { log } from './lib.mjs';
// Issues #1955 / #1990: run-health analysis lives in its own module to keep this
// file under the max-lines budget. Re-exported below for backward compatibility.
import { getCodexErrorEventSummary, getCodexCompletionHealth, getCodexPluginProvisioningHealth, logCodexResourceSnapshot, matchCodexPluginInstallRejection, reportCodexCompletionFailure, reportCodexPluginProvisioning } from './codex-health.lib.mjs';
export { getCodexErrorEventSummary, getCodexCompletionHealth, getCodexPluginProvisioningHealth, matchCodexPluginInstallRejection };
import { reportError } from './sentry.lib.mjs';
import { timeouts, retryLimits } from './config.lib.mjs';
import { detectUsageLimit, formatUsageLimitMessage } from './usage-limit.lib.mjs';
import { buildSolveResumeCommand } from './solve.resume-command.lib.mjs'; // Issue #942
const __codexBuildSolveResumeCmd = (argv, sessionId, tempDir) => (sessionId && argv?.url ? buildSolveResumeCommand({ issueUrl: argv.url, sessionId, tool: 'codex', model: argv.model, fallbackModel: argv.fallbackModel, tempDir }) : null);
import { sanitizeObjectStrings } from './unicode-sanitization.lib.mjs';
import { firstErrorText } from './error-text.lib.mjs'; // Issue #2141
import { createLineBuffer } from './json-stream.lib.mjs'; // Issue #2119
import { mapModelToId, resolveCodexReasoningEffort } from './codex.options.lib.mjs';
import { buildCodexRunDiagnostics, codexRunAlreadyFailed, describeCodexLastMessageOutcome } from './codex.run-diagnostics.lib.mjs'; // Issue #2130
import { createInteractiveHandler } from './interactive-mode.lib.mjs';
import { initProgressMonitoring } from './solve.progress-monitoring.lib.mjs';
import { ensureCodexPlaywrightMcpServer, getCodexPlaywrightMcpDisableConfigArgs } from './playwright-mcp.lib.mjs';
import { fetchModelInfo } from './model-info.lib.mjs';
import { defaultModels, isFormalAiModel } from './models/index.mjs';
import { buildAuthRemedyLines, buildFormalAiEnvExports, isPrepareOnly, logPreparedToolCommand, resolveFormalAiToolExecution } from './formal-ai.lib.mjs';
import { buildFormalAiPricingInfo } from './formal-ai-pricing.lib.mjs'; // Issue #2119
import { classifyRetryableError, prepareRetryAfterError, waitWithCountdown } from './tool-retry.lib.mjs';
import { parseSubSessionSize, buildCodexSubSessionSizeConfigArgs, buildCodexDisable1mContextConfigArgs } from './sub-session-size.lib.mjs'; // Issue #1706
import { getCumulativeContextInputTokens } from './context-fill.lib.mjs';
import { deployHandoffSkill } from './handoff-skill.lib.mjs'; // Issue #1877
import { applyCodexCapabilityEnv, runCodexCapabilityPreflight } from './codex-capability-preflight.lib.mjs'; // Issue #2074
import { createPullRequestBaseBranchCommandIntervention } from './solve.pr-base-command-intervention.lib.mjs';
import Decimal from 'decimal.js-light';
import { ensureAiToolScratchIgnored, filterAiToolScratchFromStatus } from './ai-tool-scratch.lib.mjs';
import { CODEX_CACHE_READ_USAGE_PATHS, CODEX_CACHE_WRITE_USAGE_PATHS, CODEX_MODEL_DIAGNOSTIC_PATHS, CODEX_REASONING_USAGE_PATHS, CODEX_USAGE_FIELD_NAMES, createCodexTokenFieldAvailability, getFirstObservedNumber, hasAnyObservedPath, hasOwnPath } from './codex.usage-fields.lib.mjs';
const CODEX_LONG_CONTEXT_PRICE_THRESHOLD = 272000;
const CODEX_COMPACT_API_ENDPOINT = '/responses/compact';
const getCodexExecEnv = (verbose = false) => (verbose ? { ...process.env, RUST_LOG: 'debug' } : { ...process.env });

const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const getCodexDiagnosticValue = (line, key) => {
  const match = line.match(new RegExp(`${escapeRegExp(key)}=(?:"([^"]*)"|([^\\s")]+))`));
  return match?.[1] ?? match?.[2] ?? null;
};
const getCodexDiagnosticInteger = (line, key) => {
  const value = getCodexDiagnosticValue(line, key);
  if (value === null) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};
const getCodexDiagnosticTimestamp = line => {
  const eventTimestamp = getCodexDiagnosticValue(line, 'event.timestamp');
  if (eventTimestamp) return eventTimestamp;
  const logPrefixMatch = line.match(/^\[(\d{4}-\d{2}-\d{2}T[^\]]+Z)\]/u);
  return logPrefixMatch?.[1] ?? null;
};
const isSuccessfulCodexCompactRequestLine = line => {
  if (!line.includes('codex_otel.log_only:')) return false;
  if (!line.includes('event.name="codex.api_request"')) return false;
  if (!line.includes(`endpoint="${CODEX_COMPACT_API_ENDPOINT}"`)) return false;
  const statusCode = getCodexDiagnosticInteger(line, 'http.response.status_code');
  return statusCode === null || (statusCode >= 200 && statusCode < 300);
};

const splitTokenCountEvenly = (total, partCount) => {
  const safeTotal = Math.max(0, Math.round(total || 0));
  const safePartCount = Math.max(1, Math.round(partCount || 1));
  const base = Math.floor(safeTotal / safePartCount);
  let remainder = safeTotal % safePartCount;
  return Array.from({ length: safePartCount }, () => {
    const value = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;
    return value;
  });
};
const splitCodexSubSessionInputTokens = (total, partCount, autoCompactTokenLimit = null) => {
  const safeTotal = Math.max(0, Math.round(total || 0));
  const safePartCount = Math.max(1, Math.round(partCount || 1));
  const safeLimit = Number.isFinite(autoCompactTokenLimit) && autoCompactTokenLimit > 0 ? Math.round(autoCompactTokenLimit) : null;
  if (safePartCount <= 1) return [safeTotal];
  if (safeLimit && safeTotal > safeLimit * (safePartCount - 1)) {
    const chunks = [];
    let remaining = safeTotal;
    for (let i = 0; i < safePartCount - 1; i++) {
      const chunk = Math.min(safeLimit, remaining);
      chunks.push(chunk);
      remaining -= chunk;
    }
    chunks.push(Math.max(0, remaining));
    return chunks;
  }
  return splitTokenCountEvenly(safeTotal, safePartCount);
};
const splitTokenCountByWeights = (total, weights) => {
  const safeTotal = Math.max(0, Math.round(total || 0));
  const safeWeights = Array.isArray(weights) && weights.length > 0 ? weights.map(weight => Math.max(0, weight || 0)) : [1];
  const weightTotal = safeWeights.reduce((sum, weight) => sum + weight, 0);
  if (weightTotal <= 0) return splitTokenCountEvenly(safeTotal, safeWeights.length);
  let allocated = 0;
  return safeWeights.map((weight, index) => {
    if (index === safeWeights.length - 1) return Math.max(0, safeTotal - allocated);
    const value = Math.floor((safeTotal * weight) / weightTotal);
    allocated += value;
    return value;
  });
};
const rebuildCodexSubSessionsFromCompactifications = tokenUsage => {
  const compactifications = Array.isArray(tokenUsage.compactifications) ? tokenUsage.compactifications : [];
  if (compactifications.length === 0 || (tokenUsage.stepCount || 0) === 0) {
    tokenUsage.subSessions = Array.isArray(tokenUsage.subSessions) ? tokenUsage.subSessions : [];
    return;
  }

  const subSessionCount = compactifications.length + 1;
  const inputChunks = splitCodexSubSessionInputTokens(tokenUsage.inputTokens || 0, subSessionCount, tokenUsage.autoCompactTokenLimit);
  const cacheWriteChunks = splitTokenCountByWeights(tokenUsage.cacheWriteTokens || 0, inputChunks);
  const cacheReadChunks = splitTokenCountByWeights(tokenUsage.cacheReadTokens || 0, inputChunks);
  const outputChunks = splitTokenCountByWeights(tokenUsage.outputTokens || 0, inputChunks);
  tokenUsage.subSessions = inputChunks.map((inputTokens, index) => {
    const cacheCreationTokens = cacheWriteChunks[index] || 0;
    const outputTokens = outputChunks[index] || 0;
    return {
      inputTokens,
      cacheCreationTokens,
      cacheReadTokens: cacheReadChunks[index] || 0,
      outputTokens,
      messageCount: null,
      peakContextUsage: getCumulativeContextInputTokens({ inputTokens, cacheCreationTokens }),
      peakOutputUsage: outputTokens,
      estimated: true,
      source: 'codex.compact-diagnostics',
      compactBoundaryBefore: index === 0 ? null : compactifications[index - 1] || null,
    };
  });
};
const recordCodexCompactification = (line, tokenUsage) => {
  if (!isSuccessfulCodexCompactRequestLine(line)) return;
  const timestamp = getCodexDiagnosticTimestamp(line);
  const conversationId = getCodexDiagnosticValue(line, 'conversation.id');
  const existing = tokenUsage.compactifications.find(compact => compact.timestamp === timestamp && compact.conversationId === conversationId);
  if (existing) return;
  tokenUsage.compactifications.push({
    timestamp,
    preTokens: null,
    trigger: 'auto',
    source: 'codex.responses.compact',
    conversationId: conversationId || null,
  });
};
const parseCodexDiagnosticLine = (line, tokenUsage) => {
  const contextLimit = getCodexDiagnosticInteger(line, 'context_window') ?? getCodexDiagnosticInteger(line, 'model_context_window');
  if (contextLimit !== null) tokenUsage.contextLimit = contextLimit;

  const autoCompactTokenLimit = getCodexDiagnosticInteger(line, 'auto_compact_token_limit') ?? getCodexDiagnosticInteger(line, 'model_auto_compact_token_limit');
  if (autoCompactTokenLimit !== null) tokenUsage.autoCompactTokenLimit = autoCompactTokenLimit;
  recordCodexCompactification(line, tokenUsage);
};
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
  autoCompactTokenLimit: null,
  contextFillInputTokens: 0,
  peakContextUsage: 0,
  subSessions: [],
  compactifications: [],
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
// Issue #2136: `codex exec --json` writes its NDJSON protocol to **stdout** only.
// Its stderr carries OTEL tracing text (RUST_LOG=debug under --verbose), and each
// `codex.tool_result` record dumps the raw stdout of the command codex just ran —
// so a task driving another agent CLI replays that agent's NDJSON verbatim inside
// the trace. Feeding stderr through this parser counted the nested agent's
// `turn.started` as codex's own, and the #1990 completion gate then failed a run
// that had actually completed (see docs/case-studies/issue-2136).
//
// Fix: only stdout is trusted as protocol. Stderr is still scanned for the
// text-only diagnostics that legitimately live there (token/model diagnostics,
// the #2102 plugin-install rejection), but protocol-shaped JSON found there is
// counted into `telemetryEventCounts` and otherwise ignored — it never touches
// eventCounts, sessionId, usage or the error buckets.
export const parseCodexExecJsonOutput = (output, state = {}, requestedModelId = null, { source = 'stdout' } = {}) => {
  const isProtocolStream = source === 'stdout';
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
    pluginInstallRejections: state.pluginInstallRejections || [],
    observedUsageFieldSets: state.observedUsageFieldSets || [],
    observedModelDiagnosticPaths: state.observedModelDiagnosticPaths || [],
    // Issue #2136: protocol-shaped JSON seen on a non-protocol stream (telemetry
    // echo), kept for diagnostics only.
    telemetryEventCounts: state.telemetryEventCounts || {},
    // Issue #2136: ordered turn lifecycle from the protocol stream, so the
    // completion gate can ask "did the last turn finish?" instead of comparing
    // counts that an echoed `turn.started` can skew.
    turnLifecycle: state.turnLifecycle || [],
    // Issue #2140: `thread.started` records seen on the protocol stream that
    // announce a thread id other than this session's. Codex only starts one
    // thread per `codex exec`, so a second id is proof that something echoed
    // another agent's protocol into ours — the one turn event that carries an
    // identity we can check. Diagnostics only; the gate stays order-based.
    foreignThreadIds: state.foreignThreadIds || [],
  };
  nextState.tokenUsage.tokenFieldAvailability ||= createCodexTokenFieldAvailability();
  if (!Array.isArray(nextState.tokenUsage.subSessions)) nextState.tokenUsage.subSessions = [];
  if (!Array.isArray(nextState.tokenUsage.compactifications)) nextState.tokenUsage.compactifications = [];
  nextState.tokenUsage.autoCompactTokenLimit ??= null;
  const observedModelPaths = new Set(nextState.observedModelDiagnosticPaths);

  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    parseCodexDiagnosticLine(line, nextState.tokenUsage);
    let data;
    try {
      data = sanitizeObjectStrings(JSON.parse(line));
    } catch {
      // Issue #2102: `request_plugin_install` is a codex builtin, so its rejection
      // never arrives as an NDJSON item — it only exists in the interleaved OTEL
      // text stream, which is exactly the set of lines that fail to parse here.
      const rejection = matchCodexPluginInstallRejection(line);
      if (rejection) nextState.pluginInstallRejections.push(rejection);
      continue;
    }
    // Issue #1968: a stream line that parses to a bare `null` (or any non-object
    // JSON primitive such as a number/string/boolean) must not crash the parser.
    // Codex echoes the stdout of every command it runs back into its own NDJSON
    // stream (see issue #1955), so a target repo that prints a standalone `null`
    // line surfaces here as `JSON.parse('null') === null`. Accessing `data.type`
    // on that null threw "Cannot read properties of null (reading 'type')" and
    // aborted the entire solve. Real Codex events are always JSON objects, so any
    // non-object line is safely ignored.
    if (data === null || typeof data !== 'object') continue;
    const eventType = typeof data.type === 'string' ? data.type : 'unknown';

    // Issue #2136: a protocol-shaped object on a non-protocol stream is echoed
    // telemetry, never a codex event. Count it for diagnostics and move on.
    if (!isProtocolStream) {
      nextState.telemetryEventCounts[eventType] = (nextState.telemetryEventCounts[eventType] || 0) + 1;
      continue;
    }
    nextState.eventCounts[eventType] = (nextState.eventCounts[eventType] || 0) + 1;
    if (eventType === 'turn.started' || eventType === 'turn.completed' || eventType === 'turn.failed') {
      nextState.turnLifecycle.push(eventType);
    }
    if (eventType === 'thread.started' && typeof data.thread_id === 'string' && !nextState.sessionId) {
      nextState.sessionId = data.thread_id;
    } else if (eventType === 'thread.started' && typeof data.thread_id === 'string' && data.thread_id !== nextState.sessionId) {
      // Issue #2140: a foreign thread id on the protocol stream is echoed
      // output, not a second codex session. Record it once so a run that ends
      // up disputed can be settled from the log alone.
      if (!nextState.foreignThreadIds.includes(data.thread_id)) nextState.foreignThreadIds.push(data.thread_id);
    } else if (!nextState.sessionId && typeof data.session_id === 'string') {
      nextState.sessionId = data.session_id;
    }
    for (const [pathName, getter] of CODEX_MODEL_DIAGNOSTIC_PATHS) {
      if (typeof getter(data) === 'string') observedModelPaths.add(pathName);
    }

    // Issue #2141: these payloads are not always strings. Requiring `typeof …
    // === 'string'` dropped every object-shaped failure — a dropped
    // `turn.failed` reads as a success — and interpolating one would have
    // published "[object Object]". Render it as text instead.
    const streamErrorText = eventType === 'error' ? firstErrorText([data.message, data.error]) : '';
    if (streamErrorText) {
      if (streamErrorText.includes('401') || streamErrorText.includes('Unauthorized')) nextState.authError = true;
      nextState.streamErrors.push({ message: streamErrorText });
    }
    const turnFailureText = eventType === 'turn.failed' ? firstErrorText([data.error, data.message]) : '';
    if (turnFailureText) {
      if (turnFailureText.includes('401') || turnFailureText.includes('Unauthorized')) nextState.authError = true;
      nextState.turnFailures.push({ message: turnFailureText });
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
      const turnContextFill = getCumulativeContextInputTokens({
        inputTokens: nonCachedInputTokens,
        cacheWriteTokens,
      });
      if (turnContextFill > (nextState.tokenUsage.contextFillInputTokens || 0)) {
        nextState.tokenUsage.contextFillInputTokens = turnContextFill;
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
  rebuildCodexSubSessionsFromCompactifications(nextState.tokenUsage);
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
      contextFillInputTokens: tokenUsage.contextFillInputTokens || getCumulativeContextInputTokens(tokenUsage),
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
  // Issue #2119: a Formal AI session is served by the local Link.Assistant
  // model server, so OpenAI pricing must not be applied to it.
  if (isFormalAiModel(modelId)) return buildFormalAiPricingInfo(modelId, tokenUsage);
  try {
    const modelInfo = await fetchModelInfo(modelId, { preferredProviderIds: ['openai'] });
    return calculateCodexPricingFromModelInfo(modelId, tokenUsage, modelInfo);
  } catch (error) {
    return buildCodexPricingFallback(modelId, tokenUsage, error.message);
  }
};
// Function to validate Codex CLI connection
export const validateCodexConnection = async (model = defaultModels.codex, verbose = false) => {
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
          for (const line of buildAuthRemedyLines({ model, vendorRemedy: 'Please run: codex login' })) await log(line, { level: 'error' });
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
export const checkPlaywrightMcpAvailability = ensureCodexPlaywrightMcpServer;
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
  // Issue #1877: deploy the experimental HANDOFF.md Agent Skill so Codex loads
  // it natively from .agents/skills/handoff/SKILL.md (no-op unless --use-handoff).
  await deployHandoffSkill({ tempDir, argv, log, $ });
  const codexBaseEnv = getCodexExecEnv(argv.verbose);
  // Issue #2102: the target repository's own agent instruction files are part of
  // the requirement corpus, so the preflight needs the checkout; `--require-codex-plugin`
  // is the explicit escape hatch for requirements no document states.
  const capabilityPreflight = await runCodexCapabilityPreflight({ owner, repo, issueNumber, projectDir: tempDir, codexPath, log, env: codexBaseEnv, requiredPlugins: argv.requireCodexPlugin });
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
    capabilityPreflight: { ...capabilityPreflight, codexBaseEnv },
  });
};

export const executeCodexCommand = async params => {
  const { tempDir, branchName, prompt, systemPrompt, argv, log, formatAligned, getResourceSnapshot, forkedRepo, feedbackLines, codexPath, $, owner, repo, prNumber, capabilityPreflight, calculatePricing = calculateCodexPricing, waitForRetryDelay = waitWithCountdown } = params;
  const shellQuote = value => `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
  const expectedBaseBranch = String(argv?.baseBranch || '').trim();
  // Retry configuration
  let retryCount = 0;
  let baseBranchInterventionPrompt = null;
  let baseBranchInterventionResumeCount = 0;
  const executeWithRetry = async () => {
    // Execute codex command from the cloned repository directory
    if (retryCount === 0) {
      await log(`\n${formatAligned('🤖', 'Executing Codex:', argv.model.toUpperCase())}`);
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
    let execCommand;
    const mappedModel = mapModelToId(argv.model);
    const { reasoningEffort, source: reasoningEffortSource, rolloutTokenBudget } = resolveCodexReasoningEffort(argv);
    const isResumeMode = !!argv.resume;
    const codexEnv = applyCodexCapabilityEnv(capabilityPreflight?.codexBaseEnv || getCodexExecEnv(argv.verbose), {
      codexHome: capabilityPreflight?.codexHome,
      baseCodexHome: capabilityPreflight?.baseCodexHome,
    });
    // Issue #2130: run the native CLI against a local Formal AI server (no argv wrapper); `codexEnv` seeds the isolated CODEX_HOME.
    const toolInvocation = await resolveFormalAiToolExecution({ tool: 'codex', model: argv.model, toolPath: codexPath, workdir: tempDir, log, verbose: argv.verbose, prepareOnly: isPrepareOnly(argv), env: codexEnv });
    // Issue #2130: "run codex login" is wrong advice for a Formal-AI-served model.
    const codexAuthRemedyLines = buildAuthRemedyLines({ model: argv.model, vendorRemedy: 'Please run: codex login' });
    Object.assign(codexEnv, toolInvocation.env);
    // For Codex, we combine system and user prompts into a single message
    // Codex doesn't have separate system prompt support in CLI mode
    const promptForAttempt = baseBranchInterventionPrompt ? `${prompt}\n\n${baseBranchInterventionPrompt}\n` : prompt;
    const combinedPrompt = systemPrompt ? `${systemPrompt}\n\n${promptForAttempt}` : promptForAttempt;
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
      codexArgs += ` resume ${shellQuote(argv.resume)} --model ${shellQuote(mappedModel)}`;
    } else {
      codexArgs += ` --model ${shellQuote(mappedModel)}`;
    }
    const codexPlaywrightMcpDisableConfigArgs = argv.playwrightMcp === false ? await getCodexPlaywrightMcpDisableConfigArgs(log) : [];
    for (const arg of codexPlaywrightMcpDisableConfigArgs) {
      codexArgs += ` ${shellQuote(arg)}`;
    }
    codexArgs += ` --json --skip-git-repo-check -o ${shellQuote(lastMessageFile)} -c ${shellQuote(`model_reasoning_effort=${reasoningEffort}`)} -c ${shellQuote('model_reasoning_summary=auto')}`;
    // Issue #2027: pair GPT-5.6 Sol's multi-agent `ultra` effort with a rollout token budget cap so it stays predictable and does not run away on cost.
    if (rolloutTokenBudget) codexArgs += ` -c ${shellQuote(`rollout_token_budget=${rolloutTokenBudget}`)}`;
    codexArgs += ' --dangerously-bypass-approvals-and-sandbox';
    // Issue #1706: Append --disable-1m-context and --sub-session-size as Codex -c overrides.
    let parsedSubSessionSize;
    try {
      parsedSubSessionSize = parseSubSessionSize(argv.subSessionSize);
    } catch (parseError) {
      await log(`⚠️  ${parseError.message}`, { level: 'warn' });
      parsedSubSessionSize = { kind: 'default', tokens: null, percent: null, raw: '' };
    }
    let codexContextWindowTokens = null;
    if (parsedSubSessionSize.kind === 'percent') {
      try {
        const codexModelMeta = await fetchModelInfo(mappedModel, { preferredProviderIds: ['openai'] });
        codexContextWindowTokens = codexModelMeta?.limit?.context || null;
      } catch {
        codexContextWindowTokens = null;
      }
    }
    const disable1mArgs = buildCodexDisable1mContextConfigArgs(!!argv.disable1mContext);
    for (const arg of disable1mArgs) {
      codexArgs += ` ${shellQuote(arg)}`;
    }
    const subSessionSizeArgs = buildCodexSubSessionSizeConfigArgs(parsedSubSessionSize, { contextWindow: codexContextWindowTokens });
    for (const arg of subSessionSizeArgs) {
      codexArgs += ` ${shellQuote(arg)}`;
    }
    if (argv.verbose) {
      if (disable1mArgs.length) await log(`📊 Codex --disable-1m-context: ${disable1mArgs.join(' ')}`, { verbose: true });
      if (subSessionSizeArgs.length) await log(`📊 Codex --sub-session-size: ${subSessionSizeArgs.join(' ')}`, { verbose: true });
    }
    // Issue #2130: re-export the Formal AI environment inside the `sh -lc` script so a
    // stale `formal-ai with --global` block in the operator profile cannot override it.
    const fullCommand = `(${buildFormalAiEnvExports(toolInvocation.env)}cd ${shellQuote(tempDir)} && cat ${shellQuote(promptFile)} | ${toolInvocation.displayCommand} ${codexArgs})`;
    const preparedResult = await logPreparedToolCommand({ argv, fullCommand, log, formatAligned });
    if (preparedResult) return preparedResult;
    try {
      let interactiveHandler = null;
      if (argv.interactiveMode && owner && repo && prNumber) {
        await log('🔌 Interactive mode: Creating handler for real-time PR comments', { verbose: true });
        interactiveHandler = createInteractiveHandler({
          owner,
          repo,
          prNumber,
          $,
          log,
          verbose: argv.verbose,
          // Issue #1843: upload & embed images by default; --no-interactive-image-upload opts out.
          imageUploadEnabled: argv['interactive-image-upload'] !== false,
        });
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
      const baseBranchCommandIntervention = createPullRequestBaseBranchCommandIntervention({
        expectedBaseBranch,
        prNumber,
        log,
        toolLabel: 'Codex',
        stopSession: async () => {
          if (!execCommand?.kill) return false;
          execCommand.kill('SIGTERM');
          return true;
        },
      });
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
        pluginInstallRejections: [],
        observedUsageFieldSets: [],
        observedModelDiagnosticPaths: [],
        telemetryEventCounts: {},
        turnLifecycle: [],
      };
      // Issue #2119: a process chunk boundary can fall in the middle of an
      // NDJSON record. Parsing each raw chunk dropped both halves of a split
      // record (token usage, session id, auth errors). Buffer whole lines so
      // the line-oriented Codex parser never sees a partial record.
      const codexStdoutLines = createLineBuffer();
      const codexStderrLines = createLineBuffer();

      for await (const chunk of execCommand.stream()) {
        if (chunk.type === 'stdout') {
          const raw = chunk.data.toString();
          if (argv.verbose) {
            await log(raw, { stream: 'stdout' });
          }
          lastMessage = raw;
          const output = codexStdoutLines.write(raw);
          codexJsonState = parseCodexExecJsonOutput(output, codexJsonState, mappedModel, { source: 'stdout' });
          await baseBranchCommandIntervention.handleCommandExecutions(codexJsonState.commandExecutions);
          if (interactiveHandler || progressMonitor) {
            for (const rawLine of output.split('\n')) {
              const line = rawLine.trim();
              if (!line) continue;
              try {
                const data = sanitizeObjectStrings(JSON.parse(line));
                // Issue #1968: skip bare `null`/primitive lines so the handlers
                // below never receive a non-object event (see parseCodexExecJsonOutput).
                if (data === null || typeof data !== 'object') continue;
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
            for (const line of codexAuthRemedyLines) await log(line, { level: 'error' });
          }
        }
        if (chunk.type === 'stderr') {
          const rawError = chunk.data.toString();
          if (rawError && argv.verbose) {
            await log(rawError, { stream: 'stderr' });
          }
          const errorOutput = codexStderrLines.write(rawError);
          // Issue #2136: stderr is telemetry/tracing text, not the codex protocol.
          codexJsonState = parseCodexExecJsonOutput(errorOutput, codexJsonState, mappedModel, { source: 'stderr' });
          await baseBranchCommandIntervention.handleCommandExecutions(codexJsonState.commandExecutions);
        } else if (chunk.type === 'exit') {
          exitCode = chunk.code;
        }
      }
      // Release any line that was still being assembled when the stream ended.
      for (const [source, remaining] of [
        ['stdout', codexStdoutLines.flush()],
        ['stderr', codexStderrLines.flush()],
      ]) {
        if (!remaining.trim()) continue;
        codexJsonState = parseCodexExecJsonOutput(remaining, codexJsonState, mappedModel, { source });
        await baseBranchCommandIntervention.handleCommandExecutions(codexJsonState.commandExecutions);
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
        for (const line of codexAuthRemedyLines) await log(line, { level: 'error' });
      }

      if (interactiveHandler) {
        await interactiveHandler.flush();
      }
      // Issue #2130: a failed run legitimately has no final message and no
      // turn.completed usage, so those outcomes must not be logged as warnings.
      const runFailed = codexRunAlreadyFailed({ state: codexJsonState, exitCode });
      let lastMessageFromFile = null;
      let lastMessageReadError = null;
      try {
        lastMessageFromFile = (await fs.readFile(lastMessageFile, 'utf8')).trim();
      } catch (readError) {
        lastMessageReadError = readError;
      }
      const lastMessageOutcome = describeCodexLastMessageOutcome({ lastMessageFile, lastMessage: lastMessageFromFile, readError: lastMessageReadError, runFailed });
      await log(lastMessageOutcome.message, lastMessageOutcome.options);
      if (lastMessageFromFile) {
        await log(lastMessageFromFile, { verbose: true });
        lastTextContent = lastTextContent || lastMessageFromFile;
      }
      for (const line of buildCodexRunDiagnostics({ state: codexJsonState, exitCode, mappedModel })) {
        await log(line.message, line.options);
      }
      const baseBranchIntervention = baseBranchCommandIntervention.getIntervention();
      if (baseBranchIntervention) {
        if ((sessionId || argv.resume) && baseBranchInterventionResumeCount < 1) {
          argv.resume = sessionId || argv.resume;
          baseBranchInterventionPrompt = baseBranchIntervention.message;
          baseBranchInterventionResumeCount++;
          await log('\n🔄 Resuming Codex with requested base-branch correction prompt...');
          return await executeWithRetry();
        }
        return {
          success: false,
          sessionId,
          limitReached,
          limitResetTime,
          codexJsonDetails: codexJsonState,
          errorInfo: {
            message: baseBranchIntervention.message,
            violation: baseBranchIntervention.violation,
          },
          result: baseBranchIntervention.message,
          resultSummary: lastTextContent || null,
        };
      }

      const firstActualModelId = mappedModel;
      const pricingInfo = firstActualModelId ? await calculatePricing(firstActualModelId, codexJsonState.tokenUsage.stepCount > 0 ? codexJsonState.tokenUsage : null) : null;
      if (pricingInfo?.totalCostUSD !== null && pricingInfo?.totalCostUSD !== undefined) {
        await log(`💰 Codex public pricing estimate: $${new Decimal(pricingInfo.totalCostUSD).toFixed(6)}`, { verbose: true });
        if (pricingInfo.usesLongContextPricing) {
          await log(`   Long-context pricing applied because peak prompt exceeded ${pricingInfo.longContextThreshold.toLocaleString()} input tokens`, { verbose: true });
        }
      } else if (pricingInfo?.error) {
        await log(`⚠️ Codex public pricing estimate unavailable: ${pricingInfo.error}`, { level: 'warning', verbose: true });
      }
      const resultModelUsage = pricingInfo?.tokenUsage ? buildCodexResultModelUsage(firstActualModelId, pricingInfo.tokenUsage, pricingInfo) : null;
      // Every exit from this run reports the same accounting fields; only the
      // outcome-specific ones differ. `lastTextContent` is the result summary
      // captured from the JSON output stream (issue #1263).
      const buildRunResult = outcome => ({
        sessionId,
        limitReached,
        limitResetTime,
        pricingInfo,
        publicPricingEstimate: pricingInfo?.totalCostUSD ?? null,
        resultModelUsage,
        subAgentCalls: codexJsonState.subAgentCalls.length > 0 ? codexJsonState.subAgentCalls : null,
        codexJsonDetails: codexJsonState,
        resultSummary: lastTextContent || null,
        ...outcome,
      });
      // Check for authentication errors first - these should never be retried
      if (authError) {
        await logCodexResourceSnapshot({ getResourceSnapshot, log });
        // Throw an error to stop retries and propagate the auth failure
        const error = new Error(`Codex authentication failed - 401 Unauthorized.${codexAuthRemedyLines.map(line => ` ${line.replace(/^\s*💡\s*/, '')}`).join('')}`);
        error.isAuthError = true;
        throw error;
      }
      const codexErrorSummary = getCodexErrorEventSummary(codexJsonState);
      if (codexErrorSummary.ignoredEvents.length > 0) {
        const ignoredMessages = [...new Set(codexErrorSummary.ignoredEvents.map(event => event.message))].join('; ');
        await log(`⚠️ Ignoring non-fatal Codex error event(s): ${ignoredMessages}`, { level: 'warning', verbose: true });
        // Issue #1955: trace why each stray error event was treated as non-fatal so a
        // future regression (e.g. a real error wrongly suppressed) is diagnosable from
        // the verbose log without re-deriving the turn.completed/turn.failed state.
        for (const ignored of codexErrorSummary.ignoredEvents) {
          await log(`   ↳ [${ignored.type}] "${ignored.message}" — ${ignored.reason}`, { verbose: true });
        }
      }
      if (codexErrorSummary.hasError) {
        const limitSource = codexErrorSummary.message || lastMessage;
        const limitInfo = detectUsageLimit(limitSource);
        const retryableError = classifyRetryableError(limitSource);
        if (limitInfo.isUsageLimit) {
          // Issue #1869: Trace the raw limit text and what we parsed out of it so
          // a mis-parsed reset (e.g. a weekly reset read as a 5-hour reset) can be
          // diagnosed from the log without guessing at the original message.
          await log(`🔍 Codex usage limit detected. Raw message: ${JSON.stringify(limitSource)}`, { verbose: true });
          await log(`🔍 Parsed reset time: ${JSON.stringify(limitInfo.resetTime)}, timezone: ${JSON.stringify(limitInfo.timezone)}`, { verbose: true });
          limitReached = true;
          limitResetTime = limitInfo.resetTime;
          // Issue #942: build proper solve resume command (preserves tool/model/dir).
          const solveResumeCmd = __codexBuildSolveResumeCmd(argv, sessionId, tempDir);
          const messageLines = formatUsageLimitMessage({
            tool: 'OpenAI Codex',
            resetTime: limitInfo.resetTime,
            sessionId,
            solveResumeCommand: solveResumeCmd,
          });

          for (const line of messageLines) {
            await log(line, { level: 'warning' });
          }
        } else if (retryableError.isRetryable) {
          const isRequestTimeoutRetry = retryableError.label === 'Request timeout';
          const maxRetries = isRequestTimeoutRetry ? retryLimits.maxRequestTimeoutRetries : retryLimits.maxTransientErrorRetries;
          if (retryCount < maxRetries) {
            if (sessionId && !argv.resume) argv.resume = sessionId;
            // Issue #2037: retry same model on capacity errors before falling back; a
            // capacity-driven switch retries fast, other transient errors use standard backoff.
            const retryPlan = await prepareRetryAfterError({ tool: 'codex', argv, log, errorMessage: retryableError.message, retryCount, initialDelayMs: isRequestTimeoutRetry ? retryLimits.initialRequestTimeoutDelayMs : retryLimits.initialTransientErrorDelayMs, maxDelayMs: isRequestTimeoutRetry ? retryLimits.maxRequestTimeoutDelayMs : retryLimits.maxTransientErrorDelayMs });
            const delay = retryPlan.delay;
            const delayLabel = delay >= 60000 ? `${Math.round(delay / 60000)} min` : `${Math.round(delay / 1000)}s`;
            await log(`\n⚠️ ${retryableError.label} detected. Retry ${retryCount + 1}/${maxRetries} in ${delayLabel}${sessionId ? ' (session preserved)' : ''}...`, { level: 'warning' });
            await waitForRetryDelay(delay, log);
            await log('\n🔄 Retrying now...');
            retryCount++;
            return await executeWithRetry();
          }
          await log(`\n\n❌ ${retryableError.label} persisted after ${maxRetries} retries`, { level: 'error' });
        } else {
          await log(`\n\n❌ Codex emitted error event: ${codexErrorSummary.message}`, { level: 'error' });
          await log(`   Error events: item=${codexErrorSummary.counts.item}, turn=${codexErrorSummary.counts.turn}, stream=${codexErrorSummary.counts.stream}`, { level: 'error' });
        }
        await logCodexResourceSnapshot({ getResourceSnapshot, log });
        return buildRunResult({ success: false, errorInfo: codexErrorSummary, result: codexErrorSummary.message });
      }
      if (exitCode !== 0) {
        const retryableError = classifyRetryableError(lastMessage);
        if (retryableError.isRetryable) {
          const isRequestTimeoutRetry = retryableError.label === 'Request timeout';
          const maxRetries = isRequestTimeoutRetry ? retryLimits.maxRequestTimeoutRetries : retryLimits.maxTransientErrorRetries;
          if (retryCount < maxRetries) {
            if (sessionId && !argv.resume) argv.resume = sessionId;
            // Issue #2037: retry same model on capacity errors before falling back; a
            // capacity-driven switch retries fast, other transient errors use standard backoff.
            const retryPlan = await prepareRetryAfterError({ tool: 'codex', argv, log, errorMessage: retryableError.message, retryCount, initialDelayMs: isRequestTimeoutRetry ? retryLimits.initialRequestTimeoutDelayMs : retryLimits.initialTransientErrorDelayMs, maxDelayMs: isRequestTimeoutRetry ? retryLimits.maxRequestTimeoutDelayMs : retryLimits.maxTransientErrorDelayMs });
            const delay = retryPlan.delay;
            const delayLabel = delay >= 60000 ? `${Math.round(delay / 60000)} min` : `${Math.round(delay / 1000)}s`;
            await log(`\n⚠️ ${retryableError.label} detected. Retry ${retryCount + 1}/${maxRetries} in ${delayLabel}${sessionId ? ' (session preserved)' : ''}...`, { level: 'warning' });
            await waitForRetryDelay(delay, log);
            await log('\n🔄 Retrying now...');
            retryCount++;
            return await executeWithRetry();
          }
          await log(`\n\n❌ ${retryableError.label} persisted after ${maxRetries} retries`, { level: 'error' });
        }
        // Check for usage limit errors first (more specific)
        const limitInfo = detectUsageLimit(lastMessage);
        if (limitInfo.isUsageLimit) {
          // Issue #1869: Trace raw limit text + parsed reset for diagnosability.
          await log(`🔍 Codex usage limit detected (exit ${exitCode}). Raw message: ${JSON.stringify(lastMessage)}`, { verbose: true });
          await log(`🔍 Parsed reset time: ${JSON.stringify(limitInfo.resetTime)}, timezone: ${JSON.stringify(limitInfo.timezone)}`, { verbose: true });
          limitReached = true;
          limitResetTime = limitInfo.resetTime;

          // Format and display user-friendly message
          // Issue #942: build proper solve resume command (preserves tool/model/dir).
          const solveResumeCmd = __codexBuildSolveResumeCmd(argv, sessionId, tempDir);
          const messageLines = formatUsageLimitMessage({
            tool: 'OpenAI Codex',
            resetTime: limitInfo.resetTime,
            sessionId,
            solveResumeCommand: solveResumeCmd,
          });
          for (const line of messageLines) {
            await log(line, { level: 'warning' });
          }
        } else if (exitCode === 130) {
          await log('\n\n⚠️ Codex command interrupted (CTRL+C)');
        } else {
          await log(`\n\n❌ Codex command failed with exit code ${exitCode}`, { level: 'error' });
        }
        await logCodexResourceSnapshot({ getResourceSnapshot, log });
        return buildRunResult({ success: false, errorInfo: getCodexErrorEventSummary(codexJsonState) });
      }
      // Issue #2102: a rejected `request_plugin_install` means codex asked for a
      // capability the preflight did not provision, and under `codex exec` that
      // request can never succeed — so a run that produced nothing is blocked,
      // not finished. Reporting it as a named failure (instead of an empty
      // success) is what makes the missing requirement visible.
      const pluginProvisioning = getCodexPluginProvisioningHealth(codexJsonState, { capabilityPreflight });
      await reportCodexPluginProvisioning({ pluginProvisioning, log });
      if (!pluginProvisioning.healthy) {
        if (sessionId && !argv.resume) argv.resume = sessionId;

        return buildRunResult({ success: false, errorInfo: getCodexErrorEventSummary(codexJsonState), pluginProvisioning, result: [pluginProvisioning.message, ...pluginProvisioning.guidance].join(' ') });
      }
      // Issue #1990: exit code 0 and the absence of a fatal codex error event are
      // necessary but NOT sufficient for success. Verify the run actually
      // completed its turn before declaring success. A broken-but-exit-0 run (the
      // codex process cut off mid-turn by disk exhaustion / OOM) previously
      // reported SUCCESS, which under docker isolation also discarded the
      // container filesystem needed to inspect and retry the failure (#1990).
      const completionHealth = getCodexCompletionHealth(codexJsonState, { lastMessage });
      if (!completionHealth.healthy) {
        await reportCodexCompletionFailure({ completionHealth, log, getResourceSnapshot });
        // Issue #1990: preserve the codex session so an outer full restart can
        // resume with context (mirrors the transient-error retry above and the
        // `--tool claude` behavior). We do NOT inline-retry within the same broken
        // container — the run is registered as a failure so the session and (under
        // docker isolation) the container filesystem are preserved for a clean
        // restart at the orchestration level.
        if (sessionId && !argv.resume) argv.resume = sessionId;
        return buildRunResult({ success: false, errorInfo: getCodexErrorEventSummary(codexJsonState), completionHealth, pluginProvisioning, incompleteSession: completionHealth.incompleteSession, diskPressureDetected: completionHealth.diskPressureDetected, result: completionHealth.reasons.join(' ') });
      }
      await log('\n\n✅ Codex command completed');

      // Issue #1263: Log if result summary was captured
      if (lastTextContent) {
        await log('📝 Captured result summary from Codex output', { verbose: true });
      } else {
        await log('⚠️ No result summary captured from Codex output or last-message file', { level: 'warning', verbose: true });
      }
      return buildRunResult({ success: true, pluginProvisioning });
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
        errorInfo: { hasError: true, message: error.message, events: [{ type: 'exception', message: error.message }], counts: { item: 0, turn: 0, stream: 0 } },
        result: error.message,
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
  // Issue #2119: keep AI tool scratch state out of this check and of `git add -A`.
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
