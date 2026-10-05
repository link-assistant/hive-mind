# Issue #2526 work plan

- [x] Preserve the issue, all PR comment types, linked failure log, CI run metadata and available logs.
- [x] Reconstruct the failure timeline and enumerate every requirement and affected tool/call site.
- [x] Compare recent related PRs, current official model documentation, installed CLI metadata and existing catalogue libraries.
- [x] Add a minimal failing regression test before changing effort selection.
- [x] Retain exact model reasoning capabilities in dynamically loaded catalogues and provide verified bundled capabilities for current models.
- [x] Select the nearest supported effort for explicit levels, defaults, token budgets and auxiliary Codex calls; preserve supported behavior and explain fallbacks in verbose output.
- [x] Exercise unknown models, missing/stale/malformed metadata and offline operation with deterministic tests.
- [x] Record root causes, solutions, evidence and remaining external limitations in the case study; report any demonstrated upstream defect with a reproducer.
- [x] Add a release changeset, run targeted tests and all local CI checks, then commit atomic changes on the prepared branch.
- [x] Merge the current default branch if needed, push only the prepared branch and update PR #2527's title and description.
- [ ] Review the complete PR diff, confirm clean status, inspect fresh CI runs and logs, and mark the PR ready when implementation is complete.

- [ ] Refresh the dependency published during final CI, verify its existing regressions and all current-head checks, and retain the failing/passing evidence.
