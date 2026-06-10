# Requirements — Issue #1883

Every requirement extracted from the issue body, numbered, with the exact place
it is satisfied in this pull request. "✅ Done" means implemented and covered by
a test; "✅ Done (no test practical)" means implemented but exercised only
through orchestration that requires the network / a live tool.

| #   | Requirement (paraphrased from the issue)                                                                                                                                                                         | Status              | Where satisfied                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Provide an **experimental** option `--keep-working-until-all-requirements-are-fully-done`.                                                                                                                       | ✅ Done             | `src/solve.config.lib.mjs` option definition; description prefixed `[EXPERIMENTAL]`.                                                          |
| R2  | After a run, **find anything unfinished / planned / delayed** in the PR description and changed content and **auto-restart** the AI on it.                                                                       | ✅ Done             | `detectDeferredWorkInSources` + `runKeepWorkingUntilDone` in `src/solve.keep-working*.mjs`.                                                   |
| R3  | Inject the **verbatim reinforcement prompt** ("Please plan and execute everything in this single pull request…") **in addition to the detected reason**.                                                         | ✅ Done             | `KEEP_WORKING_PROMPT` constant; appended by `buildKeepWorkingFeedback`.                                                                       |
| R4  | Use **regular expressions / partial parsing** to find strong indicators of delayed/deferred work.                                                                                                                | ✅ Done             | `DEFERRED_WORK_PATTERNS` (14 global, case-insensitive regexes) + `detectDeferredWork`.                                                        |
| R5  | To **avoid wasting tokens**, scan only three cheap sources: (a) PR description, (b) the AI solution summary comment, (c) **changed markdown documents**.                                                         | ✅ Done             | `collectDeferredWorkSources` — gathers PR body, in-memory `resultSummary`, and added lines of `*.md/*.markdown/*.mdx` from `pulls/{n}/files`. |
| R6  | **Ignore false positives for now** — bias toward continuing; the user wants the AI to keep going.                                                                                                                | ✅ Done (by design) | High-recall patterns; any match triggers a restart. Documented in [`analysis.md`](./analysis.md).                                             |
| R7  | **Limit to 5 auto-restarts by default** in case of errors.                                                                                                                                                       | ✅ Done             | `DEFAULT_KEEP_WORKING_LIMIT = 5`; bare flag normalizes to 5.                                                                                  |
| R8  | A bare `--keep-...` flag is treated as `--keep-... 5`.                                                                                                                                                           | ✅ Done             | Normalization in `src/solve.config.lib.mjs` (true/''/undefined → 5). Test: bare flag → 5.                                                     |
| R9  | Support an **explicit number** (e.g. `... 3`).                                                                                                                                                                   | ✅ Done             | `normalizeKeepWorkingLimit` floors finite values ≥1. Test: `=3` → 3.                                                                          |
| R10 | Support `forever`, `unlimited`, etc. to **remove the limit**.                                                                                                                                                    | ✅ Done             | `UNLIMITED_KEYWORDS` set + `isUnlimitedKeepWorking`; map to `Infinity`. Tests cover `forever`/`unlimited`/`0`.                                |
| R11 | Provide the **shorter alias** `--keep-going-until-all-requirements-are-fully-done` (and convenience aliases).                                                                                                    | ✅ Done             | yargs `alias: ['keep-going-until-all-requirements-are-fully-done','keep-working','keep-going']`.                                              |
| R12 | **Compile the case study** to `./docs/case-studies/issue-{id}` with deep analysis, online research, the full requirement list, and proposed solution plans per requirement; check existing components/libraries. | ✅ Done             | This folder: `README.md`, `requirements.md`, `analysis.md`, `existing-components.md`, `indicators.md`.                                        |
| R13 | Plan and execute everything **in this single pull request** (#1884).                                                                                                                                             | ✅ Done             | All changes shipped on branch `issue-1883-1a8c72928617` / PR #1884.                                                                           |

## Per-requirement solution plan (as proposed and then executed)

### R1 — Experimental flag

**Plan:** add one string-typed yargs option in the central option registry so it
inherits help text, typo-suggestion, and docs-sync machinery. Mark
`[EXPERIMENTAL]` in the description so users know stability is not guaranteed.
**Executed:** option added next to the related `--finalize` family.

### R2 — Detect-and-restart loop

**Plan:** mirror the existing `--finalize` (`runAutoEnsureRequirements`)
architecture: a post-solve orchestration entry point that loops, re-using
`executeToolIteration` for each restart. Stop when a scan finds nothing.
**Executed:** `runKeepWorkingUntilDone` collects sources → detects → restarts →
re-collects, breaking on a clean scan or the limit.

### R3 — Reinforcement prompt

**Plan:** store the prompt verbatim as a constant and always append it to the
machine-detected reasons, so the model gets both the _what_ (specific deferrals)
and the _mandate_ (finish it all here).
**Executed:** `KEEP_WORKING_PROMPT` + `buildKeepWorkingFeedback`.

### R4 — Regex indicators

**Plan:** a table of labelled global/case-insensitive regexes, each anchored so it
matches real deferral phrasing but **not** the reinforcement prompt itself
(otherwise the injected prompt would re-trigger forever).
**Executed:** `DEFERRED_WORK_PATTERNS`; self-match avoidance is unit-tested.

### R5 — Three cheap sources only

**Plan:** never call the model just to classify; read the PR body (one `gh api`
call), reuse the already-captured AI summary from memory, and pull only the
_added_ lines of changed markdown from the files endpoint.
**Executed:** `collectDeferredWorkSources` + `extractAddedLinesFromPatch`.

### R6 — Tolerate false positives

**Plan:** optimise for recall, not precision; a spurious extra restart is cheaper
than silently dropping real unfinished work, and the restart limit bounds the
cost.
**Executed:** any indicator match triggers a restart; documented as intentional.

### R7–R10 — Limit semantics

**Plan:** one normalization function turning the raw CLI value into either a
finite integer or `Infinity`, plus a formatter for display. Keep the parsing pure
and exhaustively unit-test every variant.
**Executed:** `normalizeKeepWorkingLimit` / `formatKeepWorkingLimit` /
`isUnlimitedKeepWorking`, 31 passing tests.

### R11 — Aliases

**Plan:** lean on yargs alias support so all spellings resolve to the same config
key and all appear in typo suggestions.
**Executed:** aliases registered; `KNOWN_OPTION_NAMES` updated.

### R12 — Case study

**Plan + executed:** this folder.

### R13 — Single PR

**Plan + executed:** everything on PR #1884.
