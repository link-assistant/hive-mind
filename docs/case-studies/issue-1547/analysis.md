# Issue #1547: Better output for `Context and tokens usage`

## Problem Statement

The "Context and tokens usage" section in PR comments has several formatting issues that reduce readability:

1. In multi-model sessions with multiple sub-sessions, the sub-sessions are displayed globally at the top instead of under each model heading — causing visual duplication disconnected from model context.
2. The percentage is placed after the unit label (e.g., `167.1K / 1M input tokens (17%)`) instead of next to the numbers it describes.
3. The Total line shows cached tokens without clear grouping: `213.3K + 26.4M cached input tokens` — making it ambiguous whether "cached" applies to the sum or just the second number.
4. When `peakContextUsage` is unknown and output percentage is shown in the Total line, it uses a different format (`15.3K output tokens (24% of 64K output limit)`) instead of the consistent `15.3K / 64K (24%) output tokens` style.
5. Single sub-sessions should use `-` bullet, not numbered list.

## Requirements

From the issue, the desired format is:

```
### 📊 **Context and tokens usage:**

**Claude Opus 4.6:**
1. Context window: 167.1K / 1M (17%) input tokens, 13.1K / 128K (10%) output tokens
2. Context window: 57.1K / 1M (6%) input tokens, 2.6K / 128K (2%) output tokens

Total: (213.3K + 26.4M cached) input tokens, 62.5K output tokens, $16.110482 cost

**Claude Haiku 4.5:**

Total: (153.9K + 1.8M cached) input tokens, 15.3K / 64K (24%) output tokens, $0.451093 cost
```

### Requirement breakdown

1. **R1: Sub-sessions under model heading** — In multi-model + multi-sub-session case, show sub-sessions under the primary model heading, not globally at the top.
2. **R2: Percentage before unit** — Change `X / Y input tokens (Z%)` → `X / Y (Z%) input tokens` in context window lines.
3. **R3: Parenthesized cached in Total** — Change `X + Y cached input tokens` → `(X + Y cached) input tokens`.
4. **R4: Consistent output format in Total** — Change `X output tokens (Z% of Y output limit)` → `X / Y (Z%) output tokens`.
5. **R5: Single sub-session uses dash** — When only one sub-session, use `- Context window:` not `1. Context window:`.

## Affected code locations

1. `src/claude.budget-stats.lib.mjs`:
   - `formatContextOutputLine()` (line ~319): Generates per-sub-session context window lines — R2 applies here
   - `buildBudgetStatsString()` (line ~352): Main function generating the markdown — R1, R3, R4 apply here
   - `displayBudgetStats()` (line ~147): Terminal display function — R2, R3, R4 apply here
   - `formatSubSessionsList()` (line ~296): Formats numbered list — R5 applies here

## Solution Plan

1. Update `formatContextOutputLine()` to place percentage before the unit label
2. Update `buildBudgetStatsString()`:
   - Move multi-model sub-sessions under the primary model heading instead of global
   - Change Total line cached format to use parentheses
   - Change Total line output-limit fallback to consistent `X / Y (Z%)` format
3. Update `displayBudgetStats()` with the same format changes
4. Update `formatSubSessionsList()` to use `-` prefix for single sub-sessions
5. Update all tests to match new format

## Timeline

1. Issue #1491: Original budget stats implementation
2. Issue #1501: Added peak context usage tracking
3. Issue #1508: Multi-model support
4. Issue #1526: Shortened to single-line format
5. Issue #1539: Fixed impossible percentages from cumulative fallback
6. Issue #1547 (this): Format improvements for readability
