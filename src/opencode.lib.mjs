#!/usr/bin/env node
// OpenCode-related utility functions

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
import { fetchModelInfo } from './claude.lib.mjs';

// Model mapping to translate aliases to full model IDs for OpenCode
export const mapModelToId = (model) => {
  const modelMap = {
    'gpt4': 'openai/gpt-4',
    'gpt4o': 'openai/gpt-4o',
    'claude': 'anthropic/claude-3-5-sonnet',
    'sonnet': 'anthropic/claude-3-5-sonnet',
    'opus': 'anthropic/claude-3-opus',
    'gemini': 'google/gemini-pro',
    'grok': 'opencode/grok-code',
    'grok-code': 'opencode/grok-code',
    'grok-code-fast-1': 'opencode/grok-code',
  };

  // Return mapped model ID if it's an alias, otherwise return as-is
  return modelMap[model] || model;
};

/**
 * Parse token usage from OpenCode JSON output
 * @param {string} output - The full output from OpenCode command
 * @returns {Object} Token usage data
 */
export const parseOpenCodeTokenUsage = (output) => {
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalCost: 0,
    stepCount: 0
  };

  // Try to parse each line as JSON (OpenCode outputs NDJSON format)
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

        // Add cost from step_finish
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
 * Calculate pricing for OpenCode tool usage using models.dev API
 * @param {string} modelId - The model ID used (e.g., 'opencode/grok-code')
 * @param {Object} tokenUsage - Token usage data from parseOpenCodeTokenUsage
 * @returns {Object} Pricing information with separate public estimate and provider price
 */
export const calculateOpenCodePricing = async (modelId, tokenUsage) => {
  // Extract the model name from provider/model format
  // e.g., 'opencode/grok-code' -> 'grok-code'
  let modelName = modelId.includes('/') ? modelId.split('/').pop() : modelId;

  try {
    // Always calculate public estimate using grok-code-fast-1 pricing
    // as per issue #892 - public price estimate should be based on actual cost of xai/grok-code-fast-1
    const publicEstimateModelInfo = await fetchModelInfo('grok-code-fast-1');
    let publicEstimate = null;
    if (publicEstimateModelInfo && publicEstimateModelInfo.cost) {
      const cost = publicEstimateModelInfo.cost;
      const inputCost = (tokenUsage.inputTokens * (cost.input || 0)) / 1_000_000;
      const outputCost = (tokenUsage.outputTokens * (cost.output || 0)) / 1_000_000;
      const cacheReadCost = (tokenUsage.cacheReadTokens * (cost.cache_read || 0)) / 1_000_000;
      const cacheWriteCost = (tokenUsage.cacheWriteTokens * (cost.cache_write || 0)) / 1_000_000;
      publicEstimate = inputCost + outputCost + cacheReadCost + cacheWriteCost;
    }

    // Calculate provider price: use actual cost from JSON output if available, otherwise calculate using model pricing
    let providerPrice = null;
    let providerPricing = null;
    let providerBreakdown = null;
    let isFreeModel = false;

    // If the JSON output contains actual cost data, use that as the provider price
    if (tokenUsage.totalCost > 0) {
      providerPrice = tokenUsage.totalCost;
      providerPricing = {
        inputPerMillion: 0, // Not available from JSON
        outputPerMillion: 0,
        cacheReadPerMillion: 0,
        cacheWritePerMillion: 0
      };
      providerBreakdown = {
        input: 0, // Breakdown not available from JSON
        output: 0,
        cacheRead: 0,
        cacheWrite: 0
      };
    } else {
      // Fallback: calculate using model pricing from API
      const providerModelInfo = await fetchModelInfo(modelName);
      if (providerModelInfo && providerModelInfo.cost) {
        const cost = providerModelInfo.cost;
        const inputCost = (tokenUsage.inputTokens * (cost.input || 0)) / 1_000_000;
        const outputCost = (tokenUsage.outputTokens * (cost.output || 0)) / 1_000_000;
        const cacheReadCost = (tokenUsage.cacheReadTokens * (cost.cache_read || 0)) / 1_000_000;
        const cacheWriteCost = (tokenUsage.cacheWriteTokens * (cost.cache_write || 0)) / 1_000_000;

        providerPrice = inputCost + outputCost + cacheReadCost + cacheWriteCost;
        providerPricing = {
          inputPerMillion: cost.input || 0,
          outputPerMillion: cost.output || 0,
          cacheReadPerMillion: cost.cache_read || 0,
          cacheWritePerMillion: cost.cache_write || 0
        };
        providerBreakdown = {
          input: inputCost,
          output: outputCost,
          cacheRead: cacheReadCost,
          cacheWrite: cacheWriteCost
        };
      } else {
        // Model not found in pricing API - assume it's free
        isFreeModel = true;
        providerPrice = 0;
        providerPricing = {
          inputPerMillion: 0,
          outputPerMillion: 0,
          cacheReadPerMillion: 0,
          cacheWritePerMillion: 0
        };
        providerBreakdown = {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0
        };
      }
    }

    return {
      modelName: providerModelInfo?.name || modelId,
      provider: providerModelInfo?.provider || 'OpenCode',
      publicEstimate,
      providerPrice,
      totalCostUSD: publicEstimate, // Use public estimate as total for display
      providerPricing,
      providerBreakdown,
      isFreeModel,
      tokenUsage
    };
  } catch (error) {
    // If pricing calculation fails, return null values
    return {
      modelName: modelId,
      provider: 'OpenCode',
      publicEstimate: null,
      providerPrice: null,
      totalCostUSD: null,
      providerPricing: null,
      providerBreakdown: null,
      isFreeModel: false,
      tokenUsage
    };
  }
};

// Function to validate OpenCode connection
export const validateOpenCodeConnection = async (model = 'grok-code-fast-1') => {
  // Map model alias to full ID
  const mappedModel = mapModelToId(model);

  // Retry configuration
  const maxRetries = 3;
  let retryCount = 0;

  const attemptValidation = async () => {
    try {
      if (retryCount === 0) {
        await log('🔍 Validating OpenCode connection...');
      } else {
        await log(`🔄 Retry attempt ${retryCount}/${maxRetries} for OpenCode validation...`);
      }

      // Check if OpenCode CLI is installed and get version
      try {
        const versionResult = await $`timeout ${Math.floor(timeouts.opencodeCli / 1000)} opencode --version`;
        if (versionResult.code === 0) {
          const version = versionResult.stdout?.toString().trim();
          if (retryCount === 0) {
            await log(`📦 OpenCode CLI version: ${version}`);
          }
        }
      } catch (versionError) {
        if (retryCount === 0) {
          await log(`⚠️  OpenCode CLI version check failed (${versionError.code}), proceeding with connection test...`);
        }
      }

      // Test basic OpenCode functionality with a simple "hi" message
      // Check for non-error result to validate the connection
      const testResult = await $`printf "hi" | timeout ${Math.floor(timeouts.opencodeCli / 1000)} opencode run --format json --model ${mappedModel}`;

      if (testResult.code !== 0) {
        const stderr = testResult.stderr?.toString() || '';

        if (stderr.includes('auth') || stderr.includes('login')) {
          await log('❌ OpenCode authentication failed', { level: 'error' });
          await log('   💡 Please run: opencode auth', { level: 'error' });
          return false;
        }

        await log(`❌ OpenCode validation failed with exit code ${testResult.code}`, { level: 'error' });
        if (stderr) await log(`   Error: ${stderr.trim()}`, { level: 'error' });
        return false;
      }

      // Success
      await log('✅ OpenCode connection validated successfully');
      return true;
    } catch (error) {
      await log(`❌ Failed to validate OpenCode connection: ${error.message}`, { level: 'error' });
      await log('   💡 Make sure OpenCode CLI is installed and accessible', { level: 'error' });
      return false;
    }
  };

  // Start the validation
  return await attemptValidation();
};

// Function to handle OpenCode runtime switching (if applicable)
export const handleOpenCodeRuntimeSwitch = async () => {
  // OpenCode is typically run as a CLI tool, runtime switching may not be applicable
  // This function can be used for any runtime-specific configurations if needed
  await log('ℹ️  OpenCode runtime handling not required for this operation');
};

// Main function to execute OpenCode with prompts and settings
export const executeOpenCode = async (params) => {
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
    log,
    formatAligned,
    getResourceSnapshot,
    opencodePath = 'opencode',
    $
  } = params;

  // Import prompt building functions from opencode.prompts.lib.mjs
  const { buildUserPrompt, buildSystemPrompt } = await import('./opencode.prompts.lib.mjs');

  // Build the user prompt
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
    argv
  });

  // Build the system prompt
  const systemPrompt = buildSystemPrompt({
    owner,
    repo,
    issueNumber,
    prNumber,
    branchName,
    tempDir,
    isContinueMode,
    forkedRepo,
    argv
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

  // Execute the OpenCode command
  return await executeOpenCodeCommand({
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
    opencodePath,
    $
  });
};

export const executeOpenCodeCommand = async (params) => {
  const {
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
    opencodePath,
    $
  } = params;

  // Retry configuration
  const maxRetries = 3;
  let retryCount = 0;

  const executeWithRetry = async () => {
    // Execute opencode command from the cloned repository directory
    if (retryCount === 0) {
      await log(`\n${formatAligned('🤖', 'Executing OpenCode:', argv.model.toUpperCase())}`);
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

    // Build OpenCode command
    let execCommand;

    // Map model alias to full ID
    const mappedModel = mapModelToId(argv.model);

    // Build opencode command arguments
    let opencodeArgs = `run --format json --model ${mappedModel}`;

    if (argv.resume) {
      await log(`🔄 Resuming from session: ${argv.resume}`);
      opencodeArgs = `run --format json --resume ${argv.resume} --model ${mappedModel}`;
    }

    // For OpenCode, we pass the prompt via stdin
    // The system prompt is typically not supported separately in opencode
    // We'll combine system and user prompts into a single message
    const combinedPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;

    // Write the combined prompt to a file for piping
    // Use OS temporary directory instead of repository workspace to avoid polluting the repo
    const promptFile = path.join(os.tmpdir(), `opencode_prompt_${Date.now()}_${process.pid}.txt`);
    await fs.writeFile(promptFile, combinedPrompt);

    // Build the full command - pipe the prompt file to opencode
    const fullCommand = `(cd "${tempDir}" && cat "${promptFile}" | ${opencodePath} ${opencodeArgs})`;

    await log(`\n${formatAligned('📝', 'Raw command:', '')}`);
    await log(`${fullCommand}`);
    await log('');

    try {
      // Pipe the prompt file to opencode via stdin
      if (argv.resume) {
        execCommand = $({
          cwd: tempDir,
          mirror: false
        })`cat ${promptFile} | ${opencodePath} run --format json --resume ${argv.resume} --model ${mappedModel}`;
      } else {
        execCommand = $({
          cwd: tempDir,
          mirror: false
        })`cat ${promptFile} | ${opencodePath} run --format json --model ${mappedModel}`;
      }

      await log(`${formatAligned('📋', 'Command details:', '')}`);
      await log(formatAligned('📂', 'Working directory:', tempDir, 2));
      await log(formatAligned('🌿', 'Branch:', branchName, 2));
      await log(formatAligned('🤖', 'Model:', `OpenCode ${argv.model.toUpperCase()}`, 2));
      if (argv.fork && forkedRepo) {
        await log(formatAligned('🍴', 'Fork:', forkedRepo, 2));
      }

      await log(`\n${formatAligned('▶️', 'Streaming output:', '')}\n`);

       let exitCode = 0;
       let sessionId = null;
       let limitReached = false;
       let limitResetTime = null;
       let lastMessage = '';
       let fullOutput = ''; // Collect all output for pricing calculation

       for await (const chunk of execCommand.stream()) {
         if (chunk.type === 'stdout') {
           const output = chunk.data.toString();
           await log(output);
           lastMessage = output;
           fullOutput += output; // Collect for pricing calculation
         }

        if (chunk.type === 'stderr') {
          const errorOutput = chunk.data.toString();
          if (errorOutput) {
            await log(errorOutput, { stream: 'stderr' });
          }
        } else if (chunk.type === 'exit') {
          exitCode = chunk.code;
        }
      }

      if (exitCode !== 0) {
        // Check for usage limit errors first (more specific)
        const limitInfo = detectUsageLimit(lastMessage);
        if (limitInfo.isUsageLimit) {
          limitReached = true;
          limitResetTime = limitInfo.resetTime;

          // Format and display user-friendly message
          const messageLines = formatUsageLimitMessage({
            tool: 'OpenCode',
            resetTime: limitInfo.resetTime,
            sessionId,
            resumeCommand: sessionId ? `${process.argv[0]} ${process.argv[1]} ${argv.url} --resume ${sessionId}` : null
          });

          for (const line of messageLines) {
            await log(line, { level: 'warning' });
          }
        } else {
          await log(`\n\n❌ OpenCode command failed with exit code ${exitCode}`, { level: 'error' });
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
           tokenUsage: null,
           pricingInfo: null,
           publicPricingEstimate: null
         };
      }

       await log('\n\n✅ OpenCode command completed');

       // Parse token usage from collected output
       const tokenUsage = parseOpenCodeTokenUsage(fullOutput);
       const pricingInfo = await calculateOpenCodePricing(mappedModel, tokenUsage);

       // Log pricing information
       if (tokenUsage.stepCount > 0) {
         await log('\n💰 Token Usage Summary:');
         await log(`   📊 ${pricingInfo.modelName || mappedModel}:`);
         await log(`      Input tokens: ${tokenUsage.inputTokens.toLocaleString()}`);
         await log(`      Output tokens: ${tokenUsage.outputTokens.toLocaleString()}`);
         if (tokenUsage.reasoningTokens > 0) {
           await log(`      Reasoning tokens: ${tokenUsage.reasoningTokens.toLocaleString()}`);
         }
         if (tokenUsage.cacheReadTokens > 0 || tokenUsage.cacheWriteTokens > 0) {
           await log(`      Cache read: ${tokenUsage.cacheReadTokens.toLocaleString()}`);
           await log(`      Cache write: ${tokenUsage.cacheWriteTokens.toLocaleString()}`);
         }
         await log(`      Provider: ${pricingInfo.provider || 'OpenCode'}`);
         if (pricingInfo.publicEstimate !== null) {
           await log(`      Public pricing estimate: $${pricingInfo.publicEstimate.toFixed(6)} USD`);
         }
         if (pricingInfo.providerPrice !== null) {
           await log(`      Provider price: $${pricingInfo.providerPrice.toFixed(6)} USD`);
         }
       }

       return {
         success: true,
         sessionId,
         limitReached,
         limitResetTime,
         tokenUsage,
         pricingInfo,
         publicPricingEstimate: pricingInfo.totalCostUSD
       };
    } catch (error) {
      reportError(error, {
        context: 'execute_opencode',
        command: params.command,
        opencodePath: params.opencodePath,
        operation: 'run_opencode_command'
      });

      await log(`\n\n❌ Error executing OpenCode command: ${error.message}`, { level: 'error' });
       return {
         success: false,
         sessionId: null,
         limitReached: false,
         limitResetTime: null,
         tokenUsage: null,
         pricingInfo: null,
         publicPricingEstimate: null
       };
    }
  };

  // Start the execution with retry logic
  return await executeWithRetry();
};

export const checkForUncommittedChanges = async (tempDir, owner, repo, branchName, $, log, autoCommit = false, autoRestartEnabled = true) => {
  // Similar to Claude version, check for uncommitted changes
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
            const commitMessage = 'Auto-commit: Changes made by OpenCode during problem-solving session';
            const commitResult = await $({ cwd: tempDir })`git commit -m ${commitMessage}`;

            if (commitResult.code === 0) {
              await log('✅ Changes committed successfully');

              const pushResult = await $({ cwd: tempDir })`git push origin ${branchName}`;

              if (pushResult.code === 0) {
                await log('✅ Changes pushed successfully');
              } else {
                await log(`⚠️ Warning: Could not push changes: ${pushResult.stderr?.toString().trim()}`, { level: 'warning' });
              }
            } else {
              await log(`⚠️ Warning: Could not commit changes: ${commitResult.stderr?.toString().trim()}`, { level: 'warning' });
            }
          } else {
            await log(`⚠️ Warning: Could not stage changes: ${addResult.stderr?.toString().trim()}`, { level: 'warning' });
          }
          return false;
        } else if (autoRestartEnabled) {
          await log('');
          await log('⚠️  IMPORTANT: Uncommitted changes detected!');
          await log('   OpenCode made changes that were not committed.');
          await log('');
          await log('🔄 AUTO-RESTART: Restarting OpenCode to handle uncommitted changes...');
          await log('   OpenCode will review the changes and decide what to commit.');
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
      await log(`⚠️ Warning: Could not check git status: ${gitStatusResult.stderr?.toString().trim()}`, { level: 'warning' });
      return false;
    }
  } catch (gitError) {
    reportError(gitError, {
      context: 'check_uncommitted_changes_opencode',
      tempDir,
      operation: 'git_status_check'
    });
    await log(`⚠️ Warning: Error checking for uncommitted changes: ${gitError.message}`, { level: 'warning' });
    return false;
  }
};

// Export all functions as default object too
export default {
  validateOpenCodeConnection,
  handleOpenCodeRuntimeSwitch,
  executeOpenCode,
  executeOpenCodeCommand,
  checkForUncommittedChanges
};