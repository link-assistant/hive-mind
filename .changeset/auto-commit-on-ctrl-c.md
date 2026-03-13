---
'@link-assistant/hive-mind': minor
---

feat: auto-commit uncommitted changes and upload log on CTRL+C interrupt (Issue #1351)

Previously, when a user pressed CTRL+C to interrupt a running solve session, uncommitted changes were silently lost (or left uncommitted) and log files were not uploaded to the PR/issue even when `--attach-logs` was enabled. Additionally, the terminal showed "Claude command completed" instead of "Claude command interrupted".

Now on CTRL+C:

1. **Auto-commit**: Any uncommitted changes in the working directory are automatically committed and pushed to the branch before cleanup occurs.
2. **Log upload**: If `--attach-logs` is enabled, the log file is automatically uploaded to the GitHub PR/issue as a comment.
3. **Accurate message**: The terminal now correctly shows "Claude command interrupted" instead of "Claude command completed" when the process exits with code 130 (SIGINT).

Changes made:

- `src/exit-handler.lib.mjs`: Added optional `interrupt` parameter to `initializeExitHandler()`; SIGINT handler now calls it before cleanup, guarded against double invocation
- `src/solve.mjs`: Extended `cleanupContext` with branch/PR/owner/repo fields; new `interruptWrapper` auto-commits and uploads logs on CTRL+C
- `src/claude.lib.mjs`, `src/opencode.lib.mjs`, `src/codex.lib.mjs`, `src/agent.lib.mjs`: Detect exit code 130 and print "interrupted" instead of "completed"

Full case study analysis including timeline reconstruction, root cause analysis, and implementation details in `docs/case-studies/issue-1351/`.
