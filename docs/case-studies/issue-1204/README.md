# Case Study: "no low surrogate in string" JSON Serialization Error

## Issue Reference

- **Hive Mind Issue**: [#1204](https://github.com/link-assistant/hive-mind/issues/1204)
- **Error**: `API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"The request body is not valid JSON: no low surrogate in string: line 1 column 160309 (char 160308)"}}`
- **Date**: 2026-01-30
- **Affected Session**: `5914db3e-7f26-4bac-896c-129f98663e0b`
- **Context**: Claude Opus 4.5 solving issue [link-assistant/agent#146](https://github.com/link-assistant/agent/issues/146) via PR [#147](https://github.com/link-assistant/agent/pull/147)

## Timeline of Events

1. **17:58:46 UTC** — `solve.mjs` v1.9.0 started processing `link-assistant/agent#146`
2. **17:58:56 UTC** — Branch `issue-146-635c24f49ba7` created, initial commit pushed
3. **17:59:05 UTC** — Draft PR #147 created
4. **17:59:12 UTC** — Claude Opus 4.5 invoked with streaming NDJSON output
5. **~18:00-18:02 UTC** — Claude read multiple source files (Rust source code from `link-assistant/agent`) and log files, accumulating context
6. **18:02:04 UTC** — Claude completed 21 turns, issued a Bash tool call to `grep` through a log file
7. **18:02:06 UTC** — **API returned HTTP 400**: "The request body is not valid JSON: no low surrogate in string: line 1 column 160309 (char 160308)"
8. **18:02:07 UTC** — Session terminated with `is_error: true`, total cost $1.03

## Root Cause Analysis

### What are Surrogate Pairs?

Unicode code points above U+FFFF (the Basic Multilingual Plane) are encoded in UTF-16 using **surrogate pairs**: a **high surrogate** (U+D800–U+DBFF) followed by a **low surrogate** (U+DC00–U+DFFF). A lone high surrogate without its corresponding low surrogate is invalid in both UTF-16 and JSON (RFC 8259, Section 8.1).

### How Lone Surrogates Enter the System

The most common sources of lone surrogates in this context are:

1. **Binary file content interpreted as text**: When tools like `cat`, `grep`, or `gh api` read files containing binary data (compiled Rust output, `.af` files, build artifacts), byte sequences in the range `0xD800-0xDFFF` appear as lone surrogates when decoded as UTF-16/JavaScript strings.

2. **Log files with corrupted encoding**: Log files captured from processes that output mixed encodings (e.g., UTF-8 mixed with Latin-1 or raw bytes) can contain invalid surrogate sequences.

3. **Accumulated context corruption**: As reported by users in upstream issues, the problem sometimes manifests only after extended sessions where multiple file reads accumulate problematic characters in the conversation history.

### Where the Error Occurs

The error occurs in the **Anthropic API's JSON parser** (server-side). The flow is:

```
Tool output (contains lone surrogate)
  → Claude Code CLI serializes conversation to JSON (JSON.stringify)
  → HTTP POST to Anthropic API
  → Anthropic's JSON parser rejects the body
  → HTTP 400 "no low surrogate in string"
```

In JavaScript, `JSON.stringify()` will include lone surrogates in the output string without error — it produces technically invalid JSON that most JavaScript JSON parsers accept, but stricter parsers (like Anthropic's server-side Rust/Python parser) reject.

### Specific Trigger in This Case

In the failing session, Claude was analyzing Rust source code from the `agent` repository and reading log files from a previous solve session. The 21-turn session accumulated ~160K characters of context. At turn 21, the API request body contained a lone high surrogate at character position 160308 (likely from a tool result containing binary-tainted content).

## Upstream Issue

This is a **known, unresolved bug in Claude Code** (the `anthropics/claude-code` CLI):

- [#1709](https://github.com/anthropics/claude-code/issues/1709) — Original report (June 2025, auto-closed)
- [#2108](https://github.com/anthropics/claude-code/issues/2108) — Duplicate
- [#15027](https://github.com/anthropics/claude-code/issues/15027) — Detailed analysis with root cause
- [#3995](https://github.com/anthropics/claude-code/issues/3995), [#6464](https://github.com/anthropics/claude-code/issues/6464), [#5440](https://github.com/anthropics/claude-code/issues/5440) — Additional reports

The issue remains **unfixed as of Claude Code v2.0.14** (January 2026). All upstream issues were auto-closed by the inactivity bot.

## Impact

- **Session becomes unrecoverable**: Once the conversation history contains a lone surrogate, every subsequent API call fails with the same error (at different character positions).
- **Cost wasted**: The failing session consumed $1.03 in API costs before crashing.
- **No graceful degradation**: The error is fatal — there is no retry or recovery mechanism.

## Solutions

### 1. Upstream Fix (Claude Code CLI) — Recommended Long-term

Claude Code should sanitize all tool outputs before including them in the API request body. Specifically, `JSON.stringify()` results should be post-processed to replace or remove lone surrogates.

**Status**: Reported but unfixed as of January 2026.

### 2. Defensive Workaround in Hive Mind — Implemented

Hive Mind adds a `sanitizeSurrogates()` utility that:

- Removes lone high surrogates (U+D800–U+DBFF not followed by U+DC00–U+DFFF)
- Removes lone low surrogates (U+DC00–U+DFFF not preceded by U+D800–U+DBFF)
- Replaces them with the Unicode replacement character (U+FFFD) or removes them

This is applied to:

- `safeJsonStringify()` in `interactive-mode.lib.mjs` (tool results posted to GitHub)
- String content before shell command interpolation
- The shared `lib.mjs` utility module for general use

### 3. Workaround for Users

- Start a **new session** (the corrupted conversation history is abandoned)
- Avoid reading binary files or files with mixed encodings in Claude Code sessions
- Use `--resume` with a fresh session ID if continuation is needed

## Data Files

- [`solution-draft-log-pr-1769796128836.txt`](./solution-draft-log-pr-1769796128836.txt) — Complete solve session log (4908 lines)

## References

- [RFC 8259 Section 8.1](https://www.rfc-editor.org/rfc/rfc8259#section-8.1) — JSON String specification
- [Unicode FAQ: Surrogates](https://www.unicode.org/faq/utf_bom.html#utf16-2) — Surrogate pair explanation
- [Node.js `JSON.stringify` behavior with lone surrogates](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify#well-formed_json.stringify) — MDN documentation on well-formed JSON.stringify (ES2019)
