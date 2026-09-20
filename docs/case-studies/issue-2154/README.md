# Issue 2154: three Formal AI tasks refused, and a log that said nothing

## Executive summary

On 2026-08-12 the maintainer sent three Telegram commands — `/codex`, `/claude`, `/agent`, each with `—model formal-ai` — and all three failed with the same message. One defect caused the failures; six more defects made the incident nearly impossible to investigate.

The failure itself has a single cause: **`ghcr.io/link-assistant/formal-ai` is a private package**. Hive Mind never authenticates to a registry, so the sidecar's implicit `docker run` pull was refused with `unauthorized`. The image was published by the upstream release pipeline with the workflow `GITHUB_TOKEN`, which makes a new GHCR package private by default, and nothing in that pipeline ever set or verified its visibility. This was confirmed without credentials against GHCR's anonymous token endpoint (401 `UNAUTHORIZED` for `link-assistant/formal-ai`, 403 `DENIED` for a package that does not exist, 200 + token for two known-public controls) and reported upstream as [link-assistant/formal-ai#1001](https://github.com/link-assistant/formal-ai/issues/1001).

The investigation defects are the more interesting part of this study, because the issue is mostly about them — _"in logs of telegram bot there nothing about it"_, _"no way to see UUIDs of each task's log"_, _"these tasks are not in list"_:

1. Every layer that refused the launch returned `{ success: false }` to its caller and wrote nothing to stderr. A 13,467-line bot log contains **zero** lines explaining why three tasks did not start.
2. The Telegram failure reply overwrote the "🔄 Starting…" message that carried the session UUID, so the operator lost the only handle on the attempt.
3. `SolveQueue` marked each refused launch as `Finished: […] (started)` and counted it in `totalCompleted` — a false positive that made the log claim three sessions had started while `$ --list` showed none.
4. The auto-updater logged the _same bland warning_ about the same unauthorized pull **151 times over 12.5 hours** and never escalated it, so the one signal that did exist read as background noise.
5. The durable structured log recorded `session_untracked {"sessionName":…}` with no reason, so even the timestamped stream could not explain a session that vanished one second after it was announced.
6. Independently of the failures: the UUID `$ --list` prints is start-command's **execution** UUID, while Telegram, the logs and the snapshot only ever showed Hive Mind's **session** UUID. The launch banner contains both, one line apart, and Hive Mind discarded it — so even the two perfectly healthy tasks of that day could not be matched to the two rows the maintainer saw in `--list`.

All seven are fixed in this PR, each with a regression test that fails against the pre-fix tree. The registry root cause is fixed defensively on the Hive Mind side (preflight, classification, local-image fallback) and reported upstream where the actual fix belongs.

## Scope and evidence

This study combines:

- [Hive Mind issue #2154](https://github.com/link-assistant/hive-mind/issues/2154) and its comments;
- the complete Telegram bot log attached to the issue — 13,467 lines, 1,039,805 bytes, `2026-08-12T17:16:20.882Z` → `2026-08-13T05:46:07.110Z`;
- every conversation comment, review comment and review on [PR #2155](https://github.com/link-assistant/hive-mind/pull/2155), [#2147](https://github.com/link-assistant/hive-mind/pull/2147), [#2131](https://github.com/link-assistant/hive-mind/pull/2131), [#2120](https://github.com/link-assistant/hive-mind/pull/2120) and [#2108](https://github.com/link-assistant/hive-mind/pull/2108), fetched from all three GitHub comment endpoints separately;
- issues [#2146](https://github.com/link-assistant/hive-mind/issues/2146), [#2130](https://github.com/link-assistant/hive-mind/issues/2130), [#2119](https://github.com/link-assistant/hive-mind/issues/2119) and [#2059](https://github.com/link-assistant/hive-mind/issues/2059) with their comments, because #2154 asks to re-check every requirement they carried;
- credential-free live probes of GHCR's anonymous token endpoint and of Docker Hub, re-run on 2026-08-13;
- `.github/workflows/release.yml` from `link-assistant/formal-ai`, the pipeline that publishes the image;
- GitHub's own documentation on package visibility and access, and the community discussion asking for an API to change it.

The complete inventory with SHA-256 checksums is in [MANIFEST.md](./MANIFEST.md). No screenshot or image appears in the issue, its comments, or any of the linked PR discussions, so there was no image artifact to download or inspect.

Two properties of the log matter for every quotation below. It mixes **timestamped structured-logger lines** (`<ISO> INFO  EVENT …`, `<ISO> DEBUG …`) with **untimestamped console lines** (`[VERBOSE] …`, `🧠 …`, `⚠️ …`), because `setupVerboseLogInterceptor()` in [`src/lib.mjs`](../../../src/lib.mjs) appends console output verbatim. Where this study puts a timestamp next to a `[VERBOSE]` line, that timestamp comes from the nearest preceding structured line and is stated as such — it is never part of the quoted text.

## Requirements reconstructed

### From issue #2154

| #   | Requirement (as written)                                                                            | Status                                                                                                                                                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | The three `—model formal-ai` invocations must not fail with `docker run … unauthorized`             | Root cause found (RC-A), reported upstream, and mitigated on the Hive Mind side by image preflight + local fallback (RC-C)                                                                                                                   |
| R2  | _"Yet in logs of telegram bot there nothing about it"_ — the failure must appear in the bot log     | Fixed (RC-D): every refusing layer now logs the UUID, backend, tool and reason to stderr                                                                                                                                                     |
| R3  | _"And no way to see UUIDs of each task's log"_ — the UUID must survive the failure                  | Fixed twice: (RC-E) `formatFailedLaunchMessage` keeps the UUID and the isolation backend in the failure reply, and (RC-J) the reply now also shows the _execution_ UUID that `$ --list` prints                                               |
| R4  | _"And these tasks are not in list"_                                                                 | Explained and made honest (RC-F/RC-H): a refused launch never had a session, so the reply now says so, and the queue stops calling it started. RC-J closes the other half — for launches that _do_ start, bot and `--list` can now be joined |
| R5  | Find root causes of **all** errors, warnings, false positives and false negatives, and fix them all | Ten root causes RC-A…RC-J below; seven are code defects fixed here, one is upstream, two are documented behaviours                                                                                                                           |
| R6  | Re-check requirements from #2146, #2119, #2130, #2059, latest conversation overriding earlier ones  | Audited below; the one live gap found (`--list` visibility of refused launches) is closed by R4                                                                                                                                              |
| R7  | Download all logs/data into `./docs/case-studies/issue-2154` and do a deep case study               | This document plus [`data/`](./data/) and [MANIFEST.md](./MANIFEST.md)                                                                                                                                                                       |
| R8  | Search online for additional facts                                                                  | GHCR/Docker registry semantics, GitHub package-visibility docs and the open community request for an API — see _Upstream research_                                                                                                           |
| R9  | If data is insufficient, add debug output and verbose mode for the next iteration                   | The new stderr lines and the `reason` field on `session_untracked` exist precisely so a repeat is diagnosable from the log alone                                                                                                             |
| R10 | Report issues to other repositories with reproduction, workaround and code-level fix suggestion     | [formal-ai#1001](https://github.com/link-assistant/formal-ai/issues/1001)                                                                                                                                                                    |
| R11 | Apply each fix to the **entire** codebase, not one call site                                        | The sidecar gate, the isolation runner, the Telegram handler, the queue, the updater and the session store were all changed                                                                                                                  |
| R12 | Everything in the single PR #2155                                                                   | Every change on branch `issue-2154-f85658eb4c08`; no other branch touched                                                                                                                                                                    |

### Carried forward from earlier issues

| Requirement                                                                        | Source | Verified state today                                                                                                                   |
| ---------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `--tool agent --model formal-ai` must dispatch, and the same for every other tool  | #2059  | Holds; the Aug 12 log shows `/claude`, `/codex` and `/agent` all reaching the sidecar gate with the same model                         |
| Provider must be reported as `Link.Assistant` at cost $0                           | #2119  | Unchanged by this PR                                                                                                                   |
| One auto-restart system, `N/M` display, capped at 5, then fail with auto-commit    | #2119  | Unchanged; not reached in this incident (no task ever started)                                                                         |
| _"Solve by generalization, not specialization"_                                    | #2119  | Followed: image resolution, error classification and untrack-reason recording are generic, not Formal-AI-specific special cases        |
| Collect logs from **all** restarts/resumes; fix all false positives                | #2130  | The queue false positive (RC-H) is exactly this class of defect and is fixed                                                           |
| Report Formal-AI-side blockers upstream                                            | #2130  | [formal-ai#1001](https://github.com/link-assistant/formal-ai/issues/1001)                                                              |
| The driving model must be Formal AI only — never a silent downgrade                | #2146  | Preserved. With no usable image the task is **refused**, never run on another model; this is why the incident is a hard failure        |
| On-demand sidecar, internal network, durable memory volume, idle-only image update | #2146  | All present in the Aug 12 log (`created internal network 'hive-mind-formal-ai'`, `created memory volume 'hive-mind-formal-ai-memory'`) |
| Pin only a bootstrap Formal AI version and adopt newer digests while idle          | #2146  | Present, and this is the code path that generated the 151 repeated warnings — now escalating (RC-G)                                    |

## Timeline (UTC, 2026-08-12 unless noted)

| Time                  | Event                                                                                                                                                                                                                                                                                          | Evidence (line in `data/logs/hive-telegram-bot.log.txt.gz`)               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 17:16:20.882          | `EVENT bot_starting {"pid":995,…}`                                                                                                                                                                                                                                                             | line 13                                                                   |
| 17:16:21.041          | `EVENT bot_launched`                                                                                                                                                                                                                                                                           | line 51                                                                   |
| (17:16:21)            | First `⚠️ Could not pull ghcr.io/link-assistant/formal-ai:latest … unauthorized` from the idle updater — 6 minutes before the first task                                                                                                                                                       | line 78                                                                   |
| 17:23:21.362          | `/agent` runs unqueued: session `4750eeff-cb3e-470a-a7b6-3a999a804a47` persisted and tracked                                                                                                                                                                                                   | lines 337–339                                                             |
| (17:23:21)            | `[VERBOSE] isolation-runner: Backend: docker, Session ID: 4750eeff-…`                                                                                                                                                                                                                          | line 342                                                                  |
| (17:23:21)            | `created internal network 'hive-mind-formal-ai'`, `created memory volume 'hive-mind-formal-ai-memory'`                                                                                                                                                                                         | lines 343–344                                                             |
| (17:23:21)            | `🧠 Starting the Formal AI sidecar (ghcr.io/link-assistant/formal-ai:0.339.1) on the internal network 'hive-mind-formal-ai'`                                                                                                                                                                   | line 345                                                                  |
| (17:23:22)            | `[VERBOSE] Session 4750eeff-… untracked (launch failed before it started)` — **the only trace of the failure in the whole log**                                                                                                                                                                | line 346                                                                  |
| 17:23:22.330          | `DEBUG Removed session 4750eeff-… {"status":"launch-failed","exitCode":null}`                                                                                                                                                                                                                  | line 347                                                                  |
| 17:23:22.330          | `EVENT session_untracked {"sessionName":"4750eeff-…"}` — no reason recorded                                                                                                                                                                                                                    | line 348                                                                  |
| 17:23:41.436          | `/queue: Enqueued: [solve-1786555421436-1v5asg0] … to claude queue` (the item id is `Date.now()`, so these three times are exact)                                                                                                                                                              | line 506                                                                  |
| 17:23:53.400          | `/queue: Enqueued: [solve-1786555433400-f88k08z] … to agent queue`                                                                                                                                                                                                                             | line 696                                                                  |
| 17:24:10.234          | `/queue: Enqueued: [solve-1786555450234-255gv05] … to codex queue`                                                                                                                                                                                                                             | line 724                                                                  |
| (17:28:21)            | Claude item dequeued; session `9cc0eb9c-9ff8-4a96-b1b8-3155251832c1`; sidecar start announced                                                                                                                                                                                                  | lines 1160, 1162, 1211                                                    |
| (17:28:21)            | `/queue: Finished: [solve-1786555421436-1v5asg0] … (started)` — **false positive**, no error line in between                                                                                                                                                                                   | line 1246                                                                 |
| 17:29:21.189          | `EVENT heartbeat {…,"activeSessions":0,…}` followed by `[VERBOSE] Retrieved 0 active session(s)`                                                                                                                                                                                               | lines 1249–1250                                                           |
| (17:33:21)            | Agent item: session `f636bced-bf55-447c-9e68-0333ee89332b`, sidecar start, then `Finished: … (started)`                                                                                                                                                                                        | lines 1627, 1668, 1699                                                    |
| (17:38:21)            | Codex item: session `dad2b1ea-4d1e-4ba3-bb31-f6fe5fa5fc89`, sidecar start, then `Finished: … (started)`                                                                                                                                                                                        | lines 2242, 2243, 2244                                                    |
| 17:16 → 05:46         | The identical `⚠️ Could not pull …` warning is emitted **151 times**, roughly every 5 minutes, with no escalation                                                                                                                                                                              | lines 78, 298, 924, …, 13194, 13464                                       |
| 22:36:04.615          | An unrelated healthy session `0a3627ef-…` starts (`https://github.com/uselessgoddess/molt/pull/71`) and completes with `exitCode: 0` at 02:24:33.269 on Aug 13 — proof the machinery works when the image is pullable                                                                          | lines 4026–4028, 12101–12102                                              |
| 05:44:25.579 (Aug 13) | Session `3fe2d63d-…` starts (`https://github.com/link-assistant/router/issues/128`). The two entries the maintainer saw in `--list` (`d5b8f0af-…` executing, `edc7b051-…` executed) are **these** two sessions — under start-command's own execution UUIDs, which the bot never printed (RC-J) | lines 13367–13369                                                         |
| 06:56:50 (Aug 13)     | The registry root cause is reported upstream                                                                                                                                                                                                                                                   | [formal-ai#1001](https://github.com/link-assistant/formal-ai/issues/1001) |

The shape of the incident is visible in that table without reading a single line of code: three sessions are announced, three sidecars are announced, three queue items report "started", and the very next heartbeat says `activeSessions: 0`.

## Root cause A: the Formal AI image is private

`docker` reports a private image and a misspelled image with the same word:

```text
Unable to find image 'ghcr.io/link-assistant/formal-ai:0.339.1' locally
docker: Error response from daemon: error from registry: unauthorized
```

GHCR's anonymous token endpoint disambiguates the two. [`experiments/issue-2154-ghcr-visibility-probe.mjs`](../../../experiments/issue-2154-ghcr-visibility-probe.mjs) asks for a pull-scoped token without credentials; the results (re-run 2026-08-13, stored in [`data/registry-probes/`](./data/registry-probes/)) are unambiguous:

| Scope                                     | HTTP | Body                                    | Meaning                           |
| ----------------------------------------- | ---- | --------------------------------------- | --------------------------------- |
| `link-assistant/formal-ai`                | 401  | `UNAUTHORIZED: authentication required` | exists, **private**               |
| `link-assistant/agent`                    | 403  | `DENIED`                                | absent or invisible anonymously   |
| `link-assistant/hive-mind-does-not-exist` | 403  | `DENIED`                                | control: certainly does not exist |
| `homebrew/core/hello`                     | 200  | token issued                            | control: known public             |
| `actions/actions-runner`                  | 200  | token issued                            | control: known public             |

401 for a package that certainly exists, next to 403 for one that certainly does not, is the proof: the package is published and private.

The upstream cause is in [`data/upstream/formal-ai-release.yml`](./data/upstream/formal-ai-release.yml) — the release workflow logs in to GHCR with `secrets.GITHUB_TOKEN` and pushes, and never sets or verifies package visibility afterwards. A GHCR package created by a workflow token is **private by default**, and a container package inherits the repository's _access permissions_ but **not** its visibility. There is also no public mirror to fall back on: `DOCKERHUB_IMAGE` is unset for that repository, so `scripts/configure-dockerhub-publishing.sh` disables the Docker Hub steps silently, and both `hub.docker.com/v2/repositories/konard/formal-ai/` and `.../linksplatform/formal-ai/` return HTTP 404.

This belongs upstream and was reported there with the credential-free reproduction, the workaround, and a concrete CI change: [formal-ai#1001](https://github.com/link-assistant/formal-ai/issues/1001).

## Root cause B: Hive Mind never authenticates to any registry

Nothing in Hive Mind runs `docker login`, and the bot's GitHub token is not required to carry `read:packages`. Even after the upstream package is made public this stays true, so any future private dependency reproduces the same failure. This is a deliberate design point rather than a bug — Hive Mind is meant to run on a host with no registry credentials — but it makes the fallback path (RC-C) load-bearing rather than optional.

## Root cause C: the image reference was never resolved before use

The sidecar passed `ghcr.io/link-assistant/formal-ai:0.339.1` straight to `docker run` and relied on the implicit pull. When that pull failed, the error the operator saw was the daemon's raw output preceded by the entire `docker run` argv — the message quoted in the issue.

**Fixed** in [`src/formal-ai-image.lib.mjs`](../../../src/formal-ai-image.lib.mjs) (commit `33137125`). Image resolution now happens _before_ anything shells out with the reference:

- each candidate is preflighted with `docker image inspect`, then an explicit `docker pull`;
- registry failures are classified — `unauthorized` / `denied` / `not-found` / `disk-full` / `network` — and each classification carries its own remediation list instead of echoing the daemon;
- the fallback is the local Hive Mind isolation image, which bakes `/usr/local/bin/formal-ai` at the same pinned version via `cargo install formal-ai --version … --locked` and is already present on any host that runs isolated tasks;
- `HIVE_MIND_FORMAL_AI_IMAGE` remains an exact pin — an operator-specified image is never silently substituted;
- the version floor is enforced against the version `/health` reports, so a stale fallback image cannot serve an unsupported `formal-ai`;
- #2146's fail-closed rule is untouched: with no usable image the task is refused, never downgraded to another model.

## Root cause D: every refusing layer was silent

This is the defect the issue leads with. The sidecar gate, the isolation runner and the Telegram command handler each returned `{ success: false }` upward and wrote nothing to stderr. The single line the incident produced anywhere in 13,467 lines was:

```text
[VERBOSE] Session 4750eeff-cb3e-470a-a7b6-3a999a804a47 untracked (launch failed before it started)
```

which does not say _why_, and for the three queued tasks not even that appeared — the queue path emitted `Starting:` and `Finished: … (started)` with nothing in between.

[`experiments/issue-2154-launch-failure-silence.mjs`](../../../experiments/issue-2154-launch-failure-silence.mjs) reproduces this directly: against the pre-fix tree it prints **0** stderr lines for a refused launch; against the fixed tree it prints one line per refusing layer.

**Fixed** in commit `4496aa27`. Each layer now names the session UUID, the backend, the tool and the reason. In [`src/telegram-command-execution.lib.mjs`](../../../src/telegram-command-execution.lib.mjs):

```js
const launchError = result.error || result.output || 'unknown error';
console.error(`[telegram-bot] ${commandName} session ${session} was not launched (isolation=${iso.backend}, tool=${tool}): ${launchError}`);
```

## Root cause E: the failure reply dropped the session UUID

Issue #1946 had moved UUID generation _before_ the container launch precisely so the "🔄 Starting…" message could carry it during the startup window. The failure path then edited that same message into an error, destroying the only handle the operator had — hence _"no way to see UUIDs of each task's log"_.

**Fixed**: `formatFailedLaunchMessage` in [`src/work-session-formatting.lib.mjs`](../../../src/work-session-formatting.lib.mjs) keeps `📊 Session: <uuid>` and `🔒 Isolation: <backend>`, fences the error body, and appends the sentence that answers R4 directly — _"The work session was not launched, so it has no log and is not listed by `--list`."_ — localised in `en`, `ru`, `zh` and `hi`.

## Root cause F: "not in list" was correct but unexplained

`$ --list` shows live executions. A launch that never produced a container legitimately has no entry, so the maintainer's observation was not a bug in `--list` — it was the absence of any statement that this is expected. The failure reply now says it in words (RC-E), and the durable event log now records the refusal with its reason (RC-I), so the two views agree.

## Root cause G: the auto-updater cried wolf 151 times

The idle updater polls for a newer sidecar image. Every poll for 12.5 hours hit the same permanent refusal and logged the same sentence:

```text
⚠️ Could not pull ghcr.io/link-assistant/formal-ai:latest; keeping the current Formal AI image: Error response from daemon: error from registry: unauthorized
```

151 occurrences, at lines 78, 298, 924 … 13194, 13464. The message never said the registry was _permanently_ refusing us, never suggested a fix, and never changed tone, so it read as background noise — the operator learned about the problem only when three tasks failed to start.

**Fixed** in [`src/formal-ai-updater.lib.mjs`](../../../src/formal-ai-updater.lib.mjs) (commit `279f8560`). The failure is classified with `classifyDockerRegistryError`; `unauthorized`, `denied` and `not-found` are configuration faults, so the warning is escalated to 🚨, names the classification, and lists the remediation. Transient failures (network, daemon) keep the old ⚠️ tone. The returned result carries `classification`, `permanent` and `remediation`, so a caller can act on it rather than parse a string.

## Root cause H: the queue reported refused launches as started

`SolveQueue.executeItem` called `setStarted()` unconditionally. A refused launch was therefore counted in `stats.totalCompleted`, pushed onto `completed`, and logged as:

```text
[VERBOSE] /queue: Finished: [solve-1786555421436-1v5asg0] https://…/issues/1 (started)
```

This is the false positive that made the log actively misleading: three "started" claims, and `activeSessions: 0` in the next heartbeat.

**Fixed** in [`src/telegram-solve-queue.lib.mjs`](../../../src/telegram-solve-queue.lib.mjs): a refused launch becomes a FAILED item with its error attached. Covered by `tests/test-issue-2154-queue-launch-failure.mjs` (5 tests, verified to fail against the pre-fix logic).

## Root cause I: the structured log did not record why a session disappeared

The timestamped stream is the only part of the log that can be correlated with anything else, and it said:

```text
2026-08-12T17:23:22.330Z INFO  EVENT session_untracked {"sessionName":"4750eeff-cb3e-470a-a7b6-3a999a804a47"}
```

The reason lived exclusively on the untimestamped `[VERBOSE]` line above it. If the console stream had been lost — or simply interleaved differently — the incident would have been unreconstructable from the durable log.

**Fixed** in commit `7a46a3ae`: `untrackSession(sessionName, verbose, { reason })` in [`src/session-monitor.lib.mjs`](../../../src/session-monitor.lib.mjs) records the reason on the `session_untracked` event, and [`src/session-store.lib.mjs`](../../../src/session-store.lib.mjs) carries it into the append-only `complete` event in `sessions-events.jsonl`. A blank reason normalises to `null` rather than an empty string, so consumers can distinguish "not provided" from "provided and empty".

## Root cause J: the bot's UUID and the UUID `--list` prints are different numbers

RC-E and RC-F answer _"no way to see UUIDs of each task's log"_ for the three refused tasks. Reading the log for the two **healthy** sessions showed that the complaint has a second, independent half that survives even when everything works.

Every isolated task carries two UUIDs:

| UUID               | Minted by                                                                 | Where it appears                                                                       |
| ------------------ | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **session** UUID   | Hive Mind (`iso.runner.generateSessionId()`, before launch — issue #1946) | The Telegram reply, `logEvent` records, `sessions.json`, and the Docker container name |
| **execution** UUID | start-command itself, at launch time                                      | The launch banner it prints, and **the only identifier `$ --list` displays**           |

The log contains both, one under the other, and they never match:

```text
│ session   edc7b051-e12f-4f7b-b677-c885f3208407    ← start-command's execution UUID
│ container 0a3627ef-f1f1-4801-a073-3678b9453db7    ← Hive Mind's session UUID
```

So for the two healthy tasks the mapping was `0a3627ef-… → edc7b051-…` and `3fe2d63d-… → d5b8f0af-…`. Hive Mind captured `result.output` from the runner, used it for nothing, and discarded it. The consequence is exactly the maintainer's third complaint, and it is _not_ limited to failures: given a session UUID from Telegram there was no way to find that task in `--list`, and given a row in `--list` there was no way to learn which Telegram request it came from. The bot's own log never contained the pair, so no amount of post-hoc analysis could recover it either — the correlation was only reconstructable by eye, from the raw banner, and only while the log survived.

**Fixed**: [`src/isolation-runner.lib.mjs`](../../../src/isolation-runner.lib.mjs) gains `parseStartCommandExecutionUuid(output)`, which reads the execution UUID out of the launch banner (box-drawn `│ session <uuid>`, plain-ASCII and prefix-less variants) or out of JSON output, and validates it against the UUID grammar so a truncated or reworded banner yields `null` instead of a bogus id. `executeWithIsolation` returns it as `executionUuid` and, under `--verbose`, states either the correlation or its absence. From there the pair is propagated everywhere the session is known:

- [`src/telegram-command-execution.lib.mjs`](../../../src/telegram-command-execution.lib.mjs) stores it on the tracked session and re-tracks so the live registry has it;
- [`src/work-session-formatting.lib.mjs`](../../../src/work-session-formatting.lib.mjs) adds `🆔 Execution: <uuid>` to both the "⏳ Executing…" reply and the final completion reply — the latter being the handle an operator uses to fetch the log after the fact (omitted entirely when unknown, so a start-command that prints no banner degrades quietly), with the label localised in `en`, `ru`, `zh` and `hi`;
- [`src/session-monitor.lib.mjs`](../../../src/session-monitor.lib.mjs) puts it on the `session_tracked` event, so the timestamped stream carries the join key;
- [`src/session-store.lib.mjs`](../../../src/session-store.lib.mjs) persists it, so a bot restart does not lose the correlation.

The banner is not the only source. `$ --status <session>` returns the same identifier in its `uuid` field — the captured log shows `"uuid": "edc7b051-…"` in every status query for session `0a3627ef-…` (first at line 4065), and `parseSessionStatusOutput` was already reading it and throwing it away. So [`src/session-monitor.lib.mjs`](../../../src/session-monitor.lib.mjs) also **backfills** `executionUuid` from the status record on the next poll, right beside the existing `logPath` backfill from #1927. That covers the two cases the banner cannot: a session resumed from a snapshot written before this fix, and a start-command whose banner we fail to parse.

Covered by `tests/test-issue-2154-execution-uuid.mjs` (12 tests), whose banner fixture is copied verbatim from lines 4039–4045 of the captured log.

## Upstream research: what the ecosystem already solves

The issue asks explicitly to check existing components and libraries before inventing anything. What was found, and what was used:

- **GHCR anonymous token semantics.** The 200/401/403 distinction used throughout this study is the registry's own OAuth2 token endpoint behaviour (`GET /token?service=ghcr.io&scope=repository:<pkg>:pull`), not a heuristic. It requires no credentials and no extra dependency, which is why the probe is 60 lines of `fetch` rather than a library.
- **`skopeo inspect` / `crane manifest` / `oras`.** All three distinguish private from missing images and would have produced the same verdict. They were not adopted because they are external binaries that the Hive Mind host is not guaranteed to have, while `docker` is by definition present when the Docker isolation backend is in use.
- **Package-visibility automation.** GitHub's REST API can _read_ package metadata (`GET /orgs/{org}/packages/container/{name}`, requires `read:packages`) and can delete or restore packages, but **cannot set visibility** — that is UI-only, and the open community request for an API endpoint has no GitHub staff answer. The upstream report therefore asks for a documented manual step plus an automated _verification_ step in CI, rather than claiming an automation that does not exist.
- **`docker/login-action` + a `read:packages` PAT** is the standard workaround for consuming private GHCR images from automation. It was rejected for Hive Mind because it would require every operator to provision and rotate a registry credential for what should be a public image; the local-image fallback (RC-C) achieves availability with no new secret.
- **Structured logging.** `pino`/`winston`/OpenTelemetry all solve the "log an event with fields, not a sentence" problem that RC-I is an instance of. Hive Mind already has `src/bot-logger.lib.mjs` with the same shape (`formatLogLine(level, message, meta, date)` and `logEvent(type, data)`), so the fix was to _use_ the existing structured channel for the reason rather than add a dependency. The deeper lesson — that `console.log` output reaching the log file through `setupVerboseLogInterceptor()` is untimestamped and uncorrelatable — is why the reason had to move into `logEvent`.
- **Queue semantics.** `bullmq`/`p-queue` model "attempted but failed to start" as a first-class state. `SolveQueue` already had a FAILED state; RC-H was not a missing capability but a call site that never used it.

## Implementation map

| Root cause | Change                                                                                                                                                                                                        | Commit     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| A          | Reported upstream with reproduction, workaround and suggested CI change                                                                                                                                       | —          |
| B, C       | `src/formal-ai-image.lib.mjs`, `src/hive-mind-image.lib.mjs`, `src/formal-ai-isolation.lib.mjs`                                                                                                               | `33137125` |
| D          | `src/formal-ai-isolation.lib.mjs`, `src/isolation-runner.lib.mjs`, `src/telegram-command-execution.lib.mjs`                                                                                                   | `4496aa27` |
| E, F       | `src/work-session-formatting.lib.mjs`, `src/locales/{en,ru,zh,hi}.lino`                                                                                                                                       | `4496aa27` |
| G          | `src/formal-ai-updater.lib.mjs`                                                                                                                                                                               | `279f8560` |
| H          | `src/telegram-solve-queue.lib.mjs`                                                                                                                                                                            | `4496aa27` |
| I          | `src/session-monitor.lib.mjs`, `src/session-store.lib.mjs`, `src/telegram-command-execution.lib.mjs`                                                                                                          | `7a46a3ae` |
| J          | `src/isolation-runner.lib.mjs`, `src/telegram-command-execution.lib.mjs`, `src/work-session-formatting.lib.mjs`, `src/session-monitor.lib.mjs`, `src/session-store.lib.mjs`, `src/locales/{en,ru,zh,hi}.lino` | this PR    |

## Reproduction and verification

Every fix has a test that fails against the pre-fix tree:

| Test file                                              | Covers  | Pre-fix result                                                  |
| ------------------------------------------------------ | ------- | --------------------------------------------------------------- |
| `tests/test-issue-2154-formal-ai-image-resolution.mjs` | C       | reproduces `Unable to find image … locally` verbatim            |
| `tests/test-issue-2154-launch-failure-visibility.mjs`  | D, E, F | 7 tests fail                                                    |
| `tests/test-issue-2154-queue-launch-failure.mjs`       | H       | 5 tests fail                                                    |
| `tests/test-issue-2154-structured-log-reason.mjs`      | I       | 4 tests fail                                                    |
| `tests/test-issue-2154-execution-uuid.mjs`             | J       | 12 tests fail (`parseStartCommandExecutionUuid` does not exist) |

Reusable experiments:

```bash
# 0 stderr lines before the fix, one line per refusing layer after it
node experiments/issue-2154-launch-failure-silence.mjs

# credential-free proof that the package exists and is private
node experiments/issue-2154-ghcr-visibility-probe.mjs
```

Full suite: `node scripts/run-tests.mjs --suite default` — all 389 selected test files pass.

## Remaining limits

- **The upstream fix is not ours to make.** Until `ghcr.io/link-assistant/formal-ai` is made public (or a public mirror exists), a host without registry credentials relies on the local-image fallback from RC-C. That fallback is a genuine fix for availability, not a workaround that hides the problem: the escalated 🚨 warning from RC-G keeps saying that the registry is refusing us.
- **This log cannot prove what the container would have done.** No Formal AI process ever started on Aug 12, so nothing here speaks to the #2119/#2130 question of whether Formal AI can solve a hello-world task. That remains open on its own issues.
- **Two `[VERBOSE]` streams still merge untimestamped console output into the log file.** RC-I moves the one field this incident needed into the structured channel; a general migration of console diagnostics to `logEvent` is a larger change than this issue justifies, and is noted here as the next reduction.
