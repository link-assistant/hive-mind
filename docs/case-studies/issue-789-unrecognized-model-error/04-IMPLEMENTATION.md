# Implementation Plan

## Recommended Approach

Based on the analysis, we recommend **Solution 3: Warning with Confirmation** as the primary implementation.

## Implementation Steps

### Step 1: Add Model Validation Function

**File**: `src/claude.lib.mjs`

**Location**: After `mapModelToId` function (around line 45)

```javascript
/**
 * Validate model name and provide helpful suggestions
 * @param {string} model - Model name or alias to validate
 * @returns {Object} Validation result with warnings
 */
export const validateModelName = (model) => {
  // Check if it's a known alias
  if (availableModels[model]) {
    return {
      valid: true,
      known: true,
      mapped: availableModels[model],
      needsWarning: false
    };
  }

  // Check if it looks like a valid Claude model ID
  // Patterns:
  //   claude-sonnet-4-5-20250929
  //   claude-opus-4-5-20251101
  //   claude-3-5-haiku-20241022
  const fullModelPattern = /^claude-(?:sonnet|opus|haiku|3-5-haiku|3-haiku)-[\d]+-[\d]+-\d{8}$/;
  const simpleModelPattern = /^claude-[a-z0-9]+(-[a-z0-9]+)*$/i;

  const looksLikeClaudeModel = fullModelPattern.test(model) || simpleModelPattern.test(model);

  if (looksLikeClaudeModel) {
    return {
      valid: true,
      known: false,
      mapped: model,
      needsWarning: true,
      warningMessage:
        `⚠️  Unknown model name: '${model}'\n\n` +
        `This model ID is not in our known list but matches Claude naming patterns.\n` +
        `If this is a new or custom model, it may work correctly.\n` +
        `If it's a typo, this will fail and incur API costs (~$0.02-0.03).\n\n` +
        `Known model aliases:\n` +
        Object.entries(availableModels)
          .map(([alias, id]) => `  ${alias.padEnd(15)} → ${id}`)
          .join('\n')
    };
  }

  // Model name doesn't match any known patterns
  const suggestion = suggestSimilarModel(model);

  return {
    valid: false,
    known: false,
    mapped: null,
    needsWarning: false,
    errorMessage:
      `❌ Invalid model name: '${model}'\n\n` +
      `This doesn't match any known model aliases or Claude model ID patterns.\n` +
      (suggestion ? `Did you mean: ${suggestion}?\n\n` : '\n') +
      `Available model aliases:\n` +
      Object.entries(availableModels)
        .map(([alias, id]) => `  ${alias.padEnd(15)} → ${id}`)
        .join('\n') +
      `\n\nOr use a full Claude model ID like: claude-sonnet-4-5-20250929`
  };
};

/**
 * Suggest similar model names using simple string matching
 * @param {string} input - User's input model name
 * @returns {string|null} Suggested model name or null
 */
const suggestSimilarModel = (input) => {
  const aliases = Object.keys(availableModels);
  const inputLower = input.toLowerCase();

  // Check for common typos
  const typoMap = {
    'oups': 'opus',
    'opous': 'opus',
    'sonett': 'sonnet',
    'sonne': 'sonnet',
    'haiko': 'haiku',
    'haiky': 'haiku'
  };

  if (typoMap[inputLower]) {
    return typoMap[inputLower];
  }

  // Find aliases that start with same letter(s)
  const startsWith = aliases.filter(alias =>
    alias.startsWith(inputLower.substring(0, 2))
  );

  if (startsWith.length > 0) {
    return startsWith.join(', ');
  }

  // Find aliases that contain the input
  const contains = aliases.filter(alias =>
    alias.includes(inputLower) || inputLower.includes(alias)
  );

  if (contains.length > 0) {
    return contains.join(', ');
  }

  return null;
};
```

### Step 2: Integrate Validation in solve.mjs

**File**: `src/solve.mjs`

**Location**: After argument parsing, before system checks (around line 150)

```javascript
// Validate model name before proceeding
if (!argv.skipModelValidation) {
  const validation = validateModelName(argv.model);

  if (!validation.valid) {
    // Invalid model - show error and exit
    await log(validation.errorMessage, { level: 'error' });
    process.exit(1);
  }

  if (validation.needsWarning && !argv.force) {
    // Unknown but potentially valid model - show warning
    await log(validation.warningMessage, { level: 'warning' });
    await log('\n💡 To proceed without this warning, use --force flag.', { level: 'warning' });
    await log('⏱️  Continuing in 5 seconds... (Press Ctrl+C to cancel)\n', { level: 'warning' });

    // Wait 5 seconds, allow user to cancel
    await new Promise(resolve => setTimeout(resolve, 5000));

    await log('✅ Proceeding with model: ' + validation.mapped);
  }
}
```

### Step 3: Add Command-Line Arguments

**File**: `src/solve.config.lib.mjs`

**Location**: In yargs options configuration

```javascript
.option('skip-model-validation', {
  description: 'Skip model name validation (use with caution - may incur costs on invalid models)',
  type: 'boolean',
  default: false,
  hidden: true // Hide from main help, show only in advanced help
})
.option('force', {
  alias: 'f',
  description: 'Skip confirmation prompts and warnings',
  type: 'boolean',
  default: false
})
```

### Step 4: Update Help Text

**File**: `src/solve.config.lib.mjs`

**Location**: In model option description

```javascript
.option('model', {
  alias: 'm',
  describe:
    'AI model to use.\n' +
    'Available aliases: sonnet (default), opus, haiku, haiku-3-5, haiku-3\n' +
    'Or use full model ID like: claude-sonnet-4-5-20250929',
  type: 'string',
  default: 'sonnet'
})
```

### Step 5: Apply to Other Tools

**Files to update**: `src/codex.lib.mjs`, `src/opencode.lib.mjs`

Similar validation should be added to these tools. They have their own `mapModelToId` functions that should be updated with the same validation logic.

### Step 6: Add Tests

**File**: `tests/test-model-validation.mjs`

```javascript
import { validateModelName } from '../src/claude.lib.mjs';
import { strict as assert } from 'assert';

// Test known aliases
const testSonnet = validateModelName('sonnet');
assert.equal(testSonnet.valid, true);
assert.equal(testSonnet.known, true);
assert.equal(testSonnet.needsWarning, false);

// Test full model IDs
const testFullModel = validateModelName('claude-sonnet-4-5-20250929');
assert.equal(testFullModel.valid, true);
assert.equal(testFullModel.known, false); // Not in alias list
assert.equal(testFullModel.needsWarning, true); // But looks valid

// Test invalid models
const testInvalid = validateModelName('oups');
assert.equal(testInvalid.valid, false);
assert.equal(testInvalid.errorMessage.includes('opus'), true); // Should suggest

// Test typos
const testTypo = validateModelName('opous');
assert.equal(testTypo.valid, false);
assert.equal(testTypo.errorMessage.includes('opus'), true);

console.log('✅ All model validation tests passed');
```

## Files Modified Summary

| File | Lines Changed | Type | Priority |
|------|--------------|------|----------|
| `src/claude.lib.mjs` | +80 | Addition | Critical |
| `src/solve.mjs` | +20 | Addition | Critical |
| `src/solve.config.lib.mjs` | +15 | Modification | Critical |
| `src/codex.lib.mjs` | +80 | Addition | Important |
| `src/opencode.lib.mjs` | +80 | Addition | Important |
| `tests/test-model-validation.mjs` | +30 | Addition | Important |

**Total estimated changes**: ~305 lines

## Testing Strategy

### Unit Tests
1. Test all known aliases validate correctly
2. Test full model IDs validate correctly
3. Test invalid model names are rejected
4. Test typo suggestions work
5. Test validation can be skipped with flag

### Integration Tests
1. Test `--model oups` shows error and exits
2. Test `--model oups --force` proceeds with warning
3. Test `--model sonnet` proceeds without warning
4. Test `--model claude-sonnet-5-0-20260101` shows warning but proceeds
5. Test `--model invalid --skip-model-validation` skips validation

### Manual Testing
1. Run solve with typo: `./solve.mjs <issue-url> --model oups`
   - Expected: Error message with suggestions, exits immediately
2. Run solve with unknown but valid-looking model: `./solve.mjs <issue-url> --model claude-test-model`
   - Expected: Warning, 5 second delay, then proceeds
3. Run solve with force flag: `./solve.mjs <issue-url> --model oups --force`
   - Expected: Skips validation (for testing)

## Rollout Plan

### Phase 1: Core Implementation (This PR)
- [ ] Implement `validateModelName()` function
- [ ] Add validation to `solve.mjs`
- [ ] Add `--force` and `--skip-model-validation` flags
- [ ] Update help text
- [ ] Add unit tests
- [ ] Test manually

### Phase 2: Extended Coverage (Follow-up PR)
- [ ] Apply to `codex.lib.mjs`
- [ ] Apply to `opencode.lib.mjs`
- [ ] Add integration tests
- [ ] Update documentation

### Phase 3: Enhanced Features (Future)
- [ ] Add fuzzy matching for better suggestions
- [ ] Cache validation results
- [ ] Add metrics/telemetry for common typos
- [ ] Consider dynamic model discovery if API supports it

## Backward Compatibility

### Breaking Changes
None. All changes are additive:
- New validation is opt-out (can be disabled with `--skip-model-validation`)
- `--force` flag is additive
- Existing valid model names continue to work
- Unknown model names that worked before will now show warnings (but still work)

### Migration Path
Users using custom/beta model IDs will see warnings but can:
1. Use `--force` to skip the delay
2. Use `--skip-model-validation` to bypass entirely
3. Wait 5 seconds for validation to proceed automatically

## Success Metrics

After implementation, measure:
1. **Reduction in invalid model API errors**: Should drop to near zero for typos
2. **Time saved**: Users get immediate feedback vs 30-60 second wait
3. **Cost saved**: $0.02-0.03 per prevented invalid API call
4. **User satisfaction**: Fewer confused users in support channels

## Risk Analysis

### Low Risk
- Validation is additive and can be disabled
- Fallback to original behavior with flags
- No changes to core execution logic

### Medium Risk
- Pattern matching might reject valid future model IDs
  - **Mitigation**: Use permissive patterns + warning instead of hard error

### Monitoring Required
- Track false positives (valid models rejected)
- Track false negatives (invalid models accepted)
- Adjust patterns based on real-world feedback

## Documentation Updates

Files to update:
- [ ] `README.md` - Add model validation section
- [ ] `docs/CONFIG.md` - Document new flags
- [ ] `docs/CONTRIBUTING.md` - Add validation testing guidelines
- [ ] Help text in CLI
