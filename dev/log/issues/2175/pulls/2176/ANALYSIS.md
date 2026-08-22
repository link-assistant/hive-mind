# Issue 2175 / PR 2176 investigation

Collected and analyzed on 2026-08-22 UTC. This document is the index and
conclusion for the raw evidence stored beside it. All timestamps below are UTC.

## Scope and method

The investigation covered:

1. issue #2175 and its comments, plus PR #2176 metadata (`issue-2175.json`,
   `issue-2175-comments.json`, `pr-2176.json`); there were no screenshots or
   user-attachment URLs, and no review or conversation comments at collection
   time;
2. the complete logs and job metadata for the failing default-branch run
   `32589574378` ("Checks and release"), its green Security sibling
   `32589574332`, and the preceding green pair `32586592059` /
   `32586592088` (`ci-logs/`, `jobs-*.json`, `annotations.tsv`);
3. the repository's rulesets, including the full version history of the "Main
   ruleset" that changed minutes before the failure (`rulesets.json`,
   `ruleset-main.json`, `ruleset-main-history.json`,
   `ruleset-main-version-*.json`, `ruleset-no-destruction.json`) and the merge
   settings that constrain any fallback (`repo-merge-settings.json`);
4. npm registry metadata for `@link-assistant/hive-mind`
   (`npm-package-metadata.json`), used as the source of truth for "was this
   version actually released?";
5. a full file tree of the JavaScript CI/CD template
   (`template-file-tree.txt`, `template-head.txt`) together with copies of every
   template workflow and CI/CD script (`template-workflows/`,
   `template-scripts/`), compared against this repository's tree
   (`hive-mind-file-tree.txt`) and its workflows as they stood before this PR
   (`workflows-before/`);
6. local reproduction of every warning-producing check, plus lint, format,
   line-limit and regression runs over the whole test suite.

`annotations.tsv` is the machine-readable list of every annotation the two most
recent main runs emitted, which is what "all warnings and errors" is measured
against; the unabridged logs in `ci-logs/` are kept so no conclusion depends on
GitHub's filtered annotation view alone.

## Timeline

| Time                      | Event and evidence                                                                                                                                                                                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-22 17:03          | Main commit `ae2d6cda` triggered run `32586592059`, which **succeeded**. It emitted 7 file-headroom warnings and one Node 20 deprecation warning for `softprops/action-gh-release@v2` (`annotations.tsv`).                                                                          |
| 2026-08-22 17:34          | The "Main ruleset" was edited twice (versions `47321945` and `47321963`), adding a `pull_request` rule with an **empty `bypass_actors` list** — from this moment `GITHUB_TOKEN` may no longer push directly to `main` (`ruleset-main-history.json`).                                |
| 2026-08-22 18:02          | The ruleset was edited once more (version `47323217`) and main commit `9191b939` triggered run `32589574378`.                                                                                                                                                                       |
| 2026-08-22 18:11          | The release job bumped the version to `2.13.5`, committed it, and the push was rejected: `GH013: Repository rule violations found for refs/heads/main … Changes must be made through a pull request` (`release-failure-excerpt.txt`, `ci-logs/checks-and-release-32589574378.log`). |
| 2026-08-22 18:12          | The pipeline-status job reported `Pipeline failed. Failing jobs: release`. `2.13.5` was never published; npm `latest` remained `2.13.4` (`npm-package-metadata.json`).                                                                                                              |
| 2026-08-22 18:45          | Issue #2175 was opened from that run, requesting a complete false-positive / false-negative / warning / error sweep and a template comparison.                                                                                                                                      |
| 2026-08-22 18:46          | Draft PR #2176 and its scaffold commit `6d4bb5dd` were created; the branch run was green but changed nothing substantive.                                                                                                                                                           |
| 2026-08-22 investigation  | The ruleset rejection was reproduced from the ruleset definitions: `pull_request` with no bypass actors, `no-destruction-possible` targeting `~ALL` (no force-push, no branch deletion), and `allowed_merge_methods: ["merge"]`.                                                    |
| 2026-08-22 implementation | Release landing via pull request, an npm-aware release gate, removal of the Node 20 action, and eight file extractions clearing every file-headroom warning were implemented and regression-tested.                                                                                 |
| 2026-08-22 upstream       | The same two defects were found in the template's own release scripts and reported to `link-foundation/js-ai-driven-development-pipeline-template` (see "Upstream reports").                                                                                                        |

Verified post-conditions of the failure, from the repository itself rather than
from the log: `origin/main` is still at version `2.13.4`, npm `latest` is
`2.13.4`, and the changeset `.changeset/retry-transient-github-graphql-and-git.md`
is still present on main. The whole version commit was lost with the rejected
push, so the release is _stuck_, not silently skipped: every future push to main
would repeat the same GH013 failure until the push path is fixed.

## Requirements inventory and disposition

### Requirements stated by issue #2175

| #   | Requirement                                             | Disposition                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| I1  | Fix all CI/CD false positives                           | None found in the collected runs; the analysis below records the two candidate classes examined and why they are not false positives.                                                                                                                        |
| I2  | Fix all CI/CD false negatives                           | Two fixed: the release gate that could not distinguish "nothing to release" from "bumped but never published", and the retry path that mislabelled a rule rejection as a lost race. One more documented but deliberately not silenced: `needs-triage` tests. |
| I3  | Fix all CI/CD warnings                                  | All 9 warning annotations cleared: 8 file-headroom warnings and the Node 20 deprecation warning.                                                                                                                                                             |
| I4  | Fix all CI/CD errors                                    | The single failing job (`release`, GH013) is fixed by landing the version commit through a pull request.                                                                                                                                                     |
| I5  | Compare tree/workflows/scripts against the template     | Done; see "Template and best-practice reconciliation".                                                                                                                                                                                                       |
| I6  | Reuse applicable template best practices                | The template's npm-registry-as-source-of-truth release gate and its `gh`-based release creation were adopted; the remaining differences are inventoried with a rationale.                                                                                    |
| I7  | Follow `docs/CI-CD-BEST-PRACTICES.md`                   | Checked section by section; §2 (file size limits), §6 (changeset versioning) and §9 (release automation) are the ones this PR touches.                                                                                                                       |
| I8  | Report the same issue upstream when the template has it | Both defects reproduce in the template; reports filed with reproducers, workarounds and code-level fixes.                                                                                                                                                    |
| I9  | Plan and execute everything in this single pull request | All work is on `issue-2175-bb6fb2336edc` / PR #2176.                                                                                                                                                                                                         |

### Additional execution requirements supplied with the task

| #   | Requirement                                          | Disposition                                                                                                                                                        |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| E1  | Download all logs and evidence into `dev/log/…`      | This directory; unabridged logs in `ci-logs/`.                                                                                                                     |
| E2  | Deep analysis with online research                   | See "Online and reusable-component research".                                                                                                                      |
| E3  | Reconstruct the timeline                             | See "Timeline"; the ruleset version history is what makes the sequence unambiguous.                                                                                |
| E4  | List every requirement                               | The two tables above.                                                                                                                                              |
| E5  | Root cause per problem plus solution options         | See "Root-cause and solution matrix"; each entry lists the alternatives considered and why one was chosen.                                                         |
| E6  | Add debug output / verbose mode when data is missing | Not needed for the root cause (the log names the rule); the new release path is verbose-capable through `runCommand`'s `verbose` option, default off.              |
| E7  | Report to other projects when applicable             | See "Upstream reports".                                                                                                                                            |
| E8  | Apply each fix everywhere it applies                 | The file-headroom remediation was applied to all 8 offending files, not only those in the failing run; both fork-detection paths and both push paths were updated. |

## Root-cause and solution matrix

### 1. Release job error — GH013 push rejection (I4)

**Observed.** `git push origin main` in "Version packages and commit to main"
exits 1 with `GH013: Repository rule violations found for refs/heads/main` and
`Changes must be made through a pull request`.

**Root cause.** Not a race, not a token scope problem: at 17:34 a `pull_request`
rule was added to the Main ruleset with an empty `bypass_actors` array, so the
server refuses _every_ direct push to `main`, including the release workflow's.
The release workflow was written on the assumption that the bot can push to the
protected branch, and its only recovery path (issue #2082's rebase-and-retry)
addresses lost races. Rebasing cannot satisfy a rule, so the retry loop can only
consume attempts and then fail with a misleading "remote has advanced" story.

**Alternatives considered.**
(a) Add the Actions bot to `bypass_actors` — weakens the ruleset the maintainer
just deliberately tightened, and cannot be done from a workflow.
(b) Publish from a tag / detached commit without touching main — leaves
`package.json` on main permanently behind the registry.
(c) Land the version commit through a pull request — satisfies the rule, keeps
main authoritative, needs no ruleset change.

**Implemented solution.** (c), in `scripts/release-pull-request.lib.mjs`, wired
into `scripts/version-and-commit.lib.mjs`. `isBlockedByRepositoryRule` classifies
the rejection (GH006/GH013/"changes must be made through a pull request"/"push
declined"/"protected branch") and `isNonFastForward` explicitly returns `false`
for it, so a rule violation can never be retried as a race. `landViaPullRequest`
pushes the existing commit to a run-scoped branch, opens a PR, merges it, and
fast-forwards the local checkout so the rest of the job (npm publish, GitHub
release, Docker, Helm) runs against the same tree that is now on main.

Two ruleset details constrain the implementation and are encoded in it:
`no-destruction-possible` targets `~ALL` and forbids force-pushes and branch
deletion, so the release branch is never force-pushed or deleted and its name
embeds the run id instead; `allowed_merge_methods` is `["merge"]`, so the merge
uses `--merge`. The commit author e-mail was also corrected to
`41898282+github-actions[bot]@users.noreply.github.com` — without the numeric
prefix the commit is _unattributed_, and the same ruleset's
`require_extra_approval_for_unattributed_changes` would block the merge pending
a human review.

**Regression test.** `tests/release-pull-request-2175.test.mjs` (classification
of the verbatim GH013 output, branch naming under the no-destruction constraint,
merge retry while GitHub still computes mergeability, and the end-to-end
fallback from a rejected push).

### 2. Release gate false negative — changesets as the release oracle (I2)

**Observed.** The release steps were gated only on "does `.changeset` contain any
`*.md`?".

**Root cause.** That question conflates two very different states: _nothing to
do_, and _a version bump landed but was never published_. In the second state
the changesets have already been consumed, so every later push to main reports a
green "Checks and release" run while `package.json` is ahead of the registry —
a false negative with no failing check anywhere. Failure mode 1 is exactly the
kind of interruption that produces that state.

**Implemented solution.** `scripts/check-release-needed.mjs` +
`.lib.mjs`: the npm registry, not the changeset folder, answers "is this version
released?". With changesets pending, the registry is not even consulted (the new
version does not exist yet) and `skip_bump=false`. With no changesets and the
current version already published, there is genuinely nothing to do. With no
changesets and the current version missing from npm, the run self-heals:
`should_release=true`, `skip_bump=true` — publish what is already committed.
This mirrors the template's `check-release-needed.mjs` (I6).

**Regression test.** `tests/check-release-needed-2175.test.mjs` (all four states
plus the exact output strings GitHub Actions `if:` expressions compare against).

### 3. Node 20 deprecation warning (I3)

**Observed.** `Node.js 20 is deprecated. The following actions target Node.js 20
but are being forced to run on Node.js 24: softprops/action-gh-release@v2`.

**Root cause.** A third-party JavaScript action pinned to the Node 20 runtime,
used only to upload release assets.

**Implemented solution.** `scripts/upload-release-assets.sh` uploads the assets
with `gh release upload`, removing the action entirely. The template does the
same — it has no `softprops/action-gh-release` reference anywhere
(`template-workflows/release.yml`), which confirms this as the template-aligned
approach rather than a local invention.

### 4. Eight file-headroom warnings (I3, E8)

**Observed.** Eight `::warning::File has NNNN lines (approaching limit of 1500).
Consider extracting code to keep under 1350 lines…` annotations.

**Root cause.** `scripts/check-file-line-limits.sh` hard-fails at 1500 lines and
warns from 1350 (issue #1593: long files collide when concurrent PRs merge).
Eight source files had drifted into the warning band.

**Implemented solution.** Each file was reduced by extracting a _cohesive_
module with injected dependencies — the remediation pattern established by issue
#2150 §6 — not by mechanical compaction, and every moved symbol is re-exported
so importers and tests keep working:

| File                               | Before | After | Extracted module                                                  |
| ---------------------------------- | -----: | ----: | ----------------------------------------------------------------- |
| `src/hive.mjs`                     |   1465 |  1323 | `hive.repository-fallback.lib.mjs`, `hive.startup-checks.lib.mjs` |
| `src/session-monitor.lib.mjs`      |   1416 |  1156 | `session-monitor.queries.lib.mjs`                                 |
| `src/claude.lib.mjs`               |   1401 |  1247 | `claude.session-tokens.lib.mjs`                                   |
| `src/solve.mjs`                    |   1398 |  1248 | `solve.mode.lib.mjs`                                              |
| `src/telegram-solve-queue.lib.mjs` |   1374 |  1121 | `telegram-solve-queue.throttling.lib.mjs`                         |
| `src/codex.lib.mjs`                |   1367 |  1250 | `codex.diagnostics.lib.mjs`                                       |
| `src/solve.auto-pr.lib.mjs`        |   1361 |  1225 | `solve.auto-pr-push-sync.lib.mjs`                                 |
| `src/isolation-runner.lib.mjs`     |   1357 |  1084 | `isolation-runner.parsers.lib.mjs`                                |

`bash scripts/check-file-line-limits.sh` now prints only "All checked files are
within the 1500 line limit!" with no "approaching" list.

Three source-level tests assert on code that moved; they were updated to read
the module that now holds it, with a comment recording why
(`tests/test-issue-1829-compare-api-transient.mjs`,
`tests/test-issue-1716-private-repo-skip-fork.mjs`,
`tests/test-issue-1332-fork-name-from-pr-data.mjs`). One extraction also removed
a lint exemption side-effect: the auto-continue fork check in `solve.mode.lib.mjs`
was a direct `gh` invocation that only passed `gh-rate-limit/no-direct-gh-exec`
because `solve.mjs` is exempt, so it now goes through `githubLib.ghPrView` — the
same rate-limit-safe helper the PR-URL branch already used.

### 5. False positives (I1)

No false positive was found. Two candidate classes were examined:

- **The file-headroom warnings.** They are true positives: the reported line
  counts match the files exactly, and the threshold is a deliberate policy
  (issue #1593, `docs/CI-CD-BEST-PRACTICES.md` §2), not a mis-measurement.
- **The GH013 failure.** The job genuinely failed to do its job; the release did
  not happen. Reporting it as a failure is correct — the defect is that the
  workflow had no way to succeed, not that it complained wrongly.

### 6. Latent false negative left visible on purpose (I2)

Seven test files fail on an unmodified checkout yet are invisible to CI because
they are tagged `@hive-mind-test-suite needs-triage`, which excludes them from
the default suite: `tests/test-solution-summary.mjs`,
`tests/test-issue-1600-comprehensive.mjs`, `tests/playwright-mcp-prompts.test.mjs`,
`tests/test-opusplan-support.mjs`, `tests/test-activity-timeout-1510.mjs`,
`tests/test-telegram-solve-queue.mjs`, `tests/test-issue-1706-sub-session-size.mjs`.
Each was verified to fail identically on a stashed tree, so none is caused by
this PR. This is a real CI blind spot, but triaging seven unrelated product
failures is out of scope for a CI/CD remediation PR and each deserves its own
root-cause analysis; it is recorded here so the gap is not mistaken for health.

## Template and best-practice reconciliation

### Full tree comparison

Compared `hive-mind-file-tree.txt` against `template-file-tree.txt` (template
head recorded in `template-head.txt`), workflow by workflow and script by
script.

Scripts present in the template and absent here, with disposition:

| Template script                                                                                                                                                                                                   | Disposition                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check-release-needed.mjs`                                                                                                                                                                                        | **Adopted** in this PR (failure mode 2), as `check-release-needed.mjs` + `.lib.mjs`.                                                                                                                                       |
| `npm-registry.mjs`, `package-info.mjs`                                                                                                                                                                            | Their behaviour is folded into `check-release-needed.lib.mjs` rather than added as separate one-function modules.                                                                                                          |
| `push-main-with-rebase-retry.sh`                                                                                                                                                                                  | Superseded here: this repository's push logic lives in `version-and-commit.lib.mjs` and now also handles rule rejections, which the template script does not (see "Upstream reports").                                     |
| `check-changesets.mjs`                                                                                                                                                                                            | Equivalent logic is `countChangesets` in `check-release-needed.lib.mjs`.                                                                                                                                                   |
| `js-paths.mjs`, `lint.mjs`, `changeset-version.mjs`, `format-release-notes-helpers.mjs`, `release-naming.mjs`                                                                                                     | Template scaffolding for multi-language (`js/` subfolder) repositories; this repository is single-language with its own equivalents.                                                                                       |
| `lint-changed-lines.mjs`, `run-with-budget-warning.sh`, `smoke-test-package.mjs`, `publish-retry.mjs`, `check-web-archive.mjs`, `update-preview-images.mjs`, `check-docker-build.mjs`, `check-docker-publish.mjs` | Genuine gaps, none of which relates to a warning or failure in the collected runs. Candidates for follow-up issues; adopting them here would enlarge an already broad PR without addressing anything issue #2175 asks for. |

This repository additionally carries 23 scripts the template does not have
(Helm release, DinD isolation verification, sourcemap upload, disk-space
reclamation, docker PR verification, shell/workflow linting, …); these are
product-specific and have no template counterpart.

### `docs/CI-CD-BEST-PRACTICES.md` checklist

- §2 _File size limits_ — restored: the repository is back inside both the hard
  1500-line cap and the 1350-line early-warning band.
- §6 _Changeset-based versioning_ — preserved. The pull-request fallback bumps
  the version through the same `changeset:version` flow; only the transport to
  main changed.
- §9 _Release automation_ — strengthened: the release is now driven by registry
  state rather than by the presence of changeset files, which is what the
  document means by releases that recover themselves.
- §§1, 3, 4, 5, 7, 8, 10–13 — already satisfied; unchanged by this PR.

## Upstream reports

Both defects fixed here reproduce in
`link-foundation/js-ai-driven-development-pipeline-template` at the collected
head, so per requirement I8 they were reported there with a reproducible
example, a workaround, and a code-level fix:

1. **Direct push to `main` cannot succeed under a `pull_request` ruleset** — [template issue #143](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/143).
   `scripts/push-main-with-rebase-retry.sh` treats any failed push as a lost
   race: it pushes, and on failure rebases and pushes once more. Under a
   `pull_request` rule both attempts fail with GH013 and the release job dies
   with the version bump committed only in the runner. Reproducer: enable a
   `pull_request` rule with empty `bypass_actors` on `main` and merge anything.
   Workaround: add the Actions app to `bypass_actors`. Suggested fix: classify
   the rejection and land the commit through a pull request, as
   `scripts/release-pull-request.lib.mjs` does here.
2. **Unattributed release commits** — [template issue #144](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/144). `scripts/version-and-commit.mjs:174` and
   `scripts/simulate-fresh-merge.sh:24` set
   `github-actions[bot]@users.noreply.github.com` without the `41898282+`
   prefix, so the commit is not linked to the bot account. Any repository with
   `require_extra_approval_for_unattributed_changes` then blocks the release
   pull request pending a human approval. Fix: use
   `41898282+github-actions[bot]@users.noreply.github.com`.

## Online and reusable-component research

- GitHub's own documentation for repository rulesets confirms that the
  `pull_request` rule applies to `GITHUB_TOKEN` pushes unless the app is listed
  in `bypass_actors`, and that GH013 is the server-side rejection code; this is
  what rules out "retry the push" as a fix in principle rather than by
  experiment.
- Existing components were preferred over new code wherever one existed: the
  fallback uses the `gh` CLI (`gh pr create` / `gh pr merge` / `gh pr list`)
  already installed on the runners rather than a bespoke API client, and asset
  upload uses `gh release upload` rather than a third-party action. The two
  widely used alternatives were considered and rejected: `peter-evans/create-pull-request`
  (it creates its own commit from a working-tree diff, whereas the release must
  land the exact signed version commit) and `changesets/action` (it manages a
  standing "Version Packages" PR, which would restructure this repository's
  instant-bump and changeset flows rather than fix the transport).
- No library was found that classifies git push rejections into rule violations
  versus lost races; `isBlockedByRepositoryRule` / `isNonFastForward` remain
  local, but they are pure functions with unit tests over verbatim git output.

## Verification map

| Claim                                               | Evidence                                                                                                                                                                |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All warning annotations are gone                    | `bash scripts/check-file-line-limits.sh` reports no "approaching" files; no `softprops` reference remains in `.github/workflows/`.                                      |
| The release path works under the ruleset            | `tests/release-pull-request-2175.test.mjs`                                                                                                                              |
| The release gate no longer produces false negatives | `tests/check-release-needed-2175.test.mjs`                                                                                                                              |
| Extractions preserved behaviour                     | `tests/hive-extracted-modules-2175.test.mjs`, the three updated source-level tests, and the pre-existing suites for session-monitor, isolation-runner, queue and claude |
| `solve.mjs` still runs end to end                   | `--dry-run` against an issue URL (exit 0) and against a PR URL (continue mode, branch and linked issue resolved)                                                        |
| Pre-existing failures are not caused by this PR     | Each `needs-triage` file reproduced identically on a stashed tree                                                                                                       |
| Nothing else regressed                              | `npm run lint`, `npm run format:check`, `npm test`                                                                                                                      |
