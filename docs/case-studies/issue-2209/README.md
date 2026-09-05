# Issue 2209: the release Hive Mind verified, and the release it actually talked to

## Executive summary

Hive Mind kept a Formal AI sidecar up to date and then threw the result away. The
idle updater pulled a new image, ran the memory preflight, migrated, booted the
candidate, read its `/health`, accepted it and wrote the accepted identity into
`formal-ai-sidecar.json` — and the very next task started the **bootstrap** image
again, because `acquireFormalAiSidecar` re-derived its image from the environment
and never looked at the accepted state it had just read (issue
[#2207](https://github.com/link-assistant/hive-mind/issues/2207)).

Nothing in the logs said so. Every Formal AI task printed one version line, and
that line came from `formal-ai --version` on the local wrapper next to Hive Mind —
a different binary from the one serving the requests, and one that says nothing
about the sidecar at the other end of `HIVE_MIND_FORMAL_AI_BASE_URL` (issue
[#2208](https://github.com/link-assistant/hive-mind/issues/2208)).

The two defects hid each other. #2207 silently downgraded the backend; #2208
guaranteed that the downgrade was invisible, and worse, that the version printed
in the evidence was neither the accepted release _nor_ the serving one. The three
production tasks quoted in #2207 all logged `Formal AI: version 0.339.1` while
nobody could say which release answered them.

This case study records both root causes, the fix for each, and the evidence
required by #2209: simulated regressions, a real-Docker run against the real
published images, and a replay of the three referenced tasks through their real
clients.

The replay did **not** produce a working pull request, and this case study does
not claim it did. With provenance now honest we can finally say _what_ failed: the
accepted release **0.347.0** is demonstrably the process that served all three
tasks, and it left all three clones untouched — once by returning
`planned_not_executed`, once by calling a tool with an empty argument 1 188 times,
and once by reporting work it had not done. That is the Formal AI executor defect
tracked upstream as [formal-ai#1075](https://github.com/link-assistant/formal-ai/issues/1075),
which #2209 designates as related context rather than something to fix here.
See [Remaining blocker](#remaining-blocker-formal-ai1075).

## Scope and evidence

Everything quoted here is committed under [`data/`](data/) and listed with
checksums in [`MANIFEST.md`](MANIFEST.md), so the analysis can be re-checked
without network access.

| Directory        | What it holds                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| `data/github/`   | Issues #2207, #2208, #2209 and PR #2210 with all three comment channels, captured with `--paginate`.           |
| `data/logs/`     | The reproductions and the real-image evidence, each before and after the fix, plus the regression suites.      |
| `data/registry/` | GHCR manifest digests for the tags used, fetched directly from the registry API.                               |
| `data/replay/`   | The real-client replay: the remote state before, the driver and client logs, and the machine-readable summary. |

## Requirements reconstructed

### From issue #2207

1. A cold task must consume the last accepted, verified image identity; bootstrap
   is the pin only when no accepted state exists.
2. Explicit operator pins stay authoritative.
3. Prefer the accepted **immutable digest**, so a moving tag cannot bypass the
   memory verification that acceptance performed.
4. Preserve active leases, memory backup/rollback semantics and failure
   diagnostics; never silently fall back to an older binary against migrated
   memory.
5. Regression covering update → stopped sidecar → acquire → release → acquire,
   including a process restart with persisted state, rollback, an unavailable
   accepted image, an explicit pin and a busy lease.
6. Run the real published image through the same transition and record the leased
   server's health version and digest.
7. Replay the three referenced tasks through their real clients.
8. "This test must not be solved by hardcoding a release number; selection must
   follow the verified state."

### From issue #2208

1. Distinguish the local wrapper version from the serving backend version in
   runtime state, logs and session provenance.
2. Query the configured endpoint's `/health` with a bounded deadline **before**
   client execution, validating version and memory compatibility, preserving
   authentication.
3. Carry the accepted image digest and lease version into task evidence.
4. Never infer the serving version from the wrapper or from a mutable tag.
5. Cover local-old/server-new, local-new/server-unsupported, malformed or missing
   server version, an unreachable endpoint, and a reused endpoint whose backend
   changed between tasks.
6. "The local wrapper may have a separate compatibility requirement; retain that
   check under its own name."

### From issue #2209

Both in one pull request, with the interaction covered end to end, real published
image evidence, and an explicit blocker report rather than a success claim if an
independently tracked Formal AI defect still prevents delivery.

## Root cause A: acquire re-derived the image instead of reading the acceptance

`updateFormalAiSidecarWhenIdle` finishes by persisting what it accepted:

```js
lastUpdate: {
  (image, digest, previousDigest, version, migrationId, memorySchemaVersion, updatedAt);
}
```

`acquireFormalAiSidecar` read that same state — it needs the lease list — and then
chose its image from a completely separate path:

```js
const resolved = container.exists && container.image ? { image: container.image, source: 'running-sidecar', pulled: false } : await ensureFormalAiSidecarImage({ env, run, timeoutMs: imageTimeoutMs, log, verbose });
```

`ensureFormalAiSidecarImage` consults `resolveFormalAiSidecarImageCandidates(env)`,
whose inputs are the operator pin, the compiled-in `FORMAL_AI_BOOTSTRAP_VERSION`
and the local Hive Mind image. The accepted release is not among them. With no
container running — which is exactly the state the updater leaves behind, by
design — the first candidate is the bootstrap tag, so the task booted 0.345.0 and
acquire then overwrote `state.imageDigest` with the bootstrap digest. The
acceptance record survived in `lastUpdate`, unread.

The reproduction is two files long:

```
$ node experiments/issue-2209/reproduce-update-acquire.mjs
AssertionError: the next task must consume the successfully verified update
+ actual - expected
+ 'sha256:old'
- 'sha256:new'
```

(`data/logs/reproductions-before.log`.)

### Fix A

`resolveFormalAiSidecarImageCandidates(env, { accepted })` gained a second source,
between the pin and the bootstrap tag:

```js
FORMAL_AI_IMAGE_SOURCES.ACCEPTED = 'accepted-update';
```

Like the operator pin, the accepted source is **exclusive**: when an acceptance
exists, Hive Mind boots that release or fails loudly, because falling through to
an older binary is precisely the "older binary against migrated memory" the issue
forbids. Within the source, the immutable digest is tried first and the tag second
with `expectDigest`, so a tag that has since moved is classified as
`digest-mismatch` rather than quietly accepted. The pin still wins outright, and
`readAcceptedFormalAiImage(state)` returns nothing on a fresh install, which is
what keeps bootstrap correct for a first run.

Selection follows state, never a literal: the tests assert against the digest the
_updater_ produced, so hardcoding a release number cannot make them pass.

## Root cause B: the version line came from the wrong binary

`prepareFormalAiRuntime` probed the executable it was about to run:

```js
const formalAiVersion = await readFormalAiBinaryVersion(...);
assertSupportedFormalAiVersion(formalAiVersion, ...);
```

and when `HIVE_MIND_FORMAL_AI_BASE_URL` pointed at a sidecar, the external branch
logged the URL and left `formalAiVersion` as the local number. That value then
flowed into the log line and the session provenance. It is not merely imprecise —
in the sidecar topology the local wrapper is a convenience install that need not
share a version with the container at all, which is why the three production tasks
in #2207 report `0.339.1` for a fleet whose bootstrap release is `0.345.0`.

```
$ node experiments/issue-2209/reproduce-server-version.mjs
🧠 Formal AI: version 0.339.1 (minimum 0.336.0)
🧠 Formal AI: using the configured server http://127.0.0.1:41613
{ "localWrapperVersion": "0.339.1", "actualServerVersion": "0.346.0",
  "reportedRuntimeVersion": "0.339.1", "serverRequests": 0 }
AssertionError: remote model provenance must identify the server that answers the request
```

The reproduction stands a real HTTP server on the base URL and counts its
requests. `serverRequests: 0` is the finding: before the fix, running a task
against a Formal AI server involved no question ever being asked of that server.
After the fix the counter is one and the reported version is the server's
(`data/logs/reproductions-after.log`).

### Fix B

`probeFormalAiBackend` performs a bounded-deadline `GET /health`
(`FORMAL_AI_BACKEND_PROBE_TIMEOUT_MS = 15_000`) against the configured base URL,
forwarding `FORMAL_AI_API_KEY` as a bearer token, and classifies the outcome as
`ok | unreachable | http-error | unauthorized | malformed | no-version`.
`assertSupportedFormalAiBackend` then applies the minimum-version and
memory-compatibility rules to the **backend**, and — when the lease says which
release was verified — refuses a backend that disagrees with it, which is how a
sidecar that regressed to the pre-update release is caught.

The two versions are now separate fields with separate names, and the local
wrapper keeps its own check under its own name:

```
🧠 Formal AI: local wrapper version 0.339.1 (minimum 0.336.0)
🧠 Formal AI: serving backend 0.347.0 at http://172.19.0.2:8080, image ghcr.io/link-assistant/formal-ai:latest, digest sha256:e4aeffa3…
🧠 Formal AI: local wrapper 0.339.1 differs from the serving backend 0.347.0; provenance records the backend
```

The lease's identity reaches the task through
`buildFormalAiTaskEnv({ sidecar, env })`, which adds
`HIVE_MIND_FORMAL_AI_SIDECAR_IMAGE`, `…_DIGEST`, `…_VERSION` and `…_SOURCE`
alongside the base URL, so an isolated task can name the image it is being served
by without inspecting the host's Docker.

## Real published images, real Docker

`experiments/issue-2209/real-image-evidence.mjs` runs the whole transition against
a real daemon and the real registry, in a private state directory it cleans up. It
starts a host on the bootstrap release, updates to `:latest`, and then checks each
task's backend three independent ways: what the lease claims, what
`docker inspect --format {{.Image}}` reports, and what the process answers over
HTTP without going through any Hive Mind code.

Before the fix the run stops at the first of those (`data/logs/real-image-evidence-before.log`);
after it (`data/logs/real-image-evidence-after.log`) all three agree:

```
{ "leaseDigest":         "sha256:e4aeffa3d89ac3f994988b41150497019da365d993bc5a548faa072e49f22e82",
  "dockerReportsDigest": "sha256:e4aeffa3d89ac3f994988b41150497019da365d993bc5a548faa072e49f22e82",
  "probedVersion":       "0.347.0" }
```

and the second task, after the sidecar was stopped again, reaches the same
release. `data/registry/tag-digests.txt` records the manifest digests GHCR served
for `0.345.0`, `0.346.0` and `latest` at capture time.

## Real-client replay

`experiments/issue-2209/replay-real-clients.mjs` drives the three tasks named in
#2207 through `src/solve.mjs` with their real clients, each against a real leased
sidecar. `data/replay/remote-before.txt` is the state those pull requests were in
beforehand and matches the issue's description exactly: the Rust PR contains only
`.gitkeep`; the Kotlin and Scala PRs contain no files at all.
`data/replay/remote-after.txt` is the same three pull requests once the replay had
finished — byte for byte the same content.

Every run began from the bootstrap release, let the idle updater accept `:latest`,
and only then acquired a sidecar:

```
✅ Formal AI updated to 0.347.0; the sidecar stays stopped until a Formal AI task needs it
{ "status": "updated", "version": "0.347.0",
  "digest": "sha256:e4aeffa3d89ac3f994988b41150497019da365d993bc5a548faa072e49f22e82" }

[VERBOSE] formal-ai-image: using 'sha256:e4aeffa3…' (accepted-update) already present locally
🧠 Starting the Formal AI sidecar (ghcr.io/link-assistant/formal-ai:latest @ sha256:e4aeffa3…, accepted-update)
[VERBOSE] formal-ai-sidecar: lease 'replay-codex' acquired (1 active), image=ghcr.io/link-assistant/formal-ai:latest (accepted-update), … formal-ai=0.347.0
```

and every client then printed the release that was actually answering it:

```
🧠 Formal AI: local wrapper version 0.339.1 (minimum 0.336.0)
🧠 Formal AI: using the configured server http://172.19.0.2:8080
🧠 Formal AI: serving backend 0.347.0 at http://172.19.0.2:8080, image ghcr.io/link-assistant/formal-ai:latest, digest sha256:e4aeffa3…
🧠 Formal AI: local wrapper 0.339.1 differs from the serving backend 0.347.0; provenance records the backend
```

That is what this pull request set out to make true, on a real host rather than a
simulator: the accepted release is the one that boots (#2207), and it is named
separately from the wrapper (#2208) — the direct answer to #2207's remark that
`version 0.339.1` "comes from the local wrapper probe". All three tasks reproduce
both lines (`data/replay/driver-{codex,claude,agent}.log`, and the client logs
`data/replay/{codex-rust,claude-kotlin,agent-scala}.log.gz`).

## Remaining blocker: formal-ai#1075

Issue #2209 asks for the four delivery assertions — the issue was read, the
requested source **and** the GitHub Actions workflow were written in the clone,
the exact-output tests passed, and a non-placeholder commit was pushed whose diff
appears on the remote pull request. **None of them holds for any of the three
tasks**, and none of the three remote pull requests changed. This is a blocker
report, not a success claim.

The three runs failed in three different ways, which is worth recording, because
the earlier claim that they all end in `planned_not_executed` is not what 0.347.0
actually does:

| Task              | Client exit | What 0.347.0 did                                                                                                                                                         | Remote PR after             |
| ----------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| Rust / `codex`    | 1           | Emitted a `general_change_plan` with `terminal_state "planned_not_executed"` and stopped after one turn.                                                                 | `.gitkeep` only — unchanged |
| Kotlin / `claude` | 1           | Called `mcp__playwright__browser_click` with `{"target": ""}` 1 188 times, every call rejected, until the transcript exhausted the context window: `Prompt is too long`. | no files — unchanged        |
| Scala / `agent`   | 130 †       | Ran five steps and reported that it had "Created and verified `Main.scala`" while quoting `/bin/sh: 1: scala: not found`; wrote nothing to the clone.                    | no files — unchanged        |

† The Scala client had already finished (`✅ Agent command completed`, working-session
summary posted, PR marked ready for review) when `solve.mjs` entered its
auto-restart-until-mergeable watcher; the replay driver was interrupted there
rather than left to idle for 24 hours, and 130 is that interrupt, not the client.

The codex plan is instructive about the first assertion. Reading the issue is
_step one of the plan_, never an action:

```lino
general_change_plan
  execution_mode "repository_work_item"
  terminal_state "planned_not_executed"
  step 1
    capability "Fetch"
    action "read the referenced work item at …/issues/1 before planning any change"
```

So the `Fetch`-first step that
[formal-ai#904](https://github.com/link-assistant/formal-ai/issues/904)'s follow-up
added — the one
[formal-ai#1064](https://github.com/link-assistant/formal-ai/issues/1064) reported
as merged but unreleased at 0.345.0 — has now shipped, and the plan is still not
executed. The Kotlin run shows the same defect from the other side: the model does
reach for a tool, and calls it with an empty argument, 1 188 times without
adapting. That is the executor / argument-grounding defect tracked as
[formal-ai#1075](https://github.com/link-assistant/formal-ai/issues/1075), whose
own body states that "Hive Mind's serving-version provenance and update-to-next-task
defects are being reported separately" — this pull request is that separate
report. Per #2209's responsibility boundary, no Formal AI source change is folded
in here.

Hive Mind's own behaviour is correct and unchanged throughout. It refuses the
plan-only result rather than falling back to another model (the fail-closed policy
from issue [#2146](https://github.com/link-assistant/hive-mind/issues/2146)):

```
❌ Formal AI did not execute repository work; it returned the terminal state planned_not_executed.
```

it posts the reason to the target pull request (comment `5551383277`), and where
the client claimed success it contradicted the claim in the summary it published:

```
⚠️ This pull request still contains no changes - nothing was implemented yet.
```

What changed with this pull request is that all of that is now attributable. Before
it, the same three tasks logged `Formal AI: version 0.339.1` and nobody could say
which release had failed; now the failing release is named, with its digest, and
the accepted update is provably the process that served the request.

## Implementation map

| File                                                                            | Change                                                                                                                                                               |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/formal-ai-image.lib.mjs`                                                   | `ACCEPTED` image source, `readAcceptedFormalAiImage`, `resolveAcceptedFormalAiImageCandidates`, `digest-mismatch` classification.                                    |
| `src/formal-ai-sidecar.lib.mjs`                                                 | Acquire passes the acceptance into image resolution and persists `imageReference`, the accepted identity and the `serving` block.                                    |
| `src/formal-ai-runtime.lib.mjs`                                                 | `probeFormalAiBackend`, `assertSupportedFormalAiBackend`, `resolveFormalAiBackend`, sidecar provenance env, split of `formalAiVersion` and `formalAiWrapperVersion`. |
| `src/formal-ai-isolation.lib.mjs`                                               | `buildFormalAiTaskEnv` carries the lease identity to the task.                                                                                                       |
| `src/formal-ai.lib.mjs`, `src/isolation-runner.lib.mjs`                         | Surface `backend` and the two versions to callers.                                                                                                                   |
| `tests/test-issue-2207-…`, `tests/test-issue-2208-…`, `tests/test-issue-2209-…` | The regressions listed above.                                                                                                                                        |

## Reproduction and verification

```bash
# the two minimal reproductions (fail before the fix, pass after)
node experiments/issue-2209/reproduce-update-acquire.mjs
node experiments/issue-2209/reproduce-server-version.mjs

# the regressions
node --test tests/test-issue-2207-accepted-image-persistence.mjs \
            tests/test-issue-2208-serving-backend-provenance.mjs \
            tests/test-issue-2209-verified-release-serving-provenance.mjs

# the whole default suite
node scripts/run-tests.mjs --suite default

# real Docker, real published images (requires a Docker daemon and GHCR access)
node experiments/issue-2209/real-image-evidence.mjs

# the real-client replay (one tool at a time, or all three without --only)
node experiments/issue-2209/replay-real-clients.mjs --only codex --timeout 1800
```

## Remaining limits

- The replay runs `src/solve.mjs` on the host rather than through
  `executeWithIsolation`, because the `start-command` binary that path requires is
  not installed in this environment. The sidecar, the lease, the task environment
  and the client are real; the container-in-container wrapper around them is not
  exercised.
- End-to-end delivery cannot be demonstrated until formal-ai#1075 is fixed. What
  is demonstrated is that the release under test is the one that failed, named with
  its digest — which was not knowable before this change.
- The Scala replay's recorded exit code is the interrupt of `solve.mjs`'s
  post-solve watcher, not the client's own exit; the client had already completed.
  Its delivery assertions fail on the remote diff, which is unaffected by that.
