---
'@link-assistant/hive-mind': patch
---

Stop `solve` from crashing with `TypeError: A GitHub pull request URL requires owner, repo, and a positive integer number` when `--auto-continue` resumes an `issue-<n>-<hash>` branch that has no pull request yet. Continue mode has always had two shapes — resume an existing pull request, or reuse a leftover branch from an interrupted run (`prNumber: null`) — and since #2158 the "Your prepared Pull Request" URL was built from `prNumber` unconditionally, so the second shape aborted the run right after branch checkout, one step before `handleAutoPrCreation()` would have created the missing pull request. The URL is now built through a nullable `buildGitHubPullRequestUrlOrNull()` helper, the run logs that the pull request is still pending, and the strict builder reports the values it received so a bare stack trace is actionable. Full analysis in `docs/case-studies/issue-2170/`.
