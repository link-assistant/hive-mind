# Case Study: Issue #1473 — Model Recognition Fix and Free Models Sync

> **Issue**: [#1473](https://github.com/link-assistant/hive-mind/issues/1473) — Use minimax-m2.5-free as default model for `--tool agent`
> **Date**: March 25, 2026
> **Status**: Resolved

## Timeline of Events

1. **March 24, 2026 12:01 UTC** — A solve session was started for [Jhon-Crow/godot-topdown-MVP PR #1428](https://github.com/Jhon-Crow/godot-topdown-MVP/pull/1428) using:
   ```
   solve https://github.com/Jhon-Crow/godot-topdown-MVP/pull/1428 --tool agent --model kimi-k2.5-free
   ```
2. **12:02:11 UTC** — The Agent CLI received the model request. Because `kimi-k2.5-free` was no longer available on OpenCode Zen, Agent CLI silently redirected to `opencode/minimax-m2.5-free`:
   ```json
   {
     "rawModel": "opencode/minimax-m2.5-free",
     "providerID": "opencode",
     "modelID": "minimax-m2.5-free",
     "message": "using explicit provider/model"
   }
   ```
3. **12:03:57 UTC** — The agent session completed after processing 15 steps using MiniMax M2.5.
4. **12:04:00 UTC** — The solution draft log was uploaded to the PR with incorrect model recognition:
   - The "Models used" section showed `opencode/kimi-k2.5-free` (the requested model) instead of the actual `opencode/minimax-m2.5-free` (the model that was used)
   - A false warning appeared: `⚠️ Warning: Main model opencode/kimi-k2.5-free does not match requested model kimi-k2.5-free`
   - Token usage showed `0 input, 0 output` because pricingInfo was based on the wrong model

## Root Causes

### Root Cause 1: Duplicated Model Mappings in `resolveModelId()`

**File**: `src/model-info.lib.mjs`, function `resolveModelId()` (line 254)

The `resolveModelId()` function maintained its own hardcoded copy of model mappings rather than importing from `model-mapping.lib.mjs`. The `agent` tool section only had 5 entries:

```javascript
agent: {
  grok: 'opencode/grok-code',
  'grok-code': 'opencode/grok-code',
  sonnet: 'anthropic/claude-3-5-sonnet',
  opus: 'anthropic/claude-3-opus',
  haiku: 'anthropic/claude-3-5-haiku',
}
```

This was missing ALL free model mappings (`kimi-k2.5-free`, `minimax-m2.5-free`, `big-pickle`, `gpt-5-nano`, all Kilo models, etc.). When the function received `kimi-k2.5-free`, it returned it as-is (without the `opencode/` prefix), causing `doesRequestedMatchActual()` to fail because `kimi-k2.5-free` !== `opencode/kimi-k2.5-free`.

### Root Cause 2: Missing Base Model Pricing Mapping

**File**: `src/agent.lib.mjs`, function `getBaseModelForPricing()` (line 114)

The `freeToBaseMap` was missing a mapping for `minimax-m2.5-free` → `minimax-m2.5`. While the generic `-free` suffix stripping handled it as a fallback, having an explicit mapping improves reliability and makes the intent clear.

### Root Cause 3: Outdated Default Model in `validateAgentConnection()`

**File**: `src/agent.lib.mjs`, function `validateAgentConnection()` (line 330)

The default parameter was still `grok-code-fast-1` instead of `minimax-m2.5-free`.

## Solution

### Fix 1: Use `mapModelForTool` as Single Source of Truth

Replaced the duplicated hardcoded maps in `resolveModelId()` with a single call to `mapModelForTool()` from `model-mapping.lib.mjs`:

```javascript
export const resolveModelId = (requestedModel, tool) => {
  if (!requestedModel) return null;
  try {
    const toolName = (tool || 'claude').toString().toLowerCase();
    const cleanModel = requestedModel.replace(/\[1m\]$/i, '');
    return mapModelForTool(toolName, cleanModel);
  } catch {
    return requestedModel;
  }
};
```

This ensures:

- `resolveModelId('kimi-k2.5-free', 'agent')` → `'opencode/kimi-k2.5-free'` (matches actual model ID)
- `resolveModelId('minimax-m2.5-free', 'agent')` → `'opencode/minimax-m2.5-free'`
- All future model mapping updates in `model-mapping.lib.mjs` automatically apply here

### Fix 2: Added Missing Base Model Pricing Mappings

Added `minimax-m2.5-free`, `glm-5-free`, `glm-4.5-air-free`, `deepseek-r1-free`, `giga-potato-free` to `freeToBaseMap`.

### Fix 3: Updated Default Models and Documentation

- Changed `validateAgentConnection()` default to `minimax-m2.5-free`
- Updated `README.md` examples to use `minimax-m2.5-free` instead of `kimi-k2.5-free`
- Updated `docs/FREE_MODELS.md` to match upstream [Agent CLI FREE_MODELS.md](https://github.com/link-assistant/agent/blob/main/FREE_MODELS.md)

## Impact

- **False Warning Eliminated**: The `doesRequestedMatchActual()` function now correctly resolves agent model aliases
- **Accurate Model Reporting**: PR comments will show the correct model name and pricing
- **DRY Compliance**: `resolveModelId()` no longer duplicates `model-mapping.lib.mjs` — changes to model mappings only need to happen in one place

## Data Files

- [`solution-draft-log-pr-1774353841796.txt`](./solution-draft-log-pr-1774353841796.txt) — Full execution log showing the model redirection from kimi-k2.5-free to minimax-m2.5-free
