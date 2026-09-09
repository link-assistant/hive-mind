# Case study: issue #2233 — the action to install does not exist yet

Issue: https://github.com/link-assistant/hive-mind/issues/2233.
Pull request: https://github.com/link-assistant/hive-mind/pull/2234.
Evidence: everything quoted here is committed under [`data/`](data/) and listed in [`MANIFEST.md`](MANIFEST.md).

## Executive summary

Issue #2233 asks Hive Mind to "install the reusable composite action formal-ai is publishing" on `issues: opened`. Measured on 2026-09-09, that action is not published. `link-assistant/formal-ai` has no root `action.yml`, its `.github/actions` directory holds four unrelated build helpers, and the `self-authored-pull-request.yml` the action is said to be repackaged out of is not among the twenty workflows in `.github/workflows`. There is no way to defer the decision, either: `uses:` does not accept expressions, so a workflow cannot pick up an action on the day it appears.

So the deliverable is built on the issue's own second item — Hive Mind's `solve --tool agent --model formal-ai --attach-logs --verbose` path — with the action swap documented as a one-step replacement in [`docs/FORMAL-AI-DRAFTS.md`](../../FORMAL-AI-DRAFTS.md). The decision of _whether_ to attempt a draft stays in Hive Mind (`scripts/formal-ai-draft.lib.mjs`), because it is a policy question, not an implementation detail of the runner.

## The measurements

### 1. There is no composite action to install

| Probe                                                              | Result                                                                                                                          | Evidence                               |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `gh api repos/link-assistant/formal-ai/contents/action.yml`        | `404 Not Found` — the repository root exposes no composite action.                                                              | `data/formal-ai-action-yml-404.json`   |
| `gh api repos/link-assistant/formal-ai/contents/.github/actions`   | Four directories: `cache-cargo-registry`, `download-formal-ai-binary`, `setup-buildx-resilient`, `setup-sccache`. None authors. | `data/formal-ai-github-actions.json`   |
| `gh api repos/link-assistant/formal-ai/contents/.github/workflows` | Twenty workflows; no `self-authored-pull-request.yml`.                                                                          | `data/formal-ai-github-workflows.json` |

The closest match by name, `download-formal-ai-binary`, fetches a build artifact — it does not open a pull request.

### 2. The draft command survives solve's own parser

A flag typo in the workflow would fail ninety minutes into a container run, in a log nobody reads. `experiments/issue-2233/probe-solve-argv.mjs` feeds the command line that `buildSolveArgv()` produces to solve's real `createYargsConfig`, and `tests/formal-ai-draft-2233.test.mjs` keeps doing so on every run.

Two facts the probe established that an assumption would have got wrong (`data/probe-solve-argv.log`):

- solve declares `.command('$0 <issue-url>')` (`src/solve.config.lib.mjs:818`), so the URL binds to `argv.issueUrl` and **`argv._` comes back empty**. The first version of the test asserted `argv._ === [ISSUE_URL]` and failed against a correct command line.
- `--no-auto-restart-until-mergeable` arrives as `autoRestartUntilMergeable: false`; boolean-negation is on, so the negated spelling is real rather than an unknown argument silently absorbed.

The same probe shows `.strict()` rejecting `--attatch-logs` with "Unknown argument", which is what makes the positive assertions load-bearing.

### 3. `github-actions[bot]` can author every commit without a config file

The done-when condition includes "no human commit on its branch", while `solve` refuses to run unless git has a `user.name` and `user.email` (`src/git.lib.mjs:244`). Both hold at once only if git takes the identity from the environment. `experiments/issue-2233/probe-git-identity.sh` measures it (`data/probe-git-identity.log`):

```
git config user.name  -> github-actions[bot]
commit author         -> github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>
commit committer      -> github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>
```

`GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_n` / `GIT_CONFIG_VALUE_n` is therefore what `buildGitIdentityEnv()` emits, rather than a `git config --global` call whose file may or may not be inside the mounted `HOME`.

## The two design decisions worth recording

**A personal access token, not `GITHUB_TOKEN`.** GitHub does not trigger `pull_request` workflows for a pull request opened with `GITHUB_TOKEN`. A draft opened that way has no checks, and a draft with no checks cannot "stay open and red until a later run succeeds" — the failure policy in #2233 item 3 would be unobservable. Hence the required `FORMAL_AI_DRAFT_TOKEN` secret, and hence a workflow that _skips_ rather than fails without it, so forks stay green.

**The draft is put back into draft.** `solve` marks its pull request ready-for-review at session end (`src/pr-draft-state.lib.mjs`, #2123/#2182). The workflow runs `gh pr ready <n> --undo` afterwards. This is not cosmetic: GitHub refuses to merge a draft, so "never hand-corrected and merged" is enforced by the platform rather than by a convention someone has to remember.

## What #2233 asked for, and where it landed

| #2233                                                                      | Where                                                                                           |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1. Trigger on `issues: opened`, not a curated label                        | `.github/workflows/formal-ai-draft.yml`                                                         |
| 2. Point at `solve --tool agent --model formal-ai --attach-logs --verbose` | `DRAFT_SOLVE_FLAGS` in `scripts/formal-ai-draft.lib.mjs`, parsed under test                     |
| 3. Failure policy for a draft                                              | [`docs/FORMAL-AI-DRAFTS.md`](../../FORMAL-AI-DRAFTS.md), four numbered rules, in four languages |
| Done-when: four trailers + evidence bundle                                 | `--attribution formal-ai` (#2229/#2230, v2.24.0)                                                |
| Done-when: no human commit on the branch                                   | `buildGitIdentityEnv()`, measured above                                                         |
| Done-when: a failed draft leaves its session log attached                  | `--attach-logs --verbose`, plus the `!cancelled()` artifact upload for runs that opened no PR   |

## The one local test failure, and why it is not this branch

Running the full suite on this branch, `tests/test-graceful-shutdown-waits-1823.mjs` failed one assertion in Suite 5:

```
❌ FAIL: non-detached child IS interrupted by the group SIGINT (reproduces the bug)
   marker="", stdout="READY\nHARNESS_SIGINT\nCHILD_CLOSED:null\n"
```

It is a race in the test, and it is older than this branch.

The mechanism is readable in the output. The test's harness prints `READY` as soon as `spawn()` returns, then the test waits a fixed 150 ms and sends `SIGINT` to the whole process group. But `spawn()` returning does not mean the child has run any JavaScript: it is still booting node, and it has not yet reached `process.on('SIGINT', …)`. If the signal arrives first, the default disposition kills the child — so no marker file is written, and the harness reports `CHILD_CLOSED:null` (killed by a signal) instead of `CHILD_CLOSED:1` (the handler's `process.exit(1)`). `null` for the exit code is the tell.

`experiments/issue-2233/probe-graceful-shutdown-race.sh` runs the file five times per cell, with and without sixteen busy-loop workers on a six-core machine ([`data/probe-graceful-shutdown-race.log`](data/probe-graceful-shutdown-race.log)):

| Runs passing  | no added load | 16 CPU workers |
| ------------- | ------------- | -------------- |
| `origin/main` | 5 / 5         | 2 / 5          |
| this branch   | 5 / 5         | 1 / 5          |

The assertion fails on `origin/main` with nothing from this branch applied, and only under contention. The static check agrees: the file loads exactly one repository module, `src/exit-handler.lib.mjs`, and `git diff origin/main --name-only` shows this branch adds nothing under `src/` — only two new files under `scripts/`.

Fixing it is out of scope here — it belongs to #1823 — but the fix is to have the child announce its own readiness rather than infer it from `spawn()`, so the signal is sent after the handler is installed instead of 150 ms after an unrelated event.

## When the action does appear

Replace the `Open the Formal AI draft` step with `uses: link-assistant/formal-ai@<tag>` and pass it the same inputs the script assembles. The trigger, the skip decisions, the concurrency group, the failure policy and the artifact are all independent of who executes the attempt, so nothing else moves.
