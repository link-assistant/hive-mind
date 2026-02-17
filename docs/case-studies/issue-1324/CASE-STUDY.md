# Case Study: Claude API "no low surrogate in string" Error

**Issue**: [link-assistant/hive-mind#1324](https://github.com/link-assistant/hive-mind/issues/1324)
**Date**: 2026-02-17
**Status**: Analysis Complete

## Executive Summary

This case study documents an API error that occurs when Claude Code sends JSON to the Anthropic API containing an orphaned UTF-16 high surrogate character. The error message:

```
API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"The request body is not valid JSON: no low surrogate in string: line 1 column 28642 (char 28641)"}}
```

## Root Cause Analysis

### What Happened

1. Claude Code was processing GitHub issue comments that contained emojis
2. The tool output was too large (44.8KB) and was truncated by Claude Code's `<persisted-output>` feature
3. The truncation cut through the middle of a UTF-16 surrogate pair emoji
4. Specifically, the emoji `🤖` (U+1F916, Robot Face) was cut, leaving only the high surrogate `\ud83e` without its low surrogate `\udd16`
5. When Claude Code serialized this content as JSON for the next API request, the invalid Unicode caused the request to fail

### Technical Details

UTF-16 encoding uses surrogate pairs to represent characters outside the Basic Multilingual Plane (BMP, U+0000 to U+FFFF). Characters like emojis (U+1F000+) are encoded as:

- **High surrogate**: U+D800 to U+DBFF
- **Low surrogate**: U+DC00 to U+DFFF

The emoji `🤖` (U+1F916) is encoded as:

- High surrogate: `\uD83E`
- Low surrogate: `\uDD16`

When text is truncated at a byte boundary that falls between these two surrogates, the high surrogate is left "orphaned" without its matching low surrogate. This creates invalid Unicode that cannot be represented in JSON.

### Evidence from Log File

Location in log (line ~98553, position 98553-98559):

```
All changes have been merged to the main branch.\n\n---\n\ud83e\n...\n</persisted-output>
```

The `\ud83e` is the orphaned high surrogate from what was originally a full emoji (likely `🤖`).

## Timeline of Events

| Time (UTC)  | Event                                                           |
| ----------- | --------------------------------------------------------------- |
| 20:17:27    | Claude Code starts executing with Opus model                    |
| 20:17:27    | Session ID: `d12b2d61-7ab1-48dc-9677-3a1261066898`              |
| 20:17:34-36 | Model issues parallel tool calls to fetch GitHub comments       |
| 20:17:36    | Tool `toolu_01UjJKsUew28fdRqYJBu3PtK` returns issue comments    |
| 20:17:36    | Output truncated (44.8KB → 2KB preview in `<persisted-output>`) |
| ~20:17:36   | Truncation cuts emoji surrogate pair at character boundary      |
| 20:17:48    | API request with orphaned surrogate fails with error 400        |
| 20:17:48    | Session terminates with exit code 1                             |

## Affected Components

1. **Claude Code CLI** (version 2.1.41) - Output truncation feature
2. **Anthropic API** - JSON parsing rejects invalid Unicode
3. **GitHub API** - Source of emoji-rich comment data

## Impact

- Session becomes permanently broken - any attempt to resume produces the same error
- Cost incurred: $0.117 USD for the failed session
- User workflow interrupted requiring manual intervention

## Known Related Issues

This is a **known, recurring issue** in Claude Code. Multiple GitHub issues have been filed:

| Issue                                                            | Title                                                                      | Status |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------- | ------ |
| [#1709](https://github.com/anthropics/claude-code/issues/1709)   | Session broken -> API Error: 400 no low surrogate                          | CLOSED |
| [#2108](https://github.com/anthropics/claude-code/issues/2108)   | The request body is not valid JSON: no low surrogate                       | CLOSED |
| [#16294](https://github.com/anthropics/claude-code/issues/16294) | API Error 400 "no low surrogate" when Bash output contains invalid Unicode | OPEN   |
| [#5440](https://github.com/anthropics/claude-code/issues/5440)   | JSON Serialization Failure: Unicode Surrogate Pair Error                   | -      |
| [#4519](https://github.com/anthropics/claude-code/issues/4519)   | Invalid JSON Request: Malformed Low Surrogate                              | -      |

## Possible Solutions

### 1. Unicode Sanitization (Recommended)

Add sanitization in Claude Code to replace orphaned surrogates with the Unicode replacement character (U+FFFD) before JSON serialization:

```javascript
function sanitizeUnicode(text) {
  // Replace orphaned high surrogates (not followed by low surrogate)
  // Replace orphaned low surrogates (not preceded by high surrogate)
  return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
}
```

This should be applied:

- In the `<persisted-output>` truncation logic
- As a safety net before any JSON.stringify() for API requests
- In the Bash tool output processing

### 2. Unicode-Aware Truncation

Modify the truncation logic to be Unicode-aware:

```javascript
function unicodeAwareTruncate(text, maxChars) {
  // Use the spread operator to properly iterate Unicode code points
  const chars = [...text];
  if (chars.length <= maxChars) return text;
  return chars.slice(0, maxChars).join('');
}
```

This ensures truncation never splits a surrogate pair.

### 3. Workaround: User Hooks

Users can add a `PostToolUse` hook to sanitize Bash output, but this is a workaround rather than a fix.

## Recommendations

1. **For Anthropic/Claude Code team**: Implement Unicode sanitization at the truncation boundary and before API serialization
2. **For Users**:
   - Avoid resuming broken sessions; start fresh
   - Consider using hooks to sanitize output
   - Be aware that emoji-heavy GitHub comments may trigger this issue
3. **For hive-mind project**:
   - Consider pre-sanitizing content before passing to Claude Code
   - Monitor for this error in logs and implement retry with fresh session

## Files and Artifacts

- [solution-draft-log.txt](./solution-draft-log.txt) - Full execution log showing the error
- [REPRODUCIBLE-EXAMPLE.md](./REPRODUCIBLE-EXAMPLE.md) - Steps to reproduce (to be created)

## References

- [Unicode UTF-16 Surrogate Pairs](https://en.wikipedia.org/wiki/UTF-16#Code_points_from_U+010000_to_U+10FFFF)
- [JSON RFC 8259 - String encoding requirements](https://www.rfc-editor.org/rfc/rfc8259#section-7)
- [anthropics/claude-code#16294](https://github.com/anthropics/claude-code/issues/16294) - Most detailed issue report
- [anthropics/claude-code#1709](https://github.com/anthropics/claude-code/issues/1709) - First report of this issue class
