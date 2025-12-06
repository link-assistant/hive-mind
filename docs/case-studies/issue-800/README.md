# Case Study: Interactive Mode for solve Command (Issue #800)

## Overview

This case study documents the analysis and implementation of the `--interactive-mode` option for the `solve` command. In interactive mode, the output of Claude CLI (in NDJSON format) is parsed and posted as GitHub PR comments in real-time, allowing users to observe the AI's progress interactively.

## Problem Statement

When using the `solve` command with Claude tool, all output is written to a log file. Users can only see the final result after the entire session completes. This makes it difficult to:

1. Monitor long-running sessions in real-time
2. Understand what the AI is doing during execution
3. Provide feedback during the session

## Research Findings

### Claude CLI Output Format

Claude CLI outputs NDJSON (Newline-Delimited JSON) when using `--output-format stream-json`. Each line is a separate JSON object representing an event in the conversation.

### JSON Event Types Identified

Based on analysis of actual solution logs from PRs #795, #797, and #792:

#### 1. System Events (`type: "system"`)
- **`subtype: "init"`** - Session initialization
  - Contains: `cwd`, `session_id`, `tools`, other configuration
  - Example: First event in every session

#### 2. Assistant Events (`type: "assistant"`)
- Contains the AI's responses
- Nested structure with `message.content[]`
- Content types:
  - `type: "text"` - Text responses
  - `type: "tool_use"` - Tool invocations

#### 3. User Events (`type: "user"`)
- Contains tool results
- Nested structure with `message.content[]`
- Content types:
  - `type: "tool_result"` - Results from tool execution

#### 4. Result Events (`type: "result"`)
- Final event in a session
- Subtypes:
  - `subtype: "success"` - Session completed successfully
  - `subtype: "error"` - Session ended with error (e.g., usage limit)
- Contains: `duration_ms`, `duration_api_ms`, `num_turns`, `result`, `session_id`, `total_cost_usd`, `usage`

### Sample JSON Objects

See [json-examples.md](./json-examples.md) for detailed examples of each event type.

## Implementation Plan

### Phase 1: Skeleton Implementation (This Session)

1. Add `--interactive-mode` option to:
   - `solve.config.lib.mjs` - CLI argument definition
   - Mark as experimental

2. Create `src/interactive-mode.lib.mjs`:
   - Empty handler functions for each JSON event type
   - Export main processing function

3. Integrate with `claude.lib.mjs`:
   - Call interactive mode handlers when enabled
   - Post comments to PR as events arrive

### Phase 2: Full Implementation (Future Sessions)

1. Implement handlers for each event type
2. Design comment formatting for each event
3. Handle batching/rate limiting for GitHub API
4. Add tests

## Files to Modify

- `src/solve.config.lib.mjs` - Add `--interactive-mode` option
- `src/claude.lib.mjs` - Call interactive mode handlers
- `src/interactive-mode.lib.mjs` (new) - Handler implementations

## References

- Issue: https://github.com/link-assistant/hive-mind/issues/800
- Related PR examples:
  - PR #797 log: https://gist.github.com/konard/39ad281ca0a9c66443952ea867e1ab42
  - PR #795 log: https://gist.github.com/konard/1afa2893e2e825881595edc399153692
  - PR #792 log: https://gist.github.com/konard/7feb264a67c43629620c6d3d72ec40f3
