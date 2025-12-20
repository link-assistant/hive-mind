# Root Cause Analysis

## Executive Summary

There are **THREE DISTINCT ROOT CAUSES** contributing to this issue:

1. **No early model name validation** - Invalid models reach the API without client-side checks
2. **Claude CLI routing costs** - Internal model discovery/routing in Claude CLI incurs API costs before validation
3. **Inconsistent validation across tools** - Model validation only happens in `validateClaudeConnection()`, which can be skipped

## Root Cause #1: No Early Model Name Validation

### Code Location
`src/claude.lib.mjs:43-45`

```javascript
export const mapModelToId = (model) => {
  return availableModels[model] || model;
};
```

### Problem Description

The `mapModelToId` function is a **pure pass-through** when the model name is not in the alias map:
- Input: `"oups"`
- Lookup in `availableModels`: Not found
- Return: `"oups"` (unchanged)

**This is by design** to allow custom model IDs, but creates a validation gap.

### Flow Analysis

1. **Argument parsing** (uses yargs)
   - `argv.model` is set to user input
   - No validation at this stage

2. **Model mapping** (src/claude.lib.mjs:843)
   ```javascript
   const mappedModel = mapModelToId(argv.model);
   ```
   - Maps aliases to full IDs
   - **Does not validate** if model exists
   - Unknown names pass through unchanged

3. **Command execution** (src/claude.lib.mjs:844)
   ```javascript
   const command = `claude --model ${mappedModel} -p ...`;
   ```
   - Invalid model name sent to Claude CLI
   - No validation before subprocess spawn

4. **API call** (inside Claude CLI)
   - Claude CLI receives `--model oups`
   - Makes API call to Anthropic
   - API rejects with 404 error

### Why This Design Exists

**Intentional flexibility**: The pass-through design allows users to specify:
- New model IDs not yet in the alias list
- Beta/preview model names
- Organization-specific model variants

**Trade-off**: Flexibility vs. early error detection

### The Real Problem

The issue is NOT that `mapModelToId` doesn't validate. The issue is that **no validation happens anywhere before the API call**.

## Root Cause #2: Claude CLI Routing Costs

### Evidence from Logs

Despite the error, two different models were charged:

```json
{
  "usage": {
    "input_tokens": 0,
    "output_tokens": 0
  },
  "modelUsage": {
    "claude-haiku-4-5-20251001": {
      "inputTokens": 1198,
      "outputTokens": 188,
      "costUSD": 0.002138
    },
    "claude-opus-4-5-20251101": {
      "inputTokens": 1039,
      "outputTokens": 791,
      "costUSD": 0.02497
    }
  }
}
```

### Analysis

**Key observations:**
1. Top-level usage shows 0 tokens
2. Per-model usage shows ~2,000 tokens across two models
3. Both Haiku AND Opus were invoked
4. This happened BEFORE the 404 error

### Hypothesis: Claude CLI Model Router

The Claude CLI likely has an internal routing mechanism:

1. **Request received**: `--model oups`
2. **Router invoked**: Calls lightweight model (Haiku) to analyze request
3. **Routing decision**: Determines which model should handle the request
4. **Validation**: Calls API to verify model exists → 404 error
5. **Fallback attempt**: May have tried another model (Opus) before giving up

This explains:
- Why two models were charged
- Why cost was incurred before validation
- Why "routing" tokens don't appear in main usage

**Impact**: This architectural decision in Claude CLI means **validation errors always have a cost**.

## Root Cause #3: Inconsistent Validation Across Tools

### Validation Function Exists

There IS a validation function: `validateClaudeConnection()` in `src/claude.lib.mjs:47`

```javascript
export const validateClaudeConnection = async (model = 'haiku-3') => {
  const mappedModel = mapModelToId(model);
  // ... makes test API call with model ...
  result = await $`printf hi | claude --model ${mappedModel} -p`;
  // ... checks for errors ...
}
```

### When It's Called

**Locations:**
1. `src/solve.validation.lib.mjs:242` - During system checks
2. `src/hive.mjs:1461` - Before processing issues

**Conditions:**
```javascript
if (!(await performSystemChecks(argv.minDiskSpace || 500, skipToolCheck, argv.model, argv))) {
  // validation runs here
}
```

### The Gap: `--no-tool-check` Bypasses Validation

From the timeline:
```
[16:00:53.845Z] Skipping tool validation (dry-run mode)
```

The command used `--no-tool-check`, which skips ALL tool validation, including model validation.

### Why This is Problematic

**Validation should be two-tier:**
1. **Tool availability** (can be skipped for speed)
   - Is `claude` command available?
   - Can we execute it?

2. **Model name syntax** (should NEVER be skipped)
   - Is the model name valid?
   - Does it look like a known alias or full model ID?

**Current implementation**: Both are bundled together in `skipToolCheck`.

### Evidence from Code

`src/solve.mjs:200`
```javascript
if (!(await performSystemChecks(argv.minDiskSpace || 500, skipToolCheck, argv.model, argv))) {
  process.exit(1);
}
```

When `skipToolCheck` is true:
- No model validation
- No Claude CLI connection check
- Invalid model names proceed to execution

## Root Cause Summary

| Root Cause | Location | Impact | Severity |
|------------|----------|--------|----------|
| No early validation | mapModelToId() | All invalid models reach API | **HIGH** |
| Claude CLI routing costs | Claude CLI internals | Cost even for validation errors | **MEDIUM** |
| Validation can be bypassed | --no-tool-check flag | Skip flag too broad | **HIGH** |

## Contributing Factors

### 1. Error Handling is Reactive, Not Proactive

The system relies on the API to validate model names instead of doing client-side checks.

**Current flow:**
```
User input → Argument parsing → Command execution → API call → Error
                                                          ↑
                                                    First validation
```

**Better flow:**
```
User input → Argument parsing → Validation → API call
                                     ↑
                                First validation
```

### 2. Model List is Hardcoded

`src/claude.lib.mjs:35-41`
```javascript
export const availableModels = {
  'sonnet': 'claude-sonnet-4-5-20250929',
  'opus': 'claude-opus-4-5-20251101',
  'haiku': 'claude-haiku-4-5-20251001',
  'haiku-3-5': 'claude-3-5-haiku-20241022',
  'haiku-3': 'claude-3-haiku-20240307',
};
```

**Issues:**
- New models require code updates
- No way to query available models from API
- Users don't know what models are available without reading code

### 3. Help Text May Not List Models

Need to verify if `--help` shows available model names. If not, discoverability is poor.

## Why This Matters

### Automation Impact

If this command is used in automation (e.g., Telegram bot, CI/CD), a single typo could:
- Cause repeated failures
- Accumulate costs ($0.027 per attempt)
- 100 failed attempts = $2.71 wasted
- 1000 failed attempts = $27.10 wasted

### User Experience Impact

Users expect:
1. **Fast feedback** on mistakes
2. **Helpful error messages** with suggestions
3. **No cost for typos**

Current behavior violates all three expectations.

## Conclusion

The root causes are **architectural**, not bugs:
1. System designed for flexibility (allow any model ID)
2. Validation relegated to API layer
3. Client-side checks can be skipped
4. No distinction between "tool check" and "argument validation"

**Fix requires**: Adding validation layer while maintaining flexibility for custom model IDs.
