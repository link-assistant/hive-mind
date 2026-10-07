# Issue #2613 investigation and implementation plan

1. Read issue #2613, every PR #2614 comment/review, the referenced PR #2592 discussions, and repository contribution instructions.
2. Preserve available source material, failure logs and CI run metadata in this case study. Read large logs in chunks of at most 1500 lines; record unavailable evidence explicitly.
3. Reconstruct the event timeline and enumerate requirements, warnings, errors, false positives and false negatives from the evidence.
4. Trace formal-AI execution, Claude exit 137, log publishing and development-log fallback throughout the codebase. Review recent related PRs and authoritative online documentation.
5. Create minimal failing regression tests before changing behavior. Keep finite, resource-bounded investigation scripts in `experiments/issue-2613`.
6. Implement root-cause fixes across affected paths, retain optional diagnostic tracing where evidence is insufficient, and add a release changeset.
7. Run focused regressions followed by the repository local CI checks; preserve logs and inspect any failures.
8. Commit useful atomic changes, integrate current main without rewriting history, and push only `issue-2613-2efa14ce78a7`.
9. Update PR #2614 title/body with reproduction, tests, evidence and remaining limitations; report reproducible external defects upstream if identified.
10. Download and inspect non-passing CI logs, verify run timestamps and SHAs match the latest commit, fix actionable failures, review the complete PR diff and confirm a clean worktree.
11. Mark PR #2614 ready after validation and report its URL with the concrete result.
