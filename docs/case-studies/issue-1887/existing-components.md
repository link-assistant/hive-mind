# Existing components & prior art — Issue #1887

Per R5, this surveys the components already in this repo (and the wider ecosystem) that solve a
similar problem, so the fix reuses rather than reinvents.

## In-repo prior art

### 1. `buildAutoRestartInstructions()` — `src/solve.restart-shared.lib.mjs`

The single shared block of `When …` instructions appended to **every** auto-restart and watch
iteration, for **every** tool. It already encoded the project's `When x, do y.` convention and
covered "comply with all CI/CD check requirements, and they pass", "no uncommitted changes",
"resolve merge conflicts", etc. This is exactly the right seam for R1/R2 — the new fix-inherited /
loop-awareness / repo-scope lines were added here so one edit reaches all tools and both modes.

### 2. Per-tool `buildSystemPrompt()` — `src/{claude,codex,gemini,qwen,agent,opencode}.prompts.lib.mjs`

Six near-parallel builders, each emitting the long `When x, do y.` system-prompt guideline list
(the same list this very session runs under). They share the trailing anchor line
`When you face something extremely hard, use divide and conquer.` Prior art established the
duplication pattern; R8 ("fix in all places") is satisfied by adding the two new bullets to all
six at the same anchor.

### 3. The auto-restart / auto-merge loop — `src/solve.auto-merge.lib.mjs`

Already detects CI blockers, billing blockers, merge conflicts, uncommitted changes, and enforces
a **5-iteration safety limit** (the runaway-loop backstop). No change was needed here: the loop
behaved correctly; only the _prompt it feeds the model_ was deficient. Reusing the existing
blocker-detection + iteration cap means we did not need to build new convergence machinery.

### 4. Experimental `--prompt-*` flags (e.g. `--prompt-case-studies`, `--prompt-issue-reporting`)

Prior art for _opt-in_ prompt additions. Considered for the new guidance (Option D in
`solutions.md`) but rejected: the issue asks to change the **default** system prompt, and the
behavior that caused the loop is the default, so gating it behind a flag would not fix the
reported problem. The pattern is documented here so future, more aggressive behavior (e.g. a hard
gate) has an obvious home if it is ever wanted.

### 5. Existing prompt tests — `tests/test-*prompt*.mjs`

The repo already tests prompt construction by importing the builders and asserting on substrings.
`tests/test-issue-1887-ci-fix-prompt.mjs` follows that established style (plain Node `.mjs`,
auto-discovered by `scripts/run-tests.mjs`) rather than introducing a new framework.

## External / ecosystem prior art (R5 online check)

- **"Keep the main branch green" / not-rocket-science rule** (Graydon Hoare; bors, Homu, GitHub
  merge queues): the industry-standard principle that the default branch should always be in a
  passing state. R3's "keep the default branch in a clean, working state" wording is the
  prompt-level expression of the same principle, applied to an autonomous agent.
- **Agent loop convergence**: the failure mode here ("agent escalates to a human, but the harness
  loops with no human present") is a known autonomous-agent pitfall — a loop whose terminal state
  requires an actor that is not in the loop. The mitigation (tell the agent the loop exists, and
  bias it toward an action it _can_ take) is the conventional remedy and is what this fix applies.

## Conclusion

No new library or component was required. The fix reuses the existing shared-prompt seam
(`buildAutoRestartInstructions`), the existing six-builder system-prompt pattern, and the existing
iteration-capped restart loop. The only additions are prompt text (R1–R3), one test file, and this
case study (R4–R5).
