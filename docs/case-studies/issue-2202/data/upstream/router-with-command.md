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

A temporary run either **extends** the client's own configuration — adding
process-local connection variables or Codex CLI config overlays and nothing
else — or gives the client a **router profile**, when routing it depends on a
file the router writes. A profile is kept between runs under
`$XDG_CONFIG_HOME/link-assistant-router/clients/<client>/home`, so sessions
stay resumable and onboarding is answered once; `--isolated-config` makes it
disposable instead (issues #277, #298).

| Tool | Dialect and router base | Temporary run | Permanent target |
| --- | --- | --- | --- |
| `codex` | Responses, `URL/api/services/codex/v1` | extends your own through `-c` overlays | `$CODEX_HOME/config.toml` or `~/.codex/config.toml` |
| `claude` (`claude-code`) | Anthropic Messages, `URL/api/services/anthropic` | extends your own | `$CLAUDE_CONFIG_DIR/settings.json` or `~/.claude/settings.json` |
| `gemini` (`gemini-cli`) | Gemini native, `URL/api/services/gemini` | router profile | temporary only; API-key endpoint override is environmental |
| `grok` (`grok-cli`) | Chat Completions, `URL/api/services/openai/v1` | extends your own | owner-only managed environment file |
| `opencode` | Chat Completions, `URL/api/services/openai/v1` | router profile | `$XDG_CONFIG_HOME/opencode/opencode.json` |
| `qwen` (`qwen-code`) | Chat Completions, `URL/api/services/qwen/v1` | extends your own | `$QWEN_HOME/settings.json` or `~/.qwen/settings.json` |
| `agent` | Chat Completions, `URL/api/services/openai/v1` | router profile | `$XDG_CONFIG_HOME/link-assistant-agent/opencode.json` |
| `cursor-agent` (`cursor`) | Cursor Connect-RPC (`agent.v1` / `aiserver.v1`) | not implemented: router RPC adapter does not exist | none |

Each name is the command the client installs as, which is what your shell
already has; the descriptive form in parentheses is kept as an alias, so
`with claude-code` and `configure qwen-code` continue to work.

Each client-specific document keeps a binary-free manual path with the exact
environment variables or config fields. Cursor deliberately fails before
launch with the verified limitation instead of pretending a private protocol
can use an OpenAI URL.

For Codex, an ordinary temporary run leaves `HOME`, `CODEX_HOME`, the config
file, session history, personality, reasoning effort and MCP servers in place.
Repeatable global `-c` arguments select only the router provider for that
process, and `LINK_ASSISTANT_TOKEN` carries the credential. Use
`--isolated-config` when a disposable Codex home is intentionally required.

For Claude, the process overlay wins over persistent helper configuration: it
sets Router's URL/token, clears the higher-priority API key, enables gateway
discovery, and forces nonessential startup traffic on so the catalog request is
not suppressed. Native Anthropic catalogs leave model pins clear. A z.ai-only
catalog maps Default, every family and subagents to one exact live alias for
both new and resumed sessions; an explicit z.ai model wins. The real settings,
credentials, shell startup files, history and gateway cache remain
byte-identical. Claude Code 2.1.255 or newer is required for current aliases.

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
scripts.

**Session or task.** A bare positional is a prompt and selects the client's
native one-shot mode; a flag is an option passed to a session and does not.
Streams that are not a terminal are one-shot, so CI and pipelines need no flag.
`--interactive` and `--non-interactive` override the rule in either direction,
and when the mode is inferred from flags alone the wrapper says so on stderr.

```bash
router with claude "fix the tests"     # one-shot: a prompt was given
router with claude --resume <id>       # a session: --resume is an option
echo "hi" | router with claude         # one-shot: no terminal
```

**Model and effort.** `with` changes how the client reaches the model. Which
model that is, and how hard it thinks, are the user's own settings and are left
alone: no `--model`, no `MAX_THINKING_TOKENS`, no `model_reasoning_effort` and
no `OPENAI_REASONING_EFFORT` is passed unless asked for. The client's own
configuration decides, and the user's own environment variables reach it as
they would without the router.

`--model <id>` names one explicitly. `--pick-model` asks the router to choose
from the target's live catalog and reports what it picked and why. `opencode`,
`qwen` and `agent` are always given an id because their configuration embeds
the catalog and they cannot start without one. When a model is named, the
wrapper fetches the client's canonical `/api/services/*/models` route with the run token before execution and refuses an
unavailable one, listing what the selected server advertises.

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

When the administrator listener is separate, persist it explicitly while the
positional URL remains the client-facing inference origin:

```bash
printf '%s\n' "$ROUTER_ADMIN_TOKEN" | router server use \
  https://router.example \
  --management-server https://router-admin.example \
  --token-stdin
router with claude
```

The wrapper checks health and catalogs only on the inference listener, mints
and revokes only on the management listener, and exposes only the inference
origin to the launched client.

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

Permanent changes are opt-in, and have their own name:

```bash
router configure codex --server https://router.example.internal
router configure --undo codex
```

`with --global codex` and `with --global --undo codex` are the same command
under an older name and keep working — they map onto `configure` rather than
carrying a second implementation that can disagree with it.

The first command saves the original bytes, ownership marker, and permissions,
mints a credential from the target and stores it outside the client config at
mode 0600. Undo restores the file exactly, revokes that credential, and removes
wrapper-owned backups. If the user edits the managed config after setup, undo
refuses to overwrite those newer edits. Tokens are never persisted in client
configuration. Cursor and Gemini report their client-side limitation; Grok has
no persistent base-URL setting, so `configure grok` writes the credential file
that is its whole configuration and says to source it.

See [configure-clients.md](configure-clients.md) for the full surface.

## Quick verification

First check the selected router, then ask the client a tiny question:

```bash
curl -fsS https://router.example.internal/api/health
with-router --server https://router.example.internal --token-stdin codex "reply only: hi"
```

Expect the health check to identify a reachable router and the client to reply
`hi`. If no subscription is usable, the wrapper stops before launch and names
the `router auth <provider>` command to run on the router host.
