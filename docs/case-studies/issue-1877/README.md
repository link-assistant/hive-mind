# Case Study — Issue #1877: HANDOFF.md support

**Issue:** [link-assistant/hive-mind#1877](https://github.com/link-assistant/hive-mind/issues/1877) — _HANDOFF.md support_
**Pull request:** [#1878](https://github.com/link-assistant/hive-mind/pull/1878)
**Labels:** documentation, enhancement
**Status:** Implemented (experimental, disabled by default)

---

## 1. Executive summary

Issue #1877 asks Hive Mind to support a **`HANDOFF.md`** file so that AI tools
(specifically **Claude** and **Codex**) can _continue each other's work inside a
single pull request_, using the **same skill** and the **same protocol**, behind
an **experimental `--use-handoff` flag that is disabled by default**.

This case study:

- collects the issue data and the relevant facts (this folder),
- reconstructs the motivation and how it fits Hive Mind's architecture
  ([ANALYSIS.md](./ANALYSIS.md)),
- surveys external best practices and prior art for AI agent handoff files
  ([external/research-notes.md](./external/research-notes.md)),
- enumerates **every requirement** extracted from the issue with its resolution
  ([REQUIREMENTS.md](./REQUIREMENTS.md)),
- proposes solutions/plans per requirement and records future work
  ([improvements.md](./improvements.md)).

The shipped solution is a real, tool-agnostic **Agent Skill** — a `SKILL.md`
document following the [Agent Skills open standard](https://agentskills.io)
created by Anthropic — built by `src/handoff.prompts.lib.mjs` and deployed by
`src/handoff-skill.lib.mjs` into the session working directory for **both** tools
natively when `--use-handoff` is set: `.claude/skills/handoff/SKILL.md` for Claude
Code and `.agents/skills/handoff/SKILL.md` for Codex. The skill teaches the AI to
read `HANDOFF.md` first when present and to keep it updated with task, current
state, decisions, next steps, gotchas, and critical files. A minimal activation
nudge in the system prompt ensures the read-at-session-start behavior fires
reliably. Because every Hive Mind working session runs in an **ephemeral working
directory cloned fresh from the PR branch**, the handoff file is **committed to
the branch** — that is the only channel that survives between sessions and between
tools. The deployed `SKILL.md` itself is tooling (re-deployed each session) and is
kept out of the target repository via `.git/info/exclude`, so it never pollutes
the PR.

## 2. Problem statement

A long task in Hive Mind is rarely solved in one working session. Sessions stop
and restart for many reasons: usage-limit resets, auto-restart on uncommitted
changes, `--watch`/`--auto-merge` iterations, CI feedback loops, or the operator
switching tools (Claude MAX ↔ ChatGPT Pro/Codex) to use a second independent
budget (see README "Scale with Orchestration"). Each new session starts with a
**cold context**: it must re-discover what was already done, which decisions were
already made, and what remains.

Two concrete pains motivate a handoff file:

1. **Wasted context / re-discovery.** A fresh session re-reads the repo, re-derives
   the plan, and sometimes re-litigates decisions the previous session already
   settled — spending tokens and risking inconsistency.
2. **No cross-tool memory.** Claude Code and Codex keep their own private,
   tool-specific session state (Claude session IDs, Codex rollouts). Neither can
   read the other's session. So when Codex picks up a PR Claude started (or vice
   versa), there is currently **no shared, portable record** of the work-in-progress.

The portable, tool-neutral answer is a Markdown handoff document that lives with
the code on the PR branch.

## 3. Requirements (extracted from the issue)

The full, itemized list with acceptance status is in
[REQUIREMENTS.md](./REQUIREMENTS.md). In short:

| #   | Requirement                                                      | Status                                                                         |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| R1  | Research best practices/standards for a handoff file             | ✅ [external/research-notes.md](./external/research-notes.md)                  |
| R2  | Support HANDOFF.md for **both** Claude and Codex                 | ✅ native `SKILL.md` deployed for both tools + nudge in both prompt builders   |
| R3  | Use the **same skill / same way** for both tools                 | ✅ one canonical `SKILL.md` (Agent Skills standard), byte-identical per tool   |
| R4  | Enable tools to **continue each other's work in a single PR**    | ✅ file committed to branch = cross-tool memory                                |
| R5  | Expose as `--use-handoff`, **experimental, disabled by default** | ✅ `solve.config.lib.mjs`, `default: false`                                    |
| R6  | Compile issue data into `./docs/case-studies/issue-1877/`        | ✅ this folder                                                                 |
| R7  | Deep case-study analysis incl. **online research**               | ✅ [ANALYSIS.md](./ANALYSIS.md), [external/](./external/research-notes.md)     |
| R8  | List **each and all** requirements                               | ✅ [REQUIREMENTS.md](./REQUIREMENTS.md)                                        |
| R9  | Propose solutions/plans **per requirement**                      | ✅ [REQUIREMENTS.md](./REQUIREMENTS.md) + [improvements.md](./improvements.md) |
| R10 | Check existing components/libraries that help                    | ✅ [external/research-notes.md](./external/research-notes.md) §Prior art       |
| R11 | Plan and execute everything in **this single PR**                | ✅ PR #1878                                                                    |

## 4. Timeline

- **2026-06-09** — Issue #1877 opened by @konard (labels: documentation,
  enhancement). Automated draft PR #1878 created on branch
  `issue-1877-b1f51fdc5723`.
- **2026-06-09** — Research, design, implementation, tests, and this case study
  delivered in PR #1878.

## 5. Solution overview

| Piece                  | File                             | Role                                                                                          |
| ---------------------- | -------------------------------- | --------------------------------------------------------------------------------------------- |
| Skill builder (shared) | `src/handoff.prompts.lib.mjs`    | Builds the canonical `SKILL.md` (frontmatter + body) and the minimal activation nudge         |
| Skill deployment       | `src/handoff-skill.lib.mjs`      | Writes `SKILL.md` to `.claude/skills/handoff/` and `.agents/skills/handoff/`; git-excludes it |
| Claude wiring          | `src/claude.lib.mjs`             | Calls `deployHandoffSkill(...)` before running; nudge via `getHandoffSubPrompt(argv)`         |
| Codex wiring           | `src/codex.lib.mjs`              | Calls the same `deployHandoffSkill(...)`; nudge via the same `getHandoffSubPrompt(argv)`      |
| Option                 | `src/solve.config.lib.mjs`       | `--use-handoff` boolean, `default: false`, `[EXPERIMENTAL]`                                   |
| Suggestion list        | `src/option-suggestions.lib.mjs` | Typo suggestions include `use-handoff`                                                        |
| Hive forwarding        | _automatic_                      | `SOLVE_OPTION_DEFINITIONS` is auto-forwarded by `hive.mjs`                                    |
| Tests                  | `tests/handoff-prompt.test.mjs`  | 43 assertions: SKILL.md shape, deployment + git-exclude, gating, identical-text, registration |

See [ANALYSIS.md](./ANALYSIS.md) for the detailed design rationale (why commit to
the branch, why one file per branch, why tool-agnostic, security).

## 6. How to use

```bash
# Claude (default tool)
solve https://github.com/owner/repo/issues/123 --use-handoff

# Codex — same skill, same protocol
solve https://github.com/owner/repo/issues/123 --tool codex --use-handoff

# Hive forwards the flag to every worker automatically
hive https://github.com/owner/repo --use-handoff
```

When enabled, the AI reads `HANDOFF.md` (repo root) first if present, and keeps it
updated and committed as it works. A later session — possibly using the other
tool — reads it and continues from the recorded "Next steps".
