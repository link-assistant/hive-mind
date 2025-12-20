# Root Cause Analysis - Issue #865

## Primary Root Cause

### Missing Agent Tool Case in Default Model Selection

**Location**: `src/solve.config.lib.mjs`, lines 86-94

**Current Code**:
```javascript
.option('model', {
  type: 'string',
  description: 'Model to use (for claude: opus, sonnet, haiku, haiku-3-5, haiku-3; for opencode: grok, gpt4o; for codex: gpt5, gpt5-codex, o3)',
  alias: 'm',
  default: (currentParsedArgs) => {
    // Dynamic default based on tool selection
    if (currentParsedArgs?.tool === 'opencode') {
      return 'grok-code-fast-1';
    } else if (currentParsedArgs?.tool === 'codex') {
      return 'gpt-5';
    }
    return 'sonnet';  // <-- PROBLEM: This is returned for 'agent' tool
  }
})
```

**Issue**: When `argv.tool === 'agent'`, the function falls through to the default `return 'sonnet'` statement.

## Model Mapping Chain

### Step-by-Step Model Resolution for Agent Tool

1. **User Command**: `solve <issue> --tool agent` (no `--model` flag)
2. **Config Default**: `currentParsedArgs.tool === 'agent'` → falls through → `return 'sonnet'`
3. **Agent Execution**: `argv.model === 'sonnet'`
4. **Model Mapping** (`src/agent.lib.mjs:23-38`):
   ```javascript
   const modelMap = {
     'sonnet': 'anthropic/claude-3-5-sonnet',  // <-- Maps here
     // ... other mappings
   };
   ```
5. **Final Model ID**: `'anthropic/claude-3-5-sonnet'`
6. **Agent Command**: `agent --model anthropic/claude-3-5-sonnet`
7. **Error**: Provider cannot find model (requires OpenCode Zen subscription)

## Why This Is a Problem

### 1. Premium Model Requires Subscription

The `anthropic/claude-3-5-sonnet` model is a **premium model** in the OpenCode ecosystem:

- **Free Models**: `opencode/grok-code`, `opencode/big-pickle`, `openai/gpt-5-nano`
- **Premium Models** (require OpenCode Zen): `anthropic/claude-3-5-sonnet`, `anthropic/claude-3-opus`, `google/gemini-3-pro`

Source: `src/model-validation.lib.mjs`, lines 68-88

### 2. Authentication/Subscription Check Bypassed

From the log (line 28):
```
⏩ Skipping tool connection validation (dry-run mode or skip-tool-connection-check enabled)
```

The `--no-tool-check` flag bypassed the `validateAgentConnection()` function that might have caught this issue earlier. However, even without this flag, the issue would still occur - it would just fail at validation time instead of execution time.

### 3. Inconsistent with Other Tools

Current defaults:
- **OpenCode**: `'grok-code-fast-1'` → `'opencode/grok-code'` ✅ Free model
- **Codex**: `'gpt-5'` → `'gpt-5'` ✅ Free model (via Codex)
- **Claude**: `'sonnet'` → `'claude-sonnet-4-5-20250929'` ✅ Uses user's Claude subscription
- **Agent**: `'sonnet'` → `'anthropic/claude-3-5-sonnet'` ❌ Premium OpenCode model

The `agent` tool should default to a free model like `opencode` does.

## Contributing Factors

### 1. Recent Addition of Agent Tool

The `agent` tool appears to be a newer addition to the codebase, and the default model configuration in `solve.config.lib.mjs` was not updated to include it.

Evidence:
- OpenCode and Codex tools have explicit cases in the default model function
- Agent tool support exists in `src/agent.lib.mjs` with proper model mapping
- The default model function was simply not updated when agent support was added

### 2. Model Mapping Reuse

The `agent.lib.mjs` reuses the same model alias `'sonnet'` as the Claude tool:

**Claude** (`src/model-validation.lib.mjs:15-28`):
```javascript
export const CLAUDE_MODELS = {
  'sonnet': 'claude-sonnet-4-5-20250929',
  // ...
};
```

**Agent** (`src/model-validation.lib.mjs:68-88`):
```javascript
export const AGENT_MODELS = {
  'sonnet': 'anthropic/claude-3-5-sonnet',  // Different mapping!
  // ...
};
```

This reuse of the alias `'sonnet'` for different models creates confusion. The default configuration returns `'sonnet'` thinking it's safe (works for Claude tool), but for Agent tool, it maps to a premium model.

### 3. No Validation at Configuration Time

The model validation in `src/model-validation.lib.mjs` is only called during execution, not during argument parsing. The `validateModelName()` function could theoretically catch this, but it's not invoked early enough.

### 4. Documentation Gap

The model option description (line 84) mentions models for claude, opencode, and codex, but does not mention agent:

```javascript
description: 'Model to use (for claude: opus, sonnet, haiku, haiku-3-5, haiku-3; for opencode: grok, gpt4o; for codex: gpt5, gpt5-codex, o3)',
```

This documentation gap may have contributed to the oversight.

## External Factors

### OpenCode Subscription Model

Based on web research:
- OpenCode uses a subscription model called "OpenCode Zen" for premium models
- Free models include `opencode/grok-code`, which is available without authentication
- Premium models like `anthropic/claude-3-5-sonnet` require authentication via OpenCode
- The `ProviderModelNotFoundError` occurs when trying to use a premium model without proper authentication

Sources:
- [OpenCode Models Documentation](https://opencode.ai/docs/models/)
- [OpenCode Issues on GitHub](https://github.com/sst/opencode/issues/)

## Error Propagation Path

```
solve.mjs
  ↓
solve.config.lib.mjs (default model selection)
  ↓ returns 'sonnet'
agent.lib.mjs (mapModelToId)
  ↓ maps to 'anthropic/claude-3-5-sonnet'
agent CLI execution
  ↓
@link-assistant/agent package
  ↓
provider.ts:524 (getModel function)
  ↓ throws ProviderModelNotFoundError
```

## Why It Wasn't Caught Earlier

1. **No Tests for Agent Default Model**: Test suite likely doesn't test the default model for `--tool agent`
2. **Manual Testing Used Explicit Model**: Developers likely tested with `--model grok-code` explicitly
3. **Validation Skipped**: The `--no-tool-check` flag was used, bypassing early validation
4. **Recent Feature**: Agent tool may have been added recently without full integration testing

## Fix Verification Points

To prevent regression, the fix should ensure:

1. ✅ Default model for `--tool agent` is a free model
2. ✅ Consistency with opencode tool (both use OpenCode backend)
3. ✅ Documentation updated to mention agent tool models
4. ✅ Test coverage added for agent default model
5. ✅ No impact on other tools (claude, opencode, codex)
