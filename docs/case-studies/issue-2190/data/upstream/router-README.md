# Link.Assistant.Router

A self-hosted gateway for policy-bound access to AI subscriptions and API
providers. Each task gets an independently expiring, revocable, rate-limited
`la_sk_…` token while the vendor credential stays inside the router.

Consumer subscriptions remain bound to their documented native client and one
subscriber principal: Claude OAuth to Claude Code, ChatGPT OAuth to Codex, and
Gemini/Qwen denied until their terms are recorded. Per-token budgets contain
runaway agents and make usage attributable. Ordinary API providers have their
own credential terms.

[![CI/CD Pipeline](https://github.com/link-assistant/router/actions/workflows/release.yml/badge.svg?branch=main)](https://github.com/link-assistant/router/actions/workflows/release.yml?query=branch%3Amain)
[![crates.io](https://img.shields.io/crates/v/link-assistant-router.svg?label=crates.io)](https://crates.io/crates/link-assistant-router)
[![Docker Hub](https://img.shields.io/docker/v/konard/link-assistant-router?label=docker%20hub)](https://hub.docker.com/r/konard/link-assistant-router)
[![docs.rs](https://img.shields.io/docsrs/link-assistant-router?label=docs.rs)](https://docs.rs/link-assistant-router)
[![Rust Version](https://img.shields.io/badge/dynamic/toml?url=https%3A%2F%2Fraw.githubusercontent.com%2Flink-assistant%2Frouter%2Fmain%2FCargo.toml&query=%24.package.rust-version&label=rust&prefix=v&suffix=%2B&color=blue)](https://www.rust-lang.org/)
[![License: Unlicense](https://img.shields.io/badge/license-Unlicense-blue.svg)](http://unlicense.org/)

## Overview

Link.Assistant.Router is a transparent proxy between API clients (such as
Claude Code) and vendor APIs. It provides an OpenRouter-like surface for
subscription credentials while keeping authorization, attribution, and
containment controls local to the operator.

- **Proxies all Anthropic API requests** transparently, including SSE/streaming responses
- **Supports Claude MAX (OAuth)** by reading Claude Code session credentials
- **Vendor subscriptions** — `UPSTREAM_PROVIDER=auto` discovers healthy credentials, then exposes only the models allowed for the token's signed client/principal; a second pre-upstream check prevents stale or forged selection
- **OpenAI-compatible endpoints** — `/api/services/openai/v1/chat/completions`, `/api/services/openai/v1/responses`, and `/api/services/openai/v1/models` translate to Anthropic or forward to a configured OpenAI-compatible provider
- **Optional Gonka upstream** — `UPSTREAM_PROVIDER=gonka` forwards OpenAI-compatible routes to Gonka instead of translating them to Anthropic
- **Optional Crater ForgeFed upstream** — `UPSTREAM_PROVIDER=crater` turns OpenAI chat requests into ForgeFed `Offer{Ticket}` tasks and waits for resolved task results
- **Optional LiteLLM/OpenAI-compatible upstream** — `UPSTREAM_PROVIDER=openai-compatible` routes OpenAI SDK traffic to a stored provider such as LiteLLM
- **Multi-account routing** — manage multiple account-bound credentials with session affinity, strict token pins, selection strategies, request caps, and `Retry-After`-aware cooldowns
- **Issues custom `la_sk_...` JWT tokens** with expiration/revocation plus immutable managed-client and subscriber bindings
- **Persistent token store** — text (Lino) **and** binary backends, both on by default; tokens survive restarts
- **Live observability** — Prometheus `/api/management/metrics`, JSON `/api/management/usage`, per-account state at `/api/management/accounts`, provider-verified credential state at `/api/management/auth/status`, subscription health at `/api/management/health/subscriptions`
- **`lino-arguments` + `.lenv`** — every flag has an env-var alias and an optional `.lenv` file fallback
- **First-class CLI** — `serve`, token/provider/account management, `configure <client>`, `clients list|show|remove|doctor|repair`, and deployment diagnostics
- **Replaces custom tokens with real OAuth credentials** internally, so the OAuth token is never exposed to clients
- **Runs as a single Docker container** for easy deployment

Every feature is **configurable** — conflicting design choices in upstream community proxies become toggles (`--routing-mode`, `--storage-policy`, `--disable-openai-api`, `--disable-anthropic-api`, `--disable-metrics`, `--experimental-compatibility`).

### Architecture

```
Client (Claude Code / API user)
   |
   |  Authorization: Bearer la_sk_...
   v
Link.Assistant.Router (Rust / axum)
   |
   |  Authorization: Bearer <real OAuth token>
   v
Anthropic API (api.anthropic.com)
```

When `UPSTREAM_PROVIDER=gonka`, clients still authenticate to the router with
`Authorization: Bearer la_sk_...`, but upstream OpenAI-compatible requests are
sent to the configured Gonka broker with its separate API key instead of the
client token. This project remains Link.Assistant.Router; Gonka is an optional
backend.

When `UPSTREAM_PROVIDER=openai-compatible`, clients still authenticate to the
router with `Authorization: Bearer la_sk_...` or `x-api-key: la_sk_...`. The
router forwards OpenAI-compatible requests to the configured provider, such as
a LiteLLM proxy, and substitutes only the upstream provider key inside the
router.

When `UPSTREAM_PROVIDER=crater`, `/api/services/openai/v1/chat/completions` accepts normal OpenAI
chat requests, delivers a ForgeFed `Offer` containing a `Ticket` to
`CRATER_FORGEFED_INBOX`, reads `Accept.result`, polls that task URI until
`isResolved:true`, and maps the resolved content back to OpenAI JSON or SSE.

### Vendor subscriptions (Codex, Gemini, Qwen)

With `UPSTREAM_PROVIDER=auto`, Router discovers every healthy credential but
returns a client-specific intersection from the client's canonical
`/api/services/*/models` route. The signed
`client_kind`, subscriber principal, native protocol evidence, model owner, and
credential health must all agree again at dispatch. Pinning a provider does not
bypass that rule. Generic/manual/admin/legacy tokens cannot spend a consumer
subscription.

| Provider | `UPSTREAM_PROVIDER` (aliases) | Credential home | Upstream |
| --- | --- | --- | --- |
| Claude | `anthropic` | `~/.claude/.credentials.json` | `api.anthropic.com` |
| Codex / ChatGPT | `codex` (`chatgpt`, `openai-codex`) | `~/.codex/auth.json` | ChatGPT backend Responses API |
| Gemini | `gemini` (`google`, `code-assist`) | `~/.gemini/oauth_creds.json` | Code Assist `generateContent` |
| Qwen | `qwen` (`qwen-code`, `dashscope`) | `~/.qwen/oauth_creds.json` | DashScope OpenAI-compatible |

The conservative entitlement matrix is Claude Code → Claude and Codex →
ChatGPT. Exact cross-client experimentation requires
`--allow-subscription-bridge CLIENT:PROVIDER`, emits a policy/account warning,
and is audited. Gemini and Qwen rows cannot be overridden until their consumer
terms are recorded. Protocol compatibility alone never grants access.

A trusted proxy may deliberately present a non-native caller under an existing
Codex-bound token with `--allow-proxied-client codex` (or
`PROXIED_CLIENT_OVERRIDES=codex`). This separate, default-off exception accepts
`X-Link-Assistant-Proxied-Client: codex` plus Bearer authentication for canonical Codex
`POST responses` without the native Codex CLI fingerprint. Canonical `GET
models` already accepts a Codex-bound token plus the ordinary
`X-Link-Assistant-Client: codex` classifier without the exception. It
neither grants a generic token subscription access nor enables any other Codex
route; proxied inference is marked in audit records when auditing is enabled.

The credential files are produced by each vendor's own CLI (run its `login`
once). The router refreshes expiring access tokens with the vendor's public
OAuth client. When the vendor rotates the refresh token, the router preserves
the vendor document's unrelated fields and atomically writes the new chain link
before using it. If that home is read-only, an owner-only recovery record under
`DATA_DIR/refresh-recovery` keeps the rotation durable and is reconciled later.
Refresh, native login, and import share one provider/account transaction lock;
if the lock or every durable destination is unavailable, the request fails
closed instead of serving a token whose rotation could be lost. Native Claude
and Codex login also keep a newly exchanged credential outside the primary,
durably advance its refresh chain, and require at least one model from the
vendor's non-inference catalog before atomic promotion. A `401`, empty or
malformed catalog, outage, or timeout leaves the previous primary bytes intact
and keeps the staged recovery evidence while exposing only an opaque transaction
identifier. `auth status` uses the same catalog-acceptance rule. An access-token refresh that leaves the
refresh link unchanged remains an in-memory cache entry, avoiding an unnecessary
write. Secrets are never logged. The canonical OpenAI
Chat Completions and Responses service routes are
translated to each backend's dialect (Codex uses the OpenAI Responses API;
Gemini uses the Code Assist envelope with synthesized SSE for streaming; Qwen is
OpenAI-compatible). Run `router doctor` to verify each credential file is
present and its token valid.

To pool subscriptions, set `ADDITIONAL_ACCOUNT_DIRS` to vendor-specific
credential homes. The active `UPSTREAM_PROVIDER` determines how every directory
is parsed. New sessions use `ACCOUNT_ROUTING_STRATEGY`; a session remains on its
chosen account for `SESSION_AFFINITY_TTL_SECS`, and an `la_sk_...` token issued
with an `account` claim is a strict pin. Automatic selection skips accounts
whose configured `ACCOUNT_REQUEST_LIMITS` cap is spent or whose upstream
returned HTTP 429. Pinned and session-bound requests fail instead of silently
changing identity.

## Quick Start

### Prerequisites

- [Rust 1.89+](https://www.rust-lang.org/tools/install) (for building from source)
- [Docker](https://docs.docker.com/get-docker/) (for containerized deployment)
- A Claude MAX subscription with an active Claude Code OAuth session

### 1. Install a released binary (Linux and macOS)

Every release publishes attested, checksummed archives for `linux-amd64`,
`linux-arm64`, `darwin-arm64`, and `darwin-amd64`. Pick the platform slice that
matches the machine, verify it, and install both binaries:

```bash
VERSION=$(gh release view --repo link-assistant/router --json tagName --jq '.tagName | ltrimstr("v")')
# macOS on Apple Silicon: darwin-arm64. Intel Macs: darwin-amd64.
PLATFORM=darwin-arm64
gh release download "v${VERSION}" --repo link-assistant/router \
  --pattern "link-assistant-router-${VERSION}-${PLATFORM}.*"

# Checksums, then the signed provenance of the build itself.
shasum -a 256 -c "link-assistant-router-${VERSION}-${PLATFORM}.sha256"
gh attestation verify "link-assistant-router-${VERSION}-${PLATFORM}.tar.gz" \
  --repo link-assistant/router

tar -xzf "link-assistant-router-${VERSION}-${PLATFORM}.tar.gz"
install -m 755 router with-router /usr/local/bin/
```

Updating is the same sequence with a newer `VERSION`: the archive contains only
the two binaries, so overwriting them in place leaves configuration untouched.
On Linux, `sha256sum -c` replaces `shasum -a 256 -c`.

### 2. Build from source

```bash
git clone https://github.com/link-assistant/router.git
cd router
cargo build --release
```

The binary will be at `target/release/link-assistant-router`.

#### Nix

The repository ships a flake, so a machine with Nix (flakes enabled) needs no
Rust toolchain of its own:

```bash
nix build                 # builds router, link-assistant-router and with-router
./result/bin/router --help

nix run . -- --help       # run the CLI without installing it
nix run . -- doctor
nix run .#with-router -- claude

nix develop               # dev shell with cargo, rustfmt, clippy and the
                          # native dependencies; cargo build/test/fmt/clippy
                          # all work inside it
nix flake check           # builds the package and checks formatting
```

Nix is an additional path, not a replacement: `cargo build`, the released
binaries, the Docker image and CI are unchanged.

### 3. Set up Claude Code credentials

The router reads OAuth credentials from the Claude Code home directory. By default, it looks in `~/.claude` for credential files. Make sure you have an active Claude Code session:

```bash
# Log in with Claude Code (this creates the session files)
claude
```

The router searches these files in order:
- `credentials.json`
- `.credentials.json`
- `auth.json`
- `oauth.json`
- `config.json`

**On macOS**, Claude Code keeps its live credential in the login Keychain
(`Claude Code-credentials`) and leaves `~/.claude/.credentials.json` behind as a
snapshot that nothing rotates. The router reads both and uses whichever is
newer, so it no longer reports a revoked subscription while the vendor client —
on the same account — keeps working. `router doctor` names the store each
credential came from (`store: keychain` or `store: file`). The Keychain is
consulted only for the default home, so a pooled account or a mounted
credential directory keeps reading exactly the file it was given.

Two on-disk layouts are supported automatically:

- **Nested** (the format real Claude Code writes to `~/.claude/.credentials.json`):

  ```json
  {
    "claudeAiOauth": {
      "accessToken": "sk-ant-oat01-...",
      "refreshToken": "sk-ant-ort01-...",
      "expiresAt": 1781050618000,
      "scopes": ["user:inference", "user:profile"],
      "subscriptionType": "max"
    }
  }
  ```

- **Flat** (convenient for tests and minimal setups):

  ```json
  { "accessToken": "sk-ant-oat01-..." }
  ```

For the nested layout the router reads `accessToken` and `expiresAt` from inside
`claudeAiOauth`. For the flat layout it reads `accessToken` (or `access_token`,
`oauthToken`, `oauth_token`) from the top level of the first file found. The
file is only ever read — the router never writes back to or deletes your
credential files.

### 4. Start the router

```bash
# Required: set the JWT signing secret
export TOKEN_SECRET=your-secure-secret-here

# Optional: customize port (default: 8080)
export ROUTER_PORT=8080

# Optional: set Claude Code home directory (default: ~/.claude)
export CLAUDE_CODE_HOME=~/.claude

# Optional: override upstream URL (default: https://api.anthropic.com)
export UPSTREAM_BASE_URL=https://api.anthropic.com

# Start the router
./target/release/link-assistant-router
```

You should see:

```
INFO Link.Assistant.Router v0.2.0
INFO Upstream: https://api.anthropic.com
INFO Claude Code home: /home/user/.claude
INFO Listening on 0.0.0.0:8080
```

### 5. Issue a Claude-bound client token

```bash
export ROUTER_ADMIN_TOKEN='<admin-token>'
export ROUTER_CLIENT_TOKEN="$(curl -fsS -X POST \
  http://localhost:8080/api/management/tokens/client \
  -H "Authorization: Bearer ${ROUTER_ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"client_kind":"claude","ttl_hours":24,"label":"manual-claude"}' \
  | jq -er .token)"
```

The response contains the canonical binding and subscriber principal alongside
the one-time token value:

```json
{
  "token": "<client-token>",
  "ttl_hours": 24,
  "label": "manual-claude",
  "client_kind": "claude",
  "principal_id": "primary"
}
```

An unbound token, a different client kind, or a provider the bound client is not
entitled to use is rejected before Router contacts an upstream.

### 6. Use the router as an Anthropic API proxy

```bash
# Select an exact model advertised to this same bound token.
MODEL="$(curl -fsS http://localhost:8080/api/services/anthropic/v1/models \
  -H "Authorization: Bearer ${ROUTER_CLIENT_TOKEN}" | jq -er '.data[0].id')"

curl -fsS http://localhost:8080/api/services/anthropic/v1/messages \
  -H "Authorization: Bearer ${ROUTER_CLIENT_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -H "User-Agent: claude-cli/2.1.259" \
  -d '{
    "model": "'"${MODEL}"'",
    "max_tokens": 100,
    "messages": [{"role": "user", "content": "Hello!"}]
  }' | jq .
```

The router will:

1. Validate the signed `claude` client binding, principal, request evidence,
   model ownership, and provider entitlement.
2. Replace only the Router authentication material with the upstream OAuth
   credential.
3. Strip ingress forwarding and client-IP metadata.
4. Preserve the other native client headers and body unchanged, without
   inventing a missing `anthropic-version` or `anthropic-beta` value.
5. Forward to the native Anthropic Messages resource and relay the response.

## Use-case documentation

Each supported scenario has its own document under
[docs/use-cases/](docs/use-cases/README.md), so you can read only the one you
need:

| Document | Scenario |
| --- | --- |
| [per-task-tokens.md](docs/use-cases/per-task-tokens.md) | One `la_sk_…` token per task — audit, monitoring, security, isolation |
| [audit-and-monitoring.md](docs/use-cases/audit-and-monitoring.md) | Aggregate `/api/management/metrics`, admin-only per-token `/api/management/usage`, and the JSONL audit log |
| [with-router.md](docs/use-cases/with-router.md) | Temporary-by-default one-line launcher, remote selection, managed Docker lifecycle, and exact global undo |
| [claude-max-in-codex.md](docs/use-cases/claude-max-in-codex.md) | Historical Claude MAX → Codex bridge, disabled by default behind one exact risk acceptance |
| [chatgpt-in-claude-code.md](docs/use-cases/chatgpt-in-claude-code.md) | Historical subscription bridge defaults superseded; API-key adapters remain separate |
| [zai-coding-plan.md](docs/use-cases/zai-coding-plan.md) | Experimental, subscriber-bound z.ai GLM Coding Plan routing with explicit policy acknowledgements |
| [lefine.md](docs/use-cases/lefine.md) | Lefine API-key provider with native Chat Completions/SSE, live exact IDs, and atomic credential acceptance |
| [cli-claude-code.md](docs/use-cases/cli-claude-code.md) | Claude Code configuration |
| [cli-codex.md](docs/use-cases/cli-codex.md) | Codex CLI configuration |
| [cli-qwen-code.md](docs/use-cases/cli-qwen-code.md) | Qwen Code configuration |
| [cli-gemini-cli.md](docs/use-cases/cli-gemini-cli.md) | Gemini CLI configuration |
| [cli-opencode.md](docs/use-cases/cli-opencode.md) | opencode configuration |
| [cli-grok-cli.md](docs/use-cases/cli-grok-cli.md) | Grok CLI configuration |
| [cli-agent.md](docs/use-cases/cli-agent.md) | Link.Assistant Agent configuration |
| [cli-cursor.md](docs/use-cases/cli-cursor.md) | Cursor CLI — **not implemented**, why, and what an adapter would take |

## Using with Claude Code

The supported consumer-subscription use case is routing a subscriber's managed
Claude Code through the proxy without exposing its Claude OAuth credential.

### Step 1: Start the router (on the server/host machine)

```bash
export TOKEN_SECRET=your-secure-secret
./target/release/link-assistant-router
```

### Step 2: Configure or launch the bound Claude client

```bash
router with claude
# or: router clients setup claude
```

The wrapper uses a persistent, owner-only Claude profile below Router's user
configuration directory. It does not copy or edit the normal Claude profile;
onboarding happens once and sessions started through Router remain resumable.
Use `--extend-global-config` before `claude` to opt into the normal Claude
profile, or `--isolated-config` for a disposable clean-room profile.

Claude Code 2.1.263 still resolves authentication once for the whole process:
the Router bearer and non-Anthropic base URL correctly route inference and
model discovery, but take precedence over a stored Claude.ai login. Router
therefore prints the exact limitation before launch and rejects explicit
Claude.ai-only operations (`--cloud`, `--environment`, `--remote-control`,
`--teleport`, and `ultrareview`) before server discovery or token minting.
Connectors, Remote Control, `/schedule`, notification preferences, cloud
sessions, remote managed settings, and organization policy are unavailable in
that Router-directed process. Run those operations directly with Claude.ai
authentication. Router never reads, copies, patches, logs, or deletes the
stored Claude login; a future Claude release is refused until its auth boundary
passes the pinned real-client review.

Reset only the Router-owned profile, retain a recoverable private backup, and
launch Claude against a new empty profile with:

```bash
router with --yes claude --reset-to-default-configuration
```

Omit `--yes` for an interactive confirmation. Reset refuses while another
Router-launched Claude process is using the profile.

### Step 3: Manual configuration only with an already bound token

```bash
# Set the base URL to point to the router
export ANTHROPIC_BASE_URL=http://your-server:8080/api/services/anthropic

# The token must carry client_kind=claude and the matching principal_id.
export ANTHROPIC_API_KEY=la_sk_eyJ0eXAi...
export CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1

# Run Claude Code normally — all requests go through the router
claude
```

Inference and `/v1/models` discovery use only the Router token. The native
Claude.ai services listed above are not proxied and remain unavailable until
Claude Code exposes an officially supported split-auth mechanism.

## API Endpoints

### Always available

| Endpoint | Method | Description |
|---|---|---|
| `/api/health` | GET | Liveness check, returns `ok` — independent of subscription health |
| `/api/management/health/subscriptions` | GET | (admin) Whether every configured subscription can serve |
| `/api/management/tokens` | GET/POST | (admin) List persisted tokens or issue a new one |
| `/api/management/tokens/revoke` | POST | (admin) Revoke a token by id |
| `/api/management/tokens/rotate` | POST | (admin) Issue a replacement admin token and revoke the caller's own |
| `/api/management/providers` | GET/POST | (admin) List or upsert OpenAI-compatible upstream providers |
| `/api/management/providers/{name}` | GET/DELETE | (admin) Show or delete one provider |

### Login surface (`--disable-login-api` to opt out)

Authorizes a deployment that has no credential file — see
[docs/use-cases/remote-login.md](docs/use-cases/remote-login.md). The optional
`provider` request field selects `claude` (the backwards-compatible default)
or `codex`. The optional `mode` field selects `full` (the default, requesting
Claude Code's whole scope set) or `setup-token` (the narrower `user:inference`
scope); `LOGIN_CLI_ARGS=setup-token` sets the deployment default. Both modes are
in-process OAuth and need no vendor CLI, so one image serves both. Codex
defaults to its device-code flow, which needs no callback port or vendor CLI;
its PKCE loopback flow remains available as a CLI fallback.

| Endpoint | Method | Description |
|---|---|---|
| `/api/management/login` | POST | (admin) Start a login; optional body: `{"provider":"claude"|"codex"}` |
| `/api/management/login/{id}` | GET | (admin) Status includes `awaiting_code` (Claude) or `awaiting_device` plus `user_code` (Codex) |
| `/api/management/login/{id}` | DELETE | (admin) Cancel a pending login and kill its process |
| `/api/management/login/{id}/code` | POST | (admin) Submit the code the human copied from the browser |

For a foreground login, use `router auth claude` or `auth codex`. Claude's
`--flow code` stores its pending PKCE login for 15 minutes, so the code can be
redeemed from a later process with `auth claude --flow code --code <code>`.
`auth status` reports each provider credential as `usable`, `expired`, or
`absent`. `auth codex` defaults to device authorization; `--flow device` or
`--flow loopback` makes the choice explicit. Unsupported forced flows fail
instead of falling back.

`auth` follows the server `server use` selected, exactly as `with` does: the
browser step still happens in front of you, but the credential is stored by the
router being targeted, so

```bash
router server use <url> --token-stdin
router auth claude
router with claude
```

does what it reads as. `--local` authorizes the local credential directory
instead, and `--server <url>` targets one router for a single command. A
selected server that cannot be reached is an error rather than a silent
fallback to a local directory.

For a deployment with separate listeners, `<url>` is always the public
inference origin and `--management-server <admin-url>` names the private
management origin. Management calls never fall back to the public listener,
and generated client configuration contains only the inference origin:

```bash
router server use https://router.example \
  --management-server https://router-admin.example --token-stdin
router configure claude
```

The equivalent one-shot forms accept the same `--management-server` option,
including `router with`, `router configure`, authentication/provider commands,
and `router clients setup --server <url> --management-server <admin-url>`.

`with` never rewrites the user's normal client files. Claude defaults to a
persistent Router-owned profile; use `--extend-global-config` to expose the
normal Claude profile explicitly. Other extensible clients receive only
process-local connection settings. Pass `--isolated-config` for CI and
clean-room reproductions, where a fresh directory is the point. A client
configured through a file rather than environment variables — Gemini CLI,
whose routing depends on a settings file the router writes — is given its own
Router profile regardless.

When nothing is selected at all, `with` and `auth` use a router that is already
listening on this machine — including one reached over an SSH tunnel — and only
start a managed container when none answers. The rule, in one sentence: if a
router is already listening locally, use it. Selection order is `--server`, then
`ROUTER_URL`/`LINK_ASSISTANT_ROUTER_URL`, then the persisted `server use`
selection, then a running local router, then a managed container. A discovered
endpoint is adopted only after the same `/api/health` check every other branch
performs, so an unrelated service on port 8080 is not mistaken for the router.
`router server status` names whichever one the next command will use, and
`--managed` forces a disposable container for CI and clean-room runs.

Persistent client setup is transactional: the client config, protected
environment, ownership metadata, and newly minted credential either commit
together or are rolled back together. A candidate minted before a catalog or
filesystem failure is revoked; a supplied/shared token is never revoked by a
failed setup. Repeating an unchanged successful setup reuses it without
minting another credential.

### Admin UI surface (`--admin-port` to opt in)

Served on a **separate listener** that does not exist unless you give it a port,
and on which every route but bootstrap and status requires the admin
credential — see [docs/use-cases/admin-ui.md](docs/use-cases/admin-ui.md).

| Endpoint | Method | Description |
|---|---|---|
| `/api/management/admin/status` | GET | (open) Credential state: claimed, bootstrap open, provisioned by environment |
| `/api/management/admin/bootstrap` | POST | (open while unclaimed) Mint a candidate token; authorises nothing on its own |
| `/api/management/admin/bootstrap/confirm` | POST | Activate the candidate, authenticated with the candidate token itself |
| `/api/management/admin/rotate` | POST | (admin) Mint a replacement admin credential and retire the current one |
| `/api/management/admin/summary` | GET | (admin) Version, upstream, accounts and credential state |
| `/` and static assets | GET | The embedded React console |

### Chat admin channels (`TELEGRAM_BOT_TOKEN` / `VK_BOT_TOKEN` to opt in)

Optional Telegram and VK bots that administer the router from a **private chat**
— they poll outward, so no inbound port is opened. They share the same
system-wide admin claim as the web UI: one first admin per deployment, claimed
in a browser *or* in a chat. See
[docs/use-cases/chat-admin-bots.md](docs/use-cases/chat-admin-bots.md).

| Env / flag | Description |
|---|---|
| `TELEGRAM_BOT_TOKEN` / `--telegram-bot-token` | Bot API token; present ⇒ the Telegram channel runs |
| `VK_BOT_TOKEN` / `--vk-bot-token` | VK community token (needs `VK_GROUP_ID`) |
| `VK_GROUP_ID` / `--vk-group-id` | VK community id the token belongs to |
| `CHAT_ADMIN_SECRET_TTL_SECS` / `--chat-admin-secret-ttl-secs` | Seconds before a message carrying a credential is deleted (default `120`) |
| `CHAT_ADMIN_RATE_LIMIT_PER_MINUTE` / `--chat-admin-rate-limit-per-minute` | Sensitive commands per user per minute (default `5`) |

### Anthropic surface (`--disable-anthropic-api` to opt out)

| Endpoint | Method | Description |
|---|---|---|
| `/api/services/anthropic/v1/models` | GET | Native client catalogue filtered by the signed Claude client policy |
| `/api/services/anthropic/v1/messages` | POST | Anthropic Messages — preserves SSE streaming |
| `/api/services/anthropic/v1/messages/count_tokens` | POST | Native token count, or explicit unavailable error on bridges without an exact counter |
| `/api/services/bedrock/invoke` | POST | Bedrock-format invoke |
| `/api/services/bedrock/invoke-with-response-stream` | POST | Bedrock streaming invoke |
| `/api/services/vertex/v1/projects/{project}/locations/{location}/publishers/anthropic/models/{model}:rawPredict` | POST | Vertex rawPredict pass-through |

### OpenAI surface (`--disable-openai-api` to opt out)

| Endpoint | Method | Description |
|---|---|---|
| `/api/services/openai/v1/chat/completions` | POST | Generic OpenAI Chat Completions service |
| `/api/services/openai/v1/responses` | POST | Generic OpenAI Responses service |
| `/api/services/openai/v1/models` | GET | Authenticated client/principal-specific intersection of healthy allowed models |
| `/api/services/{anthropic,openai,codex,qwen}/v1/models/{model}` | GET | Exact metadata for one currently visible model, without probing unknown IDs |
| `/api/services/{openai,codex,qwen}/v1/conversations[/{id}[/items[/{item_id}]]]` | GET/POST/PATCH/DELETE | Native Conversations resources with exact provider/account affinity |
| `/api/services/codex/v1/responses` | POST/WebSocket | Native Codex Responses, including stateful WebSocket sessions |
| `/api/services/codex/v1/alpha/{history,notes}/v2/*` | POST | Ten native Codex history/notes operations with exact account affinity and opaque byte-preserving responses |
| `/api/services/codex/v1/*` | GET/POST | Remaining registered Codex subscription routes |
| `/api/services/qwen/v1/*` | GET/POST | Qwen namespace; forwards its native OpenAI-compatible protocol |
| `/api/services/gemini/v1beta/models` | GET | Native Gemini model list filtered by the signed Gemini client policy |
| `/api/services/gemini/v1beta/models/{model}` | GET | Native Gemini model metadata |
| `/api/services/gemini/v1beta/models/{model}:generateContent` | POST | Native Gemini generation after exact client/provider entitlement |
| `/api/services/gemini/v1beta/models/{model}:streamGenerateContent` | POST | Native Gemini SSE response |
| `/api/services/vertex/v1/projects/.../models/{model}:generateContent` | POST | Native Vertex-style generation through Gemini Code Assist |

Provider-specific namespaces still enforce the matching signed client,
principal, protocol evidence, and healthy credential; pinning never grants
authority.

Codex's optional history/notes extension is activated through Router's
process-local `at-` identity; Router never creates or modifies Codex
`auth.json`. Its account handle is scoped to the signed Router principal and
resolved back to exactly one live ChatGPT account. History text, note paths,
searches, session/agent identifiers, encrypted output, and attachments remain
opaque and never enter request or audit logs; only a fixed operation name may
be audited as control-plane activity.

### Provider-neutral client surface

| Endpoint | Method | Description |
|---|---|---|
| `/api/models` | GET | Healthy model catalogue filtered by the signed client kind, principal, and provider entitlement |
| `/api/usage` | GET | Client-filtered limits, or an administrator's redacted all-configured subscription view |
| `/api/usage/{provider}` | GET | One authorized `anthropic`, `openai`, `z-ai`, `lefine`, `gemini`, or `qwen` usage/status record without revealing credentials or account identities |

`GET /api/models` is the additional provider-neutral catalogue. It accepts the
same Router client token carrier as that token's native client, then returns
only healthy models compatible with its signed client kind and principal. Each
entry carries the one lossless vendor `id` (including Gemini's `models/`
prefix when the live provider supplies it) and the canonical Router `service`
path segment. Repeated
entries from one provider are deduplicated; the same exact id claimed by two
providers returns HTTP 409 rather than choosing or inventing a qualified id.
Provider-reported context window, output cap, modalities, pricing, and
deprecation date are normalized when present and omitted when absent. Native
service catalogues remain in their original protocol shapes and contain no
Router ownership, health, degradation, conflict, fetch-time, or fallback
diagnostics. Anthropic model lists implement `after_id`, `before_id`, and
`limit` pagination over the final visible exact-ID catalogue.

With a client token, `GET /api/usage` uses the same signed client binding and
provider-entitlement matrix. With an administrative credential, the same path
returns a redacted all-configured view, which lets a persisted local, tunneled,
or remote server selection run `router usage` without replacing its management
credential or exporting a separate client token. Generic API-key providers are
not presented as subscriptions.

For a multi-account subscription pool, administrative output reports configured,
contributing, and unavailable account counts without account names. Comparable
used and remaining percentages are arithmetic means of available samples;
unavailable samples are excluded. Every aggregate window reports its contributor
count. A common reset remains `resets_at`; differing provider reset times remain
as `reset_times`, with no invented aggregate timestamp. A partial or entirely
unavailable pool is explicit in `status` and `state`.

The endpoint returns schema version `1` with normalized plan/status, usage
windows, used and remaining percentages, reset timestamps, named limits,
credits, and subscription or trial dates only when the vendor actually reports
them. Claude output includes current named windows, dynamic model-scoped limits,
and enabled monthly extra usage. Codex output retains main and additional
allow/reached state, both the stable metered feature and display name, safe
numeric message estimates, spend-control amounts and resets, the reached-limit
reason, and the read-only reset-credit count. An authorized configured credential that cannot currently be checked is
kept visible with an explicit `unavailable` or `unverified` state. Router reads
only the vendors' non-inference usage/profile endpoints, refreshes OAuth
credentials through the shared safe refresh path, briefly caches normalized
results, and honors `429 Retry-After`; checking usage consumes no model tokens.
Gemini and Qwen remain visible as `unverified` with
`live_limits_unavailable` and empty windows when no proven non-inference quota
endpoint exists; Router never substitutes an inference request or hard-coded
limit.
The response never includes credentials, account identifiers, email addresses,
credential documents, or unrestricted vendor response bodies. This client
surface is separate from the administrator-only `/api/management/usage`, which
contains Router's own request and token counters.

**Every advertised and routable model comes from current credential evidence.**
Consumer catalogs exist only after authenticated discovery for that exact
account, and are recorded with the account identity, the fetch time and an
explicit health flag. Before the first discovery a provider advertises nothing;
the canonical client catalog reports it under `degraded_providers` rather than
filling the gap from source. The experimental z.ai Coding Plan uses its
authenticated non-inference `/api/anthropic/v1/models` response as its live
source of truth; no source-code model allowlist filters it. When a credential
is revoked its last known catalog stays
visible to administrators but stops being advertised or routed.

The exact client-visible model identity is sent upstream unchanged. Automatic
routing uses current subscription/provider catalog records and the explicit
client compatibility attached to each owner, so one deployment can serve
vendor subscriptions and an ordinary OpenAI-compatible endpoint at once. A
same-ID collision between healthy owners fails explicitly with HTTP 409; Router
does not resolve it by provider order, model-name prefix, or a manufactured
`<provider>/<model>` alias. A model nothing
advertises returns `404 not_found_error` instead of silently selecting a
default. Buffered and streaming responses retain the requested identity
consistently; the concrete upstream response remains in the local request log.

#### Model identity and output limits

Responses always report the model id the client requested, including catalog
aliases such as `codex-auto-review`, in `model` — for buffered replies and for
every streamed chunk on each OpenAI surface. When the provider serves a
different concrete model, Router keeps that diagnostic in its local request
log instead of extending a vendor protocol with private fields or headers.

Codex subscriptions accept `max_output_tokens`, `max_tokens`, and
`max_completion_tokens`. The ChatGPT backend rejects an explicit cap, so the
router strips the field from the upstream request and enforces the cap itself:
visible output is truncated at the caller's budget and the exchange ends with
`finish_reason: "length"` on Chat Completions, or `status: "incomplete"` with
`incomplete_details.reason: "max_output_tokens"` on Responses. The budget is
estimated at roughly four characters per token, and hidden reasoning tokens are
not observable, so the cap bounds visible output rather than billed tokens.

With `UPSTREAM_PROVIDER=gonka`, `/api/services/openai/v1/chat/completions` and
`/api/services/openai/v1/responses` forward OpenAI-compatible JSON to Gonka
without Anthropic translation and relay SSE frames as they arrive. Availability
comes only from the broker's authenticated `GET /v1/models` response.
`GONKA_MODEL` is an optional request default and exact catalog narrowing rule;
it never invents a model absent from that live catalog. In automatic mode,
subscription, stored, and z.ai catalogs take precedence for an already-listed
canonical ID; a duplicate Gonka entry is omitted and dispatch follows the same
precedence.

With `UPSTREAM_PROVIDER=openai-compatible`, the same routes forward JSON to the
configured provider. This supports LiteLLM proxy deployments by setting the
provider base URL to the LiteLLM `/v1` API base. Streaming OpenAI requests are
passed through for OpenAI-compatible providers, and Anthropic-backed streaming
requests are translated to OpenAI SSE chunks.

With `UPSTREAM_PROVIDER=crater`, `/api/services/openai/v1/chat/completions`
supports normal JSON
responses and SSE with either request-body `"stream": true` or `?stream=true`.
The SSE stream emits OpenAI chat-completion chunks once the ForgeFed task
resolves.

### MPP charges for OpenAI endpoints

The OpenAI-compatible endpoints can advertise Machine Payments Protocol (MPP)
charges with HTTP `402 Payment Required`. Enable this only after configuring
the amount, currency, and recipient for your payment method:

```env
MPP_ENABLE=true
MPP_AMOUNT=0.05
MPP_CURRENCY=USD
MPP_RECIPIENT=acct_or_wallet
MPP_METHOD=stripe
```

When enabled, unpaid calls to `/api/services/openai/v1/chat/completions` and
`/api/services/openai/v1/responses`
return `WWW-Authenticate: Payment ...` with `protocol="mpp"` and
`intent="charge"`. This is separate from the ForgeFed/ActivityPub discovery
surface. Payment credential settlement is intentionally not accepted until a
method-specific verifier is configured.

### Observability (`--disable-metrics` to opt out)

| Endpoint | Method | Description |
|---|---|---|
| `/api/management/metrics` | GET | Admin Prometheus text-exposition aggregate counters, plus a subscription-health gauge |
| `/api/management/usage` | GET | Admin-only JSON snapshot, including per-token and per-account counters |
| `/api/management/accounts` | GET | Admin-only multi-account health: cooldowns, last error, used count, configured limit, and remaining requests |
| `/api/management/auth/status` | GET | Admin-only provider acceptance for every configured subscription credential; uses non-inference catalog probes |

`/api/management/metrics` deliberately contains no token ids, labels, or account names. The `link_assistant_subscription_healthy`
gauge is labelled by vendor name only, never by account, and answers `0` for a
subscription that is configured but cannot serve — the signal that turns a
silent multi-hour outage into an alert. Administrators can inspect per-token
usage in the `/api/management/usage` `token_calls` JSON map. Set `--audit-log` for a durable
JSONL trail of the same events. See
[docs/use-cases/audit-and-monitoring.md](docs/use-cases/audit-and-monitoring.md).

### POST /api/management/tokens

Issue a new custom JWT token.

**Request body:**

```json
{
  "ttl_hours": 24,
  "label": "my-token"
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `ttl_hours` | integer | 24 | Token lifetime in hours |
| `label` | string | `""` | Optional human-readable label |
| `scope` | string | `""` | `"admin"` mints a credential that also unlocks the admin endpoints; omit for an ordinary client token |

**Response:**

```json
{
  "token": "la_sk_eyJ0eXAi...",
  "ttl_hours": 24,
  "label": "my-token"
}
```

### Proxy Routes

Only canonical `/api/services/*` routes are forwarded to their corresponding
vendor API paths. Unknown routes and methods are
rejected locally rather than forwarded. The proxy:

- Validates the `Authorization: Bearer la_sk_...` or `x-api-key: la_sk_...` token
- Replaces it with the selected upstream credential
- On a native route, preserves the signed official client's end-to-end headers, real `user-agent`, version/session metadata, request JSON semantics, response bytes, and SSE sequence
- Removes authentication, hop-by-hop/framing, forwarding-IP, caller-cookie, and Router-internal headers; it never identifies itself upstream or synthesizes a missing official-client identity
- For canonical Codex traffic only, privately retains the official allowlist of Cloudflare infrastructure cookies across requests; account/session/auth cookies, custom bases, other providers, logs, and downstream responses never receive that state
- Restricts request/response transformations to an explicitly authorized cross-protocol bridge
- Preserves safe upstream status, request IDs, rate-limit fields, and other end-to-end response metadata

A reverse proxy necessarily changes the destination authority, source IP,
TLS/HTTP connection fingerprint, and transport framing such as
`content-length`. Native transparency is therefore application-protocol
transparency, not transport-level invisibility.

**Error responses** follow the Anthropic API error format:

```json
{
  "type": "error",
  "error": {
    "type": "authentication_error",
    "message": "Token has expired"
  }
}
```

| Status | Condition |
|---|---|
| 401 | Missing or invalid/expired token |
| 403 | Token has been revoked |
| 502 | OAuth token unavailable or upstream request failed |

## Configuration

Configuration is read by `lino-arguments` in this order: CLI flags,
environment variables, `.lenv`, then `.env`. The default file format is
Lino-style key/value notation:

```text
TOKEN_SECRET: your-router-token-secret
UPSTREAM_PROVIDER: openai-compatible
OPENAI_COMPATIBLE_PROVIDER_NAME: litellm
OPENAI_COMPATIBLE_BASE_URL: http://litellm:4000/v1
OPENAI_COMPATIBLE_MODEL: claude-sonnet
OPENAI_COMPATIBLE_MODELS: claude-sonnet,gpt-4o
OPENAI_COMPATIBLE_SUPPORTED_CLIENTS: opencode
```

Every flag listed in `--help` has an env-var alias and can be configured from
`.lenv` with the same env-var key.

### Core

| Flag / env | Default | Required | Description |
|---|---|---|---|
| `--token-secret` / `TOKEN_SECRET` | — | To serve, sign or encrypt | Secret key for signing/validating JWT tokens and encrypting stored provider keys. A command that only reads local files or acts on another deployment does not need one |
| `--port` / `ROUTER_PORT` | `8080` | No | Port to listen on |
| `--host` / `ROUTER_HOST` | `0.0.0.0` | No | Host/IP to bind to |
| `--claude-code-home` / `CLAUDE_CODE_HOME` | `~/.claude` | No | Primary Claude Code credentials directory |
| `--upstream-provider` / `UPSTREAM_PROVIDER` | `auto` | No | Automatically route by model across healthy credentials, or pin `anthropic`, `codex`, `gemini`, `qwen`, `gonka`, `crater`, `openai-compatible`, or `z.ai-coding-plan` |
| `--allow-subscription-bridge` / `SUBSCRIPTION_BRIDGE_OVERRIDES` | — | No | Repeatable exact `CLIENT:PROVIDER` risk acceptance, such as `codex:claude`; no broad compatibility switch exists |
| `--allow-proxied-client` / `PROXIED_CLIENT_OVERRIDES` | — | No | Repeatable reviewed proxy identity; currently only `codex`, permitting a Codex-bound Bearer token plus `X-Link-Assistant-Proxied-Client: codex` to call canonical Codex Responses without the native CLI fingerprint |
| `--upstream-base-url` / `UPSTREAM_BASE_URL` | `https://api.anthropic.com` | No | Upstream Anthropic API URL |
| `UPSTREAM_READ_TIMEOUT_SECS` | `120` | No | Seconds to wait for the *next byte* from an upstream before failing the request; `0` disables the bound. A long answer may legitimately stream for many minutes, but a backend that has gone silent must not leave a client waiting forever |
| `--api-format` / `UPSTREAM_API_FORMAT` | (auto) | No | Restrict the proxy to `anthropic` / `bedrock` / `vertex` |
| `--bridge-model` / `ANTHROPIC_BRIDGE_MODEL` | (from live catalog) | No | Upstream model used when the Anthropic service is served from a non-Anthropic upstream. Unset selects one from the account's live catalog ([details](docs/use-cases/chatgpt-in-claude-code.md)) |
| `--bridge-model-policy` / `BRIDGE_MODEL_POLICY` | `first-advertised` | No | How to pick that model from the catalog: `first-advertised` or `last-advertised`. When no compatible model exists the request fails with `model_selection_required` rather than falling back to a built-in name |
| `--audit-log` / `AUDIT_LOG` | (disabled) | No | Append one JSON line per authorised request (token id, label, provider, surface, path, model) to this file ([details](docs/use-cases/audit-and-monitoring.md)) |
| `--request-log` / `REQUEST_LOG` | `$DATA_DIR/requests` | No | Root directory for redacted per-token JSONL exchange logs, tied together by `correlation_id` |
| `--request-log-max-bytes` / `REQUEST_LOG_MAX_BYTES` | `104857600` (100 MiB) | No | Per-token request-log size bound; each token independently discards its oldest complete records first. The store's total is this bound times the number of tokens with recorded traffic — cap that with the row below |
| `--request-log-max-total-bytes` / `REQUEST_LOG_MAX_TOTAL_BYTES` | `4294967296` (4 GiB) | No | Bound across the whole request store; the least recently written token directories are removed first. `0` disables the total cap |
| `--max-proxy-request-bytes` / `MAX_PROXY_REQUEST_BYTES` | `67108864` (64 MiB) | No | Deliberate proxy request-body ceiling; independent of request-log capture and returns HTTP 413 when exceeded. Native Anthropic Files and Skills multipart uploads are bounded and spooled to temporary disk before relay; set this to `524288000` to permit Claude's full 500 MiB upload maximum, with matching free disk space |
| `--verbose` / `VERBOSE` | `false` | No | Verbose tracing |

### GitHub API credential proxy

The opt-in GitHub proxy lets an agent authenticate with its router-issued task
token while the real GitHub credential remains inside the router. The ordinary
HTTP/TLS listener serves REST, GraphQL, and git under the canonical
`/api/services/github/api/*`, `/api/services/github/api/graphql`, and
`/api/services/github/git/*` routes. GitHub CLI's fixed `/api/v3/*` and
`/api/graphql` paths, plus root `/git/*`, are aliases on the dedicated Unix
adapter only — see **GitHub CLI** below.

```env
GITHUB_PROXY_TOKEN_FILE=/run/secrets/github-token
# Or: GITHUB_PROXY_TOKEN=github_pat_...
# Optional enterprise/test upstream:
# GITHUB_PROXY_BASE_URL=https://github.example/api/v3
# Optional ordered JSON policy:
GITHUB_PROXY_POLICY=/etc/link-assistant/github-policy.json
```

No GitHub routes are mounted until a real upstream credential is configured.
Client `Authorization` is never forwarded; the router validates it as an
`la_sk_…` token and injects the operator credential upstream. Rate-limit and
request-id headers return to the client, while cookies and credentials do not.

Deletion, forced REST ref updates, GraphQL mutations whose operation deletes an
object, and forced GraphQL ref updates are denied by default. So are
destructive operations that do not spell their intent in the HTTP method:
`PUT` to branch protection or a repository ruleset, `POST` to repository
transfer, and a `PATCH` on a repository carrying `archived`, `private`,
`visibility` or `default_branch`. The principle is the effect, not the verb —
`PUT .../branches/{branch}/protection` replaces the whole protection object and
reaches the same end state as the `DELETE` beside it, and branch protection is
the control the rest of this policy leans on. An ordered policy
file can override a narrow operation without weakening the remaining defaults:

```json
{
  "rules": [
    {"effect":"allow", "method":"DELETE", "path":"/repos/acme/demo/issues/*"},
    {"effect":"deny", "method":"POST", "path":"/repos/acme/production/**"}
  ]
}
```

The first matching configured rule wins, then the built-in destructive policy
applies. `*` matches one path segment and `/**` matches the remainder. A blocked
call returns `403` with a GitHub-shaped `message` and
`x-link-assistant-policy: blocked`. This protects ref deletion and forced ref
updates over both the API and the git transport.

#### Git transport

Point a client at the router and its pushes answer to the same policy:

```bash
git config --global url."https://router.example.internal/api/services/github/git/".insteadOf "https://github.com/"
```

Ref deletions and forced updates to existing branches are **refused by
default**; creates and fast-forwards pass through, and a refusal is recorded in
the per-token `requests.lino` alongside the API calls. The caller never holds a
GitHub credential — the router presents its own upstream. To permit one ref
deliberately, add an allow rule naming it, which is a change only an operator
with access to the router can make:

```json
{"rules": [{"effect": "allow", "path": "/api/services/github/git/acme/demo/refs/heads/scratch"}]}
```

#### Scoping a token to repositories

A token may be restricted to named repositories, evaluated ahead of the rules
above:

```bash
router tokens issue --label agent-task --github-repo acme/demo
```

Omit `--github-repo` for unrestricted access, which is the default: the proxy
already keeps the operator credential out of the caller's hands, and narrowing
further is an opt-in. Rotation preserves the scope.

#### GitHub CLI

`gh` builds a custom host's REST base as `https://<host>/api/v3/` and will not
use Router's canonical `/api/services/github/...` prefix. Its compatibility
routes therefore live on the dedicated GitHub adapter socket, not on the
ordinary HTTP/TLS listener. Configure the socket and point `gh` at it:

```env
LISTEN_UNIX_SOCKET=/run/router/router.sock
```

```bash
gh config set http_unix_socket /run/router/router.sock
export GH_HOST=router.example.internal
export GH_ENTERPRISE_TOKEN="$LINK_ASSISTANT_TOKEN"
gh api rate_limit
gh issue list -R acme/demo
```

The host is only a routing label when `http_unix_socket` is set; traffic is
plain HTTP over the owner-only local socket. An ordinary Router TLS port does
not expose root `/api/v3`, `/api/graphql`, or `/git/*` aliases. Remote clients
should reach the adapter socket through a local sidecar or an explicitly
configured reverse proxy that maps those exact adapter routes.

The credential the proxy presents upstream can be taken from an existing `gh`
login instead of a separately minted token:

```bash
router auth gh --from-gh-config ~/.config/gh   # or --token-stdin
router auth gh --status
```

Every provider can be adopted the same way, which is how a headless deployment
is provisioned without a browser round-trip — run on the deployment itself,
where a login already exists or has been mounted:

```bash
router auth import claude        # from ~/.claude; a Keychain-only login is refused safely
router auth import codex         # from ~/.codex
router auth import gh            # from $GH_CONFIG_DIR, else ~/.config/gh
router auth import claude /path  # or name the source, read exactly as given
router auth import --all         # every login this machine has, in one step
router auth import codex --if-absent # install only while the destination is empty
router auth import codex --safe-refresh-chain-import-v1 # assert the safe contract
router auth import codex --json  # stable machine-readable recovery outcome
router auth import --resume <transaction-id> --json --local # retry retained state
```

Importing is a different operation from authorizing, not a variation of it:
authorizing goes and gets a new credential interactively, importing adopts one
that already exists. The per-provider flags (`--from-claude-home`,
`--from-codex-home`, `--from-gh-config`) keep working.

Import installs into the credential home of the machine running it, and no
router accepts a credential over HTTP, so it cannot provision a *different*
deployment. With another router selected it refuses and names that router and
the directory it reads from, rather than quietly acting here (issue #291). To
authorize a remote deployment from this machine, use `router auth claude` or
`router auth codex`, which do follow the selection.

The human report says what Router adopted — where it came from, when it expires,
and whether it carries a refresh token. `--json` instead emits one versioned
envelope whose `results` have stable `provider`, `outcome`, `phase`,
`previous_credential_safe`, and `transaction_id` fields. Outcomes are
`not_attempted`, `exchange_rejected`, `successor_retained`, `promoted`, and
`already_present`; phases are `preflight`, `exchange`, `persistence`, `catalog`,
and `promotion`. The JSON never includes diagnostic prose, credential documents,
access tokens, refresh tokens, or secret file contents. Operational failures
still use a non-zero process status.

Before anything reaches the destination, a fresh import proves the current
access token at the vendor's non-inference model catalog without calling the
OAuth token endpoint. It then installs an atomic reference to the one writable
vendor credential file, so Router and the vendor client advance the same
refresh chain. Expired or near-expiry, Keychain-only, read-only, rejected,
malformed, timed-out, or unreachable candidates fail without spending a refresh
token or changing the destination. Conditional provisioning that finds a
destination returns `already_present` before reading the candidate. A retained
`--resume` transaction is already Router-owned and keeps the isolated
refresh-chain recovery behavior and opaque transaction result described above.

Router includes Gemini CLI's public installed-app OAuth client configuration,
so an imported standard login needs no copied secret. A custom client remains
available by setting both `GEMINI_OAUTH_CLIENT_ID` and
`GEMINI_OAUTH_CLIENT_SECRET`; a partial override fails before a rotating refresh
token is spent.

Subscription imports use the same durable provider/account lock as refresh and
native login. Ordinary import is an explicit replacement operation.
`--if-absent` is the provisioning-safe form for Claude, Codex, Gemini, and Qwen:
it rechecks the destination and recovery sidecar while holding that lock and
never replaces a login that already exists or appeared while it waited. A
candidate must pass the same positive refresh-chain and catalog checks in both
modes; there is no force bypass. Deployment tooling can pass
`--safe-refresh-chain-import-v1` as a stable capability assertion: older Router
versions reject the flag, while versions that accept it guarantee
non-destructive access-token validation plus a locked atomic reference to one
writable authoritative source.

On macOS an unqualified Claude import still consults both the conventional file
and login Keychain. If the Keychain wins, import refuses before any provider
request because Router cannot durably update that store; let Claude Code renew
and expose a current writable file first. Naming a source directory means
*this* credential from *there*, so the machine-wide store is left out and the
named directory is read exactly as given. Without that distinction a pool of
per-account directories collapses onto whichever account happens to be logged
in interactively. Retained Router-owned transactions can be resumed with
`router auth import --resume <transaction-id> --local`; callers do not discover
or construct an internal path. To withdraw an installed credential:

```bash
router auth claude --clear     # or codex / gh
router auth status --clear-all # every identity, for decommissioning
```

### TLS

The router serves plain HTTP by default. Set a certificate pair to serve HTTPS
instead:

```env
TLS_CERT_FILE=/data/router/tls/cert.pem
TLS_KEY_FILE=/data/router/tls/key.pem
```

For a private deployment with no public hostname — an internal-only sidecar —
the router can generate its own certificate, including the network alias
clients actually reach it by:

```env
TLS_SELF_SIGNED=1
TLS_SELF_SIGNED_DNS=hive-mind-router
```

`router tls ca` prints the certificate so clients can trust it, and
`router tls generate --dns <names>` creates the pair without starting the
server. The generated pair is reused across restarts, so clients that trust it
keep working.

### Trusting the certificate

How a client is told to trust a self-signed certificate differs per client, and
for `gh` it differs per platform as well.

**`curl`** takes the certificate directly:

```bash
router tls ca > /tmp/router-ca.pem
curl --cacert /tmp/router-ca.pem https://router.internal:8080/api/health
```

**`git`** takes it through its own configuration:

```bash
git config --global http.https://router.internal.sslCAInfo /tmp/router-ca.pem
```

**`gh` depends on the platform,** because it is a Go program and Go resolves
roots differently per OS. On Linux (and the BSDs and Solaris) `crypto/x509`
reads `SSL_CERT_FILE` in `root_unix.go`, so the variable is all `gh` needs. On
macOS `root_darwin.go` goes to the Security framework instead and ignores it,
and `gh` has no `--cacert` flag, so the PEM cannot be handed to it at all:

```bash
router tls ca > /tmp/router-ca.pem
export SSL_CERT_FILE=/tmp/router-ca.pem   # Linux/BSD; ignored on macOS
gh api user
```

Every client that must trust the certificate, and the setting that does it:

| Client | Setting | Platform |
| --- | --- | --- |
| `curl` | `--cacert /tmp/router-ca.pem` | all |
| `git` | `http.<url>.sslCAInfo`, or `GIT_SSL_CAINFO` | all |
| `gh`, `codex` | `SSL_CERT_FILE` | Linux/BSD only |
| Claude Code and other Node clients | `NODE_EXTRA_CA_CERTS` | all |

On macOS, or wherever you would rather not distribute a CA at all, two routes
work, in order of how little they ask:

1. **A unix socket** — `gh` honours `http_unix_socket`, and over a socket it
   speaks plain HTTP, so no certificate is involved at all. This is the
   recommended path for a local or sidecar deployment, and the only one that
   works for `gh` on macOS:

   ```env
   LISTEN_UNIX_SOCKET=/run/router/router.sock
   ```

   ```bash
   gh config set http_unix_socket /run/router/router.sock
   export GH_HOST=router.internal          # any name; the socket decides the route
   export GH_ENTERPRISE_TOKEN="$LINK_ASSISTANT_TOKEN"
   gh api user
   ```

   The socket is owner-only by default, so it bounds access at least as tightly
   as the loopback port it replaces. When the client runs as another uid — a
   router sidecar serving task containers — widen it deliberately rather than
   with `chmod 0666`:

   ```env
   LISTEN_UNIX_SOCKET=/run/router/router.sock
   LISTEN_UNIX_SOCKET_MODE=0660
   LISTEN_UNIX_SOCKET_GROUP=1000          # name or numeric gid
   ```

   Access is then bounded by that one gid rather than by every account on the
   host. Modes wider than `0666` are refused. The router keeps serving its TCP
   port as well.

2. **A real certificate** via `TLS_CERT_FILE`/`TLS_KEY_FILE`, which is the right
   answer for a shared or multi-user host: nothing has to be trusted specially,
   because the certificate already chains to a public root.

Installing the generated certificate into the OS trust store also works, but it
is a machine-wide change that an operator may not be permitted to make on a
shared host — so it is a last resort rather than the documented path.

### Gonka provider

Gonka support is optional. Configure an OpenAI-compatible Gonka broker with an
API key, then set `UPSTREAM_PROVIDER=gonka` to pin the deployment to it. With
`UPSTREAM_PROVIDER=auto`, compatible clients can also route exact IDs from its
live catalog alongside other healthy providers.

```env
TOKEN_SECRET=your-router-token-secret

UPSTREAM_PROVIDER=gonka
GONKA_API_KEY=your_gonka_broker_api_key
GONKA_SOURCE_URL=https://your-gonka-broker.example
# Optional exact default/narrowing rule:
GONKA_MODEL=your-current-gonka-model
```

| Flag / env | Default | Required | Description |
|---|---|---|---|
| `--gonka-api-key` / `GONKA_API_KEY` | — | Yes, for Gonka | Bearer key for the configured Gonka-compatible broker |
| `--gonka-private-key` / `GONKA_PRIVATE_KEY` | — | Unsupported | Direct-wallet mode is rejected before startup; Router does not implement the official endpoint-resolution and secp256k1 signing protocol |
| `--gonka-source-url` / `GONKA_SOURCE_URL` | — | Yes, with `GONKA_API_KEY` | Explicit Gonka-compatible broker URL; official direct-wallet nodes are not assumed to accept broker API keys |
| `--gonka-model` / `GONKA_MODEL` | — | No | Default model when omitted and exact narrowing of the live catalog; never a synthetic catalog entry |

Direct-wallet credentials must be used through an implementation of Gonka's
official protocol, such as a compatible broker. Router will not substitute its
own signature format, and deliberately has no official-node URL default in
broker mode.

### Crater ForgeFed provider

Crater support is optional. It keeps router-issued `la_sk_...` tokens at the
edge, then uses ForgeFed to submit work to a remote ticket tracker or exchange.

```env
TOKEN_SECRET=your-router-token-secret

UPSTREAM_PROVIDER=crater
CRATER_FORGEFED_INBOX=https://tracker.example/inbox
CRATER_FORGEFED_TARGET=https://tracker.example/projects/demo
# Optional; defaults to ACTIVITYPUB_ACTOR_BASE_URL/api/services/activitypub/actor/code
CRATER_FORGEFED_ACTOR=https://router.example/api/services/activitypub/actor/code
```

| Flag / env | Default | Required | Description |
|---|---|---|---|
| `--crater-forgefed-inbox` / `CRATER_FORGEFED_INBOX` | — | Yes, for Crater | Remote ForgeFed inbox that receives `Offer{Ticket}` activities |
| `--crater-forgefed-actor` / `CRATER_FORGEFED_ACTOR` | `${ACTIVITYPUB_ACTOR_BASE_URL}/api/services/activitypub/actor/code` | No | Local actor URI used in outbound activities |
| `--crater-forgefed-target` / `CRATER_FORGEFED_TARGET` | inbox URI | No | Ticket tracker or project URI used as `Offer.target` |
| `--crater-poll-interval-ms` / `CRATER_POLL_INTERVAL_MS` | `1000` | No | Delay between task URI polls |
| `--crater-poll-timeout-secs` / `CRATER_POLL_TIMEOUT_SECS` | `120` | No | Maximum wait for `isResolved:true` |

### OpenAI-compatible / LiteLLM provider

Generic OpenAI-compatible providers are used when
`UPSTREAM_PROVIDER=openai-compatible`. The boot-time config can come from
`.lenv`, env vars, or CLI flags:

```text
TOKEN_SECRET: your-router-token-secret
UPSTREAM_PROVIDER: openai-compatible
OPENAI_COMPATIBLE_PROVIDER_NAME: litellm
OPENAI_COMPATIBLE_BASE_URL: http://litellm:4000/v1
OPENAI_COMPATIBLE_API_KEY_ENV: LITELLM_MASTER_KEY
OPENAI_COMPATIBLE_MODEL: claude-sonnet
OPENAI_COMPATIBLE_MODELS: claude-sonnet,gpt-4o
OPENAI_COMPATIBLE_SUPPORTED_CLIENTS: opencode
```

| Flag / env | Default | Required | Description |
|---|---|---|---|
| `--openai-compatible-provider-name` / `OPENAI_COMPATIBLE_PROVIDER_NAME` | `litellm` | No | Stored provider name to resolve |
| `--openai-compatible-base-url` / `OPENAI_COMPATIBLE_BASE_URL` | `http://localhost:4000/v1` | No | Upstream OpenAI-compatible `/v1` API base |
| `--openai-compatible-api-key` / `OPENAI_COMPATIBLE_API_KEY` | — | No | Inline upstream key; prefer persisted provider storage for long-lived secrets |
| `--openai-compatible-api-key-env` / `OPENAI_COMPATIBLE_API_KEY_ENV` | — | No | Environment variable containing the upstream key |
| `--openai-compatible-model` / `OPENAI_COMPATIBLE_MODEL` | — | No | Default model injected when requests omit `model` |
| `--openai-compatible-models` / `OPENAI_COMPATIBLE_MODELS` | — | No | Comma-separated models exposed from the authenticated service catalog |
| `--openai-compatible-supported-clients` / `OPENAI_COMPATIBLE_SUPPORTED_CLIENTS` | — | Yes for client access | Canonical clients whose reviewed adapter may use this ordinary provider; missing compatibility exposes no models and dispatch fails closed |

An ordinary provider is healthy only after its authenticated, non-inference
`GET /v1/models` succeeds. Router preserves those exact IDs and vendor metadata;
configured `models` can narrow that live result but cannot invent availability.
Catalog listing and dispatch therefore use the same intersection of live
provider health, live models, configured restrictions, signed client binding,
and `supported_clients`. Missing evidence fails locally before inference.

Persistent provider records live in `<DATA_DIR>/providers.lenv`. Inline
provider API keys are encrypted with AES-GCM using a key derived from
`TOKEN_SECRET`; API responses and CLI output only show whether a stored key is
present. `providers add` replaces the same name by default; `--if-absent`
atomically keeps an existing record instead. Policy-gated providers are staged,
validated with their non-inference catalogue, and promoted only after positive
acceptance, so a rejected candidate cannot displace a working credential.

The personal z.ai Coding Plan is deliberately **not** a generic provider. It is
experimental, disabled by default, single-subscriber, and requires separate
provider/client policy acknowledgements. See
[zai-coding-plan.md](docs/use-cases/zai-coding-plan.md) for the exact setup,
live catalog, exact model IDs, endpoints, and account-ban warning.

Lefine is a dedicated encrypted API-key kind for native OpenAI Chat
Completions clients. It validates new keys through the live non-inference
catalog, preserves native JSON/SSE behavior, and falls back only to exact
operator-configured IDs after a later catalog outage. See
[lefine.md](docs/use-cases/lefine.md).

```bash
router providers add \
  --name litellm \
  --base-url http://litellm:4000/v1 \
  --model claude-sonnet \
  --models claude-sonnet,gpt-4o \
  --supported-client opencode \
  --api-key "$LITELLM_MASTER_KEY"

router providers list
router providers show litellm
router providers remove litellm
```

Provider records can also be imported from JSON, provider-store `.lenv`, or an
indented Links-style config:

```text
litellm
  kind "openai-compatible"
  base-url "http://litellm:4000/v1"
  model "claude-sonnet"
  models "claude-sonnet,gpt-4o"
  supported-clients "opencode"
  api-key-env "LITELLM_MASTER_KEY"
```

The HTTP API accepts the same shape at `POST /api/management/providers`:

```json
{
  "name": "litellm",
  "kind": "openai-compatible",
  "base_url": "http://litellm:4000/v1",
  "default_model": "claude-sonnet",
  "models": ["claude-sonnet", "gpt-4o"],
  "supported_clients": ["opencode"],
  "api_key_env": "LITELLM_MASTER_KEY"
}
```

### Routing & storage

| Flag / env | Default | Description |
|---|---|---|
| `--routing-mode` / `ROUTING_MODE` | `direct` | `direct` (OAuth substitution), `cli` (Claude CLI subprocess), or `hybrid` |
| `--storage-policy` / `STORAGE_POLICY` | `both` | Persistent token store: `memory`, `text` (Lino), `binary`, or `both` |
| `--data-dir` / `DATA_DIR` | platform-specific | Where `tokens.lino` / `tokens.bin` live |
| `--claude-cli-bin` / `CLAUDE_CLI_BIN` | (unset) | Local Claude CLI binary used by the `cli` backend, and by the last rung of credential recovery. Unset leaves that rung inert, so the router never spends the subscription on its own behalf |
| `--codex-cli-bin` / `CODEX_CLI_BIN` | (unset) | Local Codex CLI binary used by the last rung of credential recovery |
| `ROUTER_VENDOR_REFRESH_ARGS` | per provider | Override the recovery probe for every provider, whitespace separated |
| `ROUTER_VENDOR_REFRESH_ARGS_CLAUDE` / `_CODEX` | per provider | Override the recovery probe for one provider; wins over the global form |
| `--additional-account-dirs` / `ADDITIONAL_ACCOUNT_DIRS` | (empty) | Comma-separated extra credential homes for the active subscription provider |
| `--account-routing-strategy` / `ACCOUNT_ROUTING_STRATEGY` | `round-robin` | New-session policy: `round-robin`, `priority`/`fill-first`, or `least-used`/`quota-first` |
| `--account-cooldown-secs` / `ACCOUNT_COOLDOWN_SECS` | `60` | Minimum cooldown after a quota response; a longer upstream `Retry-After` wins, capped at 24 hours |
| `--session-affinity-ttl-secs` / `SESSION_AFFINITY_TTL_SECS` | `3600` | Inactive seconds before a conversation can be assigned again; `0` disables affinity |
| `--account-request-limits` / `ACCOUNT_REQUEST_LIMITS` | (unknown) | Comma-separated request caps, primary first then extras; must match pool size, and `0` means unknown/unlimited |

#### Storage formats and ownership

Router-owned token state uses the associative stack. `tokens.lino` is a
portable Links Notation projection produced by `lino-objects-codec`, with each
record represented as `Type → SubType → Value`. `tokens.bin` is the same
semantic links network in a native `doublets` store backed by file-mapped
`platform-mem`. The `text`, `binary`, and default `both` policies select those
two projections; `memory` remains non-persistent. Hand-built `tokens.lino`
files and `LARTOK01` JSON containers from earlier releases are loaded and
atomically converted on first open.

Other files keep the format of the boundary they serve:

- Provider/client credentials and client settings such as
  `.credentials.json`, `auth.json`, `settings.json`, and `config.toml` are
  vendor-owned interoperability files. The router continues to read or update
  the vendor's expected shape.
- Per-token `requests/<token-hash>/requests.lino` files are router-owned and
  are written in Links Notation, one record per line: `((:"phase"
  "client_request") (:"model" "claude-opus-5") …)`. The one-record-per-line
  framing is unchanged, so log collectors and `grep` work exactly as before,
  and strings are written as themselves rather than base64 — a model name is
  still findable with `grep`. Records an earlier release wrote as JSON are read
  unchanged, so no conversion step is required.
- The file was called `requests.jsonl` through v0.123.1, when it already held
  Links Notation. It is now named for what it holds. An existing log is renamed
  on its token's next write; a token that has not been written since keeps its
  history under the old name and is still read. Nothing is rewritten and
  nothing is discarded — if a collector tails these files by name, point it at
  `requests.lino`.
- The optional audit JSONL stays JSON Lines. It is an interoperability
  boundary, not router-owned state: it exists to be consumed by log collectors
  and `jq`, and the documented recipes in
  [audit-and-monitoring.md](docs/use-cases/audit-and-monitoring.md) pipe it
  straight into `jq`.
- `providers.lenv` is the router's existing portable provider configuration
  interchange. Moving additional router-owned state onto doublets can be done
  independently of the token migration.

### Feature toggles

| Flag / env | Default | Description |
|---|---|---|
| `--disable-openai-api` / `DISABLE_OPENAI_API` | off | Hide OpenAI-compatible `/api/services/*` routes |
| `--disable-anthropic-api` / `DISABLE_ANTHROPIC_API` | off | Hide Anthropic and Bedrock service routes |
| `--disable-metrics` / `DISABLE_METRICS` | off | Hide management metrics, usage, and account routes |
| `--disable-login-api` / `DISABLE_LOGIN_API` | off | Hide `/api/management/login*` |
| `--login-cli-command` / `LOGIN_CLI_COMMAND` | `claude` | Compatibility backend driven on a PTY. The default value spawns nothing: both login modes run in-process |
| `--login-cli-args` / `LOGIN_CLI_ARGS` | (none; full scopes) | Comma-separated arguments for that program; set `setup-token` to make the narrow `user:inference` mode the deployment default |
| `--login-session-ttl-secs` / `LOGIN_SESSION_TTL_SECS` | `900` | How long a pending login waits for its code before expiring |
| `--login-max-sessions` / `LOGIN_MAX_SESSIONS` | `4` | Maximum simultaneously pending logins; beyond it, `429` |
| `--experimental-compatibility` / `EXPERIMENTAL_COMPATIBILITY` | off | XML history, model spoofing and other community-proxy behaviours |
| `--admin-key` / `TOKEN_ADMIN_KEY` | — | Flat bootstrap Bearer key accepted by `/api/management/*` alongside admin-scoped tokens |
| `--allow-anonymous-admin` / `ALLOW_ANONYMOUS_ADMIN` | off | Opt back into unauthenticated management access (**not recommended**) |
| `--admin-port` / `ADMIN_PORT` | — (disabled) | Port for the admin UI listener; no port, no admin surface |
| `--admin-host` / `ADMIN_HOST` | `127.0.0.1` | Address the admin UI listener binds, independent of the proxy |
| `--admin-claim-ttl-secs` / `ADMIN_CLAIM_TTL_SECS` | `120` | Lifetime of an unconfirmed admin bootstrap candidate |
| `--mpp-enable` / `MPP_ENABLE` | off | Return MPP `402 Payment Required` challenges on OpenAI endpoints |
| `--mpp-amount` / `MPP_AMOUNT` | `0.00` | Per-request MPP charge amount |
| `--mpp-currency` / `MPP_CURRENCY` | `USD` | Currency or asset for MPP charges |
| `--mpp-recipient` / `MPP_RECIPIENT` | — | Recipient wallet, merchant account, or payment address |
| `--mpp-method` / `MPP_METHOD` | — | Optional MPP payment method identifier |

### CLI subcommands

The command is `router`. Installing also puts `link-assistant-router` on `PATH`,
the name used before v0.92.0, so existing scripts and deployment units keep
working; the two are the same program and either may be used.

```bash
# Default: starts the HTTP server (same as `serve`).
router

# Issue / list / revoke / show tokens. These act on the router this machine is
# pointed at: local by default, or a selected deployment over its admin API.
# `--local` acts here, `--server <URL>` names one.
router tokens issue --ttl-hours 168 --label alice
# ...optionally cap how many upstream requests the token may make:
router tokens issue --ttl-hours 168 --label alice --max-requests 500
# ...cap actual input + output tokens and bursts as well:
router tokens issue --label alice --max-tokens 100000 --rate-limit-per-minute 10
router tokens list
router tokens list --json
router tokens revoke <id>
router tokens expire <id>
router tokens rotate <id> --ttl-hours 168
router tokens show <id>

# Inspect configured accounts:
router accounts list

# Manage OpenAI-compatible upstream providers:
router providers add --name litellm --base-url http://litellm:4000/v1 --model claude-sonnet
# ...the vendor key never has to travel through argv:
pass show litellm/key | router providers add --name litellm --base-url http://litellm:4000/v1 --api-key-stdin
router providers import providers.lenv
router providers list

# Point a local agentic CLI at this router permanently:
router configure claude
router configure --all
router configure --undo claude

# Inspect and manage what is configured (read-only commands need no secret):
router clients list
router clients show codex
router clients doctor codex
router clients remove codex

# Show subscription limits visible to one signed client token. The environment
# token takes precedence over a saved server token.
LINK_ASSISTANT_TOKEN=<client-token> router usage
LINK_ASSISTANT_TOKEN=<client-token> router usage anthropic
LINK_ASSISTANT_TOKEN=<client-token> router usage openai --json
LINK_ASSISTANT_TOKEN=<client-token> router usage z-ai
LINK_ASSISTANT_TOKEN=<client-token> router usage lefine --json
LINK_ASSISTANT_TOKEN=<client-token> router usage gemini --json
LINK_ASSISTANT_TOKEN=<client-token> router usage qwen --json

# A selected server may retain its administrative credential. No extra token
# is needed: the Router returns its redacted all-configured/pool view.
router server use https://router.example --token-stdin
router usage --json
router usage anthropic

# Print resolved configuration + credential / store probes. Reports on the
# machine it runs on, so with another router selected it says so and names it.
router doctor --local
```

### Logging

The router uses `tracing` with the `RUST_LOG` environment variable:

```bash
# Default: info level
RUST_LOG=info ./target/release/link-assistant-router

# Debug level for detailed request tracing
RUST_LOG=debug ./target/release/link-assistant-router

# Trace level for maximum verbosity
RUST_LOG=trace ./target/release/link-assistant-router
```

`RUST_LOG` overrides the default `info` level (or the `debug` fallback selected
by `--verbose`). Every HTTP request also writes a structured exchange to
`$DATA_DIR/requests/<token-hash>/requests.lino` by default. Client and upstream
phases share an `x-request-id`/`correlation_id` and carry the token hash, id,
and label. Missing or invalid credentials use the explicit `unauthenticated`
directory. Credentials longer than the safety threshold retain three leading
and trailing characters with a fixed `*` mask; shorter values are replaced
with `[REDACTED]`. The same helper handles headers, URI query parameters, and
JSON bodies, and no complete credential is logged. Request bodies larger than
10 MiB continue to the handler but are omitted from the log. Directories and
files use owner-only permissions on Unix. `REQUEST_LOG_MAX_BYTES` applies to
each token independently, so one caller cannot evict another's history — which
also means the store's total is that bound times the number of tokens that have
recorded traffic. `REQUEST_LOG_MAX_TOTAL_BYTES` bounds the store as a whole,
removing the least recently written token directories first, so a deployment
that has issued many short-lived tokens cannot grow past what the operator
budgeted for the partition.

## Docker Deployment

### Build the image

```bash
docker build -t link-assistant/router .
```

### Run the container

```bash
docker run -d \
  -p 8080:8080 \
  -e TOKEN_SECRET=your-secure-secret \
  -v /path/to/claude-code-home:/data/claude:ro \
  link-assistant/router
```

The Dockerfile sets `CLAUDE_CODE_HOME=/data/claude` by default, so mount your Claude Code session directory to `/data/claude`.

### Credential lifecycle in a container

The single image intentionally contains no vendor CLI. It performs Claude OAuth and refresh in-process:

| Operation | Needs the Claude CLI in the image? | Mount mode |
| --- | --- | --- |
| Serve requests with a valid access token | No | `:ro` |
| Renew an **expired** access token | No — the router exchanges the `refreshToken` itself | `:ro` when `DATA_DIR` is writable (see below) |
| **First-time login** (no credential file yet) | No — native OAuth | writable |
| `POST /api/management/login` (remote login over HTTP) | No — native OAuth | writable |

The router exchanges the `refreshToken` stored in the mounted credential file against Anthropic's token endpoint and serves from the result, so serving continues across expiry. The same mechanism covers Codex, Gemini, and Qwen.

One case needs a durable writable destination. Vendors **rotate** refresh tokens: the refresh response often carries a replacement and spends the old one. When that happens the router writes the new token back to the credential file — on every refresh path, not only the catalog poll — so a restart does not replay a spent token. On a `:ro` credential mount, the router atomically writes an owner-only recovery sidecar below writable `DATA_DIR` and reconciles it into the vendor file later. If neither destination can accept the rotation, the refresh fails closed and the new access token is not served. Mount the credential directory writable to avoid relying on the recovery sidecar.

Two things still require a real login: a directory with no credential file at all, and a `refreshToken` that has itself been revoked or expired.

#### When a refresh is rejected

Rotation makes the credential file shared mutable state: the vendor CLI, a second router, and this process each hold a link in one chain, and only the newest link is redeemable. Redeeming an older one answers `invalid_grant`, which looks exactly like revocation but is not. Rather than concluding "revoked" from that answer, the router climbs a ladder (issue #239):

1. **Refresh before expiry.** A token within five minutes of expiring is renewed before it is used, so the rejected-token path is entered far less often.
2. **Re-read the credential.** The whole read → refresh → write cycle is held under an advisory lock on a sidecar lock file, and the file is rewritten atomically, so two holders serialise instead of racing and an interrupted write leaves the previous credential intact.
3. **Retry once with a newer link.** If the store has moved forward while the exchange was in flight, the router adopts what is on disk and retries once — the common case stops being a mandatory re-login.
4. **Ask the vendor client.** Only when that provider's binary is configured — `--claude-cli-bin` for Claude, `--codex-cli-bin` for Codex: the vendor's own client is run once, and if it rotates the chain the router adopts the credential it wrote. The invocation, the client's own (self-redacting) debug log, and the exchange the router itself sent — header names with values, body field *names* without them — are journalled, so the undocumented protocol can be reproduced from the log alone. Token values are never logged.

   **This rung bills inference.** The probe is a real request to the vendor — one word to the smallest model (`claude -p ok --model claude-haiku-4-5`, `codex exec ok`) — because that is what forces a refresh. A status command does not: with an expired credential, `claude auth status` can report `loggedIn: true` and leave the credential untouched, while the model probe takes the refresh path (issue #275). Override the command with `ROUTER_VENDOR_REFRESH_ARGS_CLAUDE` / `ROUTER_VENDOR_REFRESH_ARGS_CODEX` if a future client version offers something cheaper that still rotates the chain — and measure it the same way before trusting it. Leaving the binary unset keeps the rung inert and costs nothing.
5. **Report precisely.** Only then is the subscription reported as rejected, and operator logs distinguish a revoked credential from a lost rotation race and give the re-authentication command. Public health, model, and routing responses use fixed provider-only summaries; they never expose credential paths, account identities, or upstream response bodies.

### Logging in from inside a container

The regular image can authorize itself without a preinstalled Claude CLI:

```bash
# Log in once into a named volume (interactive, needs a writable mount)
docker run -it --rm \
  -v claude-home:/data/claude \
  ghcr.io/link-assistant/router:latest auth claude

# Then run the router against that volume
docker run -d \
  -p 8080:8080 \
  -e TOKEN_SECRET=your-secure-secret \
  -v claude-home:/data/claude \
  ghcr.io/link-assistant/router:latest
```

If native OAuth fails, `auth claude` downloads the current Claude Code package
through bun into a temporary cache, completes the compatibility flow, and
removes that cache. Force this path with `auth claude --flow cli`.

The release pipeline verifies that `ghcr.io/link-assistant/router` is publicly
pullable without credentials. On the first package publication, the publishing
job fails closed if GitHub created the package as private. An organization owner
must open the package settings, change its visibility to **Public**, and rerun
the failed job. GitHub does not currently provide a package-visibility API, so
this one-time bootstrap cannot be automated safely.

### Docker Compose example

```yaml
version: "3.8"
services:
  router:
    build: .
    ports:
      - "8080:8080"
    environment:
      TOKEN_SECRET: ${TOKEN_SECRET}
      ROUTER_PORT: "8080"
    volumes:
      # `:ro` is supported while DATA_DIR stays writable for recovery sidecars.
      # Drop `:ro` when authorizing from the container or to reconcile directly.
      - ${HOME}/.claude:/data/claude:ro
    restart: unless-stopped
```

### VPS Deployment

To deploy on a VPS (e.g., Ubuntu):

```bash
# 1. Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env

# 2. Clone and build
git clone https://github.com/link-assistant/router.git
cd router
cargo build --release

# 3. Set up Claude Code credentials on the VPS
# (log in with Claude Code to create session files)
claude

# 4. Create a systemd service (optional, for auto-start)
sudo tee /etc/systemd/system/link-assistant-router.service > /dev/null <<EOF
[Unit]
Description=Link.Assistant.Router
After=network.target

[Service]
Type=simple
User=$USER
Environment=TOKEN_SECRET=your-secure-secret
Environment=ROUTER_PORT=8080
Environment=CLAUDE_CODE_HOME=/home/$USER/.claude
ExecStart=/home/$USER/router/target/release/link-assistant-router
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable link-assistant-router
sudo systemctl start link-assistant-router

# 5. Check status
sudo systemctl status link-assistant-router
journalctl -u link-assistant-router -f
```

### Resilient reverse SSH tunnel

The companion [`docker/tunnel/Dockerfile`](docker/tunnel/Dockerfile) runs
`autossh` as a non-root user and republishes the router on a far-side host. It
fails fast with a diagnostic naming any missing required variable and uses SSH
keepalives plus `ExitOnForwardFailure`, allowing the container restart policy
and `autossh` to recover a dropped connection.

```bash
docker build -f docker/tunnel/Dockerfile -t link-assistant-router-tunnel .
docker run --restart unless-stopped \
  --network router-network \
  -e TUNNEL_SSH_HOST=far.example \
  -e TUNNEL_SSH_USER=router \
  -e TUNNEL_REMOTE_PORT=18080 \
  -e TUNNEL_SSH_KEY=/run/secrets/ssh-key \
  -e TUNNEL_KNOWN_HOSTS=/run/secrets/known-hosts \
  -v /path/to/tunnel-key:/run/secrets/ssh-key:ro \
  -v /path/to/pinned-known-hosts:/run/secrets/known-hosts:ro \
  link-assistant-router-tunnel
```

The remote bind defaults to loopback. Set `TUNNEL_REMOTE_BIND` only when the
far-side SSH server is deliberately configured to expose remote forwards.
Host verification is strict and fail-closed: `TUNNEL_KNOWN_HOSTS` must point to
a readable, non-empty file containing the pinned far-side host key.

### Akash and Kubernetes

Ready-to-edit deployment templates are included for hosted environments:

- [Akash SDL](deploy/akash/deploy.yaml)
- [Kubernetes manifests](deploy/k8s/router.yaml)

Replace placeholder secrets, set `ACTIVITYPUB_ACTOR_BASE_URL` to the public
router URL, and mount or provision Claude Code credentials at
`CLAUDE_CODE_HOME` before exposing the service.

## ForgeFed Integration

The router exposes ActivityPub/ForgeFed endpoints for service discovery and
problem-source federation. See [docs/forgefed.md](docs/forgefed.md) for the
actor document, inbox, follow activity, and deployment verification steps.

## Token System

The router uses JWT-based custom tokens with the `la_sk_` prefix.

### Token lifecycle

1. **Issue**: `POST /api/management/tokens` creates a signed JWT with a UUID subject, expiration, optional label, and optional per-token request, token-spend, and rate controls
2. **Validate**: Each proxy request extracts the `Authorization: Bearer la_sk_...` header, strips the prefix, and verifies the JWT signature and expiration
3. **Meter**: Each admitted request increments `used_requests`; successful upstream usage payloads add actual input and output tokens to `used_tokens`. Reaching `max_requests`, `max_tokens`, or `rate_limit_per_minute` returns `429 Too Many Requests` before another request is forwarded
4. **Revoke**: Tokens can be revoked by their subject ID. Records (including the revoked flag and usage counter) are written to the persistent token store, so revocations and usage survive restarts

### Token format

Tokens are standard HS256 JWTs with the `la_sk_` prefix. The JWT payload contains:

```json
{
  "sub": "550e8400-e29b-41d4-a716-446655440000",
  "iat": 1710806400,
  "exp": 1710892800,
  "label": "my-token",
  "scope": "admin"
}
```

`scope` is absent (or empty) on an ordinary client token and `"admin"` on an
administrative one — see [Admin access](#admin-access).

### Admin access

The `/api/management/*` endpoints — and every other endpoint marked *(admin)* above
— are **closed by default**. Three things can open them:

1. **An admin-scoped token.** It is an ordinary `la_sk_…` JWT carrying
   `"scope": "admin"`, so it expires, has an identity (`sub`), shows up in
   `tokens list`, and can be revoked and rotated like any other token.

   ```bash
   # CLI
   router tokens issue --admin --ttl-hours 168 --label ops
   # HTTP (from an existing admin credential)
   curl -s -X POST http://localhost:8080/api/management/tokens \
     -H "Authorization: Bearer $ADMIN" -H "Content-Type: application/json" \
     -d '{"ttl_hours": 168, "label": "ops", "scope": "admin"}' | jq -r .token
   ```

   Rotation is a single step — mint the replacement and revoke the credential
   that asked for it:

   ```bash
   router tokens rotate <sub> --ttl-hours 168 --label ops
   curl -s -X POST http://localhost:8080/api/management/tokens/rotate \
     -H "Authorization: Bearer $ADMIN" -H "Content-Type: application/json" -d '{}' | jq .
   ```

2. **The flat `--admin-key` / `TOKEN_ADMIN_KEY`.** Still supported unchanged as
   a bootstrap and compatibility credential for deployments that configure
   everything externally, and now compared in constant time. It carries no
   identity or expiry, so it cannot rotate itself (`/api/management/tokens/rotate` answers
   `400`); prefer an admin-scoped token for day-to-day use.

3. **Nothing at all** — only if you pass `--allow-anonymous-admin`
   (`ALLOW_ANONYMOUS_ADMIN=1`). This restores the historical wide-open
   behaviour and is logged as a warning at startup.

When neither an admin key nor an active admin token exists, the router mints
one on startup and prints it **once**:

```
Admin token (shown once, store it now): la_sk_eyJ0eXAi...
```

A client token presented to an admin endpoint is rejected: authorisation is by
scope, not by "any valid token". The converse also does not hold: `scope=admin`
manages Router but is not an inference superset. Without an immutable managed
client/subscriber binding it cannot list or spend consumer subscriptions. The
same boundary applies to the flat `TOKEN_ADMIN_KEY`.

#### The first-visitor claim

The web UI and the chat bots (Telegram, VK) share one system-wide first-visitor
claim, and it produces an ordinary admin-scoped `la_sk_…` JWT — the credential
model above, not a parallel one. The two-phase handshake is unchanged: phase one
mints the candidate **already revoked**, so an undelivered mint authorises
nothing and cannot brick the deployment; confirming it activates the credential,
closes bootstrap on every channel, and retires the startup `bootstrap-admin`
token by id, so the Tokens table, the CLI and the bots all show it revoked.

`POST /api/management/admin/bootstrap` and
`POST /api/management/admin/rotate` accept an optional
`{"ttl_hours": n}` body to limit the credential lifetime (capped at one year;
omitted means the cap). Expiry and revocation are enforced on the same path as
every other token. Rotation is atomic: the replacement is minted and the
previous credential revoked by id under the claim lock.

Deployments claimed by an older version still hold an opaque `la_admin_…`
credential. It keeps working, `doctor` warns about it, and the first
`/api/management/admin/rotate` converts the claim into a JWT.

### Per-token containment controls

Each token can cap request count, actual upstream-reported input plus output
tokens, and requests per minute. Managed launch/setup tokens also bind one
client adapter and subscriber principal. Generic tokens below remain useful for
ordinary API-key/Gonka/Crater routes but cannot consume vendor subscriptions.

```bash
# CLI
router tokens issue --ttl-hours 24 --label scoped-agent \
  --max-requests 100 --max-tokens 100000 --rate-limit-per-minute 10

# HTTP: same, via the admin endpoint
curl -s -X POST http://localhost:8080/api/management/tokens \
  -H "Content-Type: application/json" \
  -d '{"ttl_hours":24,"label":"scoped-agent","max_requests":100,"max_tokens":100000,"rate_limit_per_minute":10}' | jq .
```

- Omitting `--max-requests` / `max_requests` leaves the token **unlimited**.
- Omitting `--max-tokens` / `max_tokens` leaves actual token spend unlimited.
  Counts come from vendor response `usage` fields and are persisted across
  restarts.

  When a cap is set the router **reserves** each request's declared output
  budget before dispatching it, so a single response cannot push the persisted
  total past the cap. A request is admitted only while
  `used + reserved + this request's budget <= max_tokens`; one that cannot fit
  is rejected up front with `429` rather than truncated mid-answer. The
  reservation is released and replaced by the real figure once the response
  completes, and is also released when a request fails, is cancelled, or
  reports no usage. Because reserving happens inside the same atomic
  read-modify-write that counts the request, concurrent requests cannot
  overshoot together. Actual usage is always recorded in full, so a provider
  that reports more than the caller declared (hidden reasoning tokens, for
  example) can still land above the cap by that provider-side excess — bounded
  by one request's surplus rather than unbounded. `tokens list` shows reserved
  alongside actual spend.
- Omitting `--rate-limit-per-minute` / `rate_limit_per_minute` disables the
  per-token one-minute request window.
- Usage is counted per forwarded request and persisted in the token store, so
  the budget is enforced across restarts.
- When the budget is exhausted the router responds with
  `429 Too Many Requests` and a `rate_limit_error` body
  (`{"error":{"message":"Token has reached its request limit",...}}`) instead of
  forwarding upstream.
- `tokens list` shows `requests` and `tokens` as `used/max` plus the configured
  `rpm`; each credential has independent counters and a separate rate window.

### Security notes

- The `TOKEN_SECRET` must be kept secure — anyone with the secret can forge tokens
- OAuth tokens from the Claude Code session are never exposed to clients
- Tokens are validated on every request
- Use a strong, random secret (e.g., `openssl rand -hex 32`)
- Pair short TTLs with `max_tokens` and a per-minute rate to give each task a tightly scoped,
  self-expiring credential

## Testing

### Run all tests

```bash
cargo test
```

This runs the unit, integration, release-workflow, and documentation tests,
including account affinity/caps, provider-scoped token caching, request-routing
metadata, protocol translation, metrics, and configuration validation.

### Run specific test suites

```bash
# Unit tests only
cargo test --lib

# Integration tests only
cargo test --test integration_test

# A specific test
cargo test test_token_roundtrip

# With verbose output
cargo test -- --nocapture
```

### Code quality checks

```bash
# Check formatting
cargo fmt --check

# Run Clippy lints
cargo clippy --all-targets --all-features

# All checks together
cargo fmt --check && cargo clippy --all-targets --all-features && cargo test
```

### Manual end-to-end testing

Use the provided script to test the router locally:

```bash
# Make the script executable
chmod +x scripts/test-manual.sh

# Run manual tests (starts the router, issues a token, tests endpoints)
./scripts/test-manual.sh
```

Or test manually step by step:

```bash
# Terminal 1: Start the router with a test credential file
mkdir -p /tmp/test-claude
echo '{"accessToken": "test-oauth-token"}' > /tmp/test-claude/credentials.json
export TOKEN_SECRET=test-secret
export CLAUDE_CODE_HOME=/tmp/test-claude
export UPSTREAM_BASE_URL=https://api.anthropic.com
cargo run

# Terminal 2: Test the endpoints

# 1. Health check
curl -s http://localhost:8080/api/health
# Expected: ok

# 2. Issue a token
TOKEN=$(curl -s -X POST http://localhost:8080/api/management/tokens \
  -H "Content-Type: application/json" \
  -d '{"ttl_hours": 1, "label": "test"}' | jq -r '.token')
echo "Token: $TOKEN"

# 3. Test proxy with token (will get auth error from Anthropic since test-oauth-token is not real)
curl -s http://localhost:8080/api/services/anthropic/v1/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model": "claude-sonnet-4-20250514", "max_tokens": 10, "messages": [{"role": "user", "content": "Hi"}]}' | jq .

# 4. Test without token (should get 401)
curl -s http://localhost:8080/api/services/anthropic/v1/messages | jq .

# 5. Test with invalid token (should get 401)
curl -s http://localhost:8080/api/services/anthropic/v1/messages \
  -H "Authorization: Bearer la_sk_invalid" | jq .
```

### Run the example

```bash
cargo run --example basic_usage
```

This demonstrates token issuance, validation, and revocation programmatically.

## Project Structure

```
.
├── .github/workflows/
│   └── release.yml           # CI/CD pipeline (lint, test, build, release)
├── changelog.d/              # Changelog fragments (per-PR documentation)
├── docs/                     # Documentation
│   ├── use-cases/            # One document per supported scenario / CLI
│   ├── case-studies/         # Per-issue research, requirements, solution plans
│   └── adr/                  # Architecture decision records
├── examples/
│   └── basic_usage.rs        # Token management example
├── scripts/
│   ├── test-manual.sh        # Manual end-to-end testing script
│   ├── bump-version.rs       # Version bumping utility
│   ├── check-file-size.rs    # File size validation
│   └── ...                   # Other CI/CD scripts
├── src/
│   ├── lib.rs                # Library root — re-exports modules
│   ├── main.rs               # Binary entry point — Cli dispatch + server setup
│   ├── cli.rs                # `lino-arguments`-based CLI parser + subcommands
│   ├── config.rs             # CLI/env/.lenv configuration
│   ├── crater.rs             # Crater ForgeFed task provider
│   ├── oauth.rs              # Claude Code OAuth credential reader
│   ├── accounts.rs           # Multi-account router (round-robin/priority/least-used + cooldowns)
│   ├── app_state.rs          # Shared HTTP handler state
│   ├── storage.rs            # Persistent token store (text Lino + binary backends)
│   ├── providers.rs          # OpenAI-compatible provider store + encrypted secrets
│   ├── proxy.rs              # Transparent API proxy with token swap, OpenAI shim, ops endpoints
│   ├── request_routing.rs    # Session/account routing signal extraction
│   ├── openai.rs             # OpenAI <-> Anthropic translation helpers
│   ├── anthropic_bridge.rs   # Anthropic Messages served from OpenAI-dialect upstreams
│   ├── anthropic_stream.rs   # OpenAI SSE -> Anthropic SSE translator
│   ├── audit.rs              # Per-token JSONL audit log
│   ├── claude_identity.rs    # Claude Code identity block required by Claude MAX OAuth
│   ├── metrics.rs            # Atomic counters, Prometheus rendering, JSON snapshots
│   └── token.rs              # Custom JWT token management (la_sk_...)
├── tests/
│   └── integration_test.rs   # Integration tests
├── experiments/              # Local end-to-end harnesses (see docs/case-studies/)
├── Cargo.toml                # Project configuration and dependencies
├── Dockerfile                # Multi-stage Docker build
├── CHANGELOG.md              # Project changelog
├── CONTRIBUTING.md           # Contribution guidelines
├── LICENSE                   # Unlicense (public domain)
└── README.md                 # This file
```

### Build cache

A debug build links many integration-test binaries plus the `[[bin]]` targets
and evicts nothing, so `target/` can grow without bound. Two things keep it in
check, and both are automatic:

- `.cargo/config.toml` disables the incremental cache and drops debug info to
  line tables. Backtraces still resolve; stepping through variables in a
  debugger does not.
- The last `pre-commit` hook runs `scripts/clear-build-cache.sh`, which uses
  `cargo clean` to remove the checkout's build output after formatting, lint,
  and tests finish:

  ```bash
  pre-commit install
  ```

- An optional `post-commit` hook also runs
  `scripts/sweep-build-artifacts.sh` to prune superseded artifacts during
  workflows that bypass the pre-commit checks. It needs `cargo-sweep`:

  ```bash
  cargo install cargo-sweep
  pre-commit install --hook-type post-commit
  ```

  Without `cargo-sweep` the post-commit hook prints a note and does nothing; it
  never fails a commit. The pre-commit `cargo clean` remains unconditional.

To reclaim space by hand, run `cargo clean`. The next build is intentionally a
cold build; the hook trades compilation reuse for a predictable disk bound.

CI compiles through [sccache](https://github.com/mozilla/sccache) with the
GitHub Actions backend. The artifact cache is keyed on `Cargo.lock`, so one
dependency bump misses everything; sccache keys on each compilation unit and
still hits. Caches are readable from the current branch and the default branch
only — sibling branches cannot share, which is deliberate isolation — so
keeping `main` building regularly is what keeps the shared cache warm.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, coding guidelines, and the pull request process.

## License

[Unlicense](LICENSE) — Public Domain. See [LICENSE](LICENSE) for details.
