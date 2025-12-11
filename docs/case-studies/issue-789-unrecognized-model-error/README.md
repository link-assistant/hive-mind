# Case Study: Unrecognized Model Error with Cost Impact

## Overview

This case study analyzes issue #789, where an invalid model name (`--model oups`) resulted in API costs (~$0.027 USD) despite the model not existing. This demonstrates a critical gap in the system's validation layer and highlights the need for early model name validation.

## Quick Facts

- **Issue**: #789
- **Reporter**: konard
- **Date**: 2025-12-03
- **Cost Impact**: $0.027 per failed attempt
- **Time Wasted**: ~57 seconds per failed attempt
- **Severity**: Medium (financial + UX impact)

## Problem Summary

When a user provides an invalid model name, the system:
1. Accepts the argument without validation
2. Proceeds through all initialization steps (~50 seconds)
3. Makes API calls to Anthropic
4. **Incurs costs** from multiple model invocations
5. Finally returns 404 error

**Root cause**: No client-side validation before API calls.

## Documentation Structure

This case study is organized into multiple files for easier navigation:

### [00-OVERVIEW.md](./00-OVERVIEW.md)
- Problem statement
- Impact analysis
- Requirements for solution
- Quick reference

### [01-TIMELINE.md](./01-TIMELINE.md)
- Detailed timeline of events
- Log analysis with timestamps
- Performance impact
- What should have happened

### [02-ROOT-CAUSES.md](./02-ROOT-CAUSES.md)
- Three distinct root causes identified
- Code-level analysis
- Architecture review
- Contributing factors

### [03-SOLUTIONS.md](./03-SOLUTIONS.md)
- Five different solution approaches
- Comparison matrix
- Pros and cons for each
- Recommended combination approach

### [04-IMPLEMENTATION.md](./04-IMPLEMENTATION.md)
- Step-by-step implementation plan
- Code examples
- Testing strategy
- Rollout plan

### [full-log.json](./full-log.json)
- Complete log from the failed execution
- Original data source from gist

## Key Findings

### Root Causes (Summary)

1. **No early validation** - `mapModelToId()` is a pass-through for unknown models
2. **Claude CLI routing costs** - Internal model discovery/routing incurs API costs
3. **Validation can be bypassed** - `--no-tool-check` flag too broad

### Financial Impact

```
Cost per invalid model attempt: $0.027108
├─ Haiku 4.5:  $0.002138
└─ Opus 4.5:   $0.024970

Automation risk (1000 failures): $27.11
```

### Timeline Impact

```
Current flow:     57 seconds → Error + Cost
With validation:  <1 second  → Error + No Cost
```

## Recommended Solution

**Hybrid Approach**: Warning with Confirmation + Separate Validation Flag

### Benefits
✅ Prevents typos from incurring costs
✅ Maintains flexibility for custom model IDs
✅ Provides helpful suggestions
✅ Clear separation of validation types
✅ Backward compatible

### Implementation
```javascript
// Immediate validation with helpful feedback
const validation = validateModelName(argv.model);

if (!validation.valid) {
  console.error(`❌ Invalid model: '${argv.model}'`);
  console.error(`Did you mean: ${suggestModel(argv.model)}?`);
  console.error(`Available: sonnet, opus, haiku, haiku-3-5, haiku-3`);
  process.exit(1);
}

if (validation.needsWarning && !argv.force) {
  console.warn(`⚠️  Unknown model: '${argv.model}'`);
  console.warn(`This may incur costs if invalid (~$0.027)`);
  console.warn(`Continuing in 5 seconds... (Ctrl+C to cancel)`);
  await sleep(5000);
}
```

## Impact After Fix

### User Experience
- **Before**: 57 seconds → Error + Cost
- **After**: Instant feedback → No cost for typos

### Cost Savings
- **Per typo**: $0.027 saved
- **Over time**: Significant (depends on usage frequency)

### Developer Experience
- Clear error messages
- Helpful suggestions
- Fast feedback loop

## Related Issues

- Issue #719: Usage limit error handling (similar pattern of late error detection)
- Issue #667: Pricing calculation (cost tracking accuracy)

## Lessons Learned

1. **Validate early, fail fast**: Client-side validation prevents wasted time and money
2. **User experience matters**: Clear error messages with suggestions improve usability
3. **Flexibility vs. safety**: Balance allowing custom values with protecting against common mistakes
4. **Cost awareness**: API costs can accumulate from small inefficiencies
5. **Layered validation**: Separate argument validation from tool availability checks

## Testing Recommendations

### Must Test
- [ ] Invalid model name is rejected immediately
- [ ] Valid aliases work without warnings
- [ ] Full model IDs work with optional warning
- [ ] Suggestions are helpful for common typos
- [ ] `--force` flag skips warnings
- [ ] `--skip-model-validation` bypasses validation

### Should Test
- [ ] Performance impact of validation (<10ms)
- [ ] Help text shows available models
- [ ] Error messages are clear and actionable
- [ ] Works consistently across all tools (claude, codex, opencode)

## References

- Issue: https://github.com/link-assistant/hive-mind/issues/789
- Pull Request: https://github.com/link-assistant/hive-mind/pull/790
- Full Log: https://gist.github.com/konard/cede1c9bb333fb4fff5caf0248b98787
- Related: Issue #719 (usage limit handling)

## Authors

- Initial Report: konard
- Case Study Analysis: AI Assistant (2025-12-03)

---

**Status**: Case study complete, ready for implementation
**Next Steps**: Implement validation as per 04-IMPLEMENTATION.md
