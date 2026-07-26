# Architecture and operational plan

## Command flow

Formal AI selection changes only the executable prefix. Tool-specific Hive Mind arguments continue to be built by their existing executors:

```text
native:
  <tool-path> <existing tool arguments>

Formal AI, wrapper-owned temporary server:
  formal-ai with <tool> <existing tool arguments>

Formal AI, persistent server:
  formal-ai with --no-start-server --base-url <origin> <tool>
    <existing tool arguments>
```

This division of responsibility matters:

- Hive Mind owns issue loading, prompts, tool options, streaming, retries, PR verification, and lifecycle.
- Formal AI owns protocol selection and temporary client configuration.
- The native CLI owns its tool execution and output protocol.

The resolver is pure and shared by every executor. A non-Formal-AI model returns the exact configured native command, which limits regression risk.

## Validation

Ordinary tool preflights cannot validate Formal AI correctly because they probe the native model catalog. Formal selection instead runs:

```bash
formal-ai with --no-start-server <tool> --version
```

This validates both binaries without starting a server. Runtime server health remains a separate concern and is checked by Compose at `/health`.

## Prepare-only lifecycle

The historical `--only-prepare-command` path skipped early tool checks but continued far enough to perform post-execution PR verification. Each executor now returns a `preparedOnly` result immediately after logging the fully assembled command. `solve` recognizes that result and exits successfully before any AI process, GitHub mutation, or PR verification.

## Persistent container topology

```text
Compose network
├── hive-mind-solver
│   └── HIVE_MIND_FORMAL_AI_BASE_URL=http://link-assistant-formal-ai:8080
└── formal-ai
    ├── network: link-assistant-formal-ai
    ├── hostname: link-assistant-formal-ai
    ├── formal-ai serve --agent-mode :8080
    └── formal-ai-memory -> /home/box/.formal-ai
```

The service image extends `konard/hive-mind-dind`, so it begins with the same root Telegram/DinD runtime and all six native CLIs. Its memory file lives under the persisted home, fixing the reported reset-on-restart behavior.

For `--isolation docker`, Hive Mind resolves the outer Compose hostname `link-assistant-formal-ai` in the parent, then adds the resulting endpoint to start-command's repeatable `-e` arguments. This crosses the ordinary nested-daemon DNS boundary while retaining the requested stable name in the root deployment. Custom external names are not rewritten, preserving DNS, virtual-host routing, and HTTPS certificate verification. Network reachability is deployment-specific:

- A single daemon/shared network can use `link-assistant-formal-ai` directly.
- Nested DinD has a separate bridge and DNS namespace; the child receives the sidecar's parent-resolved address.
- A custom restrictive network policy may still require a separately routable origin in `HIVE_MIND_FORMAL_AI_BASE_URL`.

Adding a start-command network option was considered but is unnecessary for this topology and would require coordinated upstream JavaScript/Rust changes.

## Security

`--agent-mode` enables tool calls and should not be exposed publicly without network controls and Formal AI bearer-token configuration. The reference Compose service has no published host port; it is reachable only on the Compose network. The endpoint parser also rejects credentials, paths, query strings, fragments, and non-HTTP protocols so secrets cannot be embedded in logged command lines.
