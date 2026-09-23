# CI Timeout Budgets

`timeout-minutes` is a backstop, never the deadline.

## Why a backstop is not enough

GitHub reports a job killed by `timeout-minutes` as **cancelled**, not
**failed**. `scripts/check-pipeline-status.sh` turns an unexplained cancellation
into an error. It excuses a cancellation only when the tested commit is no
longer the branch head _and_ that specific job has a literal
`cancel-in-progress: true`; `false`, inherited defaults, expressions, and
unreadable workflow configuration all fail closed. Before this per-job check,
a moved pull request branch could make a genuine suite timeout look like a
harmless superseded run. Even on `main`, the resulting error could not say which
deadline was blown, because no step owned a deadline.

Reproduction:

```yaml
jobs:
  demo:
    runs-on: ubuntu-latest
    timeout-minutes: 1
    steps:
      - name: Slow suite
        run: sleep 120
```

Pushed on a non-default branch this yields conclusion `cancelled`, the
annotation `The job has exceeded the maximum execution time of 1m0s`, and only
`::warning::Cancelled jobs: demo`. Nothing is red.

The failure mode is not hypothetical. In `link-assistant/formal-ai` run
31937348472 a test job spent 133 seconds on unbudgeted setup, started a step
whose 480-second budget would have expired at 09:09:44.9Z, and was killed by
the 600-second job cap at 09:09:43.6Z — 1.3 seconds too early for the budget to
fire. The job reported `cancelled`, the run reported `cancelled`, and the
dependent release workflow reported `skipped`.

## Per-test timeouts do not bound a suite

`bun test --timeout 30000` and `node --test --test-timeout=30000` bound a
**single test** at 30 seconds. They do not bound the suite: 25 tests that each
take 29 seconds pass every per-test check and still blow a 10-minute job cap.
Keep them — a hung test is worth catching early — but do not treat them as a
suite deadline.

## The rule

Every long step owns an explicit budget, and every budget expires before the
job's backstop fires.

- **`run:` steps** wrap their command in
  [`scripts/run-with-budget-warning.sh`](../scripts/run-with-budget-warning.sh):

  ```yaml
  - name: Run tests (Node.js)
    shell: bash
    run: bash scripts/run-with-budget-warning.sh 300 "Node.js test suite" npm test
  ```

- **`uses:` steps** cannot be wrapped, so they declare a step-level
  `timeout-minutes`. An exhausted _step_ budget fails the step; only an
  exhausted _job_ cap cancels the job.

  ```yaml
  - name: Build Docker image (no push)
    timeout-minutes: 20
    uses: docker/build-push-action@v7
  ```

## What the wrapper does

`scripts/run-with-budget-warning.sh SECONDS LABEL COMMAND [ARG...]`:

- Runs the command in its own **process group** (`set -m`). `npm test` and
  `bun test` spawn workers, and killing only the direct child leaves orphans
  holding the runner — which is also why `timeout(1)` is not sufficient.
- Emits `::warning` at 70% of the budget, while the overrun can still be acted
  on.
- On expiry emits
  `::error title=<label> exceeded its execution budget::…`, sends `SIGTERM` to
  the group, waits a grace period, then sends `SIGKILL`. On GitHub-hosted
  runners it can use passwordless `sudo` to reach privileged descendants and
  reports any process it still could not terminate.
- Captures and relays stdout and stderr separately, so a surviving descendant
  cannot inherit the CI step's pipe and hold the step open.
- Keeps wrapper-owned state under `RUNNER_TEMP`, independently of a wrapped
  command that clears its own `TMPDIR`.
- Exits **124** on termination, matching `timeout(1)`. Otherwise it passes the
  command's own exit code through unchanged.

Overrides: `BUDGET_WARN_PERCENT` (default 70), `BUDGET_GRACE_SECONDS`
(default 10), `BUDGET_KILL_SECONDS` (default 5), `BUDGET_POLL_SECONDS`
(default 1), `BUDGET_SUDO_KILL` (default 1), `BUDGET_CAPTURE_OUTPUT`
(default 1), `BUDGET_STATE_PARENT` (defaults to `RUNNER_TEMP`, then `TMPDIR`),
and `BUDGET_VERBOSE` (default 0).

On Windows runners Git Bash may not support process groups; the wrapper falls
back to signalling the direct child.

## The invariant

`tests/ci-timeouts.test.js` asserts, for every job that declares budgets, that

- each individual budget is at most **70%** (`MAX_BUDGET_SHARE_PERCENT`) of the
  job's `timeout-minutes`, and
- the budgets in a job sum to at most 70% of that cap, leaving headroom for the
  unbudgeted setup — checkout, `npm ci`, the Bun install — that runs on the same
  job clock.

This invariant is what finds the _next_ occurrence rather than the one that
already failed. In the reference incident the same sweep immediately surfaced a
job at 1415s of a 1500s cap and another with no `timeout-minutes` at all,
neither of which was involved in the original failure.

## Current budgets

| Job                    | Backstop | Step budgets                                    |
| ---------------------- | -------- | ----------------------------------------------- |
| `test`                 | 15 min   | Node.js 300s, Bun 200s, Deno 100s               |
| `docker-build`         | 30 min   | image build 20 min                              |
| `docker-publish-build` | 30 min   | image build and push 20 min                     |
| `release`              | 30 min   | install 240s, npm publish 420s, smoke test 300s |

## Reference

`link-assistant/formal-ai` PR #1018 (`scripts/run-with-budget-warning.sh`, the
`MAX_BUDGET_SHARE_PERCENT` invariant, and the incident reconstruction).
