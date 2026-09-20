# Case Study — Issue #2059: Formal AI dispatch

Snapshot date: 2026-07-26 UTC

- Issue: [link-assistant/hive-mind#2059](https://github.com/link-assistant/hive-mind/issues/2059)
- Pull request: [link-assistant/hive-mind#2108](https://github.com/link-assistant/hive-mind/pull/2108)
- Triggering Formal AI issue: [link-assistant/formal-ai#655](https://github.com/link-assistant/formal-ai/issues/655)
- Current researched Formal AI release: [v0.305.0](https://github.com/link-assistant/formal-ai/releases/tag/v0.305.0)

## Problem

Hive Mind 2.5.2 rejected `solve ISSUE_URL --tool agent --model formal-ai` during its own model validation, before Agent could use its built-in `formalai/formal-ai` provider. Subsequent issue comments expanded the scope to every agentic CLI Hive Mind can dispatch and requested a persistent Formal AI Docker service shared by Telegram and isolated `/solve` jobs.

The rejection and the desired execution belong to different layers:

```text
solve arguments
  -> Hive Mind model validation       (rejected formal-ai)
  -> tool-specific model mapping
  -> formal-ai with <tool>            (was never reached)
  -> temporary client configuration
  -> native agentic CLI
  -> Formal AI agent-mode server
```

Adding an alias only to Agent would remove the first rejection but would not configure Codex, Claude, OpenCode, Qwen, or Gemini. The current Formal AI wrapper already owns that cross-client configuration, so Hive Mind should delegate to it rather than duplicate six provider adapters.

## Shipped design

1. Both `formal-ai` and `formalai/formal-ai` validate for all six Hive Mind tools.
2. The short alias maps to the selector each native CLI expects:

   | Hive tool | Native model argument |
   | --------- | --------------------- |
   | Agent     | `formalai/formal-ai`  |
   | OpenCode  | `formalai/formal-ai`  |
   | Claude    | `formal-ai`           |
   | Codex     | `formal-ai`           |
   | Qwen      | `formal-ai`           |
   | Gemini    | `formal-ai`           |

3. Execution is wrapped as `formal-ai with <tool> ...`. An external endpoint adds `--no-start-server --base-url <origin>`.
4. `--only-prepare-command` now stops after the actual tool command is assembled, instead of continuing into PR verification.
5. A preflight checks the wrapper and selected CLI with `formal-ai with --no-start-server <tool> --version`, which cannot spend a model request or start a server.
6. Production, DinD, and Coolify images install pinned Formal AI 0.305.0. `Dockerfile.formal-ai` extends the root DinD/Telegram image and runs a persistent agent-mode server.
7. Compose names both the Docker network and service host `link-assistant-formal-ai`, uses the standard port 8080, and persists `/home/box/.formal-ai`.
8. Docker isolation forwards `HIVE_MIND_FORMAL_AI_BASE_URL` to every child solve container.

Existing defaults are deliberately unchanged; see [capability-gate.md](capability-gate.md).

## Reproduction and regression

Before the model-map fix, the matrix in `tests/test-issue-2059-formal-ai-dispatch.mjs` produced twelve validation failures. Before the wrapper implementation, its dispatch import failed. Before the container implementation, the endpoint-forwarding assertion failed and `Dockerfile.formal-ai` did not exist.

The final regression covers:

- short and full model selectors for every tool;
- per-tool model mapping;
- wrapper resolution and external-server flags;
- a real Agent command-preparation path that cannot execute the CLI;
- no-server preflight construction;
- endpoint propagation into Docker isolation;
- runtime image installation and persistent service assets.

## Documents

- [requirements.md](requirements.md) — exhaustive issue/comment requirements and resolution.
- [research.md](research.md) — online and repository evidence from primary sources.
- [architecture.md](architecture.md) — alternatives, command flow, container topology, and network boundary.
- [capability-gate.md](capability-gate.md) — why explicit dispatch ships now while default selection remains deferred.
- [data-snapshot.json](data-snapshot.json) — machine-readable source and timeline snapshot.
