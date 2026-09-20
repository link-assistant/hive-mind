# Formal AI drafts (languages: en • [zh](FORMAL-AI-DRAFTS.zh.md) • [hi](FORMAL-AI-DRAFTS.hi.md) • [ru](FORMAL-AI-DRAFTS.ru.md))

Every issue opened in this repository gets one attempt from Formal AI within minutes, on a branch nobody depends on. A wrong attempt costs nothing. A right one saves the first commit. A failed attempt is not waste either: it fails in public, with its session evidence attached, and that failure is the input the next improvement to the meta algorithm is made from.

This answers [issue #2233](https://github.com/link-assistant/hive-mind/issues/2233).

## What runs

`.github/workflows/formal-ai-draft.yml` triggers on `issues: opened` — not on a curated label, because the point is the volume of evidence per day rather than a human deciding which issues deserve an attempt. It runs one command in the published `konard/hive-mind` image:

```bash
solve <issue-url> \
  --tool agent \
  --model formal-ai \
  --attach-logs \
  --verbose \
  --attribution formal-ai \
  --no-auto-restart-until-mergeable \
  --log-dir /home/box/logs
```

That is Hive Mind's own path, so the drafts are a continuous, unfaked measurement of whether `solve --model formal-ai` is getting better at real tasks in the repository that owns `solve`.

The commit that results carries the four Formal AI trailers and the evidence bundle ([#2229](https://github.com/link-assistant/hive-mind/issues/2229), [#2230](https://github.com/link-assistant/hive-mind/pull/2230), v2.24.0):

```
Formal-AI-Session: ses_…
Formal-AI-Model: formal-ai
Formal-AI-Evidence: dev/log/self-authored/issue-<n>/evidence
Formal-AI-Pull-Request: https://github.com/link-assistant/hive-mind/pull/<n>
```

Every commit on the branch is authored by `github-actions[bot]`. The identity is set through `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_n` / `GIT_CONFIG_VALUE_n` rather than a config file, so it holds inside the container regardless of whose `HOME` is mounted (`experiments/issue-2233/probe-git-identity.sh` measures this).

Three flags are chosen rather than inherited:

| Flag                                | Why                                                                                                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--attribution formal-ai`           | The trailers and the evidence bundle are the point of the exercise, so they are forced on rather than left to `auto`.                                                                       |
| `--no-auto-restart-until-mergeable` | Defaults to on. Left on, one run watches the pull request's checks and restarts the model until they are green, for up to 24 hours. The failure policy below says the _next_ run does that. |
| `--log-dir`                         | The session log is bind-mounted out of the container and uploaded as a workflow artifact, so it is readable even when no pull request was opened at all.                                    |

`--auto-merge` and `--auto-close-pull-request-on-fail` are never passed. Both default to off; `tests/formal-ai-draft-2233.test.mjs` asserts they stay absent, because turning either on would break the failure policy silently.

## The failure policy

This is the part to read before touching a draft.

1. **A failed draft stays open and red.** It is not fixed. It is not reverted. It waits for a later run to succeed. Red is the measurement; making it green by hand destroys the measurement.
2. **A draft is never hand-corrected and merged.** The workflow puts the pull request back into draft after the session (solve marks it ready-for-review at session end, per [#2123](https://github.com/link-assistant/hive-mind/issues/2123)/[#2182](https://github.com/link-assistant/hive-mind/issues/2182)), and GitHub refuses to merge a draft. If a draft happens to contain the right change, the right response is to note that in the issue and let a normal run produce a normal pull request — not to adopt the draft branch.
3. **A poor draft is closed, and the defect is filed against the meta algorithm.** Not patched on the branch. The question to answer in the new issue is "why did the algorithm produce this", not "how do I make this diff correct". Link the closed draft and its session log from the new issue.
4. **No human commit ever lands on a draft branch.** A human commit makes the branch unusable as evidence: it can no longer be said what the model produced. If a branch needs a human commit, it needs to be a different branch.

A draft is identifiable by the `formal-ai-draft` label and by its branch name, `issue-<number>-<suffix>`.

## Setup

| Name                    | Kind                | Required | Purpose                                                                                                     |
| ----------------------- | ------------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| `FORMAL_AI_DRAFT_TOKEN` | Secret              | yes      | Opens the branch and the pull request, and reads the issue.                                                 |
| `FORMAL_AI_DRAFT_IMAGE` | Repository variable | no       | Overrides the image. Defaults to `konard/hive-mind:latest`; pin a release tag to make a draft reproducible. |

`FORMAL_AI_DRAFT_TOKEN` must be a personal access token, not `GITHUB_TOKEN`. A pull request opened with `GITHUB_TOKEN` does not trigger `pull_request` workflows, so its checks would never run — and a draft that cannot go red cannot "stay open and red until a later run succeeds". It needs `repo` scope (`contents`, `pull_requests` and `issues` write on a fine-grained token).

Without the secret the workflow **skips** rather than fails, with the reason printed in the job log. That keeps forks and unconfigured clones green.

## Opting out, and re-running

- Add the `no-formal-ai-draft` label to an issue template, or to the issue before opening it, to suppress the attempt.
- Issues opened by a bot are skipped: two automations feeding each other produces noise, not evidence.
- To re-attempt an issue, run the workflow manually (`Actions → Formal AI Draft → Run workflow`) with the issue number. A manual replay is treated as a fresh `opened` event.

## Reading a failed draft

1. The session log is attached to the pull request by `--attach-logs`.
2. If no pull request was opened, the same log is the `formal-ai-draft-session-<issue>` artifact on the workflow run, retained for 30 days.
3. `dev/log/self-authored/issue-<n>/evidence` on the branch holds `agent-stream.jsonl` and `session-id.txt` — the model's own record of what it did, not Hive Mind's summary of it.

## When formal-ai publishes its composite action

[Issue #2233](https://github.com/link-assistant/hive-mind/issues/2233) asks for the reusable action `link-assistant/formal-ai` is repackaging out of its `self-authored-pull-request.yml`. That action is not published yet — see [`docs/case-studies/issue-2233/`](case-studies/issue-2233/README.md) for the evidence as of this writing. `uses:` does not accept expressions, so there is no way to write a workflow that picks up the action automatically the day it appears.

The swap is one step. Replace the `Open the Formal AI draft` step in `.github/workflows/formal-ai-draft.yml` with a `uses: link-assistant/formal-ai@<tag>` step and give it the same inputs the script builds today. Everything else — the trigger, the skip decisions, the concurrency group, the failure policy, the artifact — is independent of who executes the attempt. Keep `scripts/formal-ai-draft.lib.mjs` and its test: the decision of _whether_ to attempt is Hive Mind's, not the action's.
