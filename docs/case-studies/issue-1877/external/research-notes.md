# External research — AI agent handoff files (HANDOFF.md)

Online research conducted for issue #1877 (R1, R7, R10). Sources are listed at the
bottom; key facts are attributed inline.

## 1. The convention

A "handoff" (a.k.a. "handover" / "session handoff") file is an emerging convention
for **moving context between AI coding sessions** so a fresh agent can continue
work without re-establishing context. Reported motivation: the first **20–40% of
tokens** in a new session are otherwise spent re-scanning directories and
re-reading files the previous session already understood. The handoff acts as a
"cheat sheet" for the current task. [aihero, bswen, blakelink]

A widely cited insight: _"the model needs context, but context needs structure"_ —
the value is in a **structured** Critical Context / Current State / Next Steps
document rather than a raw transcript dump. [mer.vin]

## 2. Recommended structure (distilled)

The **session-handoff** skill (softaworks/agent-toolkit) defines a 10-section
document, which is the most complete public template we found:

1. Metadata (timestamp, project path, git branch, commits)
2. Current State Summary
3. Important Context
4. Decisions Made (with rationale)
5. Immediate Next Steps
6. Pending Work
7. Critical Files
8. Key Patterns Discovered
9. Potential Gotchas
10. Handoff Chain (links to previous/next handoffs)

The aihero "handoff" skill emphasizes a leaner document: purpose of the next
session, relevant context, **suggested skills to invoke**, and **pointers to
existing artifacts (not duplicated content)**.

Our shipped skill condenses these into six required sections — **Task, Current
state, Decisions, Next steps, Gotchas, Critical files** — which cover the same
ground while staying short enough to keep updated every session.

## 3. Best practices (cross-source consensus)

- **Read-first protocol.** Keep a handoff in the project and instruct the agent to
  read it first in every session. [bswen, blakelink]
- **Specific, actionable next steps**, not vague goals; reference exact paths and
  line numbers; include code snippets for critical patterns. [softaworks]
- **Don't duplicate** content that already lives in artifacts/markdown/GitHub —
  use pointers. [aihero]
- **Portability across agents.** The elegance of a Markdown handoff is that a
  document written by Claude Code can be handed to Codex, Copilot CLI, or any other
  coding agent — directly relevant to R2/R4. [aihero]
- **Security.** Redact API keys, passwords, and PII; handoff files "shouldn't
  contain secrets floating around in random markdown files." [aihero]
- **One active handoff per branch/topic**; archive or mark stale handoffs quickly
  to reduce ambiguity; load durable rules from CLAUDE.md / AGENTS.md only.
  [mer.vin]
- **Storage caveat.** Several sources recommend storing handoffs in the OS temp dir
  as _disposable_ working notes, _not_ committed. [aihero, zench-aine] —
  **We deliberately diverge** for Hive Mind because sessions run in ephemeral temp
  dirs cloned from the branch, so the branch is the only durable cross-session,
  cross-tool channel (see [../ANALYSIS.md](../ANALYSIS.md) §2).

## 4. Prior art & reusable components (R10)

| Component                                            | What it offers                                                                                                                           | How it informed us                                                                                |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Agent Skills open standard** (agentskills.io)      | `SKILL.md` = YAML frontmatter (`name`, `description`) + markdown body; loaded natively by Claude Code and Codex (progressive disclosure) | **The primitive we ship.** One canonical `SKILL.md` works for both tools — "same skill, same way" |
| **softaworks/agent-toolkit `session-handoff`** skill | 10-section template, create/resume modes, validation score, `YYYY-MM-DD-HHMMSS-slug.md` naming under `.claude/handoffs/`                 | Source of the canonical section list; we simplified to 6 sections and a single root file          |
| **aihero "handoff" skill**                           | Lean handoff: purpose, context, suggested skills, pointers; cross-agent portability                                                      | Reinforced tool-agnostic, pointer-over-duplication, security                                      |
| **ZenChAIne "handover" skill**                       | Standardized context handoff, `.handover/` local notes, predecessor chaining                                                             | Handoff-chain idea (future work)                                                                  |
| **OpenAI Agents SDK — Handoffs**                     | Programmatic agent-to-agent handoff primitive (different layer: runtime delegation, not a file)                                          | Confirms "handoff" terminology; out of scope here (we need a portable file, not an SDK runtime)   |
| **HandoffKit / jdhodges handoff template**           | Copy-paste handoff prompt/template                                                                                                       | Cross-checked section naming                                                                      |
| In-repo: `agents-md-claude-support.lib.mjs`          | Deploys tool config (AGENTS.md→CLAUDE.md) around execution, then restores                                                                | Direct pattern we reused for deploying the `SKILL.md` per session                                 |

**Can both CLIs share one skills folder?** Researched the discovery rules for each
tool (sources below):

- **Claude Code** loads project skills only from `.claude/skills/<name>/SKILL.md`
  (plus `~/.claude/skills/`, plugins, and `.claude/skills/` inside an `--add-dir`
  directory). There is no setting or environment variable to redirect or add an
  arbitrary project skills directory.
- **Codex** loads project skills only from `.agents/skills/` (scanning up to the
  repo root), `~/.agents/skills`, `/etc/codex/skills`, and bundled skills. Its
  only config knob, `[[skills.config]]` in `~/.codex/config.toml`, enables/disables
  individual skills by path — it cannot point the scanner at a different folder.

So **there is no native shared location**. We make one with a filesystem
**symlink**: the `SKILL.md` is written once into the real `.claude/skills/handoff/`
folder and `.agents/skills/handoff` is a relative symlink to it. Both tools read
the same folder (verified by a `realpath` assertion in the test), with a copy
fallback when symlinks are unavailable.

**Decision on libraries:** the right primitive is the **Agent Skills open
standard** itself — both Claude Code and Codex discover and load a `SKILL.md`
natively (Claude from `.claude/skills/<name>/`, Codex from `.agents/skills/<name>/`),
so a single canonical file satisfies "same skill, same way" without a bespoke
prompt. The external _handoff_ skills above are not drop-in (they target
Claude-specific loaders, `.claude/handoffs/` temp storage, or an SDK runtime, none
matching Hive Mind's ephemeral-temp-dir + branch-as-memory model), so we author our
own `SKILL.md` rather than depend on them, and reuse the in-repo
`agents-md-claude-support` deploy-around-execution pattern to install it. This
keeps the feature standards-based, dependency-free, and byte-identical across tools.

## 5. Sources

- Agent Skills — open standard (SKILL.md) — https://agentskills.io
- Agent Skills — Anthropic engineering announcement — https://www.anthropic.com/news/skills
- Claude Code — Skills documentation — https://docs.claude.com/en/docs/claude-code/skills
- Codex — Skills documentation (OpenAI) — https://developers.openai.com/codex/skills
- handoff: Move Context Between Agent Sessions — https://www.aihero.dev/skills-handoff
- softaworks/agent-toolkit — session-handoff skill — https://github.com/softaworks/agent-toolkit/tree/main/skills/session-handoff
- Managing Handoffs in Multi-Agent Coding Sessions (Mervin Praison) — https://mer.vin/2026/04/managing-handoffs-in-multi-agent-coding-sessions-fresh-context-without-losing-continuity/
- How to Manage AI Agent Context with Handoff Files (BSWEN) — https://docs.bswen.com/blog/2026-06-08-ai-context-handoff-management/
- Session Handoff Protocol (Blake Link) — https://blakelink.us/posts/session-handoff-protocol-solving-ai-agent-continuity-in-complex-projects/
- handoff: Keeping AI Coding Sessions on Track (Semih Erdogan) — https://semiherdogan.medium.com/handoff-a-better-way-to-run-autonomous-development-loops-00e97e62d470
- When handoff.md Stops Being Enough for AI Agents (DEV) — https://dev.to/a2cr_mcp/when-handoffmd-stops-being-enough-for-ai-agents-5h64
- Open-Sourcing the handover Skill (ZenChAIne) — https://zench-aine.io/en/media/handover-skill-session-continuity
- Claude Handoff Prompt: Keep Context Across Sessions (JD Hodges) — https://www.jdhodges.com/blog/ai-session-handoffs-keep-context-across-conversations/
- Handoffs — OpenAI Agents SDK — https://openai.github.io/openai-agents-python/handoffs/
- Free AI Session Handoff Template (HandoffKit) — https://handoffkit.com/guides/handoff-template

> Note: access dates June 2026. Third-party content may change; quotes are
> paraphrased from the pages as fetched during research.
