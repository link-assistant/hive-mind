# Proposed solutions & future work — Issue #1877

This file records the solution that shipped, the alternatives considered, and
follow-up ideas, so a future session (or the other tool) can continue.

## Shipped solution (PR #1878)

A real, tool-agnostic **Agent Skill** (the open `SKILL.md` standard both tools
support natively), built from one shared source (`src/handoff.prompts.lib.mjs`)
and deployed by `src/handoff-skill.lib.mjs` into `.claude/skills/handoff/` (Claude)
and `.agents/skills/handoff/` (Codex), gated by `--use-handoff` (default off). A
minimal activation nudge is appended to both system prompts so the read-first
behavior fires reliably. The AI reads `HANDOFF.md` (repo root) first when present
and keeps it updated and committed to the PR branch, so any later session —
including one driven by the other tool — can continue from the recorded "Next
steps". The deployed `SKILL.md` is git-excluded so it never appears in the PR.

> **Why a native skill, not our own prompt?** This replaced an earlier draft that
> injected the full procedure as a bespoke sub-prompt. The maintainer asked why we
> add our own prompt instead of using a skill, and whether skills are supported by
> Codex and Claude. They are: the Agent Skills standard (agentskills.io) is loaded
> natively by both tools, so the skill is the right primitive. See
> [ANALYSIS.md](./ANALYSIS.md) §3.

## Alternatives considered

1. **Temp-dir handoff (the public default).** Rejected: Hive Mind sessions run in
   ephemeral temp dirs cloned from the branch, so a `/tmp` handoff does not survive
   to the next session or reach a different tool. The branch is the only durable
   channel. (See [ANALYSIS.md](./ANALYSIS.md) §2.)
2. **Per-session handoff chain (`handoff-1.md → handoff-2.md`).** Deferred: adds
   ambiguity ("which is current?") and clutter on the branch. We keep **one active
   `HANDOFF.md` per branch**. A chain/archive could be added later (see below).
3. **Bespoke sub-prompt (the first draft).** Replaced after maintainer feedback:
   injecting our own HANDOFF.md prompt ignores that both tools support the Agent
   Skills standard natively. We now ship a real `SKILL.md` instead, keeping only a
   minimal lifecycle nudge in the prompt. (See [ANALYSIS.md](./ANALYSIS.md) §3.)
4. **Reuse an external skill library (session-handoff/handover).** Rejected as a
   dependency: those target Claude-specific loaders / `.claude/handoffs/` temp
   storage / an SDK runtime — none match Hive Mind's branch-committed, cross-tool
   model. We author our own canonical `SKILL.md` (no new dependency), reusing the
   in-repo `agents-md-claude-support` deploy-around-execution pattern.
5. **Hard-coded automation (solve writes HANDOFF.md itself).** Deferred: the
   skill-driven approach keeps the content meaningful (the model knows the state)
   and matches the native skill mechanism. A deterministic scaffold could
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
- **Extend to other tools.** The canonical `SKILL.md` is tool-neutral; adding
  another tool's skill directory to `HANDOFF_SKILL_DIRS` (and the nudge) wires it
  into `gemini`/`qwen`/`opencode`/`agent` if desired (issue scope was Claude +
  Codex).
- **Secret-scanning guard.** Pair with the existing output-sanitization layer to
  scan `HANDOFF.md` for accidental secrets before commit.
- **Docs.** `--use-handoff` is already documented in `docs/CONFIGURATION.md` (and
  translations); promote it in the feature matrix once it graduates from
  experimental.

## Definition of done for the experiment graduating

- Real-world runs show Claude→Codex (and Codex→Claude) continuation reducing
  re-discovery on multi-session PRs.
- No secret leakage observed in committed `HANDOFF.md` files.
- Positive signal → flip docs to "stable", consider enabling by default behind a
  separate decision.
