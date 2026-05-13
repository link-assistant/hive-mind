# Case Study: Issue #1474 — Per-free-model `1-at-a-time` mode for `--tool agent`

## Issue

[Issue #1474](https://github.com/link-assistant/hive-mind/issues/1474) — _"For all free models in queue of `--tool agent` please use mode `1 at time` for each specific free model."_

## Problem statement (verbatim, condensed)

> For example for `minimax-m2.5-free` we cannot execute more than 1 task at a time, due to high risk of getting into rate limit.
> But if task for `minimax-m2.5-free` is executing, we still can execute 1 task for `gpt-5-nano`, that is also free model, but we expect it to have separate rate limit.
>
> As we now testing `--tool agent` mostly with free limits, the entire agent queue should be working in 1 task at a time mode. And yet it should be configurable for all queues, just that they should have different defaults, at the moment the `--tool agent` should be the only queue with 1 at time mode globally and unconditionally.

The author also notes a dependency on [#380](https://github.com/link-assistant/hive-mind/issues/380) (tracking finish of a solve command end-to-end). With separate-tool queues already in place per [#1159](https://github.com/link-assistant/hive-mind/issues/1159) and the existing `dequeue-one-at-a-time` strategy from [#1253](https://github.com/link-assistant/hive-mind/issues/1253), we can deliver per-free-model gating without waiting on #380 — `this.processing` in the in-memory queue is already a good enough proxy for "command running" inside the bot process. (External pgrep is still consulted via `getExternalProcessingSnapshot`, so detached screen sessions also count.)

## Requirements

Numbered for traceability:

1. **R1** — The `--tool agent` queue MUST default to globally and unconditionally 1-at-a-time concurrency (one in-flight task at a time across the entire agent queue).
2. **R2** — Each specific **free** agent model (e.g. `minimax-m2.5-free`, `gpt-5-nano`, `nemotron-3-super-free`, `deepseek-r1-free`, …) MUST have its own _1-at-a-time_ slot, so different free models execute in parallel.
3. **R3** — Configurability: every queue (claude, agent, codex, qwen, gemini) MUST have a tunable concurrency mode (global one-at-a-time, per-model one-at-a-time, off) via the existing `HIVE_MIND_QUEUE_CONFIG` (links notation) **and** discrete env vars. The agent queue MUST default to "global one-at-a-time" today.
4. **R4** — Free model detection MUST cover both providers (OpenCode Zen `opencode/...-free` and Kilo Gateway `kilo/...-free`) and aliases.
5. **R5** — Other tools (claude/codex/qwen/gemini) MUST remain unaffected unless explicitly configured.
6. **R6** — Behavior MUST be covered by automated tests (queue gating logic) and documented in a case study + PR description.
7. **R7** — No regressions in existing queue behavior (rate limits, reject strategy, parallel cross-tool starts).

## Data collected

### Files that participate in the queue / rate-limiting flow

| Path                               | Role                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/telegram-solve-queue.lib.mjs` | The queue. Holds `SolveQueueItem`, `SolveQueue`, `findStartableItems()`, `canStartCommand()`, `getProcessingCountByTool()`.                |
| `src/queue-config.lib.mjs`         | `QUEUE_CONFIG` thresholds, strategies, `parseQueueConfig` (links notation).                                                                |
| `src/telegram-bot.mjs`             | The producer. Parses `--tool` and `--model` from args and calls `solveQueue.enqueue(...)`.                                                 |
| `src/models/index.mjs`             | `agentModels`, `defaultModels.agent`, `freeToBaseModelMap`, `mapModelForTool()`.                                                           |
| `src/agent.lib.mjs`                | Tool runner. Has `getBaseModelForPricing()` which already classifies a model as "free" using `freeToBaseModelMap` plus the `-free` suffix. |
| `tests/solve-queue*.mjs`           | Test suite for the queue.                                                                                                                  |

### Already-existing primitives we can reuse

- **Per-tool queues** (PR #1160 / issue #1159) — `this.queues[tool]` and `getProcessingCountByTool(tool)` already exist and isolate tools from each other. We just need a per-`(tool, model)` counter and gate.
- **Strategy framework** (#1253) — `THRESHOLD_STRATEGIES` already includes `dequeue-one-at-a-time`. Reused for naming consistency, but the new concurrency mode is conceptually different from threshold-driven strategies, so we add a separate config under `QUEUE_CONFIG.concurrency`.
- **Free-model classifier** — `getBaseModelForPricing()` in `src/agent.lib.mjs` already encodes the truth about "what counts as a free agent model": `freeToBaseModelMap` membership OR ends with `-free`. We lift that logic into a shared helper so the queue can call it too.
- **Links notation parser** (#1242 / #1253) — `parseQueueConfig()` already accepts arbitrary metric names and validates against `THRESHOLD_STRATEGIES`. We extend the surface but keep the same parser.

### How `enqueue()` is currently called from the bot

From `src/telegram-bot.mjs:877`:

```js
const queueItem = solveQueue.enqueue({
  url: normalizedUrl,
  args: argsWithLocale,
  ctx,
  requester,
  infoBlock,
  tool: solveTool, // 'agent', 'claude', …
  perCommandIsolation: effectiveSolveIsolation,
  urlContext: solveUrlContext,
  showLimits: solveShowLimits,
  limitsAtStart: solveLimitsAtStart,
  locale: solveLocale,
});
```

`solveTool` is parsed by walking `args` looking for `--tool`/`--tool=`. The user's `--model` is in `args` but is currently _not_ extracted at the queue boundary. We need to extract it the same way `solveTool` is.

## Research: prior art / online review

- **#1159 (separate tool queues)** establishes the exact pattern of "FIFO per dimension, independent rate limits per dimension". Our extension is one dimension deeper: per `(tool, model)` for the gated case.
- **#1253 (strategy framework)** introduces `THRESHOLD_STRATEGIES = ['reject', 'enqueue', 'dequeue-one-at-a-time']` and the `HIVE_MIND_QUEUE_CONFIG` links notation. We reuse this exact vocabulary so users do not have to learn a new config language.
- **`p-limit` / `bottleneck` / `async-mutex`** (npm) — these solve per-key concurrency well but our queue is already integrated with status messages, Telegram updates, and `findStartableItems`; bringing in a third-party scheduler would force a refactor without obvious gain. The implementation below is ~30 lines in the existing class.
- **OpenCode Zen / Kilo Gateway free tier rate limits** — both providers rate-limit per-model (per API key) rather than per-account-aggregated, which is exactly why the issue requires per-model gating instead of "free-vs-paid" gating.

## Proposed solution

### Concurrency configuration model

Add a `QUEUE_CONFIG.concurrency` map, keyed by tool:

```jsonc
{
  "claude": { "mode": "off" }, // unchanged default
  "agent": { "mode": "global-one-at-a-time" }, // R1: agent default
  "codex": { "mode": "off" },
  "qwen": { "mode": "off" },
  "gemini": { "mode": "off" },
}
```

Where `mode` is one of:

- `'off'` — no concurrency cap from this layer (existing rate-limit strategies still apply).
- `'global-one-at-a-time'` — at most 1 in-flight item per tool, regardless of model.
- `'per-free-model-one-at-a-time'` — for _free_ models, at most 1 in-flight item per `(tool, model)`. Non-free models in the same tool run with `'off'` semantics.
- `'per-model-one-at-a-time'` — at most 1 in-flight item per `(tool, model)`, for all models.

Per the issue text: ship `agent = 'global-one-at-a-time'` as the default. The `'per-free-model-one-at-a-time'` mode is the natural switch users will flip when they want different free models to run in parallel (R2 + R3).

### Configuration surface

1. **Env var per tool** — `HIVE_MIND_AGENT_CONCURRENCY=per-free-model-one-at-a-time` (and same for `CLAUDE`, `CODEX`, `QWEN`, `GEMINI`).
2. **Links notation** — extend `HIVE_MIND_QUEUE_CONFIG`:
   ```
   (
     (agent-concurrency per-free-model-one-at-a-time)
     (claude-concurrency global-one-at-a-time)
   )
   ```
3. **Built-in defaults** — `agent: global-one-at-a-time`, all others `off`.

### Plumbing the model into the queue

- `SolveQueueItem` gains a `model` field (alias preserved; we don't need to map to a full provider ID for gating — the alias is unique enough and matches what users specify).
- `solveQueue.enqueue({ ..., model })` accepts it; the telegram bot extracts `--model`/`-m`/`--model=` from `args` the same way it extracts `--tool`.
- New helper `getProcessingCountByToolAndModel(tool, model)` symmetrical with `getProcessingCountByTool(tool)`.
- New helper `isFreeAgentModel(model)` lifted from `agent.lib.mjs`'s `getBaseModelForPricing()`.
- `findStartableItems()` consults `QUEUE_CONFIG.concurrency[tool].mode` to gate the head of each tool queue.

### Why not gate on the `dequeue-one-at-a-time` strategy via a synthetic threshold?

That mechanism is keyed off live metrics (RAM/CPU/Claude limits) — it kicks in only when a threshold is exceeded. R1 demands unconditional 1-at-a-time for agent, so a metric-driven gate is the wrong primitive. The simpler, more honest model is "concurrency cap", parallel to "threshold strategy".

## Implementation plan (atomic commits)

1. **Add free-model classifier helper** — export `isFreeAgentModel(model)` from `src/models/index.mjs` so both `agent.lib.mjs` and the queue can use it.
2. **Add concurrency config** — extend `src/queue-config.lib.mjs`: parse `*-concurrency` keys (lino + env vars), add `QUEUE_CONFIG.concurrency`, defaults `{ agent: 'global-one-at-a-time', others: 'off' }`.
3. **Wire model through queue** — `SolveQueueItem.model`, `enqueue({...,model})`, `getProcessingCountByToolAndModel`, update `findStartableItems()` to gate per-tool mode.
4. **Producer side** — extract `--model` in `src/telegram-bot.mjs` and pass into `enqueue(...)`.
5. **Tests** — extend `tests/solve-queue-tool-tracking.test.mjs` (or a new file) covering: agent default = global one-at-a-time; per-free-model mode allows two different free models to start in parallel; non-free models bypass per-free gating; claude/codex unaffected.
6. **Changeset** — patch bump describing the user-visible change.
7. **Case study** — this document.
8. **PR update** — title, description with R-checklist.

## Acceptance criteria (mapped to requirements)

| R#  | Verification                                                                                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Default config has `concurrency.agent = 'global-one-at-a-time'`. Test: enqueue 2 agent items, only 1 startable.                                                        |
| R2  | With `concurrency.agent = 'per-free-model-one-at-a-time'`: two items with same free model → 1 startable; two items with different free models → both startable.        |
| R3  | Env var + lino config override defaults; tests cover both paths.                                                                                                       |
| R4  | `isFreeAgentModel` returns true for `*-free` suffix and for entries of `freeToBaseModelMap`. Resolution works for aliases (e.g. `minimax-m2.5-free` → still detected). |
| R5  | Default `claude/codex/qwen/gemini` concurrency is `'off'`; existing tests continue to pass.                                                                            |
| R6  | New tests in `tests/solve-queue-concurrency.test.mjs`; this case study.                                                                                                |
| R7  | Full `npm test` green; no behavior change for current rate limits / reject strategy.                                                                                   |

## Open questions / future work

- Concurrency cap > 1 (e.g. "max 3 per model") is straightforward to add later — the helper is parameterized. Out of scope for this PR per the issue text.
- Cross-process coordination (multiple bot instances sharing free-model rate limits via a shared store) is out of scope; this PR remains in-memory.
- Per-(tool, model) reject strategy could also be useful but isn't requested.

## References

- Issue: https://github.com/link-assistant/hive-mind/issues/1474
- Pull request: https://github.com/link-assistant/hive-mind/pull/1797
- Related: #380, #1159, #1253, #1242, #1543, #1563
