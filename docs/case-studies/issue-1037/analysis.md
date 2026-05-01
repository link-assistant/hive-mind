# Case Study: False Positives for Token Removal from Logs (Issue #1037)

## Summary

The log sanitization logic in `src/github.lib.mjs` produces false positives when masking tokens, incorrectly masking legitimate non-sensitive strings like:

- Function/tool names (e.g., `browser_take_screenshot` → `brows*************nshot`)
- Gist IDs/commit hashes (e.g., `2073c66ab9405a46416dbb51714f843c30160520c` → `2073c**********************0520c`)

## Timeline of Events

1. User runs `solve` command with `--attach-logs` option
2. Solution draft log is generated containing various text including:
   - System prompt text with tool names like `browser_take_screenshot`
   - GitHub gist IDs in commands like `gh gist view 2073c66ab9405a46416dbb51714f843c30160520c`
3. `sanitizeLogContent()` function in `src/github.lib.mjs` processes the log
4. Overly aggressive regex patterns match legitimate strings and mask them

## Root Cause Analysis

### The Problematic Code

Located in `src/github.lib.mjs` lines 167-180:

```javascript
const tokenPatterns = [
  /gh[pou]_[a-zA-Z0-9_]{20,}/g,
  /(?:^|[\s:=])([a-f0-9]{40})(?=[\s\n]|$)/gm, // 40-char hex tokens
  /(?:^|[\s:=])([a-zA-Z0-9_]{20,})(?=[\s\n]|$)/gm, // General long tokens
];
```

### Why False Positives Occur

1. **Pattern 3 (`[a-zA-Z0-9_]{20,}`)**: This pattern is too broad and matches ANY alphanumeric string with underscores that is 20+ characters long, including:
   - Function names: `browser_take_screenshot` (23 chars)
   - Tool identifiers: `mcp__playwright__browser_take_screenshot`
   - Other legitimate identifiers

2. **Pattern 2 (`[a-f0-9]{40}`)**: While meant to catch 40-char hex tokens, this also matches:
   - Git commit hashes (which are NOT sensitive)
   - GitHub gist IDs (which are NOT sensitive)

### Specific False Positives Found

| Original String                             | Masked Result                      | Pattern Matched          |
| ------------------------------------------- | ---------------------------------- | ------------------------ |
| `browser_take_screenshot`                   | `brows*************nshot`          | Pattern 3 (20+ alphanum) |
| `2073c66ab9405a46416dbb51714f843c30160520c` | `2073c**********************0520c` | Pattern 2 (40-char hex)  |

## Evidence from Log File

From `solution-draft-log-pr-1767036677500.txt`:

Line 340:

```
- When you need to visually verify how a web page looks or take screenshots, use brows*************nshot from Playwright MCP.
```

Line 1213:

```
"command": "gh gist view 2073c**********************0520c 2>&1 | ...
```

## Proposed Solutions

### Option 1: Add Allowlist for Known Safe Patterns (Recommended)

Add an allowlist of patterns that should NOT be masked:

- Known tool/function name prefixes: `browser_`, `mcp__`, etc.
- Git object patterns (commit hashes that appear in git commands)
- Gist IDs when used in `gh gist` commands

```javascript
const SAFE_PATTERNS = [
  /^browser_[a-z_]+$/i, // Browser tool names
  /^mcp__[a-z_]+$/i, // MCP tool names
  /^[a-f0-9]{40}$/i, // Git commit/gist hashes (standalone)
];

const isSafePattern = token => {
  return SAFE_PATTERNS.some(pattern => pattern.test(token));
};
```

### Option 2: Improve Token Detection Heuristics

Make the regex patterns more specific by:

1. Requiring specific prefixes for real tokens (`ghp_`, `gho_`, `ghu_`, etc.)
2. Only masking hex strings that appear in sensitive contexts (not git commands)
3. Adding negative lookbehind/lookahead for common non-sensitive contexts

### Option 3: Context-Aware Masking

Don't mask tokens that appear in:

- Known command patterns: `gh gist view`, `git log`, `git show`, etc.
- System prompt text (identifiable by certain markers)
- JSON field names

## Recommended Implementation

Combine Options 1 and 2:

1. **Remove overly broad Pattern 3** (`[a-zA-Z0-9_]{20,}`) entirely or make it much more specific
2. **Add context checks for Pattern 2** to not mask hex strings in git/gist commands
3. **Add an allowlist** of known safe prefixes/patterns
4. **Add unit tests** to prevent regression

## Files to Modify

1. `src/github.lib.mjs` - Main fix in `sanitizeLogContent()` function
2. `experiments/test-token-masking.mjs` - Add test cases for false positives
3. Create new test file with comprehensive unit tests

## Test Cases Needed

1. Should NOT mask `browser_take_screenshot`
2. Should NOT mask `mcp__playwright__browser_click`
3. Should NOT mask gist IDs in `gh gist view` commands
4. Should NOT mask commit hashes in `git log` output
5. SHOULD mask actual GitHub tokens (`ghp_xxxx...`)
6. SHOULD mask tokens from `gh auth status` output
7. SHOULD mask tokens in `oauth_token:` patterns
