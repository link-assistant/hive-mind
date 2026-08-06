---
'@link-assistant/hive-mind': patch
---

Closed issues no longer stop the mergeable loop, and every stop is now explained
in a GitHub comment (issue #2144).

A `solve …/pull/927 --auto-merge` run stopped after its first monitoring
iteration with `❌ GITHUB TARGET UNAVAILABLE: Issue #905 has been closed.` — in
the *same* probe that reported the pull request as `"mergeable": true,
"mergeable_state": "clean"`. Nothing was posted to GitHub and the process exited
`0`, so the run looked successful while the pull request sat unmerged until a
human merged it manually two hours later.

- `src/github-terminal-state.lib.mjs` now distinguishes *terminal* states from
  *merge blockers*. A closed or deleted **issue** is a merge blocker: the loop
  keeps working to make the pull request mergeable. Only the pull request being
  merged, closed or unreachable — or the repository/branches it needs being gone
  — stops the loop.
- A closed issue holds back `--auto-merge` only. When it does, the tool comments
  that the pull request is ready and asks the user to reopen the issue or merge
  manually, instead of stopping silently.
- New `src/automation-stop-reporting.lib.mjs`: a registry of 13 stop reasons,
  each with a title, an explanation and concrete next steps, plus a deduped,
  never-throwing reporter. It is wired into all 11 stop paths of
  `--auto-merge`, `--auto-restart-until-mergeable` and `--watch`. Unknown reason
  codes degrade to a generic comment, so a new stop can never regress to
  silence.
- `attemptAutoMerge` was extracted into
  `src/solve.auto-merge-attempt.lib.mjs` to stay within the repository's
  file-length policy.
- Fixed a second defect found in the same log: the quiet GitHub probes from
  issue #2130 were silently defeated because all three callers injected their own
  mirroring `$`, so ~33 KB of pull request JSON plus the full issue payload were
  written to the attached log on every iteration. They now pass
  `quietProbe($)`, with a regression test.

Timeline, requirement inventory, root causes, edge cases and the codebase sweep:
`docs/case-studies/issue-2144/README.md`. Reproduction:
`experiments/issue-2144/repro-closed-issue-stops-loop.mjs`.
