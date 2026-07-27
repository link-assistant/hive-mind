# Issue #2109 case study: a killed `/codex` task advertised another task's session

## Executive summary

The failed Codex resume was not caused by Codex losing the original task. Hive
Mind advertised the wrong identifier.

The killed task repeatedly printed its real Codex thread ID:

```text
019f980e-a0fd-75e1-907b-9167319836ad
```

The final marker was at byte 10,581,185 of a 14,570,060-byte log, about 3.99 MB
before EOF. Hive Mind 2.9.0 searched only the final 256 KiB, did not find that
marker, and then selected the newest UUID-named log from start-command's shared
Docker log directory. That unrelated file produced:

```text
8b8e10af-0776-4706-aae6-72c95bebbd73
```

The second task passed that unrelated ID to `codex exec resume`. Codex correctly
rejected it with `no rollout found`.

There was also a presentation and persistence bug. The task was started as
`/codex`, but the completion path retained only the internal `solve` command
name. Immediate, queued, isolated-queued, and bot-restart paths did not all
retain the actual Telegram alias and original arguments.

The fix:

1. scans the task's complete captured log backwards in bounded chunks and stops
   as soon as it finds the last session marker;
2. never guesses a session ID from neighboring files in a shared directory;
3. retains `commandAlias` and `args` through immediate execution, both queue
   backends, tracking, and durable bot state; and
4. renders `/solve`, `/claude`, or `/codex` according to the alias the user
   actually sent.

## Preserved evidence

The `source/` directory contains the data used in this analysis:

- [issue-2109.json](source/issue-2109.json) and its complete initial comment
  stream;
- the initial PR #2110 metadata and all three GitHub PR comment/review streams;
- Formal AI issue #845 and PR #856 metadata and all comment/review streams;
- [task-killed.png](source/task-killed.png) and
  [resume-failed.png](source/resume-failed.png), downloaded with authenticated
  GitHub access and verified by their PNG signatures before inspection;
- the complete original and failed-resume logs as deterministic gzip files; and
- the focused regression output before and after the implementation.

The two full logs were obtained with `gh gist view`, not an unauthenticated raw
URL. Before compression they were passed through Hive Mind's
`sanitizeCommentBody`, including known-local-token masking and the existing
pattern/Secretlint sweep. The 14.57 MB source log had four token-shaped hex
values masked. A second check confirmed that no currently known local token
remained. The resume log required no masks.

[evidence-index.md](source/evidence-index.md) gives compact line and byte
references so the failure can be checked without expanding the large logs.

The `research/` directory preserves the related PR #1928 discussion and the
2026-07-27 GitHub search results for Codex issues containing the same visible
error.

## Timeline

All times are UTC on 2026-07-25.

| Time        | Event                                                                                                                                                                                                                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 06:53:10    | start-command launches `solve … --tool codex --think xhigh` in detached Docker isolation.                                                                                                                                                                                                                                            |
| 06:55:23    | Codex 0.145.0 starts thread `019f…36ad`; Hive Mind prints the first `Session ID` marker.                                                                                                                                                                                                                                             |
| 08:57–10:05 | Automatic continuation repeatedly resumes the same real Codex thread. Six markers in total all name `019f…36ad`.                                                                                                                                                                                                                     |
| 10:05:26    | The final marker for `019f…36ad` is printed at byte 10,581,185.                                                                                                                                                                                                                                                                      |
| 11:05:51    | The outer start-command capture ends after the isolated task is killed. The Telegram report records SIGKILL/137, a 4 h 12 m runtime, an 840 MB repository clone, and 48.5 GB of container filesystem growth. The detached wrapper's footer says exit 0, so that footer alone is not a reliable description of the container outcome. |
| 11:25:05    | The Formal AI PR comment links the complete pre-failure log and attributes the kill to exhausted disk space.                                                                                                                                                                                                                         |
| later       | Hive Mind's 256 KiB tail search misses the last real marker. The shared-directory fallback chooses unrelated `8b8e…bd73`, and Telegram displays it as resumable. It also shows a terminal `solve` spelling despite the original `/codex` command.                                                                                    |
| 14:11:57    | A `/codex … --resume 8b8e…bd73` retry begins. Hive Mind itself warns that the matching session log is absent, but continues.                                                                                                                                                                                                         |
| 14:12:52    | `codex exec resume 8b8e…bd73` fails with JSON-RPC code `-32600`: `no rollout found for thread id`.                                                                                                                                                                                                                                   |

The kill's capacity cause and the invalid guidance are separate concerns. Issue
#2109 is about making recovery guidance attributable and usable after a kill;
it does not attempt to redesign Docker disk admission or cleanup.

## Requirements reconstructed from the issue

### Recovery correctness

- A killed task's guidance must use a real AI-tool session ID from that task.
- When a task has multiple session markers, recovery must use the last one.
- Long logs must work even when the last marker is far outside a small tail
  window.
- Files belonging to neighboring tasks must never be used as attribution
  evidence.
- If no attributable tool session exists, omit resume guidance instead of
  fabricating it.
- Existing successful-session and non-`solve` completion behavior must remain
  unchanged.

### Telegram behavior

- A task submitted as `/solve`, `/claude`, or `/codex` must be shown with that
  actual alias.
- Telegram guidance must not surprise the user with a terminal-only `solve`
  example.
- The alias and original arguments must survive immediate execution, waiting in
  the solve queue, screen execution, isolation execution, and a bot restart.
- Existing persisted records that have no alias must remain readable.

### Investigation and delivery

- Preserve all related issue, PR, comment, screenshot, and log evidence under
  `docs/case-studies/issue-2109`.
- Reconstruct the event sequence and identify a demonstrated root cause rather
  than guessing from the error string.
- Search related implementation work, upstream reports, and reusable
  components/libraries.
- Cover every code path where the same data can be lost.
- Add a reproducing automated test before the fix and retain before/after
  output.
- Report an upstream issue only when evidence establishes an upstream defect,
  and include a reproducer/workaround/code suggestion if one is filed.

## Root-cause analysis

### 1. The tail-only assumption was false

`readLastSessionIdFromLog` read at most the last 262,144 bytes. That optimized
for the expected case that the newest marker would be near EOF. Verbose Codex
traces continued for another 3,988,875 bytes after the final marker in this
real task, so the search returned `null`.

This is a deterministic boundary error, not a timing race. The regression
fixture places the valid marker over 300 KiB before EOF and reproduces the old
failure.

### 2. A shared directory was treated as task-scoped

After the tail search failed, the monitor called `findLatestSessionLogId` on
`path.dirname(logPath)`. In production that directory was:

```text
/tmp/start-command/logs/isolation/docker
```

It is shared by unrelated isolated tasks. A valid UUID filename establishes
that a file resembles a session log; it does not establish that the session
belongs to the task being reported. Modification time cannot supply that
missing relationship.

The fallback therefore crossed an attribution boundary and selected
`8b8e…bd73`, which appears zero times in the killed task's complete log.

### 3. The public alias was discarded at the Telegram boundary

`handleSolveCommand` correctly parsed `solveCommandName`, but the immediate
execution call passed only the internal command name `solve`. The completion
planner consequently had no evidence that the user sent `/codex`.

### 4. Queue and restart paths dropped recovery context

The solve queue item did not retain `commandAlias`. Both queue execution
callbacks also omitted the alias and original arguments from tracked session
metadata, and `session-store.lib.mjs` did not persist the alias. Fixing only the
immediate path would therefore leave queued or restarted tasks broken.

### 5. Earlier coverage encoded the optimistic assumptions

PR #1928 added the killed-session guidance and tested a marker within a small
tail window plus a task-like UUID log directory. It did not model a verbose
multi-megabyte suffix, a shared directory containing another task's newer log,
or the distinction between Telegram's public alias and the internal command.

## Alternatives considered

### Read the entire log into memory

This is simple and would find the marker, but killed task logs can be tens or
hundreds of megabytes. Allocating the whole file during a monitor pass is
unnecessary and scales poorly when several completions are checked together.

### Scan backwards in bounded chunks — selected

Node's built-in positional `fs.readSync` reads a fixed region without loading
the whole file. The implementation scans from EOF toward the beginning in
256 KiB chunks, overlaps adjacent chunks by 1 KiB so a split marker survives,
and stops after the first chunk containing a marker. Because the scan proceeds
backwards and `selectLastSessionId` chooses the last marker inside that chunk,
the result is the last marker in the file.

This keeps the common case to one bounded read and still handles arbitrarily
long captured output. It needs no new runtime dependency.

### Keep the newest UUID-file fallback

Rejected. No filename or mtime rule can prove ownership in a shared backend
directory. Making the heuristic more elaborate would reduce some false
positives without restoring attribution.

`findLatestSessionLogId` remains exported for compatibility and for callers
that already possess a genuinely task-scoped directory, but the completion
monitor no longer uses it.

### Add a task-scoped sidecar or structured event index

Writing the latest tool session ID into durable, task-keyed metadata at the
moment it is observed would give constant-time lookup and is a good future
architecture. It requires coordinated changes to the log producer and
start-command lifecycle, however. The captured task log is already the
authoritative per-task source, so bounded reverse scanning is the smaller
complete fix.

### Use a tail-reading package

Libraries that expose “last N lines” or follow a growing file solve bounded
tailing, not the core requirement to search backward until an attributable
marker is found. Adding one would not remove the need for stop conditions,
chunk overlap, and ownership rules. Node's standard `fs` API is sufficient.

## External research

- The current Codex CLI manual documents noninteractive continuation as
  `codex exec resume <SESSION_ID>`. The overall resume mechanism used by Hive
  Mind is therefore supported:
  [Codex CLI developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli#cli-codex-exec).
- Node documents positional reads through the standard filesystem API used by
  the selected implementation:
  [Node.js `fs.readSync`](https://nodejs.org/api/fs.html#fsreadsyncfd-buffer-offset-length-position).
- GitHub search found multiple Codex reports with the visible phrase
  `no rollout found`. A representative upstream report describes a thread for
  which rollout materialization failed:
  [openai/codex#16872](https://github.com/openai/codex/issues/16872).

The matching error text is not evidence of the same root cause. In this case,
the complete first-task log proves that `8b8e…bd73` was never its thread, and
the retry log proves Hive Mind passed that uncorrelated ID to Codex. Codex
rejected an unknown thread as expected. No new upstream issue was filed.

## Implementation map

| Area                                 | Change                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `session-resume.lib.mjs`             | Reverse chunk scan with overlap; alias-aware display command; explicit warning that directory lookup requires task scope. |
| `session-monitor.lib.mjs`            | Remove the shared-directory UUID fallback.                                                                                |
| `telegram-bot.mjs`                   | Pass the parsed slash-command alias into immediate and queued work.                                                       |
| `telegram-solve-queue.lib.mjs`       | Retain the alias on queue items and track alias plus cloned original args for screen sessions.                            |
| `telegram-isolation.lib.mjs`         | Track alias plus cloned original args for isolated queued sessions.                                                       |
| `telegram-command-execution.lib.mjs` | Add alias to immediate session metadata.                                                                                  |
| `session-store.lib.mjs`              | Persist alias across bot restarts while keeping the field optional for old records.                                       |

## Reproduction and verification

The focused test is
[`tests/test-issue-2109-killed-resume.mjs`](../../../tests/test-issue-2109-killed-resume.mjs).
Its minimum production-shaped fixture has:

- a real `Session ID` marker followed by more than 256 KiB of output;
- an unrelated newer UUID-named log in the same directory;
- a killed session launched through `/codex`; and
- no-marker behavior that must not borrow the unrelated UUID.

Before the implementation, all 14 original assertions failed. The old code
returned the unrelated thread, emitted `solve`, and lost alias/argument context
in every launch path. After the implementation, the expanded suite passes 18
assertions, including all three requested aliases and a marker split at a chunk
boundary.

The regression outputs are preserved as
[regression-before-fix.log](source/regression-before-fix.log) and
[regression-after-fix.log](source/regression-after-fix.log).

## Resulting recovery guidance

For the reported task, the attributable form is conceptually:

```text
/codex https://github.com/link-assistant/formal-ai/issues/845 --think xhigh --resume 019f980e-a0fd-75e1-907b-9167319836ad
```

Hive Mind reuses all persisted original arguments, so flags that were supplied
internally are preserved as well. If a killed task never prints a session
marker, the notification contains no resume section; a missing instruction is
safer and truthful compared with an executable instruction for another task.
