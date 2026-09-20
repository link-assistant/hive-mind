# Codex (ChatGPT) id_token JWT claims — 2026-05-12

The Codex CLI persists three tokens in `~/.codex/auth.json`:

```jsonc
{
  "auth_mode": "chatgpt",
  "OPENAI_API_KEY": null,
  "tokens": {
    "id_token": "<JWT>",
    "access_token": "<JWT>",
    "refresh_token": "<JWT>",
    "account_id": "<uuid>",
  },
  "last_refresh": "...",
}
```

`id_token` is the OIDC ID token issued by `https://auth.openai.com`. Its
payload contains an `https://api.openai.com/auth` claim with the active
subscription window:

| Claim                               | Meaning                                                |
| ----------------------------------- | ------------------------------------------------------ |
| `chatgpt_plan_type`                 | `"free"`, `"plus"`, `"pro"`, `"team"`, `"enterprise"`  |
| `chatgpt_subscription_active_start` | ISO-8601 timestamp — when the current period began.    |
| `chatgpt_subscription_active_until` | ISO-8601 timestamp — **when the current period ends**. |
| `chatgpt_subscription_last_checked` | ISO-8601 timestamp — when the CLI last refreshed.      |

`chatgpt_subscription_active_until` is exactly the value the issue asks for.

The same set of claims is documented (de-facto) in the upstream Codex CLI
source: it’s the authoritative source the CLI itself uses to gate UI flows.
We never have to call the ChatGPT backend — every value above is decodable
from the token already on disk.

## Why we use the id_token, not the access_token

Both tokens are issued by the same OIDC server and they share most claims, but
the **identity** claims (subscription dates, plan type, organisations) live on
the `id_token`. The `access_token` typically only carries the audience and
scope. To make the helper robust we decode the `id_token` first, then fall back
to the `access_token` if the id token isn’t persisted (older CLI installs).

## Robustness notes

- The token is base64url-encoded JSON. `decodeJwtPayload` in
  `src/limits.lib.mjs` already handles the padding/normalisation; we reuse it.
- We do **not** verify the JWT signature — we only inspect non-secret claims
  that the CLI already trusts. The values are local, persisted by the user’s
  own Codex install.
- If the token is rotated and the JWT can’t be decoded, the helper returns
  `{ ok: false }` and the renderer suppresses the line — exactly the
  “only when available” behaviour the issue calls for.
