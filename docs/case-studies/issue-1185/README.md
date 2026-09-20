# Case Study: Issue #1185 - Not all free models supported in `--tool agent`

## Issue Summary

**Issue URL:** https://github.com/link-assistant/hive-mind/issues/1185
**Created:** 2026-01-26
**Labels:** bug
**Reporter:** @konard

### Problem Statement

When using the `/solve` or `/hive` commands with `--tool agent`, certain model identifiers that are valid in the Agent CLI are not recognized by hive-mind's model validation system.

**Failed Command:**

```bash
/solve https://github.com/konard/test-hello-world-019bf908-623b-756c-8221-cc5f0c8444e5/issues/1 --tool agent --model opencode/gpt-5-nano
```

**Error Message:**

```
❌ Unrecognized model: "opencode/gpt-5-nano"
   Available models for agent: grok, grok-code, grok-code-fast-1, big-pickle, sonnet, haiku, opus, gemini-3-pro
```

## Timeline / Sequence of Events

1. **Agent CLI Released** - The `@link-assistant/agent` package supports models in `<provider>/<model-id>` format (e.g., `opencode/gpt-5-nano`)
2. **Hive-mind Integration** - When `--tool agent` was added to hive-mind, model validation was implemented in `model-validation.lib.mjs`
3. **Incomplete Alias Mapping** - The `AGENT_MODELS` map in `model-validation.lib.mjs` included:
   - Short aliases: `gpt-5-nano`, `big-pickle`
   - Full IDs with `openai/` prefix: `openai/gpt-5-nano`
   - Full IDs with `opencode/` prefix: `opencode/big-pickle`
   - **Missing**: `opencode/gpt-5-nano` (the actual ID used by OpenCode Zen)
4. **User Reports Issue** - User attempts to use `opencode/gpt-5-nano` (a valid agent model) and receives validation error

## Root Cause Analysis

### Primary Cause

The `AGENT_MODELS` mapping in `/src/model-validation.lib.mjs` has an inconsistency:

```javascript
// Current (incorrect) mapping:
export const AGENT_MODELS = {
  // ...
  'gpt-5-nano': 'openai/gpt-5-nano', // Maps to WRONG provider
  'openai/gpt-5-nano': 'openai/gpt-5-nano', // WRONG - should be opencode/gpt-5-nano
  // Missing: 'opencode/gpt-5-nano': 'opencode/gpt-5-nano'
};
```

According to the official Agent CLI documentation (MODELS.md), the correct model ID is `opencode/gpt-5-nano`, NOT `openai/gpt-5-nano`.

### Evidence from Agent MODELS.md

From the official agent documentation:

```
| Model        | Model ID                | Input | Output | Cached Read | Cached Write |
| ------------ | ----------------------- | ----- | ------ | ----------- | ------------ |
| GPT 5 Nano   | `opencode/gpt-5-nano`   | Free  | Free   | Free        | -            |
| Big Pickle   | `opencode/big-pickle`   | Free  | Free   | Free        | -            |
```

### Secondary Causes

1. **Incomplete validation mapping**: The validation module does not include all valid provider-prefixed model IDs
2. **Provider prefix inconsistency**: `gpt-5-nano` was mapped to `openai/gpt-5-nano` instead of `opencode/gpt-5-nano`
3. **Missing user-facing aliases**: The `opencode/gpt-5-nano` format should be accepted since it's the canonical format in agent docs

## Models That Should Be Supported

Based on the issue requirements, these model identifiers should all work with `--tool agent`:

| Input (User Provides) | Should Map To         | Currently Works?            |
| --------------------- | --------------------- | --------------------------- |
| `gpt-5-nano`          | `opencode/gpt-5-nano` | ❌ (maps to wrong provider) |
| `opencode/gpt-5-nano` | `opencode/gpt-5-nano` | ❌ (not in AGENT_MODELS)    |
| `big-pickle`          | `opencode/big-pickle` | ✅                          |
| `opencode/big-pickle` | `opencode/big-pickle` | ✅                          |

## Related External Issues

Research found related issues in the OpenCode ecosystem:

1. **OpenCode Issue #6493**: "OpenAI provider fails: gpt-5-nano missing from models.dev registry causes ProviderModelNotFoundError"
   - Root cause: OpenCode's model registry doesn't include `gpt-5-nano`
   - URL: https://github.com/sst/opencode/issues/6493

2. **OpenCode Issue #9520**: "opencode/gpt-5-nano model available in CLI but missing from TUI"
   - Shows CLI vs TUI discrepancy
   - URL: https://github.com/anomalyco/opencode/issues/9520

## Proposed Solution

### Fix 1: Update AGENT_MODELS in model-validation.lib.mjs

Update the `AGENT_MODELS` mapping to:

1. Fix `gpt-5-nano` short alias to map to `opencode/gpt-5-nano` (not `openai/gpt-5-nano`)
2. Add `opencode/gpt-5-nano` as a valid full model ID
3. Remove incorrect `openai/gpt-5-nano` mapping (agent uses OpenCode Zen, not direct OpenAI)

```javascript
export const AGENT_MODELS = {
  // Free models (via OpenCode Zen)
  grok: 'opencode/grok-code',
  'grok-code': 'opencode/grok-code',
  'grok-code-fast-1': 'opencode/grok-code',
  'big-pickle': 'opencode/big-pickle',
  'gpt-5-nano': 'opencode/gpt-5-nano', // FIX: Changed from openai/ to opencode/
  // Premium models (requires OpenCode Zen subscription)
  sonnet: 'anthropic/claude-3-5-sonnet',
  haiku: 'anthropic/claude-3-5-haiku',
  opus: 'anthropic/claude-3-opus',
  'gemini-3-pro': 'google/gemini-3-pro',
  // Full model IDs
  'opencode/grok-code': 'opencode/grok-code',
  'opencode/big-pickle': 'opencode/big-pickle',
  'opencode/gpt-5-nano': 'opencode/gpt-5-nano', // FIX: Added correct ID
  // Removed: 'openai/gpt-5-nano' (incorrect provider)
  'anthropic/claude-3-5-sonnet': 'anthropic/claude-3-5-sonnet',
  'anthropic/claude-3-5-haiku': 'anthropic/claude-3-5-haiku',
  'anthropic/claude-3-opus': 'anthropic/claude-3-opus',
  'google/gemini-3-pro': 'google/gemini-3-pro',
};
```

### Fix 2: Update agent.lib.mjs mapModelToId function

Ensure the `mapModelToId` function in `agent.lib.mjs` also uses the correct provider:

```javascript
export const mapModelToId = model => {
  const modelMap = {
    grok: 'opencode/grok-code',
    'grok-code': 'opencode/grok-code',
    'grok-code-fast-1': 'opencode/grok-code',
    'big-pickle': 'opencode/big-pickle',
    'gpt-5-nano': 'opencode/gpt-5-nano', // FIX: Changed from openai/ to opencode/
    sonnet: 'anthropic/claude-3-5-sonnet',
    haiku: 'anthropic/claude-3-5-haiku',
    opus: 'anthropic/claude-3-opus',
    'gemini-3-pro': 'google/gemini-3-pro',
  };
  return modelMap[model] || model;
};
```

## Files to Modify

1. `/src/model-validation.lib.mjs` - Update `AGENT_MODELS` constant (lines 68-88)
2. `/src/agent.lib.mjs` - Update `mapModelToId` function (lines 154-169)

## Testing Plan

1. Unit test: Verify `validateModelName('opencode/gpt-5-nano', 'agent')` returns valid
2. Unit test: Verify `validateModelName('gpt-5-nano', 'agent')` maps to `opencode/gpt-5-nano`
3. Integration test: Run `solve --tool agent --model opencode/gpt-5-nano --dry-run` with a test issue
4. Integration test: Run `solve --tool agent --model gpt-5-nano --dry-run` with a test issue

## Impact Assessment

- **Severity:** Medium - Affects usability of free models with agent tool
- **Users Affected:** Any user trying to use `opencode/gpt-5-nano` or `gpt-5-nano` with `--tool agent`
- **Breaking Changes:** None - This is a fix to add missing functionality
- **Backwards Compatibility:** Maintains support for existing aliases while adding new valid inputs

## References

- Issue: https://github.com/link-assistant/hive-mind/issues/1185
- Agent MODELS.md: https://github.com/link-assistant/agent/blob/main/MODELS.md
- OpenCode Zen Documentation: https://opencode.ai/docs/zen/
- Related PR #866: Set default model of --tool agent to grok-code
- OpenCode Issue #6493: https://github.com/sst/opencode/issues/6493

## Artifacts

- Screenshot: `./screenshots/screenshot1.png` - Original issue screenshot
- Agent MODELS.md: `./agent-models.md` - Official supported models documentation
