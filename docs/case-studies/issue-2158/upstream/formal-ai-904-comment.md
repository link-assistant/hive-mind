Post-#904 evidence shows that the truthful terminal state is working, but repository work still cannot execute.

Hive Mind issue: https://github.com/link-assistant/hive-mind/issues/2158

Production matrix (Formal AI 0.339.1, after Hive Mind's image/launch fixes):

- Agent + Scala issue: every attempt ended as `planned_not_executed`.
- Claude + Kotlin issue: the first attempt ran `pwd`; later attempts ended as `planned_not_executed`.
- Codex + Rust issue: every attempt ran bare `sudo`.
- All three PRs still have no requested source or CI files after five automatic restarts each.

The complete 21-log evidence bundle and analysis is being preserved in Hive Mind PR #2159:
https://github.com/link-assistant/hive-mind/pull/2159

Minimal real-client reproduction:

1. Start `formal-ai serve --agent-mode` in an empty temporary repository.
2. Configure Codex against it using `formal-ai with --global --no-start-server --base-url <url> codex`.
3. Send: `Resolve the GitHub issue at https://github.com/example/example/issues/1 in this repository. Implement and verify the solution before reporting completion.`
4. Observe exit 0, only `.formal-ai/general-change-plan.lino` written, and terminal state `planned_not_executed`.

This remains explicit in current main (0.345.0 at `98cb3c8`): `finish_general_change` immediately returns `planned_not_executed` for `GeneralPlanMode::RepositoryWorkItem`, and `tests/unit/issue_904.rs` asserts that behavior. I also built that commit and reran the real Codex reproduction; it still exited 0 with `planned_not_executed` and no requested artifact.

Current Hive Mind workaround:

- send a bounded repository objective without caller workflow text;
- classify `planned_not_executed` as a terminal tool failure;
- do not feed the same deterministic result into the mergeability restart loop.

Suggested upstream fix:

1. Extend repository-work plans with bounded Read/Write/Run steps against requested repository artifacts.
2. Verify the produced diff and named artifacts before returning `executed`.
3. Keep `planned_not_executed` only when required capabilities are genuinely unavailable.
4. Add a minimal repository regression that creates a requested file, runs its verification, and proves the file—not only the plan record—changed.

Could #904 be reopened, or could it link to the repository-execution tracking issue that supersedes it? The honest status fixed the false report, but it did not deliver the repository capability the original reproduction needs.
