---
"@link-assistant/hive-mind": patch
---

Close linked issues when a PR is merged into a non-default branch, and stop misreporting the cause (#1895).

GitHub only registers a PR's `closingIssuesReferences` and auto-closes the linked
issue when the PR targets the repository's **default branch**. PRs created against a
stacked / sub-issue branch (e.g. `issue-47-…` via `--base-branch`) therefore showed
an empty closing-reference connection and left their issues open after merge — the
exact failure reported for meta-language PRs #65/#66 / issues #49/#50.

- src/github-issue-auto-close.lib.mjs (new): `gitHubAutoClosesOnMerge`,
  `classifyIssueLinkStatus`, `buildNonDefaultBranchExplanation`, and
  `ensureLinkedIssueClosedAfterMerge` — diagnose why a closing reference is missing
  and explicitly close the linked issue after a non-default-base merge (no-op when
  GitHub already handles it, the keyword is absent, or the issue is already closed).
- src/solve.auto-pr.lib.mjs: replace the misleading "ISSUE LINK MISSING — add
  Fixes #N" warning with an accurate "ISSUE LINK DEFERRED" explanation when the
  keyword is present but the PR targets a non-default branch.
- src/solve.auto-continue.lib.mjs (`collectIssuePrCandidates`): detect the existing
  PR for an issue by BOTH GitHub's `linked:issue` search (legacy, preserved) and the
  deterministic `head:issue-N-` branch search. A PR targeting a non-default base
  branch never appears in `linked:issue`, so `--auto-continue` previously failed to
  resume it and risked creating a duplicate; the head-branch search guarantees the
  PR↔issue association regardless of base branch.
- src/solve.auto-merge.lib.mjs (watchUntilMergeable + attemptAutoMerge),
  src/github-merge.lib.mjs / src/github-merge-issue-close.lib.mjs
  (`closeLinkedIssueIfNotAutoClosed`, used by the /merge queue), and
  src/telegram-merge-queue.lib.mjs: close the linked issue explicitly after a merge
  into a non-default branch. All gh calls route through the rate-limit-aware wrappers.
- tests/github-issue-auto-close.test.mjs: 14 cases reproducing the non-default-base
  bug and verifying the diagnosis + fallback.
- tests/solve-auto-continue-detection-1895.test.mjs: 7 cases proving non-default-base
  PRs are detected for auto-continue (head-branch search), legacy linked detection is
  preserved, results are deduped/merged, and search failures degrade gracefully.
- docs/case-studies/issue-1895: deep case study with downloaded GraphQL/PR/issue
  evidence, reconstructed timeline, root-cause analysis, requirement mapping, and the
  external-reporting decision. Includes `github-api-linking-research.md` — a
  definitive, introspection-backed answer to "is there an API to link a PR to an
  issue?" (no: confirmed via live GraphQL schema introspection), with the gap
  reported upstream (GitHub Community discussions #112224 / #155339 / #179613).
