# Issue 2038 Case Study: `--think off` Must Be Really Off (or Adaptive), Plus Missing Levels and Ranges

## Summary

Issue 2038 asks hive-mind to make the "no thinking" contract honest and complete
across the whole codebase. Concretely: the synonyms `--think disable`,
`--think disabled`, `--think no`, `--think none`, and `--think off` (and an
omitted `--think`) must all mean the same thing and must actually turn thinking
off — using the provider's structural off control where one exists, and falling
back to _adaptive_ thinking only when a model physically cannot disable thinking.
It also asks for the missing effort tiers (`minimal`, and any other gaps) to be
added and mapped consistently across Claude and Codex; for a new
`--think adaptive` value that means "adaptive-only" and must fail immediately for
`solve`/`hive` on any model that does not support adaptive thinking; and for
fine-grained numeric ranges (`0%`..`100%`, `0.0`..`1.0`, and the shorthands `0`
and `1`) so a user can dial precision. Finally it asks that research data be
collected here, that debug/verbose output be added if the root cause is unclear,
that upstream issues be filed where applicable, and that the fix be applied to
_every_ place in the codebase, not just one.

The core problem is a vocabulary and capability mismatch. The current `--think`
option is a fixed enum (`off/low/medium/high/xhigh/ultra/max`) with `off` as the
default. There is no `minimal`, no synonyms for `off`, no `adaptive` value, and
no numeric/percentage parsing. `off` is already handled well for Codex
(`none`) and reasonably for Claude (zero budget, or lowest effort on
adaptive-only models, per issue 2032), but the concept of "off is impossible, so
use adaptive" is only implicitly present, and there is no first-class `adaptive`
request that can be validated per model. The upstream research (recorded in
`data/upstream-source-notes.md`) confirms the exact capability map: OpenAI has a
real `none` and a model-dependent `minimal`; Anthropic has no `none`/`minimal`
effort at all, disables thinking via `thinking:{type:"disabled"}` on most models,
but cannot disable it on Fable 5, Mythos 5, or Mythos Preview — those three are
adaptive-only.

## Requirements

Enumerated from the full issue body (`data/issue-2038.json`):

- R1: Treat `--think disable`, `--think disabled`, `--think no`, `--think none`,
  and `--think off` as **synonyms**, and make them actually turn thinking off.
- R2: Where turning thinking off is impossible for a model, interpret the off
  synonyms as **adaptive** thinking (best-effort minimum) instead of failing.
- R3: Add `minimal` and any other missing effort levels, and map them
  consistently **across both Claude and Codex**.
- R4: Add a first-class `--think adaptive` value meaning **adaptive-only**; for
  `solve`/`hive` it must **fail immediately** for every model that does not
  support adaptive thinking.
- R5: An omitted `--think` must be treated as `--think off` (i.e. part of the
  off synonym set) — consistent with issue 2032.
- R6: Support numeric ranges: percentage `--think 0%` (none) .. `--think 100%`
  (max); fraction `--think 0.0` (none) .. `--think 1.0` (max); and the integer
  shorthands `0` and `1`. This lets a user configure thinking with precision.
- R7: Collect all issue logs/data into `docs/case-studies/issue-2038/`, research
  additional facts online, and produce a deep case study: timeline, full
  requirement list, per-problem root cause, and proposed solutions/plans, while
  checking for existing reusable components/libraries.
- R8: If there is not enough data to find a root cause, add debug output and a
  verbose mode (if not already present) so the next iteration can find it.
- R9: If the issue relates to another repository/project where issues can be
  filed, report it there with reproducible examples, workarounds, and code-level
  fix suggestions.
- R10: Fully apply the requirements across the **entire codebase** — if the same
  problem exists in multiple places, fix all of them.
- R11: Plan and execute everything in a single pull request (PR 2039).

## Timeline / Sequence of Events

- Issue #1238 / #1620: introduced the effort-level model and the
  thinking-budget-to-effort mapping (`CLAUDE_CODE_EFFORT_LEVEL`, budget → level).
  Established `low/medium/high/xhigh/max` and the `off` = zero-budget baseline.
- Issue #1875 / #2003: recognized adaptive-thinking-only models (Sonnet 5,
  Fable 5, Mythos 5), which reject a manual/zero thinking budget. `getClaudeEnv`
  learned to skip `MAX_THINKING_TOKENS` for these models.
- Issue #2027: made `gpt-5.6-sol` the Codex default and introduced the
  predictable identity mapping `--think` → Codex reasoning effort, adding
  `ultra`/`max`. Recorded in `docs/case-studies/issue-2027/`.
- Issue #2032: normalized an omitted `--think` to `off` across all tools and
  defined the "best-effort off" behavior — Codex `none`, Claude zero budget, or
  the lowest adaptive effort (`low`) for adaptive-only models. Recorded in
  `docs/case-studies/issue-2032/`.
- **2026-07-10 19:34 UTC — Issue #2038 opened** by konard (labels: bug,
  documentation, enhancement). Extends 2032/2027: off synonyms, `minimal`,
  `adaptive`, and numeric ranges, with a wide model matrix.
- 2026-07-10 20:42 UTC — PR #2039 opened ([WIP]) to implement the solution.
- No comments on the issue at research time (`data/issue-2038-comments.json` is
  an empty array).

## Root Cause Analysis (per problem)

### P1 — Off synonyms not recognized (R1)

`SOLVE_OPTION_DEFINITIONS.think` in `src/solve.config.lib.mjs` uses a fixed yargs
`choices` list `['off','low','medium','high','xhigh','ultra','max']`. Any value
outside it (`disable`, `disabled`, `no`, `none`) is rejected by yargs before the
code ever runs. Root cause: no normalization/aliasing step that collapses the
synonym set to a single canonical `off` before validation.

### P2 — "Off impossible → adaptive" is only implicit (R2)

`getClaudeEnv` in `src/config.lib.mjs` already special-cases adaptive-only models
for `think: 'off'` (issue 2032: it emits the lowest effort `low` rather than a
rejected zero budget). But this is a hidden, Claude-env-only behavior. There is
no explicit `think === 'adaptive'` resolution and no model-capability predicate
named around "can disable thinking". Root cause: the adaptive fallback is an
implementation detail of one function, not a first-class resolved state, so it is
easy to diverge in other execution paths (Codex, prompt gating, agent/opencode).

### P3 — `minimal` and other levels missing / inconsistent (R3)

`THINK_LEVEL_TO_CODEX_REASONING` in `src/codex.options.lib.mjs` has no `minimal`
key even though `resolveCodexReasoningEffort` already emits `minimal` for small
`--thinking-budget` ratios (`ratio <= 0.2`). So `minimal` is reachable via budget
but not via `--think minimal`. On the Claude side, `thinkLevelToEffortLevel`
(`src/config.lib.mjs`) has no `minimal` at all, and Anthropic has no `minimal`
effort level (see `data/upstream-source-notes.md`), so a mapping decision is
needed (`minimal` → Claude `low`/small budget). Root cause: the `--think`
vocabulary was never reconciled with the finer OpenAI ladder that already leaks
through the budget path.

### P4 — No `adaptive` value, no fail-fast validation (R4)

There is no `adaptive` choice, and nothing validates a requested adaptive mode
against the selected model. Models that cannot do adaptive thinking (Opus 4.5 /
Sonnet 4.5 and older per the docs) would silently do the wrong thing. Root cause:
`--think` is a pure hint with no per-model capability gate; `solve`/`hive` never
reject an unsupported thinking request.

### P5 — Omitted `--think` (R5)

Already resolved by issue 2032: `default: 'off'`. This case study only needs to
ensure the omitted default remains inside the (now larger) off synonym set and is
not broken by the new parsing.

### P6 — No numeric/percentage ranges (R6)

`--think` is `type: 'string'` with `choices`, so `0%`, `100%`, `0.0`, `1.0`, `0`,
`1` are all rejected. There is no `coerce` step to translate a numeric ratio into
a level. Root cause: parsing is enum-only; there is no ratio-to-level quantizer on
the `--think` option (one exists internally for `--thinking-budget`, but it is not
exposed to `--think`).

### P7 — Multiple places / debug visibility (R8, R10)

The thinking resolution is spread across at least: `src/solve.config.lib.mjs`
(option def), `src/codex.options.lib.mjs` (`resolveCodexReasoningEffort`),
`src/config.lib.mjs` (`thinkLevelToEffortLevel`, `getClaudeEnv`,
`thinkingBudgetToEffortLevel`, model predicates), `src/thinking-prompt.lib.mjs`
(prompt gating), and `src/claude.lib.mjs` (call site). A change to the vocabulary
must touch every one. There is no single debug line that prints the resolved
`{think, effort, budget, source, model, adaptive}` decision, which is why root
cause per model is hard to confirm — hence R8.

## Existing Reusable Components / Libraries

- `src/config.lib.mjs`
  - `thinkLevelToEffortLevel(thinkLevel, options)` — the canonical level → Claude
    effort mapper. The natural home for a new `minimal` case and for the
    `off`/`adaptive` distinction.
  - `thinkingBudgetToEffortLevel` and `getTokensToThinkingLevel` — an existing
    ratio/threshold quantizer that R6's numeric ranges can reuse instead of a new
    one.
  - `getClaudeEnv` and the model predicates `isOpus47OrLater`,
    `isFable5OrMythos5`, `isSonnet5`, `supportsEffortLevel`,
    `supportsXHighEffortLevel`, `supportsMaxEffortLevel` — already encode most of
    the capability matrix; a "can disable thinking" / "adaptive-only" predicate
    should be derived here (Fable 5, Mythos 5, Mythos Preview = adaptive-only).
  - The issue 2032 branch (`thinkLevel === 'off' && adaptiveThinkingOnly` → lowest
    effort) is exactly the R2 behavior to generalize.
- `src/codex.options.lib.mjs`
  - `resolveCodexReasoningEffort(argv)` — the single source of truth for Codex
    effort. Already emits `none` for off and `minimal` for small budgets; add a
    `minimal` key to `THINK_LEVEL_TO_CODEX_REASONING`.
- `src/thinking-prompt.lib.mjs`
  - `THINK_PROMPT_MESSAGES` and `shouldAddThinkingPromptInstruction` — prompt
    gating that must learn the new `minimal`/`adaptive` values (and must NOT emit
    a positive "think" prompt for off/adaptive).
- `src/solve.config.lib.mjs`
  - `SOLVE_OPTION_DEFINITIONS.think` — the yargs option. yargs
    [`coerce`](https://yargs.js.org/docs/#api-reference-coercekey-fn) is the
    idiomatic way to normalize synonyms and numeric/percentage inputs into a
    canonical value _before_ validation, replacing or augmenting `choices`. This
    avoids a bespoke parser.
- Prior case studies `docs/case-studies/issue-2032/` and
  `docs/case-studies/issue-2027/` — the established format, and the tests
  (`tests/test-issue-2032-default-think-off.mjs`, `tests/test-codex-support.mjs`,
  `tests/test-claude-think-prompt-gating.mjs`) to extend.

No new external dependency is required. The change is vocabulary normalization,
one capability predicate, and reuse of the existing quantizer.

## Requirement-to-Solution Plan

| Requirement | Solution                                                                                                                                                                                                           | Verification                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| R1          | Add a yargs `coerce` on `--think` that lowercases and maps `{disable, disabled, no, none, off}` → canonical `off`; keep `choices` validation _after_ coercion (or validate inside coerce).                         | Parse each synonym and assert `think === 'off'`.                                                    |
| R2          | Introduce a `thinkingDisableSupported(model)` predicate (false for Fable 5, Mythos 5, Mythos Preview). When `off` is requested on such a model, resolve to `adaptive` with lowest effort (`low`).                  | Assert Fable 5 + `off` → adaptive/`low`; Opus 4.8 + `off` → real off (no effort, adaptive off).     |
| R3          | Add `minimal` to the shared choices; map Codex `minimal`→`minimal`, Claude `minimal`→ lowest effort `low` (Anthropic has no `minimal` effort). Reuse `THINK_LEVEL_TO_CODEX_REASONING` + `thinkLevelToEffortLevel`. | Assert `--think minimal` → Codex `minimal`, Claude effort `low`.                                    |
| R4          | Add `adaptive` choice; add `adaptiveThinkingSupported(model)` predicate; in `solve`/`hive` argument validation, throw a clear error immediately when `--think adaptive` targets a non-adaptive model.              | Assert `--think adaptive` on Opus 4.5 fails fast with a descriptive error; on Opus 4.8 it succeeds. |
| R5          | Keep `default: 'off'` (issue 2032) and ensure the coerce treats the default as part of the synonym set.                                                                                                            | Assert omitted `--think` → `off`.                                                                   |
| R6          | Extend the `coerce` to accept `NN%`, `0.0`–`1.0`, and `0`/`1`; quantize the ratio to a level via the existing threshold quantizer (`0`→off, `1`/`100%`→max, intermediate → nearest level incl. `minimal`).         | Assert `0%`/`0.0`/`0`→off, `100%`/`1.0`/`1`→max, `0.5`→medium (or documented boundary).             |
| R7          | This directory: `data/` raw JSON + upstream notes, and this README with timeline, requirements, root causes, reusable components, plan, alternatives.                                                              | Repository review.                                                                                  |
| R8          | Add a single debug/verbose log line emitting the resolved decision object `{think, source, model, effort, budget, adaptive}` behind the existing verbose flag.                                                     | Run with `--verbose` and confirm the resolved thinking decision is printed.                         |
| R9          | If a defect is found in Codex CLI / Claude Code (not just hive-mind mapping), file an upstream issue with a reproducible example; otherwise record in notes that the gap is hive-mind-side only.                   | Linked upstream issue or a recorded "no upstream defect" note.                                      |
| R10         | Apply the vocabulary/predicate changes in every place: option def, Codex resolver, Claude effort/env, prompt gating, and the `solve`/`hive` validation and call sites.                                             | Grep for `THINK_` / `think` handlers; each covered by a regression test.                            |
| R11         | Deliver in PR #2039 with tests, changeset, and this case study.                                                                                                                                                    | PR review + CI.                                                                                     |

## Alternatives Considered

- **Keep `choices` and reject synonyms/numbers.** Rejected: R1 and R6 explicitly
  require synonyms and numeric ranges; a hard enum cannot express them.
- **Write a bespoke `--think` parser.** Rejected: yargs `coerce` already runs
  before validation and is the idiomatic hook; the numeric-to-level quantizer
  already exists (`getTokensToThinkingLevel` / `thinkingBudgetToEffortLevel`).
- **Map `off` to `low` effort for _all_ Claude models (never a true off).**
  Rejected: most Claude models (Opus 4.5–4.8, Sonnet 4.6/5) can truly disable
  thinking; forcing `low` would spend tokens unnecessarily and contradict R1. The
  lowest-effort fallback must be limited to the genuinely adaptive-only models
  (Fable 5, Mythos 5, Mythos Preview).
- **Treat `--think adaptive` as a soft hint (silently ignore on unsupported
  models).** Rejected: R4 requires an immediate hard failure for `solve`/`hive`
  so users get a clear signal rather than silent, wrong behavior.
- **Add a Claude `minimal`/`none` effort level.** Rejected: the Anthropic effort
  API has no `minimal`/`none` (see `data/upstream-source-notes.md`); the only
  faithful mapping is Codex `minimal` ↔ Claude `low` (or a very small budget).
- **Map percentages linearly to token budgets instead of levels.** Rejected:
  `--think` is a level abstraction shared across two providers with different
  ladders; quantizing to the shared level set keeps behavior predictable and
  reuses the existing mapping, while `0%`/`100%` still pin to off/max exactly.

## Source Data

- `data/issue-2038.json` — issue metadata and full body.
- `data/issue-2038-comments.json` — issue comments (empty at research time).
- `data/pr-2039.json` — the implementing pull request metadata.
- `data/upstream-source-notes.md` — OpenAI reasoning + Anthropic adaptive/effort
  findings, the consolidated model support matrix, and cited URLs.
  </content>
