# Case Study: Replace Deprecated `qwen3.6-plus-free` Default with `nemotron-3-super-free`

**Issue:** [#1563](https://github.com/link-assistant/hive-mind/issues/1563)
**Upstream PR:** [agent#243](https://github.com/link-assistant/agent/pull/243)
**Upstream Issue:** [agent#242](https://github.com/link-assistant/agent/issues/242)

## Problem Statement

OpenCode Zen ended the free promotion for `qwen3.6-plus-free` (Qwen 3.6 Plus Free) in April 2026. The model now returns HTTP 401 with the following error:

```json
{
  "type": "error",
  "error": {
    "type": "ModelError",
    "message": "Free promotion has ended for Qwen3.6 Plus Free. You can continue using the model by subscribing to OpenCode Go - https://opencode.ai/go"
  }
}
```

This broke the default agent experience for all free-tier users of both the upstream agent CLI and hive-mind's `--tool agent` option, since `qwen3.6-plus-free` was the default model (set in Issue #1543).

## Root Cause

OpenCode Zen provider discontinued the free tier for `qwen3.6-plus-free`. The model requires an OpenCode Go subscription to continue using. This is an external provider decision, not a bug in hive-mind or the agent CLI.

## Timeline

1. **March 2026** - `qwen3.6-plus-free` added as free model (Issue #1543, agent PR #234)
2. **April 8, 2026** - Hive-mind synced with upstream, set `qwen3.6-plus-free` as default (Issue #1543)
3. **April 2026** - OpenCode Zen ends free promotion for `qwen3.6-plus-free`
4. **April 10, 2026** - Agent CLI fixes the issue (agent PR #243), hive-mind syncs (this PR)

## Solution

### Default Model Change

- **Before:** `qwen3.6-plus-free` (~1M context, now returns HTTP 401 for free users)
- **After:** `nemotron-3-super-free` (~262K context, NVIDIA hybrid Mamba-Transformer, still free)

### Changes Made

| Area      | File                            | Change                                                                      |
| --------- | ------------------------------- | --------------------------------------------------------------------------- |
| **Core**  | `src/models/index.mjs`          | Change defaultModels.agent, move qwen3.6-plus-free to deprecated section    |
| **Docs**  | `docs/FREE_MODELS.md`           | Move qwen3.6-plus-free to discontinued, update default references/examples  |
| **Docs**  | `README.md`                     | Update free model examples                                                  |
| **Tests** | `tests/test-free-models.mjs`    | Move qwen3.6-plus-free to deprecated models, update default model assertion |
| **Docs**  | `docs/case-studies/issue-1563/` | This case study                                                             |

### Backward Compatibility

- `qwen3.6-plus-free` remains as a deprecated model alias (kept for backward compatibility)
- Users who explicitly specify `--model qwen3.6-plus-free` will still have it resolved, but will get HTTP 401 from OpenCode Zen unless they have an OpenCode Go subscription
- The only behavioral change is the default: users who don't specify `--model` with `--tool agent` will now get `nemotron-3-super-free` instead of `qwen3.6-plus-free`

## Updated Free Models (OpenCode Zen, April 2026)

| Model                 | Context       | Output     | Status                                           |
| --------------------- | ------------- | ---------- | ------------------------------------------------ |
| nemotron-3-super-free | ~262,144      | 262,144    | **New default**, NVIDIA hybrid Mamba-Transformer |
| minimax-m2.5-free     | ~200,000      | 131,072    | Former default, general-purpose                  |
| gpt-5-nano            | ~400,000      | 128,000    | OpenAI, smallest GPT-5 variant                   |
| big-pickle            | ~200,000      | 128,000    | Stealth model, free during evaluation            |
| ~~qwen3.6-plus-free~~ | ~~1,000,000~~ | ~~65,536~~ | **Discontinued** - free promotion ended          |

## References

- [Agent PR #243](https://github.com/link-assistant/agent/pull/243) - Upstream fix
- [Agent Issue #242](https://github.com/link-assistant/agent/issues/242) - Upstream issue
- [Hive-mind Issue #1543](https://github.com/link-assistant/hive-mind/issues/1543) - Previous sync that added qwen3.6-plus-free
- [Case Study: Issue #1543](../issue-1543/README.md) - Previous case study with model details
