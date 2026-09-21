# Issue 2281 investigation and delivery plan

- [x] Capture repository state, contribution guidance, branch history, and current PR diff.
- [x] Capture the complete issue body, comments, timeline/events, and linked artifacts.
- [x] Capture PR metadata, commits, changed files, conversation comments, inline review comments, reviews, checks, and timeline/events.
- [x] List recent branch CI runs with timestamps and SHAs; verify them against the latest commit and download every non-passing run log.
- [x] Inspect any linked screenshots or files after downloading and validating their file types (none were present).
- [x] Search the repository and recent related PRs for comparable implementations and prior decisions.
- [x] Research relevant upstream documentation, known libraries/components, and related upstream issues online.
- [x] Reconstruct a timestamped sequence of events and enumerate every explicit and implied requirement.
- [x] Trace each requirement through every affected code path and identify evidence-backed root causes.
- [x] Add minimal reproducing tests before fixes (the evidence was sufficient, so no new debug mode was needed).
- [x] Implement the complete fix across all affected locations and update the required release trigger.
- [x] Run focused tests, then the repository's documented local CI checks; inspect the local diff for regressions.
- [x] Write the evidence index, timeline, root-cause analysis, options, and verification report in this folder.
- [x] Commit useful atomic steps, verify the current default branch is already an ancestor, re-run checks, and push only `issue-2281-32df5fb7315a`.
- [x] Update PR 2282 title/body with reproduction and tests (screenshots are not applicable); verify current CI and mark ready.
