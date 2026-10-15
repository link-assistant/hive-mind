---
'@link-assistant/hive-mind': patch
---

Require complete issue delivery before automated merges (#2406): every tool's system, initial and continuation prompts (including the minimal claude resume prompt) now state the complete-delivery goal and ask for a requirements report; Codex keeps `features.goals=true` in both the direct and agent-commander paths regardless of `--auxiliary-model-calls-disabled`; the shared merge path fails closed unless the pull request description holds a requirements report tied to the current head SHA and to a digest of the issue, its comments and all pull request feedback, with `done` status and evidence for every criterion, and it merges with `--match-head-commit`; after a solve, bounded completion restarts run without any optional flag until the report passes.
