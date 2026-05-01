export const validateToolConnection = async ({ tool = 'claude', model, verbose = false, validateClaudeConnection } = {}) => {
  if (tool === 'opencode') {
    return (await import('./opencode.lib.mjs')).validateOpenCodeConnection(model);
  }
  if (tool === 'codex') {
    return (await import('./codex.lib.mjs')).validateCodexConnection(model, verbose);
  }
  if (tool === 'agent') {
    return (await import('./agent.lib.mjs')).validateAgentConnection(model);
  }
  if (tool === 'qwen') {
    return (await import('./qwen.lib.mjs')).validateQwenConnection(model);
  }
  const validateClaude = validateClaudeConnection || (await import('./claude.lib.mjs')).validateClaudeConnection;
  return validateClaude(model);
};
