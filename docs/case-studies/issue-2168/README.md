# Case study — Issue #2168: "PR creation failed: GraphQL: Something went wrong while executing your query"

> A `solve` run cloned the repository, created the branch, pushed it, verified
> with the compare API that the branch was one commit ahead of `main` — and then
> died **3.1 seconds later** on the very next command, `gh pr create`. GitHub's
> GraphQL API had answered with an internal error:
> `GraphQL: Something went wrong while executing your query on 2026-08-21T19:28:14Z.
Please include `811E:19A5B0:3A5AA9:37C97F:6A88A6CC` when reporting this issue.`
>
> The call **was** already routed through the retry wrapper added in issue #1756.
> It still did not retry even once. GitHub returns these internal GraphQL faults
> as **HTTP 200 with an `errors[]` payload**, so the classifier — which only knew
> about TCP/TLS faults and the literal strings `http 502` / `http 503` /
> `http 504` — saw no match, declared the error permanent, and aborted the whole
> session. The retry budget was never touched, no diagnosis was logged, and
> GitHub's support reference id was thrown away with the stack trace.

- **Issue:** https://github.com/link-assistant/hive-mind/issues/2168
- **PR:** https://github.com/link-assistant/hive-mind/pull/2173
- **Raw data:** [`data/solve-log.txt`](./data/solve-log.txt) — the full 356-line
  run log referenced from the issue body
  ([original gist](https://gist.githubusercontent.com/konard/d3dadccbaf0561cc2662ae171907e311/raw/fc0e38dfa37fe09f277ed9c123440445f73c8219/tmp-start-command-logs-isolation-docker-d85c3e47-a7c2-4a27-a645-dc7e8302af16.log.txt)).
- **Date of incident:** 2026-08-21, execution `d85c3e47-a7c2-4a27-a645-dc7e8302af16`
  (`solve` v2.12.5, node v20.20.2, Docker container).
- **GitHub support reference id:** `811E:19A5B0:3A5AA9:37C97F:6A88A6CC`

All line numbers below refer to [`data/solve-log.txt`](./data/solve-log.txt).

---

## 1. The run

```
Execution ID: d85c3e47-a7c2-4a27-a645-dc7e8302af16          (line 2)
Timestamp:    2026-08-21 19:26:57.172                       (line 3)
Command:      solve https://github.com/ideav/crm/issues/4804 \
                --tool claude --attach-logs --verbose \
                --no-tool-check --disable-report-issue --language en   (line 4)
Version:      solve v2.12.5, node v20.20.2, docker container
Finished:     2026-08-21 19:28:18.015    Exit Code: 1        (lines 355–356)
```

Total wall-clock: **81 seconds**. Of those, the failing command consumed **3.1**.

## 2. Timeline of events

| Log line | Time             | Event               | What happened                                                                                                                                                                                                        |
| -------- | ---------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2–4      | 19:26:57.172     | Start               | `solve` launched against `ideav/crm#4804` in a Docker container.                                                                                                                                                     |
| —        | 19:27:20         | Banner              | `🚀 solve v2.12.5, node v20.20.2, docker container`                                                                                                                                                                  |
| —        | 19:27:45         | Clone               | Temporary directory `/tmp/gh-issue-solver-1787340465644`, cloning `ideav/crm`.                                                                                                                                       |
| —        | 19:28:00         | Clone done          | `✅ Cloned to: /tmp/gh-issue-solver-1787340465644` (15 s).                                                                                                                                                           |
| 171      | 19:28:00         | ⚠️ Side observation | `gh auth setup-git could not write the global gitconfig: failed to set up git credential helper: failed to run git: error: could not write config file /home/box/.gitconfig: Device or resource busy`                |
| —        | 19:28:01         | Recovery            | `🔑 Configured the gh credential helper for this clone (the global gitconfig is not writable)` — already handled gracefully, the run continued.                                                                      |
| —        | 19:28:02         | Branch              | `🌿 Creating branch: issue-4804-203a323f30b1 from main`, commit `244879a2` "Initial commit with task details".                                                                                                       |
| 228      | 19:28:03         | Push                | `Push command: git push -u origin issue-4804-203a323f30b1`                                                                                                                                                           |
| —        | 19:28:04         | Push OK             | `Push exit code: 0` → `✅ Branch pushed`.                                                                                                                                                                            |
| —        | 19:28:07         | Readiness           | Compare API check: **1 commit(s) ahead of main** — the branch was genuinely ready for a PR.                                                                                                                          |
| **297**  | **19:28:11.478** | **PR create**       | `cd "/tmp/gh-issue-solver-1787340465644" && gh pr create --draft --title "$(cat '/tmp/pr-title-…txt')" --body-file "/tmp/pr-body-…md" --base main --head issue-4804-203a323f30b1 --repo ideav/crm --assignee konard` |
| **302**  | **19:28:14.595** | **💥 Fatal**        | `❌ FATAL ERROR: PR creation failed: GraphQL: Something went wrong while executing your query on 2026-08-21T19:28:14Z. Please include `811E:19A5B0:3A5AA9:37C97F:6A88A6CC` when reporting this issue.`               |
| 325      | 19:28:14         | Stack               | `at handleAutoPrCreation (…/src/solve.auto-pr.lib.mjs:1281:19)` ← `async …/src/solve.mjs:546:24`                                                                                                                     |
| 341      | 19:28:15         | Report              | Failure comment posted to `ideav/crm#4804` (comment id `5374321977`).                                                                                                                                                |
| 355–356  | 19:28:18.015     | Exit                | Exit code `1`. Branch pushed, commit stranded, no PR.                                                                                                                                                                |

**The decisive fact: 19:28:11.478 → 19:28:14.595 is 3.1 seconds.** The retry
policy of the day was 3 attempts with 1 s + 2 s backoff; had a single retry been
attempted the log would show at least 19:28:15.6. It shows nothing. **Zero
retries happened.**

## 3. Root cause

`gh pr create` was _not_ an unguarded call site. Issue #1756 had already routed
it through `execGhWithRetry` → `ghWithRateLimitRetry`, which has two independent
budgets: one for rate limits, one for transient network errors. The transient
classifier looked like this (`src/github-rate-limit.lib.mjs` on `main`, line 300):

```js
const TRANSIENT_NETWORK_PATTERNS = ['i/o timeout', 'dial tcp', 'connection refused', 'connection reset', 'econnreset', 'etimedout', 'enotfound', 'ehostunreach', 'enetunreach', 'network is unreachable', 'temporary failure', 'http 502', 'http 503', 'http 504', 'bad gateway', 'service unavailable', 'gateway timeout', 'tls handshake timeout', 'ssl_error', 'socket hang up', 'unexpected eof'];
```

Every entry is either a **transport-layer** fault or an **HTTP status line**.
GitHub's GraphQL API does not use HTTP status codes to report an internal
execution failure — per the GraphQL spec, it answers **`200 OK`** and puts the
fault in the response body:

```json
{ "data": null, "errors": [{ "message": "Something went wrong while executing your query. This may be the result of a timeout, or it could be a GitHub bug. Please include `811E:…` when reporting this issue." }] }
```

`gh` renders that body as `GraphQL: Something went wrong while executing your
query …` and exits non-zero. The string contains no status code and no socket
error, so `isTransientNetworkError()` returned `false`, `ghWithRateLimitRetry`
classified the failure as permanent, returned immediately, and
`handleAutoPrCreation` (`src/solve.auto-pr.lib.mjs:1281`) threw a fatal error.

**Root cause: the transient-error classifier keyed on HTTP status text, but the
failure class in question is delivered with HTTP 200 inside a GraphQL
`errors[]` payload — a category the classifier had no vocabulary for.**

### 3.1 Contributing causes

| #   | Contributing cause                                                                                                                                                                                                                                                                     | Evidence                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| C1  | The transient-pattern vocabulary was **duplicated** in `src/lib.mjs` and `src/github-rate-limit.lib.mjs` and had drifted apart, so fixing one place would not have fixed the other.                                                                                                    | two independent `*_PATTERNS` arrays on `main`   |
| C2  | The transient budget reused `retryLimits.maxApiRetries` (3 attempts, 1 s + 2 s) — appropriate for rate limits, far too tight for a GitHub-side incident that can last a minute.                                                                                                        | `github-rate-limit.lib.mjs:366-369` on `main`   |
| C3  | **No diagnostics on the non-retry path.** The log never says _why_ the error was considered permanent, and GitHub's support reference id (`811E:…`) was only ever visible inside the fatal message, never captured as a field. Without it, a report to GitHub support is unactionable. | lines 302–325                                   |
| C4  | ~36 network-facing **git** call sites (`git push`, `git fetch`, `git pull`, `git ls-remote`) across `src/*.mjs` had **no retry at all** — issue #1756 covered only the `gh` half, while the issue asks for "any git/github operation".                                                 | `grep -rn 'git push\|git fetch\|git pull' src/` |
| C5  | Making 5xx-class failures retryable creates a **double-write hazard** for `gh pr create`: the first attempt may have created the PR before the response was lost, so a naive retry fails with "a pull request already exists".                                                         | `gh` behaviour, cli/cli#4037                    |
| C6  | Secondary, non-fatal: `gh auth setup-git` cannot write `/home/box/.gitconfig` (`Device or resource busy`) when the file is a bind mount in the Docker isolation image.                                                                                                                 | line 171                                        |

## 4. Prior art — what already exists

Before writing anything, existing components that solve this class of problem
were reviewed:

| Component                                                                                                                                                | Does it solve this?                                                                                                                                                                                                                                                                                                                                     | Verdict                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [`gh` CLI](https://github.com/cli/cli) built-in retry                                                                                                    | **No.** `gh` has no retry for GraphQL 200-with-`errors[]`. Confirmed by [cli/cli#13432](https://github.com/cli/cli/issues/13432): _"No partial result, no retry behavior surfaced by the CLI."_ Also [#7735](https://github.com/cli/cli/issues/7735), [#4037](https://github.com/cli/cli/issues/4037), [#3316](https://github.com/cli/cli/issues/3316). | Cannot be relied upon; the wrapper must own the retry.                                               |
| [`@octokit/plugin-retry`](https://github.com/octokit/plugin-retry.js)                                                                                    | Retries by **HTTP status** (`>= 500`, plus 403 rate limits) via `@octokit/request-error`. A GraphQL 200-with-errors is _not_ retried by default either.                                                                                                                                                                                                 | Same blind spot; also inapplicable — this codebase shells out to `gh`, it does not use Octokit.      |
| [`p-retry`](https://github.com/sindresorhus/p-retry) / [`got`](https://github.com/sindresorhus/got) / [`undici`](https://github.com/nodejs/undici) retry | Generic exponential-backoff harnesses. `p-retry` would be a reasonable engine, but the hard part here is **classification**, not the backoff loop, and the codebase already has a working loop with dual budgets (`ghWithRateLimitRetry`) plus its own `sleep`/`log` conventions.                                                                       | Adopting a dependency would not have prevented this bug. Reuse the in-repo loop, fix the classifier. |
| In-repo `wrapDollarWithGhRetry` (issue #1726/#1756)                                                                                                      | Installs retry on command-stream's `$` **tag** rather than at each call site — the right shape, already proven.                                                                                                                                                                                                                                         | **Extend it** rather than invent a parallel mechanism.                                               |
| In-repo `eslint-rules/no-direct-gh-exec.mjs`                                                                                                             | Statically forbids unguarded `gh` calls.                                                                                                                                                                                                                                                                                                                | **Mirror it** for git.                                                                               |

Corroborating community reports of the same GraphQL fault (transient, resolves
on retry, GitHub asks for the reference id):
[community#27819](https://github.com/orgs/community/discussions/27819),
[#24638](https://github.com/orgs/community/discussions/24638),
[#48097](https://github.com/orgs/community/discussions/48097),
[#24631](https://github.com/orgs/community/discussions/24631).
The commonly cited trigger is query complexity / GraphQL execution timeouts on
large datasets — i.e. **server-side and inherently retryable**.

## 5. Requirements, root causes and solutions

Every requirement stated in the issue, enumerated:

### R1 — "double check if it is possible to do retry for any git/github operation, including this one"

- **Answer for _this_ operation:** yes. The fault is server-side and transient
  (§4). It was not retried because of the classifier gap (§3), not because retry
  was impossible.
- **Answer for git:** yes for `push` / `fetch` / `pull` / `ls-remote` — these are
  idempotent against a remote and safe to re-run verbatim. **`git clone` is
  deliberately excluded**: a partially written destination makes attempt #2 fail
  with _"already exists and is not an empty directory"_. (Repository cloning in
  this codebase goes through `gh repo clone`, which the `gh` wrapper covers.)
- **Answer for writes:** yes, but only with an idempotency guard — see R5/C5.
- **Solution:** `src/transient-errors.lib.mjs` (new, dependency-free leaf module)
  becomes the single source of truth for classification and now recognises the
  GraphQL 200-with-errors family:
  `something went wrong while executing your query`,
  `this may be the result of a timeout`, `or it could be a github bug`,
  `graphql: server error`, alongside the existing transport and 5xx patterns.
  `src/lib.mjs` and `src/github-rate-limit.lib.mjs` both import from it, which
  also closes C1.
- **Budget (C2):** new `retryLimits.maxGitHubTransientRetries` (default **6**,
  `HIVE_MIND_MAX_GITHUB_TRANSIENT_RETRIES`) and
  `initialGitHubTransientDelayMs` (2000) give ~2+4+8+16+32 s of backoff instead
  of 3 s; `maxGitRetries` (default 5, `HIVE_MIND_MAX_GIT_RETRIES`) covers git.

### R2 — "maybe there is some other best way to handle such cases on top of retry — more logging — so we can actually get to the root cause"

- **Root cause of the gap (C3):** the retry loop logged only successes and
  give-ups; the _not retried_ decision was silent, and the support reference id
  was never extracted.
- **Solution:** `describeTransientError()` / `formatTransientDiagnostics()` in
  `src/transient-errors.lib.mjs`, plus `parseGitHubRequestId()` which pulls both
  the `811E:19A5B0:…` support reference and any `X-GitHub-Request-Id` header out
  of the error text. Every non-retry decision in `ghRetry`, `ghCmdRetry` and
  `gitCmdRetry` now emits a verbose line naming the classification, the matched
  (or unmatched) pattern, the attempt counter and the exit code — so the next
  occurrence is diagnosable from the log alone, which is exactly what the issue
  asks for under _"if there is not enough data to find actual root cause, add
  debug output and verbose mode"_.

### R3 — "that should be done not only for this specific case, but for all git/github related requests"

- **Root cause (C4):** ~36 git network call sites with no retry.
- **Solution — architectural:** do **not** edit 36 call sites (the next new call
  site would regress). Instead install the retry on the `$` tag, the pattern
  already used by `wrapDollarWithGhRetry`:
  - new `src/git-retry.lib.mjs` exports `matchGitNetworkCommand()` (a token walk
    that skips `-C`/`-c`/`--git-dir`/`--work-tree`/`--namespace`/`--exec-path`
    and their values before reading the subcommand) and
    `wrapDollarWithGitRetry()`;
  - `wrapDollarWithGhRetry` now also routes non-`gh` **git network** commands
    through `gitCmdRetry`, so every module that already receives the wrapped
    `$` from `src/solve.mjs:9-11` is covered without touching its code;
  - the five agent-CLI modules that acquire their own `$`
    (`agent.lib.mjs`, `codex.lib.mjs`, `gemini.lib.mjs`, `qwen.lib.mjs`,
    `opencode.lib.mjs`) now wrap it with `wrapDollarWithGitRetry`.
- **Solution — enforcement:** new ESLint rule
  `gh-rate-limit/no-unretried-git-network`
  ([`eslint-rules/no-unretried-git-network.mjs`](../../../eslint-rules/no-unretried-git-network.mjs)),
  mirroring `no-direct-gh-exec`. It flags any `$`/`exec`/`execSync` call
  whose command text is a git network subcommand unless the file imports a safe
  wrapper or the `$` was received from the caller (the caller owns the
  wrapper). Scoped to `src/**` — tests drive local fixture repositories and
  `scripts/**` runs against an already-checked-out working copy in CI, where a
  retry would only mask a real failure.

### R4 — "download all logs and data related to the issue … compile to `./docs/case-studies/issue-{id}` … deep case study analysis … timeline … requirements … root causes … solutions … existing components"

- **Solution:** this document, plus [`data/solve-log.txt`](./data/solve-log.txt).
  Timeline §2, root causes §3, prior art §4, requirements §5.

### R5 — idempotency (discovered while implementing R1, C5)

- **Root cause:** once 5xx / GraphQL-500 becomes retryable, a lost response to a
  successful `gh pr create` turns retry #2 into _"a pull request already exists
  for …"_ — converting a transient blip into a hard failure, which is worse than
  the original bug.
- **Solution:** `src/github-pr-idempotency.lib.mjs` —
  `isPullRequestAlreadyExistsError()` and
  `findExistingPullRequestUrl({ owner, repo, headRef, execGh, log })`, which
  strips a `forkowner:` prefix from the head ref and resolves the PR via
  `gh pr list --repo o/r --head <branch> --state all --limit 1 --json url,number,state`.
  Both `gh pr create` call sites in `src/solve.auto-pr.lib.mjs` now go through a
  local `runPrCreate()` that recovers the existing PR URL instead of failing.

### R6 — "if the issue is related to any other repository/project where we can report issues on GitHub, please do so"

- The upstream gap is real and is `gh`'s: it surfaces GraphQL 200-with-`errors[]`
  as a plain non-zero exit with no retry and no machine-readable reference id.
  This is already filed and open upstream as
  [cli/cli#13432](https://github.com/cli/cli/issues/13432) (_"No partial result,
  no retry behavior surfaced by the CLI"_), with
  [#7735](https://github.com/cli/cli/issues/7735) and
  [#4037](https://github.com/cli/cli/issues/4037) covering the same ground.
  Rather than open a duplicate, this run's reproducible evidence — the exact
  command, the reference id `811E:19A5B0:3A5AA9:37C97F:6A88A6CC`, the 3.1-second
  no-retry window, the workaround (classify on message text, not status) and the
  suggested fix (retry GraphQL `errors[]` whose message matches the
  _"Something went wrong while executing your query"_ family, and expose
  `X-GitHub-Request-Id`) — is recorded here and linked from PR #2173 for
  attachment to the existing upstream threads.

### R7 — "fully apply requirements to the entire codebase — if we have the issue in multiple places it should be fixed in all of them"

- Covered structurally by the `$`-tag wrapper (R3) rather than by
  enumeration, and _kept_ covered by the ESLint rule, which fails the build on
  any future unguarded git network call in `src/`.

### R8 — secondary finding: `Device or resource busy` on the global gitconfig

- Line 171: `gh auth setup-git` cannot write `/home/box/.gitconfig` inside the
  Docker isolation image (the file is bind-mounted). This is **already handled**
  — the code falls back to configuring the credential helper per-clone (line 172) and the run proceeded to push successfully. Recorded here so the log line
  is not mistaken for a cause of the failure in a future investigation.

## 6. Verification

| Check                                          | Result                                                                                                                                                                                                      |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/transient-retry-2168.test.mjs`          | 19 tests — transient classification (7), gh retry (2), git network command detection (2), git retry (5), `gh pr create` idempotency (3). The classification tests assert on the **verbatim** issue message. |
| `tests/test-no-unretried-git-network-rule.mjs` | ESLint `RuleTester`: 10 valid + 4 invalid cases.                                                                                                                                                            |
| `experiments/issue-2168-smoke.mjs`             | End-to-end smoke over the wrapper chain.                                                                                                                                                                    |
| `npm run lint`                                 | Clean, with the new rule enabled across `src/**`.                                                                                                                                                           |

**Regression guard:** before the fix, the exact string from the issue title
classifies as non-transient and `wrapDollarWithGhRetry` performs exactly one
attempt; after the fix it classifies as a GitHub server error and the wrapper
performs up to `maxGitHubTransientRetries` attempts. That is the assertion pair
`tests/transient-retry-2168.test.mjs` pins.

## 7. Files changed

| File                                                                                  | Change                                                                                                    |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `src/transient-errors.lib.mjs`                                                        | **new** — single source of truth for transient classification + diagnostics + request-id extraction.      |
| `src/git-retry.lib.mjs`                                                               | **new** — `matchGitNetworkCommand`, `wrapDollarWithGitRetry`.                                             |
| `src/github-pr-idempotency.lib.mjs`                                                   | **new** — "already exists" recovery for `gh pr create`.                                                   |
| `src/github-rate-limit.lib.mjs`                                                       | classifier delegated to the shared module; non-`gh` git network commands routed through `gitCmdRetry`.    |
| `src/lib.mjs`                                                                         | `gitCmdRetry` gained transient classification, diagnostics and an injectable `log`; classifier delegated. |
| `src/config.lib.mjs`                                                                  | `maxGitHubTransientRetries`, `initialGitHubTransientDelayMs`, `maxGitRetries` + env overrides.            |
| `src/solve.auto-pr.lib.mjs`                                                           | both `gh pr create` sites go through the idempotent `runPrCreate()`.                                      |
| `src/{agent,codex,gemini,qwen,opencode}.lib.mjs`                                      | module-level `$` wrapped with `wrapDollarWithGitRetry`.                                                   |
| `eslint-rules/no-unretried-git-network.mjs`, `eslint.config.mjs`                      | **new rule** + registration, scoped to `src/**`.                                                          |
| `tests/transient-retry-2168.test.mjs`, `tests/test-no-unretried-git-network-rule.mjs` | **new tests**.                                                                                            |
| `experiments/issue-2168-smoke.mjs`                                                    | **new** smoke script.                                                                                     |
| `docs/case-studies/issue-2168/`                                                       | this case study + raw log.                                                                                |
