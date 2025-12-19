# Case Study: Issue #865 - Agent Tool Default Model Error

## Quick Links

- [00-OVERVIEW.md](./00-OVERVIEW.md) - Executive summary and issue details
- [01-TIMELINE.md](./01-TIMELINE.md) - Chronological sequence of events
- [02-ROOT-CAUSES.md](./02-ROOT-CAUSES.md) - Deep dive into root causes
- [03-SOLUTIONS.md](./03-SOLUTIONS.md) - Proposed solutions and recommendations
- [full-log.txt](./full-log.txt) - Complete execution log from Gist

## Problem Statement

When using `solve <issue> --tool agent` without specifying a `--model` flag, the system fails with a `ProviderModelNotFoundError` because the default model is set to `anthropic/claude-3-5-sonnet`, a premium model requiring OpenCode Zen subscription.

## Root Cause

The default model selection in `src/solve.config.lib.mjs` does not handle the `agent` tool case, causing it to fall back to `'sonnet'`, which maps to a premium model.

## Solution

Add a case for the `agent` tool in the default model selection to use `'grok-code'` (maps to `opencode/grok-code`), a free model requiring no subscription.

**File**: `src/solve.config.lib.mjs`, lines 86-94

**Change**:
```diff
  default: (currentParsedArgs) => {
    // Dynamic default based on tool selection
    if (currentParsedArgs?.tool === 'opencode') {
      return 'grok-code-fast-1';
    } else if (currentParsedArgs?.tool === 'codex') {
      return 'gpt-5';
+   } else if (currentParsedArgs?.tool === 'agent') {
+     return 'grok-code';
    }
    return 'sonnet';
  }
```

## Key Findings

1. **Model Mapping**: The `sonnet` alias maps to different model IDs for different tools:
   - Claude: `claude-sonnet-4-5-20250929` (uses user's Claude subscription)
   - Agent: `anthropic/claude-3-5-sonnet` (requires OpenCode Zen subscription)

2. **Free vs Premium**: Agent tool supports both free and premium models:
   - Free: `opencode/grok-code`, `opencode/big-pickle`, `openai/gpt-5-nano`
   - Premium: `anthropic/claude-3-5-sonnet`, `anthropic/claude-3-opus`, `google/gemini-3-pro`

3. **Consistency**: Other tools already default to free/accessible models:
   - OpenCode: `grok-code-fast-1` (free)
   - Codex: `gpt-5` (free via Codex)
   - Agent: Should also default to free model

## Impact

- Users without OpenCode Zen subscription cannot use `--tool agent` without explicitly specifying `--model grok-code`
- Poor user experience (immediate failure)
- Inconsistent with other tools

## Testing

The fix should be tested with:

1. `solve <issue> --tool agent` → should use `grok-code`
2. `solve <issue> --tool agent --model sonnet` → should use `sonnet` (explicit override)
3. Other tools should remain unaffected

## Related Issues

- Issue #863: Original issue being solved when this error was discovered
- OpenCode subscription model: Free models vs OpenCode Zen premium models

## External References

- [OpenCode Models Documentation](https://opencode.ai/docs/models/)
- [OpenCode GitHub Issues](https://github.com/sst/opencode/issues/)
- [Stop Paying Twice: Connecting Claude's Subscription to OpenCode](https://zestbyhaseeb.substack.com/p/stop-paying-twice-connecting-claudes)

## Lessons Learned

1. **Default Values Matter**: Default configurations should use the most accessible option (free models)
2. **Consistency**: New tool integrations should follow existing patterns
3. **Documentation**: Tool-specific model options should be documented in help text
4. **Testing**: Default configurations should be tested for all tool types
5. **Error Messages**: Could be improved to suggest free model alternatives
