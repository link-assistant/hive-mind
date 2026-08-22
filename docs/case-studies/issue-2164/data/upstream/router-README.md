# Link.Assistant.Router

A self-hosted gateway for safely sharing one AI subscription with family,
household members, colleagues, or a small team. Each person, task, or agent gets
an independently expiring, revocable, rate-limited `la_sk_…` token while the
vendor credential stays inside the router.

The primary use case is putting Claude Code and other agentic clients behind
one Claude MAX subscription without handing its OAuth credential to every
user. Per-token request and actual-token budgets contain runaway agents and
make usage attributable. The router also supports additional subscription and
OpenAI-compatible providers when a deployment needs them.

[![CI/CD Pipeline](https://github.com/link-assistant/router/actions/workflows/release.yml/badge.svg?branch=main)](https://github.com/link-assistant/router/actions/workflows/release.yml?query=branch%3Amain)
[![crates.io](https://img.shields.io/crates/v/link-assistant-router.svg?label=crates.io)](https://crates.io/crates/link-assistant-router)
[![Docker Hub](https://img.shields.io/docker/v/konard/link-assistant-router?label=docker%20hub)](https://hub.docker.com/r/konard/link-assistant-router)
[![docs.rs](https://img.shields.io/docsrs/link-assistant-router?label=docs.rs)](https://docs.rs/link-assistant-router)
[![Rust Version](https://img.shields.io/badge/dynamic/toml?url=https%3A%2F%2Fraw.githubusercontent.com%2Flink-assistant%2Frouter%2Fmain%2FCargo.toml&query=%24.package.rust-version&label=rust&prefix=v&suffix=%2B&color=blue)](https://www.rust-lang.org/)
[![License: Unlicense](https://img.shields.io/badge/license-Unlicense-blue.svg)](http://unlicense.org/)

## Overview

Link.Assistant.Router is a transparent proxy between API clients (such as
Claude Code) and vendor APIs. It provides an OpenRouter-like surface for
subscription credentials while keeping the sharing, attribution, and
containment controls local to the operator.

- **Proxies all Anthropic API requests** transparently, including SSE/streaming responses
- **Supports Claude MAX (OAuth)** by reading Claude Code session credentials
- **Vendor subscriptions** — the default `UPSTREAM_PROVIDER=auto` discovers healthy Claude, Codex, Gemini, and Qwen CLI credentials, exposes their model union, and routes each model to its owning subscription; an explicit provider value pins all traffic
- **OpenAI-compatible endpoints** — `/v1/chat/completions`, `/v1/responses`, `/v1/models` translate to Anthropic or forward to a configured OpenAI-compatible provider
- **Optional Gonka upstream** — `UPSTREAM_PROVIDER=gonka` forwards OpenAI-compatible routes to Gonka instead of translating them to Anthropic
- **Optional Crater ForgeFed upstream** — `UPSTREAM_PROVIDER=crater` turns OpenAI chat requests into ForgeFed `Offer{Ticket}` tasks and waits for resolved task results
- **Optional LiteLLM/OpenAI-compatible upstream** — `UPSTREAM_PROVIDER=openai-compatible` routes OpenAI SDK traffic to a stored provider such as LiteLLM
- **Multi-account routing** — pool any number of Claude, Codex, Gemini, or Qwen subscriptions; session affinity, strict token pins, round-robin / fill-first / least-used selection, request caps, and `Retry-After`-aware cooldowns
- **Issues custom `la_sk_...` JWT tokens** with expiration and revocation for multi-tenant access
- **Persistent token store** — text (Lino) **and** binary backends, both on by default; tokens survive restarts
- **Live observability** — Prometheus `/metrics`, JSON `/v1/usage`, per-account health at `/v1/accounts`
- **`lino-arguments` + `.lenv`** — every flag has an env-var alias and an optional `.lenv` file fallback
- **First-class CLI** — `serve`, token/provider/account management, `clients list|setup|show|remove|doctor`, and deployment diagnostics
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
sent to Gonka with Gonka signing headers instead of the client token. This
project remains Link.Assistant.Router; Gonka is an optional backend.

When `UPSTREAM_PROVIDER=openai-compatible`, clients still authenticate to the
router with `Authorization: Bearer la_sk_...` or `x-api-key: la_sk_...`. The
router forwards OpenAI-compatible requests to the configured provider, such as
a LiteLLM proxy, and substitutes only the upstream provider key inside the
router.

When `UPSTREAM_PROVIDER=crater`, `/v1/chat/completions` accepts normal OpenAI
chat requests, delivers a ForgeFed `Offer` containing a `Ticket` to
`CRATER_FORGEFED_INBOX`, reads `Accept.result`, polls that task URI until
`isResolved:true`, and maps the resolved content back to OpenAI JSON or SSE.

### Vendor subscriptions (Codex, Gemini, Qwen)

By default, leave `UPSTREAM_PROVIDER=auto`: the router discovers every healthy
vendor credential, returns their union from `/v1/models`, and sends each model
to its owning subscription. Set a concrete value to pin a deployment to one
provider. Clients still authenticate with their `la_sk_...` token; the router
supplies the selected vendor OAuth token.

| Provider | `UPSTREAM_PROVIDER` (aliases) | Credentials (read-only) | Upstream |
| --- | --- | --- | --- |
| Claude | `anthropic` | `~/.claude/.credentials.json` | `api.anthropic.com` |
| Codex / ChatGPT | `codex` (`chatgpt`, `openai-codex`) | `~/.codex/auth.json` | ChatGPT backend Responses API |
| Gemini | `gemini` (`google`, `code-assist`) | `~/.gemini/oauth_creds.json` | Code Assist `generateContent` |
| Qwen | `qwen` (`qwen-code`, `dashscope`) | `~/.qwen/oauth_creds.json` | DashScope OpenAI-compatible |

The credential files are produced by each vendor's own CLI (run its `login`
once); the router only reads them. Expired tokens are refreshed in memory using
the vendor's public OAuth client — the files on disk are never modified and
secrets are never logged. `/v1/chat/completions` and `/v1/responses` are
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

- [Rust 1.88+](https://www.rust-lang.org/tools/install) (for building from source)
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

### 5. Issue a custom token

```bash
curl -s -X POST http://localhost:8080/api/tokens \
  -H "Content-Type: application/json" \
  -d '{"ttl_hours": 24, "label": "my-dev-token"}' | jq .
```

Response:

```json
{
  "token": "la_sk_eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
  "ttl_hours": 24,
  "label": "my-dev-token"
}
```

Save the `token` value for use in API requests.

### 6. Use the router as an Anthropic API proxy

```bash
# Use the custom token to make requests through the router
curl -s http://localhost:8080/api/latest/anthropic/v1/messages \
  -H "Authorization: Bearer la_sk_eyJ0eXAi..." \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 100,
    "messages": [{"role": "user", "content": "Hello!"}]
  }' | jq .
```

The router will:
1. Validate the `la_sk_...` token
2. Replace it with the real OAuth token from the Claude Code session
3. Inject the upstream headers Claude MAX OAuth requires — `anthropic-version`
   (default `2023-06-01` when the client omits it) and the
   `anthropic-beta: oauth-2025-04-20` flag (merged with any betas the client
   already sent)
4. Forward the request to `https://api.anthropic.com/v1/messages`
5. Stream the response back to the client

Because the router injects these headers itself, a client only needs to send the
`la_sk_...` token — it never needs the real OAuth token, the OAuth beta flag, or
even an `anthropic-version` header.

## Use-case documentation

Each supported scenario has its own document under
[docs/use-cases/](docs/use-cases/README.md), so you can read only the one you
need:

| Document | Scenario |
| --- | --- |
| [per-task-tokens.md](docs/use-cases/per-task-tokens.md) | One `la_sk_…` token per task — audit, monitoring, security, isolation |
| [audit-and-monitoring.md](docs/use-cases/audit-and-monitoring.md) | Aggregate `/metrics`, admin-only per-token `/v1/usage`, and the JSONL audit log |
| [with-router.md](docs/use-cases/with-router.md) | Temporary-by-default one-line launcher, remote selection, managed Docker lifecycle, and exact global undo |
| [claude-max-in-codex.md](docs/use-cases/claude-max-in-codex.md) | A Claude MAX subscription inside Codex CLI and other OpenAI-dialect clients |
| [chatgpt-in-claude-code.md](docs/use-cases/chatgpt-in-claude-code.md) | A ChatGPT/Qwen/Gemini/LiteLLM backend inside Claude Code and other Anthropic-dialect clients |
| [cli-claude-code.md](docs/use-cases/cli-claude-code.md) | Claude Code configuration |
| [cli-codex.md](docs/use-cases/cli-codex.md) | Codex CLI configuration |
| [cli-qwen-code.md](docs/use-cases/cli-qwen-code.md) | Qwen Code configuration |
| [cli-gemini-cli.md](docs/use-cases/cli-gemini-cli.md) | Gemini CLI configuration |
| [cli-opencode.md](docs/use-cases/cli-opencode.md) | opencode configuration |
| [cli-grok-cli.md](docs/use-cases/cli-grok-cli.md) | Grok CLI configuration |
| [cli-agent.md](docs/use-cases/cli-agent.md) | Link.Assistant Agent configuration |
| [cli-cursor.md](docs/use-cases/cli-cursor.md) | Cursor CLI — **not implemented**, why, and what an adapter would take |

## Using with Claude Code

The primary use case is routing Claude Code through the proxy so multiple users can share a single Claude MAX subscription.

### Step 1: Start the router (on the server/host machine)

```bash
export TOKEN_SECRET=your-secure-secret
./target/release/link-assistant-router
```

### Step 2: Issue a token for each user

```bash
# Issue a token for user Alice
curl -s -X POST http://localhost:8080/api/tokens \
  -H "Content-Type: application/json" \
  -d '{"ttl_hours": 168, "label": "alice"}' | jq -r '.token'

# Issue a token for user Bob
curl -s -X POST http://localhost:8080/api/tokens \
  -H "Content-Type: application/json" \
  -d '{"ttl_hours": 168, "label": "bob"}' | jq -r '.token'
```

### Step 3: Configure Claude Code to use the router (on each user's machine)

```bash
# Set the base URL to point to the router
export ANTHROPIC_BASE_URL=http://your-server:8080/api/latest/anthropic

# Set the custom token as the API key
export ANTHROPIC_API_KEY=la_sk_eyJ0eXAi...

# Run Claude Code normally — all requests go through the router
claude
```

Claude Code will work exactly as normal, with all requests transparently proxied through the router.

## API Endpoints

### Always available

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Health check, returns `ok` |
| `/api/tokens` | POST | (admin) Issue a new custom token |
| `/api/tokens/list` | GET | (admin) List every persisted token |
| `/api/tokens/revoke` | POST | (admin) Revoke a token by id |
| `/api/tokens/rotate` | POST | (admin) Issue a replacement admin token and revoke the caller's own |
| `/api/providers` | GET/POST | (admin) List or upsert OpenAI-compatible upstream providers |
| `/api/providers/{name}` | GET/DELETE | (admin) Show or delete one provider |

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
| `/api/login` | POST | (admin) Start a login; optional body: `{"provider":"claude"|"codex"}` |
| `/api/login/{id}` | GET | (admin) Status includes `awaiting_code` (Claude) or `awaiting_device` plus `user_code` (Codex) |
| `/api/login/{id}` | DELETE | (admin) Cancel a pending login and kill its process |
| `/api/login/{id}/code` | POST | (admin) Submit the code the human copied from the browser |

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

When nothing is selected at all, `with` and `auth` use a router that is already
listening on this machine — including one reached over an SSH tunnel — and only
start a managed container when none answers. The rule, in one sentence: if a
router is already listening locally, use it. Selection order is `--server`, then
`ROUTER_URL`/`LINK_ASSISTANT_ROUTER_URL`, then the persisted `server use`
selection, then a running local router, then a managed container. A discovered
endpoint is adopted only after the same `/health` check every other branch
performs, so an unrelated service on port 8080 is not mistaken for the router.
`router server status` names whichever one the next command will use, and
`--managed` forces a disposable container for CI and clean-room runs.

### Admin UI surface (`--admin-port` to opt in)

Served on a **separate listener** that does not exist unless you give it a port,
and on which every route but bootstrap and status requires the admin
credential — see [docs/use-cases/admin-ui.md](docs/use-cases/admin-ui.md).

| Endpoint | Method | Description |
|---|---|---|
| `/api/admin/status` | GET | (open) Credential state: claimed, bootstrap open, provisioned by environment |
| `/api/admin/bootstrap` | POST | (open while unclaimed) Mint a candidate token; authorises nothing on its own |
| `/api/admin/bootstrap/confirm` | POST | Activate the candidate, authenticated with the candidate token itself |
| `/api/admin/rotate` | POST | (admin) Mint a replacement admin credential and retire the current one |
| `/api/admin/summary` | GET | (admin) Version, upstream, accounts and credential state |
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
| `/v1/messages` | POST | Anthropic Messages — preserves SSE streaming |
| `/v1/messages/count_tokens` | POST | Token-count helper |
| `/api/anthropic/v1/messages` | POST | Namespaced Anthropic Messages alias |
| `/api/anthropic/v1/messages/count_tokens` | POST | Namespaced token-count alias |
| `/invoke` | POST | Bedrock-format invoke |
| `/invoke-with-response-stream` | POST | Bedrock streaming invoke |
| `/api/latest/anthropic/v1/messages` | POST | Legacy Messages alias; prefix stripped before forwarding |
| `/api/latest/anthropic/v1/messages/count_tokens` | POST | Legacy token-count alias; prefix stripped before forwarding |
| `/v1/projects/{project}/locations/{location}/publishers/anthropic/models/{model}:rawPredict` | POST | Vertex rawPredict pass-through |
| `/v1/projects/{project}/locations/{location}/publishers/anthropic/models/{model}:streamRawPredict` | POST | Vertex streaming rawPredict pass-through |
| `/v1/projects/{project}/locations/{location}/publishers/anthropic/models/{model}/count-tokens:rawPredict` | POST | Vertex token-count pass-through |

### OpenAI surface (`--disable-openai-api` to opt out)

| Endpoint | Method | Description |
|---|---|---|
| `/v1/chat/completions` | POST | Chat Completions, translated to Anthropic Messages, forwarded to the selected OpenAI-compatible provider, or delivered as a Crater ForgeFed task |
| `/v1/responses` | POST | Responses API, translated to Anthropic Messages or forwarded to the selected OpenAI-compatible provider |
| `/v1/models` | GET | OpenAI-shaped union of models from healthy subscriptions in automatic mode |
| `/api/openai/v1/*` | GET/POST | Namespaced aliases for models, Chat Completions, and Responses |
| `/api/codex/v1/*` | GET/POST | Codex namespace; Responses is the subscription's native protocol |
| `/api/qwen/v1/*` | GET/POST | Qwen namespace; forwards its native OpenAI-compatible protocol |
| `/api/gemini/v1beta/models` | GET | Native Gemini model list (union of every connected subscription) |
| `/api/gemini/v1beta/models/{model}` | GET | Native Gemini model metadata |
| `/api/gemini/v1beta/models/{model}:generateContent` | POST | Native Gemini generation, routed to the model's owning subscription (Codex, Claude, Qwen or Gemini) |
| `/api/gemini/v1beta/models/{model}:streamGenerateContent` | POST | Native Gemini SSE response |
| `/api/vertex/v1/projects/.../models/{model}:generateContent` | POST | Native Vertex-style generation through Gemini Code Assist |

Provider-specific namespaces use the matching healthy subscription in
automatic mode, or the provider pinned by `UPSTREAM_PROVIDER`.

**Every advertised and routable model comes from a live provider catalog.** The
router ships no built-in model list, no per-provider default model, and no alias
table: a catalog exists only after a successful authenticated discovery for that
exact account, and is recorded with the account identity, the fetch time and an
explicit health flag. Before the first discovery a provider advertises nothing;
`GET /v1/models` reports it under `degraded_providers` rather than filling the
gap from source. When a credential is revoked its last known catalog stays
visible to administrators but stops being advertised or routed.

Requested model names pass through unchanged. In automatic mode, routing uses
only subscription catalogs: vendor-shaped IDs prefer their matching vendor if
catalogs overlap, and an unqualified name advertised by multiple healthy
subscriptions is rejected until `UPSTREAM_PROVIDER` is pinned. A model no
catalog advertises returns `404 not_found_error` instead of silently selecting a
default. Successful Anthropic-backed responses report the model that actually
served the request.

#### Model identity and output limits

Responses always report the model id the client requested, including catalog
aliases such as `codex-auto-review`, in `model` — for buffered replies and for
every streamed chunk on each OpenAI surface. When the provider serves a
different concrete model, the router reports it separately in the
`x_router_upstream_model` response field and the `x-router-upstream-model`
response header, instead of replacing the requested identity.

Codex subscriptions accept `max_output_tokens`, `max_tokens`, and
`max_completion_tokens`. The ChatGPT backend rejects an explicit cap, so the
router strips the field from the upstream request and enforces the cap itself:
visible output is truncated at the caller's budget and the exchange ends with
`finish_reason: "length"` on Chat Completions, or `status: "incomplete"` with
`incomplete_details.reason: "max_output_tokens"` on Responses. The budget is
estimated at roughly four characters per token, and hidden reasoning tokens are
not observable, so the cap bounds visible output rather than billed tokens.

With `UPSTREAM_PROVIDER=gonka`, `/v1/chat/completions` and `/v1/responses`
forward OpenAI-compatible JSON to Gonka without Anthropic translation. If a
request omits `model`, the router uses `GONKA_MODEL`.

With `UPSTREAM_PROVIDER=openai-compatible`, the same routes forward JSON to the
configured provider. This supports LiteLLM proxy deployments by setting the
provider base URL to the LiteLLM `/v1` API base. Streaming OpenAI requests are
passed through for OpenAI-compatible providers, and Anthropic-backed streaming
requests are translated to OpenAI SSE chunks.

With `UPSTREAM_PROVIDER=crater`, `/v1/chat/completions` supports normal JSON
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

When enabled, unpaid calls to `/v1/chat/completions` and `/v1/responses`
return `WWW-Authenticate: Payment ...` with `protocol="mpp"` and
`intent="charge"`. This is separate from the ForgeFed/ActivityPub discovery
surface. Payment credential settlement is intentionally not accepted until a
method-specific verifier is configured.

### Observability (`--disable-metrics` to opt out)

| Endpoint | Method | Description |
|---|---|---|
| `/metrics` | GET | Public Prometheus text-exposition aggregate counters |
| `/v1/usage` | GET | Admin-only JSON snapshot, including per-token and per-account counters |
| `/v1/accounts` | GET | Admin-only multi-account health: cooldowns, last error, used count, configured limit, and remaining requests |

`/metrics` deliberately contains no token ids, labels, or account names because
it is available without authentication. Administrators can inspect per-token
usage in the `/v1/usage` `token_calls` JSON map. Set `--audit-log` for a durable
JSONL trail of the same events. See
[docs/use-cases/audit-and-monitoring.md](docs/use-cases/audit-and-monitoring.md).

### POST /api/tokens

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

The two documented `/api/latest/anthropic/v1/messages` routes are forwarded to
the corresponding upstream Anthropic API paths. Unknown routes and methods are
rejected locally rather than forwarded. The proxy:

- Validates the `Authorization: Bearer la_sk_...` or `x-api-key: la_sk_...` token
- Replaces it with the real OAuth token
- Forwards all headers (except `host`, `authorization`, `x-api-key`, `connection`, `transfer-encoding`)
- Passes through the request body unmodified
- Streams back the response (SSE-compatible)
- Preserves the upstream status code and response headers

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
```

Every flag listed in `--help` has an env-var alias and can be configured from
`.lenv` with the same env-var key.

### Core

| Flag / env | Default | Required | Description |
|---|---|---|---|
| `--token-secret` / `TOKEN_SECRET` | — | Yes | Secret key for signing/validating JWT tokens |
| `--port` / `ROUTER_PORT` | `8080` | No | Port to listen on |
| `--host` / `ROUTER_HOST` | `0.0.0.0` | No | Host/IP to bind to |
| `--claude-code-home` / `CLAUDE_CODE_HOME` | `~/.claude` | No | Primary Claude Code credentials directory |
| `--upstream-provider` / `UPSTREAM_PROVIDER` | `auto` | No | Automatically route by model across healthy subscriptions, or pin `anthropic`, `codex`, `gemini`, `qwen`, `gonka`, `crater`, or `openai-compatible` |
| `--upstream-base-url` / `UPSTREAM_BASE_URL` | `https://api.anthropic.com` | No | Upstream Anthropic API URL |
| `UPSTREAM_READ_TIMEOUT_SECS` | `120` | No | Seconds to wait for the *next byte* from an upstream before failing the request; `0` disables the bound. A long answer may legitimately stream for many minutes, but a backend that has gone silent must not leave a client waiting forever |
| `--api-format` / `UPSTREAM_API_FORMAT` | (auto) | No | Restrict the proxy to `anthropic` / `bedrock` / `vertex` |
| `--bridge-model` / `ANTHROPIC_BRIDGE_MODEL` | (from live catalog) | No | Upstream model used when `/v1/messages` is served from a non-Anthropic upstream. Unset selects one from the account's live catalog ([details](docs/use-cases/chatgpt-in-claude-code.md)) |
| `--bridge-model-policy` / `BRIDGE_MODEL_POLICY` | `first-advertised` | No | How to pick that model from the catalog: `first-advertised` or `last-advertised`. When no compatible model exists the request fails with `model_selection_required` rather than falling back to a built-in name |
| `--audit-log` / `AUDIT_LOG` | (disabled) | No | Append one JSON line per authorised request (token id, label, provider, surface, path, model) to this file ([details](docs/use-cases/audit-and-monitoring.md)) |
| `--request-log` / `REQUEST_LOG` | `$DATA_DIR/requests` | No | Root directory for redacted per-token JSONL exchange logs, tied together by `correlation_id` |
| `--request-log-max-bytes` / `REQUEST_LOG_MAX_BYTES` | `104857600` (100 MiB) | No | Per-token request-log size bound; each token independently discards its oldest complete records first |
| `--max-proxy-request-bytes` / `MAX_PROXY_REQUEST_BYTES` | `67108864` (64 MiB) | No | Deliberate proxy request-body ceiling; independent of request-log capture and returns HTTP 413 when exceeded |
| `--verbose` / `VERBOSE` | `false` | No | Verbose tracing |

### GitHub API credential proxy

The opt-in GitHub proxy lets an agent authenticate with its router-issued task
token while the real GitHub credential remains inside the router. It supports
bare REST paths, GitHub CLI's custom-host `/api/v3/*` rewrite, and GraphQL at
`/api/graphql` and `/graphql`. The `/github/*` namespace exposes arbitrary REST
paths without colliding with inference/admin routes. Plain git over SSH/HTTPS
is outside this proxy.

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
object, and forced GraphQL ref updates are denied by default. An ordered policy
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
`x-link-assistant-policy: blocked`. This protects API-mediated ref deletion and
forced ref updates; branch protection remains necessary because a force-push
over the git transport never reaches these routes.

For GitHub CLI, terminate trusted HTTPS at the router host and set the
router-issued token as the custom-host credential:

```bash
export GH_HOST=router.example.internal
export GH_ENTERPRISE_TOKEN="$LINK_ASSISTANT_TOKEN"
gh api rate_limit
gh issue list -R acme/demo
```

### Gonka provider

Gonka support is optional. Set `UPSTREAM_PROVIDER=gonka` to pin the deployment
to it instead of using automatic subscription routing.

```env
TOKEN_SECRET=your-router-token-secret

UPSTREAM_PROVIDER=gonka
GONKA_PRIVATE_KEY=your_gonka_private_key
GONKA_SOURCE_URL=https://node4.gonka.ai
GONKA_MODEL=Qwen/Qwen3-235B-A22B-Instruct-2507-FP8
```

| Flag / env | Default | Required | Description |
|---|---|---|---|
| `--gonka-private-key` / `GONKA_PRIVATE_KEY` | — | Yes, for Gonka | Private key used to sign Gonka upstream requests |
| `--gonka-source-url` / `GONKA_SOURCE_URL` | `https://node4.gonka.ai` | No | Gonka source node URL |
| `--gonka-model` / `GONKA_MODEL` | `Qwen/Qwen3-235B-A22B-Instruct-2507-FP8` | No | Default model for Gonka OpenAI-compatible requests |

Your Gonka account must be activated for inference, funded, and have a
published on-chain public key. Participant registration is only needed for
hosting.

### Crater ForgeFed provider

Crater support is optional. It keeps router-issued `la_sk_...` tokens at the
edge, then uses ForgeFed to submit work to a remote ticket tracker or exchange.

```env
TOKEN_SECRET=your-router-token-secret

UPSTREAM_PROVIDER=crater
CRATER_FORGEFED_INBOX=https://tracker.example/inbox
CRATER_FORGEFED_TARGET=https://tracker.example/projects/demo
# Optional; defaults to ACTIVITYPUB_ACTOR_BASE_URL/actor/code
CRATER_FORGEFED_ACTOR=https://router.example/actor/code
```

| Flag / env | Default | Required | Description |
|---|---|---|---|
| `--crater-forgefed-inbox` / `CRATER_FORGEFED_INBOX` | — | Yes, for Crater | Remote ForgeFed inbox that receives `Offer{Ticket}` activities |
| `--crater-forgefed-actor` / `CRATER_FORGEFED_ACTOR` | `${ACTIVITYPUB_ACTOR_BASE_URL}/actor/code` | No | Local actor URI used in outbound activities |
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
```

| Flag / env | Default | Required | Description |
|---|---|---|---|
| `--openai-compatible-provider-name` / `OPENAI_COMPATIBLE_PROVIDER_NAME` | `litellm` | No | Stored provider name to resolve |
| `--openai-compatible-base-url` / `OPENAI_COMPATIBLE_BASE_URL` | `http://localhost:4000/v1` | No | Upstream OpenAI-compatible `/v1` API base |
| `--openai-compatible-api-key` / `OPENAI_COMPATIBLE_API_KEY` | — | No | Inline upstream key; prefer persisted provider storage for long-lived secrets |
| `--openai-compatible-api-key-env` / `OPENAI_COMPATIBLE_API_KEY_ENV` | — | No | Environment variable containing the upstream key |
| `--openai-compatible-model` / `OPENAI_COMPATIBLE_MODEL` | — | No | Default model injected when requests omit `model` |
| `--openai-compatible-models` / `OPENAI_COMPATIBLE_MODELS` | — | No | Comma-separated models exposed from `/v1/models` |

Persistent provider records live in `<DATA_DIR>/providers.lenv`. Inline
provider API keys are encrypted with AES-GCM using a key derived from
`TOKEN_SECRET`; API responses and CLI output only show whether a stored key is
present.

```bash
router providers add \
  --name litellm \
  --base-url http://litellm:4000/v1 \
  --model claude-sonnet \
  --models claude-sonnet,gpt-4o \
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
  api-key-env "LITELLM_MASTER_KEY"
```

The HTTP API accepts the same shape at `POST /api/providers`:

```json
{
  "name": "litellm",
  "kind": "openai-compatible",
  "base_url": "http://litellm:4000/v1",
  "default_model": "claude-sonnet",
  "models": ["claude-sonnet", "gpt-4o"],
  "api_key_env": "LITELLM_MASTER_KEY"
}
```

### Routing & storage

| Flag / env | Default | Description |
|---|---|---|
| `--routing-mode` / `ROUTING_MODE` | `direct` | `direct` (OAuth substitution), `cli` (Claude CLI subprocess), or `hybrid` |
| `--storage-policy` / `STORAGE_POLICY` | `both` | Persistent token store: `memory`, `text` (Lino), `binary`, or `both` |
| `--data-dir` / `DATA_DIR` | platform-specific | Where `tokens.lino` / `tokens.bin` live |
| `--claude-cli-bin` / `CLAUDE_CLI_BIN` | `claude` | Local Claude CLI binary used by the `cli` backend, and by the last rung of credential recovery |
| `--additional-account-dirs` / `ADDITIONAL_ACCOUNT_DIRS` | (empty) | Comma-separated extra credential homes for the active subscription provider |
| `--account-routing-strategy` / `ACCOUNT_ROUTING_STRATEGY` | `round-robin` | New-session policy: `round-robin`, `priority`/`fill-first`, or `least-used`/`quota-first` |
| `--account-cooldown-secs` / `ACCOUNT_COOLDOWN_SECS` | `60` | Minimum cooldown after a quota response; a longer upstream `Retry-After` wins |
| `--session-affinity-ttl-secs` / `SESSION_AFFINITY_TTL_SECS` | `3600` | Inactive seconds before a conversation can be assigned again; `0` disables affinity |
| `--account-request-limits` / `ACCOUNT_REQUEST_LIMITS` | (unknown) | Comma-separated request caps, primary first then extras; must match pool size, and `0` means unknown/unlimited |

#### Storage formats and ownership

Router-owned token state uses the associative stack. `tokens.lino` is a
portable Links Notation projection produced by `lino-objects-codec`, with each
record represented as `Type → SubType → Value`. `tokens.bin` is the same
semantic graph in a native `doublets` store backed by file-mapped
`platform-mem`. The `text`, `binary`, and default `both` policies select those
two projections; `memory` remains non-persistent. Hand-built `tokens.lino`
files and `LARTOK01` JSON containers from earlier releases are loaded and
atomically converted on first open.

Other files keep the format of the boundary they serve:

- Provider/client credentials and client settings such as
  `.credentials.json`, `auth.json`, `settings.json`, and `config.toml` are
  vendor-owned interoperability files. The router continues to read or update
  the vendor's expected shape.
- Per-token `requests/<token-hash>/requests.jsonl` files and the optional audit
  JSONL are append-only operational streams intended for log collectors and
  standard text tooling, rather than mutable router domain state.
- `providers.lenv` is the router's existing portable provider configuration
  interchange. Moving additional router-owned state onto doublets can be done
  independently of the token migration.

### Feature toggles

| Flag / env | Default | Description |
|---|---|---|
| `--disable-openai-api` / `DISABLE_OPENAI_API` | off | Hide `/v1/chat/completions`, `/v1/responses`, `/v1/models` |
| `--disable-anthropic-api` / `DISABLE_ANTHROPIC_API` | off | Hide `/v1/messages*` and Bedrock paths |
| `--disable-metrics` / `DISABLE_METRICS` | off | Hide `/metrics`, `/v1/usage`, `/v1/accounts` |
| `--disable-login-api` / `DISABLE_LOGIN_API` | off | Hide `/api/login*` |
| `--login-cli-command` / `LOGIN_CLI_COMMAND` | `claude` | Compatibility backend driven on a PTY. The default value spawns nothing: both login modes run in-process |
| `--login-cli-args` / `LOGIN_CLI_ARGS` | (none; full scopes) | Comma-separated arguments for that program; set `setup-token` to make the narrow `user:inference` mode the deployment default |
| `--login-session-ttl-secs` / `LOGIN_SESSION_TTL_SECS` | `900` | How long a pending login waits for its code before expiring |
| `--login-max-sessions` / `LOGIN_MAX_SESSIONS` | `4` | Maximum simultaneously pending logins; beyond it, `429` |
| `--experimental-compatibility` / `EXPERIMENTAL_COMPATIBILITY` | off | XML history, model spoofing and other community-proxy behaviours |
| `--admin-key` / `TOKEN_ADMIN_KEY` | — | Flat bootstrap Bearer key accepted by `/api/tokens*` alongside admin-scoped tokens |
| `--allow-anonymous-admin` / `ALLOW_ANONYMOUS_ADMIN` | off | Opt back into unauthenticated `/api/tokens*` access (**not recommended**) |
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

# Issue / list / revoke / show tokens locally (no HTTP needed):
router tokens issue --ttl-hours 168 --label alice
# ...optionally cap how many upstream requests the token may make:
router tokens issue --ttl-hours 168 --label alice --max-requests 500
# ...cap actual input + output tokens and bursts as well:
router tokens issue --label alice --max-tokens 100000 --rate-limit-per-minute 10
router tokens list
router tokens revoke <id>
router tokens expire <id>
router tokens rotate <id> --ttl-hours 168
router tokens show <id>

# Inspect configured accounts:
router accounts list

# Manage OpenAI-compatible upstream providers:
router providers add --name litellm --base-url http://litellm:4000/v1 --model claude-sonnet
router providers import providers.lenv
router providers list

# Safely configure local agentic CLIs against this router:
router clients list
router clients setup codex
router clients setup claude --token la_sk_...
router clients setup opencode
router clients setup qwen
router clients setup agent
router clients setup grok
router clients show codex
router clients doctor codex
router clients remove codex

# Print resolved configuration + credential / store probes:
router doctor
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
`$DATA_DIR/requests/<token-hash>/requests.jsonl` by default. Client and upstream
phases share an `x-request-id`/`correlation_id` and carry the token hash, id,
and label. Missing or invalid credentials use the explicit `unauthenticated`
directory. Credentials longer than the safety threshold retain three leading
and trailing characters with a fixed `*` mask; shorter values are replaced
with `[REDACTED]`. The same helper handles headers, URI query parameters, and
JSON bodies, and no complete credential is logged. Request bodies larger than
10 MiB continue to the handler but are omitted from the log. Directories and
files use owner-only permissions on Unix. `REQUEST_LOG_MAX_BYTES` applies to
each token independently, so one caller cannot evict another's history.

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
| Renew an **expired** access token | No — the router exchanges the `refreshToken` itself | `:ro` (see below) |
| **First-time login** (no credential file yet) | No — native OAuth | writable |
| `POST /api/login` (remote login over HTTP) | No — native OAuth | writable |

The router exchanges the `refreshToken` stored in the mounted credential file against Anthropic's token endpoint and serves from the result, so serving continues across expiry. The same mechanism covers Codex, Gemini, and Qwen.

One case needs write access. Vendors **rotate** refresh tokens: the refresh response often carries a replacement and spends the old one. When that happens the router writes the new token back to the credential file — on every refresh path, not only the catalog poll — so a restart does not replay a spent token. On a `:ro` mount the write is skipped with a logged warning — the router keeps working for the life of the process, but a restart may then require re-authorizing. Mount the credential directory writable if you want rotation to survive restarts.

Two things still require a real login: a directory with no credential file at all, and a `refreshToken` that has itself been revoked or expired.

#### When a refresh is rejected

Rotation makes the credential file shared mutable state: the vendor CLI, a second router, and this process each hold a link in one chain, and only the newest link is redeemable. Redeeming an older one answers `invalid_grant`, which looks exactly like revocation but is not. Rather than concluding "revoked" from that answer, the router climbs a ladder (issue #239):

1. **Refresh before expiry.** A token within five minutes of expiring is renewed before it is used, so the rejected-token path is entered far less often.
2. **Re-read the credential.** The whole read → refresh → write cycle is held under an advisory lock on a sidecar lock file, and the file is rewritten atomically, so two holders serialise instead of racing and an interrupted write leaves the previous credential intact.
3. **Retry once with a newer link.** If the store has moved forward while the exchange was in flight, the router adopts what is on disk and retries once — the common case stops being a mandatory re-login.
4. **Ask the vendor client.** Only when `--claude-cli-bin` is configured: the vendor's own client is run once, and if it rotates the chain the router adopts the credential it wrote. The invocation, the client's own (self-redacting) debug log, and the exchange the router itself sent — header names with values, body field *names* without them — are journalled, so the undocumented protocol can be reproduced from the log alone. Token values are never logged.
5. **Report precisely.** Only then is the subscription reported as rejected, and the message distinguishes a revoked credential from a lost rotation race, names the credential file that was checked, and gives the re-authentication command. A request for a model whose subscription is in that state says so, instead of only reporting that the model is `not advertised by any subscription`.

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
      # `:ro` is enough: token renewal happens in memory. Drop `:ro` (and use
      # `:ro` can be dropped when authorizing from the container.
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

1. **Issue**: `POST /api/tokens` creates a signed JWT with a UUID subject, expiration, optional label, and optional per-token request, token-spend, and rate controls
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

The `/api/tokens*` endpoints — and every other endpoint marked *(admin)* above
— are **closed by default**. Three things can open them:

1. **An admin-scoped token.** It is an ordinary `la_sk_…` JWT carrying
   `"scope": "admin"`, so it expires, has an identity (`sub`), shows up in
   `tokens list`, and can be revoked and rotated like any other token.

   ```bash
   # CLI
   router tokens issue --admin --ttl-hours 168 --label ops
   # HTTP (from an existing admin credential)
   curl -s -X POST http://localhost:8080/api/tokens \
     -H "Authorization: Bearer $ADMIN" -H "Content-Type: application/json" \
     -d '{"ttl_hours": 168, "label": "ops", "scope": "admin"}' | jq -r .token
   ```

   Rotation is a single step — mint the replacement and revoke the credential
   that asked for it:

   ```bash
   router tokens rotate <sub> --ttl-hours 168 --label ops
   curl -s -X POST http://localhost:8080/api/tokens/rotate \
     -H "Authorization: Bearer $ADMIN" -H "Content-Type: application/json" -d '{}' | jq .
   ```

2. **The flat `--admin-key` / `TOKEN_ADMIN_KEY`.** Still supported unchanged as
   a bootstrap and compatibility credential for deployments that configure
   everything externally, and now compared in constant time. It carries no
   identity or expiry, so it cannot rotate itself (`/api/tokens/rotate` answers
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
scope, not by "any valid token". The converse does not hold: `scope=admin` is a
**superset** of client access, so one administrator credential both manages
tokens (`/api/tokens/list`) and reaches the models (`/v1/models`). The same is
true of the flat `TOKEN_ADMIN_KEY`.

#### The first-visitor claim

The web UI and the chat bots (Telegram, VK) share one system-wide first-visitor
claim, and it produces an ordinary admin-scoped `la_sk_…` JWT — the credential
model above, not a parallel one. The two-phase handshake is unchanged: phase one
mints the candidate **already revoked**, so an undelivered mint authorises
nothing and cannot brick the deployment; confirming it activates the credential,
closes bootstrap on every channel, and retires the startup `bootstrap-admin`
token by id, so the Tokens table, the CLI and the bots all show it revoked.

`POST /api/admin/bootstrap` and `POST /api/admin/rotate` accept an optional
`{"ttl_hours": n}` body to limit the credential lifetime (capped at one year;
omitted means the cap). Expiry and revocation are enforced on the same path as
every other token. Rotation is atomic: the replacement is minted and the
previous credential revoked by id under the claim lock.

Deployments claimed by an older version still hold an opaque `la_admin_…`
credential. It keeps working, `doctor` warns about it, and the first
`/api/admin/rotate` converts the claim into a JWT.

### Per-token containment controls

Each token can cap request count, actual upstream-reported input plus output
tokens, and requests per minute. This lets you hand a credential to a separate
person, task, or agent without exposing the vendor OAuth credential or letting
one runaway loop immediately consume the shared subscription.

```bash
# CLI
router tokens issue --ttl-hours 24 --label scoped-agent \
  --max-requests 100 --max-tokens 100000 --rate-limit-per-minute 10

# HTTP: same, via the admin endpoint
curl -s -X POST http://localhost:8080/api/tokens \
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
curl -s http://localhost:8080/health
# Expected: ok

# 2. Issue a token
TOKEN=$(curl -s -X POST http://localhost:8080/api/tokens \
  -H "Content-Type: application/json" \
  -d '{"ttl_hours": 1, "label": "test"}' | jq -r '.token')
echo "Token: $TOKEN"

# 3. Test proxy with token (will get auth error from Anthropic since test-oauth-token is not real)
curl -s http://localhost:8080/api/latest/anthropic/v1/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model": "claude-sonnet-4-20250514", "max_tokens": 10, "messages": [{"role": "user", "content": "Hi"}]}' | jq .

# 4. Test without token (should get 401)
curl -s http://localhost:8080/api/latest/anthropic/v1/messages | jq .

# 5. Test with invalid token (should get 401)
curl -s http://localhost:8080/api/latest/anthropic/v1/messages \
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

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, coding guidelines, and the pull request process.

## License

[Unlicense](LICENSE) — Public Domain. See [LICENSE](LICENSE) for details.
