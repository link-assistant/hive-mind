# Case Study: Issue #1491 - Ensure --tokens-budget-stats works correctly

## Overview

This case study documents the enhancement of the `--tokens-budget-stats` feature to provide comprehensive token budget statistics including sub-session tracking across compactification events, own token calculation from JSON actions, and display in GitHub PR comments.

**Issue:** [#1491 - Ensure --tokens-budget-stats works correctly](https://github.com/link-assistant/hive-mind/issues/1491)
**Pull Request:** [#1492](https://github.com/link-assistant/hive-mind/pull/1492)
**Labels:** enhancement, documentation

## Problem Statement

The existing `--tokens-budget-stats` feature (added in v0.54.0, bug-fixed in Issue #944) provides basic token budget statistics but lacks several important capabilities:

1. **No compactification awareness**: Stats are calculated as flat totals across the entire session, without tracking sub-sessions between compactification events
2. **No independent token calculation**: Only uses Anthropic-provided token counts from the session JSONL file, with no independent verification from stream JSON output events
3. **No GitHub comment display**: Budget stats are only shown in terminal logs, not in GitHub PR comments
4. **No percentage-of-maximum tracking**: While ratios are shown, there's no clear indication of how close to context limits each sub-session gets

## Requirements Analysis

### From Issue Description

1. Display `--tokens-budget-stats` in GitHub comments alongside cost estimation and models used
2. Calculate tokens independently from JSON output actions (messages, tool calls) in addition to Anthropic's session JSONL data
3. Handle compactification events to correctly calculate stats for each sub-session
4. Calculate total token budget per sub-session to understand percentage of maximum context used
5. Show both own calculation and Anthropic's calculation to detect mismatches (similar to cost estimation)

## Background Research

### Claude Code Session JSONL Format

Claude Code stores session data as JSONL files at `~/.claude/projects/<project-dir>/<session-id>.jsonl`. Key record types:

- **`type: "assistant"`**: Contains `message.usage` with `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`
- **`type: "system"` with `subtype: "compact_boundary"`**: Marks compactification events
  - Contains `compactMetadata.preTokens` (token count before compaction)
  - `parentUuid: null` resets the chain
- **`isCompactSummary: true`**: Synthetic summary records after compaction (should be tracked separately)

### Compactification

When a session approaches the context window limit, Claude Code automatically compacts the conversation:
1. Summarizes older turns
2. Inserts a `compact_boundary` system record
3. Follows with a synthetic user message containing the summary
4. Continues the session with reduced context

### Stream JSON Output

The NDJSON stream from `--output-format stream-json` provides per-event token usage through `message.usage` fields in assistant messages. This can be summed independently to verify against Anthropic's JSONL session data.

### Token Types

- **input_tokens**: Tokens in the input/prompt
- **output_tokens**: Tokens generated in the response
- **cache_creation_input_tokens**: Tokens written to cache (5-minute or 1-hour TTL)
- **cache_read_input_tokens**: Tokens read from cache (cheaper than fresh input)

### Model Context Limits (2025-2026)

From models.dev API:
- Claude Opus 4.5/4.6: 200K context, 32K output
- Claude Sonnet 4.5/4.6: 200K context (1M beta), 64K output
- Claude Haiku 4.5: 200K context, 64K output

## Solution Design

### 1. Sub-Session Tracking in calculateSessionTokens

Modify `calculateSessionTokens()` in `claude.lib.mjs` to:
- Detect `compact_boundary` records in the session JSONL
- Track token usage per sub-session (between compactification events)
- Calculate per-sub-session context window usage percentages
- Return sub-session breakdown alongside totals

### 2. Independent Token Calculation from Stream Events

During NDJSON stream parsing in `executeClaudeCommand()`:
- Sum token usage from each streamed event
- Store as "stream-calculated" totals
- Compare against JSONL-calculated totals

### 3. Budget Stats in GitHub Comments

Add `buildBudgetStatsString()` function to generate markdown for PR comments:
- Show per-model context window usage with percentages
- Show sub-session breakdown when compactification occurred
- Show comparison between stream-calculated and JSONL-calculated tokens

### 4. Enhanced displayBudgetStats

Update the terminal display to show:
- Sub-session breakdown
- Both calculation sources
- Clear percentage indicators

## Implementation

### Files Modified

1. **`src/claude.lib.mjs`**: Enhanced `calculateSessionTokens()` with sub-session tracking and compactification detection
2. **`src/claude.budget-stats.lib.mjs`**: Enhanced `displayBudgetStats()` with sub-session display, added `buildBudgetStatsString()` for GitHub comments
3. **`src/github.lib.mjs`**: Integrated budget stats into PR comment generation via `buildCostInfoString()`
4. **`src/solve.results.lib.mjs`**: Pass budget stats data to `attachLogToGitHub()`

### Files Added

- **`tests/test-budget-stats.mjs`**: Unit tests for budget stats calculation and display
- **`experiments/test-budget-stats-subsessions.mjs`**: Experiment script demonstrating sub-session tracking
- **`docs/case-studies/issue-1491/`**: This case study

## References

- [Claude Code Session Continuation](https://blog.fsck.com/releases/2026/02/22/claude-code-session-continuation/) - JSONL format details
- [Claude Code Context Buffer Management](https://claudefa.st/blog/guide/mechanics/context-buffer-management) - Compaction mechanics
- [ccusage](https://github.com/ryoppippi/ccusage) - CLI tool for analyzing Claude Code usage from JSONL files
- [claude-code-log](https://github.com/daaain/claude-code-log) - JSONL to HTML converter
- Issue #944 - Original `--tokens-budget-stats` bug fix case study
- Issue #1454 - Multi-model token usage tracking
