# Improvements considered

## Implemented

- Add shared locked-option prompt text for explicit `--base-branch` and `--auto-merge`.
- Add a runtime PR base guard after agent sessions and before auto-merge decisions.
- Reuse the runtime guard inside auto-restart-until-mergeable because that mode can run more agent sessions.
- Correct the verbose auto-PR creation log to print the actual target branch.
- Add an automated regression test for prompt text and PR base restoration.

## Future options

- Add a structured "locked CLI options" object to the agent user prompt so tools can display the effective immutable options in session summaries.
- Add telemetry counters for restored PR bases to measure how often agents attempt retargeting.
- Add a stricter command-output monitor that detects `gh pr edit --base` during the agent stream and interrupts earlier. The current restoration guard is simpler and less tool-specific.
- Extend the guard to default-branch targets when hive-mind itself created the PR in the same run. This was not implemented now because existing continue-mode workflows may intentionally use a non-default PR base without passing `--base-branch`.
