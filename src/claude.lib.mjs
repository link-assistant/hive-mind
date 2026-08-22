#!/usr/bin/env node
import { ensureUseM } from './use-m-bootstrap.lib.mjs';
if (typeof globalThis.use === 'undefined') {
  await ensureUseM();
}
const fs = (await use('fs')).promises;
const path = (await use('path')).default;
import { isENOSPC, buildToolErrorMessage } from './lib.mjs';
import { reportError } from './sentry.lib.mjs';
import { timeouts, retryLimits, claudeCode, getClaudeEnv, getMaxOutputTokensForModel } from './config.lib.mjs';
import { detectUsageLimit, formatUsageLimitMessage, isUsageLimitError } from './usage-limit.lib.mjs';
import { detectSubscriptionError, SUBSCRIPTION_BLOCKED_MARKER } from './subscription-error.lib.mjs'; // Issue #2161
import { createInteractiveHandler } from './interactive-mode.lib.mjs';
import { setupBidirectionalHandler, finalizeBidirectionalHandler, validateBidirectionalModeConfig, attachStreamingInput } from './bidirectional-interactive.lib.mjs';
import { initProgressMonitoring } from './solve.progress-monitoring.lib.mjs';
import { sanitizeObjectStrings } from './unicode-sanitization.lib.mjs';
import { createSubAgentCallEntry, accumulateSubAgentUsage, displaySessionTokenUsage } from './claude.budget-stats.lib.mjs';
import { buildClaudeResumeCommand, buildClaudeAutonomousResumeCommand } from './claude.command-builder.lib.mjs';
import { beginAnthropicCostScope, seedCumulativeAnthropicCost, addAnthropicRunCost, captureAnthropicResultCost } from './anthropic-cost-accumulator.lib.mjs'; // Issues #1886, #2056, #2119
import { buildSolveResumeCommand } from './solve.resume-command.lib.mjs'; // Issue #942
import { SESSION_FORCE_KILLED_MARKER, postTrackedComment } from './tool-comments.lib.mjs'; // Issue #1625
import { handleClaudeRuntimeSwitch } from './claude.runtime-switch.lib.mjs'; // see issue #1141
import { CLAUDE_MODELS as availableModels, mapClaudeSubAgentModelToEnvValue } from './models/index.mjs'; // Issue #1221, #1978
import { applyFormalAiPricingOverride } from './formal-ai-pricing.lib.mjs'; // Issue #2119
import { isPrepareOnly, logPreparedToolCommand, resolveFormalAiToolExecution } from './formal-ai.lib.mjs';
import { buildMcpConfigWithoutPlaywright, ensureClaudePlaywrightMcpServer } from './playwright-mcp.lib.mjs';
import { resolveClaudeSessionToolFlags } from './useless-tools.lib.mjs';
import { ensureClaudeQuietConfig } from './claude-quiet-config.lib.mjs';
import { fetchModelInfo } from './model-info.lib.mjs';
import { classifyRetryableError, createTransientRetryBudget, describeClassificationEvidence, logExecutionContext, prepareRetryAfterError, waitWithCountdown } from './tool-retry.lib.mjs';
import { resolveSubSessionSize } from './sub-session-size.lib.mjs'; // Issue #1706
import { withAgentsMdAsClaudeMd } from './agents-md-claude-support.lib.mjs';
import { deployHandoffSkill } from './handoff-skill.lib.mjs'; // Issue #1877
import { createThinkingBlockRecovery } from './claude.thinking-block-recovery.lib.mjs'; // Issue #1834 (PR #1835 feedback)
import { buildMissingClaudeResultMessage, collectClaudeStreamEventFacts, getClaudeMessageContent, shouldFailClaudeStreamWithoutResult } from './claude.stream-events.lib.mjs';
import { formatNumber, mapModelToId, checkModelVisionCapability } from './claude.model-utils.lib.mjs';
import { renameLogToSessionId } from './session-log-rename.lib.mjs'; // Issue #2160
import { showResumeCommand } from './claude.resume-output.lib.mjs';
import { stringifyErrorValue } from './error-text.lib.mjs'; // Issue #2141
import { createPullRequestBaseBranchCommandIntervention } from './solve.pr-base-command-intervention.lib.mjs';
import { getClaudeVersion, resolveThinkingSettings, setClaudeVersion, validateClaudeConnection } from './claude.connection.lib.mjs';
export { availableModels, fetchModelInfo }; // Re-export for backward compatibility
export { formatNumber, mapModelToId, checkModelVisionCapability };
export { getClaudeVersion, resolveThinkingSettings, setClaudeVersion, validateClaudeConnection };
export { handleClaudeRuntimeSwitch };
export const checkPlaywrightMcpAvailability = ensureClaudePlaywrightMcpServer;
export const executeClaude = async params => {
  const { issueUrl, issueNumber, prNumber, prUrl, branchName, tempDir, workspaceTmpDir, isContinueMode, mergeStateStatus, forkedRepo, feedbackLines, forkActionsUrl, owner, repo, argv, log, setLogFile, getLogFile, formatAligned, getResourceSnapshot, claudePath, $ } = params;
  // Issue #2056: reset fresh sessions while retaining issue #1886's true-resume accumulation.
  beginAnthropicCostScope({ resume: argv.resume, previousAnthropicCost: argv.previousAnthropicCost });
  if (argv.promptSubagentsViaAgentCommander) {
    try {
      await $`which start-agent`;
      argv.agentCommanderInstalled = true;
    } catch {
      argv.agentCommanderInstalled = false;
      await log('⚠️  agent-commander not installed; prompt guidance will be skipped (npm i -g @link-assistant/agent-commander)');
    }
  }
  const { buildUserPrompt, buildSystemPrompt } = await import('./claude.prompts.lib.mjs');
  const mappedModel = mapModelToId(argv.model);
  const modelSupportsVision = await checkModelVisionCapability(mappedModel);
  if (argv.verbose) {
    await log(`👁️  Model vision capability: ${modelSupportsVision ? 'supported' : 'not supported'}`, { verbose: true });
  }
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
  const escapedPrompt = prompt.replace(/"/g, '\\"').replace(/\$/g, '\\$');
  const escapedSystemPrompt = systemPrompt.replace(/"/g, '\\"').replace(/\$/g, '\\$');
  // Issue #1877: deploy the experimental HANDOFF.md Agent Skill so Claude loads
  // it natively from .claude/skills/handoff/SKILL.md (no-op unless --use-handoff).
  await deployHandoffSkill({ tempDir, argv, log, $ });
  return await withAgentsMdAsClaudeMd({ tempDir, branchName, argv, prompt, fs, path, $, log, formatAligned }, () =>
    executeClaudeCommand({
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
      // Issue #1708: forwarded so the bidirectional handler can poll
      // issue title/body changes and uncommitted changes during the session.
      issueNumber,
    })
  );
};
// Issue #1710: calculateModelCost extracted to ./claude.cost.lib.mjs to keep
// this file under the 1500-line repo cap (see check-file-line-limits CI job).
import { calculateModelCost } from './claude.cost.lib.mjs';
export { calculateModelCost };
// Issue #2175: session token accounting lives in claude.session-tokens.lib.mjs
// so this file stays under the 1350-line early-warning threshold (issue #1593).
import { calculateSessionTokens } from './claude.session-tokens.lib.mjs';
export { calculateSessionTokens };
// Extracted to claude.stderr.lib.mjs (Issue #477, #1337)
import { isStderrError } from './claude.stderr.lib.mjs';
import { ensureAiToolScratchIgnored, filterAiToolScratchFromStatus } from './ai-tool-scratch.lib.mjs';
export { isStderrError };
export const executeClaudeCommand = async params => {
  const {
    tempDir,
    branchName,
    prompt,
    systemPrompt,
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
    // Issue #1708: enables status streaming (CI/uncommitted/PR-metadata)
    // and issue body/title polling in setupBidirectionalHandler.
    issueNumber,
  } = params;
  const expectedBaseBranch = String(argv?.baseBranch || '').trim();
  const escapePromptForShell = promptText => String(promptText).replace(/"/g, '\\"').replace(/\$/g, '\\$');
  await validateBidirectionalModeConfig(argv, log);
  let retryCount = 0;
  // Issue #2169: total-time budget shared by every transient-error retry of this run (default
  // 12 h). Created outside executeWithRetry so the elapsed clock survives the recursive calls.
  const transientRetryBudget = createTransientRetryBudget();
  let baseBranchInterventionPrompt = null;
  let baseBranchInterventionResumeCount = 0;
  // Issue #1834 (PR #1835 feedback): corrupted-thinking-block recovery — resume the session first,
  // then escalate to a fresh restart, auto-committing uncommitted work before each attempt. Created
  // once so its resume/restart caps persist across recursive retry calls.
  const tryThinkingBlockRecovery = createThinkingBlockRecovery({ argv, tempDir, branchName, $, log });
  const executeWithRetry = async () => {
    const promptForAttempt = baseBranchInterventionPrompt ? `${prompt}\n\n${baseBranchInterventionPrompt}\n` : prompt;
    const escapedPromptForAttempt = escapePromptForShell(promptForAttempt);
    if (retryCount === 0) {
      await log(`\n${formatAligned('🤖', 'Executing Claude:', argv.model.toUpperCase())}`);
    } else {
      // Issue #2169: the count cap is a backstop now, so report the retry budget instead.
      await log(`\n${formatAligned('🔄', 'Retry attempt:', `${retryCount} (${transientRetryBudget.describeProgress()})`)}`);
    }
    if (argv.verbose) {
      // Issue #1949: logExecutionContext shows the requested alias with its resolved
      // full ID (e.g. "opus (claude-opus-4-8)"). The old `argv.model === 'opus' ?
      // 'opus' : 'sonnet'` heuristic mislabelled every non-"opus" alias as "sonnet".
      await logExecutionContext({ log, model: argv.model, tool: 'claude', tempDir, branchName, promptLength: promptForAttempt.length, systemPromptLength: systemPrompt.length, feedbackLines });
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
    let isRateLimitError = false; // Issue #1924: server-side 429 temporary rate limiting
    // Issue #2161: account/subscription-level block (e.g. oauth_org_not_allowed).
    // Terminal — never retried, never model-switched; carried out to the caller
    // so /solve can stop with a specific diagnosis instead of a generic failure.
    let subscriptionError = null;
    let apiMarkedNotRetryable = false;
    let resultNumTurns = 0;
    let stderrErrors = [];
    let resultSuccessReceived = false;
    let anthropicTotalCostUSD = null;
    // Issue #1886: a usage-limit hit ends as is_error (no success result). Keep
    // the latest cost from ANY result event as a fallback for the failure path.
    let anthropicCostFromAnyResult = null;
    let errorDuringExecution = false;
    let resultSummary = null;
    let resultModelUsage = null;
    let lastToolResultError = null;
    // Issue #2160: an in-session tool failure the AI handles itself (a blocked command, its own
    // Bash timeout, a bare non-zero exit status). Kept apart from lastToolResultError so it is not
    // reported as the session error, but still available as the last-resort detail for a
    // truncated stream that has nothing better to point at (issue #2023).
    let lastBenignToolResultError = null;
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
    const bidirectionalHandler = await setupBidirectionalHandler({ argv, owner, repo, prNumber, issueNumber, tempDir, $, log });
    const progressMonitor = await initProgressMonitoring(argv, { owner, repo, prNumber, $, log }); // works with or without --interactive-mode
    let execCommand;
    const mappedModel = mapModelToId(argv.model);
    // Issue #2130: Formal AI runs the native CLI against a local Formal AI server (no argv wrapper).
    const toolInvocation = await resolveFormalAiToolExecution({ tool: 'claude', model: argv.model, toolPath: claudePath, workdir: tempDir, log, verbose: argv.verbose, prepareOnly: isPrepareOnly(argv) });
    const resolvedPlanModel = argv.planModel ? mapModelToId(argv.planModel) : undefined; // Issue #1223
    const resolvedSubAgentModel = argv.subAgentModel ? mapClaudeSubAgentModelToEnvValue(argv.subAgentModel) : undefined; // Issue #1978
    const effectiveModel = resolvedPlanModel ? 'opusplan' : mappedModel;
    const resolvedExecutionModel = resolvedPlanModel ? mappedModel : undefined;
    // Issue #1949: Let Claude Code's `--fallback-model` handle transient overloads and retry
    // the primary each turn. Only for plain `--model` runs with a distinct fallback.
    const mappedFallbackModel = argv.fallbackModel ? mapModelToId(argv.fallbackModel) : undefined;
    const useClaudeFallbackModel = !resolvedPlanModel && mappedFallbackModel && mappedFallbackModel !== effectiveModel;
    let claudeArgs = `--output-format stream-json --verbose --dangerously-skip-permissions --model ${effectiveModel}`;
    if (useClaudeFallbackModel) claudeArgs += ` --fallback-model ${mappedFallbackModel}`;
    let queuedFeedback = [];
    // Issue #817: When --accept-incomming-comments-as-input is set and we are
    // not resuming a prior session, drive Claude via NDJSON stream-json input
    // so incoming PR comments can be streamed as additional user turns.
    const streamingInput = !!(argv.acceptIncommingCommentsAsInput && bidirectionalHandler && !argv.resume);
    if (argv.resume) {
      await log(`🔄 Resuming from session: ${argv.resume}`);
      claudeArgs = `--resume ${argv.resume} ${claudeArgs}`;
    }
    const claudeWorkLanguage = await import('./i18n.lib.mjs').then(i18n => i18n.getWorkLocale?.() ?? null).catch(() => null);
    await ensureClaudeQuietConfig({ log, workLanguage: claudeWorkLanguage });
    const { mcpConfigPath, disallowedToolsList } = await resolveClaudeSessionToolFlags({ argv, log, fallbackBuildMcpConfigWithoutPlaywright: buildMcpConfigWithoutPlaywright });
    if (mcpConfigPath) claudeArgs += ` --strict-mcp-config --mcp-config "${mcpConfigPath}"`;
    if (disallowedToolsList.length) claudeArgs += ` --disallowedTools ${disallowedToolsList.join(' ')}`;
    if (streamingInput) {
      // Prompt is delivered as the first NDJSON frame on stdin (not as -p).
      claudeArgs += ` -p --input-format stream-json --append-system-prompt "${escapedSystemPrompt}"`;
    } else {
      claudeArgs += ` -p "${escapedPromptForAttempt}" --append-system-prompt "${escapedSystemPrompt}"`;
    }
    const fullCommand = `(cd "${tempDir}" && ${toolInvocation.displayCommand} ${claudeArgs} | jq -c .)`;
    const preparedResult = await logPreparedToolCommand({ argv, fullCommand, log, formatAligned });
    if (preparedResult) return preparedResult;
    if (argv.verbose) {
      await log(`📋 User prompt:\n---BEGIN USER PROMPT---\n${promptForAttempt}\n---END USER PROMPT---`, { verbose: true });
      await log(`📋 System prompt:\n---BEGIN SYSTEM PROMPT---\n${systemPrompt}\n---END SYSTEM PROMPT---`, { verbose: true });
    }
    try {
      const { thinkingBudget: resolvedThinkingBudget, thinkLevel, isNewVersion, maxBudget } = await resolveThinkingSettings(argv, log);
      const { parsed: parsedSubSessionSize, contextWindowTokens } = await resolveSubSessionSize({ rawValue: argv.subSessionSize, tool: 'claude', modelId: effectiveModel, fetchModelInfo, log });
      // Issue #817: streaming mode sets exitAfterStopDelayMs=60000 so the headless Claude process stays alive between NDJSON turns.
      // Issue #2130: `toolInvocation.env` points the native CLI at the local Formal AI server (base URL + API key).
      const claudeEnv = { ...getClaudeEnv({ thinkingBudget: resolvedThinkingBudget, model: effectiveModel, thinkLevel, maxBudget, planModel: resolvedPlanModel, executionModel: resolvedExecutionModel, subAgentModel: resolvedSubAgentModel, showThinkingContent: argv.showThinkingContent, exitAfterStopDelayMs: streamingInput ? 60_000 : undefined, disable1mContext: !!argv.disable1mContext, subSessionSize: parsedSubSessionSize, contextWindowTokens }), ...toolInvocation.env };
      if (argv.verbose) claudeEnv.ANTHROPIC_LOG = 'debug';
      const modelMaxOutputTokens = getMaxOutputTokensForModel(effectiveModel);
      if (argv.verbose) {
        await log(`📊 CLAUDE_CODE_MAX_OUTPUT_TOKENS: ${modelMaxOutputTokens}, MCP_TIMEOUT: ${claudeCode.mcpTimeout}ms, MCP_TOOL_TIMEOUT: ${claudeCode.mcpToolTimeout}ms, ANTHROPIC_LOG: debug`, { verbose: true });
        if (resolvedPlanModel) await log(`📊 opusplan: plan=${resolvedPlanModel}, exec=${resolvedExecutionModel}`, { verbose: true });
        if (claudeEnv.CLAUDE_CODE_SUBAGENT_MODEL) await log(`📊 CLAUDE_CODE_SUBAGENT_MODEL: ${claudeEnv.CLAUDE_CODE_SUBAGENT_MODEL}`, { verbose: true });
        if (resolvedThinkingBudget !== undefined) await log(`📊 MAX_THINKING_TOKENS: ${resolvedThinkingBudget}`, { verbose: true });
        if (claudeEnv.CLAUDE_CODE_EFFORT_LEVEL) await log(`📊 CLAUDE_CODE_EFFORT_LEVEL: ${claudeEnv.CLAUDE_CODE_EFFORT_LEVEL}`, { verbose: true });
        if (claudeEnv.CLAUDE_CODE_SHOW_THINKING) await log(`📊 CLAUDE_CODE_SHOW_THINKING: ${claudeEnv.CLAUDE_CODE_SHOW_THINKING}`, { verbose: true });
        // Issue #1706: log applied env vars (--disable-1m-context, --sub-session-size).
        const sub1706 = ['CLAUDE_CODE_DISABLE_1M_CONTEXT', 'CLAUDE_CODE_AUTO_COMPACT_WINDOW', 'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE'].filter(k => claudeEnv[k]).map(k => `${k}=${claudeEnv[k]}`);
        if (sub1706.length) await log(`📊 ${sub1706.join(', ')}`, { verbose: true });
        if (!isNewVersion && thinkLevel) await log(`📊 Thinking level (via keywords): ${thinkLevel}`, { verbose: true });
      }
      const simpleEscapedSystem = systemPrompt.replace(/"/g, '\\"');
      const mcpDisableArgs = mcpConfigPath ? ['--strict-mcp-config', '--mcp-config', mcpConfigPath] : [];
      const disallowedToolsArgs = disallowedToolsList.length ? ['--disallowedTools', ...disallowedToolsList] : [];
      const fallbackModelArgs = useClaudeFallbackModel ? ['--fallback-model', mappedFallbackModel] : []; // Issue #1949: Claude Code's per-request overload fallback
      if (useClaudeFallbackModel && argv.verbose) await log(`📊 Claude --fallback-model: ${mappedFallbackModel} (Issue #1949 — primary --model ${effectiveModel} stays stable across overload retries)`, { verbose: true });
      if (argv.resume) {
        const simpleEscapedPrompt = promptForAttempt.replace(/"/g, '\\"');
        execCommand = $({ cwd: tempDir, mirror: false, env: claudeEnv })`${toolInvocation.command} --resume ${argv.resume} --output-format stream-json --verbose --dangerously-skip-permissions --model ${effectiveModel} ${fallbackModelArgs} ${mcpDisableArgs} ${disallowedToolsArgs} -p "${simpleEscapedPrompt}" --append-system-prompt "${simpleEscapedSystem}"`;
      } else if (streamingInput) {
        // Issue #817: Drive Claude via --input-format stream-json on a pipe
        // stdin. Initial prompt + later PR comments are written as NDJSON
        // frames by attachStreamingInput (see bidirectional-interactive.lib.mjs).
        const streamingInputArgs = ['-p', '--input-format', 'stream-json'];
        execCommand = $({ cwd: tempDir, stdin: 'pipe', mirror: false, env: claudeEnv })`${toolInvocation.command} --output-format stream-json --verbose --dangerously-skip-permissions --model ${effectiveModel} ${fallbackModelArgs} ${mcpDisableArgs} ${disallowedToolsArgs} ${streamingInputArgs} --append-system-prompt "${simpleEscapedSystem}"`;
      } else {
        execCommand = $({ cwd: tempDir, stdin: promptForAttempt, mirror: false, env: claudeEnv })`${toolInvocation.command} --output-format stream-json --verbose --dangerously-skip-permissions --model ${effectiveModel} ${fallbackModelArgs} ${mcpDisableArgs} ${disallowedToolsArgs} --append-system-prompt "${simpleEscapedSystem}"`;
      }
      if (streamingInput) {
        await attachStreamingInput(bidirectionalHandler, execCommand, promptForAttempt, log, !!argv.verbose);
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
      const baseBranchCommandIntervention = createPullRequestBaseBranchCommandIntervention({
        expectedBaseBranch,
        prNumber,
        log,
        toolLabel: 'Claude',
        sendInput: message => (streamingInput && bidirectionalHandler?.sendFeedback ? bidirectionalHandler.sendFeedback(message, { kind: 'metadata' }) : false),
        stopSession: async () => {
          if (forceExitTriggered || !execCommand?.kill) return false;
          forceExitTriggered = true;
          killProcessTree('SIGTERM');
          return true;
        },
      });
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
              if (data === null || typeof data !== 'object') continue; // Issue #1968: skip bare null/primitive NDJSON lines
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
              await baseBranchCommandIntervention.handleStreamEvent(data);
              if (!sessionId && data.session_id) {
                sessionId = data.session_id;
                await log(`📌 Session ID: ${sessionId}`);
                // Issue #2160: shared implementation, so restart/watch iterations rename their
                // logs too and a caller that forgets the accessors gets a named reason.
                const renameResult = await renameLogToSessionId({ sessionId, getLogFile, setLogFile, log });
                if (!renameResult.ok && renameResult.error) {
                  reportError(renameResult.error, {
                    context: 'rename_session_log',
                    sessionId,
                    sessionLogFile: renameResult.sessionLogFile,
                    operation: 'rename_log_file',
                  });
                }
              }
              const eventFacts = collectClaudeStreamEventFacts(data);
              messageCount += eventFacts.messageCountDelta;
              toolUseCount += eventFacts.toolUseCountDelta;
              if (eventFacts.lastText) lastMessage = eventFacts.lastText;
              if (!resultSummary && eventFacts.compactionSummary) {
                resultSummary = eventFacts.compactionSummary;
                await log('📝 Captured fallback summary from Claude compaction context', { verbose: true });
              }
              if (eventFacts.toolResultError) {
                // Issue #2160: an in-session tool failure the AI handles itself is not a warning,
                // and it must not replace the last assistant message — that message is what a
                // truncated-stream failure is reported "after".
                if (eventFacts.toolResultErrorIsBenign) {
                  lastBenignToolResultError = eventFacts.toolResultError;
                  await log(`ℹ️ In-session tool result (${eventFacts.toolResultErrorCategory}): ${eventFacts.toolResultError.substring(0, 200)}`, { verbose: true });
                } else {
                  lastToolResultError = eventFacts.toolResultError;
                  await log(`⚠️ Tool result error detected: ${eventFacts.toolResultError.substring(0, 200)}`, { verbose: true });
                }
              }
              // Issue #1708: signal busy/idle to the bidirectional handler so
              // queue-comments-to-input mode can hold frames until the AI is
              // idle. Any assistant/tool_use/system event means the AI is
              // actively processing; a result event means the turn is done
              // and queued frames can flush.
              if (bidirectionalHandler) {
                if (data.type === 'assistant' || data.type === 'tool_use' || data.type === 'tool_result') {
                  if (typeof bidirectionalHandler.markAiBusy === 'function') {
                    bidirectionalHandler.markAiBusy();
                  }
                }
              }
              if (progressMonitor) await progressMonitor.processStreamEvent(data).catch(e => log(`⚠️ Progress: ${e.message}`, { verbose: true }));
              if (data.type === 'result') {
                if (!resultEventReceived) {
                  resultEventReceived = true;
                  await log(`📌 Result event received, starting ${streamCloseTimeoutMs / 1000}s stream close timeout (Issue #1280)`, { verbose: true });
                  resultTimeoutId = setTimeout(forceExitOnTimeout, streamCloseTimeoutMs);
                }
                // Issue #1708: result event = AI is idle and waiting for next
                // user input. Flush any frames queued by --queue-comments-to-input.
                if (bidirectionalHandler && typeof bidirectionalHandler.markAiIdle === 'function') {
                  try {
                    await bidirectionalHandler.markAiIdle();
                  } catch (idleErr) {
                    if (argv.verbose) await log(`⚠️ Bidirectional mode: markAiIdle error: ${idleErr.message}`, { verbose: true });
                  }
                }
                if (data.subtype === 'success') resultSuccessReceived = true;
                const capturedCost = await captureAnthropicResultCost({ data, model: argv.model, log });
                if (capturedCost?.total !== undefined) anthropicTotalCostUSD = capturedCost.total;
                if (capturedCost?.fallback !== undefined) anthropicCostFromAnyResult = capturedCost.fallback;
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
                  // Issue #1924: server-side temporary rate limiting (HTTP 429) is a transient
                  // throttle ("...not your usage limit..."), so retry with --resume. Issue #1935
                  // (regression from #1924): account usage limits ("session limit" / "weekly limit")
                  // ALSO arrive with api_error_status === 429 plus an explicit reset time, so the
                  // isUsageLimitError() guard routes those to the usage-limit handler below instead.
                  if (data.api_error_status === 429 && !isUsageLimitError(lastMessage)) {
                    isRateLimitError = true;
                    await log(`⚠️ Detected server-side rate limiting (429) from Claude CLI (will retry with --resume). request_id=${data.request_id || 'unknown'}`, { verbose: true });
                  }
                  // Issue #2161: account/subscription block. `data.error` carries the
                  // machine-readable code ("oauth_org_not_allowed" for the reported
                  // case) alongside api_error_status 403 — a far stronger signal than
                  // the rendered sentence, so it is passed to the detector first.
                  if (!subscriptionError) {
                    subscriptionError = detectSubscriptionError({
                      message: lastMessage,
                      tool: 'claude',
                      errorCode: typeof data.error === 'string' ? data.error : null,
                      apiErrorStatus: data.api_error_status,
                      terminalReason: data.terminal_reason,
                    });
                    if (subscriptionError) {
                      // Not verbose: this is the reason the whole run is about to end.
                      await log(`${SUBSCRIPTION_BLOCKED_MARKER} — ${subscriptionError.label}`);
                      await log(`   code=${subscriptionError.code || 'n/a'} http=${data.api_error_status || 'n/a'} terminal_reason=${data.terminal_reason || 'n/a'} request_id=${data.request_id || 'unknown'}`, { verbose: true });
                    }
                  }
                  // Issue #1834: Detect corrupted extended-thinking-block 400 (un-resumable session).
                  // Capture diagnostics (request id, content path) to aid debugging and upstream reports.
                  if ((lastMessage.includes('thinking') || lastMessage.includes('redacted_thinking')) && lastMessage.includes('cannot be modified')) {
                    const contentPath = (lastMessage.match(/messages\.\d+\.content\.\d+/) || [])[0] || 'unknown';
                    await log(`🧠 Detected corrupted thinking-block error (un-resumable session). request_id=${data.request_id || 'unknown'}, at=${contentPath}. Will discard the session and restart fresh (Issue #1834, upstream anthropics/claude-code#63147).`, { verbose: true });
                  }
                }
              }
              if (data.type === 'text' && data.text) lastMessage = data.text;
              else if (data.type === 'error') {
                lastMessage = stringifyErrorValue(data.error, { fallback: JSON.stringify(data) }); // Issue #2141: `data.error` is often an object; render it as text so the reason is never "[object Object]" and the substring checks below get a real string
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
              // Issue #2161: Claude Code injects API failures as synthetic assistant
              // messages flagged `is_api_error_message` and carrying the error code.
              // In the reported run this arrived ~40s before the terminal result
              // event, so detecting it here surfaces the diagnosis earlier.
              if (data.type === 'assistant' && data.is_api_error_message === true && !subscriptionError) {
                const apiErrorText = getClaudeMessageContent(data)
                  .filter(item => item.type === 'text' && item.text)
                  .map(item => item.text)
                  .join('\n');
                subscriptionError = detectSubscriptionError({
                  message: apiErrorText,
                  tool: 'claude',
                  errorCode: typeof data.error === 'string' ? data.error : null,
                });
                if (subscriptionError) {
                  if (apiErrorText) lastMessage = apiErrorText;
                  await log(`${SUBSCRIPTION_BLOCKED_MARKER} — ${subscriptionError.label}`);
                  await log(`   code=${subscriptionError.code || 'n/a'} request_id=${data.request_id || 'unknown'} uuid=${data.uuid || 'unknown'}`, { verbose: true });
                }
              }
              if (data.type === 'assistant' && data.message && data.message.content) {
                const content = getClaudeMessageContent(data);
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
                await log(line, { stream: 'stdout' });
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
          await baseBranchCommandIntervention.handleStreamEvent(data);
          const eventFacts = collectClaudeStreamEventFacts(data);
          messageCount += eventFacts.messageCountDelta;
          toolUseCount += eventFacts.toolUseCountDelta;
          if (eventFacts.lastText) lastMessage = eventFacts.lastText;
          if (!resultSummary && eventFacts.compactionSummary) resultSummary = eventFacts.compactionSummary;
          // Issue #2160: same classification as the streaming path above.
          if (eventFacts.toolResultError && eventFacts.toolResultErrorIsBenign) {
            lastBenignToolResultError = eventFacts.toolResultError;
          } else if (eventFacts.toolResultError) {
            lastToolResultError = eventFacts.toolResultError;
          }
          if (data?.type === 'result') {
            resultEventReceived = true;
            if (data.subtype === 'success') {
              resultSuccessReceived = true;
              if (data.result && typeof data.result === 'string') resultSummary = data.result;
              if (data.modelUsage) resultModelUsage = data.modelUsage;
            }
            const capturedCost = await captureAnthropicResultCost({ data, model: argv.model, log });
            if (capturedCost?.total !== undefined) anthropicTotalCostUSD = capturedCost.total;
            if (capturedCost?.fallback !== undefined) anthropicCostFromAnyResult = capturedCost.fallback;
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
          if (!stdoutLineBuffer.includes('node:internal')) await log(stdoutLineBuffer, { stream: 'stdout' });
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

      // Issue #817: Stop bidirectional mode monitoring and collect queued feedback
      queuedFeedback = await finalizeBidirectionalHandler(bidirectionalHandler, log);
      const baseBranchIntervention = baseBranchCommandIntervention.getIntervention();
      if (baseBranchIntervention && !baseBranchCommandIntervention.wasSent()) {
        if ((sessionId || argv.resume) && baseBranchInterventionResumeCount < 1) {
          argv.resume = sessionId || argv.resume;
          baseBranchInterventionPrompt = baseBranchIntervention.message;
          baseBranchInterventionResumeCount++;
          await log('\n🔄 Resuming Claude with requested base-branch correction prompt...');
          return await executeWithRetry();
        }

        return {
          success: false,
          sessionId,
          limitReached,
          limitResetTime,
          limitTimezone,
          messageCount,
          toolUseCount,
          errorDuringExecution,
          anthropicTotalCostUSD,
          resultSummary,
          errorInfo: {
            message: baseBranchIntervention.message,
            violation: baseBranchIntervention.violation,
          },
          queuedFeedback,
        };
      }
      if (shouldFailClaudeStreamWithoutResult({ commandFailed, streamingInput, resultEventReceived })) {
        commandFailed = true;
        lastMessage = buildMissingClaudeResultMessage({ lastToolResultError, lastMessage, lastBenignToolResultError });
        await log(`\n\n❌ Command failed: ${lastMessage}`, { level: 'error' });
      }
      const retryableLastError = classifyRetryableError(lastMessage);
      // Issue #1834: Corrupted extended-thinking blocks → try to resume the session first, then fall
      // back to a fresh restart (PR #1835 feedback). When both caps are reached, tryThinkingBlockRecovery
      // logs the failure and returns false; we fall through to the normal commandFailed return below
      // (the 400 is not a transient pattern, so it is not retried).
      if (commandFailed && retryableLastError.requiresFreshSession && (await tryThinkingBlockRecovery({ classified: retryableLastError, source: 'result', sessionId }))) {
        beginAnthropicCostScope({ resume: argv.resume, previousAnthropicCost: argv.previousAnthropicCost });
        return await executeWithRetry();
      }
      // Issues #1331, #1353, #1472/#1475: Unified transient error retry (exponential backoff, session preservation)
      const isTransientError = isStartupTimeout || isActivityTimeout || isOverloadError || isInternalServerError || is503Error || isRequestTimeout || isRateLimitError || retryableLastError.isRetryable || (lastMessage.includes('API Error: 500') && (lastMessage.includes('Overloaded') || lastMessage.includes('Internal server error'))) || (lastMessage.includes('API Error: 529') && (lastMessage.includes('overloaded_error') || lastMessage.includes('Overloaded'))) || (lastMessage.includes('api_error') && lastMessage.includes('Overloaded')) || (lastMessage.includes('overloaded_error') && lastMessage.includes('Overloaded')) || lastMessage.includes('API Error: 503') || (lastMessage.includes('503') && (lastMessage.includes('upstream connect error') || lastMessage.includes('remote connection failure'))) || lastMessage === 'Request timed out' || lastMessage.includes('Request timed out');
      // Issue #2169: a run that ended in a *successful* result event must never be retried.
      // `lastMessage` holds the agent's own last text, so any prose that merely looks like an API
      // error ("PR #524", "API Error: 503" quoted while working on an issue about it) used to flip
      // `isTransientError` on and send a finished session into the retry loop. In the reported run
      // all 11 attempts succeeded and were retried anyway, burning 3 h 54 min before the process
      // exited 1 with the summary text presented as the error.
      const runProducedSuccess = resultSuccessReceived && !commandFailed && !errorDuringExecution && exitCode === 0;
      if (runProducedSuccess && isTransientError) {
        await log(`🔍 Transient-error pattern seen in a successful run — not retrying (Issue #2169). Pattern: ${retryableLastError.label || 'flagged by stream detector'}; last message: ${JSON.stringify(lastMessage.substring(0, 200))}`, { verbose: true });
        await log(`   Classification evidence: ${describeClassificationEvidence(lastMessage, retryableLastError.label)}`, { verbose: true });
      }
      // Issue #2161: an account/subscription block short-circuits every retry
      // path. Stale transient flags from earlier in the run (an overload at hour
      // one, say) must not schedule a retry that is guaranteed to fail the same
      // way — and each retry would burn another full startup against a provider
      // that has already refused the credentials.
      if (!runProducedSuccess && isTransientError && !subscriptionError) {
        // Issue #1472/#1475: Startup/activity timeout → 30s–2min backoff; #1353: Request timeout → 5min–1hr; general → 3min–30min
        const isTimeoutRetry = isStartupTimeout || isActivityTimeout;
        // Issue #2169: stream timeouts keep their own short count cap; API errors are governed by
        // the 12-hour budget with a 3-minute floor on every wait.
        const maxRetries = isTimeoutRetry ? retryLimits.maxStreamTimeoutRetries : isRequestTimeout ? retryLimits.maxRequestTimeoutRetries : retryLimits.maxTransientErrorRetries;
        const initialDelay = isTimeoutRetry ? 30000 : isRequestTimeout ? retryLimits.initialRequestTimeoutDelayMs : retryLimits.initialTransientErrorDelayMs;
        const maxDelay = isTimeoutRetry ? 120000 : isRequestTimeout ? retryLimits.maxRequestTimeoutDelayMs : retryLimits.maxTransientErrorDelayMs;
        const minDelay = isTimeoutRetry ? 0 : retryLimits.minTransientErrorDelayMs;
        const retryDecision = transientRetryBudget.evaluate({ retryCount, maxRetries, initialDelayMs: initialDelay, maxDelayMs: maxDelay, minDelayMs: minDelay });
        // Issue #1437: Fail fast when API signals x-should-retry: false AND session made no progress
        const isStuckRetry = apiMarkedNotRetryable && retryCount >= retryLimits.maxNotRetryableAttempts && resultNumTurns <= 1;
        if (isStuckRetry) {
          await log(`\n\n❌ API explicitly marked error as not retryable (x-should-retry: false) and session made no progress (num_turns=${resultNumTurns}) after ${retryCount} attempt(s)`, { level: 'error' });
          await log(`   This error is not recoverable. Failing fast to avoid a stuck retry loop (Issue #1437).`, { level: 'error' });
          await log(`   Check https://status.anthropic.com/ for API status.`, { level: 'error' });
          // Issue #1886: fold captured cost so a cross-process resume's carried-forward cost is not dropped here.
          seedCumulativeAnthropicCost(argv.previousAnthropicCost);
          const cumulativeAnthropicCostUSDOnStuckRetry = addAnthropicRunCost(anthropicTotalCostUSD ?? anthropicCostFromAnyResult);
          return {
            success: false,
            sessionId,
            limitReached: false,
            limitResetTime: null,
            limitTimezone: null,
            messageCount,
            toolUseCount,
            is503Error,
            anthropicTotalCostUSD: cumulativeAnthropicCostUSDOnStuckRetry, // Issue #1104/#1886
            resultSummary,
            // Issue #1845/#1941: surface the actual error, rejecting meaningless fragments (e.g. a lone "}")
            errorInfo: { message: buildToolErrorMessage({ lastMessage, exitCode, fallback: 'API explicitly marked error as not retryable', toolLabel: 'Claude' }), exitCode },
            subscriptionError, // Issue #2161
            queuedFeedback, // Issue #817: Bidirectional mode feedback
          };
        }
        if (retryDecision.allowed) {
          transientRetryBudget.grant();
          // Activity timeout preserves session (work was started), startup timeout does not (no session created)
          if (!isStartupTimeout && sessionId && !argv.resume) argv.resume = sessionId;
          // Issue #2037: retry same model on capacity errors before falling back; a switch retries fast.
          const retryPlan = await prepareRetryAfterError({ tool: 'claude', argv, log, errorMessage: retryableLastError.message || lastMessage, retryCount, initialDelayMs: initialDelay, maxDelayMs: maxDelay, minDelayMs: minDelay });
          const delay = retryPlan.delay;
          const errorLabel = isStartupTimeout ? 'Stream startup timeout (Issue #1472/#1475)' : isActivityTimeout ? 'Stream activity timeout (Issue #1472)' : isRequestTimeout ? 'Request timeout' : retryableLastError.label || (isOverloadError || (lastMessage.includes('API Error: 500') && lastMessage.includes('Overloaded')) || (lastMessage.includes('API Error: 529') && lastMessage.includes('Overloaded')) ? `API overload (${lastMessage.includes('529') ? '529' : '500'})` : isInternalServerError || lastMessage.includes('Internal server error') ? 'Internal server error (500)' : isRateLimitError ? 'Server rate limited (429)' : '503 network error');
          const notRetryableHint = apiMarkedNotRetryable ? ' (API says not retryable — will stop early if no progress)' : '';
          const delayLabel = delay >= 60000 ? `${Math.round(delay / 60000)} min` : `${Math.round(delay / 1000)}s`;
          const retryMode = isStartupTimeout ? ' (fresh start)' : ' (session preserved)';
          await log(`\n⚠️ ${errorLabel} detected. Retry ${retryCount + 1} in ${delayLabel}${retryMode}${notRetryableHint} (${transientRetryBudget.describeProgress()})...`, { level: 'warning' });
          await log(`   Error: ${isStartupTimeout ? `No output from Claude CLI within ${timeouts.streamStartupMs / 1000}s` : isActivityTimeout ? `No output for ${timeouts.streamActivityMs / 1000}s after previous activity` : lastMessage.substring(0, 200)}`, { verbose: true });
          // Issue #2169: the 200-character excerpt above hid the token that actually triggered the
          // classifier in the reported run, so also log where every status-looking token sits.
          await log(`   Classification evidence: ${describeClassificationEvidence(retryableLastError.message || lastMessage, errorLabel)}`, { verbose: true });
          // Issue #1510: Post PR comment when force-killing and auto-resuming so reviewers can follow the session lifecycle
          if ((isActivityTimeout || isStartupTimeout) && owner && repo && prNumber && $) {
            try {
              const timeoutType = isActivityTimeout ? 'activity' : 'startup';
              const sessionInfo = sessionId ? `\nSession ID: \`${sessionId}\`` : '';
              const resumeInfo = isStartupTimeout ? 'Session will be restarted (fresh start).' : `Session will be resumed with \`--resume\` (context preserved).`;
              const commentBody = `## :warning: ${SESSION_FORCE_KILLED_MARKER} (${timeoutType} timeout)\n\nThe working session was force-killed due to ${timeoutType} timeout (no stream output for ${isActivityTimeout ? timeouts.streamActivityMs / 1000 : timeouts.streamStartupMs / 1000}s).\n\n**Auto-resuming**: Retry ${retryCount + 1}/${maxRetries} in ${delayLabel}. ${resumeInfo}${sessionInfo}\n\n*This is an automated notification — the session will continue automatically.*`;
              const posted = await postTrackedComment({ $, owner, repo, targetNumber: prNumber, body: commentBody });
              await log(posted.ok ? `   Posted force-kill notification to PR #${prNumber}${posted.commentId ? ` (id=${posted.commentId})` : ''}` : `   Warning: Could not post force-kill comment to PR: ${posted.stderr || 'unknown error'}`, { verbose: true });
            } catch (commentError) {
              await log(`   Warning: Could not post force-kill comment to PR: ${commentError.message}`, { verbose: true });
            }
          }
          await waitWithCountdown(delay, log);
          await log('\n🔄 Retrying now...');
          retryCount++;
          return await executeWithRetry();
        } else {
          // Issue #2169: report *why* we stopped — count backstop vs 12-hour budget — and how long
          // the run actually spent retrying, so an exhausted window is diagnosable from one line.
          const exhaustionReason = transientRetryBudget.describeExhaustion(retryDecision);
          await log(`\n\n❌ Transient API error persisted: ${exhaustionReason}\n   Please try again later or check https://status.anthropic.com/\n   Raise HIVE_MIND_TRANSIENT_ERROR_RETRY_BUDGET_MS to keep retrying for longer.`, { level: 'error' });
          // Issue #1886: fold captured cost so the carried-forward cost survives this retries-exhausted path.
          seedCumulativeAnthropicCost(argv.previousAnthropicCost);
          const cumulativeAnthropicCostUSDOnRetriesExhausted = addAnthropicRunCost(anthropicTotalCostUSD ?? anthropicCostFromAnyResult);
          return {
            success: false,
            sessionId,
            limitReached: false,
            limitResetTime: null,
            limitTimezone: null,
            messageCount,
            toolUseCount,
            is503Error, // preserve for callers that check this
            anthropicTotalCostUSD: cumulativeAnthropicCostUSDOnRetriesExhausted, // Issue #1104/#1886: Include cumulative cost even on failure
            resultSummary, // Issue #1263: Include result summary
            // Issue #1845/#1941: surface the actual error, rejecting meaningless fragments (e.g. a lone "}")
            errorInfo: { message: buildToolErrorMessage({ lastMessage, exitCode, fallback: `Transient API error persisted: ${transientRetryBudget.describeExhaustion(retryDecision)}`, toolLabel: 'Claude' }), exitCode },
            subscriptionError, // Issue #2161
            queuedFeedback, // Issue #817: Bidirectional mode feedback
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
          const hasSession = tempDir && sessionId;
          // Issue #942: include all 3 resume options (interactive/autonomous/solve).
          const messageLines = formatUsageLimitMessage({
            tool: 'Anthropic Claude Code',
            resetTime: limitInfo.resetTime,
            sessionId,
            interactiveResumeCommand: hasSession ? buildClaudeResumeCommand({ tempDir, sessionId, model: argv.model }) : null,
            autonomousResumeCommand: hasSession ? buildClaudeAutonomousResumeCommand({ tempDir, sessionId, model: argv.model }) : null,
            solveResumeCommand: hasSession && argv?.url ? buildSolveResumeCommand({ issueUrl: argv.url, sessionId, tool: argv.tool || 'claude', model: argv.model, fallbackModel: argv.fallbackModel, tempDir }) : null,
          });
          for (const line of messageLines) await log(line, { level: 'warning' });
        } else if (lastMessage.includes('context_length_exceeded')) {
          await log('\n\n❌ Context length exceeded. Try with a smaller issue or split the work.', { level: 'error' });
        } else {
          await log(`\n\n❌ Claude command failed with exit code ${exitCode}`, { level: 'error' });
          if (sessionId && !argv.resume && tempDir) {
            await log(`📌 Session ID: ${sessionId}`);
            await showResumeCommand(sessionId, tempDir, claudePath, argv.model, log, argv);
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
        await showResumeCommand(sessionId, tempDir, claudePath, argv.model, log, argv);
        // Issue #1886: on failure (usually a usage-limit hit → auto-resume) fold
        // the captured cost into the cumulative total so autoContinueWhenLimitResets
        // carries it forward. A limit hit ends as is_error → fall back to the
        // non-success result cost.
        seedCumulativeAnthropicCost(argv.previousAnthropicCost);
        const cumulativeAnthropicCostUSDOnFailure = addAnthropicRunCost(anthropicTotalCostUSD ?? anthropicCostFromAnyResult);
        return {
          success: false,
          sessionId,
          limitReached,
          limitResetTime,
          limitTimezone,
          messageCount,
          toolUseCount,
          errorDuringExecution,
          anthropicTotalCostUSD: cumulativeAnthropicCostUSDOnFailure, // Issue #1104/#1886: cumulative cost even on failure
          resultSummary, // Issue #1263: Include result summary
          // Issue #1845: surface the core error (e.g. "API Error: Output blocked by content filtering policy").
          // Issue #1941: a lone "}" fragment at interrupt time must not become "CLAUDE execution failed with }".
          errorInfo: { message: buildToolErrorMessage({ lastMessage, exitCode, fallback: `Claude command failed with exit code ${exitCode}`, toolLabel: 'Claude' }), exitCode },
          subscriptionError, // Issue #2161: terminal account block — /solve stops and preserves the work
          queuedFeedback, // Issue #817: Bidirectional mode feedback
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
      // Calculate and display total token usage from session JSONL file.
      // Extracted to claude.budget-stats.lib.mjs to keep this file under the line limit (Issue #1834).
      // Issue #1886: the JSONL spans every resume iteration but each result
      // event's total_cost_usd covers only this process; seed the carried-forward
      // cost + add this process's so the cumulative total shares the JSONL scope.
      seedCumulativeAnthropicCost(argv.previousAnthropicCost);
      const cumulativeAnthropicCostUSD = addAnthropicRunCost(anthropicTotalCostUSD);
      const previousAnthropicCostUSD = cumulativeAnthropicCostUSD - (anthropicTotalCostUSD || 0);
      await displaySessionTokenUsage({ sessionId, tempDir, resultModelUsage, anthropicTotalCostUSD: cumulativeAnthropicCostUSD, previousAnthropicCostUSD, argv, log });
      await showResumeCommand(sessionId, tempDir, claudePath, argv.model, log, argv);
      return {
        success: true,
        sessionId,
        limitReached,
        limitResetTime,
        limitTimezone,
        messageCount,
        toolUseCount,
        anthropicTotalCostUSD: cumulativeAnthropicCostUSD, // Issue #1104/#1886: cumulative Anthropic cost across resume iterations
        errorDuringExecution, // Issue #1088: Track if error_during_execution subtype occurred
        resultSummary, // Issue #1263: Include result summary for --attach-solution-summary
        resultModelUsage, // Issue #1454
        streamTokenUsage: streamTokenUsage.eventCount > 0 ? streamTokenUsage : null, // Issue #1491
        subAgentCalls: subAgentCalls.length > 0 ? subAgentCalls : null, // Issue #1590
        queuedFeedback, // Issue #817: Bidirectional mode feedback
      };
    } catch (error) {
      reportError(error, {
        context: 'execute_claude',
        command: params.command,
        claudePath: params.claudePath,
        operation: 'run_claude_command',
      });
      const errorStr = error.message || error.toString();
      const retryableException = classifyRetryableError(errorStr);
      // Issue #1834: Corrupted extended-thinking blocks surfaced as a thrown exception. Same recovery
      // as the streamed-result path: resume the session first, then fall back to a fresh restart.
      if (retryableException.requiresFreshSession && (await tryThinkingBlockRecovery({ classified: retryableException, source: 'exception', sessionId }))) {
        beginAnthropicCostScope({ resume: argv.resume, previousAnthropicCost: argv.previousAnthropicCost });
        retryCount++;
        return await executeWithRetry();
      }
      // Issue #1331: Unified handler for all transient API errors in exception block
      // Issue #1353: Also handle "Request timed out" in exception block
      // (Overloaded, 503, Internal Server Error, Request timed out) - all with session preservation
      const isTimeoutException = errorStr === 'Request timed out' || errorStr.includes('Request timed out');
      const isTransientException = isTimeoutException || retryableException.isRetryable;
      if (isTransientException) {
        // Issue #1353: Use timeout-specific backoff for request timeouts
        const maxRetries = isTimeoutException ? retryLimits.maxRequestTimeoutRetries : retryLimits.maxTransientErrorRetries;
        const initialDelay = isTimeoutException ? retryLimits.initialRequestTimeoutDelayMs : retryLimits.initialTransientErrorDelayMs;
        const maxDelay = isTimeoutException ? retryLimits.maxRequestTimeoutDelayMs : retryLimits.maxTransientErrorDelayMs;
        // Issue #2169: the same 12-hour budget with a 3-minute floor governs the exception path.
        const minDelay = retryLimits.minTransientErrorDelayMs;
        const retryDecision = transientRetryBudget.evaluate({ retryCount, maxRetries, initialDelayMs: initialDelay, maxDelayMs: maxDelay, minDelayMs: minDelay });
        if (retryDecision.allowed) {
          transientRetryBudget.grant();
          if (sessionId && !argv.resume) argv.resume = sessionId;
          // Issue #2037: retry same model on capacity errors before falling back; a switch retries fast.
          const retryPlan = await prepareRetryAfterError({ tool: 'claude', argv, log, errorMessage: errorStr, retryCount, initialDelayMs: initialDelay, maxDelayMs: maxDelay, minDelayMs: minDelay });
          const delay = retryPlan.delay;
          const errorLabel = isTimeoutException ? 'Request timeout' : retryableException.label || (errorStr.includes('Overloaded') ? `API overload (${errorStr.includes('529') ? '529' : '500'})` : errorStr.includes('Internal server error') ? 'Internal server error (500)' : '503 network error');
          const delayLabel = delay >= 60000 ? `${Math.round(delay / 60000)} min` : `${Math.round(delay / 1000)}s`;
          await log(`\n⚠️ ${errorLabel} in exception. Retry ${retryCount + 1} in ${delayLabel} (session preserved, ${transientRetryBudget.describeProgress()})...`, { level: 'warning' });
          await waitWithCountdown(delay, log);
          await log('\n🔄 Retrying now...');
          retryCount++;
          return await executeWithRetry();
        }
        await log(`\n⏹️ Stopped retrying: ${transientRetryBudget.describeExhaustion(retryDecision)}`, { level: 'warning' });
      }
      await log(`\n\n❌ Error executing Claude command: ${error.message}`, { level: 'error' });
      // Issue #1886: fold captured cost so the carried-forward cost survives this exception path too.
      seedCumulativeAnthropicCost(argv.previousAnthropicCost);
      const cumulativeAnthropicCostUSDOnException = addAnthropicRunCost(anthropicTotalCostUSD ?? anthropicCostFromAnyResult);
      return {
        success: false,
        sessionId,
        limitReached,
        limitResetTime: null,
        limitTimezone: null,
        messageCount,
        toolUseCount,
        anthropicTotalCostUSD: cumulativeAnthropicCostUSDOnException, // Issue #1104/#1886: Include cumulative cost even on failure
        resultSummary, // Issue #1263: Include result summary
        // Issue #1845: surface the actual exception message so callers can show it to users
        errorInfo: { message: error.message || error.toString() },
        queuedFeedback, // Issue #817: Bidirectional mode feedback
      };
    }
  }; // End of executeWithRetry function
  // Start the execution with retry logic
  const claudeResult = (await executeWithRetry()) || {};
  // Issue #2119: `--model formal-ai` runs against the local Link.Assistant model
  // server. Claude reports no pricing record of its own, so without this the
  // session was published with Anthropic's cost and no provider at all.
  const formalAiPricing = applyFormalAiPricingOverride({ model: argv.model, pricingInfo: claudeResult.pricingInfo ?? null, publicPricingEstimate: claudeResult.publicPricingEstimate ?? null, anthropicTotalCostUSD: claudeResult.anthropicTotalCostUSD ?? null, tokenUsage: claudeResult.streamTokenUsage ?? null });
  return { ...claudeResult, ...formalAiPricing };
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
