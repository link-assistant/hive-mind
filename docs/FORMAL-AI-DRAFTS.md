# Formal AI drafts (languages: en • [zh](FORMAL-AI-DRAFTS.zh.md) • [hi](FORMAL-AI-DRAFTS.hi.md) • [ru](FORMAL-AI-DRAFTS.ru.md))

Eligible issues opened in this repository get one attempt from Formal AI within minutes, on a branch nobody depends on. A wrong attempt costs nothing. A right one saves the first commit. A failed attempt is not waste either: it fails in public, with its session evidence attached, and that failure is the input the next improvement to the meta algorithm is made from.

This answers [issue #2233](https://github.com/link-assistant/hive-mind/issues/2233).

## What runs

`.github/workflows/formal-ai-draft.yml` triggers on `issues: opened` — not on a curated label, because the point is the volume of evidence per day rather than a human deciding which issues deserve an attempt. It runs one command in the published `konard/hive-mind:<version>` image, where `<version>` is the `package.json` version of the checked-out workflow:

```bash
solve <issue-url> \
  --tool agent \
  --model formal-ai \
  --attach-logs \
  --development-log \
  --verbose \
  --attribution formal-ai \
  --no-auto-continue \
  --no-auto-restart-until-mergeable \
  --no-auto-restart-on-uncommitted-changes \
  --log-dir /home/box/logs
```

After pulling the image, the workflow skips the attempt with `issue-has-open-pull-request` if an open PR has an `issue-<number>-*` head branch. If a PR appears after that check, `--no-auto-continue` keeps the draft session on its own branch. The workflow checks the PR that `solve` reports creating before applying the `formal-ai-draft` label, restoring draft status, or dispatching checks.

That is Hive Mind's own path, so the drafts are a continuous, unfaked measurement of whether `solve --model formal-ai` is getting better at real tasks in the repository that owns `solve`.

The commit that results carries the four Formal AI trailers and the evidence bundle ([#2229](https://github.com/link-assistant/hive-mind/issues/2229), [#2230](https://github.com/link-assistant/hive-mind/pull/2230), v2.24.0):

```
Formal-AI-Session: ses_…
Formal-AI-Model: formal-ai
Formal-AI-Evidence: dev/log/self-authored/issue-<n>/evidence
Formal-AI-Pull-Request: https://github.com/link-assistant/hive-mind/pull/<n>
```

Every commit on the branch is authored by `github-actions[bot]`. The identity is set through `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_n` / `GIT_CONFIG_VALUE_n` rather than a config file, so it holds inside the container regardless of whose `HOME` is mounted (`experiments/issue-2233/probe-git-identity.sh` measures this).

Four flags are chosen rather than inherited:

| Flag                                       | Why                                                                                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--attribution formal-ai`                  | The trailers and the evidence bundle are the point of the exercise, so they are forced on rather than left to `auto`.                                                                       |
| `--no-auto-restart-until-mergeable`        | Defaults to on. Left on, one run watches the pull request's checks and restarts the model until they are green, for up to 24 hours. The failure policy below says the _next_ run does that. |
| `--no-auto-restart-on-uncommitted-changes` | Defaults to on. Left on, every file the model leaves uncommitted restarts it, up to five more sessions in one run. The failure policy applies here too: the next run is the retry.          |
| `--log-dir`                                | The session log is bind-mounted out of the container and uploaded as a workflow artifact, so it is readable even when no pull request was opened at all.                                    |

### Image, binary and Formal AI's own state

- The script pulls `konard/hive-mind:<version>` explicitly, retrying a registry timeout after 15 s, 30 s, 1 min and 2 min, so the container runs the same hive-mind as the scripts beside it. A tag that is not published yet (a version bumped on `main` before its release finished) falls back to `konard/hive-mind:latest` with a warning. An `image` input or the `FORMAL_AI_DRAFT_IMAGE` variable is used as given.
- The Formal AI server the session starts gets `FORMAL_AI_CACHE_DIR` under its own home. Formal AI still writes `data/cache/derivations/` in the clone, so that directory, like `.formal-ai/`, is excluded from the uncommitted-changes check and from the work preserved on `recovery/<branch>` branches: it is the tool's state, not the user's work.
- The container is started with `--rm`, so a failure comment never points at a path inside it. It links the workflow run, whose artifact holds the session log.
- The workflow passes the draft job's retry deadline with 30 seconds reserved for failure handling. When invoking `scripts/formal-ai-draft.mjs` directly, set `HIVE_MIND_DEADLINE_AT_MS` to the caller's absolute Unix deadline in milliseconds. The script defaults to 19 minutes and 30 seconds from process start, including image pulls, for a 20-minute attempt. It forwards the deadline and any `HIVE_MIND_INITIAL_TRANSIENT_ERROR_DELAY_MS`, `HIVE_MIND_MIN_TRANSIENT_ERROR_DELAY_MS`, and `HIVE_MIND_MAX_TRANSIENT_ERROR_DELAY_MS` overrides to `solve`.

### Checks on the pull request

A pull request opened with the default token starts no `pull_request` runs, and the checks dispatched on its head are attached to no pull request. The `report-checks` job therefore posts each dispatched run as a commit status (`dispatched / release.yml`, …) on the draft head and keeps it current until the run finishes, so the draft shows its checks.

`--auto-merge` and `--auto-close-pull-request-on-fail` are never passed. Both default to off; `tests/formal-ai-draft-2233.test.mjs` asserts they stay absent, because turning either on would break the failure policy silently.

## The failure policy

This is the part to read before touching a draft.

1. **A failed draft stays open and red.** It is not fixed. It is not reverted. It waits for a later run to succeed. Red is the measurement; making it green by hand destroys the measurement.
2. **A draft is never hand-corrected and merged.** The workflow puts the pull request back into draft after the session (solve marks it ready-for-review at session end, per [#2123](https://github.com/link-assistant/hive-mind/issues/2123)/[#2182](https://github.com/link-assistant/hive-mind/issues/2182)), and GitHub refuses to merge a draft. If a draft happens to contain the right change, the right response is to note that in the issue and let a normal run produce a normal pull request — not to adopt the draft branch.
3. **A poor draft is closed, and the defect is filed against the meta algorithm.** Not patched on the branch. The question to answer in the new issue is "why did the algorithm produce this", not "how do I make this diff correct". Link the closed draft and its session log from the new issue.
4. **No human commit ever lands on a draft branch.** A human commit makes the branch unusable as evidence: it can no longer be said what the model produced. If a branch needs a human commit, it needs to be a different branch.

A draft is identifiable by the `formal-ai-draft` label (the workflow creates it the first time it is missing) and by its branch name, `issue-<number>-<suffix>`.

## Setup

No credential setup is required. Every write workflow uses the same resolver:

| Layer          | Optional configuration                                               | Check strategy    |
| -------------- | -------------------------------------------------------------------- | ----------------- |
| GitHub App     | Variable `AUTOMATION_APP_ID` and secret `AUTOMATION_APP_PRIVATE_KEY` | `pull_request`    |
| Personal token | One secret `AUTOMATION_TOKEN`                                        | `pull_request`    |
| Default        | Built-in `github.token`                                              | `dispatch-checks` |

The first configured, working layer wins. `AUTOMATION_TOKEN` needs repository contents, issues and pull requests write access; dispatching checks also requires Actions write. The default workflow declares these permissions itself. `FORMAL_AI_DRAFT_IMAGE` remains an optional variable (default `konard/hive-mind:<version>`).

Default-token pull requests can create workflow runs waiting for approval. The draft immediately dispatches `release.yml`, `security.yml`, `links.yml` and `workflows.yml` on its head with `mode=checks`; these workflow files exist on the default branch. Manual dispatch defaults to checks, and publishing requires an explicit release mode on `main`. The job summary names the selected layer. Missing optional credentials never deny an eligible draft.

The shared actions requested in [link-foundation/.github#1](https://github.com/link-foundation/.github/issues/1) have not been published. Local compatibility actions under `.github/actions/` implement that input/output contract; replace their `uses:` paths when the shared actions ship. A daily health job reports actual attempts over seven days and fails if eligible issues received none. It also fails when the last five draft runs ended with the same decision code or primary outcome. The report links the exact runs and jobs. Older runs use a labeled annotation fallback.

## Running a draft from another repository

The workflow is reusable (`workflow_call`), so `link-assistant/formal-ai` can try a build on a real issue before it is released:

```yaml
jobs:
  draft:
    uses: link-assistant/hive-mind/.github/workflows/formal-ai-draft.yml@main
    with:
      issue_number: '42'
      formal_ai_binary_artifact: formal-ai-linux-x64
    secrets: inherit
```

| Input                       | Meaning                                                                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `issue_number`              | Issue in the caller's repository to draft. Omit it when the caller itself runs on `issues: opened`.                                           |
| `image`                     | hive-mind image to run instead of `konard/hive-mind:<version>`.                                                                               |
| `formal_ai_binary_artifact` | Name of an artifact of the calling run holding a file named `formal-ai`. It is mounted read-only over the image's `/usr/local/bin/formal-ai`. |
| `hive_mind_repository`      | Repository whose draft scripts are checked out (default `link-assistant/hive-mind`).                                                          |
| `hive_mind_ref`             | Ref of that repository to check out (default: its default branch).                                                                            |

The binary must run on the image's Ubuntu base (glibc). When called, the workflow does not dispatch this repository's checks and does not run its health job; `issues: opened` here works as before.

## Opting out, and re-running

- Add the `no-formal-ai-draft` label to an issue template, or to the issue before opening it, to suppress the attempt.
- Issues opened by a bot are skipped: two automations feeding each other produces noise, not evidence.
- To re-attempt an issue, run the workflow manually (`Actions → Formal AI Draft → Run workflow`) with the issue number. A manual replay is treated as a fresh `opened` event.

## Reading a failed draft

The `formal-ai-draft-session-<issue>` Actions artifact retains sanitized solve logs and `formal-ai-draft-outcome.json` for 30 days. The Actions artifact remains available when optional pull-request log publication through `--attach-logs` fails. The attempt annotation identifies the primary cause. The final outcome annotation records whether the artifact was uploaded and how many solve logs it contains.

### Shared outcome contract

The JSON schema identifier is `hive-mind/formal-ai-draft-outcome/v1`. The direct launcher writes `formal-ai-draft-outcome.json` beside its logs and exposes a compact `draft_outcome` step output before exiting. The reusable workflow returns `draft_outcome` with the actual Actions upload receipt. The JSON inside the artifact predates that upload, so its Actions status is `unconfirmed`. After upload, the final annotation and workflow output carry the artifact URL.

| Field                  | Meaning                                                                                                                                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `primary`              | Stable code, the stage reached, and a readable message.                                                                                                                                                                     |
| `task`                 | Target and requested repository change, attempt kind, observed diff, and obligation acceptance. An implementation diff after a successful process is useful for review. Acceptance still requires independent verification. |
| `solver` and `process` | Terminal state and its source, process launch, numeric exit code, and signal when available. The launcher labels observations from older solve images `legacy-log`.                                                         |
| `runtime`              | Workflow source and image, solver and client versions, observed serving backend, and SHA-256 of any mounted Formal AI binary. Unobserved values are null.                                                                   |
| `infrastructure`       | Workflow readiness or the failed stage. For a pre-effect deferral it records pending prerequisites and the absence of an effect claim.                                                                                      |
| `evidence` and `links` | Optional external publication failures and recovery, Actions artifact custody, and run and job URLs.                                                                                                                        |

Health uses the primary code and stable cause from the structured annotation. A run with only old annotations uses a labeled legacy fallback. It can only report the historical text it has. An unreadable diff remains unverified. A diff of logs, solver markers, and session metadata receives no useful-change credit.

The Formal AI workflow already invokes the shared launcher. Its result consumer can decode the `draft_outcome` step output with `parseDraftOutcome` in `scripts/formal-ai-draft-outcome.lib.mjs` or read the JSON file. The caller can publish the final receipt with `scripts/formal-ai-draft-evidence.mjs --finalize` after its own artifact upload. Pass the upload step's outcome and artifact URL through `FORMAL_AI_DRAFT_ARTIFACT_STATUS` and `FORMAL_AI_DRAFT_ARTIFACT_URL`, and the sanitized solve log count through `FORMAL_AI_DRAFT_SESSION_LOGS` when available. Set `RUNNER_NAME` from the job's runner context for the numeric job link. The caller owns result verification and reporting. [Formal AI #1488](https://github.com/link-assistant/formal-ai/issues/1488)

For admission decisions that precede the launcher, `makeDraftOutcome` accepts the Formal AI `formal-ai-hive-client-outcome/v1` deferral receipt and a process with `started: false`. Deferral carries zero execution and authorship credit and requires proof that effects were unclaimed. For a verified no-op, pass `attemptKind: 'continuation'`, an observed empty or diagnostics-only diff, and trusted verification of the same immutable source and the required passing checks. A first attempt without changes has no implementation or acceptance credit. [Formal AI #1485](https://github.com/link-assistant/formal-ai/issues/1485)

The October 30 replay used solve 2.39.9 with Formal AI 0.355.15. The requested investigation produced no implementation and returned `planned_not_executed` with exit 5. Gist and shared-repository uploads returned HTTP 403, a PR-branch fallback succeeded, and the Actions session artifact was retained. The screenshots in the original issue show the open Dependabot PRs and the originating Hive execution. The underlying Dependabot failure was outside this replay's findings. [Original issue](https://github.com/link-assistant/hive-mind/issues/3863) · [Exact job](https://github.com/link-assistant/hive-mind/actions/runs/41081977243/job/124153176671) · [Session artifact](https://github.com/link-assistant/hive-mind/actions/runs/41081977243/artifacts/12990367865)

## When formal-ai publishes its composite action

[Issue #2233](https://github.com/link-assistant/hive-mind/issues/2233) asks for the reusable action `link-assistant/formal-ai` is repackaging out of its `self-authored-pull-request.yml`. That action is not published yet — see [`docs/case-studies/issue-2233/`](case-studies/issue-2233/README.md) for the evidence as of this writing. `uses:` does not accept expressions, so there is no way to write a workflow that picks up the action automatically the day it appears.

The swap is one step. Replace the `Open the Formal AI draft` step in `.github/workflows/formal-ai-draft.yml` with a `uses: link-assistant/formal-ai@<tag>` step and give it the same inputs the script builds today. Everything else — the trigger, the skip decisions, the concurrency group, the failure policy, the artifact — is independent of who executes the attempt. Keep `scripts/formal-ai-draft.lib.mjs` and its test: the decision of _whether_ to attempt is Hive Mind's, not the action's.
