Fixes #2146.

Formal AI is now the only model a Formal AI task can reach, it runs only while such a task exists, it is reachable only over a private internal Docker network, its memory survives every stop, and both the sidecar image and the bundled agentic CLIs refresh only while the host is idle. Every upstream prerequisite this needed has been filed, fixed, released, and is consumed here at its newest published version.

## What was wrong

The Aug 8 reproductions exposed three separate failures:

| Path           | Observed behavior                                                             | Root cause                                                                                                                                                                                                              |
| -------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent          | A run requested Formal AI but contacted `https://opencode.ai/zen/v1/messages` | Hive Mind interpolated `--model formalai/formal-ai --verbose` as one command-stream argv atom. Agent could not parse it, announced that it would use its default, and then failed open to `opencode/minimax-m2.5-free`. |
| Claude/Codex   | Five restarts per tool returned the same plan without implementing the issue  | The logs match Formal AI #904's pre-v0.326.1 plan-only signature. `--no-tool-check` suppressed the only version probe, so the exact runtime version was not recorded and a stale/unversioned binary was allowed to run. |
| GitHub summary | Formal AI's structured Lino plan collapsed into ordinary prose                | The working-session summary posted indented structured text without a code fence.                                                                                                                                       |

The restart controller itself behaved correctly: every Claude/Codex iteration still had an empty or placeholder-only diff, so Hive Mind retried five times and then failed.

## Formal AI is the only reachable model

Three independent layers, because any single one of them can be defeated by a future upstream change:

1. **Distinct argv atoms.** Every Agent flag is a separate argv element, including resume identifiers and stream-json flags, so `--model` can never arrive glued to another flag.
2. **An Agent CLI floor.** Agent only fails closed on a `--model` it cannot parse from **js-0.25.8** onwards ([agent#293](https://github.com/link-assistant/agent/issues/293) → [PR #294](https://github.com/link-assistant/agent/pull/294)); earlier releases logged a CRITICAL record and then answered with their default model. A guard that reads that record can only stop the run after Agent has already decided, so `MIN_AGENT_FORMAL_AI_VERSION = '0.25.8'` makes a Formal AI task refuse to start below it.
3. **A streamed provider guard.** `AgentModelRoutingMismatch` terminates the process before further work if a Formal AI session announces an unparsable model flag or resolves any provider/model other than `formalai/formal-ai`.

Plus: `session.idle` is live-input state only — a prior streamed error is cleared only by `step_finish(reason=stop)` or an explicit successful result; the Formal AI runtime version is probed and logged unconditionally, even with `--no-tool-check`; and structured, indented result paragraphs are fenced at the GitHub-comment boundary while ordinary Markdown and existing fences are preserved.

## On-demand sidecar lifecycle

Formal AI used to exist only as an always-on Compose sibling — it ran when no Formal AI task did, it was never replaced, and Docker-isolated work sessions (created inside the Hive Mind container's own daemon) could not join its network at all, so they were handed a resolved IP address instead. The bot deployment now uses a lease-counted, on-demand sidecar ([`src/formal-ai-sidecar.lib.mjs`](src/formal-ai-sidecar.lib.mjs)):

- A Formal AI task is identified from the task's parsed `--model`, not from the selected CLI tool.
- The first such task creates the `--internal` network, the memory volume and the container **inside the closed per-session start gate**, before any agent process exists. Concurrent tasks share one container under explicit leases keyed on the session UUID; the last release stops it.
- Nothing is published to the host — `buildFormalAiSidecarRunArgs` emits no `-p`/`--publish`, and only Formal AI task containers are attached, with `docker network connect` in that same gate ([`src/isolation-runner.lib.mjs`](src/isolation-runner.lib.mjs)).
- Reconciliation re-derives truth from Docker rather than trusting the durable store: an unseen container gets a bounded one-hour launch grace, a container once seen and now gone is stale immediately, so a crashed task cannot pin the sidecar forever.
- `hive-mind-formal-ai-memory` is mounted at `/home/box/.formal-ai` and no code path issues `docker volume rm` — memory survives every stop, failure and rollback.

`docker-compose.yml` keeps the always-on shape as the documented exception — Compose has no bot process and no Docker socket to manage a lifecycle with — and sets `HIVE_MIND_FORMAL_AI_SIDECAR=0` so no second sidecar is started next to it. Both shapes share the `hive-mind-formal-ai-memory` volume name and the `link-assistant-formal-ai` alias, so memory survives a move between them.

`start-command` 0.31.0 can now name a network at launch ([start#154](https://github.com/link-foundation/start/issues/154) → [PR #155](https://github.com/link-foundation/start/pull/155)), and it is used for the sidecar itself. It is deliberately _not_ used for tasks: `docker run --network` replaces the default bridge, and attaching a task directly to an `--internal` network would cut it off from GitHub. Attaching a second network inside the gate is the correct shape, not a workaround.

## Idle-only updates

Images now pin only the **bootstrap** Formal AI version (0.337.0). [`src/formal-ai-updater.lib.mjs`](src/formal-ai-updater.lib.mjs) adopts newer digests while idle, using the persisted-memory upgrade contract delivered by [formal-ai#982](https://github.com/link-assistant/formal-ai/issues/982) → [PR #985](https://github.com/link-assistant/formal-ai/pull/985) → [v0.336.0](https://github.com/link-assistant/formal-ai/releases/tag/v0.336.0): pull → side-effect-free `memory upgrade-status` → locked/backed-up/atomic `memory migrate` with a JSON receipt → boot the candidate → check `/health`'s `memory.compatible` → stop it again. Any failure restores `backup_path` and verifies its SHA-256 from the receipt. Two extra properties the contract does not itself promise are checked: the preflight's `source_sha256` is compared against the receipt's `original_sha256` (a preflight that mutated the file is its own rollback-worthy stage), and the candidate is stopped after verification so a successful idle update leaves the host idle.

Both `memory` subcommands print JSON on **stdout** and _then_ exit nonzero when they refuse (`src/cli_memory.rs`), so the parser is applied to failed commands too and `refusal_code`/`refusal_reason` is surfaced instead of "exit status 1".

[`src/agentic-cli-updater.lib.mjs`](src/agentic-cli-updater.lib.mjs) does the same for the bundled CLIs: it acts only when the live task list is empty, probes each target with `--version`, skips CLIs absent from the image, resolves published versions with a throttled `npm view`, refreshes Claude with its own `claude update` and the Bun-installed CLIs with `bun install -g <package>@latest`. `@link-assistant/hive-mind` (it owns the running process) and `start-command` (pinned by the Dockerfile) are asserted exclusions. All three duties run from one tick in [`src/formal-ai-maintenance.lib.mjs`](src/formal-ai-maintenance.lib.mjs) in the only safe order — reconcile-and-stop, image update, CLI refresh — each best-effort so maintenance never takes the bot down.

## Upstream reports filed from this incident

| Report                                                                                                    | Outcome                                                                                | Consumed here as                                                               |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [agent#293](https://github.com/link-assistant/agent/issues/293) — `--model` fail-open                     | [PR #294](https://github.com/link-assistant/agent/pull/294) → js-0.25.8                | `MIN_AGENT_FORMAL_AI_VERSION`; a Formal AI task refuses to start below it      |
| [formal-ai#982](https://github.com/link-assistant/formal-ai/issues/982) — no safe memory upgrade contract | [PR #985](https://github.com/link-assistant/formal-ai/pull/985) → v0.336.0             | preflight/migrate/verify/rollback; `FORMAL_AI_MEMORY_CONTRACT_MINIMUM_VERSION` |
| [start#154](https://github.com/link-foundation/start/issues/154) — no Docker network at launch            | [PR #155](https://github.com/link-foundation/start/pull/155) → js-0.31.0 / rust-0.18.0 | pinned in `Dockerfile`/`Dockerfile.dind`; used for the sidecar                 |

All three are closed as completed and consumed here. Re-reading the _delivered_ releases against what this PR actually depends on, and reading the first full CI run this branch ever got, surfaced four more follow-ups, now filed rather than kept as private knowledge:

- [agent#295](https://github.com/link-assistant/agent/issues/295) — the provider guard has to discriminate on `message === 'using explicit provider/model'` (`js/src/cli/model-config.js:118`). Rewording that string is non-breaking upstream and would silently disable a safety guard, so it asks for a typed `model_resolved` event with `source` and `matchesRequest`. Not a blocker: it is the third layer, and the two in front of it stop the incident on their own.
- [start#156](https://github.com/link-foundation/start/issues/156) — PR #155 shipped a single-valued `--network`, and `docker run --network` replaces the default bridge, so no single-network invocation can express "reach GitHub _and_ the sidecar". **Delivered upstream on Aug 10 by [PR #157](https://github.com/link-foundation/start/pull/157)**, but only to `rust-v0.19.0`; see the next item.
- [start#160](https://github.com/link-foundation/start/issues/160) — the integration test that came with #157 probes internet egress with `https://api.github.com`, which rate limits unauthenticated callers per source IP. On a shared Actions runner it answers `403`, BusyBox `wget --spider` reports that as failure, and the JavaScript release job was skipped — so `js-v0.32.0` does not exist and `npm view start-command version` still answers `0.31.0`. Reproduced locally (the private alias pings fine; only the `wget` fails) and filed with the one-line fix. Not a blocker: this PR installs the npm package, so it keeps the `0.31.0` pin and the `docker network connect` step inside the closed start gate until the release lands.
- [formal-ai#988](https://github.com/link-assistant/formal-ai/issues/988) — from 0.333.0 onwards `cargo install formal-ai --locked` fails on a stock Rust image: the tree reaches `native-tls` → `openssl-sys`, which needs `pkg-config` and the OpenSSL headers. Found by this PR's own `docker-pr-check`, reproduced locally, and traced to two one-line manifests: [web-capture#151](https://github.com/link-assistant/web-capture/issues/151) (`reqwest 0.12` with default features) and [browser-commander#77](https://github.com/link-foundation/browser-commander/issues/77) (`fantoccini 0.21` with default features, `default = ["native-tls"]`). Worked around here: the four builder stages install `pkg-config` and `libssl-dev` and set `OPENSSL_STATIC=1`, so the binary copied into the Ubuntu 24.04 runtime links only `libc`/`libm`/`libgcc_s`.

Every field this PR reads was re-verified against the **released** Formal AI v0.337.0 sources (`src/memory/upgrade.rs`, `src/cli_memory.rs`, `src/server.rs`, `src/shared_memory.rs`) rather than against the issue text, because consuming a contract from its proposal is how integrations drift.

The mandatory pause rule from #2146 therefore no longer applies — the blockers it was waiting on are delivered, and this PR consumes the newest published release of each (formal-ai 0.337.0, agent js-0.25.8, start js-0.31.0 / rust-0.18.0).

## Regression coverage

- [`tests/test-issue-2146-formal-ai-support.mjs`](tests/test-issue-2146-formal-ai-support.mjs) — argv atoms, provider drift, strong completion, version floor, Markdown fencing, idempotence.
- [`tests/test-issue-2146-formal-ai-lifecycle.mjs`](tests/test-issue-2146-formal-ai-lifecycle.mjs) — lease counting, internal network, no published ports, reconciliation grace/staleness, volume survival.
- [`tests/test-issue-2146-idle-updates.mjs`](tests/test-issue-2146-idle-updates.mjs) — busy-host refusal, rollback at the `verify` and `preflight-side-effect` stages, refusal payload shapes, CLI-updater exclusions.
- [`tests/test-issue-2130-formal-ai-runtime.mjs`](tests/test-issue-2130-formal-ai-runtime.mjs) — a stale binary is rejected before a server starts.
- [`tests/test-codex-support.mjs`](tests/test-codex-support.mjs) — the Agent floor is proven with a `PATH` stub that records every non-`--version` invocation: on 0.25.7 `validateAgentConnection('formal-ai')` returns false **and the stub is never invoked**, so the outdated CLI never gets the chance to answer with another model; on 0.25.8 the probe is recorded. Asserting only the boolean would pass against an implementation that refuses _after_ sending the request.

The lifecycle and update suites run against [`tests/formal-ai-docker-simulator.mjs`](tests/formal-ai-docker-simulator.mjs), an in-memory Docker daemon modelling containers, `internal` networks, volumes, image digests, `/health` payloads and the two `formal-ai memory` subcommands including their stdout-then-nonzero refusals — deterministic, and needing no daemon, registry or Formal AI image in CI.

## Case study and preserved evidence

[`docs/case-studies/issue-2146/`](docs/case-studies/issue-2146/) contains the timeline, the requirement matrix across #2119/#2130/#2146 and both review comments, five root causes, the nine lifecycle invariants with the module and test that enforce each, the field-by-field verification against v0.337.0, alternatives considered, an implementation map, the verification procedure, remaining limits, and a "What is left" section.

The data bundle includes 16 sanitized logs, authenticated Gist snapshots, issue/PR/comment/review API captures, and SHA-256 hashes. Every JSON file parses, every gzip archive passes its integrity check, and every tool-log hash matches [`MANIFEST.md`](docs/case-studies/issue-2146/MANIFEST.md). No screenshots: this is not a UI change and the linked discussions contained no images.

## What is left

Nothing in issue #2146 or in the two review comments on this PR is outstanding here, and no requirement is waiting on an upstream fix. Five upstream reports are open ([agent#295](https://github.com/link-assistant/agent/issues/295), [start#160](https://github.com/link-foundation/start/issues/160), [formal-ai#988](https://github.com/link-assistant/formal-ai/issues/988) with its two root causes [web-capture#151](https://github.com/link-assistant/web-capture/issues/151) and [browser-commander#77](https://github.com/link-foundation/browser-commander/issues/77)); none blocks this PR, each has a working downstream answer, and the case study records why. The one upstream change this repository is waiting on rather than working around is the npm publish of start `js-0.32.0`, which #160 is what blocks. Known, deliberate limits:

- Already-built Docker isolation images keep the CLI versions baked in at build time until rebuilt. The review explicitly allowed either approach; the in-container path was chosen because it cannot spend task time or drift between concurrent tasks.
- The memory migration path is exercised against a simulated v1→v2 migration, because 0.337.0 reads schema 1 and 2 and targets 2, so no real migration is pending yet.
- One shared sidecar per host is what makes memory shared and persistent, so Formal AI tasks are not isolated from each other's memory.
- The one item that cannot be closed from this repository is the original behavioral complaint: Formal AI's agent mode produced a plan and no code in every reproduction. That is tracked upstream on its own coding-capability track ([#848](https://github.com/link-assistant/formal-ai/issues/848), [#904](https://github.com/link-assistant/formal-ai/issues/904)). What Hive Mind can do — refuse to call it a success, refuse to retry it forever, and refuse to quietly finish the work on another model — it now does.

## Checks

- `npm test` (default suite), `npm run lint`, `npm run format:check`, `npm run check:duplication`, `git diff --check`
- issue-2146 lifecycle, idle-update, support and runtime suites, plus `tests/test-codex-support.mjs`
- case-study JSON, gzip, checksum, and credential-signature validation
- one release changeset (`.changeset/formal-ai-2146.md`, `minor` — the sidecar lifecycle and the idle updaters are new backwards-compatible features)
