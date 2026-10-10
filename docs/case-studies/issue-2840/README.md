# Failure comments named the alias mapping, not the model that ran

[Issue #2840](https://github.com/link-assistant/hive-mind/issues/2840) reports
that failure comments presented the bundled alias mapping (`opus → claude-opus-5`)
as the model that ran, although Claude Code actually ran `claude-opus-5-5`. The
default fallback model came from the same stale mapping, so it skipped Opus 5.
[PR #2854](https://github.com/link-assistant/hive-mind/pull/2854) fixes both.
The [issue snapshot](data/issue.json) is preserved; the issue had no comments
when the fix was written.

## Evidence

- Run 1 (link-assistant/hive-mind#2592, `--tool claude`, default `opus`): the solve
  log said `Model: opus (claude-opus-5)` and `Claude --fallback-model: claude-opus-4-8`,
  while Claude's `system/init`, the request body and the result `modelUsage` all
  said `claude-opus-5-5`. The failure comment said
  `**Model: Claude Opus 5** (claude-opus-5)`.
- Run 2 (link-assistant/web-capture#178): Claude was OOM-killed (exit 137) before
  its `result` event. All 669 `model` fields of the stream said `claude-opus-5-5`;
  the failure comment again said `claude-opus-5`.

## Root causes

1. `src/models/catalog.mjs` mapped `opus` to `claude-opus-5`, while Claude Code's
   rolling `opus` alias already resolved to `claude-opus-5-5`. Execution passes the
   alias through (Issue #2290), so the run itself was right, but the mapping also
   seeds the comment and `resolveDefaultFallbackModel`
   (`opus → claude-opus-5 → opus-4-8`).
2. Since Issue #2690, session metadata (`resultModelUsage`) is captured only from
   a real success `result`. On error paths `getModelInfoForComment` had no actual
   model IDs and fell back to `resolveModelId(requestedModel)`, rendered with the
   same bold `**Model:**` line as a verified model.
3. Nothing recorded the model IDs Claude reports long before `result`: the
   `system/init` `model` and every assistant `message.model`.

Reproduce on the pre-fix commit with
[`experiments/issue-2840-model-comment-repro.mjs`](../../../experiments/issue-2840-model-comment-repro.mjs):

```
resolveModelId(opus) = claude-opus-5
fallback(opus) = opus-4-8
- Requested: `opus` (`claude-opus-5`)
- **Model: Claude Opus 5** (`claude-opus-5`)
```

## Fix

- `src/observed-models.lib.mjs` (new) records model IDs from `system/init` and
  assistant `message.model` as each stream event arrives in `claude.lib.mjs`.
  `<synthetic>` entries are ignored (Issue #1486), and sub-agent models
  (`parent_tool_use_id`) are listed after main-thread models. The registry is
  process-wide because failure comments are posted from call sites, including
  the pre-exit notifier, that never see the tool result. It is reset at the start
  of each Claude session.
- `attachLogToGitHub` uses these IDs when the session produced no
  `resultModelUsage`, so a crashed or killed session's comment names
  `claude-opus-5-5`.
- `getModelInfoForComment` no longer turns the requested alias into a `**Model:**`
  line. When no actual model is known the comment says
  `Requested (actual model unknown — session ended before result)` on failures,
  or `... — not reported by the tool` otherwise.
- Retries pass the latest main-thread model observed for the still-requested
  model to `prepareRetryAfterError`, so the default fallback is chosen from the
  model that ran (`claude-opus-5-5 → opus-5`). An explicit `--fallback-model`
  still wins, and an unknown observed model falls back to the requested model's
  chain.
- The `opus` alias now maps to `claude-opus-5-5` (see also Issue #2591), so the
  pre-run `--fallback-model` default is `opus-5` (`claude-opus-5`).

## Verification

`tests/issue-2840-observed-model.test.mjs` covers the alias table, event
extraction, registry ordering, fallback selection, the comment labels, and a
replay of web-capture#178 through `attachLogToGitHub` with a fake `gh`. Existing
model-support tests that encoded `opus → claude-opus-5` and the `opus → opus-4-8`
fallback were updated to the new mapping.
