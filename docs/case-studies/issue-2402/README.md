# Case study: issue #2402 — direct release commits and "the code is not a changelog"

- Issue: https://github.com/link-assistant/hive-mind/issues/2402
- Pull request: https://github.com/link-assistant/hive-mind/pull/2403
- Raw data: [`raw/`](raw/)

## Summary

From 2026-08-22 to 2026-10-01, every release of `@link-assistant/hive-mind` landed through an auto-merged `release/vX.Y.Z-<run>` pull request (for example #2399). This was a workaround for a "Main ruleset" that rejected direct pushes to `main`. The ruleset has since been deleted, but the workaround stayed. It added one PR, one merge commit and one undeletable branch per release, and the failed runs of 2026-09-20 left six open 2.31.0 PRs behind (#2268, #2272, #2273, #2276, #2277, #2278).

This PR does three things:

1. Restores the direct commit of the version bump to `main`.
2. Closes the six stale release PRs.
3. Removes user-facing text that narrates change history or tags behaviour with the issue that introduced it, and adds a contributing rule plus a regression test so such text is not accepted again.

## Requirements

| #   | Requirement (from the issue)                                                                                                                                        | Where it is addressed                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Return to committing the version bump and consumed changesets directly to the default branch; stop creating PRs like #2399                                          | `scripts/version-and-commit.lib.mjs`, `.github/workflows/release.yml`, `scripts/release-pull-request.lib.mjs` removed, `tests/release-direct-commit-2402.test.mjs`                                      |
| R2  | Close #2278 and every similar open PR                                                                                                                               | #2268, #2272, #2273, #2276, #2277, #2278 closed on 2026-10-01 with a comment ([`raw/stale-release-prs-after-close.jsonl`](raw/stale-release-prs-after-close.jsonl))                                     |
| R3  | Remove every UI/UX-facing output that explains latest changes, across the whole codebase                                                                            | Help, usage and option text, Telegram locales and replies, and text posted to GitHub (see "Changelog-like text removed" below)                                                                          |
| R4  | Update the contributing guidelines so it is clear such code is not accepted                                                                                         | "The Code Is Not a Changelog" and the rewritten "Release Process" in `docs/CONTRIBUTING{,.ru,.zh,.hi}.md`; `docs/BRANCH_PROTECTION_POLICY*.md`, `docs/CI-CD-BEST-PRACTICES*.md`, `.changeset/README.md` |
| R5  | Collect logs and data under `docs/case-studies/issue-2402`; write a case study with a timeline, requirements, root causes, solutions, libraries and online research | This document and [`raw/`](raw/)                                                                                                                                                                        |
| R6  | Add debug output if the data is insufficient                                                                                                                        | Not needed: GitHub's rule-suite API identifies the blocking rule exactly. A rule-blocked push now fails with an actionable error that keeps the server's GH013 output                                   |
| R7  | Report issues in other repositories when relevant                                                                                                                   | None filed. The cause was this repository's own ruleset and workaround, and no upstream tool misbehaved (see "Upstream reports")                                                                        |

## Timeline (UTC)

| When              | Event                                                                                                                                                                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-22 17:33  | Ruleset `no-destruction-possible` (21204104) is created with `deletion` and `non_fast_forward` rules on all branches ([`raw/rulesets.json`](raw/rulesets.json)).                                                                                                                                                          |
| 2026-08-22 18:45  | Issue #2175: the release push to `main` is rejected with `GH013 … Changes must be made through a pull request.`                                                                                                                                                                                                           |
| 2026-08-22 19:06  | Commit b5adee0c adds the fallback: when a ruleset blocks the push, land the version commit through a `release/*` pull request (`scripts/release-pull-request.lib.mjs`). PR #2176 merges at 20:57.                                                                                                                         |
| 2026-08-22 21:04  | The first release PR (#2177) is created and auto-merged. 35 more follow.                                                                                                                                                                                                                                                  |
| 2026-09-20        | The Main ruleset gains a strict required `Pipeline Status` check. Release runs 35492495204 … 35536130313 open release PRs that can no longer merge, leaving #2268, #2272, #2273, #2276, #2277 and #2278 open (issues #2274, #2279).                                                                                       |
| 2026-09-20/21     | PRs #2275, #2280 and #2282 add check attestation through the Checks API so release PRs can merge again (`checks: write`, `pull-requests: write`).                                                                                                                                                                         |
| 2026-10-01 14:54  | Release run 36878941368: the direct push of 2.33.3 is rejected (`pull_request` and `required_status_checks` rules) and the fallback creates and merges #2399 ([`raw/release-run-36878941368-release-job.log`](raw/release-run-36878941368-release-job.log), lines 2488–2509).                                             |
| 2026-10-01 17:02  | Issue #2402 is opened.                                                                                                                                                                                                                                                                                                    |
| 2026-10-01 ~17:30 | The rule suite for the 14:54 push now reports the blocking rules as `"enforcement": "deleted ruleset"` ([`raw/rule-suite-4316180573.json`](raw/rule-suite-4316180573.json)). The effective rules on `main` are only `deletion` and `non_fast_forward` ([`raw/effective-rules-main.json`](raw/effective-rules-main.json)). |
| 2026-10-01 17:37  | The six stale 2.31.0 release PRs are closed (R2).                                                                                                                                                                                                                                                                         |

## Root causes

### RC1: a workaround outlived the rule it worked around

`versionAndCommit` tried `git push origin main`. Only when that push failed with GH013 did it call `landViaPullRequest`, which pushed a `release/v<version>-<run>` branch, opened a PR, attested `Pipeline Status` through the Checks API and merged. The trigger was therefore the "Main ruleset", not the code. That ruleset is now deleted, as the evidence below shows:

```json
{"rule_source":{"type":"ruleset"},"enforcement":"deleted ruleset","result":"fail","rule_type":"pull_request","details":"Changes must be made through a pull request."},
{"rule_source":{"type":"ruleset"},"enforcement":"deleted ruleset","result":"fail","rule_type":"required_status_checks","details":"Required status check \"Pipeline Status\" is expected."}
```

([`raw/rule-suite-4316180573.json`](raw/rule-suite-4316180573.json)). Direct pushes are allowed again. Keeping the fallback, however, means that any future pull-request rule would silently bring release PRs back. That silent detour is what the issue objects to, so the fallback is removed instead of left dormant.

Costs of the detour, measured on `origin/main` since 2026-08-22:

- 35 of the 81 first-parent commits on `main` (43%) are release-PR merge commits (`Merge pull request #… from link-assistant/release/v…`).
- 41 `release/*` branches exist ([`raw/release-branches.json`](raw/release-branches.json)). None can be deleted, because `no-destruction-possible` applies `deletion` to `~ALL` branches.
- Six failed runs left six open PRs. All six bump `package.json` and `CHANGELOG.md` to 2.31.0 on a `main` that is now at 2.33.3, so none of them can ever merge cleanly.

### RC2: the conflicts mentioned in the issue

The issue says the release PRs created "conflicts almost on all branches of all pull requests". We checked this against history: [`raw/merge-conflicts-since-2026-08-22.txt`](raw/merge-conflicts-since-2026-08-22.txt) scans all 109 merge commits since 2026-08-22.

- Five of them record `# Conflicts:`.
- None of those conflicts is in `package.json`, `package-lock.json`, `CHANGELOG.md` or `.changeset/*`.
- The conflicting files were source files, `bun.lock`, `.gitkeep` and `.prettierignore`.
- Commits ee348057 and c38bfd38 describe their resolution in the message.

So the measurable harm of the release PRs is the noise and the stale, permanently conflicting PRs from RC1, not merge conflicts in feature branches. A direct commit changes the same release files as a release PR, so it does not by itself reduce release-file conflicts. It does remove the extra PR, merge commit and branch per release, and a failed run can no longer leave a PR behind.

### RC3: help text and bot replies were used as a changelog

There was no rule against it, so user-facing strings accumulated history:

- narration such as "(old behavior)", "(the default in newer hive/solve CLIs)", "the exact predicate from the legacy hive-screens.sh script" and "--tool agent already ships this way"
- provenance tags such as "(issue #1825)", "(#594)", "Reference: https://github.com/link-assistant/hive-mind/issues/1642", and an "Issue #2306: " prefix on text posted to GitHub

Under the old code, the scanner in `tests/no-changelog-in-ui-2402.test.mjs` flags 23 help or option locations, plus the locale and published-text cases.

## Solutions

### Release (R1)

- `scripts/version-and-commit.lib.mjs` pushes the version commit to `main` and nothing else. A non-fast-forward race is still rebased and retried. A push rejected by a repository rule (`isBlockedByRepositoryRule`) fails once, with an error that names the cause and keeps the GH013 output. It does not retry, because a retry cannot satisfy a rule, and it does not open a PR.
- `scripts/release-pull-request.lib.mjs` and its tests (#2274, #2279, #2281) are removed. The `release` and `instant-release` jobs lose `pull-requests: write`, `checks: write` and `GH_TOKEN`.
- `tests/release-direct-commit-2402.test.mjs` pins the behaviour:
  - a successful release calls no `gh` command
  - a rule-blocked push fails exactly once and opens no PR
  - the commit may contain release metadata only
  - the workflow has no PR or check write permission left

### Stale PRs (R2)

The six PRs are closed with a comment that links #2402. Their branches stay, because deleting them is exactly what `no-destruction-possible` forbids.

### Changelog-like text removed (R3)

| Surface                        | Files                                                                                                                                                                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Option descriptions (`--help`) | `src/solve.config.lib.mjs` (14 tags and one "already ships" sentence), `src/task.config.lib.mjs`, `src/task.mjs`                                                                                                                                                         |
| Help and usage screens         | `src/hive-screens.lib.mjs`, `src/hive-models.lib.mjs`, `src/configure-claude.lib.mjs` (removed "References" blocks and the "legacy script" remark), `src/start-screen.mjs` ("old behavior", "newer hive/solve CLIs"), `src/cleanup.mjs`                                  |
| Telegram bot                   | `src/locales/{en,ru,zh,hi}.lino` (#1688, #594), `src/telegram-tokens-command.lib.mjs` ("per issue #1745")                                                                                                                                                                |
| Text posted to GitHub          | `src/automation-stop-reporting.lib.mjs` ("Issue #2306: ", "Issue #2247: " prefixes), `src/session-kill-recovery.lib.mjs` (footer), `src/live-input-capabilities.lib.mjs`, `src/solve.repository-mode.lib.mjs` (issue body), `src/solve.results.lib.mjs` (commit message) |
| Startup warnings               | `src/agent.lib.mjs` ("older versions … newer versions" became a version gate stated in the present tense), `src/agent-memory-policy.lib.mjs`, `src/auxiliary-model-calls-policy.lib.mjs`                                                                                 |
| README                         | "same as the legacy script's default"                                                                                                                                                                                                                                    |

What stays, on purpose:

- **Diagnostic log lines, warnings and errors** that cite the issue documenting a known failure mode, for example "force-killing (Issue #1472)" or "Formal AI tasks fail closed by design (issue #2146)". There are 55 such string literals ([`raw/provenance-scan-after.txt`](raw/provenance-scan-after.txt), down from 85 in [`raw/provenance-scan-before.txt`](raw/provenance-scan-before.txt)). Each describes current behaviour and points the operator at the troubleshooting record. None narrates what changed. Removing them would lose debugging context without making any screen less changelog-like.
- **Code comments and tests**, which are where the history now belongs.
- **Deprecation notices** that name the replacement, which is current guidance.
- **Version gates** such as "Versions below X …", which describe a current requirement.

### Guidelines (R4)

`docs/CONTRIBUTING.md` and its three translations gain "The Code Is Not a Changelog". It sets out:

- what is rejected: change narration and issue/PR provenance tags in user-facing text
- where history goes instead: changesets, CHANGELOG, commits and code comments
- what is allowed: deprecation notices and diagnostic pointers
- what enforces it: `tests/no-changelog-in-ui-2402.test.mjs`

The "Release Process" section now describes direct commits. `BRANCH_PROTECTION_POLICY` no longer mentions an exemption for release PRs, and `.changeset/README.md` describes the direct-commit flow.

### Plan if a pull-request rule returns

Do not reintroduce a release PR. Give the release a ruleset bypass instead. `github-actions[bot]` cannot be a bypass actor, so use either:

- a small GitHub App with `contents: write`, added to the bypass list, with its token minted by `actions/create-github-app-token`, or
- a deploy key with bypass permission.

Rulesets can be layered, so the bypass can cover the PR and status-check rules while `no-destruction-possible` stays without bypass. Until then, the release fails loudly, as `tests/release-direct-commit-2402.test.mjs` requires.

## Existing components and libraries

- **`@changesets/cli` (`changeset version`).** The repository already uses it. It produces the version bump, CHANGELOG and consumed changesets that are committed directly.
- **`changesets/action`.** By default it opens a "Version Packages" PR (inputs `commit-message` and `pr-title`, both defaulting to `Version Packages`). That PR flow is what this repository is moving away from, so it is not adopted. The CLI-plus-commit approach is the documented manual alternative.
- **GitHub rule-suite API (`GET /repos/{owner}/{repo}/rulesets/rule-suites`).** It "Lists suites of rule evaluations at the repository level". It identified the deleted ruleset and its rules without any extra logging (R6).
- **`actions/create-github-app-token`.** The recommended way to give a release a bypass identity if a PR rule is ever needed again.

## Online research

- GitHub docs, [Available rules for rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets): "You can require that all changes to the target branch be associated with a pull request". Restricting deletions means "Only users with bypass permissions can delete branches". This explains both the GH013 rejections and the undeletable `release/*` branches.
- GitHub REST docs, [Rule suites](https://docs.github.com/en/rest/repos/rule-suites): per-push evaluations, including rules from rulesets that have since been deleted.
- Community discussion [#43460](https://github.com/orgs/community/discussions/43460) and similar reports: `github-actions[bot]` cannot be added to a ruleset bypass list; a GitHub App or deploy key is the supported route. Rulesets can be layered so that a bot bypasses some rules but not deletion or force-push protection.
- [changesets/action README](https://github.com/changesets/action) and changesets release guides such as [Infinite Red's](https://docs.infinite.red/react-native-mlkit/contributing/changesets-versions-and-releases): the action's default flow is a "Version Packages" PR; running `changeset version` and committing to `main` is the alternative.
- [Keep a Changelog](https://keepachangelog.com/): "Changelogs are for humans". The changelog is a dedicated, versioned document, which supports keeping history out of help screens and runtime messages.

## Upstream reports

None were filed. The rejection came from this repository's own ruleset. Its deletion is visible in the rule-suite data. `git`, `gh`, changesets and GitHub all behaved as documented. The changelog-like text was written in this repository.

## Reproducing

- Release behaviour: `node tests/release-direct-commit-2402.test.mjs`. It replays the production GH013 output from run 32589574378.
- Changelog-like text: `node tests/no-changelog-in-ui-2402.test.mjs`. To see it fail on the old code, copy it into a checkout of commit 47bb10c0 and run it there.
- Inventory of provenance tags in string literals: `node experiments/issue-2402-find-provenance-tags.mjs [dir] [--include-verbose]`.
