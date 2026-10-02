# Issue #2423 — CI/CD false positives on `main`

Evidence: `issue.json`, `main-runs.json`, `links-runs.json`, `ci-logs/`,
`templates/` (link-checker files from both pipeline templates),
`recheck-replay.log` (the new script replayed against the failing URLs).

## Timeline

| Time (UTC) | Event |
| --- | --- |
| 2025-10-14 12:12 | `Cleanup Test Repositories` run 18496075671 (manual `workflow_dispatch`) fails. Logs have expired (`HTTP 410`), so the cause can't be recovered. The workflow has been rewritten since (#2286 auth fix, PAT secret, `gh auth status` gate). |
| 2026-10-02 12:14 | `Broken Link Checker` push run 37005554914 on `c8e6759` fails: 1605 links, 32 errors, **all `[503] Service Unavailable` from github.com** (`ci-logs/run-37005554914.log`). |
| 2026-10-02 15:54–16:42 | Five more PR runs of the same workflow fail the same way: healthy github.com blob URLs get no Web Archive fallback (`ci-logs/links-*.log`). |
| 2026-10-02 | Every reported URL answers 200 when re-requested. A plain Node `fetch` of `github.com/google-gemini/gemini-cli/blob/main/.../validateNonInterActiveAuth.ts` gives 200, 503, 503 on three consecutive calls. |

## Requirements

1. Find all false positives, false negatives, warnings and errors in the listed CI/CD runs and fix them.
2. Compare with the JS and Python pipeline templates and reuse their best practices.
3. If a template has the same problem, report it there.
4. Follow `docs/CI-CD-BEST-PRACTICES.md`.

## Root causes

* **Broken Link Checker (false positive).** github.com throttles anonymous
  HTML blob-page requests from shared runner IPs by returning `503`. lychee's
  `--max-retries 3` retries within seconds, before the throttle lifts. It then
  caches the failure (`Error (cached)`), so one throttled URL turns into
  several errors. `check-web-archive.mjs` treated every 5xx as broken. The
  templates' `recheck-broken-links` step re-checks only failures that have *no*
  status code, and calls a status-coded answer such as 503 "final". That makes
  this a false positive in the templates too.
* **Cleanup Test Repositories.** The run is a year-old manual dispatch with
  expired logs, and it isn't a regression on `main`. There's nothing left to
  fix. (A run that misses a secret already fails fast at `gh auth status`.)
* The other listed runs succeeded.

## Fix (this PR)

* `scripts/recheck-broken-links.mjs` (new): from lychee's errors section, it
  takes the http(s) URLs that failed with 429, 5xx, `ERROR` or `TIMEOUT` and
  re-requests them one at a time, backing off 5 s, 15 s and 30 s. For
  github.com `blob/`/`tree/` URLs it falls back to the authenticated REST
  contents API, which is authoritative and not throttled. A 4xx, or a URL
  that fails definitively anywhere, stays broken. `RECHECK_VERBOSE=true`
  logs every attempt (off by default).
* `.github/workflows/links.yml`: a re-check step was added. The Web Archive
  and fail steps now run only when `steps.recheck.outputs.all_recovered != 'true'`
  (fail-safe `!=`, as in the template). `always()` became `!cancelled()`.
* `scripts/check-web-archive.mjs`: skips URLs listed in `RECOVERED_URLS`.
* `tests/recheck-broken-links-2423.test.mjs`: regression tests.

## Alternatives considered

* `--accept 503` in lychee would also hide a real outage. That's a false negative.
* Adding `github.com/.*/blob/` to `.lycheeignore` would stop checking
  hundreds of links, so dead links would go unnoticed.
* lychee's `--github-token` only helps with API-backed checks, not HTML blob pages.
* Upstream: lycheeverse/lychee#2297 (connect-phase failures are not retried).
