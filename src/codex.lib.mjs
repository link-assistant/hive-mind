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

// Model mapping to translate aliases to full model IDs for Codex
export const mapModelToId = (model) => {
  const modelMap = {
    'gpt5': 'gpt-5',
    'gpt5-codex': 'gpt-5-codex',
    'o3': 'o3',
    'o3-mini': 'o3-mini',
    'gpt4': 'gpt-4',
    'gpt4o': 'gpt-4o',
    'claude': 'claude-3-5-sonnet',
    'sonnet': 'claude-3-5-sonnet',
    'opus': 'claude-3-opus',
  };

  // Return mapped model ID if it's an alias, otherwise return as-is
  return modelMap[model] || model;
};

// Function to validate Codex CLI connection
export const validateCodexConnection = async (model = 'gpt-5') => {
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
      const testResult = await $`printf "echo hi" | timeout ${Math.floor(timeouts.codexCli / 1000)} codex exec --model ${mappedModel} --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox`;

      if (testResult.code !== 0) {
        const stderr = testResult.stderr?.toString() || '';
        const stdout = testResult.stdout?.toString() || '';

        // Check for authentication errors in both stderr and stdout
        // Codex CLI may return auth errors in JSON format on stdout
        if (stderr.includes('auth') || stderr.includes('login') ||
            stdout.includes('Not logged in') || stdout.includes('401 Unauthorized')) {
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

// Main function to execute Codex with prompts and settings
export const executeCodex = async (params) => {
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
    codexPath = 'codex',
    $
  } = params;

  // Import prompt building functions from codex.prompts.lib.mjs
  const { buildUserPrompt, buildSystemPrompt } = await import('./codex.prompts.lib.mjs');

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
    $
  });
};

export const executeCodexCommand = async (params) => {
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
    codexPath,
    $
  } = params;

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

    // Build Codex command
    let execCommand;

    // Map model alias to full ID
    const mappedModel = mapModelToId(argv.model);

    // Build codex command arguments
    // Codex uses exec mode for non-interactive execution
    // --json provides structured output
    // --full-auto enables automatic execution with workspace-write sandbox
    let codexArgs = `exec --model ${mappedModel} --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox`;

    if (argv.resume) {
      // Codex supports resuming sessions
      await log(`🔄 Resuming from session: ${argv.resume}`);
      codexArgs = `exec resume ${argv.resume} --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox`;
    }

    // For Codex, we combine system and user prompts into a single message
    // Codex doesn't have separate system prompt support in CLI mode
    const combinedPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;

    // Write the combined prompt to a file for piping
    // Use OS temporary directory instead of repository workspace to avoid polluting the repo
    const promptFile = path.join(os.tmpdir(), `codex_prompt_${Date.now()}_${process.pid}.txt`);
    await fs.writeFile(promptFile, combinedPrompt);

    // Build the full command - pipe the prompt file to codex
    const fullCommand = `(cd "${tempDir}" && cat "${promptFile}" | ${codexPath} ${codexArgs})`;

    await log(`\n${formatAligned('📝', 'Raw command:', '')}`);
    await log(`${fullCommand}`);
    await log('');

    try {
      // Pipe the prompt file to codex via stdin
      if (argv.resume) {
        execCommand = $({
          cwd: tempDir,
          mirror: false
        })`cat ${promptFile} | ${codexPath} exec resume ${argv.resume} --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox`;
      } else {
        execCommand = $({
          cwd: tempDir,
          mirror: false
        })`cat ${promptFile} | ${codexPath} exec --model ${mappedModel} --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox`;
      }

      await log(`${formatAligned('📋', 'Command details:', '')}`);
      await log(formatAligned('📂', 'Working directory:', tempDir, 2));
      await log(formatAligned('🌿', 'Branch:', branchName, 2));
      await log(formatAligned('🤖', 'Model:', `Codex ${argv.model.toUpperCase()}`, 2));
      if (argv.fork && forkedRepo) {
        await log(formatAligned('🍴', 'Fork:', forkedRepo, 2));
      }

      await log(`\n${formatAligned('▶️', 'Streaming output:', '')}\n`);

      let exitCode = 0;
      let sessionId = null;
      let limitReached = false;
      let limitResetTime = null;
      let lastMessage = '';
      let authError = false;

      for await (const chunk of execCommand.stream()) {
        if (chunk.type === 'stdout') {
          const output = chunk.data.toString();
          await log(output);
          lastMessage = output;

          // Try to parse JSON output to extract session info
          // Codex CLI uses thread_id instead of session_id
          try {
            const lines = output.split('\n');
            for (const line of lines) {
              if (!line.trim()) continue;
              const data = JSON.parse(line);
              // Check for both thread_id (codex) and session_id (legacy)
              if ((data.thread_id || data.session_id) && !sessionId) {
                sessionId = data.thread_id || data.session_id;
                await log(`📌 Session ID: ${sessionId}`);
              }

              // Check for authentication errors (401 Unauthorized)
              // These should never be retried as they indicate missing/invalid credentials
              if (data.type === 'error' && data.message &&
                  (data.message.includes('401 Unauthorized') ||
                   data.message.includes('401') ||
                   data.message.includes('Unauthorized'))) {
                authError = true;
                await log('\n❌ Authentication error detected: 401 Unauthorized', { level: 'error' });
                await log('   This error cannot be resolved by retrying.', { level: 'error' });
                await log('   💡 Please run: codex login', { level: 'error' });
              }

              // Also check turn.failed events for auth errors
              if (data.type === 'turn.failed' && data.error && data.error.message &&
                  (data.error.message.includes('401 Unauthorized') ||
                   data.error.message.includes('401') ||
                   data.error.message.includes('Unauthorized'))) {
                authError = true;
                await log('\n❌ Authentication error detected in turn.failed event', { level: 'error' });
                await log('   This error cannot be resolved by retrying.', { level: 'error' });
                await log('   💡 Please run: codex login', { level: 'error' });
              }
            }
          } catch {
            // Not JSON, continue
          }
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
            tool: 'Codex',
            resetTime: limitInfo.resetTime,
            sessionId,
            resumeCommand: sessionId ? `${process.argv[0]} ${process.argv[1]} ${argv.url} --resume ${sessionId}` : null
          });

          for (const line of messageLines) {
            await log(line, { level: 'warning' });
          }
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
          limitResetTime
        };
      }

      await log('\n\n✅ Codex command completed');

      return {
        success: true,
        sessionId,
        limitReached,
        limitResetTime
      };
    } catch (error) {
      // Don't report auth errors to Sentry as they are user configuration issues
      if (!error.isAuthError) {
        reportError(error, {
          context: 'execute_codex',
          command: params.command,
          codexPath: params.codexPath,
          operation: 'run_codex_command'
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
        limitResetTime: null
      };
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
      await log(`⚠️ Warning: Could not check git status: ${gitStatusResult.stderr?.toString().trim()}`, { level: 'warning' });
      return false;
    }
  } catch (gitError) {
    reportError(gitError, {
      context: 'check_uncommitted_changes_codex',
      tempDir,
      operation: 'git_status_check'
    });
    await log(`⚠️ Warning: Error checking for uncommitted changes: ${gitError.message}`, { level: 'warning' });
    return false;
  }
};

// Export all functions as default object too
export default {
  validateCodexConnection,
  handleCodexRuntimeSwitch,
  executeCodex,
  executeCodexCommand,
  checkForUncommittedChanges
};
