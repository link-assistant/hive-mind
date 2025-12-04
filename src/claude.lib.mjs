#!/usr/bin/env node
// Claude CLI-related utility functions
// If not, fetch it (when running standalone)
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const { $ } = await use('command-stream');
const fs = (await use('fs')).promises;
const path = (await use('path')).default;
// Import log from general lib
import { log, cleanErrorMessage } from './lib.mjs';
import { reportError } from './sentry.lib.mjs';
import { timeouts, retryLimits } from './config.lib.mjs';
import { detectUsageLimit, formatUsageLimitMessage } from './usage-limit.lib.mjs';
/**
 * Format numbers with spaces as thousands separator (no commas)
 * Per issue #667: Use spaces for thousands, . for decimals
 * @param {number|null|undefined} num - Number to format
 * @returns {string} Formatted number string
 */
export const formatNumber = (num) => {
  if (num === null || num === undefined) return 'N/A';
  // Convert to string and split on decimal point
  const parts = num.toString().split('.');
  const integerPart = parts[0];
  const decimalPart = parts[1];
  // Add spaces every 3 digits from the right
  const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  // Return with decimal part if it exists
  return decimalPart !== undefined
    ? `${formattedInteger}.${decimalPart}`
    : formattedInteger;
};
// Available model configurations
export const availableModels = {
  'sonnet': 'claude-sonnet-4-5-20250929',  // Sonnet 4.5
  'opus': 'claude-opus-4-5-20251101',      // Opus 4.5
  'haiku': 'claude-haiku-4-5-20251001',    // Haiku 4.5
  'haiku-3-5': 'claude-3-5-haiku-20241022', // Haiku 3.5
  'haiku-3': 'claude-3-haiku-20240307',     // Haiku 3
};
// Model mapping to translate aliases to full model IDs
export const mapModelToId = (model) => {
  return availableModels[model] || model;
};
// Function to validate Claude CLI connection with retry logic
export const validateClaudeConnection = async (model = 'haiku-3') => {
  // Map model alias to full ID
  const mappedModel = mapModelToId(model);
  // Retry configuration for API overload errors
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
      // First try a quick validation approach
      try {
        const versionResult = await $`timeout ${Math.floor(timeouts.claudeCli / 6000)} claude --version`;
        if (versionResult.code === 0) {
          const version = versionResult.stdout?.toString().trim();
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
        // If piping fails, fallback to the timeout approach as last resort
        await log(`⚠️  Pipe validation failed (${pipeError.code}), trying timeout approach...`);
        try {
          result = await $`timeout ${Math.floor(timeouts.claudeCli / 1000)} claude --model ${mappedModel} -p hi`;
        } catch (timeoutError) {
          if (timeoutError.code === 124) {
            await log(`❌ Claude CLI timed out after ${Math.floor(timeouts.claudeCli / 1000)} seconds`, { level: 'error' });
            await log('   💡 This may indicate Claude CLI is taking too long to respond', { level: 'error' });
            await log(`   💡 Try running 'claude --model ${mappedModel} -p hi' manually to verify it works`, { level: 'error' });
            return false;
          }
          // Re-throw if it's not a timeout error
          throw timeoutError;
        }
      }
    
      // Check for common error patterns
      const stdout = result.stdout?.toString() || '';
      const stderr = result.stderr?.toString() || '';
      // Check for JSON errors in stdout or stderr
      const checkForJsonError = (text) => {
        try {
          // Look for JSON error patterns
          if (text.includes('"error"') && text.includes('"type"')) {
            const jsonMatch = text.match(/\{.*"error".*\}/);
            if (jsonMatch) {
              const errorObj = JSON.parse(jsonMatch[0]);
              return errorObj.error;
            }
          }
        } catch (e) {
          // Not valid JSON, continue with other checks
          if (global.verboseMode) {
            reportError(e, {
              context: 'claude_json_error_parse',
              level: 'debug'
            });
          }
        }
        return null;
      };
      const jsonError = checkForJsonError(stdout) || checkForJsonError(stderr);
      // Check for API overload error pattern
      const isOverloadError = (stdout.includes('API Error: 500') && stdout.includes('Overloaded')) ||
                             (stderr.includes('API Error: 500') && stderr.includes('Overloaded')) ||
                             (jsonError && jsonError.type === 'api_error' && jsonError.message === 'Overloaded');
    
      // Handle overload errors with retry
      if (isOverloadError) {
        if (retryCount < maxRetries) {
          const delay = baseDelay * Math.pow(2, retryCount);
          await log(`⚠️ API overload error during validation. Retrying in ${delay / 1000} seconds...`, { level: 'warning' });
          await new Promise(resolve => setTimeout(resolve, delay));
          retryCount++;
          return await attemptValidation();
        } else {
          await log(`❌ API overload error persisted after ${maxRetries} retries during validation`, { level: 'error' });
          await log('   The API appears to be heavily loaded. Please try again later.', { level: 'error' });
          return false;
        }
      }
      // Use exitCode if code is undefined (Bun shell behavior)
      const exitCode = result.code ?? result.exitCode ?? 0;
      if (exitCode !== 0) {
        // Command failed
        if (jsonError) {
          await log(`❌ Claude CLI authentication failed: ${jsonError.type} - ${jsonError.message}`, { level: 'error' });
        } else {
          await log(`❌ Claude CLI failed with exit code ${exitCode}`, { level: 'error' });
          if (stderr) await log(`   Error: ${stderr.trim()}`, { level: 'error' });
        }
        if (stderr.includes('Please run /login') || (jsonError && jsonError.type === 'forbidden')) {
          await log('   💡 Please run: claude login', { level: 'error' });
        }
        return false;
      }
      // Check for error patterns in successful response
      if (jsonError) {
        if (jsonError.type === 'api_error' && jsonError.message === 'Overloaded') {
          if (retryCount < maxRetries) {
            const delay = baseDelay * Math.pow(2, retryCount);
            await log(`⚠️ API overload error in response. Retrying in ${delay / 1000} seconds...`, { level: 'warning' });
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
      // Success - Claude responded (LLM responses are probabilistic, so any response is good)
      await log('✅ Claude CLI connection validated successfully');
      return true;
    } catch (error) {
      const errorStr = error.message || error.toString();
      if ((errorStr.includes('API Error: 500') && errorStr.includes('Overloaded')) ||
          (errorStr.includes('api_error') && errorStr.includes('Overloaded'))) {
        if (retryCount < maxRetries) {
          const delay = baseDelay * Math.pow(2, retryCount);
          await log(`⚠️ API overload error during validation. Retrying in ${delay / 1000} seconds...`, { level: 'warning' });
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
// Function to handle Claude runtime switching between Node.js and Bun
export const handleClaudeRuntimeSwitch = async (argv) => {
  if (argv['force-claude-bun-run']) {
    await log('\n🔧 Switching Claude runtime to bun...');
    try {
      try {
        await $`which bun`;
        await log('   ✅ Bun runtime found');
      } catch (bunError) {
        reportError(bunError, {
          context: 'claude.lib.mjs - bun availability check',
          level: 'error'
        });
        await log('❌ Bun runtime not found. Please install bun first: https://bun.sh/', { level: 'error' });
        process.exit(1);
      }
      
      // Find Claude executable path
      const claudePathResult = await $`which claude`;
      const claudePath = claudePathResult.stdout.toString().trim();
      
      if (!claudePath) {
        await log('❌ Claude executable not found', { level: 'error' });
        process.exit(1);
      }
      
      await log(`   Claude path: ${claudePath}`);
      
      try {
        await fs.access(claudePath, fs.constants.W_OK);
      } catch (accessError) {
        reportError(accessError, {
          context: 'claude.lib.mjs - Claude executable write permission check (bun)',
          level: 'error'
        });
        await log('❌ Cannot write to Claude executable (permission denied)', { level: 'error' });
        await log('   Try running with sudo or changing file permissions', { level: 'error' });
        process.exit(1);
      }
      // Read current shebang
      const firstLine = await $`head -1 "${claudePath}"`;
      const currentShebang = firstLine.stdout.toString().trim();
      await log(`   Current shebang: ${currentShebang}`);
      if (currentShebang.includes('bun')) {
        await log('   ✅ Claude is already configured to use bun');
        process.exit(0);
      }
      
      // Create backup
      const backupPath = `${claudePath}.nodejs-backup`;
      await $`cp "${claudePath}" "${backupPath}"`;
      await log(`   📦 Backup created: ${backupPath}`);
      
      // Read file content and replace shebang
      const content = await fs.readFile(claudePath, 'utf8');
      const newContent = content.replace(/^#!.*node.*$/m, '#!/usr/bin/env bun');
      
      if (content === newContent) {
        await log('⚠️  No Node.js shebang found to replace', { level: 'warning' });
        await log(`   Current shebang: ${currentShebang}`, { level: 'warning' });
        process.exit(0);
      }
      
      await fs.writeFile(claudePath, newContent);
      await log('   ✅ Claude shebang updated to use bun');
      await log('   🔄 Claude will now run with bun runtime');
      
    } catch (error) {
      await log(`❌ Failed to switch Claude to bun: ${cleanErrorMessage(error)}`, { level: 'error' });
      process.exit(1);
    }
    
    // Exit after switching runtime
    process.exit(0);
  }
  
  if (argv['force-claude-nodejs-run']) {
    await log('\n🔧 Restoring Claude runtime to Node.js...');
    try {
      try {
        await $`which node`;
        await log('   ✅ Node.js runtime found');
      } catch (nodeError) {
        reportError(nodeError, {
          context: 'claude.lib.mjs - Node.js availability check',
          level: 'error'
        });
        await log('❌ Node.js runtime not found. Please install Node.js first', { level: 'error' });
        process.exit(1);
      }
      
      // Find Claude executable path
      const claudePathResult = await $`which claude`;
      const claudePath = claudePathResult.stdout.toString().trim();
      
      if (!claudePath) {
        await log('❌ Claude executable not found', { level: 'error' });
        process.exit(1);
      }
      
      await log(`   Claude path: ${claudePath}`);
      
      try {
        await fs.access(claudePath, fs.constants.W_OK);
      } catch (accessError) {
        reportError(accessError, {
          context: 'claude.lib.mjs - Claude executable write permission check (nodejs)',
          level: 'error'
        });
        await log('❌ Cannot write to Claude executable (permission denied)', { level: 'error' });
        await log('   Try running with sudo or changing file permissions', { level: 'error' });
        process.exit(1);
      }
      // Read current shebang
      const firstLine = await $`head -1 "${claudePath}"`;
      const currentShebang = firstLine.stdout.toString().trim();
      await log(`   Current shebang: ${currentShebang}`);
      if (currentShebang.includes('node') && !currentShebang.includes('bun')) {
        await log('   ✅ Claude is already configured to use Node.js');
        process.exit(0);
      }
      
      const backupPath = `${claudePath}.nodejs-backup`;
      try {
        await fs.access(backupPath);
        // Restore from backup
        await $`cp "${backupPath}" "${claudePath}"`;
        await log(`   ✅ Restored Claude from backup: ${backupPath}`);
      } catch (backupError) {
        reportError(backupError, {
          context: 'claude_restore_backup',
          level: 'info'
        });
        // No backup available, manually update shebang
        await log('   📝 No backup found, manually updating shebang...');
        const content = await fs.readFile(claudePath, 'utf8');
        const newContent = content.replace(/^#!.*bun.*$/m, '#!/usr/bin/env node');
        
        if (content === newContent) {
          await log('⚠️  No bun shebang found to replace', { level: 'warning' });
          await log(`   Current shebang: ${currentShebang}`, { level: 'warning' });
          process.exit(0);
        }
        
        await fs.writeFile(claudePath, newContent);
        await log('   ✅ Claude shebang updated to use Node.js');
      }
      
      await log('   🔄 Claude will now run with Node.js runtime');
      
    } catch (error) {
      await log(`❌ Failed to restore Claude to Node.js: ${cleanErrorMessage(error)}`, { level: 'error' });
      process.exit(1);
    }
    
    // Exit after restoring runtime
    process.exit(0);
  }
};
/**
 * Execute Claude with all prompts and settings
 * This is the main entry point that handles all prompt building and execution
 * @param {Object} params - Parameters for Claude execution
 * @returns {Object} Result of the execution including success status and session info
 */
export const executeClaude = async (params) => {
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
    setLogFile,
    getLogFile,
    formatAligned,
    getResourceSnapshot,
    claudePath,
    $
  } = params;
  // Import prompt building functions from claude.prompts.lib.mjs
  const { buildUserPrompt, buildSystemPrompt } = await import('./claude.prompts.lib.mjs');
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
    issueUrl,
    prNumber,
    prUrl,
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
    $
  });
};
/**
 * Calculate total token usage from a session's JSONL file
 * @param {string} sessionId - The session ID
 * @param {string} tempDir - The temporary directory where the session ran
 * @returns {Object} Token usage statistics
 */
/**
 * Fetches model information from pricing API
 * @param {string} modelId - The model ID (e.g., "claude-sonnet-4-5-20250929")
 * @returns {Promise<Object|null>} Model information or null if not found
 */
export const fetchModelInfo = async (modelId) => {
  try {
    const https = (await use('https')).default;
    return new Promise((resolve, reject) => {
      https.get('https://models.dev/api.json', (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const apiData = JSON.parse(data);
            // Search for the model across all providers
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
      }).on('error', (err) => {
        reject(err);
      });
    });
  } catch {
    // If we can't fetch model info, return null and continue without it
    return null;
  }
};
/**
 * Calculate USD cost for a model's usage with detailed breakdown
 * @param {Object} usage - Token usage object
 * @param {Object} modelInfo - Model information from pricing API
 * @param {boolean} includeBreakdown - Whether to include detailed calculation breakdown
 * @returns {Object} Cost data with optional breakdown
 */
export const calculateModelCost = (usage, modelInfo, includeBreakdown = false) => {
  if (!modelInfo || !modelInfo.cost) {
    return includeBreakdown ? { total: 0, breakdown: null } : 0;
  }
  const cost = modelInfo.cost;
  const breakdown = {
    input: { tokens: 0, costPerMillion: 0, cost: 0 },
    cacheWrite: { tokens: 0, costPerMillion: 0, cost: 0 },
    cacheRead: { tokens: 0, costPerMillion: 0, cost: 0 },
    output: { tokens: 0, costPerMillion: 0, cost: 0 }
  };
  // Input tokens cost (per million tokens)
  if (usage.inputTokens && cost.input) {
    breakdown.input = {
      tokens: usage.inputTokens,
      costPerMillion: cost.input,
      cost: (usage.inputTokens / 1000000) * cost.input
    };
  }
  // Cache creation tokens cost
  if (usage.cacheCreationTokens && cost.cache_write) {
    breakdown.cacheWrite = {
      tokens: usage.cacheCreationTokens,
      costPerMillion: cost.cache_write,
      cost: (usage.cacheCreationTokens / 1000000) * cost.cache_write
    };
  }
  // Cache read tokens cost
  if (usage.cacheReadTokens && cost.cache_read) {
    breakdown.cacheRead = {
      tokens: usage.cacheReadTokens,
      costPerMillion: cost.cache_read,
      cost: (usage.cacheReadTokens / 1000000) * cost.cache_read
    };
  }
  // Output tokens cost
  if (usage.outputTokens && cost.output) {
    breakdown.output = {
      tokens: usage.outputTokens,
      costPerMillion: cost.output,
      cost: (usage.outputTokens / 1000000) * cost.output
    };
  }
  const totalCost = breakdown.input.cost + breakdown.cacheWrite.cost + breakdown.cacheRead.cost + breakdown.output.cost;
  if (includeBreakdown) {
    return {
      total: totalCost,
      breakdown
    };
  }
  return totalCost;
};
/**
 * Display detailed model usage information
 * @param {Object} usage - Usage data for a model
 * @param {Function} log - Logging function
 */
const displayModelUsage = async (usage, log) => {
  // Show all model characteristics if available
  if (usage.modelInfo) {
    const info = usage.modelInfo;
    const fields = [
      { label: 'Model ID', value: info.id },
      { label: 'Provider', value: info.provider || 'Unknown' },
      { label: 'Context window', value: info.limit?.context ? `${formatNumber(info.limit.context)} tokens` : null },
      { label: 'Max output', value: info.limit?.output ? `${formatNumber(info.limit.output)} tokens` : null },
      { label: 'Input modalities', value: info.modalities?.input?.join(', ') || 'N/A' },
      { label: 'Output modalities', value: info.modalities?.output?.join(', ') || 'N/A' },
      { label: 'Knowledge cutoff', value: info.knowledge },
      { label: 'Released', value: info.release_date },
      { label: 'Capabilities', value: [info.attachment && 'Attachments', info.reasoning && 'Reasoning', info.temperature && 'Temperature', info.tool_call && 'Tool calls'].filter(Boolean).join(', ') || 'N/A' },
      { label: 'Open weights', value: info.open_weights ? 'Yes' : 'No' }
    ];
    for (const { label, value } of fields) {
      if (value) await log(`      ${label}: ${value}`);
    }
    await log('');
  } else {
    await log('      ⚠️  Model info not available\n');
  }
  // Show usage data
  await log('      Usage:');
  await log(`        Input tokens: ${formatNumber(usage.inputTokens)}`);
  if (usage.cacheCreationTokens > 0) {
    await log(`        Cache creation tokens: ${formatNumber(usage.cacheCreationTokens)}`);
  }
  if (usage.cacheReadTokens > 0) {
    await log(`        Cache read tokens: ${formatNumber(usage.cacheReadTokens)}`);
  }
  await log(`        Output tokens: ${formatNumber(usage.outputTokens)}`);
  if (usage.webSearchRequests > 0) {
    await log(`        Web search requests: ${usage.webSearchRequests}`);
  }
  // Show detailed cost calculation
  if (usage.costUSD !== null && usage.costUSD !== undefined && usage.costBreakdown) {
    await log('');
    await log('      Cost Calculation (USD):');
    const breakdown = usage.costBreakdown;
    const types = [
      { key: 'input', label: 'Input' },
      { key: 'cacheWrite', label: 'Cache write' },
      { key: 'cacheRead', label: 'Cache read' },
      { key: 'output', label: 'Output' }
    ];
    for (const { key, label } of types) {
      if (breakdown[key].tokens > 0) {
        await log(`        ${label}: ${formatNumber(breakdown[key].tokens)} tokens × $${breakdown[key].costPerMillion}/M = $${breakdown[key].cost.toFixed(6)}`);
      }
    }
    await log('        ─────────────────────────────────');
    await log(`        Total: $${usage.costUSD.toFixed(6)}`);
  } else if (usage.modelInfo === null) {
    await log('');
    await log('      Cost: Not available (could not fetch pricing)');
  }
};
export const calculateSessionTokens = async (sessionId, tempDir) => {
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
  try {
    // Read the entire file
    const fileContent = await fs.readFile(sessionFile, 'utf8');
    const lines = fileContent.trim().split('\n');
    // Parse each line and accumulate token counts per model
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.message && entry.message.usage && entry.message.model) {
          const model = entry.message.model;
          const usage = entry.message.usage;
          // Initialize model entry if it doesn't exist
          if (!modelUsage[model]) {
            modelUsage[model] = {
              inputTokens: 0,
              cacheCreationTokens: 0,
              cacheCreation5mTokens: 0,
              cacheCreation1hTokens: 0,
              cacheReadTokens: 0,
              outputTokens: 0,
              webSearchRequests: 0
            };
          }
          // Add input tokens
          if (usage.input_tokens) {
            modelUsage[model].inputTokens += usage.input_tokens;
          }
          // Add cache creation tokens (total)
          if (usage.cache_creation_input_tokens) {
            modelUsage[model].cacheCreationTokens += usage.cache_creation_input_tokens;
          }
          // Add cache creation tokens breakdown (5m and 1h)
          if (usage.cache_creation) {
            if (usage.cache_creation.ephemeral_5m_input_tokens) {
              modelUsage[model].cacheCreation5mTokens += usage.cache_creation.ephemeral_5m_input_tokens;
            }
            if (usage.cache_creation.ephemeral_1h_input_tokens) {
              modelUsage[model].cacheCreation1hTokens += usage.cache_creation.ephemeral_1h_input_tokens;
            }
          }
          // Add cache read tokens
          if (usage.cache_read_input_tokens) {
            modelUsage[model].cacheReadTokens += usage.cache_read_input_tokens;
          }
          // Add output tokens
          if (usage.output_tokens) {
            modelUsage[model].outputTokens += usage.output_tokens;
          }
        }
      } catch {
        // Skip lines that aren't valid JSON
        continue;
      }
    }
    // If no usage data was found, return null
    if (Object.keys(modelUsage).length === 0) {
      return null;
    }
    // Fetch model information for each model
    const modelInfoPromises = Object.keys(modelUsage).map(async (modelId) => {
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
      // Calculate cost using pricing API
      if (modelInfo) {
        const costData = calculateModelCost(usage, modelInfo, true);
        usage.costUSD = costData.total;
        usage.costBreakdown = costData.breakdown;
        usage.modelName = modelInfo.name || modelId;
        usage.modelInfo = modelInfo; // Store complete model info
      } else {
        usage.costUSD = null;
        usage.costBreakdown = null;
        usage.modelName = modelId;
        usage.modelInfo = null;
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
      totalCostUSD: hasCostData ? totalCostUSD : null
    };
  } catch (readError) {
    throw new Error(`Failed to read session file: ${readError.message}`);
  }
};
export const executeClaudeCommand = async (params) => {
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
    $  // Add command-stream $ to params
  } = params;
  // Retry configuration for API overload errors
  const maxRetries = 3;
  const baseDelay = timeouts.retryBaseDelay;
  let retryCount = 0;
  // Function to execute with retry logic
  const executeWithRetry = async () => {
    // Execute claude command from the cloned repository directory
    if (retryCount === 0) {
      await log(`\n${formatAligned('🤖', 'Executing Claude:', argv.model.toUpperCase())}`);
    } else {
      await log(`\n${formatAligned('🔄', 'Retry attempt:', `${retryCount}/${maxRetries}`)}`);
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
  // Take resource snapshot before execution
  const resourcesBefore = await getResourceSnapshot();
  await log('📈 System resources before execution:', { verbose: true });
  await log(`   Memory: ${resourcesBefore.memory.split('\n')[1]}`, { verbose: true });
  await log(`   Load: ${resourcesBefore.load}`, { verbose: true });
    // Use command-stream's async iteration for real-time streaming with file logging
    let commandFailed = false;
    let sessionId = null;
    let limitReached = false;
    let limitResetTime = null;
    let messageCount = 0;
    let toolUseCount = 0;
    let lastMessage = '';
    let isOverloadError = false;
    let is503Error = false;
    let stderrErrors = [];
    let anthropicTotalCostUSD = null; // Capture Anthropic's official total_cost_usd from result
  // Build claude command with optional resume flag
  let execCommand;
  // Map model alias to full ID
  const mappedModel = mapModelToId(argv.model);
  // Build claude command arguments
  let claudeArgs = `--output-format stream-json --verbose --dangerously-skip-permissions --model ${mappedModel}`;
  if (argv.resume) {
    await log(`🔄 Resuming from session: ${argv.resume}`);
    claudeArgs = `--resume ${argv.resume} ${claudeArgs}`;
  }
  claudeArgs += ` -p "${escapedPrompt}" --append-system-prompt "${escapedSystemPrompt}"`;
  // Build the full command for display (with jq for formatting as in v0.3.2)
  const fullCommand = `(cd "${tempDir}" && ${claudePath} ${claudeArgs} | jq -c .)`;
  // Print the actual raw command being executed
  await log(`\n${formatAligned('📝', 'Raw command:', '')}`);
  await log(`${fullCommand}`);
  await log('');
  // Output prompts in verbose mode for debugging
  if (argv.verbose) {
    await log('📋 User prompt:', { verbose: true });
    await log('---BEGIN USER PROMPT---', { verbose: true });
    await log(prompt, { verbose: true });
    await log('---END USER PROMPT---', { verbose: true });
    await log('', { verbose: true });
    await log('📋 System prompt:', { verbose: true });
    await log('---BEGIN SYSTEM PROMPT---', { verbose: true });
    await log(systemPrompt, { verbose: true });
    await log('---END SYSTEM PROMPT---', { verbose: true });
    await log('', { verbose: true });
  }
  try {
    if (argv.resume) {
      // When resuming, pass prompt directly with -p flag
      // Use simpler escaping - just escape double quotes
      const simpleEscapedPrompt = prompt.replace(/"/g, '\\"');
      const simpleEscapedSystem = systemPrompt.replace(/"/g, '\\"');
      execCommand = $({
        cwd: tempDir,
        mirror: false
      })`${claudePath} --resume ${argv.resume} --output-format stream-json --verbose --dangerously-skip-permissions --model ${mappedModel} -p "${simpleEscapedPrompt}" --append-system-prompt "${simpleEscapedSystem}"`;
    } else {
      // When not resuming, pass prompt via stdin
      // For system prompt, escape it properly for shell - just escape double quotes
      const simpleEscapedSystem = systemPrompt.replace(/"/g, '\\"');
      execCommand = $({
        cwd: tempDir,
        stdin: prompt,
        mirror: false
      })`${claudePath} --output-format stream-json --verbose --dangerously-skip-permissions --model ${mappedModel} --append-system-prompt "${simpleEscapedSystem}"`;
    }
    await log(`${formatAligned('📋', 'Command details:', '')}`);
    await log(formatAligned('📂', 'Working directory:', tempDir, 2));
    await log(formatAligned('🌿', 'Branch:', branchName, 2));
    await log(formatAligned('🤖', 'Model:', `Claude ${argv.model.toUpperCase()}`, 2));
    if (argv.fork && forkedRepo) {
      await log(formatAligned('🍴', 'Fork:', forkedRepo, 2));
    }
    await log(`\n${formatAligned('▶️', 'Streaming output:', '')}\n`);
    // Use command-stream's async iteration for real-time streaming
    let exitCode = 0;
    for await (const chunk of execCommand.stream()) {
      if (chunk.type === 'stdout') {
        const output = chunk.data.toString();
        // Split output into individual lines for NDJSON parsing
        // Claude CLI outputs NDJSON (newline-delimited JSON) format where each line is a separate JSON object
        // This allows us to parse each event independently and extract structured data like session IDs,
        // message counts, and error patterns. Attempting to parse the entire chunk as single JSON would fail
        // since multiple JSON objects aren't valid JSON together.
        const lines = output.split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            // Output formatted JSON as in v0.3.2
            await log(JSON.stringify(data, null, 2));
            // Capture session ID from the first message
            if (!sessionId && data.session_id) {
              sessionId = data.session_id;
              await log(`📌 Session ID: ${sessionId}`);
              // Try to rename log file to include session ID
              let sessionLogFile;
              try {
                const currentLogFile = getLogFile();
                const logDir = path.dirname(currentLogFile);
                sessionLogFile = path.join(logDir, `${sessionId}.log`);
                // Use fs.promises to rename the file
                await fs.rename(currentLogFile, sessionLogFile);
                // Update the global log file reference
                setLogFile(sessionLogFile);
                await log(`📁 Log renamed to: ${sessionLogFile}`);
              } catch (renameError) {
                reportError(renameError, {
                  context: 'rename_session_log',
                  sessionId,
                  sessionLogFile,
                  operation: 'rename_log_file'
                });
                // If rename fails, keep original filename
                await log(`⚠️ Could not rename log file: ${renameError.message}`, { verbose: true });
              }
            }
            // Track message and tool use counts
            if (data.type === 'message') {
              messageCount++;
            } else if (data.type === 'tool_use') {
              toolUseCount++;
            }
            // Handle session result type from Claude CLI
            // This is emitted when a session completes, either successfully or with an error
            // Example: {"type": "result", "subtype": "success", "is_error": true, "result": "Session limit reached ∙ resets 10am"}
            if (data.type === 'result') {
              // Capture Anthropic's official total_cost_usd from the result
              if (data.total_cost_usd !== undefined && data.total_cost_usd !== null) {
                anthropicTotalCostUSD = data.total_cost_usd;
                await log(`💰 Anthropic official cost captured: $${anthropicTotalCostUSD.toFixed(6)}`, { verbose: true });
              }
              if (data.is_error === true) {
                commandFailed = true;
                lastMessage = data.result || JSON.stringify(data);
                await log('⚠️ Detected error result from Claude CLI', { verbose: true });
                if (lastMessage.includes('Session limit reached') || lastMessage.includes('limit reached')) {
                  limitReached = true;
                  await log('⚠️ Detected session limit in result', { verbose: true });
                }
              }
            }
            // Store last message for error detection
            if (data.type === 'text' && data.text) {
              lastMessage = data.text;
            } else if (data.type === 'error') {
              lastMessage = data.error || JSON.stringify(data);
            }
            // Check for API overload error and 503 errors
            if (data.type === 'assistant' && data.message && data.message.content) {
              const content = Array.isArray(data.message.content) ? data.message.content : [data.message.content];
              for (const item of content) {
                if (item.type === 'text' && item.text) {
                  // Check for the specific 500 overload error pattern
                  if (item.text.includes('API Error: 500') &&
                      item.text.includes('api_error') &&
                      item.text.includes('Overloaded')) {
                    isOverloadError = true;
                    lastMessage = item.text;
                    await log('⚠️ Detected API overload error', { verbose: true });
                  }
                  // Check for 503 errors
                  if (item.text.includes('API Error: 503') ||
                      (item.text.includes('503') && item.text.includes('upstream connect error')) ||
                      (item.text.includes('503') && item.text.includes('remote connection failure'))) {
                    is503Error = true;
                    lastMessage = item.text;
                    await log('⚠️ Detected 503 network error', { verbose: true });
                  }
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
                level: 'debug'
              });
            }
            // Not JSON or parsing failed, output as-is if it's not empty
            if (line.trim() && !line.includes('node:internal')) {
              await log(line, { stream: 'raw' });
              lastMessage = line;
            }
          }
        }
      }
      if (chunk.type === 'stderr') {
        const errorOutput = chunk.data.toString();
        // Log stderr immediately
        if (errorOutput) {
          await log(errorOutput, { stream: 'stderr' });
          // Track stderr errors for failure detection
          const trimmed = errorOutput.trim();
          // Exclude warnings (messages starting with ⚠️) from being treated as errors
          // Example: "⚠️  [BashTool] Pre-flight check is taking longer than expected. Run with ANTHROPIC_LOG=debug to check for failed or slow API requests."
          // Even though this contains the word "failed", it's a warning, not an error
          const isWarning = trimmed.startsWith('⚠️') || trimmed.startsWith('⚠');
          if (trimmed && !isWarning && (trimmed.includes('Error:') || trimmed.includes('error') || trimmed.includes('failed'))) {
            stderrErrors.push(trimmed);
          }
        }
      } else if (chunk.type === 'exit') {
        exitCode = chunk.code;
        if (chunk.code !== 0) {
          commandFailed = true;
        }
        // Don't break here - let the loop finish naturally to process all output
      }
    }
    if ((commandFailed || isOverloadError) &&
        (isOverloadError ||
         (lastMessage.includes('API Error: 500') && lastMessage.includes('Overloaded')) ||
         (lastMessage.includes('api_error') && lastMessage.includes('Overloaded')))) {
      if (retryCount < maxRetries) {
        // Calculate exponential backoff delay
        const delay = baseDelay * Math.pow(2, retryCount);
        await log(`\n⚠️ API overload error detected. Retrying in ${delay / 1000} seconds...`, { level: 'warning' });
        await log(`   Error: ${lastMessage.substring(0, 200)}`, { verbose: true });
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, delay));
        // Increment retry count and retry
        retryCount++;
        return await executeWithRetry();
      } else {
        await log(`\n\n❌ API overload error persisted after ${maxRetries} retries`, { level: 'error' });
        await log('   The API appears to be heavily loaded. Please try again later.', { level: 'error' });
        return {
          success: false,
          sessionId,
          limitReached: false,
          limitResetTime: null,
          messageCount,
          toolUseCount
        };
      }
    }
    if ((commandFailed || is503Error) && argv.autoResumeOnErrors &&
        (is503Error ||
         lastMessage.includes('API Error: 503') ||
         (lastMessage.includes('503') && lastMessage.includes('upstream connect error')) ||
         (lastMessage.includes('503') && lastMessage.includes('remote connection failure')))) {
      if (retryCount < retryLimits.max503Retries) {
        // Calculate exponential backoff delay starting from 5 minutes
        const delay = retryLimits.initial503RetryDelayMs * Math.pow(retryLimits.retryBackoffMultiplier, retryCount);
        const delayMinutes = Math.round(delay / (1000 * 60));
        await log(`\n⚠️ 503 network error detected. Retrying in ${delayMinutes} minutes...`, { level: 'warning' });
        await log(`   Error: ${lastMessage.substring(0, 200)}`, { verbose: true });
        await log(`   Retry ${retryCount + 1}/${retryLimits.max503Retries}`, { verbose: true });
        // Show countdown for long waits
        if (delay > 60000) {
          const countdownInterval = 60000; // Every minute
          let remainingMs = delay;
          const countdownTimer = setInterval(async () => {
            remainingMs -= countdownInterval;
            if (remainingMs > 0) {
              const remainingMinutes = Math.round(remainingMs / (1000 * 60));
              await log(`⏳ ${remainingMinutes} minutes remaining until retry...`);
            }
          }, countdownInterval);
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, delay));
          clearInterval(countdownTimer);
        } else {
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        await log('\n🔄 Retrying now...');
        // Increment retry count and retry
        retryCount++;
        return await executeWithRetry();
      } else {
        await log(`\n\n❌ 503 network error persisted after ${retryLimits.max503Retries} retries`, { level: 'error' });
        await log('   The Anthropic API appears to be experiencing network issues.', { level: 'error' });
        await log('   Please try again later or check https://status.anthropic.com/', { level: 'error' });
        return {
          success: false,
          sessionId,
          limitReached: false,
          limitResetTime: null,
          messageCount,
          toolUseCount,
          is503Error: true
        };
      }
    }
    if (commandFailed) {
      // Check for usage limit errors first (more specific)
      const limitInfo = detectUsageLimit(lastMessage);
      if (limitInfo.isUsageLimit) {
        limitReached = true;
        limitResetTime = limitInfo.resetTime;

        // Format and display user-friendly message
        const messageLines = formatUsageLimitMessage({
          tool: 'Claude',
          resetTime: limitInfo.resetTime,
          sessionId,
          resumeCommand: argv.url ? `${process.argv[0]} ${process.argv[1]} --auto-continue ${argv.url}` : null
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
    // Additional failure detection: if no messages were processed and there were stderr errors,
    // or if the command produced no output at all, treat it as a failure
    //
    // This is critical for detecting "silent failures" where:
    // 1. Claude CLI encounters an internal error (e.g., "kill EPERM" from timeout)
    // 2. The error is logged to stderr but exit code is 0 or exit event is never sent
    // 3. Result: messageCount=0, toolUseCount=0, but stderrErrors has content
    //
    // Common cause: sudo commands that timeout
    // - Timeout triggers process.kill() in Claude CLI
    // - If child process runs with sudo (root), parent can't kill it → EPERM error
    // - Error logged to stderr, but command doesn't properly fail
    //
    // Workaround (applied in system prompt):
    // - Instruct Claude to run sudo commands (installations) in background
    // - Background processes avoid timeout kill mechanism
    // - Prevents EPERM errors and false success reports
    //
    // See: docs/dependencies-research/claude-code-issues/README.md for full details
    if (!commandFailed && stderrErrors.length > 0 && messageCount === 0 && toolUseCount === 0) {
      commandFailed = true;
      await log('\n\n❌ Command failed: No messages processed and errors detected in stderr', { level: 'error' });
      await log('Stderr errors:', { level: 'error' });
      for (const err of stderrErrors.slice(0, 5)) {
        await log(`   ${err.substring(0, 200)}`, { level: 'error' });
      }
    }
    if (commandFailed) {
      // Take resource snapshot after failure
      const resourcesAfter = await getResourceSnapshot();
      await log('\n📈 System resources after execution:', { verbose: true });
      await log(`   Memory: ${resourcesAfter.memory.split('\n')[1]}`, { verbose: true });
      await log(`   Load: ${resourcesAfter.load}`, { verbose: true });
      // Log attachment will be handled by solve.mjs when it receives success=false
      await log('', { verbose: true });
      return {
        success: false,
        sessionId,
        limitReached,
        limitResetTime,
        messageCount,
        toolUseCount
      };
    }
    await log('\n\n✅ Claude command completed');
    await log(`📊 Total messages: ${messageCount}, Tool uses: ${toolUseCount}`);
    // Calculate and display total token usage from session JSONL file
    if (sessionId && tempDir) {
      try {
        const tokenUsage = await calculateSessionTokens(sessionId, tempDir);
        if (tokenUsage) {
          await log('\n💰 Token Usage Summary:');
          // Display per-model breakdown
          if (tokenUsage.modelUsage) {
            const modelIds = Object.keys(tokenUsage.modelUsage);
            for (const modelId of modelIds) {
              const usage = tokenUsage.modelUsage[modelId];
              await log(`\n   📊 ${usage.modelName || modelId}:`);
              await displayModelUsage(usage, log);
            }
            // Show totals if multiple models were used
            if (modelIds.length > 1) {
              await log('\n   📈 Total across all models:');
              // Show cost comparison
              await log('\n   💰 Cost estimation:');
              if (tokenUsage.totalCostUSD !== null && tokenUsage.totalCostUSD !== undefined) {
                await log(`      Public pricing estimate: $${tokenUsage.totalCostUSD.toFixed(6)} USD`);
              } else {
                await log('      Public pricing estimate: unknown');
              }
              if (anthropicTotalCostUSD !== null && anthropicTotalCostUSD !== undefined) {
                await log(`      Calculated by Anthropic: $${anthropicTotalCostUSD.toFixed(6)} USD`);
                // Show comparison if both are available
                if (tokenUsage.totalCostUSD !== null && tokenUsage.totalCostUSD !== undefined) {
                  const difference = anthropicTotalCostUSD - tokenUsage.totalCostUSD;
                  const percentDiff = tokenUsage.totalCostUSD > 0 ? ((difference / tokenUsage.totalCostUSD) * 100) : 0;
                  await log(`      Difference:              $${difference.toFixed(6)} (${percentDiff > 0 ? '+' : ''}${percentDiff.toFixed(2)}%)`);
                } else {
                  await log('      Difference:              unknown');
                }
              } else {
                await log('      Calculated by Anthropic: unknown');
                await log('      Difference:              unknown');
              }
            } else {
              // Single model - show cost comparison
              await log('\n   💰 Cost estimation:');
              if (tokenUsage.totalCostUSD !== null && tokenUsage.totalCostUSD !== undefined) {
                await log(`      Public pricing estimate: $${tokenUsage.totalCostUSD.toFixed(6)} USD`);
              } else {
                await log('      Public pricing estimate: unknown');
              }
              if (anthropicTotalCostUSD !== null && anthropicTotalCostUSD !== undefined) {
                await log(`      Calculated by Anthropic: $${anthropicTotalCostUSD.toFixed(6)} USD`);
                // Show comparison if both are available
                if (tokenUsage.totalCostUSD !== null && tokenUsage.totalCostUSD !== undefined) {
                  const difference = anthropicTotalCostUSD - tokenUsage.totalCostUSD;
                  const percentDiff = tokenUsage.totalCostUSD > 0 ? ((difference / tokenUsage.totalCostUSD) * 100) : 0;
                  await log(`      Difference:              $${difference.toFixed(6)} (${percentDiff > 0 ? '+' : ''}${percentDiff.toFixed(2)}%)`);
                } else {
                  await log('      Difference:              unknown');
                }
              } else {
                await log('      Calculated by Anthropic: unknown');
                await log('      Difference:              unknown');
              }
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
          operation: 'read_session_jsonl'
        });
        await log(`   ⚠️ Could not calculate token usage: ${tokenError.message}`, { verbose: true });
      }
    }
    return {
      success: true,
      sessionId,
      limitReached,
      limitResetTime,
      messageCount,
      toolUseCount,
      anthropicTotalCostUSD // Pass Anthropic's official total cost
    };
  } catch (error) {
    reportError(error, {
      context: 'execute_claude',
      command: params.command,
      claudePath: params.claudePath,
      operation: 'run_claude_command'
    });
    const errorStr = error.message || error.toString();
    if ((errorStr.includes('API Error: 500') && errorStr.includes('Overloaded')) ||
        (errorStr.includes('api_error') && errorStr.includes('Overloaded'))) {
      if (retryCount < maxRetries) {
        // Calculate exponential backoff delay
        const delay = baseDelay * Math.pow(2, retryCount);
        await log(`\n⚠️ API overload error in exception. Retrying in ${delay / 1000} seconds...`, { level: 'warning' });
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, delay));
        // Increment retry count and retry
        retryCount++;
        return await executeWithRetry();
      }
    }
    if (argv.autoResumeOnErrors &&
        (errorStr.includes('API Error: 503') ||
         (errorStr.includes('503') && errorStr.includes('upstream connect error')) ||
         (errorStr.includes('503') && errorStr.includes('remote connection failure')))) {
      if (retryCount < retryLimits.max503Retries) {
        // Calculate exponential backoff delay starting from 5 minutes
        const delay = retryLimits.initial503RetryDelayMs * Math.pow(retryLimits.retryBackoffMultiplier, retryCount);
        const delayMinutes = Math.round(delay / (1000 * 60));
        await log(`\n⚠️ 503 network error in exception. Retrying in ${delayMinutes} minutes...`, { level: 'warning' });
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, delay));
        // Increment retry count and retry
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
      messageCount,
      toolUseCount
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
      await log(`⚠️ Warning: Could not check git status: ${gitStatusResult.stderr?.toString().trim()}`, { level: 'warning' });
      return false;
    }
  } catch (gitError) {
    reportError(gitError, { context: 'check_uncommitted_changes', tempDir, operation: 'git_status_check' });
    await log(`⚠️ Warning: Error checking for uncommitted changes: ${gitError.message}`, { level: 'warning' });
    return false;
  }
};
// Export all functions as default object too
export default {
  validateClaudeConnection,
  handleClaudeRuntimeSwitch,
  executeClaude,
  executeClaudeCommand,
  checkForUncommittedChanges,
  calculateSessionTokens
};