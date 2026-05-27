# Case Study: Issue #1829 — `GitHub compare API not ready - cannot create PR safely`

- Issue: https://github.com/link-assistant/hive-mind/issues/1829
- PR: https://github.com/link-assistant/hive-mind/pull/1831
- Date: 2026-05-27
- Reporter-facing failure: https://github.com/rumaster/tg-games/issues/15#issuecomment-4554290415
- Related prior fixes: [#1536](https://github.com/link-assistant/hive-mind/issues/1536) / [#1726](https://github.com/link-assistant/hive-mind/issues/1726) / [#1756](https://github.com/link-assistant/hive-mind/issues/1756) — "transient GitHub errors must not be fatal."

## Summary

`solve` aborted an otherwise-successful session with:

```
GitHub compare API not ready - cannot create PR safely
```

The user was running (against an external repo, with Codex):

```
solve https://github.com/rumaster/tg-games/issues/15 --think max --tool codex \
  --attach-logs --verbose --no-tool-check --disable-report-issue --language ru
```

The branch was created, the initial commit was made, and the push **succeeded**
(`git push` exit code 0; GitHub even printed the "Create a pull request for
'issue-15-04a58e566c9e'" hint). Then the auto-PR pipeline polled GitHub's
**compare/diff endpoint** to confirm the commits were visible before calling
`gh pr create`. All 5 attempts returned the identical transient error:

```
{"message":"Server Error: Sorry, this diff is temporarily unavailable due to heavy server load.",
 "errors":[{"resource":"Comparison","field":"diff","code":"not_available"}],
 "documentation_url":"https://docs.github.com/rest/commits/commits#compare-two-commits",
 "status":"500"}
gh: Server Error: Sorry, this diff is temporarily unavailable due to heavy server load. (HTTP 500)
```

After 5 attempts (~30s) the readiness gate threw `GitHub compare API not ready -
cannot create PR safely` and terminated the whole session — discarding all the
completed work, even though the branch + commit were already on GitHub and
`gh pr create` (which does not render the full diff) would have succeeded.

The captured data:

- [`data/issue-1829.json`](data/issue-1829.json) — the issue itself.
- [`data/external-comment-4554290415.md`](data/external-comment-4554290415.md) — the full failure comment (with embedded 20 KB log).
- [`logs/solve-failure-2026-05-27.log`](logs/solve-failure-2026-05-27.log) — the extracted `solve` log.
- [`research-sources.json`](research-sources.json) — online corroboration.

## Timeline (from `logs/solve-failure-2026-05-27.log`)

| Time (UTC)          | Event                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 2026-05-27 11:57:46 | `solve v1.72.6` launched for `rumaster/tg-games#15` with `--tool codex --verbose`.                                  |
| 2026-05-27 11:58:16 | Initial commit `69e1374` created; `git branch -vv` shows `issue-15-04a58e566c9e ... [origin/main: ahead 1]`.        |
| 2026-05-27 11:58:16 | `git push -u origin issue-15-04a58e566c9e` invoked.                                                                 |
| 2026-05-27 11:58:49 | Push **succeeds** (exit 0): `* [new branch] issue-15-04a58e566c9e`; GitHub prints the "Create a pull request" hint. |
| 2026-05-27 11:58:49 | `Waiting for GitHub to sync...`                                                                                     |
| 2026-05-27 11:58:52 | Compare attempt 1/5 → HTTP 500 "this diff is temporarily unavailable due to heavy server load" (`not_available`).   |
| 2026-05-27 11:58:56 | Attempt 2/5 → identical 500.                                                                                        |
| 2026-05-27 11:59:03 | Attempt 3/5 → identical 500.                                                                                        |
| 2026-05-27 11:59:12 | Attempt 4/5 → identical 500.                                                                                        |
| 2026-05-27 11:59:22 | Attempt 5/5 → identical 500. `❌ GITHUB SYNC TIMEOUT`.                                                              |
| 2026-05-27 11:59:22 | Throws `GitHub compare API not ready - cannot create PR safely` at `solve.auto-pr.lib.mjs:821` → session ends.      |

## Requirements (from the issue)

1. Find the root cause and fix it.
2. Download all logs/data to `docs/case-studies/issue-1829/` and produce a deep case study (timeline, requirements, root causes, solution plans, known components/libraries).
3. Search online for additional facts/data.
4. If there is not enough data to find the root cause, add debug output / verbose mode to surface it next iteration.
5. If the issue relates to another repository where issues can be reported, file a reproducible report there (with reproducible examples, workarounds, code suggestions).
6. Apply the fix to the **entire codebase** — if the issue exists in multiple places, fix all of them.
7. Plan and execute everything in the single PR #1831.

## Root cause

The auto-PR pipeline in `src/solve.auto-pr.lib.mjs` polls
`GET /repos/{owner}/{repo}/compare/{base}...{head}` as a "readiness gate" before
calling `gh pr create`. The intent (good) is to avoid the "No commits between
branches" error caused by GitHub's eventual consistency after a push.

The bug: the gate conflated **two different failure modes**:

1. **"commits not indexed yet"** — the compare succeeds (`code === 0`) but reports
   `ahead_by === 0`. Retrying is correct; if it never becomes > 0, aborting is correct.
2. **transient diff-RENDERING failure** — the compare endpoint itself returns
   HTTP 500 `"this diff is temporarily unavailable due to heavy server load"`
   (`code: "not_available"`), or a 5xx gateway error. This is **not** about
   indexing: the branch and commit are already on GitHub (the log proves it:
   `[origin/main: ahead 1]` + a successful push), and `gh pr create` does **not**
   render the full diff, so it would succeed.

The gate treated case (2) like case (1): it logged the 500 only in verbose mode,
exhausted its 5 retries, then threw the fatal `GitHub compare API not ready -
cannot create PR safely`, throwing away a completed session.

Two contributing factors:

- **No detector for this error class.** `isTransientNetworkError`
  (`src/github-rate-limit.lib.mjs`, issue #1756) recognises 502/503/504, socket
  hang up, etc., but **not** HTTP 500 + "heavy server load" / `not_available`.
  HTTP 500 was deliberately excluded there because a bare 500 from arbitrary
  endpoints is too broad to retry blindly.
- **The 500 body was buried.** The failure was logged only under `--verbose`, so
  in normal runs there was no signal explaining _why_ the session aborted.

## External factors (data found online)

The compare/diff endpoint **renders** a diff; under load GitHub returns
`500 not_available` ("this diff is temporarily unavailable due to heavy server
load" / "this diff is taking too long to generate"). This is a documented,
transient, server-side condition — see:

- community Discussion [#169082](https://github.com/orgs/community/discussions/169082)
  — "Compare Page Fails to Load … Stuck on Unicorn Screen." The recommended
  workaround is literally _"use the CLI instead … or manually open the PR"_ —
  confirming PR creation does not require the diff to render.
- [github-changelog-generator#920](https://github.com/github-changelog-generator/github-changelog-generator/issues/920)
  — an independent report of the same diff-generation 500 from the compare endpoint.
- [GitHub availability report: April 2026](https://github.blog/news-insights/company-news/github-availability-report-april-2026/)
  and [githubstatus.com](https://www.githubstatus.com/) — brief api.github.com 5xx
  incidents are routine; clients are advised to retry.

This is the same philosophy as #1756: **transient GitHub errors must not be fatal.**

## Fix

### 1. `src/github-rate-limit.lib.mjs` — add `isTransientCompareApiError`

A narrow detector that recognises the compare endpoint's transient failures:
`'this diff is temporarily unavailable'`, `'heavy server load'`, `'not_available'`,
and `http 500/502/503/504`. HTTP 500 is matched **here** (and intentionally still
_not_ in `TRANSIENT_NETWORK_PATTERNS`) because it is only safe to treat 500 as
transient in the compare-endpoint context, alongside the explicit markers.
Exported as a named export and on the default export.

### 2. `src/solve.auto-pr.lib.mjs` — degrade gracefully instead of aborting

- The compare-loop failure branch now logs a **concise warning in normal output**
  (not just `--verbose`), tagging transient errors, so the decision is explainable.
- The `if (!compareReady)` block computes the last compare output **as a string**
  (the command-stream result exposes `stdout`/`stderr` as Buffers, and
  `collectErrorText` returns `''` for a raw Buffer, so the detectors would
  silently no-op otherwise).
- A new branch `else if (compareFailedTransiently)` — guarded by
  `!isRepositoryMismatch` — logs a `⚠️ COMPARE API DEGRADED` explanation and sets
  `compareReady = true`, **falling through to PR creation** instead of throwing.

The degraded path remains safe because the existing downstream safety nets still run:

1. **Branch verification** against the GitHub API (and an explicit re-push if missing).
2. A **local** `git rev-list --count origin/${base}..HEAD` check that throws
   `No commits between base and head` if there genuinely are zero commits.
3. `gh pr create` itself runs through `execGhWithRetry`, which retries transient 5xx.

The original hard errors are preserved for the genuinely-fatal cases: fork-not-a-fork
(404), wrong fork parent, and `ahead_by === 0` (real "no commits") still throw.

### 3. Codebase-wide audit (requirement 6)

All compare-endpoint usages were reviewed:

| Location                                                       | Verdict                                                                                                                                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/solve.auto-pr.lib.mjs` (readiness gate)                   | **Fixed** — degrades gracefully on transient failure.                                                                                                                                       |
| `src/solve.repository.lib.mjs:529` (pre-deletion safety check) | **Intentionally left as-is.** A transient failure keeps `safeToDelete = false`, blocking a _destructive_ repo deletion. Degrading here would risk data loss — the opposite of what we want. |
| `src/solve.branch-divergence.lib.mjs:68`                       | Builds a compare **URL** string; no API call.                                                                                                                                               |
| `src/github.lib.mjs:1223`                                      | Parses a compare **URL**; no API call.                                                                                                                                                      |

The risk profiles differ: degrading is correct for a **non-destructive** action
(creating a PR), and wrong for a **destructive** one (deleting a repo).

### 4. Tests — `tests/test-issue-1829-compare-api-transient.mjs`

- `isTransientCompareApiError` positive cases: the verbatim "heavy server load"
  message, the `gh api` HTTP 500 + `not_available` blob, bare 500, 502/503/504,
  a Buffer-backed stderr, **and the exact verbatim string from this issue's log**.
- Negative cases that must **not** degrade: HTTP 404 (fork mismatch), a literal
  `"0"` (genuine 0 commits), generic errors, `null`/`undefined`/`''`, and a raw Buffer.
- Source-level guarantees on `solve.auto-pr.lib.mjs`: import present, last output
  built as a string, degraded branch sets `compareReady = true` and does **not**
  throw, the original hard-error path and fork-404 path are preserved, and the
  degraded decision is guarded by `!isRepositoryMismatch`.

## Alternatives considered

- **Just widen `TRANSIENT_NETWORK_PATTERNS` to include HTTP 500.** Rejected — a bare
  500 from arbitrary endpoints (e.g. a real server bug) should not be retried
  blindly everywhere. The compare gate is a specific, safe context for it.
- **Skip the compare gate entirely and rely on `gh pr create`.** Rejected — the gate
  still adds value against eventual-consistency "No commits between" errors for the
  `ahead_by === 0` case. We only want to stop treating _transient_ failures as fatal.
- **Increase the retry count / backoff.** Rejected — a multi-minute GitHub diff
  outage would still abort, and the diff is irrelevant to PR creation anyway.

## Reproducing the bug

Deterministically: feed the verbatim error string from
`logs/solve-failure-2026-05-27.log:151` into `isTransientCompareApiError` (now
`true`) and assert the auto-PR gate's degraded-mode source path exists. The new
test file does exactly this. Reproducing the _live_ 500 requires GitHub to be
under load, which is why we capture the exact bytes from the original report.

## Verification

- `node tests/test-issue-1829-compare-api-transient.mjs` → 18/18 pass.
- `node tests/test-execgh-transient-retry-1756.mjs` → still passes (additive change).
- `node tests/test-issue-1774-auto-pr-fork-repo-flag.mjs` → still passes.
- `npm run lint` clean.

## Cross-project follow-ups

The 500 originates at GitHub's compare/diff renderer under load — there is nothing
to file upstream (`gh` already surfaces the error verbatim, and GitHub documents
5xx behaviour on githubstatus.com). The correct action is on our side: stop
treating a transient diff-render failure as a reason to abort PR creation.
