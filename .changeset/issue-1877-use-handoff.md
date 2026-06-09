---
"@link-assistant/hive-mind": minor
---

Add experimental `--use-handoff` HANDOFF.md continuity skill (issue #1877). When
enabled, both `--tool claude` and `--tool codex` receive the same tool-agnostic
"handoff skill" sub-prompt that teaches the AI to read `HANDOFF.md` (repository
root) first when present and keep it updated with task, current state, decisions,
next steps, gotchas, and critical files. Because each Hive Mind working session
runs in an ephemeral working directory cloned from the PR branch, the handoff
file is committed to the branch — making it the shared cross-session, cross-tool
memory so Claude and Codex can continue each other's work in a single pull
request. Disabled by default; auto-forwarded by `hive`. Includes a case study in
`docs/case-studies/issue-1877/` and tests in `tests/handoff-prompt.test.mjs`.
