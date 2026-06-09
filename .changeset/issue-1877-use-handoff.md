---
"@link-assistant/hive-mind": minor
---

Add experimental `--use-handoff` HANDOFF.md continuity **Agent Skill** (issue
#1877). When enabled, Hive Mind deploys a real `SKILL.md` (the Agent Skills open
standard created by Anthropic) into the session working directory for both tools
natively — `.claude/skills/handoff/SKILL.md` for `--tool claude` and
`.agents/skills/handoff/SKILL.md` for `--tool codex` — so the very same skill
teaches each tool to read `HANDOFF.md` (repository root) first when present and
keep it updated with task, current state, decisions, next steps, gotchas, and
critical files. A minimal activation nudge in the system prompt ensures the
read-at-session-start behavior fires reliably. Because each Hive Mind working
session runs in an ephemeral working directory cloned from the PR branch, the
handoff file is committed to the branch — making it the shared cross-session,
cross-tool memory so Claude and Codex can continue each other's work in a single
pull request. The deployed `SKILL.md` is tooling (re-deployed every session) and
is kept out of the target repository via `.git/info/exclude`, so it never appears
in the PR. Disabled by default; auto-forwarded by `hive`. Includes a case study
in `docs/case-studies/issue-1877/` and tests in `tests/handoff-prompt.test.mjs`.
