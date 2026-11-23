import { assertRouterTaskAuthentication } from './router-auth-guard.lib.mjs';

/**
 * Issue #3215: a Formal AI model runs through the `formal-ai with <tool>`
 * wrapper, so the check is the wrapper's client registry and the tool's CLI,
 * not a request to the tool's own provider. solve and hive share this, so
 * `hive --model formal-ai` no longer sends a live `formal-ai` request to
 * Anthropic or OpenAI at startup.
 */
export const validateFormalAiDispatch = async ({ tool = 'claude', log = async () => {}, validateFormalAiToolConnection = null } = {}) => {
  const validate = validateFormalAiToolConnection || (await import('./formal-ai.lib.mjs')).validateFormalAiToolConnection;
  const formalAiValidation = await validate(tool);
  // Record the wrapper version on both paths: the wrapper builds the tool's
  // argv, so its version is the first thing needed to explain a failure
  // (issue #2130's logs recorded neither, which left the round-2 claude
  // failure unattributable).
  const formalAiVersionLine = `📦 Formal AI wrapper version: ${formalAiValidation.formalAiVersion || 'unknown'}`;
  if (formalAiValidation.valid) {
    await log(`✅ Formal AI wrapper and ${tool} CLI are available`);
    await log(formalAiVersionLine);
    if (formalAiValidation.version) await log(`📦 ${tool} CLI version: ${formalAiValidation.version}`);
    return true;
  }
  await log(`❌ Formal AI dispatch validation failed: ${formalAiValidation.error}`, { level: 'error' });
  await log(`   ${formalAiVersionLine}`, { level: 'error' });
  await log('   Install or update the wrapper with: cargo install formal-ai', { level: 'error' });
  return false;
};

export const validateToolConnection = async ({ tool = 'claude', model, verbose = false, useRouter = false, validateClaudeConnection, log, validateFormalAiToolConnection = null } = {}) => {
  assertRouterTaskAuthentication({ tool, env: { ...process.env, ...(useRouter === true ? { HIVE_MIND_USE_ROUTER: '1' } : {}) } });
  const { isFormalAiModel } = await import('./formal-ai-model.lib.mjs');
  if (isFormalAiModel(model)) return validateFormalAiDispatch({ tool, log, validateFormalAiToolConnection });
  if (tool === 'opencode') {
    return (await import('./opencode.lib.mjs')).validateOpenCodeConnection(model, { useRouter });
  }
  if (tool === 'codex') {
    return (await import('./codex.lib.mjs')).validateCodexConnection(model, verbose, { useRouter });
  }
  if (tool === 'agent') {
    return (await import('./agent.lib.mjs')).validateAgentConnection(model, { useRouter });
  }
  if (tool === 'qwen') {
    return (await import('./qwen.lib.mjs')).validateQwenConnection(model, undefined, { useRouter });
  }
  if (tool === 'gemini') {
    return (await import('./gemini.lib.mjs')).validateGeminiConnection(model, { useRouter });
  }
  const validateClaude = validateClaudeConnection || (await import('./claude.lib.mjs')).validateClaudeConnection;
  return validateClaude(model, { useRouter });
};
