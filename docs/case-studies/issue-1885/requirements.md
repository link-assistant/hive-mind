# Requirements — Issue #1885

Every requirement extracted from the issue body, numbered, with the exact place
it is satisfied in this pull request. "✅ Done" means implemented and covered by
a test; "✅ Done (no test practical)" means implemented but exercised only
through orchestration that requires the network / a live tool.

| #   | Requirement (paraphrased from the issue)                                                                                                                                                                    | Status              | Where satisfied                                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Provide `--escalate-from haiku` / `--escalate-from sonnet`: start solving with a cheaper model, and on failure restart with the **next tier up** (not the same tier).                                       | ✅ Done             | `--escalate-from` option + `parseEscalateFrom` (→ `<model>-fable`) + `runEscalation` restart loop.                                                                                     |
| R2  | The ladder is **haiku → sonnet → opus → fable** (cheapest → most capable), and escalation climbs it one tier at a time.                                                                                     | ✅ Done             | `MODEL_ESCALATION_ORDER`; `buildEscalationPlan` slices the ladder; `resolveEscalationModel` indexes it.                                                                                |
| R3  | The intent: iterate cheaply first so expensive models **read more and write less** (small models often get it "mostly right but not quite right").                                                          | ✅ Done (by design) | The first regular session runs on the lower bound; restarts only happen while unfinished-work indicators remain. See [`analysis.md`](./analysis.md).                                   |
| R4  | Support an **upper bound**: `--escalate sonnet-opus`, where `-` delimits the lower and upper bound.                                                                                                         | ✅ Done             | `parseEscalateRange` splits on `-`; validates both bounds are ladder names and lower ≤ upper.                                                                                          |
| R5  | A bare `--escalate` defaults to `--escalate sonnet-fable`.                                                                                                                                                  | ✅ Done             | `DEFAULT_ESCALATE_RANGE = 'sonnet-fable'`; config normalizes bare flag to it. Test: bare flag → `sonnet-fable` plan `[sonnet,opus,fable]`.                                             |
| R6  | Support `--escalate-steps` (default **1**): keep each tier for N working sessions before escalating.                                                                                                        | ✅ Done             | `--escalate-steps` option; `normalizeEscalateSteps`; `buildEscalationPlan` repeats each tier `steps` times.                                                                            |
| R7  | Example: `--escalate-steps 2` ⇒ 2 sonnet sessions, then 2 opus, then 2 fable.                                                                                                                               | ✅ Done             | `buildEscalationPlan({from:'sonnet',to:'fable',steps:2})` → `[sonnet,sonnet,opus,opus,fable,fable]`. Unit-tested.                                                                      |
| R8  | The first solve session should actually **run on the cheap model** (not the default), so escalation starts from the bottom.                                                                                 | ✅ Done             | Config-time override: when escalate is enabled and `--model` not explicit, `argv.model` is set to the plan's lower bound. Test covers it.                                              |
| R9  | An explicit `--model` must still win (do not override a model the user pinned on purpose).                                                                                                                  | ✅ Done             | Override guarded by `!modelExplicitlyProvided`. Test: `--escalate --model opus` ⇒ `argv.model === 'opus'`.                                                                             |
| R10 | **Compile the case study** to `./docs/case-studies/issue-{id}` with deep analysis, **online research**, the full requirement list, and per-requirement solution plans; check existing components/libraries. | ✅ Done             | This folder: `README.md`, `requirements.md`, `analysis.md`, `existing-components.md`, `model-ladder.md`. Online sources cited in [`existing-components.md`](./existing-components.md). |
| R11 | Plan and execute everything **in this single pull request** (#1890).                                                                                                                                        | ✅ Done             | All changes shipped on branch `issue-1885-119016b37d3b` / PR #1890.                                                                                                                    |

## Per-requirement solution plan (as proposed and then executed)

### R1 — `--escalate-from`, restart on the next tier up

**Plan:** add a string option `--escalate-from <model>` that is sugar for a range
ending at the top of the ladder. The restart loop must move to the **next** tier
on each escalation, never repeat the failed tier (the whole point of the issue).
**Executed:** `parseEscalateFrom('haiku')` → `{from:'haiku', to:'fable'}`;
`runEscalation` walks `plan` from index 1 upward, so each restart uses a strictly
more capable model (subject to `--escalate-steps`, see R6).

### R2 — The model ladder

**Plan:** encode a single ordered list of canonical short tier names and derive
everything (plans, bounds checks, "next tier") from indices into it.
**Executed:** `MODEL_ESCALATION_ORDER = ['haiku','sonnet','opus','fable']`. These
map onto the existing `claudeModels` aliases in `src/models/index.mjs`
(`sonnet`→`claude-sonnet-4-6`, `opus`→`claude-opus-4-8`, `fable`→`claude-fable-5`,
`haiku`→`claude-haiku-4-5-...`), so escalate reuses the project's model resolution.

### R3 — Iterate cheaply first; expensive models read, not write

**Plan:** do **not** start on the expensive model. Run the normal solve on the
cheap tier, then escalate **only if** there is evidence the cheap model left work
unfinished. Use a token-cheap signal rather than a model call to decide.
**Executed:** the first session runs on the lower bound (R8). Before each
escalation, `runEscalation` re-scans the PR description, the AI solution summary,
and changed markdown for deferred-work indicators (the issue #1883 detector). No
indicators ⇒ **stop early**, the expensive models are never invoked. The
escalation feedback prompt explicitly tells the bigger model to "carefully review
what has already been done, then finish every remaining requirement", i.e. read
first, then refine.

### R4 — Upper bound via `<lower>-<upper>`

**Plan:** parse on `-`. To avoid ambiguity with dashed model aliases such as
`opus-4-8`, restrict the range form to the four canonical short ladder names.
**Executed:** `parseEscalateRange` accepts 1 part (single tier) or 2 parts
(lower/upper), each of which must be one of `haiku|sonnet|opus|fable`, and rejects
a reversed range (`fable-sonnet`). Aliases like `opus-4-8` are accepted by
`--escalate-from` (single value, unambiguous), just not inside a range.

### R5 — Default `sonnet-fable`

**Plan:** a bare flag (yargs yields `true`/empty string for a value-less string
option) must canonicalize to the documented default.
**Executed:** `DEFAULT_ESCALATE_RANGE = 'sonnet-fable'`; the config normalization
block sets `argv.escalate = 'sonnet-fable'` for the bare flag. Unit-tested via
`parseArguments`.

### R6 / R7 — `--escalate-steps`

**Plan:** a number option (default 1). The plan is the ladder slice with each tier
repeated `steps` times; the restart loop walks the plan, so "2 steps" naturally
yields two consecutive sessions per tier.
**Executed:** `normalizeEscalateSteps` (positive-integer validation, default 1);
`buildEscalationPlan` repeats tiers; `resolveEscalationModel` indexes the expanded
plan. `[sonnet,sonnet,opus,opus,fable,fable]` is unit-tested.

### R8 / R9 — Initial model override (and respecting explicit `--model`)

**Plan:** set the worker model to the plan's lower bound at config time, but only
when the user did not explicitly pin `--model`/`-m`/`--worker-model`.
**Executed:** in `src/solve.config.lib.mjs`, after default-model resolution and
guarded by `!modelExplicitlyProvided` (and `tool === 'claude'`), `argv.model` is
set to `escalationConfig.plan[0]`. Two tests cover both branches.

### R10 — Case study + online research

**Plan:** mirror the issue #1883 case-study structure; add an explicit survey of
external prior art (LLM cascades / model routing) with cited online sources.
**Executed:** this folder. See [`existing-components.md`](./existing-components.md)
for the literature survey and source links.

### R11 — Single pull request

**Plan / Executed:** everything shipped on `issue-1885-119016b37d3b` → PR #1890.
