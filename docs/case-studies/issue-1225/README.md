# Case Study: Issue #1225 - Model Information Display in PR/Issue Comments

## Summary

PR/issue log comments did not display which AI model was actually used during execution. Users had to dig through execution logs to find model information. This made it difficult to verify that the correct model was used (e.g., when `--model opus` was requested) and to understand the capabilities/limitations of the model that produced the solution.

## Problem Analysis

### Root Cause: Missing Model Info in Comment Pipeline

The `attachLogToGitHub()` function in `github.lib.mjs` creates formatted markdown comments for pull requests and issues. While it included cost estimation data (via `buildCostInfoString()`), it did not include model identification information.

The data flow before the fix:

```
Tool execution (Claude/Agent/Codex/OpenCode)
  -> toolResult { success, sessionId, pricingInfo?, anthropicTotalCostUSD? }
    -> verifyResults()
      -> attachLogToGitHub({ ..., pricingInfo })
        -> buildCostInfoString() // Only shows cost, not model identity
          -> PR comment // Missing: which model was used
```

### Secondary Issue: Code Duplication

The tool display name mapping was duplicated in 3+ locations in `solve.mjs`:

```javascript
// This pattern appeared 3 times:
toolName: (argv.tool || 'AI tool').toString().toLowerCase() === 'claude' ? 'Claude'
  : (argv.tool || 'AI tool').toString().toLowerCase() === 'codex' ? 'Codex'
  : (argv.tool || 'AI tool').toString().toLowerCase() === 'opencode' ? 'OpenCode'
  : (argv.tool || 'AI tool').toString().toLowerCase() === 'agent' ? 'Agent'
  : 'AI tool',
```

## Solution

### New Module: `model-info.lib.mjs`

A unified model information library was created with the following functions:

| Function                               | Purpose                                                                      |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| `getToolDisplayName(tool)`             | Maps tool identifiers to display names, replacing duplicated ternary chains  |
| `fetchModelInfoForComment(modelId)`    | Fetches model metadata from models.dev API (with caching)                    |
| `buildModelInfoString(options)`        | Builds markdown model info section for comments                              |
| `resolveModelId(requestedModel, tool)` | Resolves model aliases (e.g., "opus") to full IDs (e.g., "claude-opus-4-6")  |
| `getModelInfoForComment(options)`      | Main entry point: resolves model, fetches metadata, returns formatted string |

### models.dev API Integration

The solution uses the [models.dev](https://models.dev) open-source AI model database to enrich comments with:

- **Model name**: Human-readable name (e.g., "Claude Opus 4.6")
- **Model ID**: Technical identifier (e.g., "claude-opus-4-6")
- **Provider**: AI provider (e.g., "Anthropic")
- **Knowledge cutoff**: When the model's training data ends (e.g., "2025-05")

The API response is cached per-process to avoid repeated network requests.

### Comment Format Enhancement

PR/issue comments now include a model information section:

```markdown
## Solution Draft Log

This log file contains the complete execution trace...

**Cost estimation:**

- Public pricing estimate: $0.123456 USD
- ...

**Model information:**

- Tool: Claude
- Requested model: `opus`
- Model: Claude Opus 4.6
- Model ID: `claude-opus-4-6`
- Provider: Anthropic
- Knowledge cutoff: 2025-05
```

### Files Modified

| File                               | Changes                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------ |
| `src/model-info.lib.mjs`           | New file - unified model info library                                    |
| `src/github.lib.mjs`               | Added model info section to all comment formats in `attachLogToGitHub()` |
| `src/solve.mjs`                    | Updated 4 `attachLogToGitHub()` calls, replaced toolName ternaries       |
| `src/solve.results.lib.mjs`        | Updated 3 `attachLogToGitHub()` calls                                    |
| `src/solve.watch.lib.mjs`          | Updated 1 `attachLogToGitHub()` call                                     |
| `src/solve.auto-merge.lib.mjs`     | Updated 1 `attachLogToGitHub()` call                                     |
| `src/solve.error-handlers.lib.mjs` | Updated 1 `attachLogToGitHub()` call                                     |
| `src/solve.execution.lib.mjs`      | Updated 1 `attachLogToGitHub()` call                                     |
| `tests/model-info.test.mjs`        | 26 unit tests for model-info.lib.mjs                                     |

## Data Sources

### models.dev API

- **Endpoint**: `https://models.dev/api.json`
- **Source**: [github.com/anomalyco/models.dev](https://github.com/anomalyco/models.dev)
- **Coverage**: 75+ AI providers, hundreds of models
- **Data format**: JSON with per-provider model catalogs
- **Fields used**: `name`, `id`, `provider`, `knowledge`, `release_date`

### Existing Codebase

The codebase already had `fetchModelInfo()` in `claude.lib.mjs` for pricing calculations. The new `model-info.lib.mjs` module provides a similar but independent implementation focused on comment display, with process-level caching for better performance.

## Testing

26 unit tests were added covering:

- Tool display name mapping (all tools + edge cases)
- Model alias resolution (per-tool model maps, [1m] suffix handling)
- Model info string formatting (various data combinations, fallback behavior)

## Related Issues and PRs

- Issue #1225: Original feature request
- PR #1222: Claude Opus 4.6 model support (established model validation patterns)
- Issue #1088: Error during execution tracking (established `errorDuringExecution` pattern)
- Issue #1152: Session type differentiation (established `sessionType` pattern)
- Issue #1015: Cost section visibility control (inspiration for conditional display)
