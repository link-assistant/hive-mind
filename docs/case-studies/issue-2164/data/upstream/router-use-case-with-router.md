# Launch agentic CLIs temporarily with `with`

The safe default is a one-command, one-run configuration that never edits the
client's normal files:

```bash
router with codex "explain this repository"
# Equivalent standalone entry point:
with-router codex "explain this repository"
```

The wrapper creates an owner-only temporary directory, configures the selected
client below it, launches the real client process, propagates its exit status,
then removes the directory. Client failure and `Ctrl-C` still run cleanup. A
later invocation sweeps directories left behind by a wrapper killed with
`SIGKILL`.

## Clients and configuration surfaces

| Tool | Dialect and router base | Temporary isolation | Permanent target |
| --- | --- | --- | --- |
| `codex` | Responses, `URL/v1` | isolated `HOME` | `$CODEX_HOME/config.toml` or `~/.codex/config.toml` |
| `claude` (`claude-code`) | Anthropic Messages, `URL` | `CLAUDE_CONFIG_DIR` | `$CLAUDE_CONFIG_DIR/settings.json` or `~/.claude/settings.json` |
| `gemini` (`gemini-cli`) | Gemini native, `URL/api/gemini` | `GEMINI_CLI_HOME` | temporary only; API-key endpoint override is environmental |
| `grok` (`grok-cli`) | Chat Completions, `URL/v1` | isolated `HOME` plus environment | owner-only managed environment file |
| `opencode` | Chat Completions, `URL/v1` | `OPENCODE_CONFIG` | `$XDG_CONFIG_HOME/opencode/opencode.json` |
| `qwen` (`qwen-code`) | Chat Completions, `URL/v1` | isolated `HOME` | `$QWEN_HOME/settings.json` or `~/.qwen/settings.json` |
| `agent` | Chat Completions, `URL/v1` | temporary config content | `$XDG_CONFIG_HOME/link-assistant-agent/opencode.json` |
| `cursor-agent` (`cursor`) | Cursor Connect-RPC (`agent.v1` / `aiserver.v1`) | not implemented: router RPC adapter does not exist | none |

Each name is the command the client installs as, which is what your shell
already has; the descriptive form in parentheses is kept as an alias, so
`with claude-code` and `clients setup qwen-code` continue to work.

Each client-specific document keeps a binary-free manual path with the exact
environment variables or config fields. Cursor deliberately fails before
launch with the verified limitation instead of pretending a private protocol
can use an OpenAI URL.

## Arguments, interaction, and models

Wrapper options are accepted before or after the tool name. After an explicit
`--`, every remaining argument belongs to the tool, even when its name collides
with a wrapper option:

```bash
router with --non-interactive gemini "hi"
router with opencode run "hi"
router with codex --server https://router.example "hi"
router with codex -- --server client-owned-value
```

The explicit `--` is optional, but useful to make the boundary visible in
scripts. With client arguments, the wrapper selects the client's native
one-shot mode; use `--interactive` to suppress that behavior, or
`--non-interactive` to request it explicitly. `--model` overrides the registry
default. OpenAI-family clients default to `gpt-5.6-sol` with `xhigh` reasoning;
Claude Code defaults to `claude-opus-5` (`opus-5`) with a `high` thinking
effort. On adaptive-thinking Claude models this is sent as
`thinking.type=adaptive` plus `output_config.effort=high`; on legacy fixed-
budget models `high` maps to 16,384 thinking tokens and the router reserves
8,192 additional output tokens. Caller-supplied token limits and reasoning
settings take precedence. Before execution,
the wrapper fetches `/v1/models` with the run token
and refuses an unavailable model, listing the models the selected server
advertises.

## Selecting a server and token

Resolution is deterministic:

1. `--server` and `--token` / `--token-stdin`;
2. `LINK_ASSISTANT_ROUTER_URL` (or `ROUTER_URL`) and
   `LINK_ASSISTANT_ROUTER_TOKEN` (or `LINK_ASSISTANT_TOKEN`);
3. `router server use` configuration;
4. the shared managed local Docker container.

```bash
# Explicit remote server; starts nothing locally.
printf '%s\n' "$ROUTER_TOKEN" | \
  with-router --server https://router.example.internal --token-stdin codex "hi"

# Persist a selection. The token file is owner-readable only and never echoed.
printf '%s\n' "$ROUTER_TOKEN" | \
  router server use https://router.example.internal --token-stdin
router server status
router server use --clear
```

Passing `--token` is convenient but records the value in shell history. Prefer
stdin or the environment for a credential. An ordinary token is validated and
used unchanged. An admin credential is never given to the client: the wrapper
mints a short-lived ordinary token labelled with the client and working
directory, optionally applies `--run-max-requests`, and revokes it when the
client exits. Mint failure stops before client launch; a one-hour default TTL
is the crash backstop.

## Managed local Docker server

With no configured URL, one locked, shared container named
`link-assistant-router-managed` is created from
`ghcr.io/link-assistant/router:latest`. Its state lives in the named volume
`link-assistant-router-managed-data`. Concurrent wrappers register their PIDs;
the last live user stops the container but never removes it. A detached reaper
and next-run stale-PID pruning handle wrapper crashes.

```bash
router server status
router server start       # keep running explicitly
router server claim       # reveal and claim bootstrap admin once
router server stop        # preserves container and volume
router server remove      # refuses and explains credential loss
router server remove --yes
```

`remove --yes` permanently deletes issued tokens, logs, and authorized vendor
subscriptions from the managed volume. Docker-not-installed, stopped-daemon,
and socket-permission failures have separate remediation messages. Port 8080 is
used when free; otherwise an available loopback port is recorded. A container
with the managed name but without the ownership label is never adopted.

Inside another container, its own `localhost` is not the host. Supply a URL
reachable from that network, for example `--server
http://host.docker.internal:8080` where the runtime provides that hostname.

Before `server claim`, the router-minted bootstrap administrator remains in the
managed container's startup log. The wrapper reads it only to mint a
short-lived ordinary token; neither the host-side lifecycle state nor the
client receives it. `server claim` deliberately prints that credential once
and closes unattended minting. Existing runs keep their ordinary tokens, while
each later run must receive `--token`, `--token-stdin`, or
`LINK_ASSISTANT_ROUTER_TOKEN`. An ordinary token can be issued directly in the
managed container with:

```bash
docker exec link-assistant-router-managed router tokens issue \
  --ttl-hours 24 --label with-router
```

## Permanent configuration and exact undo

Permanent changes are opt-in:

```bash
router with --server https://router.example.internal --global codex
router with --global --undo codex
```

The first command saves the original bytes, ownership marker, and permissions.
Undo restores them exactly and removes wrapper-owned backups. If the user edits
the managed config after setup, undo refuses to overwrite those newer edits.
Tokens are not persisted in client configuration. Gemini, Grok, and Cursor
report their client-side permanent-configuration limitation and direct users
to the temporary or manual path.

## Quick verification

First check the selected router, then ask the client a tiny question:

```bash
curl -fsS https://router.example.internal/health
with-router --server https://router.example.internal --token-stdin codex "reply only: hi"
```

Expect the health check to identify a reachable router and the client to reply
`hi`. If no subscription is usable, the wrapper stops before launch and names
the `router auth <provider>` command to run on the router host.
