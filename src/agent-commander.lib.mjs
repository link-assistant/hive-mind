#!/usr/bin/env node
/**
 * Experimental agent-commander execution adapter.
 *
 * This module is only used when solve is called with --use-agent-commander.
 * Default tool execution remains in claude.lib.mjs, codex.lib.mjs,
 * opencode.lib.mjs, and agent.lib.mjs.
 */

import { resolveCodexReasoningEffort } from './codex.options.lib.mjs';
import { mapClaudeSubAgentModelToEnvValue, mapModelForTool } from './models/index.mjs';
import { buildCodexDisable1mContextConfigArgs, buildCodexSubSessionSizeConfigArgs, parseSubSessionSize } from './sub-session-size.lib.mjs';
import { detectUsageLimit } from './usage-limit.lib.mjs';
import { getCacheReadTokenCount, getCumulativeContextInputTokens, getOutputTokenCount } from './context-fill.lib.mjs';

export const AGENT_COMMANDER_TOOLS = new Set(['claude', 'codex', 'opencode', 'agent', 'qwen', 'gemini']);

const TOOL_EXECUTABLE_CONFIG = {
  claude: { argvKey: 'claudePath', envKey: 'CLAUDE_PATH' },
  codex: { argvKey: 'codexPath', envKey: 'CODEX_PATH' },
  opencode: { argvKey: 'opencodePath', envKey: 'OPENCODE_PATH' },
  agent: { argvKey: 'agentPath', envKey: 'AGENT_PATH' },
  qwen: { argvKey: 'qwenPath', envKey: 'QWEN_PATH' },
  gemini: { argvKey: 'geminiPath', envKey: 'GEMINI_PATH' },
};

const getConfiguredExecutable = (argv = {}, tool) => {
  const config = TOOL_EXECUTABLE_CONFIG[tool];
  if (!config) return null;
  return argv[config.argvKey] || process.env[config.envKey] || null;
};

const appendExtraArgs = (options, args) => {
  if (!Array.isArray(args) || args.length === 0) return;
  options.extraArgs = [...(options.extraArgs || []), ...args];
};

const appendExtraEnv = (options, env) => {
  const entries = Object.entries(env || {}).filter(([, value]) => value !== undefined && value !== null && value !== false);
  if (entries.length === 0) return;
  options.extraEnv = {
    ...(options.extraEnv || {}),
    ...Object.fromEntries(entries.map(([key, value]) => [key, String(value)])),
  };
};

const buildClaudeToolOptions = (argv = {}) => {
  const options = {};
  options.verbose = !!argv.verbose;
  if (argv.fallbackModel) options.fallbackModel = argv.fallbackModel;

  const extraEnv = {};
  if (argv.thinkingBudget !== undefined) extraEnv.MAX_THINKING_TOKENS = argv.thinkingBudget;
  if (argv.disable1mContext) extraEnv.CLAUDE_CODE_DISABLE_1M_CONTEXT = '1';
  if (argv.showThinkingContent) extraEnv.CLAUDE_CODE_SHOW_THINKING = '1';
  if (argv.planModel) extraEnv.ANTHROPIC_DEFAULT_OPUS_MODEL = argv.planModel;
  if (argv.subAgentModel) extraEnv.CLAUDE_CODE_SUBAGENT_MODEL = mapClaudeSubAgentModelToEnvValue(argv.subAgentModel);
  appendExtraEnv(options, extraEnv);

  return options;
};

const buildCodexToolOptions = (argv = {}) => {
  const options = {};
  const { reasoningEffort } = resolveCodexReasoningEffort(argv);
  appendExtraArgs(options, ['-c', `model_reasoning_effort=${reasoningEffort}`, '-c', 'model_reasoning_summary=auto']);

  appendExtraArgs(options, buildCodexDisable1mContextConfigArgs(!!argv.disable1mContext));
  try {
    appendExtraArgs(options, buildCodexSubSessionSizeConfigArgs(parseSubSessionSize(argv.subSessionSize)));
  } catch {
    // The embedded Codex path logs parse warnings later. Keep agent-commander
    // command construction permissive so validation can still run.
  }

  return options;
};

const defaultLog = async (message, options = {}) => {
  if (options.verbose && !global.verboseMode) return;
  if (options.level === 'error') {
    console.error(message);
  } else if (options.level === 'warning' || options.level === 'warn') {
    console.warn(message);
  } else {
    console.log(message);
  }
};

const getAgentCommander = async () => {
  try {
    return await import('agent-commander');
  } catch (error) {
    throw new Error(`agent-commander is not installed or cannot be loaded. Install it with: npm install agent-commander\nOriginal error: ${error.message}`);
  }
};

export const isAgentCommanderAvailable = async () => {
  try {
    await getAgentCommander();
    return true;
  } catch {
    return false;
  }
};

export const getAgentCommanderToolName = (argv = {}) => argv.tool || 'claude';

const resolveAgentCommanderModel = (tool, model) => (model ? mapModelForTool(tool, model) : model);

export const buildAgentCommanderToolOptions = (argv = {}, tool = getAgentCommanderToolName(argv)) => {
  const options = tool === 'claude' ? buildClaudeToolOptions(argv) : tool === 'codex' ? buildCodexToolOptions(argv) : {};

  const executable = getConfiguredExecutable(argv, tool);
  if (executable) {
    options.executable = executable;
  }

  if (tool === 'gemini' && argv.verbose) options.debug = true;

  return options;
};

export const buildAgentCommanderControllerOptions = ({ tool, tempDir, prompt, systemPrompt, argv = {} }) => ({
  tool,
  workingDirectory: tempDir,
  prompt,
  systemPrompt,
  model: resolveAgentCommanderModel(tool, argv.model),
  json: tool !== 'agent',
  resume: argv.resume,
  toolOptions: buildAgentCommanderToolOptions(argv, tool),
});

export const validateAgentCommanderConnection = async ({ tool, model, log = defaultLog, agentCommanderModule = null }) => {
  try {
    const module = agentCommanderModule || (await getAgentCommander());
    const { agent, isToolSupported } = module;
    const toolName = tool || 'claude';

    if (!AGENT_COMMANDER_TOOLS.has(toolName) || !isToolSupported({ toolName })) {
      await log(`[agent-commander] Tool '${toolName}' is not supported`, { level: 'error' });
      return false;
    }

    const controller = agent({
      tool: toolName,
      workingDirectory: process.cwd(),
      prompt: 'connection check',
      model: resolveAgentCommanderModel(toolName, model),
      json: toolName !== 'agent',
      toolOptions: buildAgentCommanderToolOptions({ model }, toolName),
    });
    await controller.start({ dryRun: true, attached: false });
    await log(`[agent-commander] ${toolName} command construction validated`, { verbose: true });
    return true;
  } catch (error) {
    await log(`[agent-commander] Connection validation failed: ${error.message}`, { level: 'error' });
    return false;
  }
};

const getPromptModule = async tool => {
  if (tool === 'claude') return await import('./claude.prompts.lib.mjs');
  if (tool === 'codex') return await import('./codex.prompts.lib.mjs');
  if (tool === 'opencode') return await import('./opencode.prompts.lib.mjs');
  if (tool === 'agent') return await import('./agent.prompts.lib.mjs');
  if (tool === 'qwen') return await import('./qwen.prompts.lib.mjs');
  if (tool === 'gemini') return await import('./gemini.prompts.lib.mjs');
  throw new Error(`Unsupported tool for agent-commander: ${tool}`);
};

export const getPlaywrightMcpAvailabilityCheck = async tool => {
  if (tool === 'opencode') return (await import('./opencode.lib.mjs')).checkPlaywrightMcpAvailability;
  if (tool === 'codex') return (await import('./codex.lib.mjs')).checkPlaywrightMcpAvailability;
  if (tool === 'agent') return (await import('./agent.lib.mjs')).checkPlaywrightMcpAvailability;
  if (tool === 'qwen') return (await import('./qwen.lib.mjs')).checkPlaywrightMcpAvailability;
  if (tool === 'gemini') return (await import('./gemini.lib.mjs')).checkPlaywrightMcpAvailability;
  return (await import('./claude.lib.mjs')).checkPlaywrightMcpAvailability;
};

export const resolvePlaywrightMcpForAgentCommander = async ({ argv, log = defaultLog, tool = getAgentCommanderToolName(argv) }) => {
  if (argv.playwrightMcp === false) return;
  if (!argv.promptPlaywrightMcp) {
    await log('ℹ️  Playwright MCP explicitly disabled via --no-prompt-playwright-mcp', { verbose: true });
    return;
  }

  const checkFn = await getPlaywrightMcpAvailabilityCheck(tool);
  const available = await checkFn();
  if (available) {
    await log('🎭 Playwright MCP detected - enabling browser automation hints', { verbose: true });
  } else {
    await log('ℹ️  Playwright MCP not detected - browser automation hints will be disabled', { verbose: true });
    argv.promptPlaywrightMcp = false;
  }
};

const getParsedMessages = result => {
  const parsed = result?.output?.parsed;
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') return [parsed];
  return [];
};

const extractResultSummary = (messages, plainOutput) => {
  for (const message of [...messages].reverse()) {
    if (typeof message?.result === 'string' && message.result.trim()) return message.result.trim();
    if (typeof message?.summary === 'string' && message.summary.trim()) return message.summary.trim();
    if (typeof message?.text === 'string' && message.text.trim()) return message.text.trim();
    if (typeof message?.message === 'string' && message.message.trim()) return message.message.trim();
    if (typeof message?.item?.content === 'string' && message.item.content.trim()) return message.item.content.trim();
    if (Array.isArray(message?.item?.content)) {
      const text = message.item.content
        .map(part => part?.text || '')
        .join('')
        .trim();
      if (text) return text;
    }
  }

  return plainOutput?.trim() ? plainOutput.trim().slice(-4000) : null;
};

const hasErrorMessage = messages => messages.some(message => message?.is_error === true || message?.type === 'error' || message?.type === 'step_error' || message?.error);

const normalizeAgentCommanderTokenUsage = usage => {
  if (!usage || typeof usage !== 'object') return null;
  const normalized = {
    ...usage,
    contextFillInputTokens: usage.contextFillInputTokens ?? getCumulativeContextInputTokens(usage),
  };
  const cacheReadTokens = getCacheReadTokenCount(normalized);
  const hasTokenCounts = getCumulativeContextInputTokens(normalized) > 0 || getOutputTokenCount(normalized) > 0 || cacheReadTokens > 0;
  if (!hasTokenCounts) return null;
  if (!normalized.stepCount) normalized.stepCount = 1;
  return normalized;
};

const enrichPricingInfoWithTokenUsage = ({ pricingInfo = null, usage = null, tool = null, publicPricingEstimate = null }) => {
  const tokenUsage = normalizeAgentCommanderTokenUsage(pricingInfo?.tokenUsage || usage);
  if (!tokenUsage) return pricingInfo || null;

  return {
    source: 'agent-commander',
    ...(pricingInfo || {}),
    provider: pricingInfo?.provider || tool || 'agent-commander',
    modelId: pricingInfo?.modelId || tokenUsage.respondedModelId || tokenUsage.requestedModelId || null,
    modelName: pricingInfo?.modelName || tokenUsage.respondedModelId || tokenUsage.requestedModelId || null,
    totalCostUSD: pricingInfo?.totalCostUSD ?? publicPricingEstimate ?? null,
    tokenUsage,
  };
};

export const summarizeAgentCommanderResult = ({ result, tool }) => {
  const plainOutput = result?.output?.plain || '';
  if (result?.metadata && typeof result.metadata === 'object') {
    const metadata = result.metadata;
    const streamTokenUsage = metadata.streamTokenUsage || result.usage || null;
    const pricingInfo = enrichPricingInfoWithTokenUsage({
      pricingInfo: metadata.pricingInfo || null,
      usage: streamTokenUsage,
      tool,
      publicPricingEstimate: metadata.publicPricingEstimate ?? metadata.pricingInfo?.totalCostUSD ?? null,
    });
    return {
      success: metadata.success === true,
      sessionId: metadata.sessionId || result.sessionId || null,
      limitReached: !!metadata.limitReached,
      limitResetTime: metadata.limitResetTime || null,
      limitTimezone: metadata.limitTimezone || null,
      anthropicTotalCostUSD: metadata.anthropicTotalCostUSD ?? null,
      publicPricingEstimate: metadata.publicPricingEstimate ?? pricingInfo?.totalCostUSD ?? null,
      pricingInfo,
      resultSummary: metadata.resultSummary || null,
      resultModelUsage: metadata.resultModelUsage || null,
      streamTokenUsage,
      subAgentCalls: metadata.subAgentCalls || null,
      errorDuringExecution: metadata.errorDuringExecution === true || result?.exitCode !== 0,
      result: plainOutput,
    };
  }

  const messages = getParsedMessages(result);
  const usageLimit = detectUsageLimit(plainOutput);
  const usage = result?.usage || null;
  const resultMessage = [...messages].reverse().find(message => message?.type === 'result') || null;
  const totalCost = typeof resultMessage?.total_cost_usd === 'number' ? resultMessage.total_cost_usd : null;
  const publicPricingEstimate = tool === 'agent' && typeof usage?.totalCost === 'number' ? usage.totalCost : null;
  const pricingInfo = enrichPricingInfoWithTokenUsage({
    pricingInfo: publicPricingEstimate !== null ? { totalCostUSD: publicPricingEstimate, source: 'agent-commander' } : null,
    usage,
    tool,
    publicPricingEstimate,
  });

  return {
    success: result?.exitCode === 0 && !usageLimit.isUsageLimit && !hasErrorMessage(messages),
    sessionId: result?.sessionId || resultMessage?.session_id || null,
    limitReached: usageLimit.isUsageLimit,
    limitResetTime: usageLimit.resetTime,
    limitTimezone: usageLimit.timezone,
    anthropicTotalCostUSD: tool === 'claude' ? totalCost : null,
    publicPricingEstimate: publicPricingEstimate ?? pricingInfo?.totalCostUSD ?? null,
    pricingInfo,
    resultSummary: extractResultSummary(messages, plainOutput),
    resultModelUsage: null,
    streamTokenUsage: usage,
    subAgentCalls: null,
    errorDuringExecution: result?.exitCode !== 0 || hasErrorMessage(messages),
    result: plainOutput,
  };
};

export const executeWithAgentCommander = async params => {
  const { agentCommanderModule = null, promptModule = null, log = defaultLog, argv, tempDir, workspaceTmpDir, ...promptParams } = params;
  const tool = getAgentCommanderToolName(argv);
  const module = agentCommanderModule || (await getAgentCommander());

  if (!AGENT_COMMANDER_TOOLS.has(tool) || !module.isToolSupported({ toolName: tool })) {
    throw new Error(`agent-commander does not support tool '${tool}'`);
  }

  const prompts = promptModule || (await getPromptModule(tool));
  const promptBuilderParams = { ...promptParams, tempDir, workspaceTmpDir, argv };
  const prompt = prompts.buildUserPrompt(promptBuilderParams);
  const systemPrompt = prompts.buildSystemPrompt(promptBuilderParams);
  const controllerOptions = buildAgentCommanderControllerOptions({ tool, tempDir, prompt, systemPrompt, argv });

  if (argv.verbose) {
    await log('\n[agent-commander] Final prompt structure:', { verbose: true });
    await log(`   Tool: ${tool}`, { verbose: true });
    await log(`   User prompt characters: ${prompt.length}`, { verbose: true });
    await log(`   System prompt characters: ${systemPrompt.length}`, { verbose: true });
  }

  const controller = module.agent(controllerOptions);
  const dryRun = !!(argv.dryRun || argv.onlyPrepareCommand);
  await log(`\n[agent-commander] Starting ${tool} execution${dryRun ? ' (dry-run)' : ''}...`);
  await controller.start({
    dryRun,
    attached: true,
    onOutput: chunk => {
      if (chunk.type === 'stderr') process.stderr.write(chunk.data);
      else process.stdout.write(chunk.data);
    },
  });

  if (dryRun) {
    return {
      success: true,
      sessionId: null,
      limitReached: false,
      limitResetTime: null,
      limitTimezone: null,
      anthropicTotalCostUSD: null,
      publicPricingEstimate: null,
      pricingInfo: null,
      resultSummary: null,
    };
  }

  const result = await controller.stop();
  await log(`[agent-commander] ${tool} exited with code ${result.exitCode}`);
  return summarizeAgentCommanderResult({ result, tool });
};

export const checkForUncommittedChanges = async (tempDir, owner, repo, branchName, $, log = defaultLog, autoCommit = false, autoRestartEnabled = true) => {
  await log('\n🔍 Checking for uncommitted changes...');
  const gitStatusResult = await $({ cwd: tempDir })`git status --porcelain 2>&1`;
  const statusOutput = gitStatusResult.stdout?.toString().trim() || '';

  if (!statusOutput) {
    await log('✅ No uncommitted changes found');
    return false;
  }

  await log('📝 Found uncommitted changes');
  await log('Changes:');
  for (const line of statusOutput.split('\n')) await log(`   ${line}`);

  if (autoCommit) {
    await log('💾 Auto-committing changes (--auto-commit-uncommitted-changes is enabled)...');
    const addResult = await $({ cwd: tempDir })`git add -A`;
    if (addResult.code === 0) {
      const commitResult = await $({ cwd: tempDir })`git commit -m ${'Auto-commit: Changes made through agent-commander during problem-solving session'}`;
      if (commitResult.code === 0) {
        const pushResult = await $({ cwd: tempDir })`git push origin ${branchName} 2>&1`;
        await log(pushResult.code === 0 ? '✅ Changes pushed successfully' : `⚠️ Warning: Could not push changes: ${pushResult.stderr?.toString().trim() || pushResult.stdout?.toString().trim()}`, { level: pushResult.code === 0 ? 'info' : 'warning' });
      }
    }
    return false;
  }

  if (autoRestartEnabled) {
    await log('\n⚠️  IMPORTANT: Uncommitted changes detected!');
    await log('   The agent-commander controlled tool made changes that were not committed.');
    await log('\n🔄 AUTO-RESTART: Restarting the tool to handle uncommitted changes...\n');
    return true;
  }

  await log('\n⚠️  Uncommitted changes detected but auto-restart is disabled.');
  return false;
};
