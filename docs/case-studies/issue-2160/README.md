# Issue 2160: `❌ 4 task(s) failed (completed: 6)` — a full disk reported as four task failures

## Executive summary

One `/hive` run against [link-assistant/router](https://github.com/link-assistant/router) on 2026-08-16 solved six issues, merged six pull requests, and still exited `1` with the summary `❌ 4 task(s) failed (completed: 6)`. Nothing was wrong with the four "failed" issues: a follow-up run solved all four the next morning in [router PR #202](https://github.com/link-assistant/router/pull/202).

What actually happened is that the container ran out of disk. Each completed task left its ~10.8 GB solver workspace in `/tmp`, because `--auto-cleanup` defaults to off. Free space fell 74 938 MB → 10 047 MB over the six completed tasks. Hive checked disk space **once**, at startup, so it kept dequeuing work; each of the last four tasks then tripped `solve`'s own `--min-disk-space 10240` pre-flight check, exited `1` after ~7 seconds without ever looking at the issue, and posted a "🚨 Solution Draft Failed" comment on the target repository. Four environment conditions were counted as four task failures.

The same run also mislabelled the work it _had_ completed. The closing summary printed:

```
📋 Issues with solution drafts:
   📊 Batch PR check complete: 0/6 issues have open PRs
   - https://github.com/link-assistant/router/issues/186 (no PR found)
   … (all six)
```

All six pull requests existed — `--auto-merge` had merged them (router #196–#201). The listing only asked GitHub for **open** pull requests, so every successful, merged solution draft was reported as missing.

| Symptom in the run                                               | Truth                                                            | Class          |
| ---------------------------------------------------------------- | ---------------------------------------------------------------- | -------------- |
| `4 task(s) failed`                                               | 4 tasks never started; the host had no disk left                 | False positive |
| 4 × "Solution Draft Failed" comments on router #192–#195         | Nothing was wrong with those issues (all four solved by PR #202) | False positive |
| `0/6 issues have open PRs` + 6 × `(no PR found)`                 | 6 merged pull requests: router #196–#201                         | False negative |
| 26 × `⚠️ Tool result error detected`                             | In-session commands the AI itself handled and continued past     | False positive |
| 4 × `⚠️ Could not rename log file: getLogFile is not a function` | Real defect: a stub accessor was forwarded to the restart path   | Real bug       |
| 2 × `⚠️ WARNING: .gitkeep still exists after cleanup`            | The file pre-existed in the repository; nothing failed           | False positive |
| 10 × `⚠️ Log comment too long (N chars)`                         | Expected: the log is uploaded as a Gist instead                  | Wrong severity |
| 10 × `⚠️ JSONL deduplication: skipped N duplicate entries`       | Expected upstream accounting quirk that dedup already corrects   | Wrong severity |
| 9 × `⚠️ Merge conflicts detected`                                | Real, and already handled by the restart loop                    | Correct        |
| 2 × `❌ CI/CD checks are failing`                                | Real failures in the target repository                           | Correct        |

Eight defects were found and fixed in Hive Mind; details and the fix for each are in [TECHNICAL_ANALYSIS.md](./TECHNICAL_ANALYSIS.md), remaining risk and rejected alternatives in [IMPROVEMENTS.md](./IMPROVEMENTS.md), and the evidence inventory in [MANIFEST.md](./MANIFEST.md).

## Scope and evidence

- The complete run log, attached to issue #2160 as a Gist: 259 311 lines, 23.5 MB raw, stored sanitized and gzipped with source URL, Gist revision, and SHA-256 in [`data/run-logs/`](./data/run-logs/).
- Hive Mind issue #2160 and PR #2162 with all three PR feedback streams (conversation comments, inline review comments, reviews).
- Every target-repository issue the run touched (router #186–#195) with comments and events — including the four "Solution Draft Failed" comments the run posted — and every pull request involved (router #196–#202).
- Upstream verification of [anthropics/claude-code#6805](https://github.com/anthropics/claude-code/issues/6805), the token-accounting duplication the run's dedup message refers to — reproduced first-hand on CLI 2.1.233 and re-filed as [#87303](https://github.com/anthropics/claude-code/issues/87303) because #6805 is closed and locked.

The fetcher is [`experiments/issue-2160-fetch-evidence.mjs`](../../../experiments/issue-2160-fetch-evidence.mjs). No issue, comment, PR description, or review in scope contained an image, so there is no screenshot artifact.

Run identity, from the log header:

| Field        | Value                                                                                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Execution ID | `4c1dedd8-a645-479c-84ce-72a0f8d7d179`                                                                                                                                               |
| Started      | 2026-08-16 17:27:00.094 UTC                                                                                                                                                          |
| Finished     | 2026-08-16 21:17:42.389 UTC, exit code 1                                                                                                                                             |
| Environment  | Docker, image `konard/hive-mind-dind:2.12.2`, container `b97e5250411a`, Node v24.3.0, Claude CLI 2.1.228                                                                             |
| Command      | `hive https://github.com/link-assistant/router --auto-merge --all-issues --once --skip-issues-with-prs --attach-logs --verbose --no-tool-check --disable-report-issue --language en` |
| Concurrency  | 2 workers                                                                                                                                                                            |
| Work found   | `📋 Found 10 open issue(s)`, `📊 Batch PR check complete: 0/10 issues have open PRs`                                                                                                 |
| Startup disk | `💾 Disk space check: 74938MB available (10240MB required) ✅`                                                                                                                       |
| Final disk   | `Disk (/): 7.6 GB available / 192.7 GB total (96.1% used)`                                                                                                                           |

## Timeline

Wall-clock times are the run's own timestamps; workspace-free-space figures are the `💾 Disk space check` line each `solve` prints at start-up, which is the only per-task disk measurement the run made.

| Time (UTC)                     | Event                                                                                                                                            | Evidence                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| 17:27:00                       | Container starts, disk check passes with 74 938 MB free                                                                                          | log line 86                                       |
| 17:27:21                       | Monitoring iteration 1; workers 1 and 2 start; both pre-flight at 74 935 MB                                                                      | log lines 97–100, 355, 359                        |
| 17:28:18                       | Worker 1 opens router PR #197 (issue #186); worker 2 opens PR #196 (issue #187)                                                                  | `router-pr-197.json`, `router-pr-196.json`        |
| 18:06:33                       | PR #197 merged by `--auto-merge`; worker 1 completes #186 after 2 344 s                                                                          | log line 59305                                    |
| 18:07:30                       | Worker 1 starts #188 — pre-flight now 57 507 MB (−17 428 MB for one workspace)                                                                   | log line 59819                                    |
| 19:00:01                       | PR #198 merged (issue #188)                                                                                                                      | `router-pr-198.json`                              |
| 19:01:00                       | Worker 1 completes #188 (3 209 s) and starts #189 — pre-flight 42 391 MB                                                                         | log lines 100933, 101048                          |
| 19:36:41                       | PR #196 merged (issue #187); worker 2 completes #187 (7 749 s)                                                                                   | log line 152927                                   |
| 19:37:42                       | Worker 2 starts #190 — pre-flight 25 673 MB                                                                                                      | log line 153042                                   |
| 20:30:21                       | PR #200 merged (issue #190); worker 2 completes #190 (3 220 s), starts #191 — pre-flight 18 624 MB                                               | log lines 195215, 195777                          |
| 20:51:38                       | PR #199 merged (issue #189); worker 1 completes #189 (6 688 s)                                                                                   | log line 248738                                   |
| 20:51:54                       | Worker 1 starts #192: `❌ Insufficient disk space: 10047MB available, 10240MB required` → `❌ System checks failed` → `solve exited with code 1` | log lines 248853, 248877                          |
| 20:51:55                       | "🚨 Solution Draft Failed / Reason: System checks failed" posted on router #192                                                                  | comment `5309611320`                              |
| 20:52:10 / 20:52:23 / 20:52:35 | Same for #193, #194, #195 — four tasks "failed" in 41 seconds, none attempted                                                                    | comments `5309612206`, `5309613009`, `5309613759` |
| 21:17:20                       | PR #201 merged (issue #191); worker 2 completes #191 (2 819 s) — the last in-flight work                                                         | log line 259273                                   |
| 21:17:42                       | Final summary: `0/6 issues have open PRs`, six × `(no PR found)`, `Completed: 6 / Failed: 4`, `❌ 4 task(s) failed`, exit 1, 7.6 GB free         | log tail                                          |
| 2026-08-17 04:49 → 06:07       | A later run solves #192, #193, #194 and #195 in router PR #202                                                                                   | `router-pr-202.json`                              |

Two facts stand out. First, the four "failures" happened at 20:51–20:52 while worker 2 was still working on #191 — so a worker that waited, or that reclaimed the six finished workspaces, would have had space. Second, the marginal cost of one completed task was 10.8 GB on average (65 GB across six tasks), so with `--min-disk-space 10240` a 75 GB container can never finish ten tasks without reclaiming anything.

## Requirements reconstructed from the issue

| ID  | Requirement (issue #2160)                                                                                                                     | Result                                                                                                                                                                                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Find the root cause of every false positive, false negative, warning, and error in the run and fix them all                                   | Eight defects (P1–P8) root-caused and fixed; three findings confirmed as correct behaviour. See [TECHNICAL_ANALYSIS.md](./TECHNICAL_ANALYSIS.md)                                                                       |
| R2  | Download all logs and data about the issue into `docs/case-studies/issue-2160`                                                                | 65 GitHub JSON snapshots plus the sanitized 23.5 MB run log (gzipped, hashed, indexed). See [MANIFEST.md](./MANIFEST.md)                                                                                               |
| R3  | Deep case study: timeline, requirement list, root causes, solution plans, and a survey of existing components/libraries, with online research | This file (timeline + requirements), [TECHNICAL_ANALYSIS.md](./TECHNICAL_ANALYSIS.md) (root causes + plans), [IMPROVEMENTS.md](./IMPROVEMENTS.md) (library survey, sources)                                            |
| R4  | Where data was insufficient, add debug output/verbose mode for the next iteration                                                             | Per-task disk accounting, reclaim/keep decisions with reasons, and deferral counters are now logged; see "Diagnostics added" in [TECHNICAL_ANALYSIS.md](./TECHNICAL_ANALYSIS.md)                                       |
| R5  | Report defects belonging to other projects upstream, with reproduction, workaround and fix suggestion                                         | One external finding: the Claude Code JSONL token duplication, filed as [anthropics/claude-code#87303](https://github.com/anthropics/claude-code/issues/87303); submitted text preserved in [`upstream/`](./upstream/) |
| R6  | Apply each fix across the whole codebase, not just one call site                                                                              | Every occurrence audited per defect (e.g. both `cleanupTempDirectories` call sites, all three PR-listing consumers of the OPEN-only filter)                                                                            |
| R7  | Do everything in the single pull request                                                                                                      | [PR #2162](https://github.com/link-assistant/hive-mind/pull/2162)                                                                                                                                                      |

## Root causes at a glance

| ID  | Defect                                                                                      | Root cause                                                                                              |
| --- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| P1  | An exhausted disk is reported as `N task(s) failed`                                         | Disk was checked once at startup; a blocked task had no outcome other than "failed"                     |
| P2  | `⚠️ Could not rename log file: getLogFile is not a function`                                | The restart path forwarded a stub instead of the real log accessors                                     |
| P3  | `⚠️ WARNING: .gitkeep still exists after cleanup` for a file that belongs to the repository | The check never asked whether the file existed before the session                                       |
| P4  | 26 × `⚠️ Tool result error detected` for benign in-session tool failures                    | Every `tool_result.is_error` was treated as a session-level error signal                                |
| P5  | Misleading cleanup reason, and an expected long-log fallback logged as a warning            | Message text/severity did not match the actual condition                                                |
| P6  | Six merged solution drafts reported as `(no PR found)`                                      | The listing queried only `OPEN` pull requests, while `--auto-merge` had merged them                     |
| P7  | `--auto-cleanup` was both a silent no-op in one branch and `rm -rf /tmp/*` in the other     | `argv` was not forwarded at one call site; the cleanup deleted whole temp roots including other tenants |
| P8  | Known upstream token-accounting quirk logged as a warning                                   | Wrong severity for a condition the code already corrects                                                |

## Reading the log

The stored log decompresses to 259 311 lines. Read it in chunks of at most 1 500 lines:

```bash
LOG=docs/case-studies/issue-2160/data/run-logs/hive-run-4c1dedd8-a645-479c-84ce-72a0f8d7d179.log.gz
gzip -cd "$LOG" | sed -n '1,1500p'
gzip -cd "$LOG" | sed -n '248700,250200p'   # the four disk-blocked tasks
gzip -cd "$LOG" | sed -n '259200,259311p'   # the final summary
```

Line numbers quoted in this case study refer to that decompressed file.
