import { ensureUseM } from './use-m-bootstrap.lib.mjs';
if (typeof globalThis.use === 'undefined') {
  await ensureUseM();
}
const { $ } = await use('command-stream');
import { log } from './lib.mjs';
import { reportError } from './sentry.lib.mjs';
import { timeouts, getThinkingLevelToTokens, getTokensToThinkingLevel, supportsThinkingBudget, DEFAULT_MAX_THINKING_BUDGET } from './config.lib.mjs';
import { buildAuthRemedyLines } from './formal-ai.lib.mjs';
import { stringifyErrorValue } from './error-text.lib.mjs';
import { mapModelToId } from './claude.model-utils.lib.mjs';

export const validateClaudeConnection = async (model = 'haiku') => {
  const mappedModel = mapModelToId(model);
  // Issue #2130: "run claude login" is wrong advice for a Formal-AI-served model.
  const authRemedyLines = buildAuthRemedyLines({ model, vendorRemedy: 'Please run: claude login' });
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
      try {
        const versionResult = await $`timeout ${Math.floor(timeouts.claudeCli / 6000)} claude --version`;
        if (versionResult.code === 0) {
          const version = versionResult.stdout?.toString().trim();
          detectedClaudeVersion = version; // issue #1146
          if (retryCount === 0) {
            await log(`📦 Claude CLI version: ${version}`);
          }
        }
      } catch (versionError) {
        if (retryCount === 0) {
          await log(`⚠️  Claude CLI version check failed (${versionError.code}), proceeding with connection test...`);
        }
      }
      let result;
      try {
        result = await $`printf hi | claude --model ${mappedModel} -p`;
      } catch (pipeError) {
        await log(`⚠️  Pipe validation failed (${pipeError.code}), trying timeout approach...`);
        try {
          result = await $`timeout ${Math.floor(timeouts.claudeCli / 1000)} claude --model ${mappedModel} -p hi`;
        } catch (timeoutError) {
          if (timeoutError.code === 124) {
            await log(`❌ Claude CLI timed out after ${Math.floor(timeouts.claudeCli / 1000)} seconds`, {
              level: 'error',
            });
            await log('   💡 This may indicate Claude CLI is taking too long to respond', { level: 'error' });
            await log(`   💡 Try running 'claude --model ${mappedModel} -p hi' manually to verify it works`, {
              level: 'error',
            });
            return false;
          }
          throw timeoutError;
        }
      }
      const stdout = result.stdout?.toString() || '';
      const stderr = result.stderr?.toString() || '';
      const checkForJsonError = text => {
        try {
          if (text.includes('"error"') && text.includes('"type"')) {
            const jsonMatch = text.match(/\{.*"error".*\}/);
            if (jsonMatch) {
              const errorObj = JSON.parse(jsonMatch[0]);
              return stringifyErrorValue(errorObj.error, { fallback: jsonMatch[0] }); // Issue #2141: the `error` field is usually an object
            }
          }
        } catch (e) {
          if (global.verboseMode) {
            reportError(e, {
              context: 'claude_json_error_parse',
              level: 'debug',
            });
          }
        }
        return null;
      };
      const jsonError = checkForJsonError(stdout) || checkForJsonError(stderr);
      const isOverloadError = (stdout.includes('API Error: 500') && stdout.includes('Overloaded')) || (stdout.includes('API Error: 529') && stdout.includes('Overloaded')) || (stderr.includes('API Error: 500') && stderr.includes('Overloaded')) || (stderr.includes('API Error: 529') && stderr.includes('Overloaded')) || (jsonError && (jsonError.type === 'api_error' || jsonError.type === 'overloaded_error') && jsonError.message === 'Overloaded');
      if (isOverloadError) {
        if (retryCount < maxRetries) {
          const delay = baseDelay * Math.pow(2, retryCount);
          await log(`⚠️ API overload error during validation. Retrying in ${delay / 1000} seconds...`, {
            level: 'warning',
          });
          await new Promise(resolve => setTimeout(resolve, delay));
          retryCount++;
          return await attemptValidation();
        } else {
          await log(`❌ API overload error persisted after ${maxRetries} retries during validation`, {
            level: 'error',
          });
          await log('   The API appears to be heavily loaded. Please try again later.', { level: 'error' });
          return false;
        }
      }
      const exitCode = result.code ?? result.exitCode ?? 0; // Bun shell compat
      if (exitCode !== 0) {
        if (jsonError) {
          await log(`❌ Claude CLI authentication failed: ${jsonError.type} - ${jsonError.message}`, {
            level: 'error',
          });
        } else {
          await log(`❌ Claude CLI failed with exit code ${exitCode}`, { level: 'error' });
          if (stderr) await log(`   Error: ${stderr.trim()}`, { level: 'error' });
        }
        if (stderr.includes('Please run /login') || (jsonError && jsonError.type === 'forbidden')) {
          for (const line of authRemedyLines) await log(line, { level: 'error' });
        }
        return false;
      }
      if (jsonError) {
        if ((jsonError.type === 'api_error' || jsonError.type === 'overloaded_error') && jsonError.message === 'Overloaded') {
          if (retryCount < maxRetries) {
            const delay = baseDelay * Math.pow(2, retryCount);
            await log(`⚠️ API overload error in response. Retrying in ${delay / 1000} seconds...`, {
              level: 'warning',
            });
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
          for (const line of authRemedyLines) await log(line, { level: 'error' });
        }
        return false;
      }
      await log('✅ Claude CLI connection validated successfully');
      return true;
    } catch (error) {
      const errorStr = error.message || error.toString();
      if ((errorStr.includes('API Error: 500') && errorStr.includes('Overloaded')) || (errorStr.includes('API Error: 529') && errorStr.includes('Overloaded')) || (errorStr.includes('api_error') && errorStr.includes('Overloaded')) || (errorStr.includes('overloaded_error') && errorStr.includes('Overloaded'))) {
        if (retryCount < maxRetries) {
          const delay = baseDelay * Math.pow(2, retryCount);
          await log(`⚠️ API overload error during validation. Retrying in ${delay / 1000} seconds...`, {
            level: 'warning',
          });
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
  };
  return await attemptValidation();
};
// Store Claude Code version globally (set during validation)
let detectedClaudeVersion = null;
/** Get the detected Claude Code version @returns {string|null} */
export const getClaudeVersion = () => detectedClaudeVersion;
/** Set the detected Claude Code version (called during validation) @param {string} version */
export const setClaudeVersion = version => {
  detectedClaudeVersion = version;
};
/** Resolve thinking settings based on --think and --thinking-budget options */
export const resolveThinkingSettings = async (argv, log) => {
  const minVersion = argv.thinkingBudgetClaudeMinimumVersion || '2.1.12';
  const version = detectedClaudeVersion || '0.0.0';
  const isNewVersion = supportsThinkingBudget(version, minVersion);
  const maxBudget = argv.maxThinkingBudget ?? DEFAULT_MAX_THINKING_BUDGET;
  const thinkingLevelToTokens = getThinkingLevelToTokens(maxBudget);
  const tokensToThinkingLevel = getTokensToThinkingLevel(maxBudget);
  let thinkingBudget = argv.thinkingBudget;
  let thinkLevel = argv.think;
  let translation = null;
  if (isNewVersion) {
    // Issue #2038: `adaptive` is provider-managed and has no explicit token
    // budget; skip the budget translation and let the model manage thinking.
    if (thinkLevel !== undefined && thinkLevel !== 'adaptive' && thinkingBudget === undefined) {
      thinkingBudget = thinkingLevelToTokens[thinkLevel];
      translation = `--think ${thinkLevel} → --thinking-budget ${thinkingBudget}`;
      if (argv.verbose) {
        await log(`📊 Translating for Claude Code ${version} (>= ${minVersion}):`, { verbose: true });
        await log(`   ${translation}`, { verbose: true });
        if (maxBudget !== DEFAULT_MAX_THINKING_BUDGET) {
          await log(`   Using custom --max-thinking-budget: ${maxBudget}`, { verbose: true });
        }
      }
    }
  } else {
    if (thinkingBudget !== undefined && thinkLevel === undefined) {
      thinkLevel = tokensToThinkingLevel(thinkingBudget);
      translation = `--thinking-budget ${thinkingBudget} → --think ${thinkLevel}`;
      if (argv.verbose) {
        await log(`📊 Translating for Claude Code ${version} (< ${minVersion}):`, { verbose: true });
        await log(`   ${translation}`, { verbose: true });
      }
      thinkingBudget = undefined;
    }
  }
  return { thinkingBudget, thinkLevel, translation, isNewVersion, maxBudget };
};
/** Check if Playwright MCP is available and connected to Claude @returns {Promise<boolean>} */
