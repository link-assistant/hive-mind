# Issue 1946 Case Study: `--isolation docker` Issues (async / session visibility / image-prep logs / passthrough)

## Summary

Issue [#1946](https://github.com/link-assistant/hive-mind/issues/1946) is the
next iteration of the `--isolation docker` work that began in
[#1860](https://github.com/link-assistant/hive-mind/issues/1860),
[#1914](https://github.com/link-assistant/hive-mind/issues/1914) and
[#1939](https://github.com/link-assistant/hive-mind/issues/1939). An operator
ran `/solve … --isolation docker` from the Telegram bot (host
`konard/hive-mind-dind:2.0.6`). The previously-reported premature-status bug was
gone — `$ --list`/`$ --status` correctly reported `status executing` with the
session ids visible — but **five** distinct problems remained:

1. **No early session id / isolation in the bot message (and the bot felt
   "blocked").** While the container was starting, the Telegram message stayed an
   info-less `🔄 Starting...`. The session UUID and `Isolation: docker` only
   appeared once the launch returned, so for the whole startup window the run was
   not addressable by `/watch`, `/log` or `/status`, and the operator had to fall
   back to `$ --list` to discover the id. (Screenshots: `raw/img1-initial.png`
   has no session info; `raw/img2-uuid-isolation.png` finally shows it; it "took a
   long time to get there".)
2. **The image-preparation phase is missing from the session log.** Seven
   minutes into the run, `$ --upload-log` produced a **546-byte** log — only the
   header. The multi-GB `docker pull` / image-load output that the run was busy
   with was nowhere in the session log file. This is the exact gap flagged
   previously in [#1939](https://github.com/link-assistant/hive-mind/issues/1939).
3. **`$` does not preserve the full log of "preparing image + execution" in one
   file.** The reason the `$` wrapper exists at all is the guarantee that _every_
   step that ran is captured; the image-prep phase breaks that guarantee
   (a superset of problem 2).
4. **The host image is re-downloaded inside DinD (~30 GB, ~1 hour).** The nested
   Docker daemon started with an empty image store and re-pulled
   `konard/hive-mind-dind:2.0.6` instead of reusing the copy the host already had
   — the host-image passthrough gap from
   [#1914](https://github.com/link-assistant/hive-mind/issues/1914) /
   [link-foundation/box#94](https://github.com/link-foundation/box/issues/94).
5. **It eventually worked** (`raw/img3-worked.png`: `✅ Work session finished
successfully`, duration 54m 49s) — but only after spending an hour and ~30 GB
   re-downloading an image the host already had.

This study reconstructs the timeline from the captured terminal transcript and
the three screenshots, enumerates every requirement, pins each problem to log
evidence, records the downstream fix applied in this repository (problems 1 & the
diagnostics for 2), and the upstream follow-ups for `$` (link-foundation/start —
problems 2/3) and `box` (link-foundation/box — problem 4).

## Evidence Collected

All raw evidence lives under [`raw/`](./raw):

| File                          | What it is                                                                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issue-1946.json`             | Issue body, labels, metadata (`gh issue view --json`).                                                                                              |
| `issue-1946-body.md`          | Issue body as Markdown, including the full terminal transcript.                                                                                     |
| `issue-comments.json`         | Issue comments (empty at capture time).                                                                                                             |
| `pr-1948.json`                | The pull request that carries this fix.                                                                                                             |
| `failed-session-terminal.log` | **Primary evidence.** The operator transcript: `$ --list`, `$ --status`, `$ --upload-log` (546 B), `$ --version`, and the `cat` of the session log. |
| `img1-initial.png`            | Telegram message during startup: `⏳ Starting...` with **no** session id / isolation.                                                               |
| `img2-uuid-isolation.png`     | Telegram message later: `⏳ Executing...` finally showing `Session:` + `Isolation: docker`.                                                         |
| `img3-worked.png`             | Final message: `✅ Work session finished successfully`, duration `54m 49s`.                                                                         |
| `start-command-npm.json`      | npm metadata for `start-command` (latest `0.29.1`).                                                                                                 |
| `start-command-repo.json`     | start-command (link-foundation/start) repo metadata (for the upstream report).                                                                      |
| `box-repo.json`               | box (link-foundation/box) repo metadata (for the upstream report).                                                                                  |

## Timeline

Reconstructed from `raw/failed-session-terminal.log` and the screenshots (UTC).

| Time            | Event                                                                                                                                                                      | Evidence                       |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `05:36:11.618Z` | `$` launches the detached docker session (execution `08ec853a…`, container/session `9ea2993a…`, image `konard/hive-mind-dind:2.0.6`).                                      | log `startTime` (lines 13, 38) |
| (startup)       | Telegram message shows `⏳ Starting...` with **no** session id / isolation — the run is not yet addressable by `/watch`/`/log`/`/status`.                                  | `raw/img1-initial.png`         |
| `05:43:25.701Z` | `$ --list`: `status executing`, both ids present. The #1939 premature `executed/-1` bug does **not** recur.                                                                | log lines 1–28                 |
| `05:43:41.496Z` | `$ --status 08ec853a…`: still `executing`.                                                                                                                                 | log lines 29–53                |
| `~05:43:??Z`    | `$ --upload-log 08ec853a…`: **546 B** uploaded — ~7 min in, the session log holds only the header; the image pull is **not** logged.                                       | log lines 54–60                |
| `05:44:24.362Z` | Inside the container, `solve` finally writes its own log (`solve-2026-06-19T05-44-24-362Z.log`) — i.e. the image pull/dind-boot took until here before `solve` even began. | log (session-log `cat`)        |
| (later)         | Telegram message advances to `⏳ Executing...` and finally shows `Session: 9ea2993a…` + `Isolation: docker` — but "it took a long time to get there".                      | `raw/img2-uuid-isolation.png`  |
| `+54m 49s`      | `✅ Work session finished successfully` — after ~1 hour and a full ~30 GB re-download.                                                                                     | `raw/img3-worked.png`          |
| `2026-06-19`    | Issue #1946 opened by `konard`.                                                                                                                                            | `issue-1946.json` `createdAt`  |

The **546-byte log seven minutes in** (lines 54–60) is the smoking gun for
problems 2 & 3: while the run was busy pulling a multi-GB image, the session log
captured nothing but its own header. The screenshots are the evidence for
problem 1: `img1` (no session info) → `img2` (session info, late).

## Requirements From The Issue

**Bug-fix requirements**

- **R1 — Async / non-blocking + early session visibility.** Launching
  `--isolation docker` must not leave the bot message info-less and the session
  unaddressable while the container starts. Surface the session id + isolation
  immediately and do not block other commands.
- **R2 — Show session id + isolation like `--isolation screen`.** `/watch`,
  `/log`, `/status` need the UUID; it must be in the message from the start, not
  only after the launch finishes.
- **R3 — Image-download logs in the session log** (continuation of #1939): the
  `docker pull` / image-preparation output must be captured in the session log.
- **R4 — Host-image passthrough** so the multi-GB `konard/hive-mind-dind` image
  is reused inside DinD instead of re-downloaded.
- **R5 — `$` must preserve the full log of "preparing image + execution" in one
  file** — the wrapper's core guarantee.
- **R6 — Apply fixes across the entire codebase**, not just one call site.

**Meta / process requirements**

- **R7** — Download all logs/data into `./docs/case-studies/issue-1946/` and
  produce this deep analysis (timeline, requirements, root causes, solution
  plans), searching online and checking existing components/libraries.
- **R8** — If data is insufficient for a root cause, add debug/verbose output for
  the next iteration.
- **R9** — File issues on implicated upstream repos (link-foundation/start,
  link-foundation/box) with a reproducer, a workaround, and a code-level fix
  suggestion.
- **R10** — Execute everything in the single PR #1948 on branch
  `issue-1946-94305ac66541`.

## Root Causes

### Root Cause 1 (Problems 1 & 2, definite, fixed here): the bot surfaced the UUID and tracked the session only _after_ the blocking launch returned

The Telegram bot generates the isolation session UUID **locally**, before
start-command launches anything (`buildExecuteAndUpdateMessage` in
`src/telegram-command-execution.lib.mjs`). But in the old flow the UUID was
generated, then `await iso.runner.executeWithIsolation(...)` ran to completion,
and **only on success** were `trackSession()` and the
`formatExecutingWorkSessionMessage()` edit (which contains the `Session:` and
`Isolation:` lines) performed:

```js
session = iso.runner.generateSessionId();
result = await iso.runner.executeWithIsolation(...);   // <-- blocks for the whole image pull
if (result.success) {
  sessionInfo = { ...baseSessionInfo, isolationBackend: iso.backend, sessionId: session };
  trackSession(session, sessionInfo, VERBOSE);          // <-- only now is it addressable
}
// ...
await safeEdit(formatExecutingWorkSessionMessage({ sessionName: session, ... })); // <-- only now is it shown
```

Because start-command's detached docker backend does not return until the image
is pulled and the container is running, `executeWithIsolation` blocked for the
entire ~1-hour pull. During that window:

- the message stayed `🔄 Starting...` with no session info (`img1`), and
- the session was **not tracked**, so `/watch`, `/log` and `/status` could not
  find it — the operator had to use `$ --list` to recover the id.

This is why `--isolation screen` "felt fine" but docker did not: screen launches
in milliseconds, so the post-launch edit appears instantly; docker's hour-long
pull made the same post-launch timing pathological. The session id was _known the
whole time_ — it just wasn't shown or tracked until the launch returned.

> Note on "blocked execution": the bot uses Telegraf with
> `handlerTimeout: Infinity` and dispatches each update independently, and the
> launch is async I/O (`spawn` + awaited promise), so the Node event loop is not
> hard-blocked. The operator's "other commands are not working" symptom was the
> session being unaddressable plus the static message — both fixed by surfacing
> and tracking the session up front.

### Root Cause 2 (Problems 2, 3 & 5, upstream `$`): the image-prep phase is not written to the session log file

start-command owns the session log file (`/tmp/start-command/logs/isolation/
docker/<uuid>.log`). For the detached docker backend it writes a header, then
captures the container's output once the container is running. The
**image-preparation phase** — `docker pull` of `konard/hive-mind-dind:2.0.6` and
the dind daemon boot — happens _before_ the container's command stream is
attached, and its output is not appended to the session log. The 546-byte log at
the 7-minute mark (lines 54–60) is direct proof: the pull produced nothing in the
file. Hive Mind's own `runStartCommand()` does capture the `$` process's
stdout/stderr in memory, but it is a detached launch that returns once the
session is registered, and that buffer is not the persisted session log either.

The `$` wrapper's entire reason for existing is the guarantee that _everything
that ran is in one log file_ (problem 5). The fix has to live in start-command:
the detached docker session log must stream the image-preparation phase from the
first byte. This is the precise, file-level continuation of #1939's problem 2 and
relates to the (closed) [link-foundation/start#89](https://github.com/link-foundation/start/issues/89)
("better output for the virtual docker pull command") and
[#103](https://github.com/link-foundation/start/issues/103) ("Log is not being
recorded in real time").

### Root Cause 3 (Problem 4, deployment/upstream `box`): the nested daemon starts with an empty image store

Inside DinD the nested daemon begins with no images, so an image that is neither
preloaded nor passed through from the host is pulled on demand — ~30 GB for the
dind variant. This is the host-image passthrough gap diagnosed in #1914 and in
[link-foundation/box#94](https://github.com/link-foundation/box/issues/94) /
[#102](https://github.com/link-foundation/box/issues/102) (passthrough silently
no-ops when `DIND_HOST_PASSTHROUGH_IMAGES` is set but no host docker socket is
mounted). Hive Mind already detects and warns about this in
`preflightDockerIsolation` (`src/isolation-runner.lib.mjs`) and logs a
post-launch image-presence diagnostic (`logDockerIsolationPostLaunchDiagnostics`,
verbose). The actual passthrough must be wired up in the deployment / box.

## Online And Source Facts

- `start-command` latest published version is `0.29.1`
  (`raw/start-command-npm.json`); this is the release that fixed the #1939
  premature-status bug, and the #1946 transcript confirms that fix held
  (`status executing`, both ids present — no `executed/-1`). The image-prep
  logging gap (R3/R5) is a separate, still-open behaviour.
- The transcript's `$ --version` block shows `start-command version: 0.29.1`,
  `tmux: not installed`, `docker: 29.5.3` — i.e. the run used the fixed `$`.
- `docker run` uses Docker's default "missing" pull policy, so a host image
  seeded into the nested daemon (box passthrough) is reused, not re-pulled — no
  `--pull` plumbing is required on the Hive Mind side (issue #1879). The
  re-download is therefore a passthrough/deployment gap, not a Hive Mind pull
  flag.

## Solution Applied (this repository)

All changes are in PR #1948 on branch `issue-1946-94305ac66541`.

### Surface the session id + isolation immediately, and track the session up front (R1, R2, R6)

`src/work-session-formatting.lib.mjs` — `formatStartingWorkSessionMessage()` now
optionally takes `sessionName` + `isolationBackend` and renders the `Session:` /
`🔒 Isolation:` lines on the `🔄 Starting...` message (backward compatible: with
no `sessionName` it renders exactly as before).

`src/telegram-command-execution.lib.mjs` — `buildExecuteAndUpdateMessage()` now,
for isolation backends:

1. generates the UUID (unchanged),
2. **immediately** builds `sessionInfo`, calls `trackSession()`, and edits the
   message to the session-aware `Starting...` form — _before_ the launch, so the
   run is addressable by `/watch`/`/log`/`/status` for the whole startup window,
3. awaits `executeWithIsolation` (start-command runs the container detached, so
   this does not block other bot commands), and
4. on launch failure calls the new `untrackSession()` and clears `sessionInfo`
   so a phantom session is never monitored or resumed.

`src/session-monitor.lib.mjs` — new exported `untrackSession(sessionName)` drops
an optimistically-tracked session from both the in-memory map and the durable
store without emitting a `session_completed` audit event (the session never ran,
so it has no exit code). Wired into `src/telegram-bot.mjs`'s dependency object.

Because the fix lives in the single shared `buildExecuteAndUpdateMessage`, every
caller — `/solve`, `/hive`, and `/task` (which all route through it) — inherits
it (R6).

### Diagnostics for the image-prep / passthrough gaps (R8)

The existing verbose diagnostics from #1939 are retained:
`preflightDockerIsolation` warns when the dind image is absent and the host
socket is not mounted, and `logDockerIsolationPostLaunchDiagnostics` logs
`$ --status`, container-running state and image-presence right after launch — so
the next iteration can confirm R3/R4 from data.

## Upstream Follow-ups (R9)

Both upstream issues were filed, fixed, and released — this PR pins the fixed
versions in `Dockerfile` / `Dockerfile.dind`:

- **link-foundation/start [#138](https://github.com/link-foundation/start/issues/138)**
  (✅ **fixed** in [start PR #139](https://github.com/link-foundation/start/pull/139),
  released as **`start-command@0.29.2`**) — the detached docker session log must
  capture the image-preparation phase (`docker pull` / dind boot) from the first
  byte so the `$` "one complete log" guarantee holds (problems 2/3/5). Reproducer:
  the 546-byte `$ --upload-log` at the 7-minute mark; workaround: read the host
  `docker logs <session>` separately; fix: tee the pull/prepare stage into the
  session log before attaching the container command stream. **Hive Mind now pins
  `start-command@0.29.2`** (was `0.29.1`).
- **link-foundation/box [#106](https://github.com/link-foundation/box/issues/106)**
  (✅ **fixed** in [box PR #107](https://github.com/link-foundation/box/pull/107),
  released as **`konard/box-dind:2.3.4`**) — the nested DinD daemon re-downloads
  `konard/hive-mind-dind:2.0.6` (~30 GB) despite host passthrough (problem 4),
  continuing #94/#102. Reproducer: `df -h` before/after shows ~30 GB consumed and
  the run takes ~1 hour; workaround: mount
  `-v /var/run/docker.sock:/var/run/host-docker.sock:ro` and set
  `DIND_HOST_PASSTHROUGH_IMAGES`; fix: the dind entrypoint now verifies (via
  `docker image inspect` against the nested daemon) that each concrete passthrough
  allowlist entry was actually seeded and reports
  `image preload/passthrough finished WITH WARNINGS` instead of a misleading
  `complete` when it was not, so a misconfigured deploy can no longer silently
  trigger the re-download. **`Dockerfile.dind` now bases on `konard/box-dind:2.3.5`**
  (was `2.3.2`).

See [`upstream/`](./upstream) for the exact issue bodies filed (those reflect the
state at filing time, when both still reproduced on `start-command 0.29.1`).

## Alternatives Considered

- **Fire-and-forget the launch (don't await it at all).** Rejected: we still need
  the launch result to detect a failed start and untrack the phantom session and
  show the error. Awaiting is fine — the session is already visible/tracked and
  Telegraf dispatches other updates concurrently.
- **Only fix the message text, not the tracking.** Rejected: showing the UUID
  without tracking the session would still leave `/watch`/`/log`/`/status`
  unable to find it during startup. Both are needed.
- **Pull the image from the Hive Mind side / pass `--pull`.** Rejected: the
  re-download is a passthrough/deployment gap (#1879 established that
  `docker run` reuses a present image); the right fix is box passthrough, not a
  pull flag.
- **Write the image-prep log on the Hive Mind side.** Rejected: start-command
  owns the session log file; duplicating that in the consumer would diverge from
  the `$` "single source of truth" design. Reported upstream instead.

## Regression Coverage

`tests/test-issue-1946-docker-isolation-async.mjs` (`@hive-mind-test-suite
default`):

- `formatStartingWorkSessionMessage` omits the session block with no session,
  renders `Session:` + `🔒 Isolation:` when both are known, and renders the
  session alone when no backend is given.
- `buildExecuteAndUpdateMessage`: the session is **tracked and shown before** the
  (deferred) launch resolves; a successful launch keeps it tracked and advances
  to executing; a failed launch **untracks** the optimistic session and surfaces
  the error.

`tests/test-issue-1860-docker-isolation.mjs` (33 assertions) updated for the new
deps and continues to pass, confirming the #1860 native-docker guarantees hold.
