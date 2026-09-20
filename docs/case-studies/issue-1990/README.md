# Case study — Issue #1990: "For some reason docker isolation failed with 2 tasks"

> Two long-running `solve --tool codex` tasks, run under **detached Docker
> isolation**, reported **SUCCESS (`Exit Code: 0`)** to `solve`, the Telegram
> bot, and the `start-command` (`$`) session tracker — while in reality both
> containers had **run out of disk** and the Codex run was killed mid-turn. No
> PR/commits were produced, yet everything upstream recorded success and the
> container filesystem was discarded.

- **Issue:** https://github.com/link-assistant/hive-mind/issues/1990
- **PR:** https://github.com/link-assistant/hive-mind/pull/1991
- **Raw data:** [`raw/`](./raw) — the two detached-isolation logs verbatim, plus the issue JSON.
- **Date of incident:** 2026-06-26 (`konard/hive-mind-dind:2.0.23`)

---

## 1. The two failed sessions

Both were `solve … --tool codex --think max --attach-logs --verbose` jobs against
`link-assistant/formal-ai`, launched as **detached** Docker-isolated sessions by
`start-command` (`$`).

|                     | Session A                                                                                                       | Session B                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| start-command UUID  | `ef57d6aa-385b-4ebf-8d27-52a32007984b`                                                                          | `637501c1-9282-44c9-b41e-3fe9c06a04c8`                                                                          |
| parent session      | `c7ac32e7-2881-4789-941f-984b71c551c2`                                                                          | `28cfc136-4c54-4e67-9c68-0d616f5ae5fa`                                                                          |
| target issue        | formal-ai#460                                                                                                   | formal-ai#465                                                                                                   |
| container           | `fd8a2409d401…`                                                                                                 | `43e918bf8051…`                                                                                                 |
| reported `exitCode` | **0**                                                                                                           | **0**                                                                                                           |
| reported `status`   | `executed`                                                                                                      | `executed`                                                                                                      |
| inner-log footer    | `Exit Code: 0`                                                                                                  | `Exit Code: 0`                                                                                                  |
| raw log             | [`raw/isolation-docker-ef57d6aa-…log.txt`](./raw/isolation-docker-ef57d6aa-385b-4ebf-8d27-52a32007984b.log.txt) | [`raw/isolation-docker-637501c1-…log.txt`](./raw/isolation-docker-637501c1-9282-44c9-b41e-3fe9c06a04c8.log.txt) |

Both containers passed the **pre-flight** disk check easily — and then exhausted
the disk during the Rust build:

```
# Session A (ef57d6aa), log line 48
💾 Disk space check: 28613MB available (10240MB required) ✅
# Session B (637501c1), log line 48
💾 Disk space check: 22081MB available (10240MB required) ✅
```

---

## 2. Timeline of events (reconstructed from the raw logs)

Using **Session A (ef57d6aa)**, which has the clearest disk evidence:

| Log line  | Codex event / log                                                                                                                                                                        | What happened                                                                                                |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 48        | `💾 Disk space check: 28613MB available ✅`                                                                                                                                              | Pre-flight passes — plenty of disk at start.                                                                 |
| 365       | `📊 [DISK] phase=after_clone … size=261 MB`                                                                                                                                              | Repo cloned; disk still fine.                                                                                |
| 742       | `{"type":"thread.started", …}`                                                                                                                                                           | Codex conversation begins.                                                                                   |
| 774       | `{"type":"turn.started"}`                                                                                                                                                                | **The (only) turn begins.**                                                                                  |
| 742–14619 | 288× `item.completed`, 310× `command_execution`, 73× `agent_message`, 26× `file_change`                                                                                                  | Codex does a large amount of real work — reads the issue, edits code, runs `cargo` builds repeatedly.        |
| 4777      | `Process exited with code 101`                                                                                                                                                           | A `cargo` build fails (exit 101) — first build failure.                                                      |
| 14438     | `rustc-LLVM ERROR: IO failure on output stream: No space left on device`                                                                                                                 | **Disk is now exhausted.**                                                                                   |
| 14442     | `No space left on device (os error 28)`                                                                                                                                                  | `cargo` can no longer compile.                                                                               |
| 14609     | `{"type":"item.completed","item":{"type":"agent_message","text":"`target/` is 14 GB and is the immediate pressure point. I'm clearing generated Cargo build artifacts, then I'll reru…"` | Codex _notices_ the disk problem and starts trying to recover — **mid-turn**.                                |
| 14619     | `c7ac32e7-…` then `Exit Code: 0`                                                                                                                                                         | The process is **killed/torn down mid-turn**; the log just **stops**. No `turn.completed`, no `turn.failed`. |

The decisive fact, confirmed by counting events in both raw logs:

```
$ grep -o '"type":"turn\.[a-z]*"' raw/isolation-docker-ef57d6aa-*.log.txt | sort | uniq -c
      1 "type":"turn.started"
        # turn.completed: 0     turn.failed: 0
```

Both sessions are identical on this axis: **`turn.started` = 1, `turn.completed` = 0,
`turn.failed` = 0.** The Codex turn never closed. The run was interrupted while
the turn was still open, yet the process exited `0`.

> **Note on the `--status` timestamps in the issue body.** The `start-command
--status` dump shows `endTime` ≈ `12:50`, while the inner-log footer reads
> `Finished: 10:48–10:49`. The footer is written by the inner `solve`; the
> `--status` `endTime` is the detached wrapper's own bookkeeping queried later.
> Neither contradicts the core finding — both layers recorded `exitCode 0`.

---

## 3. Every requirement in the issue

Verbatim decomposition of https://github.com/link-assistant/hive-mind/issues/1990:

| #   | Requirement (from the issue)                                                                                                                                                     | Status                                                                                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | "make sure such situations **will not be registered as success**"                                                                                                                | ✅ Codex/Gemini/Qwen completion gates (this PR).                                                                                                              |
| R2  | "**retry them from AI session (preserving the context)**, with full restart on all levels, like we do with `--tool claude`"                                                      | ✅ On a flagged failure each tool now sets `argv.resume = sessionId` so the outer restart loop resumes the same AI session (same mechanism Claude uses).      |
| R3  | "register that as **fail, so the file system of docker will be preserved**"                                                                                                      | ✅ `success:false` → inner `solve` exits non-zero → docker footer `Exit Code: 1` → isolation reports failure → container FS retained (`keepContainerOnFail`). |
| R4  | "If issue is related to **link-foundation/start** … report issue there … temporary workaround on our side … reported to issue as well"                                           | ✅ Upstream issue filed (see §6) with repro + workaround + code-fix suggestion; our gate is the in-repo workaround.                                           |
| R5  | "**download all logs and data** … compile to `./docs/case-studies/issue-{id}`"                                                                                                   | ✅ This folder + [`raw/`](./raw).                                                                                                                             |
| R6  | "deep case study analysis … **search online** … reconstruct timeline … list each requirement … find root causes … propose solutions … check known existing components/libraries" | ✅ This document (§2, §3, §4, §5, §7).                                                                                                                        |
| R7  | "If **not enough data** to find root cause, add **debug output and verbose mode**"                                                                                               | ✅ Data _was_ sufficient (turn-lifecycle signal). The gate additionally logs the disk-exhaustion evidence as diagnostics for future iterations.               |
| R8  | "if we have issue in **multiple places, it should be fixed in all of them**"                                                                                                     | ✅ Audited all tool libs: codex, gemini, qwen gated; claude already gated; opencode intentionally excluded with documented rationale (see §5).                |
| R9  | "plan and execute everything in **this single pull request** (#1991)"                                                                                                            | ✅ All work on `issue-1990-205daff5585b` → PR #1991.                                                                                                          |

---

## 4. Root-cause analysis (per problem)

### Problem 1 — exit-0 reported as success despite an interrupted run (the core bug)

**Root cause.** `solve`'s per-tool success determination trusted the **process
exit code** as the sole signal. `codex exec --json` (and the gemini/qwen
stream-json equivalents) can exit `0` even when the run was **cut off mid-turn**:
the OS/container killed the build (or OOM/disk-full teardown raced the process),
the codex process unwound, and the wrapper's exit status was `0`.

The Codex JSONL protocol is explicitly turn-structured —
`thread.started → turn.started → item.completed* → turn.completed` (per the
[Codex `exec --json` cheatsheet](https://takopi.dev/reference/runners/codex/exec-json-cheatsheet/)
and [openai/codex app-server docs](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)).
A healthy run **always** closes its turn with `turn.completed` (or `turn.failed`
on a handled error). Our code never checked for that terminal event, so an
interrupted run looked identical to a clean one.

### Problem 2 — disk exhaustion inside the container

**Root cause.** The Rust build of `formal-ai` grew `target/` to **14 GB** (Codex
itself says: _"`target/` is 14 GB and is the immediate pressure point"_),
exceeding the container's free disk. Pre-flight only checks disk **once, at
start** (28.6 GB free), so it cannot catch growth during the build. This is the
_trigger_, but **not** the bug we are asked to fix — disk pressure will always be
possible; the requirement is that it must be **detected and reported as failure**,
not silently swallowed. (Continuous in-build disk monitoring — versus the single
pre-flight check — would be a worthwhile follow-up but is out of scope here.)

### Problem 3 — the container filesystem was discarded

**Root cause.** Because the run was reported as success, the isolation layer
treated the container as a completed-OK job and removed it (`keepContainerOnFail`
only retains on **failure**). Fixing Problem 1 fixes this for free: a flagged
failure now preserves the container for inspection.

### Problem 4 — string-scanning for disk errors is unreliable (the trap to avoid)

**Root cause / hazard.** The naïve fix — "grep the output for `No space left on
device`" — is wrong, and Session B proves why. Session B's **only** occurrence of
that phrase is at log line 1460, **inside an echoed file's contents**
(`aggregated_output` of a `command_execution` — a case study README it `cat`ed),
not a real disk error. Codex echoes the stdout of every command it runs back into
its NDJSON stream (this is the [#1955](https://github.com/link-assistant/hive-mind/issues/1955)
echo trap). Gating on that string would both **miss** real failures (the phrase
may never appear in the tool's own stream) and **fire** on innocent echoes.

➡️ The robust signal is **structural** (did the turn/terminal event close?), not
**textual**. Disk strings are used only as _supporting diagnostics_.

---

## 5. The fix (and why it is shaped this way)

A run is reported as success **only if** it both exits `0` **and** emits its
tool-specific terminal completion event.

| Tool         | Terminal signal                                           | Before                                                    | After                                                                                                  |
| ------------ | --------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **codex**    | paired `turn.started`/`turn.completed` (or `turn.failed`) | exit code only                                            | `getCodexCompletionHealth()` — `turnCompleted + turnFailed ≥ turnStarted` (`src/codex-health.lib.mjs`) |
| **claude**   | final `result` event                                      | **already gated** (`shouldFailClaudeStreamWithoutResult`) | unchanged                                                                                              |
| **gemini**   | terminal `result` event                                   | exit code only                                            | `getTerminalEventCompletionHealth()` (`src/tool-run-health.lib.mjs`)                                   |
| **qwen**     | terminal `result` event                                   | exit code only                                            | `getTerminalEventCompletionHealth()`                                                                   |
| **opencode** | none verified                                             | exit code only                                            | **intentionally NOT gated** — see below                                                                |

**Why opencode is excluded.** `opencode.lib.mjs` parses several event types
(`text`, `assistant`, `message`, `result`, `step_finish`) on a best-effort basis
and decides success **purely on the exit code** — there is no single terminal
completion event we have verified is _always_ emitted by `opencode run --format
json` before a clean exit. Gating opencode without first confirming upstream
(`sst/opencode`) that such an event is reliably flushed would risk converting
genuine successes into failures, so it is left as documented follow-up rather
than gated blindly. This decision is recorded in `src/tool-run-health.lib.mjs`.

**Context-preserving retry (R2).** On a flagged failure each tool sets
`if (sessionId && !argv.resume) argv.resume = sessionId;`, so the outer
restart loop resumes the **same** AI session — the "full restart on all levels,
like `--tool claude`" the issue asks for.

**Failure → preserved container (R3).** `success:false` propagates:
inner `solve` exits non-zero → docker footer `Exit Code: 1` →
`isolation-runner.lib.mjs` `parseSessionExitFooter` reports failure →
container filesystem retained.

**Disk evidence is diagnostic-only (Problem 4).** `isENOSPC()` matches are
collected from the output and surfaced in the failure log to speed up the next
investigation, but they are **never** an independent failure gate.

### Tests

- `tests/test-issue-1990-codex-incomplete-session-false-success.mjs` — codex gate (incomplete vs complete vs echoed-disk vs incomplete-with-disk).
- `tests/test-issue-1990-multitool-incomplete-session.mjs` — shared helper + gemini + qwen gates, incl. the #1955 echo guard.
- `tests/test-issue-1955-codex-fixture-false-positive.mjs` — confirms the echo trap is not re-introduced.

---

## 6. Upstream report (link-foundation/start)

The `start-command` (`$`) detached-isolation tracker faithfully reported what the
inner process told it (`Exit Code: 0`) — in both sessions the inner `solve`
process genuinely caught the disk error, continued, and exited `0`, so this is
**primarily a hive-mind bug**, fixed by the per-tool gate above. `start` already
resolves the real exit code from the `Exit Code:` log footer and
`docker inspect -f '{{.State.ExitCode}}'` (#136), but it has no field for a
container that hit an OOM/disk-full event yet still exited `0`.

A **defense-in-depth enhancement** was therefore filed upstream (with a
reproducible example, our workaround, and a concrete code suggestion):

➡️ **[link-foundation/start#144](https://github.com/link-foundation/start/issues/144)** —
surface `State.OOMKilled` (and don't auto-remove an abnormally-terminated
container's filesystem under the #140 remove-on-finish default).

The proposal is explicit that it closes the **OOM-kill** blind spot generically
for every consumer, but the _disk-full-but-process-survived_ variant from this
incident is only reliably detectable **inside** the wrapped command — which is
exactly the gate we added in hive-mind. Our in-repo gate is the workaround
referenced in #144.

> **Delivered.** [link-foundation/start#144](https://github.com/link-foundation/start/issues/144)
> was closed and shipped in **`start-command@0.30.2`**: a detached/isolated run
> now surfaces the container's `OOMKilled` status, and an abnormally-terminated
> container's filesystem is preserved (not auto-removed) so it can be inspected.
> This PR bumps the `start-command` pin in `Dockerfile`/`Dockerfile.dind` from
> `0.30.1 → 0.30.2` to pick it up. The two halves are complementary, not
> redundant: the upstream change closes the **OOM-kill** blind spot for every
> `start` consumer, while hive-mind's per-tool terminal-completion gate remains
> the primary fix for the _disk-full-but-process-survived_ variant that exits `0`
> with no abnormal container status for `start` to report.

---

## 7. Known components / prior art reused

- **codex turn-lifecycle protocol** — `thread.started → turn.started → item.completed* → turn.completed`
  ([cheatsheet](https://takopi.dev/reference/runners/codex/exec-json-cheatsheet/),
  [openai/codex app-server](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)).
- **Claude Agent SDK stream-json `result` event** — already used by `claude.lib.mjs`
  (`shouldFailClaudeStreamWithoutResult`); gemini-cli and qwen-code adopted the
  same schema, so the same terminal-event gate applies.
- **`isENOSPC()`** (`src/lib.mjs`) — existing ENOSPC matcher, reused for
  diagnostics only.
- **`parseSessionExitFooter` / `DOCKER_UNKNOWN_EXIT_CODE`** (`src/isolation-runner.lib.mjs`,
  from [#1939](https://github.com/link-assistant/hive-mind/issues/1939) /
  [link-foundation/start#136](https://github.com/link-foundation/start/issues/136)) — the
  isolation-layer exit decoding the gate feeds into.
- **#1955 echo-trap analysis** — the reason disk strings are diagnostic-only.

## 8. Reproduce

```bash
# Unit/integration repro (no docker needed) — drives the real tool functions
# with a mocked $ that yields an exit-0 stream missing its terminal event:
node tests/test-issue-1990-codex-incomplete-session-false-success.mjs
node tests/test-issue-1990-multitool-incomplete-session.mjs

# Inspect the real evidence:
grep -o '"type":"turn\.[a-z]*"' \
  docs/case-studies/issue-1990/raw/isolation-docker-ef57d6aa-*.log.txt \
  | sort | uniq -c          # -> 1 turn.started, 0 turn.completed
```
