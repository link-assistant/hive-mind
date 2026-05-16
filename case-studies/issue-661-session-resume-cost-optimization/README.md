# Case Study: Session Resume with Context Preservation for Cost Optimization

**Issue Reference**: [#661](https://github.com/deep-assistant/hive-mind/issues/661)

**Related Pull Request**: https://github.com/deep-assistant/hive-mind/pull/662

**Referenced Example**: [test-anywhere PR #38](https://github.com/link-foundation/test-anywhere/pull/38)

**Date**: 2025-11-03

**Status**: 🔍 Research & Analysis Phase

---

## Executive Summary

This case study examines the feasibility and implementation strategies for auto-restart functionality with session resume that preserves previous context while only providing new small prompts (listing uncommitted changes). The goal is to reduce token costs during auto-restart cycles while maintaining the AI's understanding of the work-in-progress.

The test-anywhere PR #38 demonstrates a successful implementation where:

- Initial execution consumed ~434KB of logs
- Auto-restart detected uncommitted changes
- Subsequent execution with minimal context consumed ~697KB (includes full history)
- The system auto-posted comments to track iterations (1/3, indicating max 3 iterations)
- Successfully completed work with auto-commit and push

## Problem Description

### Current Auto-Restart Implementation

The Hive Mind's `solve.mjs` currently implements auto-restart functionality (solve.mjs:834-939) that:

1. **Detects uncommitted changes** after Claude finishes execution
2. **Enters temporary watch mode** if changes are detected
3. **Re-executes Claude with full context** on the same repository
4. **Commits and pushes changes** once complete

The current flow:

```
Claude Session 1 (Full Context) → Uncommitted Changes Detected →
Temporary Watch Mode → Claude Session 2 (Full Context Again) →
Changes Committed → Push to Remote
```

### Cost Implications

Each Claude session includes:

- **Initial prompt**: Issue description, contributing guidelines, recent commits
- **System prompt**: Guidelines, instructions, code patterns
- **Tool outputs**: File reads, grep results, command outputs
- **Conversation history**: Multi-turn interactions during solving

**Current token usage pattern** (from calculateSessionTokens implementation):

- `input_tokens`: Regular input tokens (full cost: $3/million for Sonnet 4.5)
- `cache_creation_input_tokens`: Cache writes (1.25× cost: $3.75/million)
- `cache_read_input_tokens`: Cache reads (0.1× cost: $0.30/million)
- `output_tokens`: Generated responses (full cost: $15/million for Sonnet 4.5)

**Problem**: When auto-restarting, the system currently re-sends the full context, which means:

- If prompt caching is NOT used: Full input token cost again
- If prompt caching IS used: Still pays for cache reads and new context
- Large codebases with extensive context can result in 50k-200k+ input tokens per session

### Target Optimization

The ideal implementation would:

1. **Preserve session context** from the previous run
2. **Resume with minimal new prompt** containing only:
   - List of uncommitted changes (git status output)
   - Simple instruction: "Please review and commit these changes"
3. **Reduce token costs** by 80-95% on auto-restart cycles
4. **Maintain AI understanding** of the work completed so far

## Analysis of Referenced PR (test-anywhere #38)

### Implementation Details from PR #38

The PR demonstrates auto-restart with the following characteristics:

**Log uploads via GitHub Gists:**

- Session 1: 434KB log file → https://gist.github.com/konard/d181c6389588758fbb59865058d6a236
- Session 2: 697KB log file → https://gist.github.com/konard/cc12b3bf6d0dbcdcf14dfc17f28ecf35

**Auto-restart tracking:**

- Comment posted: "🔄 Auto-restart 1/3"
- Indicates iteration counting (max 3 iterations)
- Waits for session end before accepting feedback

**Observed behavior:**

1. Initial session completes with uncommitted changes
2. System detects changes and triggers auto-restart
3. New session starts with iteration counter
4. Session completes and commits changes
5. Logs uploaded to track full execution

**What we DON'T know from the PR:**

- Whether `--resume` was used to preserve context
- What prompt was provided in the auto-restart session
- Token counts for each session
- Whether prompt caching was leveraged
- How much context was re-sent vs reused

### Current Hive Mind Auto-Restart vs PR #38

| Feature                          | Current Hive Mind             | test-anywhere PR #38      |
| -------------------------------- | ----------------------------- | ------------------------- |
| **Uncommitted change detection** | ✅ Yes (solve.mjs:835)        | ✅ Yes                    |
| **Automatic restart**            | ✅ Yes (temporary watch mode) | ✅ Yes                    |
| **Iteration tracking**           | ✅ Yes (max 3 by default)     | ✅ Yes (shown in comment) |
| **Session resume**               | ❌ Not used in auto-restart   | ❓ Unknown                |
| **Minimal context on restart**   | ❌ Full context re-sent       | ❓ Unknown                |
| **Log attachment**               | ✅ Yes (via --attach-logs)    | ✅ Yes (via Gist)         |
| **Iteration comments**           | ❌ Not posted to PR           | ✅ Yes (posted to PR)     |
| **Cost optimization**            | ❓ Depends on prompt caching  | ❓ Unknown                |

## Claude CLI Session Management Capabilities

### Session Resume Functionality (from docs/dependencies-research/claude-sessions)

The Hive Mind team has already documented Claude CLI session capabilities:

**Key findings:**

1. **`--resume <session-id>` DOES work** in non-interactive mode
2. **Context IS preserved** when resuming sessions
3. **New session ID is created** but conversation history is maintained
4. **Session data stored** in `~/.claude/projects/[project-path]/[session-id].jsonl`

**Current implementation in solve.mjs:**

```javascript
// Line 909-910 in claude.lib.mjs
if (argv.resume) {
  await log(`🔄 Resuming from session: ${argv.resume}`);
  claudeArgs = `--resume ${argv.resume} ${claudeArgs}`;
}
```

**Session tracking in solve.mjs:**

```javascript
// Line 995-997 in claude.lib.mjs
if (!sessionId && data.session_id) {
  sessionId = data.session_id;
  await log(`📌 Session ID: ${sessionId}`);
}
```

### Token Tracking Implementation

The system already tracks tokens per session (claude.lib.mjs:682-832):

```javascript
export const calculateSessionTokens = async (sessionId, tempDir) => {
  // Reads ~/.claude/projects/<project-dir>/<session-id>.jsonl
  // Parses usage data from each API call
  // Returns comprehensive token breakdown:
  return {
    modelUsage, // Per-model breakdown
    inputTokens, // Total input
    cacheCreationTokens, // Cache writes
    cacheReadTokens, // Cache reads (0.1× cost!)
    outputTokens, // Total output
    totalTokens,
    totalCostUSD, // Calculated cost
  };
};
```

**This means we can:**

- Track token usage before and after implementing session resume
- Compare costs between full-context and resume-based restarts
- Measure the effectiveness of the optimization

## Prompt Caching in Claude API

### How Prompt Caching Works

From Claude API documentation:

**Cache Duration:**

- Default: 5 minutes minimum (auto-refreshes on each use)
- Extended: 1 hour (at higher cost)

**Cost Structure:**

- Cache writes (5-min): 1.25× base cost ($3.75/M for Sonnet 4.5)
- Cache reads: 0.1× base cost ($0.30/M for Sonnet 4.5)
- Regular input: 1× base cost ($3.00/M for Sonnet 4.5)

**Cacheable Content:**

- System prompts
- Tool definitions
- Large document context
- Previous conversation turns
- Minimum 1,024 tokens (Opus/Sonnet), 2,048 tokens (Haiku 3.5/3), 4,096 tokens (Haiku 4.5)

**Limitations:**

- Maximum 4 cache breakpoints per request
- Cache invalidated if cached content changes
- 20-block lookback window for cache matching

### Current Usage in Hive Mind

**Evidence of prompt caching support:**

```javascript
// Token tracking includes cache metrics (claude.lib.mjs:723-750)
cacheCreationTokens: 0,
cacheReadTokens: 0,

// Cost calculation includes cache tiers (claude.lib.mjs:576-590)
if (usage.cacheCreationTokens && cost.cache_write) {
  breakdown.cacheWrite = {
    tokens: usage.cacheCreationTokens,
    costPerMillion: cost.cache_write,
    cost: (usage.cacheCreationTokens / 1000000) * cost.cache_write
  };
}
```

**Question**: Does Claude CLI automatically use prompt caching, or does it need to be explicitly enabled?

Based on the code, the CLI appears to support it (tracks cache metrics), but we need to verify:

1. Whether it's enabled by default
2. What content gets cached
3. Whether session resume leverages cached content

## Alternative Solutions Analysis

### Solution 1: Session Resume with Minimal Context (Recommended)

**Implementation approach:**

```javascript
// In solve.mjs auto-restart section (line ~835)
const shouldRestart = await checkForUncommittedChanges(...);

if (shouldRestart) {
  // Store session ID from previous run
  const previousSessionId = sessionId;

  // Get uncommitted changes
  const gitStatus = await $({ cwd: tempDir })`git status --porcelain`;
  const uncommittedChanges = gitStatus.stdout.toString();

  // Create minimal prompt
  const minimalPrompt = `
Previous session completed with uncommitted changes.

Uncommitted changes:
${uncommittedChanges}

Please review these changes and commit them with an appropriate message.
  `.trim();

  // Resume previous session with minimal context
  const restartResult = await executeClaude({
    tempDir,
    branchName,
    prompt: minimalPrompt,
    systemPrompt: '', // Minimal or empty
    argv: {
      ...argv,
      resume: previousSessionId  // KEY: Resume previous session
    },
    // ... other params
  });
}
```

**Advantages:**

- ✅ **Massive token savings**: Only send ~100-500 tokens vs 50k-200k tokens
- ✅ **Preserves full context**: AI remembers all previous work
- ✅ **Leverages existing infrastructure**: `--resume` already implemented
- ✅ **No API changes needed**: Uses documented Claude CLI features
- ✅ **Maintains iteration limits**: Existing safety mechanism still works

**Disadvantages:**

- ❓ **Session resume reliability**: Success can vary (per documentation notes)
- ❓ **Cache effectiveness**: Depends on whether resumed sessions use cached content
- ⚠️ **Fallback needed**: If resume fails, need to fall back to full context
- ⚠️ **Testing required**: Need to verify context preservation in practice

**Estimated cost savings:**

```
Scenario: Auto-restart with 100k token context

Current approach (with prompt caching):
- Cache write: 100k tokens × $3.75/M = $0.375 (first time)
- Cache read: 100k tokens × $0.30/M = $0.030 (subsequent)
- Total per restart: $0.030

Session resume approach:
- Resume session: 0 tokens (context preserved)
- New prompt: 500 tokens × $3.00/M = $0.0015
- Total per restart: $0.0015

Savings: $0.030 - $0.0015 = $0.0285 per restart (95% reduction)
```

### Solution 2: Enhanced Prompt Caching (Fallback)

**Implementation approach:**

```javascript
// Add explicit cache control to system prompts
const systemPromptWithCache = {
  type: 'text',
  text: systemPrompt,
  cache_control: { type: 'ephemeral' },
};

// Structure prompts to maximize cache hits
// Place stable content first, variable content last
```

**Advantages:**

- ✅ **Works with current architecture**: Minimal changes needed
- ✅ **No new dependencies**: Uses existing API features
- ✅ **Gradual cost reduction**: 90% cost reduction on cached content

**Disadvantages:**

- ❌ **Limited savings**: Only 10× reduction, not 100× like session resume
- ❌ **Still sends tokens**: Cache reads still count toward rate limits
- ❌ **Cache invalidation**: Changes to any cached content breaks cache

**Estimated cost savings:**

```
Scenario: Auto-restart with 100k token context

Without caching:
- Input: 100k tokens × $3.00/M = $0.300

With caching:
- Cache read: 100k tokens × $0.30/M = $0.030

Savings: $0.300 - $0.030 = $0.270 per restart (90% reduction)
```

### Solution 3: Hybrid Approach (Most Robust)

**Implementation approach:**

```javascript
// Try session resume first
try {
  const restartResult = await executeClaude({
    // ... minimal context with --resume
  });

  // Verify AI understood the context
  if (!verifyContextPreservation(restartResult)) {
    throw new Error('Context not preserved');
  }
} catch (resumeError) {
  // Fall back to full context with caching
  await log('⚠️ Session resume failed, using full context with caching');
  const restartResult = await executeClaude({
    // ... full context with cache_control
  });
}
```

**Advantages:**

- ✅ **Best of both worlds**: Maximum savings with reliable fallback
- ✅ **Progressive enhancement**: Graceful degradation if resume fails
- ✅ **Observable**: Can track success rates and adjust strategy

**Disadvantages:**

- ⚠️ **More complex**: Requires additional error handling
- ⚠️ **Testing overhead**: Need to verify both paths work correctly

### Solution 4: Stateful Context Management (Future Work)

**Concept:**

- Maintain external context store (database, file system)
- Track "work state" separately from conversation
- Provide incremental updates instead of full context

**Why NOT recommended now:**

- ❌ **Major architectural change**: Requires significant refactoring
- ❌ **Maintenance burden**: New system to maintain
- ❌ **Unclear benefits**: Session resume achieves similar goals
- ❌ **Out of scope**: Issue #661 asks to study existing approach

## Cost Comparison Table

| Approach                    | Input Tokens per Restart | Cost per Restart (Sonnet 4.5) | Cost Reduction | Complexity |
| --------------------------- | ------------------------ | ----------------------------- | -------------- | ---------- |
| **Current (no caching)**    | 100,000                  | $0.300                        | Baseline       | Low        |
| **Current (with caching)**  | 100,000 (cached)         | $0.030                        | 90%            | Low        |
| **Session Resume**          | 500                      | $0.0015                       | 99.5%          | Medium     |
| **Hybrid (resume + cache)** | 500-100,000              | $0.0015-$0.030                | 90-99.5%       | High       |

**Assumptions:**

- Average context size: 100k tokens (issue + guidelines + history)
- Minimal restart prompt: 500 tokens
- Sonnet 4.5 pricing: $3/M input, $0.30/M cache read
- 3 restarts per issue on average

**Annual savings projection** (hypothetical):

```
Assumptions:
- 1,000 issues solved per month
- 3 restarts per issue (average)
- Current: $0.030 per restart with caching
- With resume: $0.0015 per restart

Monthly savings:
1,000 issues × 3 restarts × ($0.030 - $0.0015) = $85.50/month

Annual savings:
$85.50 × 12 = $1,026/year

Without caching currently:
1,000 issues × 3 restarts × ($0.300 - $0.0015) = $895.50/month = $10,746/year
```

## Implementation Recommendations

### Phase 1: Measurement & Validation (Week 1-2)

**Objective**: Understand current token usage and validate assumptions

**Tasks:**

1. **Add detailed token logging** to auto-restart cycles
   - Log session IDs for original and restart sessions
   - Track input/output/cache tokens for each
   - Calculate cost per restart

2. **Verify prompt caching usage**
   - Check if Claude CLI uses caching automatically
   - Examine session JSONL files for cache metrics
   - Test explicit cache control if needed

3. **Test session resume in auto-restart**
   - Create experimental branch
   - Implement minimal-context resume
   - Verify context preservation across 10+ test cases

**Success criteria:**

- Token usage data collected for 50+ auto-restarts
- Session resume reliability > 90%
- Context preservation validated

### Phase 2: Implementation (Week 3-4)

**Objective**: Implement session resume for auto-restart

**Tasks:**

1. **Modify auto-restart logic** (solve.mjs:834-939)

   ```javascript
   // Store session ID from previous run
   const previousSessionId = sessionId;

   // Create minimal prompt with uncommitted changes
   const minimalPrompt = generateMinimalRestartPrompt(tempDir);

   // Resume with minimal context
   await executeClaude({
     // ...params,
     prompt: minimalPrompt,
     systemPrompt: '', // Empty on resume
     argv: { ...argv, resume: previousSessionId },
   });
   ```

2. **Add fallback mechanism**

   ```javascript
   // If resume fails, retry with full context
   try {
     await restartWithResume(previousSessionId);
   } catch (error) {
     await log('⚠️ Resume failed, using full context');
     await restartWithFullContext();
   }
   ```

3. **Enhance logging**
   - Log token savings per restart
   - Track resume success/failure rates
   - Report cost savings in summary

**Success criteria:**

- Auto-restart uses session resume by default
- Fallback works reliably
- Token usage reduced by 95%+

### Phase 3: Monitoring & Optimization (Week 5-6)

**Objective**: Monitor effectiveness and optimize

**Tasks:**

1. **Track metrics**
   - Resume success rate
   - Token usage before/after
   - Cost savings achieved
   - User satisfaction (commits quality)

2. **Optimize prompt**
   - Refine minimal restart prompt
   - Test different context levels
   - Balance cost vs. effectiveness

3. **Documentation**
   - Update README with cost optimization info
   - Document session resume behavior
   - Add troubleshooting guide

**Success criteria:**

- 95%+ resume success rate
- 90%+ token usage reduction
- No degradation in commit quality

## Risks & Mitigations

| Risk                          | Impact | Probability | Mitigation                                |
| ----------------------------- | ------ | ----------- | ----------------------------------------- |
| **Session resume unreliable** | Medium | Low         | Implement fallback to full context        |
| **Context not preserved**     | High   | Low         | Verify with test prompt before proceeding |
| **Commit quality degrades**   | High   | Low         | Monitor and adjust prompt if needed       |
| **Caching not enabled**       | Medium | Medium      | Implement explicit cache control          |
| **Rate limits still hit**     | Low    | Low         | Resume doesn't send tokens, unlikely      |

## Questions for Further Research

1. **Does Claude CLI enable prompt caching by default?**
   - Need to examine actual API calls
   - Check session JSONL for cache metrics
   - Test explicitly setting cache_control

2. **What is the actual resume success rate in practice?**
   - Documentation says "can vary"
   - Need empirical data from production use
   - Identify failure patterns

3. **How long do sessions remain resumable?**
   - Documentation mentions 5-minute cache
   - Do sessions expire?
   - What happens if too much time passes?

4. **Can we resume across different model versions?**
   - If session was Sonnet 4, can we resume with Sonnet 4.5?
   - Does this affect context preservation?

5. **What is the optimal minimal prompt?**
   - Just git status?
   - Include git diff?
   - Add commit message guidance?

## Conclusion

**Primary Recommendation**: Implement **Solution 3 (Hybrid Approach)** with session resume as primary strategy and full-context caching as fallback.

**Rationale:**

1. **Massive cost savings**: 95%+ reduction in auto-restart token costs
2. **Leverages existing capabilities**: Claude CLI already supports `--resume`
3. **Low risk**: Fallback ensures reliability
4. **Easy to measure**: Token tracking already implemented
5. **Aligns with issue request**: Studies test-anywhere PR #38 approach

**Expected outcomes:**

- $1,000+ annual savings (at 1k issues/month volume)
- 95% token usage reduction on auto-restarts
- No degradation in solution quality
- Better resource utilization

**Next steps:**

1. Create experimental branch
2. Implement token logging for current auto-restarts
3. Test session resume with minimal context
4. Measure and compare results
5. Roll out if successful

## References

- Issue #661: https://github.com/deep-assistant/hive-mind/issues/661
- test-anywhere PR #38: https://github.com/link-foundation/test-anywhere/pull/38
- Claude sessions research: docs/dependencies-research/claude-sessions/README.md
- Prompt caching docs: https://docs.claude.com/en/docs/build-with-claude/prompt-caching
- solve.mjs implementation: src/solve.mjs:834-939
- Token calculation: src/claude.lib.mjs:682-832

---

**Document Status**: ✅ Complete - Ready for Review
**Last Updated**: 2025-11-03
**Author**: AI Assistant (Claude Sonnet 4.5)
