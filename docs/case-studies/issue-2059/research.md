# Primary-source research

Research was refreshed on 2026-07-26 UTC. Technical decisions use upstream documentation and repository evidence rather than third-party summaries.

## Formal AI client integration

Formal AI's official [agentic CLI documentation](https://github.com/link-assistant/formal-ai/blob/main/docs/configuration/agentic-clis.md) says `formal-ai with <tool>` reads the seed integration registry, creates isolated temporary client configuration, supplies protocol URL/key/model settings, launches the client, and reports its session artifact. The documented matrix includes all six Hive Mind tools:

- Codex uses the OpenAI Responses protocol and model `formal-ai`.
- OpenCode and Agent select `formalai/formal-ai`.
- Claude and Qwen select `formal-ai`.
- Gemini uses its native routing integration.

[PR #648](https://github.com/link-assistant/formal-ai/pull/648) introduced the zero-configuration wrapper behavior: it starts a temporary `formal-ai serve --agent-mode` server when the default loopback port is idle, reuses an existing listener, tears down its own server at exit, and keeps non-global client configuration temporary. This is precisely the cross-client behavior Hive Mind should reuse.

The official [server API documentation](https://github.com/link-assistant/formal-ai/blob/main/docs/configuration/server-api.md) identifies port 8080, `/health`, and `formal-ai serve --agent-mode --host ... --port ...`. It also establishes why a shared service must run with `--agent-mode`: tool calls are deliberately disabled without the opt-in.

## Current release

[Formal AI v0.305.0](https://github.com/link-assistant/formal-ai/releases/tag/v0.305.0) was published on 2026-07-26 at 14:35:45 UTC. Crates.io metadata declares Rust 1.96, so the Docker build uses `rust:1.96-slim-bookworm` rather than relying on an incidental toolchain version in the Box runtime. The Bookworm variant targets glibc 2.36, avoiding a binary built against Debian 13's newer glibc 2.41 that would not run in the Ubuntu 24.04 Box image.

[PR #850](https://github.com/link-assistant/formal-ai/pull/850), merged shortly before v0.305.0, reports a grounded-action routing improvement and a 24/24 task-specific journey ladder. That is meaningful progress, but it is not the same dataset as the coding ladder that measures issue-to-PR execution.

## Capability evidence and the default decision

[Formal AI issue #848](https://github.com/link-assistant/formal-ai/issues/848) contains the current 130-task coding ladder, derived from the repository's actual edit history. Its v0.303.0 baseline with Agent 0.25.0 was:

```text
TOTAL 38/130
L1 0/16  L2 0/12  L3 3/28  L4 35/74
```

The expanded result corrected the earlier 13-task claim that no writes worked: 10 of 60 write tasks succeeded. However, every passing write was prose/config insertion or a simple constant swap; generated valid code, test authoring, targeted code edits, refactors, multifile changes, deliverables, and issue-to-PR runs remained at zero. No published rerun of that same 130-task dataset on v0.305.0 was available at the research snapshot.

Therefore this PR makes Formal AI explicitly selectable but does not make it the implicit Agent default. The promotion gate is evidence-driven and reproducible rather than a version-number guess.

## Hive Mind and isolation components

Hive Mind supports exactly six tool values in its current model and command dispatch: Claude, Agent, OpenCode, Codex, Qwen, and Gemini. The existing `src/isolation-runner.lib.mjs` already centralizes Docker child environment and credential propagation.

The official [start-command documentation](https://github.com/link-foundation/start/blob/main/docs/USAGE.md) and its current argument parser expose repeatable Docker `--env`, `--volume`, `--mount`, and `--privileged` options. They do not expose a Docker `--network` option. Hive Mind can therefore propagate the persistent endpoint without patching the dependency, while operators with nested and outer daemons must make that endpoint routable in their deployment.

## Related work reviewed

- [Hive Mind PR #1477](https://github.com/link-assistant/hive-mind/pull/1477): centralized model maps and compatibility validation reused here.
- [Hive Mind PR #1186](https://github.com/link-assistant/hive-mind/pull/1186): Agent model support pattern.
- [Hive Mind PR #851](https://github.com/link-assistant/hive-mind/pull/851): Agent tool integration and command construction.
- [Hive Mind PR #1926](https://github.com/link-assistant/hive-mind/pull/1926): Docker isolation architecture.
- [Formal AI issue #655](https://github.com/link-assistant/formal-ai/issues/655) and [PR #679](https://github.com/link-assistant/formal-ai/pull/679): original Hive Mind rejection and the verified inner Agent ↔ Formal AI loop.
