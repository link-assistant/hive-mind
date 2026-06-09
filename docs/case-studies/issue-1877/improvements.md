# Proposed solutions & future work — Issue #1877

This file records the solution that shipped, the alternatives considered, and
follow-up ideas, so a future session (or the other tool) can continue.

## Shipped solution (PR #1878)

A shared, tool-agnostic **handoff skill** sub-prompt
(`src/handoff.prompts.lib.mjs`) gated by `--use-handoff` (default off) and
appended verbatim to both the Claude and Codex system prompts. The AI reads
`HANDOFF.md` (repo root) first when present and keeps it updated and committed to
the PR branch, so any later session — including one driven by the other tool —
can continue from the recorded "Next steps".

## Alternatives considered

1. **Temp-dir handoff (the public default).** Rejected: Hive Mind sessions run in
   ephemeral temp dirs cloned from the branch, so a `/tmp` handoff does not survive
   to the next session or reach a different tool. The branch is the only durable
   channel. (See [ANALYSIS.md](./ANALYSIS.md) §2.)
2. **Per-session handoff chain (`handoff-1.md → handoff-2.md`).** Deferred: adds
   ambiguity ("which is current?") and clutter on the branch. We keep **one active
   `HANDOFF.md` per branch**. A chain/archive could be added later (see below).
3. **Reuse an external skill library (session-handoff/handover).** Rejected as a
   dependency: those target CLAUDE-specific loaders / `.claude/handoffs/` temp
   storage / an SDK runtime — none match Hive Mind's model. We instead reused the
   in-repo `architecture-care` sub-prompt pattern (no new dependency).
4. **Hard-coded automation (solve writes HANDOFF.md itself).** Deferred: the
   prompt-driven approach keeps the content meaningful (the model knows the state)
   and matches existing sub-prompt features. A deterministic scaffold could
   complement it later.

## Future work (not required by the issue)

- **Auto-scaffold + auto-commit.** Optionally have `solve` pre-create a
  `HANDOFF.md` skeleton and ensure it is committed at session end, independent of
  model compliance.
- **Handoff validation.** A lightweight check (like the external skill's
  "validation score") to warn when required sections are missing or contain
  `[TODO]` placeholders.
- **Staleness / chain.** Optional `HANDOFF.md` archival to `docs/handoffs/` with a
  predecessor link when a PR spans many sessions.
- **Extend to other tools.** `getHandoffSubPrompt` is tool-neutral; wiring it into
  `gemini`/`qwen`/`opencode`/`agent` prompt builders is a one-line change each if
  desired (issue scope was Claude + Codex).
- **Secret-scanning guard.** Pair with the existing output-sanitization layer to
  scan `HANDOFF.md` for accidental secrets before commit.
- **Docs.** Add a short `--use-handoff` entry to `docs/CONFIGURATION.md` and the
  feature matrix once the experiment graduates from experimental.

## Definition of done for the experiment graduating

- Real-world runs show Claude→Codex (and Codex→Claude) continuation reducing
  re-discovery on multi-session PRs.
- No secret leakage observed in committed `HANDOFF.md` files.
- Positive signal → flip docs to "stable", consider enabling by default behind a
  separate decision.
