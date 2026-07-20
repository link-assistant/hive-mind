# Case study — issue #2090: not all working sessions are uploaded by `--development-log`

- Issue: [link-assistant/hive-mind#2090](https://github.com/link-assistant/hive-mind/issues/2090)
- Pull request: [link-assistant/hive-mind#2091](https://github.com/link-assistant/hive-mind/pull/2091)
- Evidence source: [link-assistant/formal-ai#809](https://github.com/link-assistant/formal-ai/pull/809) (issue [formal-ai#808](https://github.com/link-assistant/formal-ai/issues/808))
- Related previous work: #1596 (introduced `--development-log`), #2048 (commit the log before the readiness signal)

## 1. Summary

The run that produced formal-ai#809 executed **three** Claude working sessions
(one initial session plus two `--auto-restart-until-mergeable` iterations), each
with its own session UUID. The pull request contains development-log artifacts
for **one** session only, and that single copy of `solve.log` is truncated at the
moment of the first collection — everything the run did afterwards (verification,
auto-merge, two further sessions, ~17,000 further log lines) is absent.

The root cause is not in the agent's behaviour but in hive-mind's own
finalization logic: the finalizer memoized a single collection per process, and
no restart path or exit path ever asked for another one.

## 2. Evidence

All raw evidence is stored next to this document under [`data/`](./data):

| File                                                                                                                                      | What it proves                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| [`data/issue-2090.json`](./data/issue-2090.json)                                                                                          | The issue text and its requirements.                                                                                          |
| [`data/pr-809/pr-809.json`](./data/pr-809/pr-809.json), [`…-conversation-comments.json`](./data/pr-809/pr-809-conversation-comments.json) | The PR metadata and the comments that carry the attached logs.                                                                |
| [`data/pr-809/committed-dev-log/committed-files.txt`](./data/pr-809/committed-dev-log/committed-files.txt)                                | `git ls-tree` of the committed `dev/log/…` tree: exactly **one** `sessions/<uuid>/` directory.                                |
| [`data/pr-809/committed-dev-log/session-a7583710-metadata.json`](./data/pr-809/committed-dev-log/session-a7583710-metadata.json)          | The committed `metadata.json` (`schemaVersion: 2`), the exact `rawCommand` used.                                              |
| [`data/pr-809/attached-logs/complete-process-log-3-sessions.txt.gz`](./data/pr-809/attached-logs/complete-process-log-3-sessions.txt.gz)  | The complete 10.3 MB / 86,883-line process log attached to the PR, containing all three sessions.                             |
| [`data/pr-809/attached-logs/session-and-devlog-markers.txt`](./data/pr-809/attached-logs/session-and-devlog-markers.txt)                  | The grep of `📌 Session ID`, `🔍 Development log finalize`, restart-iteration and commit markers used for the timeline below. |

Two facts, both read directly from that evidence:

1. **Three session UUIDs, one collection.** The complete log contains three
   `📌 Session ID:` markers but exactly one `🔍 Development log finalize:` line
   in 86,883 lines.
2. **A byte-identical duplicate.** `solve.log` and
   `claude-a7583710-….log` in the committed tree share the same blob hash
   `9e63759e…` and the same size, 6,974,911 bytes — 7 MB of pure duplication per
   session.

## 3. Timeline of the failing run

Command (from the committed metadata):

```
solve https://github.com/link-assistant/formal-ai/issues/808 \
  --development-log --deep-analysis --auto-merge --attach-logs --verbose \
  --no-tool-check --disable-report-issue --language en
```

`--auto-merge` implies `--auto-restart-until-mergeable`.

| Log line      | Time (UTC) | Event                                                                                          |
| ------------- | ---------- | ---------------------------------------------------------------------------------------------- |
| 1207          | 08:12:18   | `📌 Session ID: a7583710-f266-4c39-b5cf-8583e137ffd4` — **session 1** starts                   |
| 69789         | 09:25:36   | `🔍 Development log finalize: … session a7583710-…` — the **only** collection of the whole run |
| 69797 / 69800 | 09:25:3x   | `✅ Development log committed` / `✅ Development log pushed`                                   |
| 69979         | 09:26:07   | `🔄 AUTO-RESTART-UNTIL-MERGEABLE MODE ACTIVE`                                                  |
| 70516         | 09:54:10   | `Restart iteration: 1/5`                                                                       |
| 71031         | 09:54:20   | `📌 Session ID: c57c4607-7070-4ba4-b13c-4e56251caf54` — **session 2**, never collected         |
| 80191         | 10:33:51   | `Restart iteration: 2/5`                                                                       |
| 80706         | 10:34:01   | `📌 Session ID: 4b713ee3-58b5-4997-b1ce-953aa0709394` — **session 3**, never collected         |
| 86883         | —          | end of process; no further finalize marker                                                     |

So the collected `solve.log` stops at log line ~69,789 of 86,883: **80 % of the
process log by line count is missing from the pull request**, including both
later sessions.

## 4. Requirements extracted from the issue

| #   | Requirement (from the issue text)                                                                                                                                             | Where it is addressed                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| R1  | Multiple working sessions must all be uploaded; auto-resume with the _same_ session id may update the same file, but a separate session with a _different UUID_ must be added | §6 fix 1 + 2, test 1/4                                   |
| R2  | Collect all working-session logs from formal-ai#809                                                                                                                           | [`data/pr-809/`](./data/pr-809)                          |
| R3  | Download all logs and data into `./docs/case-studies/issue-2090`                                                                                                              | this directory                                           |
| R4  | Deep case-study analysis: timeline, every requirement, root causes, solution plans                                                                                            | §3, §4, §5, §6                                           |
| R5  | Check known existing components/libraries that solve a similar problem                                                                                                        | §7                                                       |
| R6  | Search online for additional facts                                                                                                                                            | §7                                                       |
| R7  | If data is insufficient, add debug output / verbose mode for the next iteration                                                                                               | §6 fix 5                                                 |
| R8  | Report issues to other repositories if they are the cause                                                                                                                     | §8 — not applicable, the defect is entirely in hive-mind |
| R9  | Apply the fix to the whole codebase, everywhere the problem exists                                                                                                            | §6 — all five restart modes and all exit paths           |

## 5. Root causes

### RC1 — the finalizer was memoized once per process

`src/development-log.finalize.lib.mjs` (before this PR):

```js
export const createDevelopmentLogFinalizer = ({ collect, getParams }) => {
  let resultPromise = null;
  return () => {
    if (!resultPromise) resultPromise = Promise.resolve().then(() => collect(getParams()));
    return resultPromise;
  };
};
```

The memoization was introduced for a good reason (#1596: the success path and
the error path must not produce two commits), but it is keyed on _the process_,
not on _the session_. Every call after the first one returns the first session's
result, so sessions 2 and 3 are silently dropped. This is the direct cause of the
symptom reported in the issue.

### RC2 — no restart path invoked the collector

`finalizeDevelopmentLog()` was called only from `src/solve.mjs` (before the
readiness signal and on the two completion paths). Watch mode,
`--auto-restart-until-mergeable`, `--keep-working-until-done`, escalation and
auto-ensure all run their iterations through
`executeToolIteration()` in `src/solve.restart-shared.lib.mjs`, which never
touched the development log. Even with RC1 fixed, nothing would have asked for
the extra sessions.

### RC3 — exit paths bypassed finalization

`safeExit()` was reached without finalization on the usage-limit path, the
tool-failure path, the graceful-shutdown path and the auto-continue hand-off, and
from the modules that import `safeExit` from `exit-handler.lib.mjs` directly
(`solve.error-handlers.lib.mjs`, `solve.repository.lib.mjs`,
`solve.fork-sync.lib.mjs`). The comment on the last call site claimed to
"preserve failed/interrupted sessions too", but a failed session that exits early
was never preserved.

### RC4 — the copied `solve.log` was truncated at collection time

`writeDevelopmentLogArtifacts` copied the whole log file at the instant of
collection. Since #2048 that instant is _before_ the readiness signal, i.e. early
in the run, so everything produced afterwards was lost. Naively re-copying the
whole file per session would instead have produced N copies of the same growing
prefix (≈21 MB for this run).

### RC5 — `solve.log` and `<tool>-<sessionId>.log` were byte-identical duplicates

`copyKnownSessionFiles` copies `${dirname(logFile)}/${sessionId}.log`. When the
tool renames the running log to `<sessionId>.log` (`src/claude.lib.mjs`, the
`sessionLogFile` rename), that path _is_ the current log file, so the same
6,974,911 bytes were committed twice per session.

## 6. The fix

1. **Per-session memoization** (`src/development-log.finalize.lib.mjs`). The
   finalizer keys its memoized collections by session id, accepts a
   `{ sessionId }` override and a `{ force: true }` flag, and serializes
   collections so their log slices cannot interleave. Same UUID → one collection
   (R1, first half); different UUID → its own `sessions/<uuid>/` directory (R1,
   second half).
2. **Collection at the shared restart chokepoint**
   (`src/solve.restart-shared.lib.mjs`). `executeToolIteration()` finalizes the
   session it just finished. Because all five restart modes funnel through this
   one function, the fix covers watch mode, auto-restart-until-mergeable,
   keep-working, escalation and auto-ensure at once (R9).
3. **Finalization on every exit path** (`src/exit-handler.lib.mjs`). `safeExit()`
   forces a final collection. Putting it in the shared exit handler — instead of
   solve.mjs's wrapper — also covers the modules that call `safeExit` directly
   (RC3). It is a no-op when no finalizer is registered, so `hive` is unaffected.
4. **Per-session log slices** (`src/development-log.lib.mjs`). Each collection
   copies only the byte range of the process log produced since the previous
   collection (`logStartByte` … EOF, streamed, never buffering the whole file).
   The union of all session directories is the complete log with no duplication;
   the range is recorded in `metadata.json` as `artifacts.solveLogRange` and the
   schema version is bumped to `3`. A shrinking log (rotation) falls back to a
   full copy.
5. **No duplicate copy and better diagnostics.** A session-file candidate whose
   resolved path is the log file itself is skipped (RC5), and the verbose
   finalize line now reports the session and the byte range being collected
   (R7).

Regression test: [`tests/test-development-log-multi-session-2090.mjs`](../../../tests/test-development-log-multi-session-2090.mjs)
replays this exact scenario — the three real session UUIDs of formal-ai#809, one
growing log file — and asserts three session directories, three commits, disjoint
slices whose concatenation equals the whole log, tail preservation on the forced
exit-time collection, and the absence of the duplicated `<sessionId>.log`.

## 7. Prior art and online research (R5, R6)

- **Claude Code session storage.** Transcripts live at
  `~/.claude/projects/<cwd-with-dashes>/<session-id>.jsonl`, one file per session
  UUID, and a resumed/continued run may be persisted under a _new_ UUID
  ([Claude Code docs — Manage sessions](https://code.claude.com/docs/en/sessions),
  [anthropics/claude-code#26964](https://github.com/anthropics/claude-code/issues/26964)).
  This confirms the issue's premise: "one session = one UUID = one artifact
  directory" is the model the upstream tool itself uses, so hive-mind must mirror
  it rather than assume one session per process.
- **Log rotation libraries** (`winston-daily-rotate-file`, `logrotate`,
  Apache `rotatelogs`) solve the adjacent problem of splitting a growing log into
  size/time-bounded files. They were considered and rejected: they would rename
  the file hive-mind is actively writing to and that other features (`--attach-logs`,
  #1952's final-log guarantee) depend on. Copying byte ranges out of the single
  append-only log — the same "byte offset since last read" technique file-tailing
  shippers such as Logstash use in their `sincedb`
  ([Elastic discussion](https://discuss.elastic.co/t/how-log-stash-is-recognizing-file-rotation-and-resetting-byte-offset-in-since-db-files-of-that-file/35514))
  — keeps a single writer and needs no coordination with the logging layer.
- **Node built-ins are sufficient.** `fs.createReadStream(file, { start, end })`
  piped through `stream/promises.pipeline` gives constant-memory slicing, so no
  new dependency is introduced.

## 8. Other repositories (R8)

No upstream defect was found. The three session UUIDs were reported correctly by
the tool in the process log, and the transcripts existed on disk; hive-mind
simply never collected them. Nothing to report to another repository.
