# Case Study: Telegram Bot Token Leak via Bash Tool Comment (#1745)

## Overview

The Telegram bot token (`8490528355:AAGHe...ItHCY`, **now revoked**) was published in
plain text inside a public-facing pull-request comment authored by the AI agent
running under our `solve.mjs`/interactive-mode bridge.

The leak surface: the agent ran `env` (or a process-environment dump command)
inside a `Bash` tool call, and `interactive-mode.lib.mjs` posted the **raw**
output of that tool back into the PR as a comment without running it through
`sanitizeLogContent`.

**Source data:**

- Leaked PR comment: `xlab2016/space_db_private/pull/20#issuecomment-4104547747`
  ([raw JSON](data/leaked-comment.txt))
- Original bug report: [issue #1745](data/issue-1745.json)
- Existing token sanitizer: [`src/token-sanitization.lib.mjs`](../../../src/token-sanitization.lib.mjs)
- Existing case study covering the same comment surface: [issue-1458 analysis](../issue-1458/analysis.md)

---

## Timeline of Events

| Time (UTC)          | Event                                                                                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-03-21 21:54:53 | `xlab2016/space_db_private/pull/20` interactive Claude session starts (system.init)                                                                                              |
| 2026-03-21 21:59:24 | Agent issues a `Bash` tool call whose output includes the process environment block (env vars including `TELEGRAM_BOT_TOKEN=8490528355:AAGHeNpjZJqWEytzt4iw1kfW2ouXlyItHCY`)     |
| 2026-03-21 21:59:25 | `interactive-mode.lib.mjs#handleToolResult` edits the matching tool-use comment with the raw bash output verbatim — **no sanitization applied** — token now public on github.com |
| 2026-05-02 14:27    | Issue #1745 filed; token revoked in @BotFather                                                                                                                                   |

---

## Root Cause

`interactive-mode.lib.mjs` exposes two posting helpers, `postComment` and
`editComment`, that each call `gh api ... -X POST/PATCH --input -` with a JSON
body assembled from raw event data. The Bash-tool result handler embeds the
output into a fenced `bash` code block via:

````js
const truncatedContent = truncateMiddle(content, { maxLines: 60, keepStart: 25, keepEnd: 25 });
const mergedComment = `## ${toolIcon} ${toolName} tool use

${inputDisplay}

${createCollapsible(`📤 Output (${statusIcon} ${statusText.toLowerCase()})`, '```\n' + escapeMarkdown(truncatedContent) + '\n```', true)}
...`;
````

`truncatedContent` is the **untouched stdout/stderr** of the Bash tool. When
the agent runs `env`, `set`, `printenv`, `cat .env`, or any command that
includes secret-bearing strings in its stdout, those strings flow straight
through `escapeMarkdown` (which doesn't redact secrets) and into the comment.

`token-sanitization.lib.mjs` already exists and is invoked from
`github.lib.mjs` for **log uploads** (gist + attached log file). It is **not**
called from `interactive-mode.lib.mjs` — the inline tool-use comments bypass
it entirely. That is the gap.

A second contributing factor: the chat operator runs the bot with the secret
in `process.env`. There is no cross-cutting code path that masks
`process.env.TELEGRAM_BOT_TOKEN`, `ANTHROPIC_API_KEY`, etc., even when the
sanitizer runs — those known local secrets must be added to the masking
pipeline so even a custom-pattern miss is still defended.

---

## Why The Existing Pattern Should Have Caught It

The custom Telegram pattern in `detectSecretsWithCustomPatterns()`:

```js
{ name: 'telegram', pattern: /\b[0-9]{8,10}:[a-zA-Z0-9_-]{30,}/g }
```

…matches the leaked token in isolation:

```
> /\b[0-9]{8,10}:[a-zA-Z0-9_-]{30,}/g.test('8490528355:AAGHeNpjZJqWEytzt4iw1kfW2ouXlyItHCY')
true
```

The pattern was simply never run because the comment-publishing code path did
not call `sanitizeLogContent`. The fix is plumbing, not pattern coverage.

---

## Fixes In This PR

1. **Sanitize every comment body posted by the AI bridge** — wrap
   `postComment`/`editComment` in `interactive-mode.lib.mjs` so each body
   passes through `sanitizeLogContent` before it leaves the process. The
   sanitizer also includes known-local tokens (env vars + `gh auth status`
   tokens) so even unknown patterns still get masked.
2. **Tighten masking to `first-3 + \*** + last-3`** to match the issue's
requirement (was `first-5 + \*\*\* + last-5`).
3. **Hook leak alerting** — when a comment body is detected to contain any
   known-local token, the bridge logs a warning and (when a telegram notifier
   is registered) DMs the owner of the chat that started the session.
4. **`/tokens` hidden command** — chat owners can list active local tokens
   (already masked) in private chats only. Not advertised in `/help`. Useful
   for spot-checking which tokens are live before searching GitHub for them.
5. **Tests** — `tests/test-token-leak-issue-1745.mjs` reproduces the leak
   shape from the linked PR comment and verifies the new path masks it.

---

## Files Changed

- `src/lib.mjs` — `maskToken` now defaults to 3-char prefix/suffix (issue spec)
- `src/token-sanitization.lib.mjs` — adds `getEnvironmentTokens`,
  `getAllKnownLocalTokens`, `containsKnownToken`, `sanitizeCommentBody`
- `src/interactive-mode.lib.mjs` — `postComment`/`editComment` sanitize bodies
- `src/telegram-tokens-command.lib.mjs` (new) — hidden `/tokens` handler
- `src/telegram-bot.mjs` — registers `/tokens`
- `src/telegram-leak-notifier.lib.mjs` (new) — DMs chat owner on detected leak
- `tests/test-token-leak-issue-1745.mjs` (new) — regression test

---

## Related GitHub / Upstream Issues

- secretlint already catches this via the `preset-recommend` rule. The library
  is already a dependency, so no upstream fix is needed; we just need to call
  it from the comment path.
- truffleHog / gitleaks are popular alternatives if we ever want to swap out
  secretlint. Both ship Telegram-bot-token signatures.

## Existing components / libraries that solve similar problems

| Library                      | Coverage         | Notes                                                                               |
| ---------------------------- | ---------------- | ----------------------------------------------------------------------------------- |
| `secretlint` (already a dep) | broad            | Used today only on log uploads — extending its surface is the cheapest fix.         |
| `gitleaks`                   | broad            | Mature CLI; we can run it in CI as a second line of defense.                        |
| `trufflehog`                 | broad + verifier | Verifies tokens against live APIs (could be used by `/tokens` to confirm "active"). |
| `git-secrets`                | narrow (AWS)     | Not enough on its own.                                                              |

## Suggested follow-ups

- Run `gitleaks` or `trufflehog` over all PR comments authored by the bot in
  the last 90 days (not just this PR) and revoke anything that matches.
- Add a CI job that calls `sanitizeLogContent` on `gh pr diff` output and
  fails the build if any known-local token survives masking.
- Consider sandboxing the agent's shell so `env` returns a curated allowlist
  rather than the full process environment.
