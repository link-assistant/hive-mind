# Case study — Issue #2140: "Codex session ended without completing its turn (turn.started=3, turn.completed=1)"

> A second `solve --tool codex` run finished all of its work — it updated
> [formal-ai#927](https://github.com/link-assistant/formal-ai/pull/927), got all
> 46 check-runs green on the final commit, and Codex closed its turn normally —
> and was then declared **failed** by the completion gate, after \$179.99 of
> model spend.
>
> This is [#2136](https://github.com/link-assistant/hive-mind/issues/2136)
> recurring, with one twist that makes it worse: in #2136 the echoed
> `turn.started` came from a **nested agent CLI the task had actually launched**.
> Here **no nested agent ran at all**. Codex simply executed
> `sed -n '1,1500p' /tmp/issue-905-research/direct-codex3.log` — it _read a
> stored log file_ — and its own OTEL trace of that command spliced the file's
> raw NDJSON into Codex's stderr, where Hive Mind's v2.11.7 parser counted it as
> Codex's own protocol.
>
> The fix for that was already merged. It merged **six minutes after this run
> started** and shipped **eighteen minutes after** — the failing binary was
> `solve v2.11.7`, released before the fix existed. So this incident is not a new
> defect in the shipped code; it is the same defect, caught on an older binary,
> and it exposes three **residual** gaps that #2136 did not close. Those are what
> this PR fixes.

- **Issue:** https://github.com/link-assistant/hive-mind/issues/2140
- **PR:** https://github.com/link-assistant/hive-mind/pull/2142
- **Prior case study:** [`issue-2136`](../issue-2136/README.md) — read it first;
  this one assumes RC1–RC4 from there.
- **Raw data:** [`raw/`](./raw) — the full 96,409-line run log (gzipped, 3.0 MB),
  the issue JSON, the target PR/issue/commit/check-run JSON, the failure-comment
  JSON, and a small verbatim excerpt file.
- **Analysis output:** [`analysis/`](./analysis) — the recorded output of the two
  reproduction experiments in [`experiments/issue-2140`](../../../experiments/issue-2140).
- **Date of incident:** 2026-08-04 03:58:27Z → 10:40:41Z (6h42m),
  thread `019fcaed-943e-7091-9fa1-475c6bc56a7f`, `codex` `app.version=0.146.0`,
  model `gpt-5.6-sol`, Docker, `--verbose`.

All line numbers below refer to
[`raw/solve-run-issue-905.log.txt.gz`](./raw/solve-run-issue-905.log.txt.gz)
(`zcat` it first).

---

## 1. The run

```
Log start:  2026-08-04T03:58:27.238Z                     (line 1)
Version:    🚀 solve v2.11.7                             (line 6)
Command:    solve https://github.com/link-assistant/formal-ai/issues/905 \
              --think medium --auto-merge --tool codex --attach-logs \
              --verbose --no-tool-check --disable-report-issue --language en
Environment: docker container                            (line 10)
Ends:       2026-08-04T10:40:41Z, "🚨 Solution Draft Failed"
```

As in #2136, `--verbose` is load-bearing: `getCodexExecEnv(verbose)` sets
`RUST_LOG=debug` only in verbose mode, and that is what makes Codex emit the
`codex_otel.log_only` / `codex_otel.trace_safe` records on stderr at all.

**Ground truth — the run had succeeded.** From [`raw/`](./raw):

| Fact                                                                                                                                       | Source                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| PR #927 exists and was updated                                                                                                             | [`formal-ai-pr-927.json`](./raw/formal-ai-pr-927.json)                 |
| Final commit `2d9523cbffc0`                                                                                                                | [`formal-ai-pr-927-commits.json`](./raw/formal-ai-pr-927-commits.json) |
| 46 check-runs, all success/skipped, zero failures                                                                                          | [`formal-ai-checks-2d9523c.json`](./raw/formal-ai-checks-2d9523c.json) |
| Codex's own closing summary: "All six fresh GitHub workflows passed on SHA `2d9…d60`", "Current `main` is merged", "Working tree is clean" | lines 96360–96371                                                      |

The cost of declaring it failed: `💰 Codex public pricing estimate: $179.994430`
(line 96380), the PR left in draft, and a "🚨 Solution Draft Failed" comment
posted on a complete PR.

## 2. Timeline of events

| When / log line       | Event                                                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 03:58:27Z · 1–8       | `solve v2.11.7` starts in Docker with `--verbose --tool codex`.                                                                                                                            |
| 03:59:56Z · 1011      | `{"type":"thread.started","thread_id":"019fcaed-943e-7091-9fa1-475c6bc56a7f"}` on **stdout** — Codex's real session. Line 1013: `📌 Session ID: 019fcaed-…`.                               |
| 03:59:56Z · 1083      | `{"type":"turn.started"}` on **stdout** — Codex's one and only turn begins.                                                                                                                |
| **04:02:40Z · 3167**  | Codex runs `wc -l … && head -c 80 … \| od -An -tc && sed -n '1,1500p' /tmp/issue-905-research/direct-codex3.log && sed -n '1,1500p' …/direct-qwen.log`.                                    |
| 04:02:40Z · 3187–3188 | Its OTEL `codex.tool_result` dump splices that file's contents into **stderr**, including `thread.started` for foreign thread `019fc374-eaec-78e3-851f-44dfcbb4ecd1` and a `turn.started`. |
| 04:02:40Z · 3222–3223 | The **same** dump again, from the second tool wrapper (`exec_command` and `exec` both trace it). Echoed totals: 2 × `thread.started`, 2 × `turn.started`.                                  |
| **04:04:52 +0530**    | _(elsewhere)_ The #2136 fix merges as `6336d091` — **6 minutes after this run started**.                                                                                                   |
| **04:16:33Z**         | _(elsewhere)_ `79a9a574` releases it as **2.11.10**. The running binary is still 2.11.7.                                                                                                   |
| 04:02–10:40           | Codex does 6½ hours of real work: 1227 `item.completed`, 601 command executions, 469 reasoning summaries, 35 file changes.                                                                 |
| 10:40:38Z · 96246     | `{"type":"turn.completed","usage":{…"output_tokens":198086…}}` on **stdout** — Codex closes its turn normally, exits 0.                                                                    |
| 10:40:39Z · 96371     | `📊 Codex JSON events: thread.started=3, turn.started=3, item.completed=1227, …, unknown=68, turn.completed=1` — 3 = 1 real + 2 echoed. `unknown=68` is more stderr noise.                 |
| 10:40:40Z · 96384–86  | `❌ Codex exited 0 but the run did not complete — treating as failure` / `turn.started=3, turn.completed=1, turn.failed=0`.                                                                |
| 10:40:41Z · 96393+    | `📄 Attaching failure logs to Pull Request…`                                                                                                                                               |

### The echoed block, verbatim (lines 3184–3190)

```
WARNING: proceeding, even though we could not create PATH aliases: Refusing to create helper binaries under temporary dir "/tmp" (codex_home: AbsolutePathBuf("/tmp/gh-issue-solver-1785688606123/experiments/issue-2130/fakehome/.codex"))
Reading additional input from stdin...
{"type":"thread.started","thread_id":"019fc374-eaec-78e3-851f-44dfcbb4ecd1"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Let me update .formal-ai/general-change-plan.lino for you."}}
2026-08-02T17:10:47.802363Z ERROR codex_core::tools::router: error=write_stdin failed: Unknown process id 0
{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"Let me update hello.txt for you."}}
```

Note the `codex_home` path and the `2026-08-02` timestamps: this text is **two
days old**. It is the saved output of a _previous_ hive-mind experiment
(`experiments/issue-2130`), sitting in a file on disk. No process emitted it
during this run. That is the escalation over #2136 — the echo needs no live
child, only a `cat`-equivalent of any file that ever contained NDJSON.

## 3. Requirements extracted from the issue

| #   | Requirement (from the issue body)                                                               | Where it is addressed                                                                                                                             |
| --- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Find the root cause and fix it                                                                  | §4 (root cause, proven by replay) and §5 (the three residual gaps this PR fixes).                                                                 |
| R2  | Download all logs and data into the repository                                                  | [`raw/`](./raw) — run log, issue JSON, PR/commit/check-run JSON, failure-comment JSON, verbatim excerpts.                                         |
| R3  | Compile them into `./docs/case-studies/issue-2140`                                              | This folder.                                                                                                                                      |
| R4  | Deep analysis reconstructing the timeline/sequence of events                                    | §1–§2, with log line numbers, plus §4.1's mechanical replay.                                                                                      |
| R5  | List each and every requirement from the issue                                                  | This table.                                                                                                                                       |
| R6  | Find root causes of each problem                                                                | §4 — primary cause (version skew on a known defect) plus residual gaps G1–G3.                                                                     |
| R7  | Propose possible solutions and solution plans for each                                          | §5, including options considered and rejected.                                                                                                    |
| R8  | Check known existing components/libraries that solve a similar problem                          | §6.                                                                                                                                               |
| R9  | If data is insufficient, add debug output and a verbose mode so the cause is findable next time | §5 — G1 (`[STDOUT]`/`[STDERR]` provenance tags on all mirrored child output), G2 (`🧬 Foreign thread IDs`), G3 (self-explaining failure reasons). |
| R10 | Report upstream, with reproducible example, workaround and code-level fix suggestion            | §7 — added to the existing `openai/codex#36804` rather than filed as a duplicate; this incident **strengthens** that report.                      |
| R11 | Apply the fix to the entire codebase — every place with the same defect                         | §5.1 — G1 swept across all five agent integrations (codex, claude, gemini, opencode, qwen); a test asserts the sweep stays complete.              |

## 4. Root-cause analysis

### 4.1 Primary cause: the #2136 defect, on a pre-fix binary — proven by replay

The run log tags **both** Codex streams as `[INFO]`, so provenance is not
directly readable. It is recoverable structurally: Codex's stderr is the only
stream carrying `RUST_LOG` tracing lines, and `log()` writes each mirrored chunk
under a single timestamp. [`experiments/issue-2140/classify-turn-events.mjs`](../../../experiments/issue-2140/classify-turn-events.mjs)
groups lines by that timestamp and classifies a group as stderr iff it contains a
tracing line. Result ([`analysis/turn-event-provenance.txt`](./analysis/turn-event-provenance.txt)):

```
line     stream  in-tool_result-dump  type            thread_id
1011     stdout  false                thread.started  019fcaed-943e-7091-9fa1-475c6bc56a7f
1083     stdout  false                turn.started
3187     stderr  true                 thread.started  019fc374-eaec-78e3-851f-44dfcbb4ecd1
3188     stderr  true                 turn.started
3222     stderr  true                 thread.started  019fc374-eaec-78e3-851f-44dfcbb4ecd1
3223     stderr  true                 turn.started
96246    stdout  false                turn.completed
```

Every extra `turn.started` is on stderr, inside a `codex.tool_result` dump,
alongside a thread id that is not this session's.

[`experiments/issue-2140/replay-completion-gate.mjs`](../../../experiments/issue-2140/replay-completion-gate.mjs)
then rebuilds the two streams and pushes them through the **real**
`parseCodexExecJsonOutput` + `getCodexCompletionHealth` under three code
versions ([`analysis/completion-gate-replay.txt`](./analysis/completion-gate-replay.txt)):

```
rebuilt streams — stdout: 4082 lines, stderr: 91895 lines
1. v2.11.7 — merged + count gate:      healthy false, turn.started=3, turn.completed=1, turn.failed=0
2. #2136 Layer B only — merged + order gate:  healthy true
3. current main — separated + order gate:     healthy true, turn.started=1, turn.completed=1,
     echoed (stderr, ignored): unknown=68, thread.started=2, turn.started=2, item.completed=6, item.started=2
```

Line 1 reproduces the issue title **verbatim** from the real log. Line 3 shows
`main` already handles it. **Either** #2136 layer alone would have prevented this.

**Why it still happened:** version skew. The run started 03:58:27Z on
`solve v2.11.7`; `6336d091` (the #2136 fix) merged at 04:04:52 and `79a9a574`
(2.11.10) published at 04:16:33 — after the process was already running. A
long-lived run cannot pick up a fix released mid-flight.

### 4.2 Residual gap G1 — `log()` silently discarded stream provenance

The reason §4.1 needed 200 lines of structural inference over 96,409 log lines is
that the log could not answer the one question that decides this incident: _which
stream did this protocol line arrive on?_ `log()` accepted an `options` object
but destructured only `level` and `verbose`; the five agent integrations were
already passing a stream hint that went nowhere:

```js
// src/codex.lib.mjs — the intent was there
await log(raw, { stream: 'stderr' });
// src/lib.mjs — but log() never read it
const { level = 'info', verbose = false } = options;
```

So all mirrored child output — both streams, five tools — was printed as `[INFO]`
on our stdout. Meanwhile the `process.stdout/stderr.write` interceptor (#1549)
_already_ emits `[STDOUT]`/`[STDERR]` tags for direct writes; line 96393 of this
very log shows `[STDERR] [use-m] use('https') loading`. The mirrored path was the
only one throwing provenance away, and it is the path that matters most.

Two consequences beyond forensics: `claude.lib.mjs` passed `{ stream: 'raw' }`,
a name nothing recognised; and mirrored child **stderr** was written to our
**stdout**, so anything piping `solve`'s stdout received the child's stderr mixed
in.

### 4.3 Residual gap G2 — a free, decisive echo detector was going unused

`codex exec` starts exactly **one** thread. A `thread.started` announcing any
other `thread_id` is therefore _proof_ of echo, not evidence of a second session —
and `thread.started` is the only turn event that carries an identity at all.
v2.11.7 used the foreign id to _overwrite_ the session id; post-#2136 it is
correctly ignored, but silently. The signal was there, twice, at lines 3187 and
3222, and nothing said so.

### 4.4 Residual gap G3 — the failure message was unfalsifiable

What got posted to PR #927 was:

```
Codex session ended without completing its turn (turn.started=3, turn.completed=1, turn.failed=0);
the process exited 0 but was cut off mid-turn.
```

Counts only. Nothing about _order_, nothing about what was discarded as echoed,
nothing about the foreign thread id. A reader — human or agent — cannot tell a
genuine #1990 cut-off from a #2136 false positive without re-deriving provenance
from the raw log, exactly as §4.1 had to. The gate had the evidence in
`codexJsonState` and did not put it in the reason.

## 5. The fix

Three changes, matching G1–G3. The #2136 layers stay exactly as they are — this
PR adds no new gate logic and changes no gate outcome.

**G1 — stream provenance in `log()` (`src/lib.mjs`, all five tool libs).**
`log()` now honours `options.stream`:

```js
const mirroredStream = stream === 'stdout' || stream === 'stderr' ? stream : null;
const tag = mirroredStream && level === 'info' ? mirroredStream.toUpperCase() : level.toUpperCase();
…
if (mirroredStream === 'stderr') console.error(sanitizedMessage);
else console.log(sanitizedMessage);
```

An explicit `level` still wins, so warnings and errors keep their own tag, and
callers that pass no `stream` are unchanged. The tag format matches the existing
interceptor, so a log has one vocabulary. Mirrored stderr now goes to our stderr,
so piping stdout yields only what the child wrote to stdout. Swept across
`codex.lib.mjs`, `claude.lib.mjs` (`'raw'` → `'stdout'`, both call sites),
`gemini.lib.mjs`, `opencode.lib.mjs`, `qwen.lib.mjs` — a test scans all five
sources and fails if any regresses.

**G2 — foreign thread detection (`src/codex.lib.mjs`, `codex.run-diagnostics.lib.mjs`).**
A `thread.started` on the **protocol** stream whose `thread_id` differs from the
session's is recorded in `state.foreignThreadIds` (deduped) and reported:

```
🧬 Foreign thread IDs seen on the codex protocol stream (echoed, not codex sessions): 019fc374-…
```

Diagnostics only — the gate stays order-based, and the session id is untouched.

**G3 — a self-explaining completion gate (`src/codex-health.lib.mjs`).**
The failure reason now carries the evidence that settles it:

```
• Codex session ended without completing its turn (turn.started=2, turn.completed=1, turn.failed=0); …
• Turn lifecycle in order: turn.started → turn.completed → turn.started — the stream ends on a start, so the last turn never finished.
• Echo diagnostics (issues #2136/#2140): 2 echoed turn.started on codex stderr (excluded from the counts above); foreign thread id(s) on the protocol stream: 019fc374-….
```

`getCodexCompletionHealth` also returns `turnLifecycle`, `echoedTurnStarts` and
`foreignThreadIds` so callers can render them; `reportCodexCompletionFailure`
logs the lifecycle under `--verbose`.

**Housekeeping.** `codex.lib.mjs` crossed the 1500-line ESLint budget, so the
usage-field vocabulary and its JSON-path helpers moved to
`src/codex.usage-fields.lib.mjs` (pure data and pure lookups, no behaviour
change).

**Test.** `tests/test-issue-2140-stream-provenance.mjs` — 21 assertions in four
sections, using the real thread ids from the incident: (1) the incident
reproduces (merged parse → 3/1; split parse → 1/1 with two echoed
`turn.started`), (2) `log()` provenance including the five-library source sweep,
(3) foreign-thread recording, dedup and reporting, (4) the gate's reasons, with a
genuine #1990 cut-off still failing.

### Options considered and rejected

| Option                                                                | Why not                                                                                                                                                |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Treat a foreign `thread_id` as a hard failure signal                  | It is proof of _echo_, not of _malfunction_. The order-based gate already yields the right answer; adding a second gate adds a second way to be wrong. |
| Refuse to run when the workspace contains stored NDJSON logs          | Absurd in a repo whose case studies **are** stored NDJSON logs. Reading a file must never be able to break the run.                                    |
| Re-verify completion by re-reading the session file from `CODEX_HOME` | Extra I/O, extra failure modes, and it answers the same question stream separation already answers correctly.                                          |
| Pin/upgrade-check the running binary mid-run                          | Cannot retrofit a fix into a process already running; the real mitigation is that the fix shipped, which it had.                                       |
| Nothing — `main` already handles this                                 | True for the gate outcome, and false for the diagnosis. Without G1–G3 the _next_ echo variant costs another 96k-line manual reconstruction.            |

## 6. Existing components and prior art

- **In this repo.** The stdio interceptor (#1549) already established
  `[STDOUT]`/`[STDERR]` as the tag vocabulary for child output; G1 makes the
  mirrored path agree with it instead of inventing a third convention.
  `createLineBuffer` (#2119) supplies per-stream framing; `telemetryEventCounts`
  and `turnLifecycle` (#2136) supply the evidence G3 now prints.
- **The general pattern** is the same as #2136 — in-band vs out-of-band
  signalling — with one addition: **provenance must survive logging**. This is
  what `syslog` facilities, systemd-journald's `_TRANSPORT`/`STREAM_ID` fields,
  and Docker's `stdcopy` 8-byte stream header all exist for: multiplexing two
  streams into one sink is fine, _erasing which one a record came from_ is not.
  Docker is the closest analogue — `docker logs` can still separate stdout from
  stderr years later because the header was never dropped.
- **Foreign-id detection** is the standard cure for in-band echo in protocols
  that cannot separate channels: SMTP's `Message-ID` loop detection, DNS query
  IDs, JSON-RPC `id` correlation. Codex hands us a session identity for free; G2
  just checks it.
- **No third-party library fits.** The whole fix is one tag on a log line, one
  array on a state object, and three extra sentences in an error message.

## 7. Upstream report

The upstream defect is RC4 from #2136, already filed as
**[openai/codex#36804](https://github.com/openai/codex/issues/36804)**: under
`RUST_LOG=debug`, `codex exec --json` writes `codex_otel.log_only` /
`codex_otel.trace_safe` `event.name="codex.tool_result"` records whose `output=`
attribute is the tool's **raw, unescaped, multi-line stdout**.

This incident is not a separate upstream bug, so it was added as a
**[comment on that issue](https://github.com/openai/codex/issues/36804#issuecomment-5188101032)**
rather than filed as a duplicate — but it materially strengthens it, and the
report was worth updating because of what it proves:

1. **No nested agent is required.** #2136 could be read as "don't run agent CLIs
   inside agent CLIs". Here the trigger is `sed -n '1,1500p' <file>` on a
   two-day-old log. Any `cat`, `grep`, `head`, `tail` or test-fixture dump of
   text that happens to contain NDJSON is enough.
2. **The dump is duplicated.** `exec_command` and `exec` each trace the same
   result, so one command echoed the payload **twice** — doubling any count a
   consumer derives.
3. **Minimal reproduction:**
   ```bash
   printf '{"type":"thread.started","thread_id":"deadbeef"}\n{"type":"turn.started"}\n' > /tmp/x.ndjson
   RUST_LOG=debug codex exec --json 'run: cat /tmp/x.ndjson' 2>stderr.txt
   grep -c '"turn.started"' stderr.txt   # > 0 — the payload is now indistinguishable from protocol
   ```
4. **Suggested fixes,** unchanged from #36804: JSON-escape the `output=`
   attribute (one line per record), or emit the trace as structured JSON, or at
   minimum wrap the dump in an unambiguous begin/end marker.
5. **Workaround for consumers,** which is what Hive Mind does: never parse stderr
   as protocol; keep provenance on every mirrored line; check `thread_id`
   identity.

## 8. Impact and how to recognise this in a log

With this PR, a log written by a current build answers the question directly:

- Protocol lines carry `[STDOUT]`; telemetry carries `[STDERR]`. A `turn.started`
  under `[STDERR]` is echo, full stop — no timestamp-grouping heuristics needed.
- `🪞 Echoed protocol-shaped lines on codex stderr …` (from #2136) counts what was
  discarded; `🧬 Foreign thread IDs …` names the intruding thread.
- If the gate ever fires wrongly again, the posted comment itself contains the
  ordered lifecycle and the echo counts, so the false positive is visible without
  the raw log.

For older logs (like this one), the recipe is in
[`experiments/issue-2140`](../../../experiments/issue-2140): group lines by
`log()` timestamp, classify a group as stderr iff it contains a `RUST_LOG`
tracing line, then replay through the real parser.
