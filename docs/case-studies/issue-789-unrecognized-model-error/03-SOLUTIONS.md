# Solution Proposals

## Solution Comparison Matrix

| Solution | Cost Prevention | User Experience | Flexibility | Implementation Effort | Risk |
|----------|----------------|-----------------|-------------|---------------------|------|
| **1. Basic Alias Validation** | ✅ High | ⭐⭐ Medium | ❌ Reduced | ⭐ Low | ⭐ Low |
| **2. Pattern-Based Validation** | ✅ High | ⭐⭐⭐ Good | ✅ Maintained | ⭐⭐ Medium | ⭐ Low |
| **3. Validation with Warning** | ⭐ Medium | ⭐⭐⭐⭐ Excellent | ✅ Maintained | ⭐⭐ Medium | ⭐ Low |
| **4. API Model Discovery** | ✅ High | ⭐⭐⭐⭐⭐ Excellent | ✅ Maintained | ⭐⭐⭐⭐ High | ⭐⭐⭐ Medium |
| **5. Separate Validation Flag** | ✅ High | ⭐⭐⭐ Good | ✅ Maintained | ⭐⭐ Medium | ⭐ Low |

## Solution 1: Basic Alias Validation

### Description
Validate that model name is either in the `availableModels` list or follows the pattern `claude-*`.

### Implementation

```javascript
// src/claude.lib.mjs
export const validateModelName = (model) => {
  // Check if it's a known alias
  if (availableModels[model]) {
    return { valid: true, mapped: availableModels[model] };
  }

  // Check if it looks like a full Claude model ID
  if (model.startsWith('claude-')) {
    return { valid: true, mapped: model };
  }

  // Invalid model name
  return {
    valid: false,
    mapped: null,
    error: `Invalid model name: '${model}'\n` +
           `Available aliases: ${Object.keys(availableModels).join(', ')}\n` +
           `Or use full model ID like: claude-sonnet-4-5-20250929`
  };
};

// Usage in solve.mjs or validate
const validation = validateModelName(argv.model);
if (!validation.valid) {
  console.error(validation.error);
  process.exit(1);
}
```

### Pros
✅ Simple to implement
✅ Prevents obvious typos
✅ Zero API cost for validation
✅ Fast feedback (immediate)

### Cons
❌ Rejects valid but unknown model IDs (e.g., new beta models)
❌ Pattern `claude-*` might be too permissive
❌ Requires code updates when model naming changes

### Use Cases
- **Handles**: `oups` → Rejected ✅
- **Handles**: `sonnet` → Accepted ✅
- **Doesn't handle**: `claude-opus-4-5-beta-20260101` → Rejected ❌ (might be valid)

## Solution 2: Pattern-Based Validation with Strict Regex

### Description
Use regex patterns to validate model names match Anthropic's naming convention.

### Implementation

```javascript
// src/claude.lib.mjs
export const validateModelName = (model) => {
  // Check if it's a known alias
  if (availableModels[model]) {
    return { valid: true, mapped: availableModels[model], isAlias: true };
  }

  // Anthropic model ID pattern:
  // claude-{model-family}-{version}-{date}
  // Examples:
  //   claude-sonnet-4-5-20250929
  //   claude-opus-4-5-20251101
  //   claude-3-5-haiku-20241022
  const fullModelPattern = /^claude-(?:sonnet|opus|haiku|3-5-haiku|3-haiku)-[\d]+-[\d]+-\d{8}$/;

  // Also support simpler patterns for potential future models:
  //   claude-{name}-{version}
  const simpleModelPattern = /^claude-[a-z0-9-]+$/;

  if (fullModelPattern.test(model) || simpleModelPattern.test(model)) {
    return { valid: true, mapped: model, isAlias: false };
  }

  // Invalid model name
  return {
    valid: false,
    mapped: null,
    error: `Invalid model name: '${model}'\n\n` +
           `Available model aliases:\n` +
           Object.entries(availableModels)
             .map(([alias, id]) => `  ${alias.padEnd(15)} → ${id}`)
             .join('\n') +
           `\n\nOr use a full Claude model ID like: claude-sonnet-4-5-20250929`
  };
};
```

### Pros
✅ Balances strictness with flexibility
✅ Allows future model IDs that follow pattern
✅ Provides helpful error messages with examples
✅ Zero API cost for validation

### Cons
❌ Regex might need updates if Anthropic changes naming
❌ Still rejects valid models with unexpected patterns

### Use Cases
- **Handles**: `oups` → Rejected ✅
- **Handles**: `sonnet` → Accepted ✅
- **Handles**: `claude-sonnet-5-0-20260101` → Accepted ✅
- **Handles**: `claude-new-model-beta` → Accepted ✅ (simple pattern)

## Solution 3: Warning Instead of Error (Recommended)

### Description
Show a warning for unknown models but allow execution to continue with user confirmation.

### Implementation

```javascript
// src/claude.lib.mjs
export const validateModelName = (model, requireConfirmation = true) => {
  // Check if it's a known alias
  if (availableModels[model]) {
    return {
      valid: true,
      known: true,
      mapped: availableModels[model]
    };
  }

  // Check if it looks like a Claude model ID
  const looksLikeClaudeModel = /^claude-[a-z0-9-]+$/i.test(model);

  return {
    valid: true, // Allow but warn
    known: false,
    mapped: model,
    warning: !looksLikeClaudeModel,
    warningMessage: `⚠️  Unknown model name: '${model}'\n\n` +
                   `Known model aliases:\n` +
                   Object.entries(availableModels)
                     .map(([alias, id]) => `  ${alias.padEnd(15)} → ${id}`)
                     .join('\n') +
                   `\n\n` +
                   (looksLikeClaudeModel
                     ? `This looks like a Claude model ID. Proceeding...`
                     : `⚠️  This doesn't match expected patterns.\n` +
                       `This will likely fail and incur API costs ($0.02-0.03).\n` +
                       `Did you mean: ${suggestModel(model)}?`)
  };
};

// Suggest similar model names
const suggestModel = (input) => {
  const aliases = Object.keys(availableModels);
  // Simple Levenshtein distance or just check prefixes
  const suggestions = aliases.filter(alias =>
    alias.startsWith(input.substring(0, 2)) ||
    input.startsWith(alias.substring(0, 2))
  );
  return suggestions.join(', ') || 'sonnet, opus, haiku';
};

// Usage in solve.mjs
const validation = validateModelName(argv.model);
if (validation.warning && !argv.force) {
  console.warn(validation.warningMessage);
  console.warn(`\nTo proceed anyway, use --force flag.`);
  console.warn(`To cancel, press Ctrl+C within 5 seconds...\n`);
  await new Promise(resolve => setTimeout(resolve, 5000));
}
```

### Pros
✅ Best user experience - helpful without blocking
✅ Prevents accidental typos
✅ Allows power users to use custom models
✅ Provides cost warning
✅ Suggests corrections

### Cons
❌ User might ignore warnings
❌ Adds delay (5 second wait)

### Use Cases
- **Handles**: `oups` → Warning + suggestion + 5s delay → User can cancel ✅
- **Handles**: `sonnet` → Silent success ✅
- **Handles**: `claude-new-beta-model` → Proceeds with notice ✅
- **Handles**: `--force --model oups` → Skips validation ✅

## Solution 4: Dynamic Model Discovery via API

### Description
Query Anthropic API for available models instead of hardcoding the list.

### Implementation

```javascript
// src/claude.lib.mjs
let cachedModels = null;
let cacheTimestamp = null;
const CACHE_TTL = 3600000; // 1 hour

export const getAvailableModels = async () => {
  // Return cached if fresh
  if (cachedModels && cacheTimestamp && (Date.now() - cacheTimestamp < CACHE_TTL)) {
    return cachedModels;
  }

  try {
    // Use Claude CLI to query available models
    // Note: This might cost a tiny amount
    const result = await $`claude --list-models`.json();

    if (result.models && Array.isArray(result.models)) {
      cachedModels = result.models;
      cacheTimestamp = Date.now();
      return result.models;
    }
  } catch (error) {
    // Fallback to hardcoded list
    await log('⚠️  Could not fetch model list from API, using hardcoded list', { verbose: true });
  }

  // Return hardcoded list as fallback
  return Object.values(availableModels);
};

export const validateModelName = async (model) => {
  const availableList = await getAvailableModels();

  // Check alias
  if (availableModels[model]) {
    return { valid: true, mapped: availableModels[model] };
  }

  // Check if model exists in API list
  if (availableList.includes(model)) {
    return { valid: true, mapped: model };
  }

  // Unknown model
  return {
    valid: false,
    mapped: null,
    error: `Model '${model}' not found.\n\n` +
           `Available models:\n${availableList.slice(0, 10).join('\n')}` +
           (availableList.length > 10 ? `\n... and ${availableList.length - 10} more` : '')
  };
};
```

### Pros
✅ Always up-to-date with latest models
✅ No code changes needed for new models
✅ Accurate validation
✅ Caching reduces overhead

### Cons
❌ API call required (small cost)
❌ Adds latency on first call
❌ Depends on Claude CLI having `--list-models` feature
❌ Fallback still needed
❌ More complex implementation

### Feasibility Check Required
Need to verify if Claude CLI supports model listing. If not, this solution is not viable without direct Anthropic API integration.

## Solution 5: Separate Validation Flag

### Description
Split `--no-tool-check` into two flags: `--no-tool-check` and `--no-validation`.

### Implementation

```javascript
// Argument parsing
yargs
  .option('no-tool-check', {
    description: 'Skip checking if tools are installed',
    type: 'boolean',
    default: false
  })
  .option('no-validation', {
    description: 'Skip model name and argument validation (use with caution)',
    type: 'boolean',
    default: false
  });

// In validation
if (!argv.noValidation) {
  const validation = validateModelName(argv.model);
  if (!validation.valid) {
    console.error(validation.error);
    process.exit(1);
  }
}

if (!argv.noToolCheck && !argv.dryRun) {
  // Check tool availability
  await validateClaudeConnection(argv.model);
}
```

### Pros
✅ Clear separation of concerns
✅ Model validation runs by default
✅ Can still skip validation if needed
✅ Backward compatible (old flag still works)

### Cons
❌ More flags to document
❌ Users might still use wrong flag

## Recommended Solution: Combination Approach

Implement **Solution 3 (Warning) + Solution 5 (Separate flags)**:

### Phase 1: Immediate Fix
1. Add `validateModelName()` with pattern-based validation
2. Show warning for unknown models with 5-second countdown
3. Suggest similar model names using fuzzy matching
4. Add `--force` flag to skip countdown

### Phase 2: Enhanced Validation
1. Split `--no-tool-check` into `--no-tool-check` and `--skip-model-validation`
2. Make model validation run independently
3. Add cost warning to help text

### Phase 3: Future Enhancement (Optional)
1. Investigate if Claude CLI supports model discovery
2. If yes, implement caching model list
3. Keep pattern validation as fallback

## Implementation Priority

### Critical (This PR)
- [ ] Add `validateModelName()` function
- [ ] Integrate validation before Claude CLI execution
- [ ] Show helpful error messages with suggestions
- [ ] Add warnings for unknown models

### Important (Follow-up)
- [ ] Split validation flags
- [ ] Add fuzzy matching for suggestions
- [ ] Update help text with model list
- [ ] Add tests for validation

### Nice to Have (Future)
- [ ] Dynamic model discovery
- [ ] Cache available models
- [ ] Metrics on failed model names
