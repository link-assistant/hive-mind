# Case Study: Issue #1501 - Cost and Token/Context Budget Calculations Are Wrong

## Problem Statement

PR #1500 (solution log for issue #1499) produced these clearly incorrect statistics:

```
Context window: 75,168,895 / 1,000,000 tokens (7516.89%)
Output tokens: 82,449 / 128,000 tokens (64.41%)
Own calculation (stream): 284,113 tokens (24 events)
JSONL calculation: 2,184,959 tokens (diff: +669.05%)
```

```
Public pricing estimate: $51.734299
Calculated by Anthropic: $1.896363 USD
Difference: $-49.837936 (-96.33%)
```

## Root Cause Analysis

### Root Cause 1: JSONL Token Usage Duplication (Critical)

**Source**: Known upstream bug in Claude Code ([anthropics/claude-code#6805](https://github.com/anthropics/claude-code/issues/6805))

When Claude Code uses `--output-format stream-json`, it splits single assistant messages
containing multiple content blocks (thinking + text + tool_use) into separate streaming events.
Each event preserves the **complete original `usage` statistics** from the API response.

This means if a single API call returns a response with 3 content blocks, the same token
counts are recorded 3 times in the JSONL session file with the same message ID.

**Evidence from PR #1500 log**:

- Input tokens: 645 (negligible)
- Cache creation tokens: 2,101,865
- Cache read tokens: 73,066,385
- The JSONL total was 2,184,959 tokens while stream total was only 284,113 (669% difference)

**Impact**: Token counts from JSONL are inflated by 3-8x depending on the number of
content blocks per response. This directly inflates the "public pricing estimate".

**Fix**: Deduplicate JSONL entries by message ID — only count usage from the first
occurrence of each unique message.

### Root Cause 2: Context Window Shows Cumulative Sum, Not Per-Request Usage (Critical)

**The bug**: `displayBudgetStats()` calculates context window usage as:

```js
const totalInputUsed = usage.inputTokens + usage.cacheCreationTokens + usage.cacheReadTokens;
```

This sums ALL token usage across ALL API calls in the session. But the context window
limit (e.g. 1,000,000 tokens) is a **per-request limit**, not a cumulative session limit.

A session that makes 15 API calls, each reading ~5M tokens from cache, will show
75M cumulative cache_read_tokens — but the context window was never more than ~5M at
any single point in time.

**Evidence**: 75,168,895 / 1,000,000 = 7516.89% — obviously impossible if this were
the actual context window usage at any single point.

**What the user actually wants**: Either the maximum context window fill across all
requests (peak usage), or the per-request breakdown showing how close each request
came to the limit.

**Fix**: For context window display, use the **maximum single-request context usage**
(the highest `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`
from any single JSONL entry), not the cumulative sum.

### Root Cause 3: Cost Discrepancy Is Expected But Poorly Explained (Medium)

**The calculation**: The "public pricing estimate" of $51.73 uses the **cumulative
token counts** (with duplication from Root Cause 1) multiplied by public prices:

- Cache read: 73,066,385 tokens \* $0.50/M = $36.53
- Cache write: 2,101,865 tokens \* $6.25/M = $13.14
- Output: 82,449 tokens \* $25/M = $2.06
- Input: 645 tokens \* $5/M = $0.003

Anthropic reported $1.90 as the actual cost. Even without the JSONL duplication,
the cumulative token counts represent real API calls — the cost IS cumulative.
However, the 96% discrepancy is primarily due to JSONL duplication inflating token counts.

After deduplication, the public pricing estimate should be much closer to Anthropic's
number. Any remaining difference could be due to:

- Cached prompt pricing being lower in practice
- Anthropic API applying discounts not reflected in public prices
- Batch API pricing or commitment discounts

**Fix**: After deduplicating JSONL, the cost estimate should be more reasonable.
Add a note explaining this is an estimate based on public pricing.

### Root Cause 4: Stream vs JSONL Mismatch (Medium)

**The bug**: Stream events showed 284,113 tokens (24 events) vs JSONL's 2,184,959.
The 669% difference is primarily explained by:

1. **JSONL duplication** (Root Cause 1) inflates the JSONL number
2. **Stream events may miss some events** — the stream parser only captures
   events with `data.type === 'assistant'` and `data.message.usage`, but some
   usage might come in other event types
3. **Output token undercounting in JSONL** ([anthropics/claude-code#22686](https://github.com/anthropics/claude-code/issues/22686)):
   JSONL records intermediate streaming chunks with `output_tokens: 1` instead
   of the final count

**Fix**: After deduplication, the stream vs JSONL comparison should be closer.
The remaining differences should be clearly labeled.

## Timeline of Events

1. PR #1500 was created for issue #1499 using `--model opus --tokens-budget-stats`
2. Claude Opus 4.6 processed the issue, making ~15 turns (24 stream events)
3. The session JSONL file accumulated duplicated token records
4. `calculateSessionTokens()` summed all records without deduplication
5. `displayBudgetStats()` showed cumulative sums as context window usage
6. `buildCostInfoString()` calculated cost from inflated cumulative tokens
7. The result: $51.73 public estimate vs $1.90 Anthropic cost

## Data Sources

- Solution draft log: `solution-draft-log.txt` (downloaded from [gist](https://gist.github.com/konard/314180814a9307e8e2fc0b15bd66dda6))
- Upstream bug reports:
  - [anthropics/claude-code#6805](https://github.com/anthropics/claude-code/issues/6805) - Token duplication in stream-json
  - [anthropics/claude-code#22686](https://github.com/anthropics/claude-code/issues/22686) - Output tokens incorrectly recorded in JSONL

## Proposed Solutions

### Fix 1: Deduplicate JSONL entries by message ID

In `calculateSessionTokens()`, track seen message IDs and only count usage from
the last occurrence of each unique message (the last one may have more accurate
output token counts).

### Fix 2: Track per-request context usage for context window display

Instead of showing cumulative context, track the maximum single-request context
fill and display that as the context window usage.

### Fix 3: Show cumulative vs peak clearly in output

Label cumulative totals as "Total tokens processed" and peak context as
"Peak context window fill", so users understand what each number means.

### Fix 4: Add verbose debug tracing

Add detailed per-entry logging when `--verbose` is active, showing each JSONL
entry's message ID, usage, and whether it was deduplicated.
