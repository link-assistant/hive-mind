# Case study — Issue #2136: "Codex exited 0 but the run did not complete — treating as failure"

> A `solve --tool codex` run did **all** of its work — it opened
> [formal-ai#913](https://github.com/link-assistant/formal-ai/pull/913), got all
> ~30 CI checks green, and Codex closed its turn normally — and was then declared
> **failed** by Hive Mind's own completion gate. A "🚨 Solution Draft Failed"
> comment was posted on a pull request that was, in fact, complete and was merged
> a few hours later.
>
> The gate compared `turn.started` (2) with `turn.completed` (1). The second
> `turn.started` was never emitted by Codex: it was Codex's **OTEL trace of a
> tool result**, echoing the raw stdout of a nested agent CLI the task itself had
> started. Hive Mind parsed Codex's **stderr** with the same parser it uses for
> the `--json` **stdout** protocol, so a line printed _about_ the run was counted
> _as_ the run.

- **Issue:** https://github.com/link-assistant/hive-mind/issues/2136
- **PR:** https://github.com/link-assistant/hive-mind/pull/2139
- **Raw data:** [`raw/`](./raw) — the full 26,824-line run log (gzipped), the issue
  JSON, the failure comment JSON, and the target PR JSON.
- **Date of incident:** 2026-08-03, execution `ad0c801a-8338-4008-9909-2663d1566bf6`
  (`codex` `app.version=0.146.0`, model `gpt-5.6-sol`, detached Docker isolation).

All line numbers below refer to
[`raw/solve-run-ad0c801a-8338-4008-9909-2663d1566bf6.log.gz`](./raw/solve-run-ad0c801a-8338-4008-9909-2663d1566bf6.log.gz)
(`zcat` it first).

---

## 1. The run

```
Execution ID: ad0c801a-8338-4008-9909-2663d1566bf6      (line 2)
Timestamp:    2026-08-03 10:21:04.042                   (line 3)
Command:      solve https://github.com/link-assistant/formal-ai/issues/902 \
                --think medium --auto-merge --tool codex --attach-logs \
                --verbose --no-tool-check --disable-report-issue --language en
Environment:  docker      Mode: detached                (lines 5–6)
Finished:     2026-08-03 12:20:57.434   Exit Code: 1    (lines 26823–26824)
```

`--verbose` is the decisive flag: `getCodexExecEnv(verbose)` in
[`src/codex.lib.mjs`](../../../src/codex.lib.mjs) sets `RUST_LOG=debug` only in
verbose mode, which is what makes Codex emit the `codex_otel.log_only` records on
stderr in the first place.

The task itself (formal-ai#902) is about formal-ai's _coding-client contract_, so
the work Codex did included **running other agent CLIs** and inspecting their
NDJSON output. That is what put protocol-shaped JSON inside Codex's traces.

## 2. Timeline of events

| Log line    | Event                                                                                                                                                                                     | What happened                                                                                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2–6         | `Execution ID … Command: solve … --tool codex --verbose`                                                                                                                                  | Detached Docker session starts; `--verbose` ⇒ `RUST_LOG=debug` for the Codex child.                                                                                  |
| 750–755     | `gh pr create stdout: https://github.com/link-assistant/formal-ai/pull/913`                                                                                                               | Hive Mind opens the draft PR **before** handing the task to Codex.                                                                                                   |
| 1023        | `{"type":"thread.started","thread_id":"019fc725-cf6e-7242-a952-dd819e406a63"}`                                                                                                            | **Codex's own** thread — this is the real session id.                                                                                                                |
| 1060        | `{"type":"turn.started"}`                                                                                                                                                                 | **Codex's own (and only) turn begins.**                                                                                                                              |
| 9322–9331   | `INFO codex_otel.log_only: event.name="codex.tool_result" tool_name=write_stdin … output=…`                                                                                               | Codex traces a `write_stdin` tool result and **dumps the raw stdout of the nested agent** — including `thread.started` (9330) and **`turn.started` (9331)**.         |
| 9326        | `Warning: truncated output (original token count: 16102)`                                                                                                                                 | Codex **truncates** that dump — one of 20 such truncations in the run. The nested agent's matching `turn.completed` is cut off, so the echo is _unbalanced_.         |
| 12000–26000 | 152 reasoning items, 280 command executions, 24 file changes                                                                                                                              | Codex does the real work: implements the fix, runs the full formal-ai test suite, pushes, waits for CI.                                                              |
| 26634       | `{"type":"turn.completed","usage":{"input_tokens":41451312,…}}`                                                                                                                           | **Codex closes its turn normally.** Exit code from the CLI: `0`.                                                                                                     |
| 26740–26746 | `PR: https://github.com/link-assistant/formal-ai/pull/913` … "All five fresh GitHub Actions workflows passed"                                                                             | Codex's final message: the job is done.                                                                                                                              |
| 26747       | `📊 Codex JSON events: thread.started=2, turn.started=2, … config=1, log=12, message.part.updated=6, init=1, tool_use=2, message=1, formal_ai_completion=1, unknown=40, turn.completed=1` | The pollution is visible in plain sight: Codex has **no** `config` / `log` / `tool_use` / `formal_ai_completion` events — those are the nested agents' vocabularies. |
| 26760–26762 | `❌ Codex exited 0 but the run did not complete — treating as failure` / `turn.started=2, turn.completed=1, turn.failed=0`                                                                | The #1990 completion gate fires on a completed run.                                                                                                                  |
| 26802       | `📎 Failure log uploaded to Pull Request as public Gist (comment id=5166232530)`                                                                                                          | [The "Solution Draft Failed" comment](https://github.com/link-assistant/formal-ai/pull/913#issuecomment-5166232530) is posted at 12:20:54Z.                          |
| 26824       | `Exit Code: 1`                                                                                                                                                                            | `solve` reports failure.                                                                                                                                             |

**Ground truth:** formal-ai PR #913 was **merged at 2026-08-03T16:02:52Z** with
every check `SUCCESS` (see [`raw/formal-ai-pr-913.json`](./raw/formal-ai-pr-913.json)).
The run that was reported as failed had succeeded.

### The echoed block, verbatim (lines 9322–9331)

```
2026-08-03T10:54:47.430787Z  INFO codex_otel.log_only: event.name="codex.tool_result" tool_name=write_stdin call_id=exec-7cd150d3-… arguments={"session_id":68719,…} duration_ms=10002 success=true output=Chunk ID: 4fc4fd
Wall time: 10.0021 seconds
Process running with session ID 68719
Original token count: 16102
Output:
Warning: truncated output (original token count: 16102)
Total output lines: 168

{"thread_id":"019fc742-c36e-7f20-87f0-6876ebf9b272","type":"thread.started"}
{"type":"turn.started"}
```

Two properties of this block matter:

1. `output=` is **not escaped** — the tool's multi-line stdout is spliced into the
   trace as raw lines. A consumer reading stderr line-by-line cannot tell trace
   from payload.
2. The dump is **truncated**, so the nested `turn.completed` that would have
   balanced the count never appears. Had Codex not truncated, this bug would have
   stayed latent (and would instead have shown up as inflated token usage).

## 3. Requirements extracted from the issue

The issue body asks for a full case-study treatment. Each requirement and its
disposition:

| #   | Requirement (from the issue)                                                                                       | Where it is addressed                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Download all logs/data related to the issue into the repository                                                    | [`raw/`](./raw) — full run log (gzipped, 1.2 MB), issue JSON, failure-comment JSON, target-PR JSON.                                         |
| R2  | Compile them into `./docs/case-studies/issue-2136`                                                                 | This folder.                                                                                                                                |
| R3  | Deep case-study analysis: reconstruct the sequence of events                                                       | §1–§2 above, with log line numbers.                                                                                                         |
| R4  | List each and every requirement from the issue                                                                     | This table.                                                                                                                                 |
| R5  | Find root causes of each problem                                                                                   | §4 — three distinct defects (RC1–RC3), plus one aggravating upstream behaviour (RC4).                                                       |
| R6  | Propose possible solutions and solution plans for each requirement                                                 | §5, including the options considered and rejected.                                                                                          |
| R7  | Check known existing components/libraries that solve similar problems                                              | §6.                                                                                                                                         |
| R8  | If data is insufficient, add debug output / verbose mode to find the root cause next time                          | §5, Layer C: `🪞 Echoed protocol-shaped lines…` and `🔁 Codex turn lifecycle: …` verbose lines (codex), plus equivalents for qwen/opencode. |
| R9  | Report the issue upstream if another project is involved, with reproducible example, workaround and fix suggestion | §7 — reported to `openai/codex`.                                                                                                            |
| R10 | Apply the requirement to the **entire** codebase — fix every place with the same defect                            | §4.3 — full sweep of all six tool integrations; codex, qwen and opencode changed, gemini and claude verified clean.                         |

## 4. Root-cause analysis

### RC1 (primary) — stderr was parsed as if it were the `--json` protocol stream

`codex exec --json` writes NDJSON to **stdout**. Its **stderr** is human/OTEL
tracing text. `executeCodexCommand` nevertheless fed both through
`parseCodexExecJsonOutput`:

```js
// before
const errorOutput = codexStderrLines.write(rawError);
codexJsonState = parseCodexExecJsonOutput(errorOutput, codexJsonState, mappedModel);
```

Every protocol-shaped line found anywhere on stderr therefore incremented
`eventCounts`, and could also set `sessionId`, add token usage, or push into the
error buckets. The `📊 Codex JSON events` line at 26747 shows how far this went:
`config`, `log`, `message.part.updated`, `init`, `tool_use`, `message`,
`formal_ai_completion` and 40 `unknown` events are **not** part of the Codex event
vocabulary at all — they are other agents' protocols, counted as Codex's.

This is the same _class_ of defect as the already-fixed Codex "echo"
false-positives (#1955, #1968, #2102), where Codex re-emitting a command's stdout
made Hive Mind believe an error had occurred. Those fixes each hardened one
_text pattern_; none of them addressed the underlying premise that **stderr is a
protocol stream**.

### RC2 (secondary) — the completion gate compared counts instead of order

`getCodexCompletionHealth` (added for #1990, where a run really was killed
mid-turn) used:

```js
const incompleteSession = hadActivity && turnCompleted + turnFailed < Math.max(turnStarted, 1);
```

Counting is fragile: **any** spurious `turn.started` from **any** future source
flips a completed run to failed. The question the gate actually wants answered is
"did the last turn finish?", which is an ordering question. RC2 is independent of
RC1 — either fix alone prevents this incident; both are applied.

### RC3 (sweep) — the same premise elsewhere in the codebase

| Tool     | Parsed stderr as protocol?    | Consequence                                                                                                                                                                                                | Action                                                                                                                                                  |
| -------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| codex    | **yes**                       | False failure (this incident), session-id hijack, inflated usage, false errors                                                                                                                             | **Fixed** — stdout only.                                                                                                                                |
| qwen     | **yes**                       | A `{"type":"error"}` echoed on stderr lands in `state.errors`, and qwen fails a run outright when `errors.length > 0`; also session-id/usage pollution and a **shared** line buffer across the two streams | **Fixed** — stdout only, independent buffers per stream.                                                                                                |
| opencode | **yes** (deliberately, #1263) | Usage/summary skew only — opencode has no terminal-event completion gate, and #1263 added stderr parsing on purpose because opencode writes some records there                                             | **Behaviour unchanged**, but stderr records are now **counted and reported** (`🪞 JSON records parsed from OpenCode stderr: N`) so the skew is visible. |
| gemini   | no                            | stderr is used as text (error classification) only                                                                                                                                                         | none                                                                                                                                                    |
| claude   | no                            | stdout-only `--output-format stream-json`                                                                                                                                                                  | none                                                                                                                                                    |

### RC4 (upstream, aggravating) — Codex OTEL traces splice unescaped tool output into stderr

`codex_otel.log_only: event.name="codex.tool_result" … output=<raw multi-line
stdout>` makes Codex's own stderr **structurally ambiguous**: any tool whose
output happens to be NDJSON is indistinguishable from a protocol stream, and the
`Warning: truncated output` path can cut the dump at an arbitrary line boundary.
This does not excuse RC1 — stderr should never have been trusted — but it is a
real robustness problem for every consumer of `codex exec --json` under
`RUST_LOG=debug`. Reported upstream (§7).

## 5. The fix

Three layers, deliberately redundant, in a single PR.

**Layer A — stream separation (`src/codex.lib.mjs`).**
`parseCodexExecJsonOutput(output, state, requestedModelId, { source })`. Only
`source === 'stdout'` is treated as protocol. JSON objects seen on stderr are
counted into a new `telemetryEventCounts` bucket and otherwise ignored — they
never touch `eventCounts`, `sessionId`, `tokenUsage`, `streamErrors` or
`itemErrors`. The _text_ diagnostics that legitimately live on stderr
(`parseCodexDiagnosticLine`, the #2102 plugin-install rejection matcher) still
run on stderr exactly as before. The end-of-stream flush now flushes each buffer
with its own `source`.

**Layer B — order-aware completion gate (`src/codex-health.lib.mjs`).**
The parser records an ordered `turnLifecycle` (`turn.started` → `turn.completed` →
…) from the protocol stream. The gate now asks:

```js
return turnLifecycle.at(-1) === 'turn.started'; // incomplete ⇔ the last turn never closed
```

falling back to the old count comparison when no lifecycle is available (so
hand-built states and older callers keep working). A stray extra `turn.started`
can no longer fail a completed run, while the genuine #1990 shape — the stream
ends mid-turn — still fails.

**Layer C — diagnostics (R8).** New verbose lines:

```
🪞 Echoed protocol-shaped lines on codex stderr (ignored, not codex events): turn.started=1, thread.started=1, …
🔁 Codex turn lifecycle: turn.started → turn.completed
🪞 JSON records on qwen stderr (ignored, not protocol events): …
🪞 JSON records parsed from OpenCode stderr: N (issue #2136: stderr is not a protocol stream …)
```

If a similar discrepancy ever recurs, the log now states outright how many
protocol-shaped lines came from the wrong stream and in what order the turns ran.

**Parity fixes.** qwen gets the same `source` separation _and_ an independent line
buffer per stream (the shared buffer could interleave a stdout fragment with a
stderr fragment into one bogus record). opencode keeps its #1263 behaviour and
gains the counter.

**Test.** `tests/test-issue-2136-codex-telemetry-echoed-turn-events.mjs` — 21
assertions in five sections, built from the fixtures above, including an
end-to-end `executeCodexCommand` run whose stderr replays the incident block.
Verified to fail before the fix (5 passed / 11 failed) and pass after.

### Options considered and rejected

| Option                                                                      | Why not                                                                                                                               |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Strip `codex_otel.log_only … output=` blocks with a regex before parsing    | The same whack-a-mole as #1955/#1968/#2102: it hardcodes one trace format, and truncation means the block has no reliable end marker. |
| Ignore lines that arrive after an `output=` marker until the next timestamp | Heuristic, and still assumes stderr _may_ be protocol.                                                                                |
| Drop the completion gate entirely                                           | #1990 (a container killed mid-turn reporting exit 0) is a real failure mode; the gate must stay.                                      |
| Only fix the gate (Layer B)                                                 | Leaves session-id hijacking, inflated usage and false error events from echoed stderr in place.                                       |
| Require `turn.completed` to be the last event, strictly                     | Codex legitimately emits post-turn events in some flows; "the last _lifecycle_ event is not `turn.started`" is the precise condition. |

## 6. Existing components and prior art

- **In this repo.** `src/tool-run-health.lib.mjs` (`getTerminalEventCompletionHealth`)
  already generalises "did a terminal event arrive?" for gemini/qwen; the codex
  gate is separate because Codex's lifecycle is turn-based. `createLineBuffer`
  (#2119) is the framing primitive reused here per stream.
- **The general pattern** is _out-of-band vs in-band signalling_: a protocol must
  not share a channel with free-form text. Every mature agent CLI that emits
  machine-readable output does this by separating the channels —
  `claude --output-format stream-json` (stdout only), `gemini` (stdout NDJSON,
  stderr text). Where a library does need both on one channel, the standard
  answer is **framing**: length-prefixed records (LSP's `Content-Length` headers,
  Docker's `stdcopy` 8-byte stream multiplexing header) or escaping, never
  "hope the payload doesn't look like the protocol".
- **OpenTelemetry** itself specifies attribute values as _strings_; the raw
  multi-line splice in RC4 is a formatting choice of the `log_only` exporter, not
  something OTEL requires. Consumers of OTLP/JSON never face this because the
  value is JSON-escaped.
- No third-party library is a fit here: the fix is one boolean's worth of
  provenance tracking plus an ordering check. Pulling in a stream-demux dependency
  would add surface area without removing any code.

## 7. Upstream report

Filed against `openai/codex` (RC4): under `RUST_LOG=debug`, `codex exec --json`
writes `codex_otel.log_only: event.name="codex.tool_result" … output=` records
whose `output=` value is the tool's **raw, unescaped, multi-line stdout**, and
which may be silently cut by `Warning: truncated output`. Any consumer that reads
Codex's stderr line-by-line can be fed arbitrary attacker- or task-controlled text
that is indistinguishable from Codex's own NDJSON. Suggested fixes: JSON-escape
the `output=` attribute (one line per record), or emit the trace as structured
JSON, or at minimum wrap the dump in an unambiguous begin/end marker. Workaround
for consumers, and the one applied here: never parse stderr as protocol.

## 8. Impact and how to recognise this in a log

Recognise it by the `📊 Codex JSON events` line: if it lists event types Codex
does not emit (`config`, `log`, `tool_use`, `init`, `message`, or a large
`unknown=` count), stderr contamination has occurred. After this fix those land in
the `🪞 Echoed protocol-shaped lines on codex stderr` line instead, and the
`🔁 Codex turn lifecycle` line shows the real, ordered truth.
