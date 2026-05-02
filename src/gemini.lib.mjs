#!/usr/bin/env node
// Google Gemini CLI-related utility functions

// Check if use is already defined (when imported from solve.mjs)
// If not, fetch it (when running standalone)
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const { $ } = await use('command-stream');
const fs = (await use('fs')).promises;
const path = (await use('path')).default;
const os = (await use('os')).default;

import { log } from './lib.mjs';
import { reportError } from './sentry.lib.mjs';
import { timeouts, retryLimits } from './config.lib.mjs';
import { detectUsageLimit, formatUsageLimitMessage } from './usage-limit.lib.mjs';
import { sanitizeObjectStrings } from './unicode-sanitization.lib.mjs';
import { defaultModels, geminiModels } from './models/index.mjs';
import { checkPlaywrightMcpPackageAvailability } from './playwright-mcp.lib.mjs';
import { classifyRetryableError, getRetryDelayMs, maybeSwitchToFallbackModel, waitWithCountdown } from './tool-retry.lib.mjs';

const shellQuote = value => `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;

// Model mapping to translate aliases to full model IDs for Gemini.
// Issue #1473: Uses centralized geminiModels from models/index.mjs.
export const mapModelToId = model => {
  return geminiModels[model] || model;
};

const extractGeminiTextContent = value => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(extractGeminiTextContent).filter(Boolean).join('\n');
  if (typeof value !== 'object') return '';

  if (typeof value.text === 'string') return value.text;
  if (typeof value.response === 'string') return value.response;
  if (typeof value.result === 'string') return value.result;
  if (typeof value.content === 'string') return value.content;
  if (value.content) return extractGeminiTextContent(value.content);
  if (value.message) return extractGeminiTextContent(value.message);
  if (value.parts) return extractGeminiTextContent(value.parts);
  if (value.delta) return extractGeminiTextContent(value.delta);
  return '';
};

const buildGeminiResultModelUsage = (modelId, stats = null) => {
  const modelStats = stats?.models && typeof stats.models === 'object' ? stats.models : null;
  if (modelStats) {
    const usage = {};
    for (const [id, data] of Object.entries(modelStats)) {
      const tokens = data?.tokens || {};
      usage[id] = {
        inputTokens: tokens.input || tokens.prompt || 0,
        cacheCreationTokens: tokens.cacheWrite || 0,
        cacheReadTokens: tokens.cacheRead || 0,
        outputTokens: tokens.output || tokens.completion || 0,
        modelName: data?.name || id,
        modelInfo: null,
        peakContextUsage: tokens.total || 0,
        costUSD: null,
      };
    }
    if (Object.keys(usage).length > 0) return usage;
  }

  if (!modelId || modelId === 'auto') return null;
  return {
    [modelId]: {
      inputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
      modelName: modelId,
      modelInfo: null,
      peakContextUsage: 0,
      costUSD: null,
    },
  };
};

const applyGeminiJsonEvent = (event, nextState, modelId = null) => {
  const data = sanitizeObjectStrings(event);
  if (!data || typeof data !== 'object') return;

  const type = String(data.type || data.event || data.kind || 'json');
  nextState.eventCounts[type] = (nextState.eventCounts[type] || 0) + 1;

  const emittedSessionId = data.sessionId || data.session_id || data.session?.id || data.chat?.id || null;
  if (emittedSessionId) {
    nextState.sessionId = emittedSessionId;
  }

  if (type.includes('message') || data.message || data.response || data.content || data.text) {
    nextState.messageCount++;
  }

  if (type.includes('tool') || data.toolCall || data.tool_call || data.functionCall || data.function_call) {
    nextState.toolUseCount++;
  }

  const text = extractGeminiTextContent(data);
  if (text) {
    nextState.resultSummary = text;
  }

  if (data.error) {
    nextState.errorMessages.push(extractGeminiTextContent(data.error) || JSON.stringify(data.error));
  } else if (type.toLowerCase().includes('error')) {
    nextState.errorMessages.push(text || JSON.stringify(data));
  }

  const usage = buildGeminiResultModelUsage(modelId, data.stats || data.usage || null);
  if (usage) {
    nextState.resultModelUsage = usage;
  }
};

export const parseGeminiJsonOutput = (output, state = {}, modelId = null) => {
  const nextState = {
    messageCount: state.messageCount || 0,
    toolUseCount: state.toolUseCount || 0,
    resultSummary: state.resultSummary || '',
    sessionId: state.sessionId || null,
    errorMessages: [...(state.errorMessages || [])],
    eventCounts: { ...(state.eventCounts || {}) },
    resultModelUsage: state.resultModelUsage || null,
    partialLine: state.partialLine || '',
  };

  const trimmedOutput = output.trim();
  if (trimmedOutput && !nextState.partialLine) {
    try {
      const parsed = JSON.parse(trimmedOutput);
      for (const event of Array.isArray(parsed) ? parsed : [parsed]) {
        applyGeminiJsonEvent(event, nextState, modelId);
      }
      return nextState;
    } catch {
      // stream-json emits one JSON object per line; fall through to JSONL parsing.
    }
  }

  const bufferedOutput = `${nextState.partialLine}${output}`;
  nextState.partialLine = '';
  const lines = bufferedOutput.split(/\r?\n/);
  const hasTrailingLineBreak = /\r?\n$/.test(bufferedOutput);
  const completeLines = hasTrailingLineBreak ? lines : lines.slice(0, -1);
  const possiblePartialLine = hasTrailingLineBreak ? '' : lines.at(-1) || '';

  for (const line of completeLines) {
    if (!line.trim()) continue;

    try {
      applyGeminiJsonEvent(JSON.parse(line), nextState, modelId);
    } catch {
      continue;
    }
  }

  if (possiblePartialLine.trim()) {
    try {
      applyGeminiJsonEvent(JSON.parse(possiblePartialLine), nextState, modelId);
    } catch {
      nextState.partialLine = possiblePartialLine;
    }
  }

  return nextState;
};

// Function to validate Gemini CLI connection
export const validateGeminiConnection = async (model = defaultModels.gemini) => {
  const mappedModel = mapModelToId(model);
  const geminiPath = process.env.GEMINI_PATH || 'gemini';

  try {
    await log('🔍 Validating Gemini CLI connection...');

    try {
      const versionResult = await $`timeout ${Math.floor(timeouts.geminiCli / 1000)} ${geminiPath} --version`;
      if (versionResult.code === 0) {
        const version = versionResult.stdout?.toString().trim();
        await log(`📦 Gemini CLI version: ${version}`);
      }
    } catch (versionError) {
      await log(`⚠️  Gemini CLI version check failed (${versionError.code}), proceeding with connection test...`);
    }

    const testResult = await $`printf "hi" | timeout ${Math.floor(timeouts.geminiCli / 1000)} ${geminiPath} --prompt "say hi" --output-format json --model ${mappedModel}`;
    const stdout = testResult.stdout?.toString() || '';
    const stderr = testResult.stderr?.toString() || '';
    const combinedOutput = `${stdout}\n${stderr}`;

    if (testResult.code !== 0) {
      await log(`❌ Gemini CLI validation failed with exit code ${testResult.code}`, { level: 'error' });
      if (stderr) await log(`   Error: ${stderr.trim()}`, { level: 'error' });

      if (/auth|login|credential/i.test(combinedOutput)) {
        await log('   💡 Please authenticate or configure Gemini CLI credentials.', { level: 'error' });
      }
      if (/project/i.test(combinedOutput)) {
        await log('   💡 Please set GOOGLE_CLOUD_PROJECT if your Gemini CLI setup requires it.', { level: 'error' });
      }
      return false;
    }

    const parsed = parseGeminiJsonOutput(stdout, {}, mappedModel);
    if (parsed.errorMessages.length > 0) {
      await log(`❌ Gemini CLI validation returned an error: ${parsed.errorMessages.join('; ')}`, { level: 'error' });
      return false;
    }

    await log('✅ Gemini CLI connection validated successfully');
    return true;
  } catch (error) {
    await log(`❌ Failed to validate Gemini CLI connection: ${error.message}`, { level: 'error' });
    await log('   💡 Make sure Gemini CLI is installed, authenticated, and accessible', { level: 'error' });
    return false;
  }
};

// Function to handle Gemini runtime switching (if applicable)
export const handleGeminiRuntimeSwitch = async () => {
  await log('ℹ️  Gemini runtime handling not required for this operation');
};

/** Check if Playwright MCP is available for Gemini prompt hints @returns {Promise<boolean>} */
export const checkPlaywrightMcpAvailability = checkPlaywrightMcpPackageAvailability;

// Main function to execute Gemini with prompts and settings
export const executeGemini = async params => {
  const { issueUrl, issueNumber, prNumber, prUrl, branchName, tempDir, workspaceTmpDir, isContinueMode, mergeStateStatus, forkedRepo, feedbackLines, forkActionsUrl, owner, repo, argv, log, setLogFile, getLogFile, formatAligned, getResourceSnapshot, geminiPath = 'gemini', $ } = params;

  const { buildUserPrompt, buildSystemPrompt } = await import('./gemini.prompts.lib.mjs');

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

  return await executeGeminiCommand({
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
    geminiPath,
    $,
  });
};

export const executeGeminiCommand = async params => {
  const { tempDir, branchName, prompt, systemPrompt, argv, log, formatAligned, getResourceSnapshot, forkedRepo, feedbackLines, geminiPath, $, waitForRetryDelay = waitWithCountdown } = params;

  let retryCount = 0;

  const executeWithRetry = async () => {
    if (retryCount === 0) {
      await log(`\n${formatAligned('🤖', 'Executing Gemini:', argv.model.toUpperCase())}`);
    } else {
      await log(`\n${formatAligned('🔄', 'Retry attempt:', `${retryCount}/${retryLimits.maxTransientErrorRetries}`)}`);
    }

    if (argv.verbose) {
      await log(`   Model: ${argv.model}`, { verbose: true });
      await log(`   Working directory: ${tempDir}`, { verbose: true });
      await log(`   Branch: ${branchName}`, { verbose: true });
      await log(`   Prompt length: ${prompt.length} chars`, { verbose: true });
      await log(`   System prompt length: ${systemPrompt.length} chars`, { verbose: true });
      await log(`   Feedback info included: ${feedbackLines && feedbackLines.length > 0 ? `Yes (${feedbackLines.length} lines)` : 'No'}`, { verbose: true });
    }

    const resourcesBefore = await getResourceSnapshot();
    await log('📈 System resources before execution:', { verbose: true });
    await log(`   Memory: ${resourcesBefore.memory.split('\n')[1]}`, { verbose: true });
    await log(`   Load: ${resourcesBefore.load}`, { verbose: true });

    const mappedModel = mapModelToId(argv.model || defaultModels.gemini);
    const combinedPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
    const promptFile = path.join(os.tmpdir(), `gemini_prompt_${Date.now()}_${process.pid}.txt`);
    await fs.writeFile(promptFile, combinedPrompt);

    let geminiArgs = `--output-format stream-json --model ${shellQuote(mappedModel)} --approval-mode yolo --skip-trust`;
    if (argv.resume) {
      await log(`🔄 Resuming from Gemini session: ${argv.resume}`);
      geminiArgs = `--resume ${shellQuote(argv.resume)} ${geminiArgs}`;
    }

    const fullCommand = `(cd ${shellQuote(tempDir)} && cat ${shellQuote(promptFile)} | ${geminiPath} ${geminiArgs})`;

    await log(`\n${formatAligned('📝', 'Raw command:', '')}`);
    await log(fullCommand);
    await log('');

    let geminiJsonState = {};
    let allOutput = '';
    let exitCode = 0;
    let sessionId = argv.resume || null;
    let limitReached = false;
    let limitResetTime = null;
    let lastMessage = '';

    try {
      const execCommand = argv.resume
        ? $({
            cwd: tempDir,
            mirror: false,
          })`cat ${promptFile} | ${geminiPath} --resume ${argv.resume} --output-format stream-json --model ${mappedModel} --approval-mode yolo --skip-trust`
        : $({
            cwd: tempDir,
            mirror: false,
          })`cat ${promptFile} | ${geminiPath} --output-format stream-json --model ${mappedModel} --approval-mode yolo --skip-trust`;

      await log(`${formatAligned('📋', 'Command details:', '')}`);
      await log(formatAligned('📂', 'Working directory:', tempDir, 2));
      await log(formatAligned('🌿', 'Branch:', branchName, 2));
      await log(formatAligned('🤖', 'Model:', `Gemini ${argv.model.toUpperCase()}`, 2));
      if (argv.fork && forkedRepo) {
        await log(formatAligned('🍴', 'Fork:', forkedRepo, 2));
      }

      await log(`\n${formatAligned('▶️', 'Streaming output:', '')}\n`);

      for await (const chunk of execCommand.stream()) {
        if (chunk.type === 'stdout') {
          const output = chunk.data.toString();
          await log(output);
          allOutput += output;
          geminiJsonState = parseGeminiJsonOutput(output, geminiJsonState, mappedModel);
          if (geminiJsonState.sessionId) {
            sessionId = geminiJsonState.sessionId;
          }
          if (geminiJsonState.resultSummary) {
            lastMessage = geminiJsonState.resultSummary;
          } else {
            lastMessage = output;
          }
        }

        if (chunk.type === 'stderr') {
          const errorOutput = chunk.data.toString();
          if (errorOutput) {
            await log(errorOutput, { stream: 'stderr' });
            allOutput += errorOutput;
            lastMessage = errorOutput;
          }
        } else if (chunk.type === 'exit') {
          exitCode = chunk.code;
        }
      }

      if (exitCode !== 0 || geminiJsonState.errorMessages?.length > 0) {
        const errorText = geminiJsonState.errorMessages?.length > 0 ? geminiJsonState.errorMessages.join('\n') : allOutput || lastMessage;
        const retryableError = classifyRetryableError(errorText);
        if (retryableError.isRetryable) {
          const isRequestTimeoutRetry = retryableError.label === 'Request timeout';
          const maxRetries = isRequestTimeoutRetry ? retryLimits.maxRequestTimeoutRetries : retryLimits.maxTransientErrorRetries;
          if (retryCount < maxRetries) {
            const delay = getRetryDelayMs({
              retryCount,
              initialDelayMs: isRequestTimeoutRetry ? retryLimits.initialRequestTimeoutDelayMs : retryLimits.initialTransientErrorDelayMs,
              maxDelayMs: isRequestTimeoutRetry ? retryLimits.maxRequestTimeoutDelayMs : retryLimits.maxTransientErrorDelayMs,
            });
            const delayLabel = delay >= 60000 ? `${Math.round(delay / 60000)} min` : `${Math.round(delay / 1000)}s`;
            await log(`\n⚠️ ${retryableError.label} detected. Retry ${retryCount + 1}/${maxRetries} in ${delayLabel}${sessionId ? ' (session preserved)' : ''}...`, { level: 'warning' });
            await maybeSwitchToFallbackModel({ tool: 'gemini', argv, log, errorMessage: retryableError.message });
            await waitForRetryDelay(delay, log);
            await log('\n🔄 Retrying now...');
            retryCount++;
            return await executeWithRetry();
          }
          await log(`\n\n❌ ${retryableError.label} persisted after ${maxRetries} retries`, { level: 'error' });
        }

        const limitInfo = detectUsageLimit(errorText);
        if (limitInfo.isUsageLimit) {
          limitReached = true;
          limitResetTime = limitInfo.resetTime;

          const messageLines = formatUsageLimitMessage({
            tool: 'Gemini CLI',
            resetTime: limitInfo.resetTime,
            sessionId,
            resumeCommand: sessionId ? `${process.argv[0]} ${process.argv[1]} ${argv.url} --resume ${sessionId} --tool gemini` : null,
          });

          for (const line of messageLines) {
            await log(line, { level: 'warning' });
          }
        } else if (exitCode === 130) {
          await log('\n\n⚠️ Gemini command interrupted (CTRL+C)');
        } else {
          await log(`\n\n❌ Gemini command failed with exit code ${exitCode}`, { level: 'error' });
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
          messageCount: geminiJsonState.messageCount || 0,
          toolUseCount: geminiJsonState.toolUseCount || 0,
          resultModelUsage: geminiJsonState.resultModelUsage || buildGeminiResultModelUsage(mappedModel),
          pricingInfo: { modelId: mappedModel, modelName: mappedModel, provider: 'Google', totalCostUSD: null },
          publicPricingEstimate: null,
          resultSummary: geminiJsonState.resultSummary || null,
        };
      }

      await log('\n\n✅ Gemini command completed');
      await log(`📊 Total messages: ${geminiJsonState.messageCount || 0}, Tool uses: ${geminiJsonState.toolUseCount || 0}`);
      if (geminiJsonState.resultSummary) {
        await log('📝 Captured result summary from Gemini output', { verbose: true });
      }

      return {
        success: true,
        sessionId,
        limitReached,
        limitResetTime,
        messageCount: geminiJsonState.messageCount || 0,
        toolUseCount: geminiJsonState.toolUseCount || 0,
        resultModelUsage: geminiJsonState.resultModelUsage || buildGeminiResultModelUsage(mappedModel),
        pricingInfo: { modelId: mappedModel, modelName: mappedModel, provider: 'Google', totalCostUSD: null },
        publicPricingEstimate: null,
        resultSummary: geminiJsonState.resultSummary || null,
      };
    } catch (error) {
      reportError(error, {
        context: 'execute_gemini',
        command: params.command,
        geminiPath: params.geminiPath,
        operation: 'run_gemini_command',
      });

      await log(`\n\n❌ Error executing Gemini command: ${error.message}`, { level: 'error' });
      return {
        success: false,
        sessionId: null,
        limitReached: false,
        limitResetTime: null,
        messageCount: 0,
        toolUseCount: 0,
        resultModelUsage: null,
        pricingInfo: null,
        publicPricingEstimate: null,
        resultSummary: null,
      };
    } finally {
      await fs.unlink(promptFile).catch(() => {});
    }
  };

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
            const commitMessage = 'Auto-commit: Changes made by Gemini during problem-solving session';
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
        }

        if (autoRestartEnabled) {
          await log('');
          await log('⚠️  IMPORTANT: Uncommitted changes detected!');
          await log('   Gemini made changes that were not committed.');
          await log('');
          await log('🔄 AUTO-RESTART: Restarting Gemini to handle uncommitted changes...');
          await log('   Gemini will review the changes and decide what to commit.');
          await log('');
          return true;
        }

        await log('');
        await log('⚠️  Uncommitted changes detected but auto-restart is disabled.');
        await log('   Use --auto-restart-on-uncommitted-changes to enable or commit manually.');
        await log('');
        return false;
      }

      await log('✅ No uncommitted changes found');
      return false;
    }

    await log(`⚠️ Warning: Could not check git status: ${gitStatusResult.stderr?.toString().trim()}`, {
      level: 'warning',
    });
    return false;
  } catch (gitError) {
    reportError(gitError, {
      context: 'check_uncommitted_changes_gemini',
      tempDir,
      operation: 'git_status_check',
    });
    await log(`⚠️ Warning: Error checking for uncommitted changes: ${gitError.message}`, { level: 'warning' });
    return false;
  }
};

export default {
  validateGeminiConnection,
  handleGeminiRuntimeSwitch,
  checkPlaywrightMcpAvailability,
  parseGeminiJsonOutput,
  executeGemini,
  executeGeminiCommand,
  checkForUncommittedChanges,
};
