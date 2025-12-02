# Case Study: Cost Calculation Discrepancy (Issue #787)

## Issue Reference
- **Issue**: [#787 - Fix cost calculation](https://github.com/link-assistant/hive-mind/issues/787)
- **Pull Request**: [#788](https://github.com/link-assistant/hive-mind/pull/788)
- **Date**: 2025-12-02

## Executive Summary

This case study analyzes a significant cost calculation discrepancy where the "Public pricing estimate" showed $0.32 while Anthropic's official cost was $2.04 - a **536.92% difference**. The root cause is that Claude Code's sub-agent architecture uses multiple AI models (Sonnet, Haiku, Opus) in parallel, but our local token calculation only reads the main session's JSONL file, missing all sub-agent usage.

## The Evidence

### Original Log Output (from Issue #787)

```
[2025-12-02T07:00:29.700Z] [INFO] {
  "type": "result",
  "subtype": "success",
  "total_cost_usd": 2.0382708499999986,
  "modelUsage": {
    "claude-haiku-4-5-20251001": {
      "inputTokens": 66363,
      "outputTokens": 5642,
      "costUSD": 0.09457300000000002
    },
    "claude-sonnet-4-5-20250929": {
      "inputTokens": 109,
      "outputTokens": 14921,
      "cacheReadInputTokens": 4278957,
      "cacheCreationInputTokens": 57657,
      "costUSD": 1.7240428499999996
    },
    "claude-opus-4-5-20251101": {
      "inputTokens": 1241,
      "outputTokens": 8538,
      "costUSD": 0.219655
    }
  }
}
```

### Token Usage Summary Log

```
[2025-12-02T07:00:30.157Z] [INFO]       Usage:
[2025-12-02T07:00:30.155Z] [INFO]         Input tokens: 172
[2025-12-02T07:00:30.155Z] [INFO]         Cache creation tokens: 102 076
[2025-12-02T07:00:30.155Z] [INFO]         Cache read tokens: 6 382 995
[2025-12-02T07:00:30.156Z] [INFO]         Output tokens: 10 633

[2025-12-02T07:00:30.157Z] [INFO]       Cost Calculation (USD):
[2025-12-02T07:00:30.157Z] [INFO]         Input: 172 tokens × $6/M = $0.001032
[2025-12-02T07:00:30.158Z] [INFO]         Output: 10 633 tokens × $30/M = $0.318990
[2025-12-02T07:00:30.158Z] [INFO]         ─────────────────────────────────
[2025-12-02T07:00:30.158Z] [INFO]         Total: $0.320022
```

### Final Cost Comparison

```
💰 Cost estimation:
   Public pricing estimate: $0.320022 USD
   Calculated by Anthropic: $2.038271 USD
   Difference:              $1.718249 (+536.92%)
```

## Root Cause Analysis

### The Architecture Problem

Claude Code CLI uses a **sub-agent architecture** where:

1. **Main Agent (Sonnet)**: Handles primary reasoning and coordination
2. **Sub-agents (Haiku/Opus)**: Handle specific tasks like code exploration, planning, etc.

Each agent runs in its own context and may use different models:
- `claude-sonnet-4-5-20250929` - Main orchestration (Sonnet 4.5)
- `claude-haiku-4-5-20251001` - Fast exploration tasks (Haiku 4.5)
- `claude-opus-4-5-20251101` - Complex reasoning (Opus 4.5)

### The Calculation Mismatch

#### Anthropic's Calculation (Correct - $2.04)

Anthropic's SDK tracks ALL token usage across ALL sub-agents and returns the aggregate in `total_cost_usd`:

| Model | Input | Output | Cache Read | Cache Write | Cost |
|-------|-------|--------|------------|-------------|------|
| Haiku 4.5 | 66,363 | 5,642 | 0 | 0 | $0.095 |
| Sonnet 4.5 | 109 | 14,921 | 4,278,957 | 57,657 | $1.724 |
| Opus 4.5 | 1,241 | 8,538 | 0 | 0 | $0.220 |
| **Total** | | | | | **$2.039** |

#### Our Local Calculation (Incorrect - $0.32)

Our `calculateSessionTokens` function reads from `~/.claude/projects/<project>/sessionId.jsonl`:

| Tokens | Count | Price | Cost |
|--------|-------|-------|------|
| Input | 172 | $6/M | $0.001 |
| Output | 10,633 | $30/M | $0.319 |
| Cache Read | 6,382,995 | - | **NOT CALCULATED** |
| Cache Write | 102,076 | - | **NOT CALCULATED** |
| **Total** | | | **$0.320** |

### Why Cache Tokens Weren't Charged

Looking at the log output, cache tokens ARE being tracked:
- Cache creation tokens: 102,076
- Cache read tokens: 6,382,995

But in the cost calculation, only Input and Output are shown! This reveals **TWO bugs**:

1. **Bug #1 - Missing Models**: The JSONL file only contains entries for ONE model (the main session's Sonnet usage), not the Haiku and Opus sub-agents.

2. **Bug #2 - Cache Cost Missing**: Even for the one model tracked, the cache token costs are not being added to the total.

### Code Path Analysis

#### Where Tokens Are Read (`claude.lib.mjs:639-777`)

```javascript
export const calculateSessionTokens = async (sessionId, tempDir) => {
  // Constructs path: ~/.claude/projects/<project-dir>/<session-id>.jsonl
  const projectDirName = tempDir.replace(/\//g, '-');
  const sessionFile = path.join(homeDir, '.claude', 'projects', projectDirName, `${sessionId}.jsonl`);

  // Reads ONLY this single session file
  const fileContent = await fs.readFile(sessionFile, 'utf8');
  // ... parses and calculates
}
```

The problem: Sub-agents may have their own session files, or their usage may be recorded in Anthropic's backend but NOT in the local JSONL file.

#### Where Cost Is Calculated (`claude.lib.mjs:523-574`)

```javascript
export const calculateModelCost = (usage, modelInfo, includeBreakdown = false) => {
  // Cache creation tokens cost
  if (usage.cacheCreationTokens && cost.cache_write) {  // ✅ Has condition
    breakdown.cacheWrite = {
      tokens: usage.cacheCreationTokens,
      costPerMillion: cost.cache_write,
      cost: (usage.cacheCreationTokens / 1000000) * cost.cache_write
    };
  }

  // Cache read tokens cost
  if (usage.cacheReadTokens && cost.cache_read) {  // ✅ Has condition
    breakdown.cacheRead = {
      tokens: usage.cacheReadTokens,
      costPerMillion: cost.cache_read,
      cost: (usage.cacheReadTokens / 1000000) * cost.cache_read
    };
  }
}
```

The conditions check both `usage.cacheReadTokens` AND `cost.cache_read`. If either is falsy, the cost is skipped.

### Model Pricing from models.dev API

| Model | Input | Output | Cache Read | Cache Write |
|-------|-------|--------|------------|-------------|
| claude-sonnet-4-5-20250929 | $3/M | $15/M | $0.30/M | $3.75/M |
| claude-haiku-4-5-20251001 | $1/M | $5/M | $0.10/M | $1.25/M |
| claude-opus-4-5-20251101 | $15/M | $75/M | $1.50/M | $18.75/M |

All cache pricing data IS available in models.dev API.

## Timeline Reconstruction

| Timestamp | Event |
|-----------|-------|
| ~07:00:00 | Session starts with main Sonnet model |
| During execution | Sub-agents (Haiku, Opus) invoked for various tasks |
| 07:00:29.700Z | Session completes, Anthropic returns aggregated result JSON |
| 07:00:29.701Z | Anthropic's `total_cost_usd` captured: $2.038271 |
| 07:00:30.148Z | Token Usage Summary calculated from local JSONL file |
| 07:00:30.158Z | Local calculation shows only $0.320022 (from Sonnet only) |
| 07:00:30.160Z | Discrepancy displayed: +536.92% difference |

## Impact Analysis

### User Experience
- Users see a **misleading** cost comparison suggesting our calculation is wrong
- The 536% difference appears alarming and undermines trust
- Users may question the accuracy of all cost reporting

### Actual Accuracy
- Anthropic's calculation ($2.04) is **correct** - it tracks all model usage
- Our calculation ($0.32) is **incomplete** - it only sees partial data

### Financial Implications
- No actual billing impact (Anthropic charges correctly)
- Display issue only affects user perception

## Proposed Solutions

### Solution 1: Use Anthropic's Cost as Primary Source (Recommended)

**Rationale**: Anthropic's SDK already correctly tracks all sub-agent usage.

**Implementation**:
```javascript
// In executeClaudeCommand, after receiving result
if (data.total_cost_usd !== undefined) {
  anthropicTotalCostUSD = data.total_cost_usd;
}

// In cost display, prioritize Anthropic's figure
if (anthropicTotalCostUSD !== null) {
  await log(`   Official cost (Anthropic): $${anthropicTotalCostUSD.toFixed(6)} USD`);
  // Optional: show local calculation for debugging only
}
```

**Pros**:
- Always accurate (source of truth)
- Includes all sub-agent costs
- No local file dependencies

**Cons**:
- Loses per-model breakdown for display
- Less transparency in calculation

### Solution 2: Parse Anthropic's `modelUsage` from Result JSON

**Rationale**: Anthropic already returns per-model breakdown in the result.

**Implementation**:
```javascript
if (data.type === 'result' && data.modelUsage) {
  // Use Anthropic's modelUsage for display
  for (const [modelId, usage] of Object.entries(data.modelUsage)) {
    await log(`   ${modelId}: $${usage.costUSD.toFixed(6)}`);
  }
}
```

**Pros**:
- Per-model visibility
- Accurate totals
- Uses authoritative data

**Cons**:
- API format may change
- Key naming differences (cacheReadInputTokens vs cacheReadTokens)

### Solution 3: Aggregate Multiple Session Files

**Rationale**: If sub-agents create separate JSONL files, read them all.

**Implementation**:
```javascript
// Find all .jsonl files in project directory
const allSessions = await fs.readdir(projectDir);
const jsonlFiles = allSessions.filter(f => f.endsWith('.jsonl'));

// Aggregate usage from all files
for (const file of jsonlFiles) {
  const content = await fs.readFile(path.join(projectDir, file), 'utf8');
  // Merge into modelUsage...
}
```

**Pros**:
- Complete local data
- Independent of API changes

**Cons**:
- May include unrelated sessions
- Complex file matching logic
- Sub-agent files may not exist locally

### Solution 4: Remove Local Calculation, Display Only Anthropic's Cost

**Rationale**: Simplest fix - trust the authoritative source.

**Implementation**:
```javascript
// Display only Anthropic's cost
await log(`   💰 Session cost: $${anthropicTotalCostUSD.toFixed(6)} USD`);
// Remove or deprecate local calculation comparison
```

**Pros**:
- Simplest implementation
- No confusing comparisons
- Always accurate

**Cons**:
- Loses educational value of seeing calculation breakdown
- Less debugging capability

## Recommendation

**Implement Solution 2** (Parse Anthropic's `modelUsage` from Result JSON):

1. Extract `modelUsage` from the result JSON
2. Display per-model breakdown using Anthropic's data
3. Use `total_cost_usd` as the authoritative total
4. Keep local calculation as a "debug" feature with `--verbose` flag only

This provides the best balance of accuracy, transparency, and user experience.

## Implementation Plan

1. **Phase 1**: Extract and display `modelUsage` from Anthropic result
2. **Phase 2**: Map Anthropic's key names to our display format
3. **Phase 3**: Move local calculation to verbose-only mode
4. **Phase 4**: Add unit tests for new parsing logic

## References

- Issue #787: https://github.com/link-assistant/hive-mind/issues/787
- Related Issue #667: Pricing Calculation Failures
- Claude Code Sub-agents: https://docs.anthropic.com/claude/docs/sub-agents
- Models.dev API: https://models.dev/api.json

## Appendix: Key Code Locations

| File | Line | Function | Purpose |
|------|------|----------|---------|
| `src/claude.lib.mjs` | 639-777 | `calculateSessionTokens` | Reads local JSONL, calculates tokens |
| `src/claude.lib.mjs` | 523-574 | `calculateModelCost` | Calculates cost from token counts |
| `src/claude.lib.mjs` | 950-955 | (in executeClaudeCommand) | Captures `total_cost_usd` |
| `src/claude.lib.mjs` | 1189-1272 | (in executeClaudeCommand) | Displays token usage summary |
