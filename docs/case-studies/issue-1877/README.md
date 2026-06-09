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

The shipped solution is a small, tool-agnostic **"handoff skill"** sub-prompt
(`src/handoff.prompts.lib.mjs`) that both the Claude and Codex prompt builders
include verbatim when `--use-handoff` is set. The AI is taught to read
`HANDOFF.md` first when present and to keep it updated with task, current state,
decisions, next steps, gotchas, and critical files. Because every Hive Mind
working session runs in an **ephemeral working directory cloned fresh from the PR
branch**, the handoff file is **committed to the branch** — that is the only
channel that survives between sessions and between tools.

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
| R2  | Support HANDOFF.md for **both** Claude and Codex                 | ✅ wired into both prompt builders                                             |
| R3  | Use the **same skill / same way** for both tools                 | ✅ shared `handoff.prompts.lib.mjs`, identical text                            |
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

| Piece                  | File                             | Role                                                                         |
| ---------------------- | -------------------------------- | ---------------------------------------------------------------------------- |
| Handoff skill (shared) | `src/handoff.prompts.lib.mjs`    | Builds the tool-agnostic HANDOFF.md instructions; returns `''` when disabled |
| Claude wiring          | `src/claude.prompts.lib.mjs`     | Appends `getHandoffSubPrompt(argv)` to the system prompt                     |
| Codex wiring           | `src/codex.prompts.lib.mjs`      | Appends the same `getHandoffSubPrompt(argv)`                                 |
| Option                 | `src/solve.config.lib.mjs`       | `--use-handoff` boolean, `default: false`, `[EXPERIMENTAL]`                  |
| Suggestion list        | `src/option-suggestions.lib.mjs` | Typo suggestions include `use-handoff`                                       |
| Hive forwarding        | _automatic_                      | `SOLVE_OPTION_DEFINITIONS` is auto-forwarded by `hive.mjs`                   |
| Tests                  | `tests/handoff-prompt.test.mjs`  | 24 assertions: module behavior, gating, identical-text, registration         |

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
