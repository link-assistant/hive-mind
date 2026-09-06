# Link.Assistant Router releases published after the pinned 0.119.0

Collected 2026-09-04 with `gh api repos/link-assistant/router/releases --paginate`.
Hive Mind pins `ghcr.io/link-assistant/router:0.119.0` in `src/router-isolation.lib.mjs`.

- Pinned: **v0.119.0** (2026-08-26T11:10:32Z)
- Latest: **v1.2.0** (2026-09-04T17:47:17Z)
- Releases published in between: **26**

Bodies below are verbatim upstream release notes, newest first.

---

## v1.2.0 — v1.2.0

Published: 2026-09-04T17:47:17Z

[![crates.io](https://img.shields.io/crates/v/link-assistant-router.svg?label=crates.io)](https://crates.io/crates/link-assistant-router) [![crates.io v1.2.0](https://img.shields.io/badge/crates.io-v1.2.0-orange)](https://crates.io/crates/link-assistant-router/1.2.0)
[![Docker Hub 1.2.0](https://img.shields.io/badge/docker-konard%2Flink--assistant--router%3A1.2.0-2496ED?logo=docker)](https://hub.docker.com/r/konard/link-assistant-router/tags?name=1.2.0)

### Changed

- Update every active Rust, UI, workflow, toolchain, and container dependency to the latest verified release.

### Fixed

- Require exact, complete signed client bindings when adopting local managed-client tokens.
- Make the live Router catalog authoritative for managed Codex launches without replacing user configuration.

### Added

- Discover z.ai Coding Plan models from its authenticated non-inference catalog and merge exact vendor records into every authorized client catalog.
- Expose and enforce explicit `supported_clients` compatibility for ordinary API providers.

### Fixed

- Preserve healthy subscription catalogs when providers are added at runtime, fail explicitly on exact model-ID collisions, and reject incompatible direct requests before upstream dispatch.

### Changed

- Preserve native Claude Code, Codex, and OpenCode request identity, response metadata, JSON semantics, and SSE bytes while replacing only credentials and unavoidable proxy transport fields.

---

## v1.1.1 — v1.1.1

Published: 2026-09-04T14:03:03Z

[![crates.io](https://img.shields.io/crates/v/link-assistant-router.svg?label=crates.io)](https://crates.io/crates/link-assistant-router) [![crates.io v1.1.1](https://img.shields.io/badge/crates.io-v1.1.1-orange)](https://crates.io/crates/link-assistant-router/1.1.1)
[![Docker Hub 1.1.1](https://img.shields.io/badge/docker-konard%2Flink--assistant--router%3A1.1.1-2496ED?logo=docker)](https://hub.docker.com/r/konard/link-assistant-router/tags?name=1.1.1)

### Changed

- Update the pinned Bun runtime container image to its latest reviewed digest.

### Changed

- Update tower-http to 0.7.1.

---

## v1.1.0 — v1.1.0

Published: 2026-09-03T21:26:57Z

[![crates.io](https://img.shields.io/crates/v/link-assistant-router.svg?label=crates.io)](https://crates.io/crates/link-assistant-router) [![crates.io v1.1.0](https://img.shields.io/badge/crates.io-v1.1.0-orange)](https://crates.io/crates/link-assistant-router/1.1.0)
[![Docker Hub 1.1.0](https://img.shields.io/badge/docker-konard%2Flink--assistant--router%3A1.1.0-2496ED?logo=docker)](https://hub.docker.com/r/konard/link-assistant-router/tags?name=1.1.0)

### Added

- Support separate canonical management and inference origins across server selection, wrappers, client setup, configuration, and repair.

### Fixed

- Keep native subscription model identities independent from unrelated bridge defaults and make catalog/routing collision semantics identical.
- Make persistent client setup and configuration transactional, idempotent, and able to revoke unused minted credentials after failure.

### Security

- Reject credential-bearing or path/query/fragment server URLs without echoing rejected secrets, and keep management routes off public client origins.
- Filter automatic routing candidates by the signed client entitlement before resolving provider collisions.

### Fixed

- Keep model-routing validation compatible with the Rust 1.98 lint gate used by release CI.
- Keep managed-server process checks warning-free on Windows and ratchet the verified coverage baseline.

---

## v1.0.2 — v1.0.2

Published: 2026-09-03T10:08:01Z

[![crates.io](https://img.shields.io/crates/v/link-assistant-router.svg?label=crates.io)](https://crates.io/crates/link-assistant-router) [![crates.io v1.0.2](https://img.shields.io/badge/crates.io-v1.0.2-orange)](https://crates.io/crates/link-assistant-router/1.0.2)
[![Docker Hub 1.0.2](https://img.shields.io/badge/docker-konard%2Flink--assistant--router%3A1.0.2-2496ED?logo=docker)](https://hub.docker.com/r/konard/link-assistant-router/tags?name=1.0.2)

### Fixed

- Complete dynamic model routing, z.ai aliases, inference-only client launches, and transactional client repair guarantees found during the Router 1.0 release audit.
- Clear Rust build output at the end of every installed pre-commit run so worktree caches cannot accumulate without bound.

---

## v1.0.1 — v1.0.1

Published: 2026-09-03T07:16:33Z

[![crates.io](https://img.shields.io/crates/v/link-assistant-router.svg?label=crates.io)](https://crates.io/crates/link-assistant-router) [![crates.io v1.0.1](https://img.shields.io/badge/crates.io-v1.0.1-orange)](https://crates.io/crates/link-assistant-router/1.0.1)
[![Docker Hub 1.0.1](https://img.shields.io/badge/docker-konard%2Flink--assistant--router%3A1.0.1-2496ED?logo=docker)](https://hub.docker.com/r/konard/link-assistant-router/tags?name=1.0.1)

### Security

- Removed organization-specific deployment material from current documentation and pseudonymized
  compatibility fixtures with synthetic payloads and identifiers.
- Removed an accidentally committed development-session transcript.

### Fixed

- Updated the version contract test to accept stable releases while still matching Cargo metadata.

---

## v1.0.0 — v1.0.0

Published: 2026-09-02T21:52:35Z

[![crates.io](https://img.shields.io/crates/v/link-assistant-router.svg?label=crates.io)](https://crates.io/crates/link-assistant-router) [![crates.io v1.0.0](https://img.shields.io/badge/crates.io-v1.0.0-orange)](https://crates.io/crates/link-assistant-router/1.0.0)
[![Docker Hub 1.0.0](https://img.shields.io/badge/docker-konard%2Flink--assistant--router%3A1.0.0-2496ED?logo=docker)](https://hub.docker.com/r/konard/link-assistant-router/tags?name=1.0.0)

### Added

- Add ownership-aware client status plus secret-free `clients repair`, dry-run, transactional snapshot, conflict-safe rollback, and resilient temporary Claude launches (#393).

### Changed

- Replace every legacy/overlapping public route with one classified namespace: `/api/health`, `/api/management/*`, and `/api/services/*`; split inference-only and management listeners and migrate every generated client endpoint (#391).
- Derive model discovery, collision aliases, bridge selection, client setup, and dispatch from lossless paginated provider catalogs, persisted by account and invalidated immediately with authorization changes; no production model-name fallback remains (#192).
- Project z.ai Coding Plan models dynamically from provider records while preserving the reviewed client/policy boundary, canonical upstream identity, native protocol endpoint, and current Claude gateway discovery contract (#390).

### Fixed

- Read pre-0.125.4 token stores whose newer optional binding fields are absent and preserve the associative decoder's diagnostic when legacy fallback also fails (#392).

### Removed

- Remove all legacy root, `/v1/*`, and overlapping `/api/*` aliases. See `docs/migrations/1.0.0-canonical-routes.md`; rerun managed client configuration after upgrade (#391).

---

## v0.125.4 — v0.125.4

Published: 2026-09-02T13:39:04Z

[![crates.io](https://img.shields.io/crates/v/link-assistant-router.svg?label=crates.io)](https://crates.io/crates/link-assistant-router) [![crates.io v0.125.4](https://img.shields.io/badge/crates.io-v0.125.4-orange)](https://crates.io/crates/link-assistant-router/0.125.4)
[![Docker Hub 0.125.4](https://img.shields.io/badge/docker-konard%2Flink--assistant--router%3A0.125.4-2496ED?logo=docker)](https://hub.docker.com/r/konard/link-assistant-router/tags?name=0.125.4)

### Fixed

- Validate the required Chat Completions `messages` field before provider selection or translation, returning a local OpenAI error without an upstream request for every routing mode (#387).
- Make Claude, Codex, Gemini, and Qwen credential imports fail closed: validate the refresh chain in an isolated durable store, probe the persisted fresh token through the non-inference vendor catalog, and only then promote the authoritative destination under the shared credential lock. Retain uncertain successors, reject unusable recovery state and filesystem aliases, honor the allowlisted Qwen OAuth resource origin, document Gemini's client-secret prerequisite, remove the rejected/unverified force bypass, and expose `--safe-refresh-chain-import-v1` as a stable deployment capability assertion (#385).
- Bind each managed launch to a signed client kind and subscriber principal, require matching client evidence at the protocol boundary, and deny generic or administrative tokens access to consumer subscriptions unless an exact operator-approved client/provider override exists (#389).
- Add the personal z.ai Coding Plan as an explicit opt-in provider with acknowledged intermediary risk, exact per-client model registries, fixed protocol endpoints, live non-inference health checks, single-subscriber authorization, and fail-closed unsupported-client overrides (#390).

---

## v0.125.3 — v0.125.3

Published: 2026-09-01T22:21:38Z

[![crates.io](https://img.shields.io/crates/v/link-assistant-router.svg?label=crates.io)](https://crates.io/crates/link-assistant-router) [![crates.io v0.125.3](https://img.shields.io/badge/crates.io-v0.125.3-orange)](https://crates.io/crates/link-assistant-router/0.125.3)
[![Docker Hub 0.125.3](https://img.shields.io/badge/docker-konard%2Flink--assistant--router%3A0.125.3-2496ED?logo=docker)](https://hub.docker.com/r/konard/link-assistant-router/tags?name=0.125.3)

### Fixed

- Persist OAuth rotations triggered by diagnostic commands.
- Fail closed when OAuth refresh locking or durable persistence is unavailable.
- Omit absent subscription providers and distinguish startup in health reports.
- Add locked conditional credential import that never replaces an existing login.

---

## v0.125.2 — v0.125.2

Published: 2026-09-01T08:16:22Z

[![crates.io](https://img.shields.io/crates/v/link-assistant-router.svg?label=crates.io)](https://crates.io/crates/link-assistant-router) [![crates.io v0.125.2](https://img.shields.io/badge/crates.io-v0.125.2-orange)](https://crates.io/crates/link-assistant-router/0.125.2)
[![Docker Hub 0.125.2](https://img.shields.io/badge/docker-konard%2Flink--assistant--router%3A0.125.2-2496ED?logo=docker)](https://hub.docker.com/r/konard/link-assistant-router/tags?name=0.125.2)

### Fixed

- Poll remote Codex device logins when the router also returns a verification URL.
- Return malformed Gemini and Vertex JSON errors in the Gemini API envelope.
- Remove unsupported `topP` sampling from Gemini requests routed to Codex.
- Preserve Codex settings and sessions during ordinary `router with codex` runs.
- Preserve Codex Responses Lite tool declarations for current Codex CLI clients.

---

## v0.125.1 — v0.125.1

Published: 2026-08-30T09:00:24Z

[![crates.io](https://img.shields.io/crates/v/link-assistant-router.svg?label=crates.io)](https://crates.io/crates/link-assistant-router) [![crates.io v0.125.1](https://img.shields.io/badge/crates.io-v0.125.1-orange)](https://crates.io/crates/link-assistant-router/0.125.1)
[![Docker Hub 0.125.1](https://img.shields.io/badge/docker-konard%2Flink--assistant--router%3A0.125.1-2496ED?logo=docker)](https://hub.docker.com/r/konard/link-assistant-router/tags?name=0.125.1)

### Fixed
- A token that could not be stored is no longer returned to the caller. `issue` logged a failed `put` at `warn` and returned the token anyway, so a router whose store had stopped accepting writes went on minting credentials it could not subsequently recognise — the holder found out only when they tried to use one. The storage failure now fails the issue path, and is logged at `error` rather than `warn`, so an automated upgrade sees a non-zero exit instead of a line nothing reads (issue #374).

### Fixed
- A token store written by a previous release accepts writes again. v0.125.0 mapped the store through `link_cli::storage::PersistentFileMapped`, which starts with a logical capacity of zero however much the file already holds, so reopening it read a truncated store — 91 links from a 64 MB file holding 524,766 — and schema validation then failed at the first point past the truncation. Because the dual store answers reads from the text projection, the store looked healthy while every write failed with `doublets schema contains an invalid point` (issue #374).
- The mapping restores the capacity its bytes represent, returns the complete allocation from `grow` rather than only the new tail, and refuses the store's initial bootstrap `shrink` once so the restored capacity is not immediately discarded. `grow_filled`, the safe alternative, cannot be used: despite its documentation it writes the fill value across the persisted region and empties the store, reported as link-foundation/link-cli#102.

---

## v0.125.0 — v0.125.0

Published: 2026-08-29T23:21:30Z

[![crates.io](https://img.shields.io/crates/v/link-assistant-router.svg?label=crates.io)](https://crates.io/crates/link-assistant-router) [![crates.io v0.125.0](https://img.shields.io/badge/crates.io-v0.125.0-orange)](https://crates.io/crates/link-assistant-router/0.125.0)
[![Docker Hub 0.125.0](https://img.shields.io/badge/docker-konard%2Flink--assistant--router%3A0.125.0-2496ED?logo=docker)](https://hub.docker.com/r/konard/link-assistant-router/tags?name=0.125.0)

### Changed
- Upgraded `doublets` from 0.4 to 0.5, whose fixed unit-store update makes `Doublets::delete_all` usable again on a store holding real links.
- The token store's file mapping now comes from `link-cli` 0.2.10 (`link_cli::storage::PersistentFileMapped`) instead of an adapter maintained in this repository.
- File locking now uses the standard library's `File::lock`, `lock_shared`, `try_lock` and `unlock`, stabilised in Rust 1.89, in place of the unmaintained `fs2` crate.
- Raised the minimum supported Rust version to 1.89; the release-workflow test derives the toolchain floor it enforces from `rust-version` in `Cargo.toml` rather than hardcoding it.
- Refreshed `Cargo.lock` to the latest compatible versions of every transitive dependency.

### Removed
- Removed `src/storage/file_mapped.rs`, the crate's only `unsafe` code, along with its scoped `unsafe_code` exception.
- Removed the `fs2` and `platform-mem` direct dependencies.

---

## v0.124.4 — v0.124.4

Published: 2026-08-29T14:06:41Z

[![crates.io](https://img.shields.io/crates/v/link-assistant-router.svg?label=crates.io)](https://crates.io/crates/link-assistant-router) [![crates.io v0.124.4](https://img.shields.io/badge/crates.io-v0.124.4-orange)](https://crates.io/crates/link-assistant-router/0.124.4)
[![Docker Hub 0.124.4](https://img.shields.io/badge/docker-konard%2Flink--assistant--router%3A0.124.4-2496ED?logo=docker)](https://hub.docker.com/r/konard/link-assistant-router/tags?name=0.124.4)

### Changed
- The token store's data structure is called a **links network** throughout, never a graph. Links whose sources and targets are themselves links are not vertices joined by edges: every link is addressable and can be the source or target of another, and a point is simply a link whose source and target are itself. Calling it a graph invites reasoning that does not hold here — that edges are anonymous, that they cannot be referenced, that vertices are a separate population. "Network" is accepted as a shorthand where the context is clear.
- `scripts/check-terminology.rs` enforces this in CI, over identifiers as well as prose and in every human language. Other people's names for their own things stay allowed — GraphQL, Git's object graph, a build system's dependency graph — and a single line can opt out with a `terminology-check: allow` marker where the rule itself has to be quoted. `CONTRIBUTING.md` documents the rule and the reason behind it.

---

## v0.124.3 — v0.124.3

Published: 2026-08-29T13:04:40Z

[![crates.io](https://img.shields.io/crates/v/link-assistant-router.svg?label=crates.io)](https://crates.io/crates/link-assistant-router) [![crates.io v0.124.3](https://img.shields.io/badge/crates.io-v0.124.3-orange)](https://crates.io/crates/link-assistant-router/0.124.3)
[![Docker Hub 0.124.3](https://img.shields.io/badge/docker-konard%2Flink--assistant--router%3A0.124.3-2496ED?logo=docker)](https://hub.docker.com/r/konard/link-assistant-router/tags?name=0.124.3)

### Fixed
- The token store no longer writes duplicate links into its doublets graph. Byte sequences are built right to left, so every string ending in the same byte created its own copy of the same `(byte, empty)` link — a second link with a `(source, target)` pair the store already held. `doublets` 0.4 accepts that and cannot represent it: `count()` sees both copies while the `(source, target)` index sees one, and the sources/targets trees' sizes then disagree with the storage, so any later deletion underflows in `platform-trees` — a panic in debug and a silent wrap in release. Interning and the semantic pairs now use `get_or_create`, which reuses the existing link, matching what the C# implementation enforces with `LinkWithSameValueAlreadyExistsException` (reported as linksplatform/doublets-rs#57).
- Writes are about twice as fast as a side effect. Sharing a suffix rather than recreating it is simply less work: ten writes at 306 records went from 11.4 s to 6.1 s.

---

## v0.124.2 — v0.124.2

Published: 2026-08-29T10:03:39Z

[![crates.io](https://img.shields.io/crates/v/link-assistant-router.svg?label=crates.io)](https://crates.io/crates/link-assistant-router) [![crates.io v0.124.2](https://img.shields.io/badge/crates.io-v0.124.2-orange)](https://crates.io/crates/link-assistant-router/0.124.2)
[![Docker Hub 0.124.2](https://img.shields.io/badge/docker-konard%2Flink--assistant--router%3A0.124.2-2496ED?logo=docker)](https://hub.docker.com/r/konard/link-assistant-router/tags?name=0.124.2)

### Fixed
- The token store is opened once per process and held, rather than opened, mapped, built and torn down on every access. `BinaryTokenStore` now keeps one `PersistentStore` behind a reader-writer lock, so concurrent readers share it and a writer excludes them (issue #357).
- Opening the store no longer parses the whole graph. Decoding every record walks one link per byte of every string, which at 306 records took about 1.9 s, and a process that only writes never needed the result — the parse is now deferred to the first read that actually wants it. Opening the dual store went from 1.91 s to 7.3 ms.
- Recovery on open runs only when a transaction journal is present. It previously read both projections and committed them back on every open, paying a full parse and a full rebuild even when there was nothing to recover — which every `router with` invocation paid.
- A store file too short to hold the legacy `LARTOK01` magic is no longer misread as a legacy file. This was invisible while a store only ever appeared fully built, and became reachable once a store can be observed while it is being filled: about half of eight concurrent `tokens issue` processes failed with `invalid legacy binary magic header`.

### Fixed
- Test suites no longer race each other for ephemeral ports. `free_port` bound port 0 and dropped the listener, releasing the port before the child router could bind it, so a concurrently running test binary could take it; the loser then sent its requests to the winner's router and got answers about tokens that router had never issued. On CI this surfaced as `a_scoped_token_cannot_push_to_another_repository` seeing HTTP 200 where it required 403, which reads like a broken authorization check and was not one (issue #368).
- A router harness now confirms that the child process it started is the one answering. A sibling router replies `200` on `/health` just the same, so liveness of the child — which exits when it loses the port — is what distinguishes them, and losing the race retries instead of failing the test.

---

## v0.124.1 — v0.124.1

Published: 2026-08-28T22:42:17Z

[![crates.io](https://img.shields.io/crates/v/link-assistant-router.svg?label=crates.io)](https://crates.io/crates/link-assistant-router) [![crates.io v0.124.1](https://img.shields.io/badge/crates.io-v0.124.1-orange)](https://crates.io/crates/link-assistant-router/0.124.1)
[![Docker Hub 0.124.1](https://img.shields.io/badge/docker-konard%2Flink--assistant--router%3A0.124.1-2496ED?logo=docker)](https://hub.docker.com/r/konard/link-assistant-router/tags?name=0.124.1)

### Fixed
- A unix-socket test that cannot start the router now says why. `Router::start` spawned the process with `stderr` discarded, so when startup failed the only evidence was `router never answered on <path>` — the router's own explanation was thrown away. It failed once on macOS in CI with nothing to diagnose it by. The child's stderr is now captured and included in the panic, and the helper checks whether the process has already exited instead of waiting out the full 40-second deadline, so a startup failure is reported in about a second with the reason attached.

---

## v0.124.0 — v0.124.0

Published: 2026-08-28T22:13:35Z

[![crates.io](https://img.shields.io/crates/v/link-assistant-router.svg?label=crates.io)](https://crates.io/crates/link-assistant-router) [![crates.io v0.124.0](https://img.shields.io/badge/crates.io-v0.124.0-orange)](https://crates.io/crates/link-assistant-router/0.124.0)
[![Docker Hub 0.124.0](https://img.shields.io/badge/docker-konard%2Flink--assistant--router%3A0.124.0-2496ED?logo=docker)](https://hub.docker.com/r/konard/link-assistant-router/tags?name=0.124.0)

### Changed
- A per-run token's expiry now slides while the session is in use. `router with` minted a token with a fixed lifetime and never touched it again, so an interactive session that outlived the clock died mid-work — at one hour routinely, which is why #341 raised the default to a day, and then against the 24-hour wall while the user was typing into it. Serving a request is the evidence that the run is still alive, and it was the evidence being discarded. Each request now pushes the expiry to `now + --run-ttl-hours`, so a session in continuous use never hits the wall and one abandoned for longer than the window still expires — which is what the bound is for, since the token is revoked when the client exits anyway (issue #354).
- The default window is a week rather than a day. It is long enough that a multi-day session never sees the wall, and short enough that a token whose client never exited cleanly does not live indefinitely.
- `router with --fixed-run-ttl` keeps the previous behaviour: the expiry set at issue time is final, whatever the session is doing. The same choice is reachable over the API as `"sliding_expiry": true` on `POST /api/tokens`, so the CLI and the endpoint do not diverge.
- Extending never shortens. A window smaller than a token's remaining life leaves the longer expiry alone, so lowering it cannot revoke a token early, and a refused request extends nothing — a token over its budget is not kept alive by the requests it is rejecting.

### Fixed
- Minting a token is roughly three times faster. `BinaryTokenStore::refresh` reloaded the whole doublets graph from disk unconditionally, and the dual store calls `list` on every write through `merged_records` — so a write paid a full parse before doing anything else. At 306 records that was 1.9 s of the 2.9 s a `put` took, on the path `router with` uses to mint a per-run token. It now takes a shared lock and checks the file's fingerprint first, so a read that finds nothing changed costs a `stat` (issues #356, #357).
- A write no longer rebuilds the binary projection when the records are identical to what is already there. Rebuilding is the expensive half — `write_binary` stores every string as one link per byte, so 306 records cost about 780,000 link creations — and the dual store performed it for both projections on every mutation.
- Measured at 306 records: `merged_records` 1.93 s → 7.5 ms, `put()` 2.95 s → 1.02 s, `list()` unchanged at 7.6 ms. The remaining second is the single unavoidable rebuild of the changed record set, which is what issue #357 tracks.

---

## v0.123.6 — v0.123.6

Published: 2026-08-28T19:03:47Z

[![crates.io](https://img.shields.io/crates/v/link-assistant-router.svg?label=crates.io)](https://crates.io/crates/link-assistant-router) [![crates.io v0.123.6](https://img.shields.io/badge/crates.io-v0.123.6-orange)](https://crates.io/crates/link-assistant-router/0.123.6)
[![Docker Hub 0.123.6](https://img.shields.io/badge/docker-konard%2Flink--assistant--router%3A0.123.6-2496ED?logo=docker)](https://hub.docker.com/r/konard/link-assistant-router/tags?name=0.123.6)

### Fixed
- Releases build again. `cargo audit` failed on `chacha20 0.10.1`, which had been yanked and reached the tree through `reqwest`; every release run on `main` failed at the Dependency Audit gate until it was updated to `0.10.2`. Nothing about the router changed — the crate was withdrawn upstream — but the gate is what stops a release, so it stopped every release.

### Changed
- Every dependency is current, in all four of the places this repository keeps them. Rust: `lino-objects-codec` 0.4.1 → 0.7.0 and `links-notation` 0.14.0 → 0.16.1, which carry the readable-format and empty-reference fixes made upstream at link-foundation/lino-objects-codec#45 and link-foundation/links-notation#288; `uuid` 1.24 → 1.26; `flate2` 1.1.9 → 1.1.10. The admin console: `@chakra-ui/react`, `@vitejs/plugin-react` and `vite`. The images: `rust` 1.97.1 → 1.98.0, and current digests for `oven/bun`, `debian` and the tunnel's `alpine`. CI: all nineteen pinned Rust toolchains move with the builder image rather than drifting from it.
- GitHub Actions were already pinned to the latest commit of every action; only their trailing version comments were stale (`# v7` for what is v7.0.1), which is what makes an audit read them as behind. The comments now say which release each SHA is, and no pin changed.
- `release_workflow_test` reads the toolchain the workflow pins instead of hard-coding it, so a routine upgrade no longer fails a test that is not about the upgrade.

### Fixed
- Token rejections state the facts behind them. `client_message` was a `const fn` returning `&'static str`, so the type itself made every message factless: a user whose day-long session died at the moment they were using it was told what kind of thing went wrong and never a single number about their own token. Expiry now says when the token was issued, how long it was good for, when it lapsed and how long ago; a spent request or token budget says used, limit, and which flag raises it. The router was holding all of those when it wrote the line (issue #355).
- The wording without facts is unchanged, so a rejection is still returned when the store cannot be read rather than being replaced by a storage failure.

---

## v0.123.5 — v0.123.5

Published: 2026-08-27T13:26:00Z

[![crates.io](https://img.shields.io/crates/v/link-assistant-router.svg?label=crates.io)](https://crates.io/crates/link-assistant-router) [![crates.io v0.123.5](https://img.shields.io/badge/crates.io-v0.123.5-orange)](https://crates.io/crates/link-assistant-router/0.123.5)
[![Docker Hub 0.123.5](https://img.shields.io/badge/docker-konard%2Flink--assistant--router%3A0.123.5-2496ED?logo=docker)](https://hub.docker.com/r/konard/link-assistant-router/tags?name=0.123.5)

### Fixed
- Listing tokens no longer rewrites the token store. Every accessor went through one helper that committed unconditionally, so `GET /api/tokens/list` — a pure read — took the exclusive lock, re-serialised and fsynced a 64 MB `tokens.bin` and a 171 KB `tokens.lino`, and answered in 8–13 seconds on a 290-token deployment. `router with` gives that call a 10-second budget, so an ordinary launch failed with a bare transport error that named neither the cause nor the timeout (issue #351).
- Reads take a shared lock and skip the commit, so concurrent listings no longer serialise against each other or against the request path. `try_consume_request` runs per proxied request and takes the same lock, so one slow listing used to queue live traffic behind it.
- A read consults `tokens.lino` rather than merging both projections. `tokens.bin` is preallocated — 64 MB for 290 records — so scanning it cost 1.63 s where the same records came out of the text file in 6 ms. `install` writes text before binary, so the text projection is never the staler of the two; a store whose text file is empty still falls back to the merge. Measured end to end, `list()` went from 1.65 s to 7 ms at 290 tokens.
- Four tests cover it: a listing does not move either file's mtime, a listing of 290 tokens stays far inside the `with` budget, concurrent listings run together, and a read still sees the latest write and survives a reopen.

---

## v0.123.4 — v0.123.4

Published: 2026-08-27T12:56:06Z

[![crates.io](https://img.shields.io/crates/v/link-assistant-router.svg?label=crates.io)](https://crates.io/crates/link-assistant-router) [![crates.io v0.123.4](https://img.shields.io/badge/crates.io-v0.123.4-orange)](https://crates.io/crates/link-assistant-router/0.123.4)
[![Docker Hub 0.123.4](https://img.shields.io/badge/docker-konard%2Flink--assistant--router%3A0.123.4-2496ED?logo=docker)](https://hub.docker.com/r/konard/link-assistant-router/tags?name=0.123.4)

### Fixed
- The request log is links notation the notation's own tools can read. The single-line form this project invented marked object fields with a `:` — `((:"phase" "stream_end"))` — which `links_notation::parse_lino` rejected outright and which `lino-objects-codec` decoded as the array `[":", key, value]`, losing the object boundary. The round trip only worked because the reader was the private inverse of the writer, so a file this project documents as links notation could not be read by anything else (issue #350).
- Records are now written with self-describing containers, `(#o ("phase" "stream_end"))` for an object and `(#a …)` for an array. The codec reads a two-element group whose first element is a scalar as an *object*, so `["a","b"]` and `{"a":"b"}` would otherwise write identical text — a production log holds 779 of those, mostly `enum` arrays out of tool schemas. Marking each container removes the guess.
- Strings are percent-escaped rather than backslash-escaped, because neither library reads a backslash escape: `"q\"q"` makes the codec fail with *unterminated quoted value*, and request bodies are full of embedded JSON. Fuzzing both candidates over 6,000 values: percent-escaping 0 failures, the codec-native doubled quote 241. Strings stay greppable — a model name is still findable with `grep`.
- Every generation of the log still reads, exactly. A record is appended and never rewritten, so a deployment holds JSON Lines from v0.121.0 and earlier, the `:` dialect from v0.122.0 through v0.123.3, and the current form, often in one file. All three decode to the same values: verified against 400 real production records in each encoding, a 55-record corpus covering empty containers, empty keys, embedded newlines and the ambiguous arrays, 12,000 fuzzed values, and a live 39 MB log where the 1049 existing records stayed byte-identical while new ones appended (issue #350).

---

## v0.123.3 — v0.123.3

Published: 2026-08-27T09:30:34Z

[![crates.io](https://img.shields.io/crates/v/link-assistant-router.svg?label=crates.io)](https://crates.io/crates/link-assistant-router) [![crates.io v0.123.3](https://img.shields.io/badge/crates.io-v0.123.3-orange)](https://crates.io/crates/link-assistant-router/0.123.3)
[![Docker Hub 0.123.3](https://img.shields.io/badge/docker-konard%2Flink--assistant--router%3A0.123.3-2496ED?logo=docker)](https://hub.docker.com/r/konard/link-assistant-router/tags?name=0.123.3)

### Changed
- The per-token request log is named `requests.lino`. It has held links notation since v0.122.0 while still being called `requests.jsonl`, so the extension named a format the file no longer used — the same class of mismatch as the documentation corrected in #346, in the one place an operator is most likely to trust it (issue #346).
- An existing log is renamed on its token's next write, and a token that has not been written since keeps its history under the old name and is still read. Nothing is rewritten and nothing is discarded: verified against a real 39 MB, 1049-record production log, where the original records remain a byte-identical prefix by SHA-256 after the rename and new records append to the end. The whole-store size bound counts either name, so a log that has not been renamed yet still occupies the budget it always did.
- Operators tailing these files by name should point collectors at `requests.lino`. The one-record-per-line framing is unchanged, so `grep` and log collectors are otherwise unaffected.

---

## v0.123.2 — v0.123.2

Published: 2026-08-27T08:56:04Z

[![crates.io](https://img.shields.io/crates/v/link-assistant-router.svg?label=crates.io)](https://crates.io/crates/link-assistant-router) [![crates.io v0.123.2](https://img.shields.io/badge/crates.io-v0.123.2-orange)](https://crates.io/crates/link-assistant-router/0.123.2)
[![Docker Hub 0.123.2](https://img.shields.io/badge/docker-konard%2Flink--assistant--router%3A0.123.2-2496ED?logo=docker)](https://hub.docker.com/r/konard/link-assistant-router/tags?name=0.123.2)

### Fixed
- A login test no longer fails on a busy machine. `a_rejected_code_fails_the_session_without_writing_a_credential` set `idle_settle` to 50 ms — fifteen times tighter than the 750 ms the router actually ships — so under parallel load the PTY settled before the fake CLI had printed its rejection and the test reported a failed rejection path that works. Reproduced at roughly one run in six under contention, and not at all when run alone, which is the shape of failure that gets dismissed as noise and trains everyone to re-run a red build. The settle is now 250 ms, still far inside the 3-second `code_timeout` the test's timing assertion is actually about.

---

## v0.123.1 — v0.123.1

Published: 2026-08-27T07:47:01Z

[![crates.io](https://img.shields.io/crates/v/link-assistant-router.svg?label=crates.io)](https://crates.io/crates/link-assistant-router) [![crates.io v0.123.1](https://img.shields.io/badge/crates.io-v0.123.1-orange)](https://crates.io/crates/link-assistant-router/0.123.1)
[![Docker Hub 0.123.1](https://img.shields.io/badge/docker-konard%2Flink--assistant--router%3A0.123.1-2496ED?logo=docker)](https://hub.docker.com/r/konard/link-assistant-router/tags?name=0.123.1)

### Fixed
- The documented storage format matches the shipped one. The request log was converted to links notation in #336, but three places still said otherwise: the README described the per-token log as an "append-only operational stream" excluded from the conversion, `lino_json`'s boundary comment listed only the small stores, and the CHANGELOG carried both "the request log stays JSON Lines for now, deliberately" and "the request log is written in links notation" inside the same release section. A decision that the record contradicts is indistinguishable from an oversight, which is what the issue was about rather than the bytes (issue #346).
- The reasons are now recorded where a reader meets them, on both sides of the boundary: the per-token request log is router-owned and is links notation, one record per line, keeping its file name and framing so log collectors and `grep` are unaffected; the optional audit JSONL stays JSON because its reader is somebody else's `jq`, and the recipes this project publishes for it pipe it straight into one. Stale "JSONL" wording in `--request-log` help text and the `RequestLog` docs is corrected (issue #346).
- Each of those decisions now has a test, so a format cannot change without changing a test that says why it was chosen: the log is readable links notation one record per line, a JSON log from an earlier release still reads and migrates record by record as new ones are appended, and a file holding both encodings reports no integrity damage. Verified against a real 1049-record production log — every legacy record reads, re-encodes losslessly, and stays on one line (issue #346).

---

## v0.123.0 — v0.123.0

Published: 2026-08-26T21:04:46Z

[![crates.io](https://img.shields.io/crates/v/link-assistant-router.svg?label=crates.io)](https://crates.io/crates/link-assistant-router) [![crates.io v0.123.0](https://img.shields.io/badge/crates.io-v0.123.0-orange)](https://crates.io/crates/link-assistant-router/0.123.0)
[![Docker Hub 0.123.0](https://img.shields.io/badge/docker-konard%2Flink--assistant--router%3A0.123.0-2496ED?logo=docker)](https://hub.docker.com/r/konard/link-assistant-router/tags?name=0.123.0)

### Fixed
- `serve` stops when it is asked to. Only `ctrl_c` was awaited, so `SIGTERM` — what `docker stop`, Kubernetes and systemd all send — reached no handler; as PID 1 in a container the kernel applies no default action either, so the signal was discarded and every stop waited out the full grace period before a `SIGKILL`. An idle deployment took 30 seconds to stop, and any in-flight stream was severed at the timeout rather than allowed to finish. Both signals now stop the listener, in-flight requests drain, and the process exits 0 (issue #334).
- The HTTPS listener and the unix socket can be stopped at all. The graceful path existed for plain HTTP and the admin UI but the TLS path had no shutdown hook, and the socket could only be aborted mid-request; one notice now reaches all four (issue #334).
- An absent managed container is recognised however Docker spells it. The sentinel matched `No such object` case-sensitively while Docker Desktop writes `no such object`, so a container that simply did not exist yet was read as a hard inspect failure — the container that should then have been created never was, and `with` failed naming an internal container the user has never heard of (issue #333).
- An unreachable selected server says which server, and what to do about it. A refusal is still the answer — silently using a router other than the one selected is its own surprise — but the message now names the deployment, how it came to be selected, and the three ways out: `--local`, `--managed`, or `router server use <URL>` (issue #333).

### Changed
- The pending Claude login, the token transaction journal and the `with` rollback state are stored in links notation, joining the state converted in #235. Each keeps its existing file name and reads either encoding, so an installation migrates on its next write rather than losing what it had (issue #336).
- The request log stays JSON Lines for now, deliberately. Links notation is a multi-line format, and the log is appended one record per line and compacted by scanning for a newline — so converting it needs either a single-line emitter or a new framing plus a rewritten compaction cut-point, and the codec's existing single-line form base64-encodes every string, which would undo the readability just delivered for #328. It is the bulk of the bytes and deserves its own change rather than riding along with three small stores (issue #336).
- `lino_json` states the boundary it enforces: router-owned state is links notation, and vendor-owned state — Anthropic's `.credentials.json`, Codex's `auth.json`, the client `settings.json` files — stays whatever the vendor writes. The rule was real but inferable only from which module a write lived in (issue #336).

### Fixed
- A release removes the fragments it collected. Two collectors existed and only one deleted: `collect-changelog.rs` cleaned up but is wired to the manual dispatch job, while the automatic release on merge runs `version-and-commit.rs`, which collected and never removed. Every release therefore re-collected every fragment ever written and republished the whole archive as its own release notes — 154 pending fragments and a 145 KB section for a single version by v0.120.0, which is why release bodies were being truncated to fit GitHub's limit (issue #337).
- The 153 fragments that had accumulated are removed. Their content is already in `CHANGELOG.md`, many times over, so nothing is lost — and leaving them would have had the next release repeat the whole thing.
- `check-changelog-fragment.rs` fails when `changelog.d/` holds more fragments than one release should ever collect. This went unnoticed for eight months and roughly 150 releases because nothing counted (issue #337).

### Security
- An empty `XDG_CONFIG_HOME`, `HOME` or `APPDATA` is treated as unset rather than as a configured value. `var_os` returns `Some("")` for a set-but-empty variable, so the fallback chain never ran, the config root became the empty string, and the router wrote `server.json` — holding a live `la_sk_` token — into whatever directory the command happened to run from. A resolved root that is not absolute is now refused outright rather than used, and the same treatment covers the client home and the clients' own override variables (issue #340).

### Fixed
- `cargo test` no longer touches the developer's own router state. `clearing_an_absent_selection_succeeds` called `clear_persisted()` with nothing overriding `HOME`, so running the suite deleted the real `~/.config/link-assistant-router/server.json` — a file holding a live token. The test passed either way, which is why it read as harmless. State resolution now takes a test-only root that each test claims for itself, and a test that resolves the real directory without claiming one fails loudly rather than silently operating on whoever ran it. That guard immediately caught two further unisolated tests (issue #343).

### Changed
- The per-run token `with` mints defaults to 24 hours rather than 1. The token is revoked when the client exits, so the run already bounds its life; the clock was a second bound that could only fire early, and at one hour it routinely did — an interactive session that outlived the hour died mid-work. `--run-ttl-hours` still overrides it (issue #341).

### Fixed
- An expired router token says whose token it was. A bare `401 Token has expired` let the client render its own `Please run /login` advice, which points at the model provider's credential — a different thing entirely, which re-authenticating does not change. The message now names the router and `--run-ttl-hours` (issue #341).

### Changed
- The request log is written in links notation, so all router-owned state is one format (issues #235, #336). It is the last store to convert and the largest — 1.7 GB against 93 KB on a real deployment — and it needed a form neither existing encoder provided: the readable one spans a line per field, which breaks a log that is appended and compacted one record per line, and the single-line one base64-encodes every string, which is the unreadability issue #328 had just removed from this same file. `lino_json::encode_line` is that form: one record, one line, strings kept as strings. An operator grepping for a model name still finds it.
- Existing logs keep reading. `decode_line` accepts either encoding, so the JSON Lines an earlier release wrote stay readable and a file migrates record by record as new ones are appended — verified against a file holding both encodings at once.

### Fixed
- A release commit records the fragment removals it made. `collect_changelog` deletes the fragments it consumed, but the commit staged only the manifest, lockfile and changelog — so the deletions stayed in the working tree and were never recorded, and the next release collected the same fragments again. That is the accumulation issue #337 was about, reintroduced one layer down: v0.122.0 shipped correctly but left all four fragments pending. The regression test drives a real repository, because staging is a property of the commit rather than of the collector and no unit test could see it (issue #337).

---

## v0.122.0 — v0.122.0

Published: 2026-08-26T20:34:42Z

[![crates.io](https://img.shields.io/crates/v/link-assistant-router.svg?label=crates.io)](https://crates.io/crates/link-assistant-router) [![crates.io v0.122.0](https://img.shields.io/badge/crates.io-v0.122.0-orange)](https://crates.io/crates/link-assistant-router/0.122.0)
[![Docker Hub 0.122.0](https://img.shields.io/badge/docker-konard%2Flink--assistant--router%3A0.122.0-2496ED?logo=docker)](https://hub.docker.com/r/konard/link-assistant-router/tags?name=0.122.0)

### Fixed
- `serve` stops when it is asked to. Only `ctrl_c` was awaited, so `SIGTERM` — what `docker stop`, Kubernetes and systemd all send — reached no handler; as PID 1 in a container the kernel applies no default action either, so the signal was discarded and every stop waited out the full grace period before a `SIGKILL`. An idle deployment took 30 seconds to stop, and any in-flight stream was severed at the timeout rather than allowed to finish. Both signals now stop the listener, in-flight requests drain, and the process exits 0 (issue #334).
- The HTTPS listener and the unix socket can be stopped at all. The graceful path existed for plain HTTP and the admin UI but the TLS path had no shutdown hook, and the socket could only be aborted mid-request; one notice now reaches all four (issue #334).
- An absent managed container is recognised however Docker spells it. The sentinel matched `No such object` case-sensitively while Docker Desktop writes `no such object`, so a container that simply did not exist yet was read as a hard inspect failure — the container that should then have been created never was, and `with` failed naming an internal container the user has never heard of (issue #333).
- An unreachable selected server says which server, and what to do about it. A refusal is still the answer — silently using a router other than the one selected is its own surprise — but the message now names the deployment, how it came to be selected, and the three ways out: `--local`, `--managed`, or `router server use <URL>` (issue #333).

### Changed
- The pending Claude login, the token transaction journal and the `with` rollback state are stored in links notation, joining the state converted in #235. Each keeps its existing file name and reads either encoding, so an installation migrates on its next write rather than losing what it had (issue #336).
- The request log stays JSON Lines for now, deliberately. Links notation is a multi-line format, and the log is appended one record per line and compacted by scanning for a newline — so converting it needs either a single-line emitter or a new framing plus a rewritten compaction cut-point, and the codec's existing single-line form base64-encodes every string, which would undo the readability just delivered for #328. It is the bulk of the bytes and deserves its own change rather than riding along with three small stores (issue #336).
- `lino_json` states the boundary it enforces: router-owned state is links notation, and vendor-owned state — Anthropic's `.credentials.json`, Codex's `auth.json`, the client `settings.json` files — stays whatever the vendor writes. The rule was real but inferable only from which module a write lived in (issue #336).

### Fixed
- A release removes the fragments it collected. Two collectors existed and only one deleted: `collect-changelog.rs` cleaned up but is wired to the manual dispatch job, while the automatic release on merge runs `version-and-commit.rs`, which collected and never removed. Every release therefore re-collected every fragment ever written and republished the whole archive as its own release notes — 154 pending fragments and a 145 KB section for a single version by v0.120.0, which is why release bodies were being truncated to fit GitHub's limit (issue #337).
- The 153 fragments that had accumulated are removed. Their content is already in `CHANGELOG.md`, many times over, so nothing is lost — and leaving them would have had the next release repeat the whole thing.
- `check-changelog-fragment.rs` fails when `changelog.d/` holds more fragments than one release should ever collect. This went unnoticed for eight months and roughly 150 releases because nothing counted (issue #337).

### Security
- An empty `XDG_CONFIG_HOME`, `HOME` or `APPDATA` is treated as unset rather than as a configured value. `var_os` returns `Some("")` for a set-but-empty variable, so the fallback chain never ran, the config root became the empty string, and the router wrote `server.json` — holding a live `la_sk_` token — into whatever directory the command happened to run from. A resolved root that is not absolute is now refused outright rather than used, and the same treatment covers the client home and the clients' own override variables (issue #340).

### Fixed
- `cargo test` no longer touches the developer's own router state. `clearing_an_absent_selection_succeeds` called `clear_persisted()` with nothing overriding `HOME`, so running the suite deleted the real `~/.config/link-assistant-router/server.json` — a file holding a live token. The test passed either way, which is why it read as harmless. State resolution now takes a test-only root that each test claims for itself, and a test that resolves the real directory without claiming one fails loudly rather than silently operating on whoever ran it. That guard immediately caught two further unisolated tests (issue #343).

### Changed
- The per-run token `with` mints defaults to 24 hours rather than 1. The token is revoked when the client exits, so the run already bounds its life; the clock was a second bound that could only fire early, and at one hour it routinely did — an interactive session that outlived the hour died mid-work. `--run-ttl-hours` still overrides it (issue #341).

### Fixed
- An expired router token says whose token it was. A bare `401 Token has expired` let the client render its own `Please run /login` advice, which points at the model provider's credential — a different thing entirely, which re-authenticating does not change. The message now names the router and `--run-ttl-hours` (issue #341).

### Changed
- The request log is written in links notation, so all router-owned state is one format (issues #235, #336). It is the last store to convert and the largest — 1.7 GB against 93 KB on a real deployment — and it needed a form neither existing encoder provided: the readable one spans a line per field, which breaks a log that is appended and compacted one record per line, and the single-line one base64-encodes every string, which is the unreadability issue #328 had just removed from this same file. `lino_json::encode_line` is that form: one record, one line, strings kept as strings. An operator grepping for a model name still finds it.
- Existing logs keep reading. `decode_line` accepts either encoding, so the JSON Lines an earlier release wrote stay readable and a file migrates record by record as new ones are appended — verified against a file holding both encodings at once.

---

## v0.121.0 — v0.121.0

Published: 2026-08-26T19:18:27Z

[![crates.io](https://img.shields.io/crates/v/link-assistant-router.svg?label=crates.io)](https://crates.io/crates/link-assistant-router) [![crates.io v0.121.0](https://img.shields.io/badge/crates.io-v0.121.0-orange)](https://crates.io/crates/link-assistant-router/0.121.0)
[![Docker Hub 0.121.0](https://img.shields.io/badge/docker-konard%2Flink--assistant--router%3A0.121.0-2496ED?logo=docker)](https://hub.docker.com/r/konard/link-assistant-router/tags?name=0.121.0)

### Fixed
- `serve` stops when it is asked to. Only `ctrl_c` was awaited, so `SIGTERM` — what `docker stop`, Kubernetes and systemd all send — reached no handler; as PID 1 in a container the kernel applies no default action either, so the signal was discarded and every stop waited out the full grace period before a `SIGKILL`. An idle deployment took 30 seconds to stop, and any in-flight stream was severed at the timeout rather than allowed to finish. Both signals now stop the listener, in-flight requests drain, and the process exits 0 (issue #334).
- The HTTPS listener and the unix socket can be stopped at all. The graceful path existed for plain HTTP and the admin UI but the TLS path had no shutdown hook, and the socket could only be aborted mid-request; one notice now reaches all four (issue #334).
- An absent managed container is recognised however Docker spells it. The sentinel matched `No such object` case-sensitively while Docker Desktop writes `no such object`, so a container that simply did not exist yet was read as a hard inspect failure — the container that should then have been created never was, and `with` failed naming an internal container the user has never heard of (issue #333).
- An unreachable selected server says which server, and what to do about it. A refusal is still the answer — silently using a router other than the one selected is its own surprise — but the message now names the deployment, how it came to be selected, and the three ways out: `--local`, `--managed`, or `router server use <URL>` (issue #333).

### Changed
- The pending Claude login, the token transaction journal and the `with` rollback state are stored in links notation, joining the state converted in #235. Each keeps its existing file name and reads either encoding, so an installation migrates on its next write rather than losing what it had (issue #336).
- The request log stays JSON Lines for now, deliberately. Links notation is a multi-line format, and the log is appended one record per line and compacted by scanning for a newline — so converting it needs either a single-line emitter or a new framing plus a rewritten compaction cut-point, and the codec's existing single-line form base64-encodes every string, which would undo the readability just delivered for #328. It is the bulk of the bytes and deserves its own change rather than riding along with three small stores (issue #336).
- `lino_json` states the boundary it enforces: router-owned state is links notation, and vendor-owned state — Anthropic's `.credentials.json`, Codex's `auth.json`, the client `settings.json` files — stays whatever the vendor writes. The rule was real but inferable only from which module a write lived in (issue #336).

### Fixed
- A release removes the fragments it collected. Two collectors existed and only one deleted: `collect-changelog.rs` cleaned up but is wired to the manual dispatch job, while the automatic release on merge runs `version-and-commit.rs`, which collected and never removed. Every release therefore re-collected every fragment ever written and republished the whole archive as its own release notes — 154 pending fragments and a 145 KB section for a single version by v0.120.0, which is why release bodies were being truncated to fit GitHub's limit (issue #337).
- The 153 fragments that had accumulated are removed. Their content is already in `CHANGELOG.md`, many times over, so nothing is lost — and leaving them would have had the next release repeat the whole thing.
- `check-changelog-fragment.rs` fails when `changelog.d/` holds more fragments than one release should ever collect. This went unnoticed for eight months and roughly 150 releases because nothing counted (issue #337).

### Security
- An empty `XDG_CONFIG_HOME`, `HOME` or `APPDATA` is treated as unset rather than as a configured value. `var_os` returns `Some("")` for a set-but-empty variable, so the fallback chain never ran, the config root became the empty string, and the router wrote `server.json` — holding a live `la_sk_` token — into whatever directory the command happened to run from. A resolved root that is not absolute is now refused outright rather than used, and the same treatment covers the client home and the clients' own override variables (issue #340).

### Fixed
- `cargo test` no longer touches the developer's own router state. `clearing_an_absent_selection_succeeds` called `clear_persisted()` with nothing overriding `HOME`, so running the suite deleted the real `~/.config/link-assistant-router/server.json` — a file holding a live token. The test passed either way, which is why it read as harmless. State resolution now takes a test-only root that each test claims for itself, and a test that resolves the real directory without claiming one fails loudly rather than silently operating on whoever ran it. That guard immediately caught two further unisolated tests (issue #343).

### Changed
- The per-run token `with` mints defaults to 24 hours rather than 1. The token is revoked when the client exits, so the run already bounds its life; the clock was a second bound that could only fire early, and at one hour it routinely did — an interactive session that outlived the hour died mid-work. `--run-ttl-hours` still overrides it (issue #341).

### Fixed
- An expired router token says whose token it was. A bare `401 Token has expired` let the client render its own `Please run /login` advice, which points at the model provider's credential — a different thing entirely, which re-authenticating does not change. The message now names the router and `--run-ttl-hours` (issue #341).

---

## v0.120.0 — v0.120.0

Published: 2026-08-26T14:23:59Z

[![crates.io](https://img.shields.io/crates/v/link-assistant-router.svg?label=crates.io)](https://crates.io/crates/link-assistant-router) [![crates.io v0.120.0](https://img.shields.io/badge/crates.io-v0.120.0-orange)](https://crates.io/crates/link-assistant-router/0.120.0)
[![Docker Hub 0.120.0](https://img.shields.io/badge/docker-konard%2Flink--assistant--router%3A0.120.0-2496ED?logo=docker)](https://hub.docker.com/r/konard/link-assistant-router/tags?name=0.120.0)

### Added
- Changeset-style fragment format with frontmatter for specifying version bump type
- New `get-bump-type.mjs` script to automatically determine version bump from fragments
- Automatic version bumping on merge to main based on changelog fragments
- Detailed documentation for the changelog fragment system in `changelog.d/README.md`

### Changed
- Updated `collect-changelog.mjs` to strip frontmatter when collecting fragments
- Updated `version-and-commit.mjs` to handle frontmatter in fragments
- Enhanced release workflow to automatically determine bump type from changesets

### Changed
- Add `detect-changes` job with cross-platform `detect-code-changes.mjs` script
- Make lint job independent of changelog check (runs based on file changes only)
- Allow docs-only PRs without changelog fragment requirement
- Handle changelog check 'skipped' state in dependent jobs
- Exclude `changelog.d/`, `docs/`, `experiments/`, `examples/` folders and markdown files from code changes detection

### Fixed
- Fixed README.md to correctly reference Node.js scripts (`.mjs`) instead of Python scripts (`.py`)
- Updated project structure in README.md to match actual script files in `scripts/` directory
- Fixed example code in README.md that had invalid Rust with two `main` functions

### Added

- Added crates.io publishing support to CI/CD workflow
- Added `release_mode` input with "instant" and "changelog-pr" options for manual releases
- Added `--tag-prefix` and `--crates-io-url` options to create-github-release.mjs script
- Added comprehensive case study documentation for Issue #11 in docs/case-studies/issue-11/

### Changed

- Changed changelog fragment check from warning to error (exit 1) to enforce changelog requirements
- Updated job conditions with `always() && !cancelled()` to fix workflow_dispatch job skipping issue
- Renamed manual-release job to "Instant Release" for clarity

### Fixed

- Fixed deprecated `::set-output` GitHub Actions command in version-and-commit.mjs
- Fixed workflow_dispatch triggering issues where lint/build/release jobs were incorrectly skipped

### Fixed

- Fixed changelog fragment check to validate that a fragment is **added in the PR diff** rather than just checking if any fragments exist in the directory. This prevents the check from incorrectly passing when there are leftover fragments from previous PRs that haven't been released yet.

### Changed

- Converted shell scripts in `release.yml` to cross-platform `.mjs` scripts for improved portability and performance:
  - `check-changelog-fragment.mjs` - validates changelog fragment is added in PR diff
  - `git-config.mjs` - configures git user for CI/CD
  - `check-release-needed.mjs` - checks if release is needed
  - `publish-crate.mjs` - publishes package to crates.io
  - `create-changelog-fragment.mjs` - creates changelog fragments for manual releases
  - `get-version.mjs` - gets current version from Cargo.toml

### Added

- Added `check-version-modification.mjs` script to detect manual version changes in Cargo.toml
- Added `version-check` job to CI/CD workflow that runs on pull requests
- Added skip logic for automated release branches (changelog-manual-release-*, changeset-release/*, release/*, automated-release/*)

### Changed

- Version modifications in Cargo.toml are now blocked in pull requests to enforce automated release pipeline

### Added

- Added support for `CARGO_REGISTRY_TOKEN` as alternative to `CARGO_TOKEN` for crates.io publishing
- Added case study documentation for Issue #17 (yargs reserved word and dual token support)

### Changed

- Updated workflow to use fallback logic: `${{ secrets.CARGO_REGISTRY_TOKEN || secrets.CARGO_TOKEN }}`
- Improved publish-crate.mjs to check both `CARGO_REGISTRY_TOKEN` and `CARGO_TOKEN` environment variables
- Added warning message when neither token is set

### Added
- New `scripts/rust-paths.mjs` utility for automatic Rust package root detection
- Support for both single-language and multi-language repository structures in all CI/CD scripts
- Configuration options via `--rust-root` CLI argument and `RUST_ROOT` environment variable
- Comprehensive case study documentation in `docs/case-studies/issue-19/`

### Changed
- Updated all release scripts to use the new path detection utility:
  - `scripts/bump-version.mjs`
  - `scripts/check-release-needed.mjs`
  - `scripts/collect-changelog.mjs`
  - `scripts/get-bump-type.mjs`
  - `scripts/get-version.mjs`
  - `scripts/publish-crate.mjs`
  - `scripts/version-and-commit.mjs`

### Changed

- **check-release-needed.mjs**: Now checks crates.io API directly instead of git tags to determine if a version is already released. This prevents false positives where git tags exist but the package was never actually published to crates.io.

### Added

- **CI/CD Troubleshooting Guide**: New documentation at `docs/ci-cd/troubleshooting.md` covering common issues like skipped jobs, false positive version checks, publishing failures, and secret configuration.

- **Enhanced Error Handling in publish-crate.mjs**: Added specific detection and helpful error messages for authentication failures, including guidance on secret configuration and workflow setup.

- **Case Study Documentation**: Added comprehensive case study at `docs/case-studies/issue-21/` analyzing CI/CD failures from browser-commander repository (issues #27, #29, #31, #33) with timeline, root causes, and lessons learned.

### Fixed

- **Prevent False Positive Version Checks**: The release workflow now correctly identifies unpublished versions by checking crates.io instead of relying on git tags, which can exist without the package being published.

### Changed

- Translated all CI/CD scripts from JavaScript (.mjs) to Rust (.rs) using rust-script
- Scripts now use native Rust with rust-script for execution in shell
- Removed Node.js dependency from CI/CD pipeline
- Updated GitHub Actions workflow to use rust-script instead of node
- Updated README and CONTRIBUTING documentation with new script references

### Added
- Link.Assistant.Router prototype: Rust-based API gateway for Anthropic (Claude) APIs
- Claude MAX OAuth proxy: reads Claude Code session credentials and injects OAuth token into upstream requests
- Custom token system (`la_sk_...` prefixed JWT tokens) with issuance, validation, expiration, and revocation
- Transparent API proxying with SSE/streaming pass-through at `/api/latest/anthropic/{...}`
- Health check endpoint at `/health`
- Token issuance endpoint at `/api/tokens`
- Configuration via environment variables (ROUTER_PORT, TOKEN_SECRET, CLAUDE_CODE_HOME, UPSTREAM_BASE_URL)
- Dockerfile for single-container deployment

### Added
- Comprehensive README.md with full usage documentation, configuration reference, Docker/VPS deployment guides, and manual testing instructions
- Manual end-to-end testing script (`scripts/test-manual.sh`) that validates health check, token issuance, proxy authentication, and error handling

### Added
- Full Claude Code LLM Gateway compliance with all three API formats:
  - Anthropic Messages API (`/v1/messages`, `/v1/messages/count_tokens`)
  - Amazon Bedrock InvokeModel API (`/invoke`, `/invoke-with-response-stream`)
  - Google Vertex AI rawPredict API (`:rawPredict`, `:streamRawPredict`)
- Explicit forwarding of required headers (`anthropic-beta`, `anthropic-version`, `x-claude-code-session-id`)
- Verbose logging via `log-lazy` crate with `--verbose` flag and `VERBOSE` env var
- `UPSTREAM_API_FORMAT` environment variable to restrict accepted API format
- Case study documentation for issue #5

### Changed
- Proxy handler refactored to support multiple API format routing
- Configuration expanded with `verbose` and `api_format` fields

### Added

- Added the issue #7 case-study package under `docs/case-studies/issue-7`, including a requirement inventory, current-router gap analysis, competitor comparison, official-docs research notes, and raw research snapshots.

### Added

- **Persistent token store** with dual text (Lino) + binary backends. The
  selected backend(s) are controlled via `--storage-policy` /
  `STORAGE_POLICY` (`memory`, `text`, `binary`, or the default `both`).
  Tokens, labels, expiries, and revocations now survive process restarts.
- **Multi-account routing**. `--additional-account-dirs` registers extra
  Claude MAX credential directories alongside the primary one. The router
  distributes requests across healthy accounts and parks an account on
  cooldown when upstream returns 429.
- **OpenAI-compatible API surface**: `/v1/chat/completions`, `/v1/responses`,
  and `/v1/models`. Translates OpenAI request/response shapes to and from
  Anthropic Messages, mapping `gpt-4o`, `gpt-4o-mini`, and the `o*`
  reasoning families to the equivalent Claude tiers. Native `claude-*` IDs
  pass through untouched.
- **Live observability**: Prometheus `/metrics`, JSON `/v1/usage`, and
  per-account health at `/v1/accounts`.
- **First-class CLI** built on `lino-arguments` (clap drop-in with `.lenv`
  support): `serve`, `tokens issue|list|revoke|expire|show`,
  `accounts list`, and `doctor` subcommands. Token operations bypass the
  HTTP layer and operate directly on the configured store.
- **Admin endpoints** (`/api/tokens/list`, `/api/tokens/revoke`) plus the
  optional `--admin-key` / `TOKEN_ADMIN_KEY` Bearer gate.
- **Feature toggles** for every API surface — `--disable-openai-api`,
  `--disable-anthropic-api`, `--disable-metrics`,
  `--experimental-compatibility`.

### Changed

- `Config` is now built via `BuildArgs` and loaded from CLI flags + env +
  `.lenv` (still supports `Config::from_env()` for backwards
  compatibility).
- The HTTP server now mounts `/v1/messages*`, OpenAI endpoints, and the
  ops endpoints conditionally based on the feature toggles above.
- `proxy_handler` consults the multi-account router (when configured) and
  reports 429s as cooldowns.

### Notes

- `RoutingMode::Cli` and `RoutingMode::Hybrid` are accepted by the parser
  but currently log a warning and fall back to direct routing — the local
  Claude CLI subprocess driver is the next slice.
- Closes the `lino-objects-codec` dependency gap by hand-rolling a minimal
  Lino-style codec inside `src/storage.rs` until the upstream crate is
  published.

### Added

- Added the issue #9 case-study package under `docs/case-studies/issue-9`, including a 28-item requirement inventory, current-router gap analysis vs. OmniRoute, competitor comparison (OmniRoute / 9router / CLIProxyAPI / musistudio/claude-code-router / LiteLLM / Caveman), per-source online research notes, and raw README + metadata snapshots for each compared project.

### Fixed

- Synchronised `Cargo.lock` with the v0.6.0 version in `Cargo.toml`. The previous release commit (`chore: release v0.6.0`) bumped `Cargo.toml` but did not regenerate `Cargo.lock`, leaving the lockfile pinned to `0.5.0`. This caused `cargo package --list` in the `Build Package` CI job to fail with "files in the working directory contain changes that were not yet committed into git: Cargo.lock" because the first build re-locks the file.

### Added
- Document ForgeFed integration endpoints and deployment verification steps.
- Add Akash SDL and Kubernetes deployment templates for the router.

### Added
- Expose a minimal ActivityPub and ForgeFed actor surface for the code task actor, including inbox, outbox, followers, public key metadata, and a problemsets Follow activity document.

### Added
- Optional Gonka upstream provider selection with Gonka config, forwarding, model listing, and request signing for OpenAI-compatible routes.

### Added
- Add optional Machine Payments Protocol 402 charge challenges for OpenAI-compatible `/v1/chat/completions` and `/v1/responses` endpoints.

### Added
- Publish release Docker images to GitHub Container Registry alongside crates.io releases.

### Fixed

- Map both `CARGO_REGISTRY_TOKEN` and `CARGO_TOKEN` secrets into Cargo's native `CARGO_REGISTRY_TOKEN` environment variable in release jobs, keeping the crates.io publish fallback explicit and consistent.

### Added

- Add crates.io and docs.rs badges to the README, and include a crates.io badge/link in generated GitHub release notes.
- Extend the release workflow invariant check to verify crates.io secret fallback, GHCR publishing, and release-note crates.io links.

### Added
- Added Docker Hub publishing for `konard/link-assistant-router` during crate releases, with release notes and README badges for the Docker image.

### Changed
- Release checks now verify crates.io, Docker Hub, and GitHub release artifacts before deciding that a version is fully published.

### Fixed
- Updated the Docker builder image to track a supported Rust 1.x toolchain on Debian bookworm so release image builds can compile dependencies that use Rust 2024 edition metadata.

### Fixed
- Installed native OpenSSL build dependencies in the Docker builder stage so release image publishing can compile crates that use `openssl-sys`.

### Fixed
- Fixed GitHub release creation by removing unsupported Rust regex look-ahead from changelog section parsing.

### Added

- Added issue 31 LiteLLM compatibility research and an architecture decision
  record defining the router's LiteLLM-compatible gateway contract.
- Added `UPSTREAM_PROVIDER=openai-compatible` routing for LiteLLM and other
  OpenAI-compatible upstreams.
- Added encrypted provider storage in `<DATA_DIR>/providers.lenv` with
  `providers add|list|show|remove|import` CLI commands and `/api/providers`
  admin endpoints.
- Added `.lenv`, JSON, and indented Links-style provider imports.
- Added OpenAI SSE translation for Anthropic-backed chat and responses streams.

### Fixed

- Accepted router tokens from either `Authorization: Bearer ...` or `x-api-key`
  while stripping client credentials before upstream forwarding.
- Synchronized the root package version in `Cargo.lock` with `Cargo.toml` after
  the v0.16.0 release bump.

### Added
- Add an optional Crater ForgeFed upstream provider for OpenAI chat completions, including `Offer{Ticket}` delivery, `Accept.result` polling, SSE responses, and `TaskProvider` backend abstraction.

### Added

- Added a per-token request budget: tokens can carry an optional `max_requests`
  cap with a persisted `used_requests` counter, enforced on every upstream
  forwarding path (Anthropic, OpenAI-compatible, Gonka) with an HTTP 429
  `rate_limit_error` once exhausted. Exposed via the CLI `tokens issue
  --max-requests`, the `POST /api/tokens` `max_requests` field, and a `used/max`
  column in `tokens list`.
- Added the issue #35 case-study package under `docs/case-studies/issue-35`,
  including a full requirement trace, online research with primary sources, an
  existing-components survey (LiteLLM virtual keys/budgets, Portkey, Kong AI
  Gateway, community Claude proxies), and redacted live end-to-end evidence.

### Fixed

- Fixed Claude MAX credential reading: the router now parses the real Claude Code
  `~/.claude/.credentials.json` layout, where the OAuth token is nested under a
  `claudeAiOauth` object (`accessToken`, `refreshToken`, `expiresAt`, `scopes`,
  `subscriptionType`), in addition to the previously supported flat layout.
  `doctor` now probes the credential file and reports whether a usable token was
  found.

### Changed

- Documented the nested credential layout, transparent header injection
  (`anthropic-version` default plus the `anthropic-beta: oauth-2025-04-20` flag),
  and the per-token request budget in `README.md`, and corrected the stale note
  claiming token revocations are lost on restart (records are persisted).

### Added

- Added the issue #37 case-study package under `docs/case-studies/issue-37`,
  analyzing how to adopt the best experience from ProxyPal
  (`heyhuynhgiabuu/proxypal`) to fully support Claude, Codex, Gemini, and Qwen
  subscriptions. Includes a requirement trace (process + functional), file-level
  solution plans per requirement, an existing-components survey (CLIProxyAPI,
  ProxyPal, LiteLLM, the `oauth2`/`openidconnect` crates), online research with
  primary sources for each provider's OAuth endpoints/tokens/quotas, a deep
  inventory of ProxyPal and its CLIProxyAPI engine, and raw research snapshots.

### Added

- Multi-provider subscription support for Codex (ChatGPT), Gemini (Code Assist),
  and Qwen (DashScope), alongside the existing Claude support, adopting the best
  practices from ProxyPal. The router now reads each vendor CLI's OAuth
  credential file read-only (`~/.codex/auth.json`, `~/.gemini/oauth_creds.json`,
  `~/.qwen/oauth_creds.json`) via a unified `subscription` module and routes
  `/v1/chat/completions`, `/v1/responses`, and `/v1/models` to the correct
  upstream.
- `UpstreamProvider::{Codex, Gemini, Qwen}` selectable upstreams with provider
  aliases (e.g. `chatgpt`, `google`, `dashscope`).
- Dialect translation between OpenAI Chat Completions, the OpenAI Responses API
  (Codex/ChatGPT backend), and the Gemini Code Assist `generateContent` envelope,
  including SSE synthesis when a client requests streaming from Gemini.
- In-memory OAuth token refresh: expired Codex/Gemini/Qwen tokens are refreshed
  using each vendor's public OAuth client and cached in memory, keeping the proxy
  working even when the vendor CLI is not running. Vendor credential files remain
  read-only and secrets are never logged.
- `router doctor` now probes the Codex/Gemini/Qwen subscription credential files
  and reports whether each is present, valid, or expired.
- Rate-limit headers (`Retry-After`, `x-ratelimit-*`) from subscription upstreams
  are relayed to clients so they can back off intelligently.

### Changed

- Updated dependencies to their latest versions and built on the latest stable
  Rust (edition 2024).

### Fixed

- Codex subscription proxy now shapes `/v1/responses` (and projected
  `/v1/chat/completions`) request bodies for the ChatGPT Codex backend: the
  unsupported `max_output_tokens` parameter is stripped and a default
  `instructions` field is injected when the client omits one. Standard OpenAI
  Responses clients (e.g. OpenClaw) previously received HTTP 400
  "Unsupported parameter: max_output_tokens" / "Instructions are required".

### Added
- Codex subscriptions now send a `version` header (default `0.144.1`, overridable via
  `CODEX_CLIENT_VERSION`) when proxying to the ChatGPT backend. The backend gates newer
  models (e.g. `gpt-5.6-luna`) behind a recent client version; without the header
  `POST /responses` returns `Model not found`. This mirrors the Codex CLI so newer models
  are usable through the router.

### Added

- Provider-neutral multi-subscription pools for Claude, Codex, Gemini, and Qwen
  with strict token pins, session affinity, round-robin/fill-first/least-used
  selection, configurable per-account request caps, and `Retry-After`-aware
  quota cooldowns.
- Formal AI-style namespaced protocol routes for Anthropic, OpenAI, Codex,
  Qwen, native Gemini `generateContent`, and Vertex publisher-model requests.
- Issue #42 research and requirement trace under
  `docs/case-studies/issue-42`.

### Fixed

- Subscription requests now enforce router-token request budgets, keep
  refreshed credentials isolated per account, and preserve original request
  metadata when selecting an account before protocol translation.

- Serve the Anthropic Messages API on top of non-Anthropic upstreams. Claude Code (and any other Anthropic-dialect client) can now run against the Codex, Qwen, Gemini, and OpenAI-compatible providers: requests are translated to the provider's own dialect, delegated to that provider's existing forwarder, and the reply is translated back — including streaming, tool calls, and images.
- Add `--bridge-model` / `ANTHROPIC_BRIDGE_MODEL` to pick the upstream model used for bridged Anthropic requests (per-provider default otherwise).
- Answer `POST /v1/messages/count_tokens` locally for bridged upstreams with a documented estimate.

- Added `docs/use-cases/`: one document per supported scenario — per-task tokens, audit/monitoring, Claude MAX inside Codex CLI, ChatGPT/Qwen/Gemini/LiteLLM inside Claude Code — plus per-CLI configuration guides for Claude Code, Codex CLI, Qwen Code, Gemini CLI, opencode and Grok CLI, and an explicit non-support note for Cursor CLI. Linked from `README.md`, which now also documents `--bridge-model` and `--audit-log`.

- Require a valid router token for `POST /v1/messages/count_tokens` when the request is served locally by the Anthropic bridge; expired or revoked tokens no longer receive an estimate (the per-token request budget is still not consumed, since nothing is spent upstream).

- Prepend the Claude Code identity system block to Anthropic upstream requests backed by a Claude subscription OAuth credential. Without it `api.anthropic.com` rejects non-Claude-Code clients with a misleading `429 rate_limit_error`, which broke the documented "Claude MAX inside Codex" use case (`/v1/responses`) and any Anthropic SDK or `curl` client on `/v1/messages`. The change is idempotent for Claude Code's own requests, keeps the caller's system prompt, and never alters API-key traffic.

- Added `docs/use-cases/self-hosting.md` for running the router as an internal component of personal or corporate infrastructure: deployment shapes (local process, Docker, corporate host), what lives on disk and what to back up, and — stated up front — the fact that `POST /api/tokens` is open to any caller that can reach the port unless `TOKEN_ADMIN_KEY` is set, while the default bind address is `0.0.0.0`. Backed by `experiments/issue-45/test-deployment-hardening.sh`, which asserts the admin surface's behaviour in Docker without a subscription or upstream egress.

- Added a REST login API so a deployment can be authorized without a pre-existing credential file ([#47](https://github.com/link-assistant/router/issues/47)): `POST /api/login` starts the Claude Code CLI on a real PTY inside the deployment and returns the authorization URL it printed, `POST /api/login/{id}/code` types the human's code into that **same, still-running** process, `GET /api/login/{id}` reports `awaiting_code` / `authorized` / `failed` / `expired`, and `DELETE /api/login/{id}` cancels a pending login. Because a human opening a browser is slow, the session outlives the request that created it: the router keeps a registry keyed by `login_id` with a generous TTL (`--login-session-ttl-secs`, default 900s), a cap on simultaneously pending logins (`--login-max-sessions`, default 4, `429` beyond it), and an explicit kill of the process on every terminal path — success, failure, cancellation and expiry. The endpoints are admin endpoints (`TOKEN_ADMIN_KEY`) and can be removed entirely with `--disable-login-api`. On success the obtained credential is written in the layout `OAuthProvider` reads and the proxy's cached token is refreshed, so the next request works without a restart; `CLAUDE_CODE_HOME` is write-probed *before* the URL is returned so a read-only mount fails immediately rather than after the human has finished. The published image now ships the Claude Code CLI and Node, which the flow needs to have something to drive. Documented in `docs/use-cases/remote-login.md` and covered end to end by `tests/login_flow_test.rs` (7 passed), which drives the flow against `examples/fake-login-cli.sh`, a stand-in TUI that repaints, waits on stdin and prints an `sk-ant-oat…` token.

### Added

- Router-driven refresh for Claude subscription tokens. An expired
  `~/.claude` access token is now renewed by exchanging the `refreshToken`
  from the nested `claudeAiOauth` block against Anthropic's token endpoint,
  the same way `src/refresh.rs` already handled Codex, Gemini, and Qwen. The
  result is kept **in memory only**, so a container whose `CLAUDE_CODE_HOME`
  is mounted read-only keeps working past expiry without a Claude CLI inside
  the image (#48).
- A `with-claude-cli` image variant that layers Node.js and the Claude Code
  CLI on top of the runtime image, published on each release as
  `:with-claude-cli` and `:<version>-with-claude-cli` on both GHCR and Docker
  Hub. It makes a first-time `claude /login` possible from inside a
  container; the default image stays minimal.

### Documentation

- README and `docs/use-cases/self-hosting.md` now state which credential
  operations work with a read-only `CLAUDE_CODE_HOME` mount (serving
  requests, renewing an expired token) and which need a writable one plus the
  CLI (first-time login), and include a derived-image recipe for adding the
  CLI to the published minimal image.

### Security

- The `/api/tokens*` admin surface is **closed by default**
  ([#49](https://github.com/link-assistant/router/issues/49)). Previously
  `is_admin_authorised` returned `true` whenever `TOKEN_ADMIN_KEY` was unset, so
  a deployment that had not configured an admin key answered `200` to an
  unauthenticated `POST /api/tokens` — anyone who could reach the port could
  mint a token that spends the subscription and list every token already issued.
  The default bind address is `0.0.0.0`, so in a container with a published port
  that was reachable from outside the host. An unauthenticated admin request is
  now `401`.
- The flat `TOKEN_ADMIN_KEY` is compared with a constant-time digest comparison
  instead of `==`, so a wrong key no longer leaks how many bytes matched.

### Added

- Admin access is now modelled as a **scoped token** rather than a flat shared
  secret. An admin credential is an ordinary `la_sk_…` JWT carrying
  `"scope": "admin"`, validated on the same code path as every other token, so
  it has an identity (`sub`), an expiry, a record in `tokens list`, and full
  revocation semantics.
- `tokens issue --admin` (CLI) and `{"scope": "admin"}` on `POST /api/tokens`
  (HTTP) mint one.
- Rotation in a single step — mint the replacement and revoke the credential
  that asked for it: `tokens rotate <sub>` (CLI) and `POST /api/tokens/rotate`
  (HTTP). The flat key has no subject to revoke, so it cannot rotate itself and
  gets `400`.
- When no admin credential is configured, the router generates one on first
  start, prints it once (`Admin token (shown once, store it now): la_sk_…`) and
  persists its record — a fresh deployment is usable without being open.
- `--allow-anonymous-admin` / `ALLOW_ANONYMOUS_ADMIN` explicitly restores the
  historical open behaviour for deployments that depend on it. It warns at
  startup, and `doctor` reports the admin surface as `OPEN` when it is set.

### Changed

- The flat `--admin-key` / `TOKEN_ADMIN_KEY` keeps working unchanged as a
  bootstrap and compatibility credential — it is the only way to provision the
  first credential in a deployment configured entirely from the outside.
- `tokens list` gained a `scope` column (`client` for ordinary tokens).

### Documentation

- README gained an *Admin access* section and rows for `/api/tokens/rotate`,
  the `scope` field and `--allow-anonymous-admin`;
  `docs/use-cases/self-hosting.md` and `docs/use-cases/remote-login.md` now
  describe the closed default and the bootstrap token instead of the open one.

### Added

- Added an opt-in admin UI ([#50](https://github.com/link-assistant/router/issues/50)): a minimal React console built on **Chakra UI v3** (Horizon UI as a visual reference only, not a v2 fork), built with Vite and embedded in the binary with `rust-embed`, served by the router on a **separate listener that does not exist unless you give it a port** — `--admin-port` / `ADMIN_PORT`, bound independently of the proxy via `--admin-host` / `ADMIN_HOST` (default `127.0.0.1`), so the proxy can face the network while the console stays on loopback. The admin credential is either provisioned at deploy time (`TOKEN_ADMIN_KEY`, which closes bootstrap from the start) or **claimed by the first browser visit** through a two-phase handshake that cannot brick the deployment: `POST /api/admin/bootstrap` mints a candidate token and a `claim_id` while persisting nothing and authorising nothing, the client writes the token to `localStorage` and **reads it back**, and only `POST /api/admin/bootstrap/confirm` — authenticated with that freshly stored token itself — activates the credential and closes bootstrap. An unconfirmed candidate expires after `--admin-claim-ttl-secs` (default 120s) leaving the system unclaimed and the mint retryable; only one candidate is outstanding at a time so the first to *confirm* wins and the loser's candidate is discarded; and when the storage read-back fails the client deliberately does **not** confirm, showing the token for manual copy and leaving bootstrap open. Only the SHA-256 digest of the active credential is persisted (`<data-dir>/admin-claim.json`). The console lists tokens (id, label, issued, expires, used/max requests, revoked), issues them (label, TTL, optional request cap, optional account pin) showing each value exactly once, revokes behind a confirmation dialog, rotates the admin credential, and reports read-only status (`/v1/accounts`, `/v1/usage`, doctor-style credential state); `doctor` now prints `admin_ui` and `admin_credential`. The `localStorage` exposure risk is documented in `docs/use-cases/admin-ui.md`. Covered by `tests/admin_ui_test.rs` (12 passed) driving the real admin router end to end plus 10 unit tests in `src/admin.rs`, including that a mint alone neither authorises nor closes bootstrap, that an expired candidate leaves the system unclaimed, and that only the first confirmer wins.

### Security

- Ran a deliberate security review over the surface added by [#47](https://github.com/link-assistant/router/issues/47), [#49](https://github.com/link-assistant/router/issues/49), [#50](https://github.com/link-assistant/router/issues/50) and [#51](https://github.com/link-assistant/router/issues/51) ([#52](https://github.com/link-assistant/router/issues/52)), and wrote the pass down — threat model, every checklist item, **and what was found to be fine** — in `docs/security/review-2026-08.md`. Four findings were fixed, each with a regression test in `tests/security_review_test.rs` or beside the code:
  - The admin listener now sends `Content-Security-Policy` (`frame-ancestors 'none'`, `script-src 'self'`, `form-action 'none'`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer` on **every** response — API, embedded UI assets, and the auth middleware's own refusals — because the console keeps its credential in `localStorage` and its revoke/rotate actions are one click (`src/security_headers.rs`).
  - Login transcript excerpts are now redacted before they are truncated, so a login that fails *after* `claude setup-token` printed the paid-account credential can no longer return it in an error string; the pasted authorization code is removed too (`login_url::redact_secrets`, `login_url::redact_value`).
  - The login and chat session registries are now bounded: terminal login sessions are evicted after a 300 s retention window and an expired session drops its PTY (killing the child), while chat sessions — keyed by an *unauthenticated* platform user id — are pruned on every message with a 1 h idle TTL and a 512-entry cap that evicts strangers before authenticated conversations.
  - `/v1/usage` and `/v1/accounts` now require an admin credential on the network-facing proxy port, where `ENABLE_METRICS` defaults to on; they disclosed token ids, labels and credential filesystem paths to unauthenticated callers. `/metrics` stays open on purpose (aggregate counters only).

### Added

- Added a `Dependency Audit` CI job running `cargo audit` and `npm audit --audit-level=high` over the admin console toolchain. It deliberately does not gate `build`, so a newly published advisory against an unchanged tree raises a red check instead of blocking an unrelated release.

### Added

- **Optional Telegram and VK admin bots** (issue #51): administer the router
  from a private chat — `/status`, `/tokens`, `/issue`, `/revoke`, `/rotate`.
  Both channels are off unless a bot token is configured
  (`TELEGRAM_BOT_TOKEN`, `VK_BOT_TOKEN` + `VK_GROUP_ID`), each is independent,
  and both poll outward (Telegram `getUpdates`, VK Bots Long Poll), so no
  inbound port or webhook is required.

- **One system-wide admin claim across every channel**: the bots share
  `AdminClaim` with the web UI, keeping its two-phase shape — `/start` mints a
  candidate that authorises nothing, `/confirm <token>` activates it. A claim
  made in a browser closes `/start` in chat and vice versa, a `TOKEN_ADMIN_KEY`
  deployment starts already claimed, and a mint that never arrives leaves the
  router claimable.

- **New settings**: `--telegram-bot-token`, `--vk-bot-token`, `--vk-group-id`,
  `--chat-admin-secret-ttl-secs` (default `120`),
  `--chat-admin-rate-limit-per-minute` (default `5`), each with the matching
  environment variable. `doctor` now reports `telegram_admin_bot` and
  `vk_admin_bot`.

- **Documentation**: [docs/use-cases/chat-admin-bots.md](../docs/use-cases/chat-admin-bots.md)
  covers enabling a channel, the shared claim, the command set and the
  secret-handling rules.

### Security

- Chat commands are parsed **only** in 1:1 conversations: Telegram requires
  `chat.type == "private"` (bots and senderless messages are dropped too), and
  VK requires `peer_id == from_id` below the multi-user chat offset. Group
  traffic never reaches the command parser.
- A message carrying a credential is sent on its own and deleted after
  `--chat-admin-secret-ttl-secs`; token **values** are never echoed by listings.
- A platform user id is only a cache for a presented credential — every command
  re-validates it, so revoking or rotating signs the chat user out at once — and
  `/start`, `/auth`, `/confirm`, `/issue` and `/rotate` are rate limited per
  user. `--allow-anonymous-admin` does not open a chat channel.

### Fixed

- Recognize the `claude.com` authorization URLs emitted by current Claude Code CLI releases so `POST /api/login` can return the URL instead of timing out.

### Fixed
- Copy the embedded admin UI bundle into Docker builds and verify the default image in CI before releasing.

Fix release versioning to keep `Cargo.lock` synchronized with `Cargo.toml`, make Cargo commands reject stale lockfiles, and eliminate deprecated-action and dependency-audit CI warnings.

### Changed

- `POST /api/login` now defaults to Claude Code's TUI `/login` flow and its
  full OAuth scope set. The PTY driver recognizes first-run theme and workspace
  trust screens, waits for the prompt before typing `/login`, and selects the
  Claude subscription method without sending blind input to unknown screens.

### Documentation

- Document all scopes requested by TUI `/login` and by the narrower,
  long-lived `setup-token` alternative. Operators can retain the latter with
  `LOGIN_CLI_ARGS=setup-token` or `--login-cli-args setup-token`.

### Fixed

- Submit Claude TUI authorization codes as bracketed paste and wait for the input to settle before pressing Enter, preventing long codes from being corrupted.
- Report the CLI's OAuth rejection immediately and distinguish it from a genuine login timeout.

### Added
- Add `clients list|setup|show|remove|doctor` for safely configuring Codex CLI and Claude Code against the router.

### Added

- Discover all healthy vendor subscriptions by default, union their advertised models, and route requests to the subscription that owns the requested model. `UPSTREAM_PROVIDER` still pins a deployment when set explicitly.

### Fixed

- Translate Responses API developer/system turns and typed text/image content into Anthropic Messages format, allowing Codex CLI requests to use Anthropic subscriptions.

### Fixed
- Reject unknown model IDs on Anthropic-backed OpenAI endpoints with `404 not_found_error`, keep aliases explicit, and report the model that actually served successful buffered and streaming responses.

### Fixed

- Discover subscription model catalogs from provider APIs, cache the last known lists, and route newly released models without a router update.

### Added
- Extended `clients` setup, status, removal, and diagnosis across every documented CLI plus Link.Assistant Agent, with explicit pre-request gating diagnostics for Cursor and Gemini CLI.

### Fixed

- Assemble non-streaming ChatGPT subscription responses from their streamed output events, always send `store: false` to that backend, and omit deprecated `temperature` values from Claude 5 requests.

### Fixed

- Refresh expired subscription credentials before routing or catalog discovery, report active-provider catalog failures in `doctor`, and remove unsupported `temperature` values from ChatGPT subscription requests.

### Fixed

- Normalise a string `input` on `/v1/responses` into the typed single-turn list the ChatGPT backend requires, so both documented forms work again instead of drawing `Input must be a list` (HTTP 400).
- Treat `expiresAt` as a hint rather than a verdict: a stamped-expired credential stays routable until an upstream actually rejects it (HTTP 401/403), catalog refreshes are attempted with it and fall back to the last known models on failure, and `doctor` reports `invalid_grant` refresh failures as "re-authenticate" instead of "expired".

### Added

- Add provider-aware authorization for Claude and Codex: `auth` CLI commands, Codex PKCE loopback login with strict state and listener lifecycle handling, provider status, and `POST /api/login` support for `{"provider":"codex"}`.

### Added

- Added port-free Codex device authorization as the default CLI and HTTP login flow, while retaining loopback login as an explicit CLI fallback.

### Fixed
- Convert Codex subscription Responses JSON and SSE back into the Chat Completions shape requested through `/v1/chat/completions`, including token usage and returned tool calls.

### Fixed
- Publish and verify native `linux/amd64` and `linux/arm64` manifests for the default and Claude CLI Docker image variants on GHCR and Docker Hub.

### Fixed

- Translate tool definitions, calls, and results from Anthropic and Chat Completions requests into the native Responses format required by Codex subscriptions.

### Fixed

- Require a valid client token before returning live model catalogs from `/v1/models` and its provider aliases.

### Fixed
- Emit named Responses SSE frames with the complete output-item lifecycle for Claude-backed streams so Codex clients can render replies.

### Fixed

- Codex subscription requests with `max_output_tokens`, `max_tokens`, or
  `max_completion_tokens` are now rejected clearly before reaching the
  ChatGPT backend, instead of silently discarding the caller's output and
  spend limit.

### Added

- Log every client and transformed upstream HTTP exchange to a redacted, correlated JSONL file with a configurable 100 MiB default bound.

### Fixed

- Let `RUST_LOG` override the fallback `info` or `debug` directive.

### Fixed
- Relay vendor quota and request-id response headers consistently across Claude and subscription providers without exposing upstream credentials.

### Added

- Add client-boundary integration coverage through deterministic Anthropic and Codex upstreams.

### Fixed
- Stop advertising and routing models from subscriptions rejected during live catalog discovery, and mark fallback-backed model lists explicitly.

### Fixed

- Anthropic Messages requests can use Codex subscription models again: the
  protocol-required `max_tokens` field no longer triggers the rejection kept
  for optional Responses and Chat Completions output limits.

### Fixed

- Build release images for AMD64 and ARM64 in parallel on native GitHub runners,
  cache each architecture, and merge their digests without QEMU emulation.

### Changed

- Publish crates and GitHub release notes before building Docker images, then build the runtime and Claude CLI variants in parallel with persistent BuildKit caches.

### Fixed

- Backfill missing GitHub Releases and fail release and scheduled reconciliation runs whenever a default-branch version tag has no GitHub Release.

### Changed

- Authorize Claude subscriptions with native PKCE OAuth, download the vendor CLI into a disposable bun cache only as a fallback, and publish one container image per architecture without bundled vendor packages.

### Fixed

- Match Claude Code's native OAuth state entropy and current token endpoint, and make the disposable CLI fallback use its dedicated subscription login command without entering first-run TUI onboarding.

### Fixed
- Return a failing status for unsupported `auth --flow` values and document each provider's supported flows.

### Fixed

- Persist and consume Claude PKCE login state so `auth claude --code` redeems the authorization it was issued for without starting a different login.

### Fixed
- Relay upstream vendor quota and request-ID headers through translated Responses and Chat Completions endpoints.

### Fixed
- An orphan tag from an earlier run no longer blocks the current release's Docker images: the release run's `check-github-releases.rs` guard is now scoped to the version it just published (`--release-version`), while unrelated historical orphans are reported as warnings (`--historical-orphans warn`)
- Pre-existing release drift is reported *before* the GitHub release is created, so the run can no longer leave a published release without images
- The guard's message now names the remediation for each orphan tag (create the release or delete the tag)

### Changed
- The scheduled `verify-releases` workflow keeps failing hard on any default-branch tag without a GitHub Release

### Fixed

- Cache terminal OAuth refresh failures per subscription, serialize concurrent refreshes, and exponentially back off transient failures so rejected credentials cannot storm vendor token endpoints.

### Security

- Remove token and account identities from public Prometheus metrics, authenticate requests before automatic model routing, and hide token parser details from client error responses.

### Security

- Redact secret environment values from CLI help output.

### Fixed

- Accept documented boolean environment spellings, reject invalid configuration values and unknown token IDs, advertise provider-specific OAuth flows, and keep optional global settings out of required-argument usage lines.

### Fixed
- Return JSON parse and Messages validation errors in the requesting API dialect.
- Preserve terminal usage in translated streams and implement Chat Completions `include_usage` chunks.
- Hide Codex subscription metadata and malformed upstream bodies while retaining safe quota headers.
- Disclose when Codex cannot enforce the required Anthropic `max_tokens` field.

### Security

- Redact credentials in request-log query strings, camelCase and common secret fields, unlisted credential headers, and values shaped like known tokens or JWTs.
- Create request logs with owner-only permissions on Unix and repair permissive modes on existing logs.

### Fixed

- Requests larger than the 10 MiB logging buffer now continue to their handler with the body omitted from the log instead of being rejected with `413 Payload Too Large` by observability middleware.

### Fixed
- Prevent concurrent requests from corrupting dual token stores or losing usage counts, and report storage failures as server errors instead of rate limits.

### Fixed

- Persist token state as official Links Notation and a native file-mapped doublets graph, with automatic migration from the legacy hand-built text and `LARTOK01` JSON formats.

### Fixed

- Fail Docker releases unless GHCR grants an anonymous pull token, ensuring the published router package is public.

### Added

- Measure Rust line coverage in CI, enforce a reviewable non-decreasing baseline on one Linux runner, and ratchet the project toward an 80% floor.

### Fixed
- Keep automatic model routing catalog-owned, prefer vendor namespaces for catalog collisions, and reject ambiguous unqualified model names instead of silently selecting Claude.

### Security

- Replace the authenticated upstream catch-all with an explicit inference-route allowlist.
- Authenticate client and proxy-admin routes before body parsing or provider discovery.
- Create and repair audit logs with owner-only permissions on Unix.

### Documentation

- Publish the issue #149 network, data-flow, storage, dependency, and release security review.

### Added

- Split request exchanges into SHA-256-keyed per-token directories with identity metadata and independent retention budgets.

### Changed

- Partially redact long credentials with one stable masking rule while continuing to fully mask short secrets.

### Security

- Keep unauthenticated traffic isolated and create request-log directories and files with owner-only permissions on Unix.

### Added

- Add `link-assistant-router with <client>` and the standalone `with-router`
  launcher with isolated temporary configuration, pass-through arguments,
  edit-aware global undo, deterministic remote-server selection, shared
  stateful Docker lifecycle, and automatic per-run token minting and cleanup.

### Fixed
- Configure OpenCode, Qwen Code, and Agent with models from the router's authenticated live catalog instead of a hardcoded Claude model, while preserving user model choices.
- Make client diagnostics probe an advertised model owned by the expected subscription and report unavailable catalog models clearly.
- Keep Grok CLI usable with Codex subscriptions by dropping its unavoidable Chat Completions output cap before forwarding.

### Security
- Stop printing router tokens during client setup; write shell exports to a mode-`0600` environment file instead.

### Added

- Add persisted per-token actual token-spend caps and one-minute request rate
  limits, enforced independently across every supported upstream.
- Document household and small-team subscription sharing, the precise
  isolation boundary, diagnostic request-log content, and ordinary token
  expiry and rotation.

### Changed

- Rotate ordinary tokens as well as admin tokens while preserving their
  account binding and containment controls.

### Added
- Added native server-side web tool translation across Anthropic Messages, OpenAI Chat Completions, and Responses, including tool identity and usage accounting.
- Added opt-in GitHub REST/GraphQL credential proxying with policy-controlled destructive operations, a hardened reverse-SSH tunnel image, and optional real-client smoke tests.
- Added configurable proxy request-body limits independent of bounded request logging.

### Changed
- Updated managed client defaults, reasoning levels, model catalogs, diagnostics, argument boundaries, and cleanup behavior for Claude Code, Codex, Gemini, Qwen, Grok CLI, and Cursor.
- Hardened native and container release workflows with immutable action pins, reproducible native artifacts, checksums, SBOMs, and provenance attestations.

### Fixed
- Preserved function/tool call IDs, prior tool history, actual served models, quota headers, dialect-specific errors, stop sequences, and streaming SSE state across protocol bridges.
- Made text, binary, and dual token storage safe across concurrent processes with advisory locking, atomic durable writes, and crash-recovery journaling.
- Corrected Cursor protocol documentation and removed obsolete router-generated warning headers.

### Security
- Prevented caller GitHub credentials and upstream plan/entitlement metadata from crossing trust boundaries while retaining safe rate and consumption headers.

### Changed
- Updated the reviewed Rust dependency set and migrated provider-secret encryption to the current RustCrypto AEAD API.

### Changed
- Updated the reviewed GitHub Actions set and its pinned-runtime contract checks.

### Fixed
- Generate release SBOMs under the filename consumed by packaging, persist OCI attestation metadata without warnings, and avoid download-artifact's known Node deprecation warning.
- Treat every non-documentation build input as code, build and verify the embedded admin UI in CI, and prevent release-capable workflow runs from being cancelled midway.
- Split the admin UI vendor bundle so production builds remain below Vite's chunk-warning threshold.
- Exclude archived development evidence from source-file size enforcement.
- Configure Git's default branch in standalone release reconciliation so checkout stays warning-free.

### Changed
- Updated all active Rust and admin UI dependencies to their latest stable releases, including jsonwebtoken 11, React 19.2.8, and Vite 8.
- Raised the minimum supported Rust version to 1.88, aligned CI on Rust 1.97.1, and moved container builds and runtime images to Debian 13 (Trixie).
- Added weekly grouped Dependabot updates for the admin UI, upgraded the pre-commit hooks to v6, and made the full hook suite pass without rewriting archived evidence or generated bundles.

### Fixed

- Codex subscriptions now honor `max_output_tokens`, `max_tokens`, and
  `max_completion_tokens` instead of answering HTTP 400. The field is still
  stripped from the ChatGPT request (the backend rejects it), and the router
  enforces the cap locally: visible output is truncated and the exchange ends
  with `finish_reason: "length"` (Chat Completions) or
  `status: "incomplete"` with `incomplete_details.reason: "max_output_tokens"`
  (Responses). This unblocks OpenCode, Grok CLI and `@link-assistant/agent`,
  which all send an output cap on every request. The budget is estimated at
  ~4 characters per token and hidden reasoning tokens are not observable, so
  the cap bounds visible output rather than billed tokens.
- Responses and Chat Completions keep the requested model id — including
  catalog aliases such as `codex-auto-review` — in `model` for buffered and
  streamed replies on every OpenAI surface. The concrete model the provider
  served is reported separately in the `x_router_upstream_model` body field
  and the `x-router-upstream-model` response header, instead of replacing the
  identity the caller selected.

### Added

- The native Gemini namespace (`/api/gemini/v1beta/...`) now serves every connected subscription. `GET /api/gemini/v1beta/models` returns the same live union as `/v1/models`, and `generateContent` / `streamGenerateContent` route each model to its owning vendor, so Gemini CLI can run on a Codex or Claude subscription with one router JWT and no Gemini credential. Previously these routes required `UPSTREAM_PROVIDER=gemini` and returned `{"models":[]}` or `no healthy gemini credential is available` otherwise.
- `UPSTREAM_READ_TIMEOUT_SECS` (default `120`, `0` disables) bounds how long the router waits for the next byte from an upstream.

### Fixed

- Requests offering only server-side tools (`web_search`, `web_fetch`) together with a forced tool choice (`tool_choice: {"type":"any"}` or `"required"`) are now refused with a fast `400` on the Anthropic, Chat Completions and Responses surfaces. Such a request cannot be satisfied — the backend executes those tools itself and never emits a function call — and previously left the client waiting indefinitely.
- `generationConfig.maxOutputTokens` now works on every model reachable through the native Gemini namespace: Gemini and Claude enforce it upstream, and Codex-owned models inherit the router's local emulation, so the answer arrives truncated with `finishReason: "MAX_TOKENS"` instead of being refused.
- The shared upstream HTTP client had no timeout at all, so a silent backend stalled a request forever; reads are now bounded.

### Fixed
- Release images now label `org.opencontainers.image.revision` with the commit the release tag resolves to instead of the merge commit that triggered the run, so the published image proves which source it was built from.
- Release checksum files list flat asset names, so `sha256sum -c` works in the directory `gh release download` writes to.

### Added
- Every packaging job checks out the resolved release commit by SHA and fails if the workspace is not that commit.
- `scripts/check-release-provenance.rs` guards published releases after publication — it re-resolves the annotated tag and compares it against both platform manifests in both registries, the checksum files, and the build attestations of the downloadable archives. The scheduled reconciliation workflow re-runs the same guard daily.

### Changed

- The first-visitor admin claim — in the web UI, in Telegram and in VK — now
  mints an ordinary admin-scoped `la_sk_…` JWT with `sub`, `iat`, `exp`,
  `label` and `scope: "admin"` instead of an opaque `la_admin_…` value stored
  as a digest. There is one administrator credential model: the claimed
  credential lists, expires, revokes and rotates like any other token.
  The two-phase anti-bricking handshake is unchanged — the candidate is minted
  already revoked, so an undelivered mint authorises nothing — and the
  first-claim lock stays shared by the web UI and both chat channels.
- `POST /api/admin/bootstrap` and `POST /api/admin/rotate` accept an optional
  `{"ttl_hours": n}` body so the administrator can limit the credential
  lifetime (capped at one year). Rotation mints the replacement and revokes the
  previous credential by id under the claim lock.
- Confirming a claim retires the startup `bootstrap-admin` token by id, so the
  Tokens table, the CLI and the bots show it as revoked instead of leaving a
  row that looks active but answers `401`.

### Fixed

- An administrator credential now reaches the model surfaces as well as the
  admin API: `scope=admin` is a superset of client access, so the claimed
  credential and `TOKEN_ADMIN_KEY` no longer answer `401 invalid token` on
  `/v1/models` while succeeding on `/api/tokens/list`.

### Migration

- Deployments claimed by an earlier version keep their opaque `la_admin_…`
  credential; it continues to authorise, `doctor` prints a warning naming it,
  and the first `/api/admin/rotate` converts the claim into a JWT.

### Added

- Release now publishes attested, checksummed `darwin-arm64` and `darwin-amd64` binaries alongside the Linux archives, with a documented install/update path in the README
- `clients setup` accepts an existing router token via `--token-stdin` or the documented `LINK_ASSISTANT_ROUTER_TOKEN` (alias `LINK_ASSISTANT_TOKEN`) variable, so tokens no longer need to appear in argv
- `clients --home DIR` runs the whole setup/show/doctor/remove lifecycle against an isolated configuration root that ignores real user settings and ambient token variables
- A macOS release job runs the host CLI lifecycle against a remote router through an SSH-forwarded localhost port

### Fixed

- Client diagnostics are redacted, so router error bodies or transport errors can no longer echo a router token

### Fixed
- `clients remove` now revokes the router token that `clients setup` minted before deleting the local credential file. Previously the file disappeared while the token stayed valid, so any copy of it kept working access to the router (issue #190).

### Added
- `clients setup` records secret-free credential metadata (`<client>.credential.json`, mode 0600) describing whether the token was minted or supplied and which token record it is.
- `clients remove --revoke-supplied` also revokes an operator-supplied token; without it, supplied tokens are left alone.
- `clients remove --force` deletes the local settings even when revocation fails. Without it, a failed revocation keeps the credential file, prints recovery instructions, and exits nonzero instead of reporting successful removal.

### Fixed
- Release provenance verification no longer fails for every published binary and SBOM. `actions/attest-build-provenance` records the commit the run started from, and the `chore: release vX.Y.Z` commit is created later by the same run, so the attestation can never name it. The guard now accepts the release commit or exactly its parent, and still rejects an artifact attesting any unrelated commit.

### Fixed
- A per-token `max_tokens` cap can no longer be overshot by a single response. The router now reserves each request's declared output budget before dispatching it and settles the reservation against the usage the provider actually reported, so a request whose budget cannot fit is rejected up front instead of completing and pushing the persisted total past the cap. Reservations are taken inside the same atomic read-modify-write that counts the request, so concurrent requests cannot overshoot together, and they are released when a request fails, is cancelled, or reports no usage. Enforcement covers Responses, Chat Completions, Anthropic Messages, Gemini, Gonka, Crater, and every OpenAI-compatible provider.

### Added
- `tokens list` shows reserved spend alongside actual spend, and reservations orphaned by an unclean shutdown are released at startup.

### Added
- The web, Telegram and VK admin surfaces now manage every token constraint the CLI and HTTP APIs support. The Chakra issue form gained token-spend and requests-per-minute fields, and the token table shows spend, reserved budget, rate limit, account pin and expiry alongside a per-token Rotate action.
- Chat commands accept every control through `key=value` options (`label`, `ttl_hours`, `max_requests`, `max_tokens`, `rate_limit_per_minute`, `account`) while keeping the documented positional short form, and gained `/show <id>` for a token's full constraint and usage detail plus `/rotate-token <id>` to reissue a token while preserving its limits.
- `POST /api/tokens/rotate-client` reissues one client token by id, preserving every constraint that is not explicitly overridden and revoking the previous value. `tokens rotate` gained matching `--max-requests`, `--max-tokens`, `--rate-limit-per-minute` and `--account` flags.

### Fixed
- Token constraint bounds are validated once and shared by the CLI, HTTP and chat surfaces, so the same input is no longer accepted on one surface and rejected on another. Zero-valued caps and non-positive TTLs are refused everywhere rather than minting a credential that can never serve a request.

### Fixed
- The published runtime image can now run the documented `setup-token` login. `POST /api/login` with `LOGIN_CLI_ARGS=setup-token` returned HTTP 502 (`Unable to spawn claude … No viable candidates found in PATH`) because the narrow mode still drove the absent vendor CLI. Both login modes now run as in-process OAuth, so one published image serves the full Claude Code scope set and the narrow `user:inference` alternative without a rebuild or a vendor binary.

### Added
- `POST /api/login` accepts a `mode` field (`full` or `setup-token`) and `auth claude` accepts a matching `--mode`, so the scope set is selectable per request rather than only per deployment. `LOGIN_CLI_ARGS=setup-token` continues to select the narrow mode as a deployment default.
- `doctor` reports whether each login mode is available and which scopes it would request, before a login is started. `LOGIN_CLI_COMMAND` remains the only configuration that spawns a process, and is the only one that can be reported unavailable.

### Changed
- **All routing now derives from live provider catalogs.** The bundled fallback catalogs, the per-provider bridge defaults, the OpenAI→Claude alias table, the static `/v1/models` listing, and the built-in client default models have been removed from production code. A catalog exists only after a successful authenticated discovery for that exact account, and is recorded with the account identity, fetch time and explicit health.
- A provider that has not completed a live discovery advertises nothing and is reported under `degraded_providers` in `GET /v1/models`. A revoked or missing credential stops exposing its models for routing while the last known catalog stays visible to administrators.
- Cross-protocol bridge models are chosen from the healthy account's live catalog under a deterministic, operator-configurable policy (`--bridge-model-policy` / `BRIDGE_MODEL_POLICY`: `first-advertised` or `last-advertised`). When no compatible model exists the request fails with `model_selection_required` instead of silently substituting a source-code constant.
- Client setup and `router with <client>` resolve the concrete model from the authenticated catalog at execution time, choosing by catalog owner rather than by a model name compiled into the router.

### Added
- A regression test suite driven entirely by synthetic model names, plus a guard that fails the build if a vendor model catalog reappears in production sources.

### Fixed
- A rate-limited token refresh no longer marks a subscription permanently revoked. Refresh failures were classified by searching the response body for `invalid_grant` with the HTTP status discarded, so a `429` — or any body that merely mentioned the string, such as a proxy error page — put the subscription into a terminal state that only a re-login or a restart could leave, while telling the operator that "waiting will not help" precisely when waiting was the fix.

  A failure is now terminal only when a client-error status (`400`, `401`, `403`) is paired with a *parsed* OAuth error code from a small allowlist. Rate limits, `5xx` responses, timeouts and connection errors are all retried with the existing exponential backoff, and never record rejection evidence that would drop the provider out of routing.
- A rate-limited refresh honours the endpoint's `Retry-After` (both the delta-seconds and HTTP-date forms), waiting the longer of that value and the router's own backoff.
- Tokens are refreshed shortly before expiry rather than only after a request has already failed, so an access token no longer lapses mid-flight. A still-valid cached token is preferred over an expired one when a refresh is unavailable.
- The README's CI badge reported "failing" while `main` was green. The legacy `/workflows/<name>/badge.svg` URL is not branch-scoped, so it showed the newest run on *any* branch — including in-flight pull requests. It now reports `main` explicitly.
- The Rust version badge advertised 1.70+ while `Cargo.toml` declares 1.88 (edition 2024). It now reads `rust-version` from the manifest, so it cannot drift again. Both are covered by tests that fail against the previous badges.

### Fixed
- A subscription whose access token the vendor invalidated *early* is now recovered instead of being reported as dead. The decision to refresh came from the token's own `exp` claim, so a credential the vendor had already rejected was served until it failed: a `401` was recorded as evidence and the failure returned to the caller, even though one refresh call restored the subscription completely. A `401` from a resource endpoint now triggers a refresh and a single replay of the request, regardless of what `exp` says. Concurrent rejections share one refresh, a revoked credential is still exchanged only once, and a second `401` is surfaced rather than looped.
- The model-catalog refresh recovers the same way, so a rejected credential no longer leaves the catalog empty until restart.
- `auth status` probes the vendor instead of inferring from the stored timestamp. It reported `usable` throughout an outage in which every request through that credential returned `401`; it now reports `usable`, `rejected`, `unverified` or `absent`.
- Rotated refresh tokens are written back to the credential file. Vendors issue a replacement and spend the old one, so keeping it only in memory made the next start replay a spent token — turning a transient failure into a mandatory re-login. The write merges into the existing document, preserving vendor-only fields, and is best effort: a read-only mount logs and continues.
- A credential write that fails because the directory is mounted read-only now says so, and names the remedy, instead of surfacing a bare `Read-only file system (os error 30)`.
- `auth` no longer requires `TOKEN_SECRET`. It neither issues nor validates client tokens, and demanding an unrelated secret obstructed recovery at the moment the router was least usable. Every other command still requires it.

### Fixed
- Gemini CLI now authenticates against the router. The documented setup in `docs/use-cases/cli-gemini-cli.md` sends the task token as `x-goog-api-key` — the carrier Google's own API documents, and what `GEMINI_API_KEY` becomes — which the router did not accept, so every request returned `401` while the identical token in `Authorization: Bearer` returned `200`. The header is now accepted anywhere a client token is, on every surface.
- A refused request is now refused in the dialect of the surface it arrived on. A Gemini client received an Anthropic-shaped error envelope it could not report usefully; authentication failures on `/api/gemini/**` and `/api/vertex/**` now carry Google's `error.code` / `error.status` shape, as other errors on those routes already did.
- The `401` names the carriers the router accepts instead of naming only two of them. A valid token in the wrong header was indistinguishable from an invalid token, which is what made this expensive to diagnose.

### Security
- Every header that can carry the router's own client token is now stripped before a request is forwarded to a vendor, and before a vendor response is relayed to a client. `x-goog-api-key` was previously copied through on the Anthropic pass-through path, so accepting it as a credential without this change would have leaked the router's client token upstream.

### Changed
- The `?key=<token>` query parameter that some Google clients support is explicitly refused rather than silently unrecognised, and the refusal says why: a token in a URL is recorded by proxies, access logs and shell history, none of which is true of a header. The behaviour is pinned by a test so it cannot flip silently.
- Cursor CLI is documented as **not implemented** rather than "unsupported by design". The technical finding is unchanged and still holds — `cursor-agent` speaks a private, unversioned Connect-RPC protocol, so an HTTP model proxy sees no matching route — but "unsupported" read as "will never work", which is a stronger claim than the evidence supports. `docs/use-cases/cli-cursor.md` now scopes what a minimal version-pinned adapter would have to cover as a reviewable checklist, and documents the TLS-proxy route as an advanced, opt-in, unverified configuration with its security cost stated in full. `with cursor` still fails before launch, and now points at that document.

### Fixed
- A request rejected at authentication no longer claims it carried an empty body. The body is captured as a handler reads it, and a rejected request is never read, so the record asserted `content-length: 104` and `"body": ""` at once — blank in exactly the case the log exists for, since a `401` is what a misconfigured client hits. The record now says the body was not read, and stays distinguishable from a genuinely bodiless request. The body is deliberately not buffered to recover it: that would let an unauthenticated caller make the router hold `MAX_BUFFERED_REQUEST_BYTES` per request.
- `auth status` prints an aligned provider column again. `Display for SubscriptionProvider` wrote straight to the output buffer, which discards the width the caller asked for, so `{:<8}` was accepted by the compiler and ignored at runtime. `ChatChannel` had the same latent bug and is fixed with it.

### Security
- Upstream vendor errors on `/v1/chat/completions` and `/v1/responses` are no longer relayed to the caller verbatim. The vendor body carries fields describing the *router operator's* subscription — `plan_type`, `eligible_promo`, `resets_at` — which say nothing about the caller's request; in a shared deployment, where the caller is not the account holder, every `429` disclosed the operator's billing posture. Only the status, message and retry timing are now returned. The full upstream body is still recorded in the request log, so nothing is lost for diagnosis.

### Changed
- Those same errors are rendered in the `OpenAI` dialect, as the Anthropic and Gemini surfaces already did. A client written against the OpenAI SDK could not classify the failure, because the vendor's `type` (`usage_limit_reached`) is not an OpenAI error type and no `code` was present — which defeats the purpose of an OpenAI-compatible surface. One upstream failure now yields a correctly-shaped envelope on all three surfaces.

### Added
- A recorded-fixture test tier (`tests/fixtures/clients/`, `tests/client_fixture_test.rs`). The fast tests otherwise assert request shapes written by hand, and nothing checked them against what the real clients send — which is how the Gemini CLI `401` reached a release with every unit test passing. Each fixture carries a real client's method, path, headers and credential carrier, and is replayed to assert it authenticates, reaches a route, is refused an invalid credential, and routes identically with and without its vendor-specific headers. Recording needs a subscription; replaying does not, so the check runs offline on every pull request. Verified against the original defect: reverting the `x-goog-api-key` fix fails this tier.
- A nightly `Real Clients` workflow that runs the opt-in real-binary tier, which was referenced by no workflow and therefore never ran. It also now reports which clients it exercised and which it skipped, and fails when none is installed — a silently skipped client was indistinguishable from a passing one.

### Fixed
- Codex CLI can drive a Claude model again. `codex exec` sends a tool set including `namespace`, `custom` and `tool_search`, none of which Anthropic defines, and the router refused the **entire** request over the first one it met — so nine usable tools were discarded along with the one that did not fit, and a documented client could not reach a documented subscription at all. Untranslatable entries are now dropped and the rest forwarded, since a model is never obliged to call a tool. Anything dropped is named in the `x-router-dropped-tools` response header and the request log, so the loss is diagnosable rather than silent.
- Gemini CLI can drive a Claude model again. Gemini's `generationConfig` carries both `temperature` and `topP` by default — the client offers no way to suppress either — and Anthropic rejects a request specifying both, so every such request failed with `400`. The router now forwards exactly one: an explicit `temperature` wins, because it is the more commonly tuned knob. A request carrying only `topP` still has it honoured, so a caller who tuned only nucleus sampling gets the sampling they asked for. The rule is documented in `docs/use-cases/cli-gemini-cli.md` and `docs/use-cases/chatgpt-in-claude-code.md`.
- An untranslatable tool is no longer forwarded to the vendor verbatim. The translator passed unknown shapes through unchanged, which would have traded a router `400` for a vendor one once the request was no longer refused outright.

### Added
- The Codex and Gemini client fixtures now carry the real payloads from these reports — Codex's ten-entry tool array and Gemini's full `generationConfig` — so both defects are pinned by the offline fixture tier as well as by direct translation tests.

### Fixed
- A tool call from a Claude model now survives `/v1/responses` streaming. The translator handled only `message_start`, text deltas and `message_stop`, so both halves of a streamed tool call were discarded: `content_block_start`, where Anthropic announces the call with its identifier and name, had no case at all, and `input_json_delta` — the frames carrying the arguments — was dropped by an early return. A tool-only turn therefore reached the caller as an **empty** `output_text` with a normal `response.completed`: a well-formed, successful, completely empty answer that a client cannot distinguish from a real one. The same request with `stream: false` was correct throughout, and the Anthropic and Chat Completions surfaces were unaffected, which is why this survived. This blocked every agentic CLI driving a Claude model through `/v1/responses`, since those clients always stream; with issue #215 fixed in v0.89.0, it was what remained of `codex exec` against Claude.
- A turn that produced only tool calls no longer emits an empty `output_text` item. The message item is announced when the first text arrives rather than up front, so it exists only when there is something in it.
- A turn mixing text and tool calls preserves both, each in its own output slot, in the order the vendor emitted them.

### Added
- `response.function_call_arguments.delta` and `.done` are emitted as the arguments stream, using the event names the Responses dialect already uses, and the assembled arguments are asserted equal to those the non-streaming path produces from the same upstream body — the check that keeps the two translations from drifting apart again.

### Changed
- Clients are now named after the command they install as: `claude`, `gemini`, `grok`, `qwen` and `cursor-agent`, rather than `claude-code`, `gemini-cli`, `grok-cli`, `qwen-code` and `cursor`. The descriptive names were what `--help`, the `invalid value` error, `clients list` and the docs all advertised, but they are not what the user's shell has — someone who had just installed `claude` had no reason to guess the router called it `claude-code`, and the error message taught the wrong name. The short forms already worked as aliases; nothing announced them.
- The superseded names remain accepted, so existing scripts and previously documented commands keep working. `clients list`, `--help` and the error text now show the canonical names, and `docs/use-cases/` has been updated to match.
- The managed environment and credential-metadata files are named from the client, so an installation set up before this release keeps its `claude-code.env` and `qwen-code.credential.json`: an existing file under the previous name is still found, and only new ones use the canonical name. Without that, a rename alone would have quietly orphaned those files and told the user to re-run a setup they had already run.
- The `with` wrapper's argument-boundary detection now derives its client names from the client table instead of a hand-written copy, which had already fallen out of step: it listed no entry for `cursor-agent`, so that client's arguments would not have been protected.

### Added
- The command is now `router`. The project, its repository and its documentation all call this tool `router`, while the only installed command was `link-assistant-router` — 22 characters that nobody says out loud, and longer than the `with-router` binary shipped beside it. The short name is what every documented command now uses.

### Changed
- `link-assistant-router` is still installed and still works, so existing scripts, systemd units and deployment recipes need no change. Both names are the same program: the second is a thin wrapper that includes the first, rather than a copy that could drift.
- `--version` reports `router` whichever name was invoked, while the `--help` usage line continues to echo the name actually typed — so a reader copying that line gets a command that exists on their machine under the name they used. Both behaviours are pinned by tests rather than left to chance.
- The crate, the release artifacts, the Docker images and the systemd unit keep the `link-assistant-router` name: those identify published objects rather than the command a user types, and renaming them would break installations for no benefit.

### Fixed
- The `router` command is now included in the release archives. It was added to the manifest in v0.92.0 and built correctly, but the packaging step copies binaries by a hand-written list that was not updated — so the canonical command reached only users who install with `cargo install`, and was missing from all eight published archives, which is the path the README documents. The published-archive smoke test now runs `router --version` as well, and a test asserts the packaging list against the manifest, so a binary declared but not shipped fails the build rather than the download.

### Fixed
- `with` no longer hands a client a model belonging to a different vendor. When the catalog advertised no model owned by the client's dialect — an Anthropic subscription that had lapsed, say — `with claude` launched Claude Code against an OpenAI model, and the run died inside the client with `"codex-auto-review" is not a model this version of Claude Code recognizes`. That names the wrong machine: the client was fine, the subscription was not. The router now reports the mismatch itself, and the existing "advertises no model" error — previously unreachable — is what the user sees.
- The fallback the original code intended is kept: when no catalog entry declares an owner, the router cannot tell whether a model suits the client, so it still offers one. It is only refused when the catalog names owners and none of them is the client's.
- That error now says what the catalog does hold — "it advertises only openai models" — so the next step is visible without reading the router's other surfaces.

### Fixed
- `with gemini` works again. Every run failed with `Invalid auth method selected.`, because the router pointed `GEMINI_CLI_HOME` at the `.gemini` directory while the CLI appends `.gemini` itself — so it searched `<root>/.gemini/.gemini/`, found nothing, and fell back to the user's personal settings. Both `GEMINI_CLI_HOME` and `HOME` now name the isolated root, and a real `gemini` run against a Claude model through the router answers correctly.
- The settings an isolated run writes now replace anything already present. The previous `create_new` silently deferred to an existing file, which with the home fix would have let an inherited `oauth-personal` survive and fail the run.
- `GEMINI_CLI_TRUST_WORKSPACE` is set for wrapped runs: with auth fixed, the next wall is the trusted-directory prompt, which a `--non-interactive` run cannot answer.

### Changed
- `docs/use-cases/cli-cursor.md` records how to capture `cursor-agent` traffic, measured against `2025.08.27-24c29c1`. The usual advice — that HTTP/2 or proxy variables defeat capture — is wrong for this build: `CURSOR_API_ENDPOINT` is read and then overridden by the default of an undocumented `--endpoint` flag, so passing that flag captures plaintext Connect-RPC directly. The document now names the bootstrap RPCs, the flags involved, the h2c requirement for the chat turn, and the one prerequisite outside the code — a valid Cursor login, without which the CLI opens an interactive prompt before issuing any request.

### Fixed
- The request log no longer destroys compressed bodies. A `gzip` upstream response was decoded as UTF-8, so every invalid byte became U+FFFD and the record was neither readable nor recoverable — the log silently degraded to frame counts for exactly the exchanges an operator most needs to read. A body that is not valid UTF-8 is now stored base64-encoded and labelled, so it can be decoded afterwards. Text and JSON bodies, and the redaction applied to them, are unchanged.

### Added
- A streamed exchange now records how it *ended*, not only how it started. The status line is written when the response headers arrive, so `status=200` said nothing about whether the turn completed: a stream cut mid-flight was logged as a clean success while the client reported a truncated answer. Each relayed stream now emits a terminal `stream_end` record carrying the outcome (`completed`, `ended_without_terminator`, `upstream_error`), the frame count, the byte count and the duration — so a truncated turn is visibly different from a healthy one. A stream that ends without its dialect terminator (`message_stop`, `[DONE]`, `response.completed`) also logs a warning, because silence is what made this invisible.

### Fixed
- Diagnostic logging now goes to stderr rather than stdout, so a command's own output stays machine-readable. `logs summary --json` is meant to feed a monitoring check, and the startup line mixed into stdout made that JSON unparsable.
- `with` no longer captures a client argument whose name the router also defines. A second `--model` was parsed as a repeat of the router's own and rejected as a duplicate, so routing to one model while telling the client another was inexpressible — and `--model` is defined by five of the seven clients. The first occurrence is the router's; any repeat is forwarded, and the same holds for every router-owned option name.

### Added
- `with --extend-global-config` keeps the user's own configuration and applies only the router's connection settings on top, so sessions started outside the router remain visible and can be resumed through it. The default is unchanged: an isolated configuration directory is still right for CI and one-off runs. Clients configured through a file rather than environment variables report that the flag cannot be honoured for them instead of silently isolating.
- `router logs summary`, `router logs anomalies` and `router logs show <correlation-id>` answer questions about the request log, which previously had to be read with one-liners invented on the spot. Both failure modes that produced are now impossible: a stream that died mid-flight is found from its terminal record rather than by searching for error text, and a compressed body is reported as undecodable rather than counted as a missing terminator. `--json` emits machine-readable output, and `anomalies` exits non-zero when anything was found so it works as a health gate. Unparsable records and undecodable bodies are always stated, because silence about unreadable data is what produced the original false positive.

### Changed
- Router state is stored as readable links notation. `tokens.lino` was already links notation but base64-encoded on a single line, and the admin claim, managed-server state and server selection were JSON — so state was split across two formats and neither was pleasant to read. `lino-objects-codec` 0.3 encodes plain, indented text by default, with base64 used only for values that cannot be written as text and marked individually, so all four stores are now one format an operator can read.
- Existing files keep working. A store written by an earlier release is detected by its content and loaded as JSON, then migrates to links notation on its next write; file names are unchanged, so no deployment needs to move anything.

### Fixed
- A rotated refresh token is no longer treated as revoked. Vendors issue single-use refresh tokens, so when the Claude CLI or a second router redeemed the shared credential first, the router's own exchange answered `invalid_grant` — and the router concluded the subscription was dead, emptied the catalog and asked for a manual re-login. It now re-reads the credential, adopts a newer chain link and retries once, which turns the common case back into a retry.
- Rotated refresh tokens are persisted on every refresh path. Only the catalog poll wrote the rotation back; the proxy and subscription paths refreshed in memory, so the spent token stayed on disk and the next process start replayed it. The failure was self-perpetuating across restarts.
- A rejected subscription is named as the cause of an empty catalog. A request for a model whose only subscription was rejected reported that the model was `not advertised by any subscription`, which described the symptom and hid the cause; it now reports the credential state and what to do about it.
- The terminal message distinguishes a revoked credential from a lost rotation race, and names the credential file that was checked. "Waiting will not help" was misleading for a credential another holder had merely rotated past.

### Added
- The read → refresh → write cycle is serialised across processes by an advisory lock on a sidecar lock file, and the credential is rewritten atomically, so two holders no longer race and an interrupted write leaves the previous credential intact.
- Access tokens are refreshed five minutes before expiry rather than after a rejection.
- Optional last-resort recovery through the vendor's own client: with `--claude-cli-bin` configured, a credential no direct exchange can redeem is handed to the vendor CLI once, and the rotated credential it leaves behind is adopted. The invocation, the client's own debug log and the exchange the router sent are journalled by header and field *name* — never by value — so the undocumented token protocol can be reproduced from the log.

### Fixed
- `accounts list` no longer reports a revoked subscription as healthy. The `healthy` column consulted only an in-memory cooldown timer, which is unset until a live request has already failed — so a freshly started process called every account healthy, including one whose token was expired with no refresh token left, at the same moment `doctor` called it EXPIRED and every request returned 401 (issue #242). Health now also reflects the credential on disk, which is a local file read and adds no network call to a listing.
- `router` resolves inside the published container image. The image shipped the binary only under its long name, so a runbook or health check copied from the docs failed with "executable file not found" in a container while the identical command worked after `cargo install` (issue #243). Both Cargo bin targets build the same source, so the image gains a symlink rather than a second 11 MB copy.

### Added
- `accounts list` and `GET /v1/accounts` report a `credential` state — `ok`, `refreshable`, `expired` or `missing` — beside `healthy`, so the reason an account cannot serve a request is visible without running `doctor`. An expired access token that still holds a refresh token reports `refreshable` and stays healthy: the refresh ladder recovers it on the next request, and reporting it dead would trade one false reading for another.

### Fixed
- `accounts list` no longer calls a revoked refresh chain `refreshable` and healthy. The check asked only whether a refresh token *existed*, and a revoked refresh token is still a non-empty string on disk — so a chain the upstream had already refused with `invalid_grant` was indistinguishable from a live one, and every request it served returned 401 while the column stayed green (issue #245). An account whose current credential has been refused now reports `rejected` and unhealthy, agreeing with `doctor` instead of contradicting it.

### Added
- A terminal refusal is recorded durably, keyed to a SHA-256 fingerprint of the credential rather than the credential itself. `accounts list` runs as its own short-lived process and performs no refresh, so without a record that outlives the refresh there was nothing for it to consult; `doctor`, which does perform the refresh, now writes down what it learns. The fingerprint is also what expires the record: once a holder rotates the chain forward, the file no longer matches, the verdict stops applying, and the account reports recoverable again with no restart and no manual step — the rule the refresh ladder already follows.
- The refusal is scoped per account, not per provider. The evidence the ladder keeps alongside it is per-provider, which is right for routing a vendor away and wrong for a per-account report: every account in a Claude pool shares that key, so one revoked chain would otherwise have condemned its healthy neighbours.

### Fixed
- `auth` follows the server `server use` selected, the way `with` already does. `server use` establishes which router the CLI is talking to and `auth` exists to give that router a subscription, but `auth` wrote to a local credential directory instead — so the obvious `server use` → `auth` → `with` sequence authorized the wrong place. Nothing signalled it: the login printed success, and the problem surfaced later as an unrelated-looking 401 or an empty model catalog, by which point the selection is not the first thing anyone suspects (issue #246). The browser step still happens in front of the operator; the credential is now completed on, and stored by, the router being targeted, through the admin login API it already exposed.
- A selected server that cannot be reached is an error naming that server, not a silent fall back to a local directory — falling back is the surprise this fixes.

### Added
- `auth --local` authorizes the local credential directory even when a server is selected, and `auth --server <url>` targets one router for a single command. Both make the choice explicit rather than implied; they are mutually exclusive, because the target must be one unambiguous thing.
- `auth status` reports what the selected router sees — account name, credential state and home — instead of the local homes, so it can no longer disagree with the router it is meant to describe.

### Fixed
- On macOS the router reads the Claude subscription the vendor CLI actually uses. Claude Code keeps its live credential in the login Keychain and leaves `~/.claude/.credentials.json` behind as a snapshot nothing rotates, so the router saw a token that had been dead for hours while `claude -p` — on the same account — kept working: `accounts list` reported `rejected`, `doctor` answered `OAuth access token has been revoked.`, and the Claude catalog served zero models (issue #249). Re-authorizing only appeared to help, because it wrote a fresh file that then expired on its own schedule. Both stores are now read and the newer credential wins, so the recovery ladder from #239 is finally reading the store the vendor client writes to.
- The machine-wide store speaks only for the vendor's default home. A reader pointed at a pooled account, a per-account directory, or a mounted credential keeps reading exactly the file it was given — one keychain entry answering for every account would collapse a pool onto a single subscription.

### Added
- `doctor` names the store each credential was read from (`store: keychain` or `store: file`) and prints the keychain entry rather than a file path when that is what it used. A valid-looking file next to a router reporting `rejected` was previously indistinguishable from a bug; the store is now visible in the output.
- A credential that exists only in the platform store is reported normally instead of as `MISSING`, which is what a machine that logged in with a recent client actually looks like.

### Fixed
- When no server is selected, `with` and `auth` use a router that is already listening locally instead of starting a managed Docker container beside it. Starting one was both the expensive branch — an image pull and a container start on a command expected to be instant — and the surprising one: the new container has its own credential directory and token store, so a subscription authorized through it was invisible to the instance already running, and vice versa (issue #250). This changes only the default; `--server`, `ROUTER_URL`/`LINK_ASSISTANT_ROUTER_URL`, and the persisted `server use` selection all still take precedence, in that order.
- A discovered endpoint is adopted only after the same `/health` handshake every other branch performs, so an unrelated service holding port 8080 is rejected rather than mistaken for the router.
- `server status` reports the router the next command will actually use, naming an `already-running local server` where it previously announced a container it was not going to start.

### Added
- `--managed` on `with` and `auth` forces a disposable managed container even when a router is listening, for CI and clean-room reproductions that want a fresh instance on purpose.
- Discovery probes the conventional port, `ROUTER_PORT`, the recorded managed port, and any port Docker publishes to loopback — so a deployment reached over an SSH tunnel or a container published on an operator-chosen port is found, rather than only the ports this crate happens to name.

### Fixed
- `logs anomalies` no longer reports complete non-streamed exchanges as streams with an unknown ending. Every response is relayed through the same byte-stream machinery, so the analyser treated the presence of body records as proof of streaming — and 85% of one real log's 1248 "streamed" exchanges were ordinary `application/json` replies that had completed normally (issue #252). An operator investigating a genuine truncation had to wade through ~1000 false entries to find it, and a signal that fires on the common healthy case trains people to ignore it.
- A gzip-compressed single-shot reply is no longer mistaken for a truncated stream. Its transfer chunks were counted as SSE frames, so the absence of a dialect terminator in them was reported as a cut stream — and warned about, once per successful request, filling `docker logs … | grep -i warn` on a healthy deployment with noise that a real truncation was indistinguishable from.
- Whether an exchange streamed is now decided from evidence: the response `content-type` settles it (`text/event-stream` is a stream, anything else is not), with the request's `stream: true` as a fallback when no media type was recorded. The response outranks the request, since an upstream may answer a streaming request with a single document. An undeclared media type stays eligible for truncation detection, so the reach of the check added in #230 is unchanged.

### Added
- `logs summary` reports `non_streamed` alongside `streamed`, so the split is readable at a glance rather than inferred by subtraction — every stream statistic's denominator depends on it.
- The terminal log record carries `streamed`, and a non-streamed reply settles as `completed_not_streamed` rather than `ended_without_terminator`. A transport failure still fails it: a truncated document is a real problem whatever the framing.

### Changed
- CI moves to `actions/download-artifact` v8.0.1 and `docker/setup-buildx-action` v4.3.0. v8 carries two deliberately stricter defaults: a digest mismatch now fails the run instead of logging a warning, and downloads are no longer force-unzipped without checking their `Content-Type`. Both suit the release job that uses it — it fetches published artefacts, where a silent hash mismatch is exactly what should stop a release.
- The Node `DEP0005` deprecation notice that had kept this pinned to v7 is silenced at the step rather than avoided by staying behind. v8's bundled unzip chain still calls the deprecated `Buffer()` constructor (upstream `actions/download-artifact#484`, still open), and these artefacts are zips so `skip-decompress` cannot side-step the extraction path; `NODE_OPTIONS: --no-deprecation` on that one step keeps the release log clean while the stricter checks stay on.
- The regression guard now asserts that *every* artifact download silences the notice, instead of refusing v8 by commit. It enforces the property that was actually wanted — a quiet release log — rather than the version that happened to deliver it.

### Changed
- Every dependency is at its latest published version. `links-notation` 0.13 → 0.14 and `lino-objects-codec` 0.3 → 0.4 are major bumps: both back the links-notation storage layer, so the whole suite was run against them rather than the build alone. Six transitive crates moved within their existing constraints (`cc`, `h2`, `icu_provider`, `quinn-proto`, `zerovec`, `zerovec-derive`); `h2` 0.4.16 → 0.4.18 is the one worth naming, since it carries the HTTP/2 framing the proxy relays through.

### Fixed
- A gzip-compressed SSE stream is no longer reported as ending without its terminator. The router relays a compressed body byte for byte — it never decodes one — so scanning those frames for `message_stop` searched gzip and could only fail. Every healthy compressed stream was therefore declared truncated, warning once per request: 19 warnings in 25 minutes of ordinary vendor-CLI use, every one of them a turn that succeeded (issue #255). `docker logs … | grep -i warn` was again almost entirely this, leaving a genuine truncation indistinguishable from routine traffic — the outcome the diagnostics exist to prevent (#234).
- `unterminated_streams` no longer counts streams the log cannot read: 315 of 400 on the reported log, where the sampled exchanges had all completed. An operator reading that figure concluded most streamed turns were failing.

### Added
- A stream whose frames were encoded settles as `encoded_not_verifiable` and is reported under its own `stream_not_verifiable` anomaly and a `not verifiable` count in `logs summary`. Reporting "how this ended is not knowable" is honest; reporting "truncated" is not — and only the honest version leaves the truncation signal usable.
- The terminal log record carries `inspectable`, so the analyser reads the relay's own verdict about whether the frames could be examined rather than re-deriving one from headers. Headers remain the fallback, so logs written before this keep their meaning.
- A real truncation still warns and is still named: an uncompressed stream that stops early, and any transport failure whatever the encoding, are unchanged. The signal from #230 is narrowed to the cases it can actually attest to, not silenced.

### Fixed
- `no_terminal_record` no longer fires on streams whose terminator is present in the recorded body. The verdict came solely from the `stream_end` record, so an exchange without one was declared to have ended in an unknown state although the marker was sitting in the body the log had already captured. 239 of 251 uncompressed streams carried a valid terminator, making the class ~95% healthy traffic — and burying the 12 that deserved attention (issue #258).
- The OpenAI and Gemini relays now settle their streams, as the Anthropic relay already did. Only one of the four streaming paths wrote a terminal record, which is *why* those exchanges reached the log without one; deriving the ending from the body keeps the report honest either way, but the missing record was a defect of its own.
- Gemini's terminator is recognised. That dialect names no terminating event — the final chunk of a finished turn carries `finishReason` instead — so its streams could never satisfy the check.

### Changed
- A recorded `stream_end` still outranks the body scan: the relay watched the frames go past, while the analyser reads what was captured afterwards. A stream with no terminator in a readable body remains a genuine anomaly, which is the case worth alerting on.

### Added
- Git smart-HTTP proxy at `/git/{owner}/{repo}.git`, so a `git push --force` reaches the same policy engine the REST surface already answers to. Ref deletions and forced updates to existing branches are refused **by default** and re-enabled only by reconfiguring the router, which is the point: an agent cannot talk its way past a rule it has no access to (issue #261). Creates and fast-forwards pass through, refusals are recorded in the per-token `requests.jsonl`, and the caller never holds a GitHub credential — the router presents its own upstream. Configure a client with `git config --global url."https://router/git/".insteadOf "https://github.com/"`.
- Optional TLS termination: `TLS_CERT_FILE`/`TLS_KEY_FILE` serve a real certificate, and `TLS_SELF_SIGNED=1` generates one for the names in `TLS_SELF_SIGNED_DNS` — including the network alias a sidecar is actually reached by. `router tls ca` prints the certificate for clients to trust and `router tls generate` creates the pair without starting the server. `gh` builds a custom host's REST base as `https://<host>/api/v3/` with no plaintext option, so an internal-only router previously needed a separate terminator and a private CA in front of it purely to be reachable (issue #263). Unset means unchanged: the router serves plain HTTP exactly as before.
- `router auth gh` stores the credential the proxy presents upstream, read from a mounted `gh` configuration (`--from-gh-config`, else `$GH_CONFIG_DIR`, else `~/.config/gh`) or `--token-stdin`, so a deployment reuses an existing login instead of minting a second token. `--status` reports what is configured without changing it.
- `tokens issue --github-repo owner/repo` (repeatable, and `github_repos` on the admin API) restricts a token's GitHub proxy access to named repositories, evaluated ahead of the shared rules. Omit for unrestricted access, which is the default and what every existing token keeps: the proxy already keeps the operator credential out of the caller's hands, and narrowing further is an opt-in (issue #262). Rotation preserves the scope, since a rotated credential that silently widened to the whole account would defeat it.

### Changed
- `UPSTREAM_PROVIDER=auto` routes to stored OpenAI-compatible providers that declare their models, and `/v1/models` lists those models alongside the discovered subscription catalogs. One deployment can now serve both vendor subscriptions and a local endpoint; previously a stored provider was reachable only by pinning the whole deployment to it (issue #260). A model declared by two providers is refused rather than resolved by declaration order, and `<provider>/<model>` names one explicitly to resolve the collision.

### Added
- `LISTEN_UNIX_SOCKET` serves the router on a unix domain socket alongside its TCP port. `gh` builds a custom host's REST base as `https://<host>/api/v3/` and, as of 2.82, has no way to trust a self-signed certificate — it reads no CA variable, has no `--cacert` flag, and ignores `SSL_CERT_FILE` on macOS — so the certificate the TLS feature generates could not be given to the one client the feature exists for (issue #265). `gh` does honour `http_unix_socket`, and over a socket it speaks plain HTTP, so a socket sidesteps the certificate problem entirely. The socket is created owner-only, so it bounds access at least as tightly as the loopback port it replaces, and the credential is still required: it is a transport, not a back door.
- The router logs the exact `gh config set http_unix_socket …` line for the socket it bound, because the setting lives in `gh`'s configuration file rather than an environment variable — which is the step the previous documentation left unstated.

### Changed
- The README gains a "Trusting the certificate" section covering `curl`, `git` and `gh` individually. It says plainly that `gh` cannot be handed a PEM, names the unix socket as the recommended path for a local or sidecar deployment and a real certificate for a shared host, and positions the OS trust store as the last resort it is rather than the documented path. The previous text implied a step that did not exist for the primary client.

### Changed
- Local builds no longer accumulate an unbounded `target/` directory. A debug build links 38 integration-test binaries plus three `[[bin]]` targets and evicts nothing, so ordinary edit-build-test cycles reached 512,539 files and 61 GB — 42 GB of it the incremental cache alone. `.cargo/config.toml` now disables incremental compilation locally (matching `CARGO_INCREMENTAL=0`, which CI already sets) and emits line tables rather than full DWARF, which keeps backtraces working across all 41 linked binaries.
- CI compiles through sccache with the GitHub Actions cache backend. The existing `actions/cache` step is keyed on `Cargo.lock`, so a single dependency bump misses the whole `target/` directory; sccache keys on each compilation unit and still hits. A rate limit makes the build continue uncached rather than fail, so it cannot block a release.

### Added
- A `post-commit` hook prunes build artifacts the commit's own build did not use, so the cache stays bounded without anyone remembering to clean up. It requires `cargo-sweep` (`cargo install cargo-sweep`) and does nothing when that is absent — pruning a cache is never a reason to reject a commit. The stamp/sweep order is load-bearing and easy to invert: stamping after a build marks that build's own output stale, so `scripts/sweep-build-artifacts.sh` sweeps against the previous stamp before writing a new one.

### Fixed
- The admin-endpoint tests no longer fail when another test claims their port first. `free_port` closes its listener before returning the number, so any test in the same parallel run can take that port before the router child binds it; `serve` propagates the bind error and exits without retrying, so the loser polled `/health` for the full 30-second timeout and then panicked. This surfaced as a green PR run turning red once merged to `main`, which held the v0.108.0 release back a commit. The harness now re-rolls the port up to five times and gives up on an attempt as soon as the child exits, so the race is recoverable rather than fatal.

### Fixed
- The git proxy settles a force-push against the upstream instead of a capability git never sends. `refuse_destructive_updates` treated an update as a rewrite only when the body announced `force-ref-updates` or `push-force`; neither is a capability `git send-pack` sends, so a real `git push --force` was forwarded to GitHub and applied (issue #272). A rewrite is expressed by the command line itself, which the object graph alone can settle, so the router now asks the upstream — `GET /repos/{owner}/{repo}/compare/{old}...{new}` must answer `ahead` before the packfile moves. It fails closed: a network error, a rate limit, a revoked credential, or an unrecognised answer all refuse, because a control an autonomous agent is not supposed to talk past must not open when the check cannot run. `GITHUB_PROXY_POLICY` stays the deliberate escape hatch and is consulted first, so an allowed ref costs no API call and cannot be locked out by an outage.
- The README no longer tells Linux users that `gh` cannot be given a certificate. Go's `crypto/x509` reads `SSL_CERT_FILE` in `root_unix.go`, which covers Linux, the BSDs and Solaris; only `root_darwin.go` bypasses it for the Security framework. The claim was right about macOS and wrong everywhere else, and it steered readers away from the one path that works on Linux (issue #270). The "Trusting the certificate" section now gives the setting per client and per platform, and the module and test headers repeating the claim are corrected.

### Added
- `LISTEN_UNIX_SOCKET_MODE` and `LISTEN_UNIX_SOCKET_GROUP` widen the socket deliberately. It was created `0600` with no way to change it, so it could be reached only by the router's own uid — while the deployment it exists for is a sidecar serving task containers that run as a different uid by construction. The only workaround was `chmod 0666` after every start, which opens the socket to every account on the host rather than to one known group (issue #271). Owner-only remains the default, a mode wider than `0666` is refused rather than quietly narrowed, and the startup line reports what was granted.
- `router auth <provider> --clear` withdraws a stored credential, and `router auth status --clear-all` withdraws every identity in one step. Storing a credential was the easy half; withdrawing one previously meant knowing an internal path and deleting a file by hand, which is not discoverable from `--help` and left the GitHub routes mounted (issue #268). Every filename a provider is *read* from is removed, not just the one a login writes — Claude alone is read from five, so clearing one left the reader finding another and reporting the credential as still present. The output says what was removed, that a token minted for the deployment is still valid upstream and should be revoked there, and that the GitHub routes are mounted at startup and need a restart to withdraw. A vendor CLI's platform keychain entry is reported rather than deleted: it belongs to that client, not to the router.

### Added
- `router auth claude --from-claude-home` and `router auth codex --from-codex-home` adopt an existing vendor login, the way `auth gh --from-gh-config` already could. The surface removed credentials uniformly but acquired them uniformly only for GitHub, so provisioning a headless deployment meant knowing each provider's path, copying files by hand, and getting the permissions right (issue #274). The import copies the credential *document* rather than re-serializing a parsed token: `SubscriptionToken` models no `id_token`, and Codex derives its account id from that field on every read, so a round-trip would drop what the next read depends on. On macOS the live Claude credential is in the login Keychain rather than the file beside it, and the import prefers whichever is genuinely newer — the same rule the serving path uses. It reports where the credential came from, when it expires, whether it carries a refresh token, and whether the vendor still accepts it, so an already-dead credential is caught at import time rather than as a `401` later.
- The vendor-CLI rung of credential recovery covers Codex, with `--codex-cli-bin` / `CODEX_CLI_BIN` alongside the existing Claude option. A Codex credential is an OAuth chain with the same single-use rotation, so recovering one automatically while requiring an operator for the other drew a line the credentials do not (issue #275). Each provider's binary is opt-in on its own, and a provider with no known probe yields no client rather than one carrying another vendor's arguments.
- `ROUTER_VENDOR_REFRESH_ARGS_CLAUDE` and `ROUTER_VENDOR_REFRESH_ARGS_CODEX` override the recovery probe for one provider. The existing global form cannot express "one probe for Claude, another for Codex", so a deployment running both had to accept one client receiving the other's command line.

### Changed
- The README states what the recovery rung costs: the probe is a real inference request, because that is what forces a refresh. `claude auth status` was measured as a cheaper candidate and rejected — against a credential expired by 42 hours it reported `loggedIn: true` and left the credential untouched, while the model probe took the refresh path and cleared the dead chain. Adopting it would have disabled the rung while appearing to make it cheaper. The finding is recorded next to the probe so it is not rediscovered.
- `--debug-file` is passed only to Claude Code, which is the client that has it. `codex` rejects the flag outright, so the Codex probe would have failed argument parsing before ever reaching the credential.

### Fixed
- The login-flow tests no longer fail intermittently on full-suite runs. Every timeout in that file is the budget for a PTY handshake with the stand-in CLI, not a property under test; twenty seconds was ample alone and marginal when the whole suite competes for CPU, which surfaced as two different tests failing on full runs while passing 5/5 in isolation.

### Changed
- `router with` keeps the user's own client configuration by default, and `--isolated-config` asks for a directory of its own. `with` changes how the client reaches the model and nothing else, so discarding the user's theme, permissions, MCP servers, `settings.json` and `projects/` was a far larger side effect than choosing a connection route implies — an interactive user landed in first-run onboarding with `/resume` listing nothing (issue #277). Extending adds only the two connection variables to the environment of the process being launched; nothing the user owns is written or modified. Isolation remains right for CI and clean-room reproductions, which is the context where passing a flag is cheap. `--extend-global-config` still parses and now does nothing, so existing scripts keep working.
- A client whose routing depends on a file the router writes is isolated whatever was asked for. Gemini CLI sets both connection variables *and* needs a `settings.json` it resolves from `HOME`, so extending would have written that file where the client never looks and let the user's own settings decide the run (issue #227). Previously this combination was an error; as a default it would have made `with gemini` and `with opencode` fail outright, so it is now a fallback — the user asked to run a client, not to isolate one.

### Added
- `router auth import <provider> [<dir>]` adopts a login this machine already has, with `--all` for every login at once. Importing was reachable only as a differently-named flag on each provider's authorize command, so nothing in `auth --help` said it was possible: a user saw three "Authorize" entries and had to open each provider's help to discover the capability, then learn a separate flag name for each (issue #278). Authorizing and importing differ in prerequisites, side effects, and whether a human has to be present — which is what decides whether a headless deployment can be provisioned at all. `gemini` and `qwen` are importable through the same verb, and `gh` alongside them even though it is not a subscription. The per-provider flags keep working, and the report each import prints is unchanged.
- `--all` adopts what exists and reports what does not, rather than failing on the first provider this machine never logged in to: a workstation holding two of five logins is the ordinary case, not an error.

### Fixed
- An unqualified import reads the vendor's own home rather than the router's. `resolve_home` honours `CLAUDE_CODE_HOME` and friends, which in a deployment name the *destination*, so `auth import claude` with no directory resolved source and destination to the same path and refused itself as a self-import.

### Fixed
- `auth import` describes the credential it installs. The document and the token describing it were read through two methods that select the platform store by different rules: import consults the store for any home, while the serving reader consults it only for the vendor's default home. An import always names a source that differs from the destination — otherwise there is nothing to adopt — so the two disagreed on every macOS import, and a live Keychain credential was installed under the stale file's verdict: `EXPIRED 3 days ago … REJECTED by the vendor` for a credential that served traffic seconds later (issue #280). The verdict is the part an operator acts on, and it failed in the unsafe direction — the honest reading of that output is "re-authenticate interactively", on a machine where the import had just succeeded. One selection now yields the bytes, their verdict, and their origin together, so they agree by construction rather than by two rules being kept in step by hand.
- `auth status` no longer reports a serving single-account deployment as having no accounts configured. `accounts: []` means *no account pool*, the ordinary state of a single-subscription router, and the server already said so in a `note` the CLI discarded (issue #281). The answer was indistinguishable from the one given for a deployment with no credential at all, and pointed the wrong way. The endpoint now reports each provider's credential state for the single-account case, using the same verdict vocabulary the pooled surfaces use, and the CLI prints the server's explanation when there is nothing else to show.
- A GitHub credential stored through `--data-dir` is found at startup. `GitHubProxyConfig::from_env` read `DATA_DIR` from the process environment while every other consumer of that setting used the value clap had already merged from flag *and* environment, so the flag form left the entire GitHub surface unmounted — every GitHub route answering `route not found`, which reads as "this build has no GitHub support" rather than "your credential was not looked for" — while `auth gh --status` reported the credential present (issue #282). The `GITHUB_PROXY_TOKEN*` sources stay environment-only; those have no parsed counterpart.

### Changed
- `auth gh` takes `--local`, `--server` and `--managed` like every other `auth` subcommand, and refuses to store a credential when another deployment is selected (issue #283). It was the only one of the five that accepted no target flags, so with a server selected it acted on the local machine and reported success — leaving the workstation holding a GitHub token it never needed while the deployment that did need one still had none. A router reads its GitHub credential from its own data directory at startup and exposes no endpoint that accepts one, so there is nothing to store remotely; saying that is the honest answer, and `--local` asks for this machine explicitly. `--status` still answers, naming whose credential it is describing rather than printing a bare path that looks equally plausible for either target.

### Fixed
- `auth import <provider> <dir>` reads the directory it was given. The platform store was consulted for any home, and it is a single machine-wide entry that usually holds the newest credential, so on macOS it beat every explicitly named source: no spelling of the command reached the file the operator pointed at (issue #285). The report was honest about it — it named the Keychain — which made the behaviour easy to miss and no less wrong. The store is now consulted only when the source is the vendor's own home, the same condition the serving path already applies, so an unqualified `auth import claude` still adopts a live Keychain credential sitting beside a stale file (issue #249) while a named directory means *this* credential from *there*.
- Naming a source directory no longer collapses a pool of per-account credential directories onto whichever account happens to be logged in interactively. This is the risk `is_vendor_default_home` exists to prevent on the serving path; import writes the credential a deployment then serves, so it had the identical exposure and no equivalent guard.

### Fixed
- `auth import` no longer answers about the local credential home when another router is the target. `--server` parsed and was then discarded, so all three spellings — `--server URL`, a persisted selection, and `--local` — produced one behaviour, which made the flags actively misleading rather than merely inert (issue #291). The failure was a wrong-target action wearing a plausible answer: `error: claude is already read from /Users/me/.claude` reads as a coherent reply to a question about the selected server, and nothing in it revealed that the server was never consulted.
- Import installs into the credential home of the machine running it, and no router accepts a credential document over HTTP — `/api/login` begins an interactive OAuth flow and `submit_code` takes a short-lived code, neither of which adopts a credential that already exists. So there is no remote import to perform, and it now refuses, naming the selected router *and the directory that router reads its credential from*, which it asks the deployment for. `--local` remains the way to ask for this machine. This is issue #283's remedy applied to the one command that still had the defect.
- `auth import --help` and the README no longer describe importing as provisioning a deployment from a workstation, which is the case that refuses. Authorizing a remote deployment from here is what `auth claude` and `auth codex` already do.

### Added
- `tokens`, `accounts`, `providers`, `logs` and `doctor` accept `--local`, `--server` and `--managed`, like `auth` and `with` already did (issues #293, #294). Targeting was decided per command family, so what "the router" meant depended on which subcommand was typed — one predictable behaviour turned into a table an operator had to memorise.
- `router tokens` acts on the selected server: `issue`, `rotate`, `list`, `revoke`, `expire` and `show` all reach a remote deployment through the admin API it already exposed. Tokens are the part of a deployment an operator touches most often, and every routine action — reissuing after a 401, revoking a leak, asking which tokens are live — previously meant `ssh` into the host or a hand-written `curl` against `/api/tokens/list` (not `/api/tokens`, which is `POST`-only and answers 405 to a `GET`). The HTTP surface and the CLI were both already complete; only the connection between them was missing, so the capability existed twice and was reachable neither way for the ordinary remote case.
- `router accounts list` and the whole of `router providers` act on the selected server too, through endpoints that already existed and were already admin-gated.

### Changed
- `TOKEN_SECRET` is required only where signing happens. A command aimed at another deployment neither issues nor validates tokens locally — the admin credential authenticates the call and the deployment signs its own — so demanding it there refused to *start* rather than acting on the wrong target, and pushed operators toward copying a deployment's signing secret onto a workstation, which is the opposite of what the admin-token design is for.
- `logs` and `doctor` refuse rather than answering about local state when another router is selected, naming the target and what can be done instead — the shape issue #284 gave `auth gh`. The request log lives on the deployment's own disk and no endpoint serves it back; `doctor` reports on the machine it runs on. Answering from here would describe a different deployment as though it were the one asked about. Serving either remotely needs new server surface and is not a targeting change.
- A command handed `--data-dir` or `--claude-code-home` stays local. Without a selection, `auth` adopts a router already listening here (issue #250), but those flags name *this machine's* state explicitly, so redirecting them to a discovered router would answer about a different deployment than the one the operator pointed at. An explicit `--server` still wins.
- `tokens list` and `providers list` render through one printer for both paths, so the local and remote tables cannot drift — an operator reading a table has no way to tell which machine answered. This also fixed the remote provider table showing `open-a-i-compatible`, the `kebab-case` serde encoding of the kind, where the local table shows `openai-compatible`.

### Added
- `router configure <client>` points a client at the router permanently: one name for what used to be two commands that disagreed on the address, the credential, the reversal and the client list (issue #296). It acts on the router this machine is pointed at, mints a credential from that router and stores it outside the client's configuration at mode 0600, so the client works when the command returns. `--all` configures every client the machine has and names the ones it cannot; `--undo` restores the client's own file byte for byte and revokes the credential it minted. `with --global` is the same command under an older name and maps onto it rather than keeping a second implementation.
- `GET /health/subscriptions` answers whether the router can serve what it advertises, with a reason per degraded subscription, and `/metrics` gained a `link_assistant_subscription_healthy{provider="…"}` gauge (issue #318). A revoked subscription is now visible to a stock uptime check and to a scraper; `/health` itself is unchanged, because it drives both Kubernetes probes and a restart cannot mint an OAuth token.
- `with --local`, `--label` and `--pick-model`; `--ttl-hours` is accepted as a name for `--run-ttl-hours`. `tokens list`, `accounts list`, `providers list` and `clients list` take `--json`. `providers add` takes `--api-key-stdin`, so the one secret that could travel only through argv no longer has to. `auth clear <provider>` / `auth clear --all` give withdrawal a name; the `--clear` flags keep working. `tls` takes `--local` / `--server` like every other family. `--home` is global, like `--data-dir`.

### Fixed


---

*This release note was truncated to fit GitHub's 125000-character limit. The complete entry is in [CHANGELOG.md](https://github.com/link-assistant/router/blob/v0.120.0/CHANGELOG.md).*

---
