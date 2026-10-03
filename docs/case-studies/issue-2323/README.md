# Optional GitHub credentials: requirements and merge resolution

[Issue #2323](https://github.com/link-assistant/hive-mind/issues/2323) asks that every workflow work without workload-specific GitHub secrets. Credentials resolve as GitHub App → one `AUTOMATION_TOKEN` → `github.token`, and the Formal AI draft workflow must never skip because of a missing token.

## Two implementations of the same issue

[PR #2330](https://github.com/link-assistant/hive-mind/pull/2330) and [PR #2329](https://github.com/link-assistant/hive-mind/pull/2329) (issue #2324) implemented the same credential layers in parallel. #2329 was merged first, and `main` then conflicted with this branch in 32 files. Its implementation uses local `resolve-github-token` and `dispatch-checks` actions, `formal-ai-draft-health.mjs`, `cleanup-task-fixtures.mjs` and `github-write-access.lib.mjs`. This branch had a loader for upstream shared actions, a separate activity workflow and cleanup scripts, and a Git receive-pack write probe.

The shared actions in [link-foundation/.github issue #1](https://github.com/link-foundation/.github/issues/1) remain unpublished. On 2026-10-03 the issue is open, and `gh api repos/link-foundation/.github/contents/actions` returns HTTP 404. Both designs are therefore local compatibility implementations of that contract. Keeping both would give the repository two resolvers, contradicting R1. The conflicts were resolved to `main`'s reviewed implementation. Branch files made unreachable by that resolution were removed, together with tests for those files.

## Requirement coverage after the merge

| Requirement                                                 | Where it is delivered on `main`                                                                                                                                         | Verified by                                                                             |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| R1: one resolver; the four workload secrets removed         | `.github/actions/resolve-github-token` in the draft, matrix, release and cleanup workflows; `git grep` finds none of the four secret names under `.github`              | `tests/optional-automation-2324.test.mjs` (token precedence)                            |
| R2: drafts never skip; default-token drafts dispatch checks | `decideDraft` returns `checkStrategy` `dispatch` for `default` and `pull_request` otherwise; `formal-ai-draft.yml` runs `dispatch-checks` whenever a head branch exists | `tests/optional-automation-2324.test.mjs`, `tests/formal-ai-draft-2233.test.mjs`        |
| R3: checks-only dispatch                                    | `mode` defaults to `checks` in `release.yml`, `security.yml`, `links.yml` and `workflows.yml`; release jobs require `inputs.mode == 'release'` on `refs/heads/main`     | `tests/optional-automation-2324.test.mjs`                                               |
| R4: integration suite in every layer                        | `tests/test-feedback-lines-integration.mjs` creates a repository only when `AUTOMATION_CAN_CREATE_REPOSITORIES=true` and otherwise uses an orphan-branch fixture        | `tests/task-fixture-cleanup-2324.test.mjs`                                              |
| R5: cleanup with any layer                                  | `cleanup-test-repos.yml` runs `cleanup-task-fixtures.mjs` with every layer; repository deletion requires `can-delete-repositories`                                      | `tests/task-fixture-cleanup-2324.test.mjs`, `tests/cleanup-workflow-auth-2286.test.mjs` |
| R6: no silent state                                         | The scheduled `health` job in `formal-ai-draft.yml` runs `formal-ai-draft-health.mjs`; its decision now lives in `formal-ai-draft-health.lib.mjs`                       | `tests/formal-ai-draft-health-2323.test.mjs` (added here)                               |
| R7: documentation                                           | `docs/FORMAL-AI-DRAFTS*.md` says default-token runs wait for approval; the README and its translations describe the three layers                                        | documentation checks                                                                    |

The installation-token fork bug found in this PR's CI also has a merged fix: `71648d21` keeps installation tokens in direct repository mode, and `tests/installation-token-access-2324.test.mjs` covers it.

## Remaining contribution: dispatched checks validate the whole head

With the default layer, `formal-ai-draft.yml` starts `release.yml` on the draft head through `workflow_dispatch`. `scripts/detect-code-changes.mjs` treated `workflow_dispatch` like `push` and compared only `HEAD^` with `HEAD`. If a draft's last commit changes only documentation, earlier code commits are invisible, `code=false` skips the test jobs, and the untested head is reported green.

The regression added to `tests/detect-code-changes-untested-head-2198.test.mjs` reuses that test's fixture: a code commit followed by a documentation commit. Run with `GITHUB_EVENT_NAME=workflow_dispatch`, it fails on `main`'s script because the input does not match `/code=true/`. With the fix it passes. `workflow_dispatch` now lists every tracked file at the head. A dispatched check has no base to diff against, so it validates the whole tree.

```bash
node --test tests/detect-code-changes-untested-head-2198.test.mjs tests/optional-automation-2324.test.mjs
```

## Remaining contribution: tested R6 decision

On `main`, the health job was tested only for wiring: dependencies install before the script runs. Its decision logic sat in top-level code that calls GitHub, so nothing verified that a green run with a skipped model step was not counted. That run shape is the original `no-draft-token` failure. The decision is now in `scripts/formal-ai-draft-health.lib.mjs`, and the script's behavior is unchanged. `tests/formal-ai-draft-health-2323.test.mjs` covers eligibility, skipped or unstarted steps, failed sessions, schedule-event runs and the failure rule. Removing the `skipped` condition makes the test fail.

## Remaining limits

- Live App and `AUTOMATION_TOKEN` comparisons require those credentials, which are not configured in this repository.
- The repository's [no-destruction-possible ruleset](https://github.com/link-assistant/hive-mind/rules/21204104) blocks deletion of fixture refs in every layer. Cleanup reports them as retained (#2329).
- Once link-foundation/.github#1 is published, the local actions should be replaced with pinned references to the shared ones.
