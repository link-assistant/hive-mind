# Requirements — Issue #1877

Every requirement extracted from the issue text, each with a proposed solution
and its resolution in PR #1878.

> Issue text (verbatim):
> "We should find best practices and standards about this file, and integrate
> support for for both codex, claude, ideally in the same way, using same skill,
> so they can continue work of each other in single pull request. That should be
> supported as `--use-handoff` (experimental option, disabled by default). We
> need to collect data related about the issue to this repository, make sure we
> compile that data to `./docs/case-studies/issue-{id}` folder, and use it to do
> deep case study analysis (also make sure to search online for additional facts
> and data), list of each and all requirements from the issue, and propose
> possible solutions and solution plans for each requirement (we should also
> check known existing components/libraries, that solve similar problem or can
> help in solutions). Please plan and execute everything in this single pull
> request..."

---

## Functional requirements

### R1 — Find best practices and standards about the handoff file

- **Solution plan:** Search online for the HANDOFF.md / session-handoff
  convention; capture sources and distilled best practices.
- **Resolution:** ✅ [external/research-notes.md](./external/research-notes.md).
  Distilled into the skill's section list and rules.

### R2 — Integrate support for **both** Codex and Claude

- **Solution plan:** Add the handoff instructions to both the Claude and Codex
  system-prompt builders.
- **Resolution:** ✅ `getHandoffSubPrompt(argv)` appended in
  `src/claude.prompts.lib.mjs` and `src/codex.prompts.lib.mjs`.

### R3 — Do it **in the same way, using the same skill**

- **Solution plan:** Factor the instructions into one shared module so both tools
  receive byte-identical text (a single "skill"), instead of duplicating prose.
- **Resolution:** ✅ `src/handoff.prompts.lib.mjs` is the single source. The test
  `tests/handoff-prompt.test.mjs` asserts both prompts embed the canonical text
  verbatim.

### R4 — So they can **continue each other's work in a single pull request**

- **Solution plan:** Persist the handoff state where both tools can read it across
  ephemeral sessions — i.e. committed to the PR branch (the only durable channel,
  since each session clones a fresh temp dir). One active file per branch.
- **Resolution:** ✅ The skill instructs the AI to commit `HANDOFF.md` to the branch
  alongside related changes, read it first on start, and keep exactly one per
  branch. See [ANALYSIS.md](./ANALYSIS.md) §"Why commit to the branch".

### R5 — Expose as `--use-handoff` (experimental, **disabled by default**)

- **Solution plan:** Register a boolean option `use-handoff` with `default: false`,
  marked `[EXPERIMENTAL]`.
- **Resolution:** ✅ `src/solve.config.lib.mjs` (`SOLVE_OPTION_DEFINITIONS`).
  Auto-registered + auto-forwarded by hive via `SOLVE_OPTION_DEFINITIONS`. Added to
  `src/option-suggestions.lib.mjs` for typo suggestions.

## Process / deliverable requirements

### R6 — Collect issue data into `./docs/case-studies/issue-1877/`

- **Resolution:** ✅ This folder: `README.md`, `REQUIREMENTS.md`, `ANALYSIS.md`,
  `improvements.md`, `external/research-notes.md`, and `data/issue-1877.md`.

### R7 — Deep case-study analysis, **including online search**

- **Resolution:** ✅ [ANALYSIS.md](./ANALYSIS.md) (design + Hive Mind fit) and
  [external/research-notes.md](./external/research-notes.md) (sourced online
  research with links).

### R8 — List **each and all** requirements from the issue

- **Resolution:** ✅ This document (R1–R11).

### R9 — Propose possible solutions and solution plans **for each requirement**

- **Resolution:** ✅ Each R-item above carries a "Solution plan". Alternatives and
  future options are in [improvements.md](./improvements.md).

### R10 — Check known existing components/libraries that solve a similar problem

- **Resolution:** ✅ [external/research-notes.md](./external/research-notes.md)
  §"Prior art & reusable components" (session-handoff skills, handoff templates,
  OpenAI Agents SDK handoffs) and the in-repo reuse of the architecture-care
  sub-prompt pattern.

### R11 — Plan and execute everything in **this single pull request**

- **Resolution:** ✅ Implementation, tests, docs, and changeset all in PR #1878.

---

## Acceptance checklist

- [x] `--use-handoff` parses for `solve` and is forwarded by `hive`.
- [x] Default is `false`; no behavior change unless explicitly enabled.
- [x] Claude and Codex prompts include identical handoff skill text when enabled.
- [x] Skill teaches: read-first, single active file per branch, commit to branch,
      tool-agnostic pointers, required sections, no secrets, completion marker.
- [x] Automated test (`tests/handoff-prompt.test.mjs`) passes (24 assertions).
- [x] `npm run lint` and prettier pass.
- [x] Case study compiled in `docs/case-studies/issue-1877/`.
- [x] Changeset added for the next release.
