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

- **Solution plan:** Deploy a native Agent Skill (`SKILL.md`) into each tool's
  skill directory so both tools load the same skill, and add a minimal activation
  nudge to both system-prompt builders.
- **Resolution:** ✅ `deployHandoffSkill(...)` (in `src/handoff-skill.lib.mjs`)
  writes `SKILL.md` to `.claude/skills/handoff/` (Claude) and
  `.agents/skills/handoff/` (Codex); it is invoked from both `src/claude.lib.mjs`
  and `src/codex.lib.mjs`. The nudge `getHandoffSubPrompt(argv)` is appended in
  `src/claude.prompts.lib.mjs` and `src/codex.prompts.lib.mjs`.

### R3 — Do it **in the same way, using the same skill**

- **Solution plan:** Use a real **Agent Skill** (the open `SKILL.md` standard both
  tools support natively) built from one shared source, so both tools load a
  byte-identical skill — rather than each tool getting its own bespoke prompt.
- **Resolution:** ✅ `src/handoff.prompts.lib.mjs` is the single source for the
  canonical `SKILL.md`. The test `tests/handoff-prompt.test.mjs` asserts the two
  deployed `SKILL.md` files are byte-identical and equal the canonical builder
  output, and that both prompts embed the canonical nudge verbatim.

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
  §"Prior art & reusable components" (the Agent Skills open standard adopted here,
  session-handoff skills, handoff templates, OpenAI Agents SDK handoffs) and the
  in-repo reuse of the `agents-md-claude-support` deploy-around-execution pattern.

### R11 — Plan and execute everything in **this single pull request**

- **Resolution:** ✅ Implementation, tests, docs, and changeset all in PR #1878.

---

## Acceptance checklist

- [x] `--use-handoff` parses for `solve` and is forwarded by `hive`.
- [x] Default is `false`; no behavior change unless explicitly enabled.
- [x] A byte-identical native `SKILL.md` is deployed for Claude
      (`.claude/skills/handoff/`) and Codex (`.agents/skills/handoff/`); both
      prompts include the identical activation nudge when enabled.
- [x] The deployed `SKILL.md` is git-excluded (never appears in the PR), while
      `HANDOFF.md` itself is committed to the branch.
- [x] Skill teaches: read-first, single active file per branch, commit to branch,
      tool-agnostic pointers, required sections, no secrets, completion marker.
- [x] Automated test (`tests/handoff-prompt.test.mjs`) passes (43 assertions).
- [x] `npm run lint` and prettier pass.
- [x] Case study compiled in `docs/case-studies/issue-1877/`.
- [x] Changeset added for the next release.
