// Claude Code has separate controls for the main conversation and everything
// outside it, including subagents, workflows, teammates and compaction.
export const CLAUDE_PROMPT_CACHE_DEFAULTS = Object.freeze({
  promptCacheTtl: '1h',
  subagentPromptCacheTtl: '1h',
});

export const isClaudePromptCacheTtl = value => value === '5m' || value === '1h';

export function buildClaudePromptCacheEnv(baseEnv = process.env) {
  const mainTtl = baseEnv.CLAUDE_CODE_PROMPT_CACHE_TTL;
  const subagentTtl = baseEnv.CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL;
  return {
    CLAUDE_CODE_PROMPT_CACHE_TTL: isClaudePromptCacheTtl(mainTtl) ? mainTtl : CLAUDE_PROMPT_CACHE_DEFAULTS.promptCacheTtl,
    CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL: isClaudePromptCacheTtl(subagentTtl) ? subagentTtl : CLAUDE_PROMPT_CACHE_DEFAULTS.subagentPromptCacheTtl,
    // Also forward the global opt-out to launchers with a separate environment.
    ...(baseEnv.FORCE_PROMPT_CACHING_5M === '1' && { FORCE_PROMPT_CACHING_5M: '1' }),
  };
}
