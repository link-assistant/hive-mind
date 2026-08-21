# Self-hosting: the router as an internal infrastructure component

Issue #45 states the purpose of this system directly:

> the general purpose of the system is usage as an internal component of
> personal or corporate infrastructure, for testing, experimenting and general
> coding tasks.

This document covers that scenario: where the process runs, what it needs on
disk, and — most importantly — **who can reach the endpoint that mints tokens**.

Every claim below is asserted by
`experiments/issue-45/test-deployment-hardening.sh` (**18 passed, 0 failed**),
which needs no subscription: all of it concerns the router's own auth surface,
so no request reaches an upstream.

## The one thing to get right

`POST /api/tokens` mints `la_sk_…` tokens that spend your subscription, so it —
and every other `/api/tokens*` endpoint — is **closed by default**. An
unauthenticated call is refused:

```console
$ curl -X POST http://router:8080/api/tokens -d '{"ttl_hours":1,"label":"anyone"}'
{"error":{"type":"authentication_error", …}}              # 401, no credential sent
```

Historically the endpoint was open whenever `TOKEN_ADMIN_KEY` was unset — the
default bind address is `0.0.0.0`, so in a container with a published port
anyone who could reach it could mint themselves a working token and list every
token you had issued. That default is gone.

If you configure nothing, the router mints an admin credential on first start
and prints it once:

```
Admin token (shown once, store it now): la_sk_eyJ0eXAi...
```

That token is an ordinary `la_sk_…` JWT with `"scope": "admin"`: it expires, it
is listed by `tokens list`, and it can be revoked or rotated
(`POST /api/tokens/rotate` mints a replacement and revokes the caller's own
subject in one step). Issue more with `tokens issue --admin` or
`{"scope":"admin"}`.

The flat key still works as a bootstrap credential when you provision
everything externally, and is now compared in constant time:

```bash
TOKEN_ADMIN_KEY="$(openssl rand -hex 32)"
```

Either way, issuing, listing and revoking all require a credential as a Bearer
token; a missing or wrong one is `401`, and a rejected revoke is a **no-op** —
an outsider cannot cancel a running task's token:

| Request | Result |
| --- | --- |
| `POST /api/tokens` with no key / a wrong key | `401` |
| `GET /api/tokens/list` with no key | `401` |
| `POST /api/tokens/revoke` with no key | `401`, and the token stays valid |
| any of the above with `Authorization: Bearer $TOKEN_ADMIN_KEY` | `200` |
| any of the above with an admin-scoped `la_sk_…` token | `200` |

`--allow-anonymous-admin` (`ALLOW_ANONYMOUS_ADMIN=1`) restores the old open
behaviour. It exists only so an existing deployment that depends on it is not
broken by an upgrade; do not use it on a reachable port.

### The two secrets are not interchangeable

| Secret | Held by | Grants |
| --- | --- | --- |
| `TOKEN_ADMIN_KEY` or an admin-scoped token | the operator | minting, listing, revoking task tokens |
| `la_sk_…` task token | one task | proxied inference, within that token's TTL and budget |

They do not substitute for each other: a task token presented to
`/api/tokens/list` is `401`, and the admin key presented to `/v1/messages` is
`401` (rejected at authentication, so it never reaches an upstream). The vendor
credential is a third thing that never leaves the process.

## Deployment shapes

### Local process

```bash
export TOKEN_SECRET="$(openssl rand -hex 32)"
export TOKEN_ADMIN_KEY="$(openssl rand -hex 32)"
export ROUTER_HOST=127.0.0.1          # personal machine: do not listen publicly
router serve
```

`ROUTER_HOST` is honoured as given — bound to `127.0.0.1` the port is reachable
only from the same machine.

### Docker

The image defaults to `ROUTER_PORT=8080` and `CLAUDE_CODE_HOME=/data/claude`.
Mount the subscription **read-only** and keep router state on its own volume:

```bash
docker run -d --name router \
  -p 127.0.0.1:8080:8080 \
  -e TOKEN_SECRET="$TOKEN_SECRET" \
  -e TOKEN_ADMIN_KEY="$TOKEN_ADMIN_KEY" \
  -e DATA_DIR=/data/router \
  -e AUDIT_LOG=/data/router/audit.jsonl \
  -e CLAUDE_CODE_HOME=/data/claude \
  -v "$HOME/.claude:/data/claude:ro" \
  -v router-data:/data/router \
  ghcr.io/link-assistant/router serve
```

`-p 127.0.0.1:8080:8080` publishes to the host's loopback only; drop the
`127.0.0.1:` prefix **only** once `TOKEN_ADMIN_KEY` is set.

The router starts and serves `/health` with **no subscription mounted at all**,
so it can be deployed before credentials are provisioned; requests then fail at
the upstream rather than at startup.

The mount can stay read-only across token expiry: the router exchanges the
`refreshToken` in the credential file for a new access token in memory and
never writes the file back. A **first-time login** needs a writable mount, but
the router performs that OAuth flow itself and needs no preinstalled vendor CLI:

```bash
docker run -it --rm \
  -v claude-home:/data/claude \
  ghcr.io/link-assistant/router:latest auth claude
```

### Corporate host

Nothing external is required — no database, no message broker. State is JSON
under `DATA_DIR` and, when `AUDIT_LOG` is set, an append-only JSONL file:

| Path | Contents | Backup? |
| --- | --- | --- |
| `$DATA_DIR` | issued-token records (id, label, expiry, budget, usage) | yes — losing it loses revocation state |
| `$AUDIT_LOG` | one line per proxied request | ship to your log collector |
| `$CLAUDE_CODE_HOME` | the vendor session; read-only unless you log in from the container | never — it is the vendor's |

`STORAGE_POLICY=memory` keeps tokens in memory only, for ephemeral test
deployments where nothing should survive a restart.

`TOKEN_SECRET` signs the tokens, so it is the trust boundary between
deployments: change it and every previously issued token stops validating, and
a token minted by one router is not valid on another.

## Suggested topology

```
developer laptops ──┐
CI jobs ────────────┼──► router (one per team)  ──► vendor subscription
scheduled agents ───┘        │
                             ├─ /metrics  ──► Prometheus
                             └─ audit.jsonl ─► log collector
```

One token per task keeps the audit trail attributable — see
[per-task-tokens.md](per-task-tokens.md) and
[audit-and-monitoring.md](audit-and-monitoring.md).

## Checklist before exposing the port

- [ ] `TOKEN_SECRET` set to a random value, not a default.
- [ ] An admin credential in hand — the bootstrap token printed at first start,
      or `TOKEN_ADMIN_KEY` set. Never `--allow-anonymous-admin`.
- [ ] `ROUTER_HOST=127.0.0.1`, or a published port restricted to loopback,
      unless an admin credential is required and TLS terminates in front.
- [ ] `AUDIT_LOG` pointed somewhere durable.
- [ ] The subscription directory mounted **read-only**.
- [ ] Tokens issued with a `--max-requests` budget and a short TTL.
