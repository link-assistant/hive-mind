# Provider error strings and codes for subscription/account-access blocks

This is the raw material behind `src/subscription-error.lib.mjs`. Every string
below was read out of the CLI that ships it (byte scan of the installed binary /
bundle), not copied from a blog post, so the detector matches what the tools
actually print.

Versions scanned on 2026-08-17:

| Tool     | Version                 | Artifact scanned                                                                               |
| -------- | ----------------------- | ---------------------------------------------------------------------------------------------- |
| Claude   | `2.1.233 (Claude Code)` | `~/.local/share/claude/versions/2.1.233` (324 598 064 bytes)                                   |
| Codex    | `codex-cli 0.147.0`     | `@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex` (258 MB)                  |
| Qwen     | `@qwen-code/qwen-code`  | `chunks/chunk-DG4IQ6JG.js`, `chunks/qwenContentGenerator-T75M2Z3B.js`, `chunks/zh-LMSTK4WD.js` |
| Gemini   | `@google/gemini-cli`    | `bundle/gemini-I57YPWDS.js`, `bundle/interactiveCli-4CVVH6KY.js`                               |
| opencode | `opencode-ai`           | `bin/opencode.exe` (183 756 928 bytes)                                                         |

## Claude Code

### Machine-readable codes

Emitted as `error` on `assistant`/`result` stream-json events (`tengu_api_error`
telemetry family):

```
wif_credential_error   auth_error   token_revoked   oauth_org_not_allowed
api_error   api_retries_exhausted
```

`oauth_org_not_allowed` is the code from issue #2161 (with `api_error_status: 403`
and `terminal_reason: "api_error"`).

### Verbatim messages

Account/organization blocks (the class this work handles):

```
Your organization has disabled Claude subscription access for Claude Code · Use an Anthropic API key instead, or ask your admin to enable access
Your account does not have access to Claude. Please login again or contact your administrator.
Your ANTHROPIC_API_KEY belongs to a disabled organization · Unset the environment variable to use your subscription instead
Your ANTHROPIC_API_KEY belongs to a disabled organization · Update or unset the environment variable
Your organization has disabled API key authentication · Unset ANTHROPIC_API_KEY to use your claude.ai account instead
Your organization has disabled API key authentication · Run /login to sign in with your claude.ai account
OAuth token revoked · Please run /login
Not logged in · Please run /login
Credit balance is too low
Invalid API key · Fix external API key
Invalid auth token · Fix external auth token
… is not available with the Claude Pro plan. If you have updated your subscription plan recently, run /logout and /login for the plan to take effect.
```

Neighbouring strings that are **transient** and must stay on the retry path — they
live a few hundred bytes away from the blocks above in the same binary, which is
exactly why the detector needs an explicit exclusion list:

```
Repeated 529 Overloaded errors
Opus is experiencing high load, please use /model to switch to Sonnet
Server is temporarily limiting requests (not your usage limit)
Request timed out
Authentication error · This may be a temporary network issue, please try again
```

## Codex CLI

### Machine-readable codes

From the sign-in/refresh error enums:

```
disabled_by_admin   plan_not_eligible   required_app_unavailable
missing_codex_entitlement   not_chatgpt_auth   no_external_auth
refresh_token_expired   refresh_token_invalidated
```

### Verbatim messages

```
You do not have access to Codex
This account is not currently authorized to use Codex in this workspace.
Contact your workspace administrator to request access to Codex.
Your access token could not be refreshed. Please log out and sign in again.
Your access token could not be refreshed because you have since logged out or signed in to another account. Please sign in again.
```

## Qwen Code

```
Refresh token expired or invalid. Please use '/auth' to re-authenticate.
Qwen OAuth credentials expired. Please use /auth to re-authenticate with qwen-oauth.
Coding Plan API key not found. Please re-authenticate with Coding Plan.
Failed to obtain valid Qwen access token. Please re-authenticate.
```

## Gemini CLI

```
The enforced authentication type is 'oauth-personal', but the current type is 'gemini-api-key'. Please re-authenticate with the correct type.
… this account … doesn't have a Gemini Code Assist for Individuals (free) tier.
```

## opencode

```
OAuth token refresh failed and no fallback ${ENV_VAR} environment variable is set. Refresh error: … Re-authenticate with 'opencode auth login <provider>' …
Run `opencode auth login` in the terminal
Access denied to GitLab AI features (…). This may indicate that: (1) GitLab Duo is not enabled on this instance, (2) Your account does not have access to AI features, or (3) …
```

## How the detector uses this

`src/subscription-error.lib.mjs` has two layers:

1. **Codes** (`SUBSCRIPTION_ERROR_CODES`) — trusted even with no message text.
2. **Messages** (`MESSAGE_RULES`) — multi-needle, lower-cased, substring
   matching, for tools that print prose without a code.

The transient list above is checked **before** the message rules
(`isTransientAuthError`), so "Authentication error · This may be a temporary
network issue" keeps retrying while "Your organization has disabled…" stops the
run.

`tests/subscription-error-2161.test.mjs` asserts one case per string above.
