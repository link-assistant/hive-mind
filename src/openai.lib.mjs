#!/usr/bin/env node
// OpenAI-compatible (Chat Completions) integration

// Ensure use-m is available for utilities similar to other libs
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

// Note: No filesystem operations are needed here; keep deps minimal

import { log } from './lib.mjs';
import { reportError } from './sentry.lib.mjs';

// Basic model mapper (pass-through by default)
export const mapModelToId = (model) => model;

// Resolve endpoint and API key from argv/env
const resolveConfig = (argv) => {
  const endpoint = argv.openaiEndpoint || process.env.HIVE_MIND_OPENAI_ENDPOINT || process.env.OPENAI_COMPAT_ENDPOINT;
  const apiKey = argv.openaiApiKey || process.env.HIVE_MIND_OPENAI_API_KEY || process.env.OPENAI_API_KEY || process.env.OPENAI_COMPAT_API_KEY;
  return { endpoint, apiKey };
};

// Validate OpenAI-compatible connection with a tiny request
export const validateOpenAIConnection = async (model = 'gpt-4o', argv = {}) => {
  const { endpoint, apiKey } = resolveConfig(argv);

  try {
    await log('🔍 Validating OpenAI-compatible endpoint...');

    if (!endpoint) {
      await log('❌ Missing endpoint. Provide --openai-endpoint or HIVE_MIND_OPENAI_ENDPOINT', { level: 'error' });
      return false;
    }
    if (!apiKey) {
      await log('❌ Missing API key. Provide --openai-api-key or HIVE_MIND_OPENAI_API_KEY', { level: 'error' });
      return false;
    }

    const body = {
      model: mapModelToId(model),
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
      stream: false
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 401 || /unauthorized|invalid api key/i.test(text)) {
        await log('❌ OpenAI-compatible authentication failed (401 Unauthorized)', { level: 'error' });
      } else {
        await log(`❌ Endpoint validation failed: HTTP ${res.status}`, { level: 'error' });
        if (text) await log(`   Body: ${text.substring(0, 500)}`, { level: 'error' });
      }
      return false;
    }

    await log('✅ OpenAI-compatible endpoint validated successfully');
    return true;
  } catch (error) {
    await log(`❌ Failed to validate OpenAI-compatible endpoint: ${error.message}`, { level: 'error' });
    return false;
  }
};

// Execute with prompts by calling the endpoint
export const executeOpenAI = async (params) => {
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
    getResourceSnapshot
  } = params;

  const { buildUserPrompt, buildSystemPrompt } = await import('./openai.prompts.lib.mjs');

  const userPrompt = buildUserPrompt({
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

  await log(`\n${formatAligned('🤖', 'Executing OpenAI-compatible:', argv.model.toUpperCase())}`);
  if (argv.verbose) {
    await log(`   Model: ${argv.model}`, { verbose: true });
    await log(`   Working directory: ${tempDir}`, { verbose: true });
    await log(`   Branch: ${branchName}`, { verbose: true });
    await log(`   User prompt length: ${userPrompt.length} chars`, { verbose: true });
    await log(`   System prompt length: ${systemPrompt.length} chars`, { verbose: true });
  }

  const resourcesBefore = await getResourceSnapshot();
  await log('📈 System resources before execution:', { verbose: true });
  await log(`   Memory: ${resourcesBefore.memory.split('\n')[1]}`, { verbose: true });
  await log(`   Load: ${resourcesBefore.load}`, { verbose: true });

  const { endpoint, apiKey } = resolveConfig(argv);

  try {
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: userPrompt });

    const body = {
      model: mapModelToId(argv.model),
      messages,
      // Non-streaming for simplicity and robustness
      stream: false
    };

    await log(`\n${formatAligned('📝', 'HTTP:', '')}`);
    await log(`${endpoint} [POST]`);

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    const text = await res.text();
    if (!res.ok) {
      await log(`❌ OpenAI-compatible request failed: HTTP ${res.status}`, { level: 'error' });
      if (text) await log(text.substring(0, 2000), { level: 'error' });
      return { success: false, sessionId: null, limitReached: false, limitResetTime: null };
    }

    // Try to parse JSON and log assistant content
    let json;
    try { json = JSON.parse(text); } catch { json = null; }
    if (json && json.choices && json.choices.length > 0) {
      const content = json.choices[0]?.message?.content || '';
      if (content) {
        await log(`\n${formatAligned('▶️', 'Response:', '')}\n`);
        await log(content);
      }
    } else {
      // If not standard shape, still print raw
      await log(`\n${formatAligned('▶️', 'Raw response:', '')}\n`);
      await log(text);
    }

    const resourcesAfter = await getResourceSnapshot();
    await log('\n📈 System resources after execution:', { verbose: true });
    await log(`   Memory: ${resourcesAfter.memory.split('\n')[1]}`, { verbose: true });
    await log(`   Load: ${resourcesAfter.load}`, { verbose: true });

    await log('\n\n✅ OpenAI-compatible command completed');
    return { success: true, sessionId: null, limitReached: false, limitResetTime: null };
  } catch (error) {
    reportError(error, { context: 'execute_openai', operation: 'http_chat_completions' });
    await log(`\n\n❌ Error executing OpenAI-compatible request: ${error.message}`, { level: 'error' });
    return { success: false, sessionId: null, limitReached: false, limitResetTime: null };
  }
};

// Post-execution check (same semantics as other tools)
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
            const commitMessage = 'Auto-commit: Changes made by OpenAI-compatible tool during problem-solving session';
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
          await log('   The tool made changes that were not committed.');
          await log('');
          await log('🔄 AUTO-RESTART: Restarting to handle uncommitted changes...');
          await log('   The tool will review the changes and decide what to commit.');
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
      context: 'check_uncommitted_changes_openai',
      tempDir,
      operation: 'git_status_check'
    });
    await log(`⚠️ Warning: Error checking for uncommitted changes: ${gitError.message}`, { level: 'warning' });
    return false;
  }
};

export default {
  mapModelToId,
  validateOpenAIConnection,
  executeOpenAI,
  checkForUncommittedChanges
};
