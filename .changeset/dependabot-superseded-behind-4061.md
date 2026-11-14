---
'@link-assistant/hive-mind': patch
---

`/fix --update-all-dependencies` now handles every open Dependabot pull request before it creates the issue (#4061). Before this fix, links-notation#396 and #407 stayed open and were listed in links-notation#408:

- **Superseded pull requests are closed whatever their mergeability.** Only conflicting pull requests used to be compared with the base branch, so the mergeable but behind #407 was merged instead of closed. Every non-draft pull request is now compared first. The comparison also reads the .NET SDK `"version"` in `global.json` (Dependabot's `dotnet-sdk` ecosystem), `rust-toolchain(.toml)`, and `image:` lines. Repeated pins in several workflows are named once.
- **Pull requests that a ruleset keeps out because they are behind are rebased.** `--admin` cannot bypass a ruleset with no bypass actors, so `gh pr merge` failed with "Repository rule violations found". Dependabot is now asked to `@dependabot rebase` the pull request, which is merged once its required checks pass. A freshly rebased head whose checks are not reported yet keeps waiting. The wait is bounded by the new `--dependabot-wait-timeout <minutes>` option (default 30, `0` to not wait), which `/fix` and `/task` accept.
- **Clearer reports.** The issue keeps the whole `gh` error, not only its first line, and names the ruleset, its required checks and whether it can be bypassed. `--verbose` prints each supersession verdict and the merge state after a failed merge. The issue context now names the hive-mind version that collected it, so an issue written by an outdated deployment can be recognised.

`links-notation` 0.31.5 and `rc-config-loader` 4.2.0 are also taken, to keep the dependency freshness gate green.
