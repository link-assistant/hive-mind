# Evidence manifest — issue 2160

## Inventory

| Path                                                                                       | Contents                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data/run-logs/hive-run-4c1dedd8-a645-479c-84ce-72a0f8d7d179.log.gz`                       | The complete `/hive` run log attached to issue 2160 — 259 311 lines, 23 527 316 bytes raw, 3 124 866 bytes gzipped, sanitized (see below)                                          |
| `data/run-logs/index.json`                                                                 | Source URL, Gist id and revision, line count, and SHA-256 of the source, sanitized and compressed bytes                                                                            |
| `data/github/hive-mind-issue-2160{,-comments,-events}.json`                                | The report itself, its comments and its timeline events                                                                                                                            |
| `data/github/hive-mind-pr-2162{,-conversation-comments,-review-comments,-reviews}.json`    | The fix PR, with all three GitHub feedback streams                                                                                                                                 |
| `data/github/router-issue-1{86..95}{,-comments,-events}.json`                              | Every target-repository issue the run queued. #192–#195 carry the four "🚨 Solution Draft Failed" comments the run posted (`5309611320`, `5309612206`, `5309613009`, `5309613759`) |
| `data/github/router-pr-19{6..201}{,-conversation-comments,-review-comments,-reviews}.json` | The six solution drafts `--auto-merge` merged — the direct disproof of `0/6 issues have open PRs`                                                                                  |
| `data/github/router-pr-202{,…}.json`                                                       | The follow-up run that solved #192–#195, proving those four issues were never the problem                                                                                          |
| `upstream/claude-code-jsonl-usage-duplication.md`                                          | Verbatim text of the upstream report for the JSONL token duplication (P8), filed as [anthropics/claude-code#87303](https://github.com/anthropics/claude-code/issues/87303)         |

65 JSON files (540 KB) plus 3.0 MB of compressed log.

## Acquisition

Everything was fetched by
[`experiments/issue-2160-fetch-evidence.mjs`](../../../experiments/issue-2160-fetch-evidence.mjs):

```bash
node experiments/issue-2160-fetch-evidence.mjs
```

It uses `gh` for every call, so authenticated access keeps working:

- `gh issue view --json …` and `gh pr view --json …` for entity details;
- `gh api repos/<repo>/issues/<n>/comments --paginate`, `…/events`,
  `gh api repos/<repo>/pulls/<n>/comments`, `…/reviews` — GitHub exposes PR conversation comments,
  inline review comments and reviews through three different endpoints, and all three are captured;
- `gh gist view <id> --raw` for the run log.

The script is idempotent: the log is gzipped with `{ level: 9, mtime: 0 }` so an unchanged source
produces a byte-identical file, and re-running it only rewrites what actually changed upstream (the
`generatedAt` field in `index.json` aside).

## Integrity verification

```bash
cd docs/case-studies/issue-2160/data
sha256sum run-logs/hive-run-4c1dedd8-a645-479c-84ce-72a0f8d7d179.log.gz
# f2be879c17334fd51cafb0efa407caa00aead43ffa08242dbd87eda770bd738e  (gzipSha256)
gzip -cd run-logs/hive-run-4c1dedd8-a645-479c-84ce-72a0f8d7d179.log.gz | sha256sum
# 632f8eb9040d058d9a7296c4785dc4be810844e293953f865f835ba3e758c9d2  (rawSha256)
```

`sourceRawSha256` (`1a255f31…`, 23 537 621 bytes) is the hash of the Gist **before** sanitization. It
is recorded so an authorized investigator can confirm that the committed copy derives from the exact
Gist revision `e9a04a390eef2b10f379a3a49316f3cbd3487554`; it will not match the committed file, and
that difference is exactly the redaction below (10 305 bytes removed).

## Redaction

`sanitizeLog()` in the fetch script rewrites, before anything is committed:

| Pattern                                     | Replacement        |
| ------------------------------------------- | ------------------ |
| `user.account_id="…"`, `user.email="…"`     | `"[REDACTED]"`     |
| `github_pat_…`, `ghp_/gho_/ghu_/ghs_/ghr_…` | `[REDACTED]`       |
| `Bearer <token>`, `sk-…`                    | `[REDACTED]`       |
| `/tmp/gh-issue-solver-<id>`                 | `<workspace:<id>>` |

Workspace paths keep their numeric id on purpose: the disk-exhaustion timeline can only be
reconstructed by telling one worker's workspace from another's.

## Reading the large log

The decompressed log exceeds any reasonable single read; use 1 500-line windows:

```bash
LOG=docs/case-studies/issue-2160/data/run-logs/hive-run-4c1dedd8-a645-479c-84ce-72a0f8d7d179.log.gz
gzip -cd "$LOG" | sed -n '1,1500p'            # startup: image, flags, 74938MB free, 10 issues
gzip -cd "$LOG" | sed -n '248700,250200p'     # the four disk-blocked tasks (20:51:54-20:52:35)
gzip -cd "$LOG" | sed -n '259200,259311p'     # final summary: 0/6 open PRs, 4 failed, exit 1
gzip -cd "$LOG" | grep -n 'Disk space check'  # the per-task free-space series
```

Line numbers used throughout this case study refer to that decompressed stream.

## Images

No issue body, comment, PR description or review in scope contains an image or screenshot, so there
is no image artifact in this bundle. The defects are all log-level, not visual.
