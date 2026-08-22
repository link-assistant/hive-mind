# Analysis — Issue #1885 (`--escalate` mode)

## 1. Root-cause framing

The issue is not a bug; it is a **cost/quality optimization**. The status quo is:
pick one model for the whole run. If you pick the most capable model (fable),
every token of writing is billed at top-tier prices, even for the large fraction
of a task that a cheaper model would have handled correctly. If you pick a cheap
model, hard tasks stall.

The issue's key insight, in the author's words:

> there is a probability for small models to do everything mostly right, but now
> [not] quite right.

So the optimal policy is **sequential escalation**: let a cheap model produce a
first draft (cheaply), and only pay for a more capable model on the **residual**
work — the part the cheap model got wrong or left unfinished. The expensive model
then spends most of its budget _reading_ the existing draft and making targeted
fixes ("more reading and less writing"), which is exactly where a frontier model's
marginal value is highest.

This is the well-studied **LLM cascade** pattern (see
[`existing-components.md`](./existing-components.md) for the literature). Our
variant is specialized for an _agentic coding_ workflow where:

- the unit of work is a **whole working session** (not a single completion), and
- "did the cheap model succeed?" is judged from the **pull request artifacts**,
  not a confidence score.

## 2. Why build on the existing restart architecture

`solve` already has two post-solve restart loops that override the worker model
per iteration and drive the AI tool through the same chokepoint:

- `--finalize` → `runAutoEnsureRequirements` (issue #1383)
- `--keep-working-until-all-requirements-are-fully-done` → `runKeepWorkingUntilDone`
  (issue #1883)

Both call `executeToolIteration(...)` (in `src/solve.restart-shared.lib.mjs`),
which is the single dispatch point to claude/codex/opencode/agent/gemini/qwen and
already handles PR sync, merge-state, feedback injection, error classification and
session bookkeeping.

`--escalate` is, structurally, **the same shape**: a post-solve loop that restarts
the tool with a different `argv.model` each time. Modeling it on the existing
features means it inherits all of that machinery and stays consistent with the
codebase, instead of introducing a parallel restart implementation.

## 3. The "did the cheap model succeed?" signal

The decisive design question for any cascade is **when to escalate**. The
literature notes self-reported confidence scores are poorly calibrated, and that
deciding "is this task hard enough" up front is non-trivial
(see [`existing-components.md`](./existing-components.md)).

We sidestep model-self-assessment entirely and reuse a **token-cheap, artifact-
based** signal that already exists in the repo: the deferred-work detector from
issue #1883 (`detectDeferredWorkInSources`). After the cheap session:

- **No deferred/unfinished-work indicators** in the PR description, the AI
  solution summary, or changed markdown ⇒ the cheap model is considered to have
  finished. **Escalation stops early** — the expensive tiers are never invoked.
- **Indicators remain** ⇒ escalate to the next tier and restart, passing the
  concrete detections into the feedback prompt so the bigger model knows what was
  left undone.

This keeps the escalation decision **free** (no extra model call), directly honors
the issue's "fast and cheap first" intent, and reuses a detector that is already
unit-tested and battle-tested by `--keep-working`.

> **Trade-off — recall vs. precision.** The detector is high-recall by design
> (issue #1883 explicitly chose to "ignore false positives for now"). For
> escalate this is the _safe_ bias: a false positive escalates one tier earlier
> than strictly necessary (slightly more cost), whereas a false negative would
> stop on a half-finished task (worse). Erring toward escalation matches the
> issue author's stated preference to keep going until "everything is totally
> done".

## 4. Range-parsing ambiguity and how it was resolved

`-` is both the range delimiter (`sonnet-opus`) **and** a character inside model
aliases (`opus-4-8`, `claude-fable-5`). Naively splitting `opus-4-8` on `-` would
yield nonsense bounds.

Resolution:

- **`--escalate <range>`** accepts only the four canonical short ladder names
  (`haiku|sonnet|opus|fable`) on either side of a single `-`. `opus-4-8` is
  therefore rejected as a range (with a helpful error), removing the ambiguity.
- **`--escalate-from <model>`** takes a **single** value, so there is no delimiter
  ambiguity; it accepts aliases (`opus-4-8`, `claude-opus-4-8`, …) via
  `canonicalTier`.

Additional validation: a reversed range (`fable-sonnet`, lower more capable than
upper) is rejected, and `--escalate-steps` must be a positive integer. All of
this is validated **eagerly at config time** (`resolveEscalationConfig` is called
from the normalization block) so misuse fails fast with a clear message rather
than mid-solve after tokens have been spent.

## 5. Ordering relative to finalize / keep-working

`runEscalation` runs **before** `--finalize` and `--keep-working` in `solve.mjs`.
Rationale: escalate is the model-progression loop that brings the solution up to
its final quality tier; finalize / keep-working are orthogonal post-processing
passes that should operate on the **escalated (top-tier) result**, not on the
cheap first draft. Each loop is independently opt-in, so enabling escalate alone
changes nothing about the others.

## 6. Guards and safety

- **No recursion.** Each escalation restart sets `escalate: undefined` and
  `escalateFrom: undefined` in the per-iteration `argv`, so the restarted tool
  does not re-enter the escalate loop.
- **Claude-only.** The ladder names are Claude tiers. For any other `--tool`,
  `runEscalation` logs a notice and returns `null` (no-op). The config-time model
  override is likewise gated on `tool === 'claude'`.
- **Consecutive-error cap.** Like keep-working, the loop stops after
  `MAX_CONSECUTIVE_ERRORS = 3` consecutive API errors and on a usage-limit hit, so
  a broken environment cannot spin the ladder forever.
- **PR required.** With no `prNumber` there is nothing to evaluate or restart on,
  so the loop is a no-op.
- **Index clamping.** `resolveEscalationModel` clamps out-of-range indices to the
  last (most capable) tier, so the loop can never index past the ladder.

## 7. Testability

All parsing/planning logic is **pure and network-free**, isolated above the
orchestrator in `src/solve.escalate.lib.mjs`. The orchestrator lazily imports its
heavy dependencies (command-stream, the network bootstrap, the restart shared lib)
**inside** `runEscalation`, so importing the module for its helpers — as the tests
and `src/solve.config.lib.mjs` do — triggers no network access. This is what lets
`tests/test-escalate-1885.mjs` run in the token-free default suite.
