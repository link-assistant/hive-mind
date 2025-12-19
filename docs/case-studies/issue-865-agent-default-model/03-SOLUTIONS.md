# Proposed Solutions - Issue #865

## Solution 1: Add Agent Case to Default Model Selection (RECOMMENDED)

### Implementation

**File**: `src/solve.config.lib.mjs`, lines 86-94

**Change**:
```javascript
.option('model', {
  type: 'string',
  description: 'Model to use (for claude: opus, sonnet, haiku, haiku-3-5, haiku-3; for opencode: grok, gpt4o; for codex: gpt5, gpt5-codex, o3; for agent: grok, grok-code, big-pickle)',
  alias: 'm',
  default: (currentParsedArgs) => {
    // Dynamic default based on tool selection
    if (currentParsedArgs?.tool === 'opencode') {
      return 'grok-code-fast-1';
    } else if (currentParsedArgs?.tool === 'codex') {
      return 'gpt-5';
    } else if (currentParsedArgs?.tool === 'agent') {
      return 'grok-code';  // <-- NEW: Use free model for agent
    }
    return 'sonnet';
  }
})
```

### Rationale

1. **Consistency**: Aligns with `opencode` tool, which also defaults to `grok-code-fast-1` (both use OpenCode backend)
2. **Free Access**: `grok-code` maps to `opencode/grok-code`, a free model requiring no subscription
3. **Minimal Change**: Single line addition, low risk of regression
4. **Clear Intent**: Explicitly handles the agent tool case

### Model Mapping Chain (After Fix)

1. User: `solve <issue> --tool agent`
2. Config: `currentParsedArgs.tool === 'agent'` → `return 'grok-code'`
3. Agent execution: `argv.model === 'grok-code'`
4. Model mapping: `'grok-code'` → `'opencode/grok-code'`
5. Agent command: `agent --model opencode/grok-code`
6. Result: ✅ Success (free model, no authentication required)

### Advantages

- ✅ Simple, one-line fix
- ✅ Uses free model (no subscription required)
- ✅ Consistent with opencode tool
- ✅ Clear and explicit handling

### Disadvantages

- ❌ Requires updating documentation
- ❌ Needs test coverage

## Solution 2: Use `grok-code-fast-1` for Consistency

### Implementation

Same as Solution 1, but use `'grok-code-fast-1'` instead of `'grok-code'`:

```javascript
} else if (currentParsedArgs?.tool === 'agent') {
  return 'grok-code-fast-1';  // <-- Exactly match opencode default
}
```

### Rationale

Provides 100% consistency with the opencode tool default.

### Advantages

- ✅ Identical to opencode default
- ✅ Uses free model

### Disadvantages

- ❌ Both `'grok-code'` and `'grok-code-fast-1'` map to the same model ID (`'opencode/grok-code'`) in `src/agent.lib.mjs:27`
- ❌ Less clear naming (`grok-code` is simpler)

**Recommendation**: Stick with Solution 1 (`'grok-code'`) for simpler naming.

## Solution 3: Create Separate Default Model Constants

### Implementation

**File**: `src/solve.config.lib.mjs`

```javascript
// At the top of the file
const DEFAULT_MODELS = {
  claude: 'sonnet',
  opencode: 'grok-code-fast-1',
  codex: 'gpt-5',
  agent: 'grok-code'
};

// In the option definition
.option('model', {
  type: 'string',
  description: 'Model to use (for claude: opus, sonnet, haiku, haiku-3-5, haiku-3; for opencode: grok, gpt4o; for codex: gpt5, gpt5-codex, o3; for agent: grok, grok-code, big-pickle)',
  alias: 'm',
  default: (currentParsedArgs) => {
    const tool = currentParsedArgs?.tool || 'claude';
    return DEFAULT_MODELS[tool] || DEFAULT_MODELS.claude;
  }
})
```

### Advantages

- ✅ More maintainable (centralized configuration)
- ✅ Easier to add new tools
- ✅ Clearer intent

### Disadvantages

- ❌ More complex change
- ❌ Requires more testing
- ❌ Over-engineering for a simple fix

**Recommendation**: Not needed for this issue. Consider for future refactoring.

## Solution 4: Validate Model Availability During Argument Parsing

### Implementation

Add early validation to check if the default model is available for the selected tool.

### Advantages

- ✅ Catches issues earlier
- ✅ Better error messages

### Disadvantages

- ❌ Significant code change
- ❌ Performance impact (validation during parsing)
- ❌ Doesn't fix the root cause

**Recommendation**: Not appropriate for this issue. This would be a separate improvement.

## Recommended Solution

**Solution 1** is the recommended approach:

1. Minimal code change (single line addition)
2. Uses free model (no subscription required)
3. Consistent with opencode tool philosophy
4. Low risk of regression
5. Easy to test and verify

## Additional Improvements (Optional)

### 1. Update Documentation

Update the model option description to include agent models:

```javascript
description: 'Model to use (for claude: opus, sonnet, haiku, haiku-3-5, haiku-3; for opencode: grok, gpt4o; for codex: gpt5, gpt5-codex, o3; for agent: grok, grok-code, big-pickle)',
```

### 2. Add Test Coverage

Create a test case to verify agent default model:

```javascript
// tests/test-solve.mjs or similar
test('agent tool defaults to grok-code model', () => {
  const argv = parseArguments(['https://github.com/org/repo/issues/1', '--tool', 'agent']);
  assert.equal(argv.model, 'grok-code');
});
```

### 3. Update Help Text

Consider adding agent-specific examples to help text or documentation:

```bash
# Example commands
solve <issue> --tool agent                    # Uses grok-code (free)
solve <issue> --tool agent --model big-pickle # Uses big-pickle (free)
solve <issue> --tool agent --model sonnet     # Uses claude-3-5-sonnet (requires OpenCode Zen)
```

## Implementation Plan

1. ✅ Add agent case to default model selection (`src/solve.config.lib.mjs`)
2. ✅ Update model option description to include agent models
3. ✅ Test the change with experiment script
4. ✅ Verify no regression in other tools
5. ✅ Update documentation (if applicable)
6. ⚠️ Add test coverage (optional, recommended for future)

## Risk Assessment

### Low Risk

The proposed fix is low risk because:

- ✅ Single line addition
- ✅ Only affects agent tool
- ✅ No changes to existing logic for other tools
- ✅ Model mapping already exists in `agent.lib.mjs`
- ✅ Free model is widely available

### Validation Steps

1. Test with `--tool agent` (no model specified) → should use `grok-code`
2. Test with `--tool agent --model sonnet` → should still use `sonnet` (explicit override)
3. Test with `--tool opencode` → should still use `grok-code-fast-1`
4. Test with `--tool codex` → should still use `gpt-5`
5. Test with `--tool claude` (or no tool) → should still use `sonnet`

## Alternative Models Considered

Other free models available for agent tool:

1. **`opencode/grok-code`** ✅ SELECTED
   - Free, no authentication required
   - Good performance
   - Consistent with opencode default

2. **`opencode/big-pickle`**
   - Free, no authentication required
   - Alternative to grok-code
   - Not selected (less commonly used)

3. **`openai/gpt-5-nano`**
   - Free via OpenCode
   - Not selected (grok-code is more proven)

**Decision**: Use `grok-code` as it's the most proven free model and aligns with opencode tool.
