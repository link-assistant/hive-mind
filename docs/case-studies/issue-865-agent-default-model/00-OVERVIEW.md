# Case Study: Issue #865 - Agent Tool Default Model Error

## Executive Summary

When using `--tool agent`, the system fails with a `ProviderModelNotFoundError` because the default model is set to `anthropic/claude-3-5-sonnet`, which is a premium model requiring OpenCode Zen subscription. The agent tool should default to a free model like `opencode/grok-code` instead.

## Issue Details

- **Issue**: #865
- **Title**: Set default model of `--tool agent` to `opencode/grok-code`
- **Date**: 2025-12-08
- **Reporter**: User attempting to solve issue #863 with `--tool agent`

## Error Observed

```
ProviderModelNotFoundError: ProviderModelNotFoundError
 data: {
  providerID: "anthropic",
  modelID: "claude-3-5-sonnet",
},

      at getModel (/home/hive/.bun/install/global/node_modules/@link-assistant/agent/src/provider/provider.ts:524:26)
```

## Command Executed

```bash
/home/hive/.nvm/versions/node/v20.19.6/bin/node /home/hive/.bun/bin/solve \
  https://github.com/link-assistant/hive-mind/issues/863 \
  --tool agent \
  --attach-logs \
  --verbose \
  --no-tool-check
```

## Root Cause Summary

The default model selection in `src/solve.config.lib.mjs` (lines 86-94) does not handle the `agent` tool case, causing it to fall back to `'sonnet'`, which maps to `anthropic/claude-3-5-sonnet` - a premium model requiring authentication.

## Impact

- Users without OpenCode Zen subscription cannot use `--tool agent` without explicitly specifying a model
- Poor user experience as the tool fails immediately
- Inconsistent with other tools (opencode defaults to `grok-code-fast-1`, codex defaults to `gpt-5`)

## Proposed Solution

Add a case for `agent` tool in the default model selection to use `'grok-code'` (maps to `opencode/grok-code`), which is a free model available without subscription.
