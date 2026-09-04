# Issue 2189: V8 Heap OOM in the Log Sanitizer, Misclassified as a Forced Kill, and Never Resumed

## Summary

On 2026-09-02 a `solve` working session finished its actual work successfully —
the agent pushed `d2f3d702e..03c90e68a`, verified a clean tree, and Hive Mind
converted `link-assistant/formal-ai#1070` from draft to ready — and then died
**ten minutes later inside its own `--attach-logs` post-processing step**:

```
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
12: 0x15385ff v8::internal::Runtime_RegExpExecMultiple(int, unsigned long*, v8::internal::Isolate*) [node]
Reason: exitCode=139 oomKilled=false
Exit Code: 139
```

Three independent defects turned that into an unrecovered dead session:

1. The kill was **only offered** for resume, never resumed — and the offer was
   re-emitted on every poll, because a killed session never reached a terminal
   handled state.
2. The kill was **classified as `forced-kill`** ("10.3 GB of 11.7 GB RAM
   available"), because the classifier trusted `docker inspect`'s
   `OOMKilled=false` and cgroup `oom_kill=0` — both of which are blind to a V8
   self-abort.
3. The sanitizer **buffered the whole 134 MB log** as a single JS string, then
   made several more full-size copies of it, and did the entire job **twice**.

No work was lost. The reporting step killed the run, the diagnosis contradicted
the truth, and the session sat dead for six hours.

|                    |                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Command            | `solve https://github.com/link-assistant/formal-ai/issues/1069 --think xhigh --tool codex --attach-logs --verbose` |
| `$` execution UUID | `0ea1c630-cfdf-477e-8528-29d175a7fe64`                                                                             |
| `$` session name   | `dd1acfbe-3c01-4ffa-8c78-f825457f5813`                                                                             |
| Tool session id    | `01a05c1c-0c3d-7472-a431-11d9c948e162`                                                                             |
| Image              | `konard/hive-mind-dind:2.15.1`                                                                                     |
| Container          | `a182caf61c25`, Node `v24.3.0`, 11.7 GiB RAM, 192.7 GB disk                                                        |
| Started / finished | `2026-09-01 08:34:00.410` → `2026-09-02 14:07:49.909` (29h 33m)                                                    |
| Exit               | **139** (SIGSEGV), `oomKilled=false`                                                                               |
| Log                | 140,181,172 bytes / 429,902 lines (private: `konard/private-logs`)                                                 |

## Preserved Data

The raw 134 MB log lives in the **private** repository
`konard/private-logs` (`log-tmp-start-command-logs-isolation-docker-0ea1c630-cfdf-477e-8528-29d175a7fe64`)
and is deliberately **not** committed here: it is 134 MB of repository bloat, it
comes from a private source, and the run's own sanitizer reported 591 masked
tokens over it. What is committed is the evidence, extracted by a single
streaming pass and re-sanitized through `sanitizeLogFileToFile` before landing
on disk:

- `logs/incident-head.log.txt` — first 260 lines: the `$` header (execution id,
  image, Node version, container id), dind startup, `solve v2.15.1` banner, the
  `solve_start` resource marker, the clone.
- `logs/incident-tail.log.txt` — last 320 lines: the agent's final report, the
  draft→ready conversion, the double sanitize, the GC death spiral, the fatal
  error, the native stack trace, and the `$` footer.
- `logs/incident-timeline.txt` — 45 curated milestone lines. Each is annotated
  with the newest in-run ISO timestamp seen up to that point, which makes the
  telemetry blind spot self-evident (see Findings).
- `logs/incident-resource-markers.txt` — all three `📈 [RESOURCES]` markers
  emitted in 429,902 lines.
- `logs/incident-log-shape.txt` — size, line count, longest line, blank lines,
  40-hex-token hits, and the two `Sanitized 591 secrets` notices with their line
  numbers.
- `logs/issue-2189.json`, `logs/issue-2189-comments.json` — the issue body and
  all three follow-up comments, as fetched.
- `logs/upstream-start-issue-162.json` — the upstream `link-foundation/start`
  issue this case study's section 1 depends on.
- `logs/upstream-start-issue-165.json`, `logs/upstream-start-issue-164.json` —
  the two upstream issues filed from this investigation (see Upstream
  Follow-Up), as fetched after filing.
- `logs/upstream-oom-repro.log` — the local reproduction backing #165: a
  `node --max-old-space-size=64` self-abort under `--isolated docker`, its log
  tail, the resulting `$ --status` record, and `docker inspect`'s
  `OOMKilled=false`.
- `logs/stream-sanitize-equivalence.log` — the streamed sanitizer produces a
  byte-identical result to the whole-file one, with a 10.5 MB peak heap delta.
- `logs/stream-sanitize-scaling.log` — peak heap stays flat as the input grows.
- `logs/bounded-sanitize-worker.log` — the heap-capped worker producing
  byte-identical output, then containing a deliberate blow-up while the parent
  process survives (Solution §4).
- `logs/npm-test.log`, `logs/npm-run-lint.log`, `logs/npm-run-format-check.log`
  — verification runs for this change.
- `logs/secretlint-case-study.log` — secretlint over this folder with the
  recommended preset (empty: no findings).
- `logs/credential-scan.log` — the same folder run through Hive Mind's own
  fail-closed `sanitizeForPublication` scan
  (`experiments/issue-2189-scan-case-study.mjs`), which is stricter.

`experiments/issue-2189-extract-case-data.mjs` regenerates every `incident-*`
artifact from the raw log in one bounded pass:

```
node experiments/issue-2189-extract-case-data.mjs /path/to/full.log
```

## Timeline

Times are UTC. Lines marked _(inferred)_ have no timestamp of their own — see
the telemetry blind spot in Findings.

| Time                   | Log line | Event                                                                                                               |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| `2026-09-01 08:34:00`  | 3        | `$` starts the detached dind container `a182caf61c25`                                                               |
| `2026-09-01 08:34:18`  | 106      | `📈 [RESOURCES] phase=solve_start` — RSS 109 MB, 10.7 GB RAM free, 147.4 GB disk free                               |
| `2026-09-01 08:35:20`  | 286      | `📈 [RESOURCES] phase=after_clone` — RSS 90 MB, 143.9 GB disk free                                                  |
| `2026-09-01 08:35:22`  | 307      | `🚀 Starting work session: 2026-09-01T08:35:22.386Z`                                                                |
| `2026-09-02 13:04:12`  | —        | last commit + push, `d2f3d702e..03c90e68a`                                                                          |
| `2026-09-02 13:56:31`  | —        | agent's final read-only verify: `working_tree_entries=0`, head == origin head                                       |
| `2026-09-02 13:57:01`  | 429696   | `📝 Final Codex message captured` — **the last real timestamp anywhere in the log**                                 |
| `2026-09-02 13:57:07`  | 429738   | `📈 [RESOURCES] phase=after_agent` — RSS 373 MB, 10.3 GB RAM free, 104.4 GB disk free                               |
| _(inferred)_           | 429741   | `✅ No uncommitted changes found`                                                                                   |
| _(inferred)_           | 429844   | `✓ Pull request link-assistant/formal-ai#1070 is marked as "ready for review"`                                      |
| _(inferred)_           | 429849   | `📁 Large log file (148MB), will use gh-upload-log` — **the route is already known here**                           |
| _(inferred)_           | 429854   | `🔍 Sanitizing log content to mask GitHub tokens...` — pass 1, for a comment that will never be posted              |
| _(inferred)_           | 429855   | `🔒 Sanitized 591 secrets ... Hex tokens: 591`                                                                      |
| _(inferred)_           | 429860   | `🔧 Escaping code blocks in log content for safe embedding...` — another full-size copy                             |
| _(inferred)_           | 429861   | `📁 Log file too large for inline comment (148MB), using gh-upload-log` — the size check, _after_ all of the above  |
| _(inferred)_           | 429864   | `🔒 Sanitized 591 secrets ...` — **pass 2 over the same 134 MB**                                                    |
| _(inferred)_           | 429870   | `<--- Last few GCs --->`                                                                                            |
| _(inferred)_           | 429872   | `Mark-Compact 2121.9 (2218.3) -> 1824.9 (1872.6) MB, 252.25 ms`                                                     |
| _(inferred)_           | 429873   | `Mark-Compact 2121.9 (2169.0) -> 2121.9 (2160.8) MB, 333.56 ms` — collected nothing                                 |
| `2026-09-02 14:07:47`  | 429878   | `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory`                                 |
| _(inferred)_           | 429892   | frame 12 `v8::internal::Runtime_RegExpExecMultiple`, frame 11 `FixedArrayBuilder::EnsureCapacity`                   |
| `2026-09-02 14:07:49`  | 429896   | `Reason: exitCode=139 oomKilled=false`; container kept for investigation                                            |
| `2026-09-02 ~20:14:00` | —        | the bot notices the finished session, six hours later, on restart                                                   |
| `2026-09-02 20:14:00+` | —        | `killed=true recovered=false cause=forced-kill policy=report`, re-emitted every poll; bot RSS climbs 1.78 → 1.84 GB |

## Requirements

Every requirement stated in the issue body and in its three comments, with the
commit that addresses it.

### From the issue body

| #   | Requirement                                                                                                                                                                            | Status                                                                                              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| R1  | The bot must **initiate** the resume itself, with context preserved, instead of only offering it                                                                                       | Done — `eea64afb`                                                                                   |
| R2  | Ideally re-enter the **same `$` session id / container** rather than starting a fresh isolated run                                                                                     | Done — `78a6a679` (was blocked on `link-foundation/start#162`, delivered in `start-command@0.33.0`) |
| R3  | On startup, resume all still-running / interrupted commands so a bot restart never orphans in-flight work                                                                              | Done — `eea64afb` (`resumeTrackedSessions`) + `df9dc818` (`$ --resume-all`)                         |
| R4  | The offer/report must be timely (crash `14:07:49Z`, noticed `20:14:00Z`)                                                                                                               | Done — bounded by the poll interval once the session is in the durable store                        |
| R5  | `KILL_CAUSE_OUT_OF_MEMORY` when the log tail contains `FATAL ERROR: Reached heap limit` / `JavaScript heap out of memory`, regardless of cgroup counters                               | Done — `403d3084`                                                                                   |
| R6  | Decide the upload strategy from `logStats.size` **before** reading anything                                                                                                            | Done — `98923151`                                                                                   |
| R7  | Sanitize as a **stream** (chunked, with an overlap window for tokens spanning a boundary), writing to a temp file; never materialise the log or any transform of it as a single string | Done — `98923151`                                                                                   |
| R8  | Never sanitize the same content twice                                                                                                                                                  | Done — `98923151`                                                                                   |
| R9  | **No unbounded buffering anywhere in Hive Mind** — log capture, session monitoring and comment building all memory-bounded                                                             | Done — `17b08c8a`, `ea37f10a`                                                                       |
| R10 | A worker with a bounded heap for the sanitize step, to contain any residual blow-up                                                                                                    | Done — `8c3fbbdf`, Solution §4                                                                      |

### From comment 2 (the live follow-up)

| #   | Requirement                                                                                                   | Status                        |
| --- | ------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| R11 | A killed session must reach a **terminal, persisted, handled** state after its notification is delivered once | Done — `eea64afb`             |
| R12 | Per-cycle work must not be O(log size); cache the recovered session id in the session record                  | Done — `eea64afb`, `17b08c8a` |

### From comment 3 (the scope comment)

| #   | Requirement                                                                                                                                    | Status                                                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| R13 | Verify auto-recovery from OOM works **at all levels**                                                                                          | Done — see Verification                                                                                             |
| R14 | Verify monitoring works                                                                                                                        | Done — see Verification                                                                                             |
| R15 | Verify Hive Mind is not the root cause of OOM in any place in our code                                                                         | Done — `tests/test-issue-2189-bounded-buffering-sweep.mjs`                                                          |
| R16 | Download all logs and data to `docs/case-studies/issue-2189` and do a deep case study: timeline, all requirements, root causes, solution plans | This document                                                                                                       |
| R17 | Search online for additional facts and data                                                                                                    | See External Corroboration                                                                                          |
| R18 | If there is not enough data to find the actual root cause, add debug output and verbose mode for the next iteration                            | Done — `3b324d14`                                                                                                   |
| R19 | File upstream issues with reproducible examples, workarounds and code fix suggestions                                                          | Done — `link-foundation/start#162`, `#164`, `#165`; all three delivered in `start-command@0.33.0` and consumed here |
| R20 | Apply the requirements to the **entire** codebase — if the issue exists in multiple places, fix all of them                                    | Done — `ea37f10a`                                                                                                   |
| R21 | Everything in this single pull request                                                                                                         | `link-assistant/hive-mind#2191`, then `#2197` for the upstream follow-through                                       |

### From comment 4 (the dependency follow-through)

> "We need to finish this issue by actually updating
> [link-foundation/start](https://github.com/link-foundation/start) (as we
> reported issues there and they are now delivered) and all other dependencies
> we have in the repository. We also should see what changed, and use all
> relevant best practices from all our dependencies in all our supported
> languages."

| #   | Requirement                                                                          | Status                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| R22 | Update `start-command` to the version that delivers the three issues filed from here | Done — `7687f647` pins `0.33.0` in both images                                                                                              |
| R23 | Consume what it delivers, rather than only pinning it                                | Done — `60750f4a` (hints), `48603fd4`/`1211d554` (`--resume`/`--resume-all` wrappers), `78a6a679` (R2), `df9dc818` (startup reconciliation) |
| R24 | Update all other dependencies                                                        | Done — see Dependency Follow-Through                                                                                                        |
| R25 | See what changed and adopt the relevant best practices from them                     | Done — see Dependency Follow-Through                                                                                                        |

## Findings

### F1. The heap ceiling was ~2.1 GB, and the box had 10.3 GB free

The GC log shows the process bouncing off a ceiling at `2121.9 MB` and
collecting nothing on the last pass:

```
Mark-Compact 2121.9 (2218.3) -> 1824.9 (1872.6) MB   (freed ~300 MB)
Mark-Compact 2121.9 (2169.0) -> 2121.9 (2160.8) MB   (freed nothing)
```

That is V8's own default old-space limit, not the container's. Measured on a
host with the same 11.7 GiB of RAM as the incident container
(`memTotalBytes=12541493248` in the markers):

```
$ node -e 'console.log(require("v8").getHeapStatistics().heap_size_limit)'
2197815296        # 2,096 MiB
```

Meanwhile the last resource marker, six log lines before the sanitizer started,
reported `mem=10.3 GB available / 11.7 GB total`. The two numbers describe
different limits, and the classifier only knew about the second one.

### F2. Frame 12 is `String.replace` with a global regex over the whole log

```
11: FixedArrayBuilder::EnsureCapacity
12: v8::internal::Runtime_RegExpExecMultiple
```

`Runtime_RegExpExecMultiple` is what V8 calls when a _global_ regex is used with
`String.prototype.replace`: it first collects **every** match into a
`FixedArray`, growing it through `EnsureCapacity`, and only then builds the
result. So the peak is not one 134 MB copy — it is the source string, the match
array, and the result, simultaneously. `src/token-sanitization.lib.mjs`
drives exactly that shape over the full log, plus a `while (exec(...))` loop
accumulating into `hexReplacements[]`.

### F3. The work was done twice, and the first pass was thrown away

The log proves it, at lines 429849–429864:

```
📁 Large log file (148MB), will use gh-upload-log      <- route already decided
🔍 Sanitizing log content to mask GitHub tokens...      <- pass 1 anyway
🔒 Sanitized 591 secrets ...  Hex tokens: 591
🔧 Escaping code blocks in log content for safe embedding...
📁 Log file too large for inline comment (148MB), using gh-upload-log   <- size check
🔒 Sanitized 591 secrets ...                            <- pass 2, same content
```

The route (`gh-upload-log`) was known before the first pass ran. Everything
between the two `📁` lines was computed for an inline comment that could never
be posted. `src/github.lib.mjs:580` did the size check _after_ the read at
`:440`.

### F4. The 591 "secrets" were git object ids

`Hex tokens: 591`, `Known tokens: 0`, `Custom patterns: 0`. The independent
scan of the raw log finds **798 standalone 40-hex matches on 453 lines** — a
transcript of a build/test session, full of commit SHAs. The sanitizer's most
expensive pattern was firing almost entirely on non-secrets. This does not make
the masking wrong (a 40-hex string can be a token), but it does mean the
pathological path was driven by ordinary content and will fire on any long
git-heavy transcript.

### F5. A ten-minute telemetry blind spot

Three `📈 [RESOURCES]` markers exist in 429,902 lines: `solve_start`,
`after_clone`, `after_agent`. The last one is at line 429,738 with
`ts=2026-09-02T13:57:07.311Z`. The newest in-run ISO timestamp found anywhere
after it is still `2026-09-02T13:57:01` — every line in `incident-timeline.txt`
from that point on carries `[t <= 2026-09-02T13:57:01...]` — while the footer
reads `Finished: 2026-09-02 14:07:49.909`.

**The exact ten minutes that failed were completely untelemetered.** And even
the markers that existed could not have explained the crash: they reported
process RSS against _total system RAM_, a ratio that stays comfortable
(373 MB / 11.7 GB) while the V8 heap goes to 100% of a limit nobody sampled.

### F6. `oomKilled=false` is correct and useless

`docker inspect` reports `OOMKilled` from the kernel's cgroup OOM killer. V8
aborting on its own `--max-old-space-size` never involves the kernel OOM killer,
so `OOMKilled` is `false` and `memory.events`' `oom_kill` stays `0`. The exit
code is 139 (`128 + SIGSEGV`) rather than 134 (`128 + SIGABRT`) because the
process faults while unwinding after printing the fatal error. Classifying on
cgroup counters alone therefore produces a **guaranteed false negative** for
every Node self-abort — not an occasional one.

### F7. The report loop was itself walking into the same wall

Per the issue's second comment, on a bot up for 11 minutes the same dead session
produced `"has finished. Sending notification"` ×4 and
`"was killed; offering resume from last session"` ×3. Each cycle re-resolved the
linked PR **by reading the 134 MB log**, re-scanned it for the tool session id,
re-measured a 27 GB writable layer, and re-sent the Telegram message. Bot RSS
went 1.78 → 1.84 GB against the same ~2 GB ceiling. The reporter for an OOM
crash was reproducing the OOM crash.

## Root Causes

| Defect                  | Root cause                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Never resumed**    | `--on-session-kill` defaulted to `report`. Recovery was implemented (`runKillRecoveryForCompletion`) but the default policy never invoked it. Separately, a completion had **no persisted terminal state**: the monitor recomputed "this session finished" from scratch on every poll, so the notification and the resume offer were re-emitted forever and neither could be consumed.                                           |
| **2. Misclassified**    | `describeKillCause` selected the cause from out-of-process signals only — `docker inspect`, cgroup `memory.events`, host `MemAvailable`, disk. The decisive evidence (the fatal line) was _inside the log the monitor was already reading_, and the repo already knew the string (`src/child-exit.lib.mjs`) but only for SIGABRT mapping.                                                                                        |
| **3. OOM**              | Publication routing happened _after_ materialisation. `attachLogToGitHub` read the file, sanitized it, escaped it, built a comment, and _then_ asked whether the comment was too big — so the expensive path ran even when its output was discarded. Underneath, `sanitizeForPublication` is a whole-string API: a global-regex `replace` over an arbitrarily large string, which is O(size) in peak heap with a large constant. |
| **3b. Everywhere else** | The same whole-string idiom (`fs.readFile(path, 'utf8')` on an artifact whose size is decided by how long an AI ran) appeared in nine other places: `/log`, `/terminal_watch`, development-log collection, the credential rescan, the error reporter, Claude session accounting, transcript repair, Codex's last-message artifact, and three reads inside the session monitor itself.                                            |
| **Blind post-mortem**   | Resource telemetry sampled the wrong quantity (RSS vs system RAM, never the V8 heap vs its own limit) at the wrong times (nothing between `after_agent` and the crash).                                                                                                                                                                                                                                                          |

## Solution

### 1. Stream the sanitizer; route before you read (`98923151`, `403d3084`)

- **`src/log-sanitize-stream.lib.mjs`** — `sanitizeLogFileToFile({sourcePath, destPath, chunkBytes})` reads the source block by block (1 MiB default) and writes the destination with `wx`/0600. Between blocks it holds back only what could still be part of a token: a partial trailing line, an unterminated PEM block, and a trailing wrapped-base64 run. The hold-back has a hard cap, so a malformed log (one 500 MB line) cannot reintroduce unbounded growth — it forces a release instead.
- **`src/github.lib.mjs`** — the publication route is chosen from `logStats.size` **before** anything is read. Only the inline branch reads and sanitizes; the upload branch hands the raw path to the uploader, which performs the single remaining sanitize pass, streamed.
- **`src/log-bounded-read.lib.mjs`** — `readLogTextBounded` (head+tail excerpt), `scanLogChunks`, `collectLogLinesMatching`, `readLogMarkerLines` for everything else that needs to look at a log.
- The ESLint publication-boundary rule (`eslint-rules/require-sanitized-output.mjs`) learned `sanitizeLogFileToFile({destPath})`, so a streamed artifact is still provably sanitized before it can be published.

Equivalence and scaling are proved, not asserted:
`experiments/issue-2189-stream-sanitize-equivalence.mjs` shows the streamed
output is **byte-identical** to the whole-file output with a 10.5 MB peak heap
delta on a 4 MB input; `experiments/issue-2189-stream-sanitize-scaling.mjs`
shows the peak heap staying flat as the input grows.

### 2. Classify from the evidence in the log (`403d3084`)

`src/child-exit.lib.mjs` gained `FATAL_MEMORY_PATTERNS` / `findFatalMemoryMarker`,
covering the fatal lines Node/V8, Rust, Go and C++ print when they exhaust their
own heap. `src/session-kill-diagnostics.lib.mjs` upgrades an **abnormal** exit
carrying such a marker to `KILL_CAUSE_OUT_OF_MEMORY` regardless of cgroup
counters, with a summary that names which limit was hit. A _clean_ exit is never
upgraded, so a log that merely quotes the phrase (this file, for instance)
cannot manufacture a diagnosis. The diagnostics read is bounded
(`readLogTextBounded`, 1 MiB head+tail).

### 3. Resume, and latch the completion (`eea64afb`)

- `--on-session-kill` now defaults to **`resume`**. `report` and the environment
  override still opt out; the attempt counter
  (`--session-kill-resume-attempts`) is persisted, so a job that dies on every
  attempt stops instead of looping.
- **`src/session-completion-state.lib.mjs`** — a persisted handled latch
  (`completionNotifiedAt`, `completionExitCode`, `completionStatus`) plus
  `resolveCachedLastToolSessionId`, which caches the recovered tool session id
  (including a cached **empty string** for a scan that found nothing, so a
  fruitless scan is not repeated either) on the session record.
- **`src/session-monitor.lib.mjs`** — a finalize-and-skip latch at the top of the
  loop, memoized PR-URL resolution, and a 5-minute throttle on the docker
  writable-layer measurement. Per-cycle work is no longer O(log size).
- **`src/session-store.lib.mjs`** — the completion, recovery and stop fields are
  persisted, so the handled state survives a bot restart, and
  `resumeTrackedSessions` re-registers still-running sessions on launch and
  finalizes already-reported ones silently.

### 4. Contain the sanitize step in a heap-capped worker (`8c3fbbdf`)

R10 asks for a second line of defence behind the streaming sanitizer. The
streaming sanitizer is bounded by construction, but "bounded by construction" is
a property of today's code; a future pattern, a pathological log or a dependency
upgrade can reintroduce an unbounded allocation. `sanitizeLogFileToFileBounded`
makes the blast radius of that one thread instead of the whole run:

- logs at or above 16 MiB are sanitized in a `worker_threads` worker with
  `resourceLimits.maxOldGenerationSizeMb = 512`; the worker gets its own V8
  isolate, so exceeding the cap terminates _it_ with `ERR_WORKER_OUT_OF_MEMORY`
  and leaves the parent running;
- a worker that never reached `ready` — no `worker_threads`, a module resolution
  failure, a restricted runtime — falls back in-process, exactly as before. Once
  it has reported `ready`, failures propagate instead: falling back after a
  heap-limit hit would re-run the blow-up in the parent, which is the bug;
- all four whole-file sanitize sites use it — `--attach-logs`, the `/log`
  Telegram command, the GitHub error reporter (which by definition runs when the
  process is already in trouble) and development-log collection.

One caveat is worth recording, because it decided the numbers. `resourceLimits`
contains **gradual** heap growth. A _single_ allocation larger than the cap
still reaches V8's fatal handler and aborts the whole process (observed while
building this: `chunkBytes` above `workerHeapMb` produced
`FATAL ERROR: Reached heap limit` with `node::worker::Worker::Run()` on the
stack and exit 134 — the incident's own failure mode, reproduced in miniature).
So the cap has to stay far above the sanitizer's largest single allocation: 512
MiB against a 1 MiB block and an 8 MiB hold-back.

Containment is demonstrated, not asserted. `logs/bounded-sanitize-worker.log`
records a 125 MB log with no record boundary anywhere and a hold cap raised
above a deliberately small 48 MiB worker heap:

```
worker failed as designed: ERR_WORKER_OUT_OF_MEMORY - Worker terminated due to reaching memory limit: JS heap out of memory
worker had started: true
parent survived: rss 313 MB -> 314 MB, pid 201549 still running
```

The same scenario runs as an assertion in
`tests/test-issue-2189-bounded-sanitize-worker.mjs`, alongside the equivalence
check that worker output is byte-identical to the in-process output.

### 5. Measure the heap against its own limit (`3b324d14`)

Per R18 ("add debug output ... that will allow us to find root cause on next
iteration"):

- `captureResourceSnapshot` now records `processHeapUsedBytes`,
  `processHeapTotalBytes`, `processExternalBytes`,
  `v8.getHeapStatistics().heap_size_limit` and the used share of it. Every
  marker, every heartbeat and the human-readable block carry them, and a heap at
  or above 85% of its limit prints a warning naming the abort it is heading for.
- `attachLogToGitHub` brackets itself with `log_upload_start` / `log_upload_end`
  samples — the entry one labelled with the log size, the closing one in a
  `finally`, so the ten minutes that were invisible in this incident are sampled
  from both ends even if the upload throws. Telemetry failures are swallowed.
- `describeKillCause` selects the last heap marker, reports it as evidence, and
  classifies an abnormal exit with a heap at or above 90% of its limit as
  out-of-memory — so the diagnosis survives even when the fatal line itself was
  lost with a truncated tail.
- The bot heartbeat warns when the **bot's own** heap is under pressure, which is
  the 1.78 → 1.84 GB climb from the issue's second comment and the route into
  #733.

### 6. The same fix everywhere else (`17b08c8a`, `ea37f10a`)

R9/R20 ask for bounded memory everywhere, not only on the path that crashed:

| Path                                | Before                                               | After                                                                        |
| ----------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| `/log` Telegram command             | raw log + sanitized twin + sanitizer's own copy      | streams source → artifact                                                    |
| `/terminal_watch`                   | re-read the whole log every 2.5 s to render 25 lines | 256 KB tail                                                                  |
| session monitor: PR URL             | `readFile` of the transcript                         | 1 MiB chunk scan, stops at first match                                       |
| session monitor: disk markers       | whole file                                           | `📊 [DISK]` lines only                                                       |
| session monitor: subscription block | whole file                                           | bounded head+tail excerpt                                                    |
| session monitor: kill diagnostics   | whole file                                           | bounded head+tail excerpt                                                    |
| development-log collection          | two full-size strings per artifact                   | streamed                                                                     |
| credential rescan                   | read every artifact back                             | `findResidualCredentialBlock`, streamed                                      |
| error reporter                      | read, then route by size                             | size first                                                                   |
| Claude session accounting           | `readFile().split('\n')` over a growing JSONL        | line-by-line stream                                                          |
| Claude transcript repair            | same, plus a rebuilt output array                    | streams through a temp file it renames, preserving mode and trailing newline |
| Codex `--output-last-message`       | read, then check                                     | sized before read                                                            |

## External Corroboration

Searched per R17; each item independently confirms a step of the analysis.

- **The ~2 GB ceiling is Node's container-aware default, not a Hive Mind
  setting.** Red Hat's write-up of Node 20+ memory management in containers
  gives the rule: the default heap is 50% of the container's memory up to 4 Gi,
  and _"after 4 Gi, the maximum heap value naturally levels out at 2 Gi"_ —
  4 Gi of container memory yields a 2,080 Mi heap, and more memory yields no
  more heap. This matches the measured `heap_size_limit` of 2,096 MiB on an
  11.7 GiB host and the `2121.9 MB` ceiling in the GC log. **A bigger machine
  would not have saved this run**, which is precisely why the "10.3 GB free"
  diagnosis was so misleading.
- **Exit 139 with `OOMKilled=false` is the documented signature of a V8
  self-abort**, distinct from exit 137 (SIGKILL / kernel OOM killer). When V8
  hits its own heap limit before the cgroup limit, the kernel OOM killer never
  fires, so `docker inspect --format '{{.State.OOMKilled}}'` returns `false`
  while the process is unambiguously dead of memory exhaustion. This is exactly
  the F6 false negative, reported by others as a container-diagnosis trap.
- **Regex-driven heap exhaustion on large strings is a known Node failure
  mode**, including in published npm advisories (e.g. the `parse-duration`
  ReDoS/heap-exhaustion class) and long-running `nodejs/help` reports of
  `JavaScript heap out of memory` from regular expressions over large inputs.
  The standard remedies are the two applied here: process in bounded chunks, and
  do not build whole-input match arrays.

### Known components and libraries considered

R16 asks whether an existing component solves this. Checked:

| Candidate                                           | Verdict                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@secretlint/core`                                  | Already used by `src/token-sanitization.lib.mjs`, but its only entry point is `lintSource({source: {content: string}})` — see `node_modules/@secretlint/types/module/SecretLintSource.d.ts:9`. It is a **whole-string API**; it cannot be the boundary that fixes whole-string buffering. Our streaming sanitizer keeps calling it, once per bounded block. |
| `fast-redact`, `redact-secrets`, `@visulima/redact` | All redact **structured objects / short strings** for a logger's hot path. None offers file→file streaming or chunk-boundary handling. Not applicable.                                                                                                                                                                                                      |
| `pino` redaction                                    | Redacts known object paths at log-write time. Useful for preventing secrets from entering a log; useless for sanitizing a 134 MB log produced by a child process we do not control.                                                                                                                                                                         |
| `node:readline` / `split2` line streams             | Viable, and used for the JSONL paths (session accounting, transcript repair). Rejected for the sanitizer itself: a PEM block or a wrapped-base64 run spans many lines, so the hold-back window has to be content-aware, not line-count-aware.                                                                                                               |
| `node:worker_threads` `resourceLimits`              | **Adopted** for R10 — see Solution §4. It is the one off-the-shelf primitive that gives a bounded heap for a single step without a subprocess.                                                                                                                                                                                                              |

## Verification

```
npm test              # all test files passed
npm run lint
npm run format:check
npx secretlint --no-gitignore --secretlintrcJSON '{"rules":[{"id":"@secretlint/secretlint-rule-preset-recommend"}]}' "docs/case-studies/issue-2189/**/*"
node experiments/issue-2189-scan-case-study.mjs   # stricter, in-repo scan
```

secretlint reports nothing. The repository has no `.secretlintrc` of its own —
secretlint is driven programmatically through `sanitizeForPublication`
(`src/token-sanitization.lib.mjs`), which layers Hive Mind's own patterns on top
of the preset — so the scan script applies that stricter check as well, streamed
block by block, and prints every place the sanitizer _would_ rewrite a file, so
each hit can be adjudicated rather than taken on trust.

`logs/credential-scan.log` flags three files. Every hit is prose, every hit is a
keyword-proximity false positive, and none carries credential material. The
distinct triggers are:

- the log quote `Sanitized 591 secrets ... Hex tokens: 591`, where **secrets**
  and **tokens** sit next to a `key: value` shape;
- the sentence fragment `...could still be part of a token: a partial trailing
line`, where **token** is followed by a colon and a word;
- the paths `SecretLintSource.d.ts:9` and
  `src/token-sanitization.lib.mjs:819-828`, whose file names contain **Secret**
  and **token** — the second is verbatim issue text, left unchanged on purpose;
- test names in `logs/npm-test.log` such as
  `Testing accumulateTokenUsage: ignores non-step_finish events` and
  `solve --no-tokens-budget-stats disables flag`, where **token** is again
  followed by a separator and a bare word.

This section itself reproduces those strings, so it is flagged for the same
reason. `logs/credential-scan.log` quotes the hits it reports, which would make
it flag itself and nest one level deeper on every regeneration, so the scan
excludes its own report by name.

Worth noting as an observation for future work rather than a defect of this
change: the same keyword proximity means a published log containing an ordinary
stack frame such as `secretlint.js:15:44` has its line numbers redacted, while
`index.js:15:44` is left intact. That is fail-safe — it over-redacts, never
under-redacts — so it is out of scope here.

Test files added by this change:

- `tests/test-issue-2189-bounded-log-memory.mjs` — the streaming sanitizer, the
  bounded readers, the classification, and size-before-read routing in
  `attachLogToGitHub`.
- `tests/test-issue-2189-bounded-buffering-sweep.mjs` — drives **each** rewritten
  path with `fs.promises.readFile` patched to throw on the artifact under test,
  so a regression back to whole-file reading fails the suite; also checks the
  streamed transcript repair is byte-identical to the whole-file algorithm.
- `tests/test-issue-2189-session-recovery-latch.mjs` — the `resume` default,
  latch idempotence, the session-id cache, the docker throttle, the snapshot
  round trip, and an end-to-end `monitorSessions` replay: the latched record is
  finalized with **zero** notifications, **zero** log reads and **zero** PR
  lookups, while the same record with the latch fields stripped runs the
  completion again — the loop this fix removes.
- `tests/test-issue-2189-heap-telemetry.mjs` — capture (including graceful
  degradation when `getHeapStatistics` throws), marker round trip including
  pre-fix markers with no heap fields, the pressure warning, classification from
  telemetry alone, the upload phase brackets on the success/failure/empty-log/
  throwing-telemetry paths, and the heartbeat warning.
- `tests/test-issue-2134-killed-session-recovery.mjs` — extended for the new
  default policy.

Added while consuming `start-command@0.33.0` (see Dependency Follow-Through):

- `tests/test-issue-2189-isolation-resume.mjs` — the `--resume` / `--resume-all`
  parsers and both wrappers, including the exit-code check that
  `command-stream`'s resolving `$` makes necessary, an older `$` degrading to
  `unsupported`, a real refusal, a missing `$`, and the same fix applied to
  `$ --stop`.
- `tests/test-issue-2189-same-container-resume.mjs` — the in-place resume policy
  (Formal AI and `--use-router` tasks excluded), the attempt against a stub
  runner, and end to end through `recoverKilledSession`: no fresh container is
  launched, the execution UUID is preserved, and the fallback path still gets
  its own UUID.
- `tests/test-issue-2189-startup-resume-all.mjs` — reconciliation runs before the
  durable store is replayed, reports what it did, and never blocks startup when
  the verb is unsupported, refused or throws.

Regression suites re-run for the touched areas: `test-issue-1999-*`,
`test-issue-2001-*`, `test-issue-2015-oom-killed-status`,
`test-attach-logs-safety-net-1952`, `test-issue-1927-bot-lifecycle`,
`test-require-sanitized-output-rule`.

## Upstream Follow-Up

All three issues filed from this incident were delivered in
**`start-command@0.33.0`**, which is now pinned in both images (`7687f647`).
What each one turned into downstream is recorded with it.

- **`link-foundation/start#162`** — _"Docker isolation: no way to attach to,
  resume, or re-enter a detached session — and no way to resume all running
  commands after a supervisor restart"_. R2 ("re-enter the same `$` session id /
  container") could not be satisfied from Hive Mind alone: `$` preserved the
  container, the log and the execution record, but exposed no `--attach`,
  `--resume [-- <cmd>]` or `--resume-all`, so auto-resume had to start a
  **fresh** isolated run seeded with the recovered tool session id — the agent's
  context survived, the container did not.

  **Delivered in 0.33.0** as `--attach [--read-only]`, `--resume <id> [-- <cmd>]`
  and `--resume-all`. For a stopped docker session, `--resume` commits the
  container filesystem (`start-command-resume/<name>:<attempt>`) and runs the new
  command in a container derived from that snapshot; the execution UUID and the
  log path are preserved, and the previous session name stays addressable through
  `options.sessionNameHistory`. Downstream:
  - `src/isolation-runner.resume.lib.mjs` wraps both verbs. Neither throws, and
    an older `$` yields `unsupported: true` rather than an error — verified
    against a real 0.32.1 binary, which answers
    `Error: Unknown wrapper option: --resume`.
  - `src/session-kill-resume.in-place.lib.mjs` uses `--resume` for kill recovery,
    so the killed session's clone, caches and half-finished branch survive. Two
    task kinds are deliberately excluded: Formal AI (#2146) and `--use-router`
    tasks reach their sidecars over _internal_ Docker networks that Hive Mind
    attaches with `docker network connect` **after** the container is created,
    which `$` knows nothing about; a resumed container would come up without
    them, and #2146 requires Formal AI to fail closed. Those fall back to the
    fresh-launch path, which re-acquires the leases properly.
  - `resumeSessionsOnLaunch` runs `--resume-all` before the durable store is
    replayed. The detached-docker completion watchers are children of the
    process that launched them, so a bot restart leaves every running container
    unsupervised and an execution that ends while the bot is down never gets its
    exit written — one of the ways the reported session stayed in limbo.

  Building the wrappers also surfaced a defect on this side: `command-stream`'s
  `$` **resolves** on a non-zero child exit instead of throwing, so code that
  only inspected the resolved value reported every refusal as a success. The
  pre-existing `stopIsolatedSession` had exactly that shape — `$ --stop <unknown>`
  exits 1 with `Error: No execution found …`, and Hive Mind reported the stop as
  done. Fixed with the wrappers in `1211d554`.

- **`link-foundation/start#165`** (filed for this issue) — _"Docker isolation: a
  V8 heap-limit self-abort (exit 139/134) is reported with `oomKilled=false` and
  no memory signal in `--status`"_. This is F6 seen from the other side: `$`
  prints `Reason: exitCode=139 oomKilled=false` eight lines below the runtime's
  own `FATAL ERROR: Reached heap limit`, and `--status` carries no memory field
  at all for an attached session. Reproduced locally against `start-command`
  0.32.1 (`node --max-old-space-size=64` growing an array under
  `--isolated docker --image node:24` → `EXIT=139`, `OOMKilled=false`); the
  report includes the marker table, a fix built on the existing bounded
  `readLogTail` helper, the `docker-cleanup.js` footer correction, and the
  workaround Hive Mind now ships (`403d3084`).

  **Delivered in 0.33.0** as three additive `--status` fields — `exitReason`
  (e.g. `memory-exhaustion (v8-heap-limit)`), `memoryExhausted` and
  `memoryExhaustedReason` — derived from a bounded 64 KiB log-tail window and
  only for abnormal exits. `src/isolation-runner.parsers.lib.mjs` reads them and
  `describeKillCause` consumes them as **hints beside** the local evidence, never
  as a verdict replacing it (`60750f4a`): the log-marker rule from R5 stays in
  place, so a `$` that reports nothing still classifies a heap abort correctly.

- **`link-foundation/start#164`** (filed for this issue) — _"Command argv is
  flattened with `join(' ')`, so quoted arguments are re-parsed by the inner
  shell"_. Found while building the reproduction for #165: `$ node -e
"console.log('hi')"` dies with `bash: syntax error near unexpected token '('`
  because `args-parser.js:244` joins argv with a single space and hands the
  result to `bash -c`; the faithful `rawCommand` argv is returned beside it and
  never consumed. `$ echo "a  b"` prints `a b`, and the `bash -c` repair added
  for upstream #91 is wired into the isolation paths only, so the direct path
  still runs `bash -c echo hello world` (empty output, exit 0). Not a Hive Mind
  defect — Hive Mind passes a single command string — but it is why the
  reproduction above has to base64-encode its payload.

  **Delivered in 0.33.0**: a lone argument is now run verbatim as a shell
  script, which is what makes `$ --resume <id> -- "<display>"` safe for the
  fully shell-quoted command string `buildResumeCommand` already produces.

## Dependency Follow-Through

Comment 4 asked for the rest of the loop: update `start-command` now that the
three issues filed from this incident are delivered, update **all other**
dependencies too, and "see what changed" rather than only moving the numbers.
`start-command` is R22/R23 above. This section is the rest.

Every package in `package.json` was moved to its current release:

| Package                                                     | Was        | Now        | What it cost, or bought, here                                                         |
| ----------------------------------------------------------- | ---------- | ---------- | ------------------------------------------------------------------------------------- |
| `start-command` (global, both images)                       | `0.32.1`   | `0.33.0`   | The three upstream deliveries — see R22/R23                                           |
| `@changesets/cli`                                           | `^2.31.0`  | `^3.0.1`   | **Breaking**: `changeset version` now exits 1 with no changesets — guarded, see below |
| `jscpd`                                                     | `^4.0.5`   | `^5.1.2`   | **Breaking config**: `skipComments` is not a v5 key — `.jscpd.json` repaired          |
| `@sentry/node`, `@sentry/profiling-node`                    | `^10.62`   | `^10.73`   | Structured logs are on by default and bypass `beforeSend` — `beforeSendLog` added     |
| `prettier`                                                  | `^3.8.5`   | `^3.9.6`   | Reformatted 23 documents and exposed four genuinely malformed ones                    |
| `agent-commander`                                           | `^0.8.0`   | `^0.10.1`  | Pulls `command-stream` + `node-pty`; the native build is declined, see below          |
| `dayjs`                                                     | `^1.11.21` | `^1.11.23` | `dayjs.tz(<unparseable>, …)` no longer throws `RangeError`                            |
| `eslint`                                                    | `^10.5.0`  | `^10.9.1`  | No config change; `npm run lint` is clean                                             |
| `lint-staged`                                               | `^17.0.8`  | `^17.4.1`  | Nothing to migrate — v17's breaking changes were absorbed at 17.0                     |
| `secretlint`, `@secretlint/core`, `@secretlint/…-recommend` | `^13.0.2`  | `^13.0.5`  | Patch; the scanner used by the sanitizer behaves identically                          |
| `lino-i18n`                                                 | `^0.1.1`   | `^0.2.0`   | Reactive subscriptions and React bindings — not used here                             |
| `lino-objects-codec`                                        | `^0.4.0`   | `^0.8.0`   | Readable single-line encoding, and the same jscpd repair we needed                    |

### `@changesets/cli` 2 → 3: a release that used to end quietly now fails

`node_modules/@changesets/cli/dist/version.mjs`:

```js
if (changesets.length === 0 && (preState == null || preState.mode !== 'exit')) {
  log.warn('No unreleased changesets found.');
  throw new ExitError(1);
}
```

In 2.x that branch warned and returned, so the process exited 0. The release job
only reaches `npm run changeset:version` when `check-release-needed.mjs` counted
changeset files, so this looks unreachable — but `versionAndCommit` fetches and
**rebases onto `origin/main`** in between, and that rebase can remove the very
changesets the decision was made on, because another run released them first.
The existing `countChangesets() === 0` guard runs _before_ the rebase and cannot
see it.

`scripts/version-and-commit.lib.mjs` now reads the count again after the rebase
and takes the same self-healing path as an advanced remote (`already_released`,
so the publish step still gets its chance) instead of invoking a command that
now exits 1 and fails the whole release job.
`tests/test-issue-2189-changesets-3-version-guard.mjs` pins it: the guard fires
only when the rebase really consumed the changesets, and both the ordinary bump
and a rebase that keeps its changesets still version normally.

The other 3.0 changes do not reach us: `.changeset/config.json` has no
`prettier` key (removed in favour of `format`), `changeset tag` (renamed to
`changeset git-tag`) is not used anywhere in `scripts/` or `.github/workflows/`,
the published package is not private, and `engines` (`^22.11 || ^24 || >=26`)
is satisfied by the Node 24 the workflows install.

### `jscpd` 4 → 5: the duplication check was reading a key that no longer exists

v5 is a Rust rewrite, and `skipComments` is not one of its configuration keys.
It does not fail — it warns and falls back, which is the failure mode that
survives a code review. `experiments/issue-2189/jscpd5-config-keys.sh` shows
both spellings against the installed binary with `--debug`, which prints the
merged configuration:

```
=== v4 key: skipComments ===
config file .jscpd.json: unknown field 'skipComments'
  "mode": "mild",
=== v5 key: mode ===
  "mode": "weak",
```

So on jscpd 5 the repository would have been scanned in `mild` mode — comment
tokens counted as duplication — while `.jscpd.json` still claimed otherwise.
`"skipComments": true` is now `"mode": "weak"`.

This one is a practice adopted directly from a dependency: `lino-objects-codec`
0.8.0's changelog records the same migration on its own repository ("`jscpd` 4 →
5, and `.jscpd.json` repaired … `skipComments` is `"mode": "weak"` in v5"),
including a second trap we do not have — `"format"` read as the list of file
formats rather than as a reporter. `.jscpd.json` here already spells those two
separately (`"format": ["javascript"]`, `"reporters": ["console", "html"]`), so
only the `mode` repair was needed.

### `@sentry/node` 10.62 → 10.73: logs leave without passing `beforeSend`

Two facts from the installed SDK. `@sentry/core/build/cjs/client.js`:

```js
this._options.enableLogs = this._options.enableLogs ?? this._options._experiments?.enableLogs ?? true;
```

— structured logs are on unless switched off. And
`@sentry/core/build/cjs/logs/internal.js`:

```js
const log = beforeSendLog ? debugLogger.consoleSandbox(() => beforeSendLog(processedLog)) : processedLog;
```

— a log is filtered by `beforeSendLog`, never by `beforeSend`. `src/instrument.mjs`
masked credentials in `beforeSend` only, so a token that reached
`Sentry.logger.*` (or the console-logging integration) left the process
verbatim. That is the same class of defect as the one this whole issue is about:
a safety step that exists, is believed to run, and does not.

The masking walker moved into `src/instrument.sanitize.lib.mjs` and is now
registered on **both** hooks; `enableLogs: true` stays spelled out rather than
inherited from a default that changed once and can change again.
`tests/test-issue-2189-sentry-log-sanitization.mjs` pins the walker (nested
values, attributes, arrays, cycles), that `beforeSendLog` returns the log rather
than dropping it, and that `src/instrument.mjs` actually registers it.

### `prettier` 3.8.5 → 3.9.6: four documents were malformed, not reformatted

The bump rewrote 23 markdown files. In nineteen the diff is blank lines, table
delimiters and list indentation. In four it changed rendered text, and in every
one of those the source was already wrong — GitHub had been rendering it wrong
too, 3.8.5 simply left it alone:

- `README.zh.md` wrote session counts as `2~8` and `10~25`. A pair of single
  tildes is GFM strikethrough, so everything between the two ranges rendered
  struck through on GitHub, and 3.9.6 normalized the source to the doubled
  tildes it already meant. Fixed with the fullwidth CJK tilde `～`, which is
  what a Chinese range wants anyway.
- `docs/case-studies/issue-2166/README.md`, `docs/case-studies/issue-793-eslint-warnings.md`:
  an unescaped `|` inside a code span inside a table splits the cell. Fixed with
  `\|`, which GFM honours inside code spans.
- `docs/case-studies/issue-1756/README.md`: a backslash-escaped backtick inside
  a code span, which does not escape anything. Fixed by delimiting the span
  with two backticks instead of one, which is how GFM carries a backtick.

The four READMEs also carry the real documentation for this pull request — the
new resume behaviour, in all four supported languages, enforced by
`tests/test-docs-language-sync.mjs`.

### `agent-commander` 0.8 → 0.10, and a native build we decline

0.9.0 and 0.10.0 add real-TUI launch, input/resize control and terminal artifact
capture "backed by command-stream", so the tree now carries
`command-stream@0.17.2` → `node-pty@1.2.0-beta.15`, which builds a native
addon in a `postinstall` script. `package.json`'s `allowScripts` policy answers
for it explicitly — `"node-pty@1.2.0-beta.15": false` — because an absent entry
is only a warning, and a warning is not a decision.

Declining the build is safe, and the check is cheap rather than assumed:
`await import('agent-commander')` resolves with the unbuilt `node-pty` in place
(`ASK_DECISIONS … captureAgentTui, executeCommand …`), because the pty host is a
**separate process** — `command-stream/src/terminal-pty.mjs` resolves
`./terminal-pty-host.mjs` through `fileURLToPath` and spawns it — and only the
TUI-capture path ever starts it. Hive Mind drives `agent-commander` headlessly
(`src/agent-commander.lib.mjs`, behind `--use-agent-commander`), so the addon is
never reached. `@sentry/node-cpu-profiler` keeps its `true`: the profiler is
loaded in-process by `src/instrument.mjs` and does need its binding.

### `dayjs` 1.11.21 → 1.11.23: an exception our code was already catching

Both releases fix the timezone plugin, which `src/usage-limit.lib.mjs` uses to
turn an agent's "resets at 8:00 PM" into a UTC instant. One of the two is
demonstrable here — `experiments/issue-2189/dayjs-tz-invalid.mjs`, run against
both versions:

```
dayjs 1.11.21
  dayjs.tz(<garbage>, <format>, tz) -> THREW RangeError: Invalid time value
dayjs 1.11.23
  dayjs.tz(<garbage>, <format>, tz) -> Invalid Date (no throw)
```

The parser feeds `dayjs.tz` text an agent wrote, so unparseable input is a
reachable case, not a hypothetical one. Hive Mind was not crashing on it —
every call site is wrapped in `try/catch` — but the catch silently re-parsed
**without the timezone**, so a limit message in an odd shape could be resolved
against the wrong zone. On 1.11.23 the timezone-aware branch is the one that
answers.

The second fix (1.11.22, "compute instance `.tz()` offset without host DST")
could **not** be reproduced with the shapes this repository calls:
`experiments/issue-2189/dayjs-tz-dst.mjs` prints identical offsets on both
versions for four zones × two instants under three host timezones. It is
recorded as unverified rather than claimed.

### Bumps with nothing to adopt, and one thing deliberately left

`eslint` 10.9.1, `lint-staged` 17.4.1 and the `secretlint` 13.0.5 family needed
no change: lint is clean, the lint-staged v17 migration (Node ≥ 22.22.1,
optional `yaml`, git ≥ 2.32) was absorbed at 17.0 and this repository's config
lives in `package.json` rather than a YAML file, and secretlint's patch releases
leave the scanner the log sanitizer drives untouched.

Left for later, on purpose:

- jscpd 5's `--baseline-from-ref` / `--fail-on-new-clones` would turn the
  duplication gate from an absolute threshold into "no _new_ clones", which is a
  policy change for the whole repository and does not belong in an incident
  follow-up.
- `lino-i18n@0.2.0` still depends on `lino-objects-codec@^0.4.0` and
  `links-notation@^0.13.0`, so `node_modules` holds two codec versions and two
  grammars. Nothing here decodes through lino-i18n's copy, but 0.4.0 predates
  the 0.7.0 fix that stopped a single control character turning a whole string
  into base64 — worth an upstream bump request rather than a local override.

## Source Links

- Issue: https://github.com/link-assistant/hive-mind/issues/2189
- Pull request: https://github.com/link-assistant/hive-mind/pull/2191
- Incident log (private): https://github.com/konard/private-logs/tree/main/log-tmp-start-command-logs-isolation-docker-0ea1c630-cfdf-477e-8528-29d175a7fe64
- Affected run's PR: https://github.com/link-assistant/formal-ai/pull/1070
- Upstream: https://github.com/link-foundation/start/issues/162,
  https://github.com/link-foundation/start/issues/165,
  https://github.com/link-foundation/start/issues/164
- Related: #1493 (resource leaks), #2134 (better handling of killed task),
  #2015 (false positives/negatives on killed sessions), #744, #733
  (hive-telegram-bot killed)
- [Node.js 20+ memory management in containers — Red Hat Developer](https://developers.redhat.com/articles/2025/10/10/nodejs-20-memory-management-containers)
- [Understanding and Tuning Memory — Node.js docs](https://nodejs.org/learn/diagnostics/memory/understanding-and-tuning-memory)
- [Kubernetes exit codes 137, 139, 143](https://cast.ai/blog/kubernetes-exit-codes/)
- [JavaScript heap out of memory with use of regular expressions — nodejs/help#4233](https://github.com/nodejs/help/issues/4233)
- [Regex gone wrong: parse-duration heap exhaustion](https://www.nodejs-security.com/blog/regex-gone-wrong-parse-duration-npm-package-vulnerability)
