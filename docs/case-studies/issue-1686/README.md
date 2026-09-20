# Issue 1686 Case Study: `/log` command for Telegram bot

## Source Artifacts

- Issue metadata: `raw-data/issue-1686.json`
- Issue comments (empty at the time of solving): `raw-data/issue-1686-comments.json`
- Solution PR snapshot: `raw-data/pr-1687.json`

## Problem Summary

Issue #1686 asks for a new Telegram command `/log` that lets a chat owner pull the
log file of an ongoing or finished `solve`/`hive` session that was launched
through one of the `$` isolation backends (`screen`, `tmux`, `docker`).

The desired behaviour from the issue text:

1. The command must work in two ways:
   - `/log` sent **as a reply** to a message that contains a valid session id, or
   - `/log <UUID>` sent directly in a public chat or in private messages.
2. The session id must be validated against `$ --status <UUID>` — if the id is
   unknown to start-command we must reject the request.
3. The log must always be delivered as a **file attachment** (Telegram document),
   never inlined into the chat. The file is sent **as a reply** to the user's
   `/log` message.
4. Privacy guarantees:
   - The bot must determine whether the session belongs to a public or a private
     GitHub repository.
   - If the repository is **private**, the log must be sent to the owner via
     **private message** (DM). The bot must never leak the log into a public
     chat. In the private-message flow we also forward the original message that
     contains the session id and reply with the file there.
   - If the repository is **public**, the file may be uploaded directly to the
     public chat where `/log` was issued.
5. Only the **chat owner** (`creator` in Telegram terms) is authorised to use
   `/log`. Other users — including chat administrators — must be rejected.
6. The command should currently work only when the session was launched with one
   of the `$` isolation backends (`screen`, `tmux`, `docker`). Non-isolation
   sessions are out of scope (they don't have a stable per-session log file).

## External Research

- Telegram Bot API reference for sending files: <https://core.telegram.org/bots/api#senddocument>.
  `sendDocument` accepts a local file path (uploaded as `multipart/form-data`),
  a `file_id` reference, or an HTTPS URL. Maximum upload size for bots is 50MB.
- Telegram Bot API reference for `getChatMember`:
  <https://core.telegram.org/bots/api#getchatmember>. Returns a `ChatMember`
  whose `status` field is one of `creator`, `administrator`, `member`,
  `restricted`, `left`, `kicked`. To enforce "owner only" we check
  `status === 'creator'` — this matches the existing convention used by
  `/start`, `/stop`, and `/top` in this repo
  (`src/telegram-start-stop-command.lib.mjs:134`,
  `src/telegram-top-command.lib.mjs:111`).
- Telegraf reply helpers used elsewhere in this repo:
  - `ctx.reply(text, { reply_to_message_id })` — text reply,
  - `ctx.replyWithDocument(InputFile, { reply_to_message_id })` — file reply.
    Telegraf docs: <https://telegraf.js.org/classes/Telegram.html>.
- `start-command` exposes the per-session log path directly in the JSON returned
  by `$ --status <uuid> --output-format json`. The field is called `logPath`
  and resolves to either:
  - `/tmp/start-command/logs/direct/<uuid>.log` for non-isolation runs, or
  - `/tmp/start-command/logs/isolation/<backend>/<uuid>.log` for isolation runs
    (`screen`/`tmux`/`docker`).
    Reference: <https://github.com/link-foundation/start>. Verified locally with
    `$ --status <uuid> --output-format json` on the development host.
- GitHub repository visibility lookup is already wrapped in this repo by
  `detectRepositoryVisibility(owner, repo)` in `src/github.lib.mjs:1389`.
  It calls `gh api repos/<owner>/<repo> --jq .visibility` (with retry) and
  returns `{ isPublic: boolean, visibility: string|null }`. The default on
  failure is `isPublic: true` for cleanup safety in the existing call sites,
  but for `/log` we must invert that default — when in doubt, **treat the repo
  as private** so we never leak data.

## Requirements Extracted from the Issue

The issue body lists six concrete requirements:

| #   | Requirement                                                                                                                                                                                                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Trigger via `/log` reply to a message containing a session id, or via `/log <UUID>` directly.                                                                                                                                                                                 |
| R2  | Validate the session id with `$ --status <UUID>` before fetching anything. Only sessions that exist in start-command's catalogue are accepted.                                                                                                                                |
| R3  | Always deliver the log as a **file attachment** that is a **reply to the user's `/log` message**. Never paste log contents into the chat.                                                                                                                                     |
| R4  | Limited to `$` isolation sessions (`screen`/`tmux`/`docker`) right now.                                                                                                                                                                                                       |
| R5  | Inspect the GitHub repo associated with the session and decide public vs private. Private logs must never enter a public chat — they go to the user's DM with the bot, where the bot also forwards the message that contained the session id and replies with the file there. |
| R6  | Owner-only access. Chat administrators and members must be rejected.                                                                                                                                                                                                          |

Two implicit requirements emerged during root-cause analysis:

| #   | Implicit requirement                                                                                                                                                                                                                                                                                                                                                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R7  | A user may not own a chat where `/log` is invoked (e.g. they reply with `/log` in a group they aren't admin of). The bot must reject without leaking the log.                                                                                                                                                                                                                                |
| R8  | A user may try to fetch a log that was created in a _different_ chat. The session-monitor's tracked record (`activeSessions`) tells us which chat the session originally belonged to. To prevent cross-chat leakage we require the requester to be the owner of the chat the session was launched in (or of the chat where `/log` is now being issued, if the session is no longer tracked). |

## Existing Components Reused

| Reused                                         | Where                                                                                        | Why                                                                                                                                                                                                       |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `querySessionStatus(uuid)`                     | `src/isolation-runner.lib.mjs:210`                                                           | Already validates a UUID against `$ --status` and returns parsed JSON.                                                                                                                                    |
| `parseSessionStatusOutput(raw)`                | `src/isolation-runner.lib.mjs:46`                                                            | Tolerant parser for `$ --status` output. We extend it to also expose `logPath`, `command`, `isolation`, and `workingDirectory` because those fields are present in start-command's JSON and we need them. |
| `detectRepositoryVisibility(owner, repo)`      | `src/github.lib.mjs:1389`                                                                    | Already wraps `gh api repos/.../.visibility` with retries.                                                                                                                                                |
| `parseGitHubUrl(url)`                          | `src/github.lib.mjs:1021`                                                                    | Parses `owner`/`repo` from any GitHub URL.                                                                                                                                                                |
| `activeSessions` (via `getActiveSessionForId`) | `src/session-monitor.lib.mjs`                                                                | Looks up an in-memory record of a session — gives us its original chat id and the URL the session was launched against.                                                                                   |
| Owner-only validation pattern                  | `src/telegram-start-stop-command.lib.mjs:99–146`, `src/telegram-top-command.lib.mjs:108–124` | We re-use the exact same `getChatMember(...).status === 'creator'` check.                                                                                                                                 |
| Telegram message filters                       | `src/telegram-message-filters.lib.mjs`                                                       | We bypass `isForwardedOrReply` for `/log` because _replies are the primary trigger_. We instead lift the session id from the reply text.                                                                  |

## Design

### Where session ids come from

There are two carriers:

1. **Direct argument**: `/log <UUID>`. We accept any v4-shaped UUID
   (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`, case-insensitive) anywhere in the
   message text.
2. **Reply context**: `/log` (no args) sent in reply to a message that contains
   the same UUID pattern. The bot's existing executing/completion messages
   already include `📊 Session: \`<uuid>\``(see`src/work-session-formatting.lib.mjs:49–69`), so a normal user flow is
"long-press the bot's status message → Reply → type `/log`".

We use a single helper `extractSessionIdFromText(text)` that searches with the
RFC 4122-style UUID regex and returns the first match.

### Where log files come from

We **always** ask `$ --status <UUID> --output-format json` and look at the
`logPath` field. This eliminates the need to guess the directory layout:
start-command itself is the source of truth.

If `$ --status` succeeds but doesn't expose `logPath` (older builds) we fall
back to the documented layout
`/tmp/start-command/logs/isolation/<backend>/<uuid>.log` and finally
`/tmp/start-command/logs/direct/<uuid>.log`.

If the file referenced by `logPath` doesn't exist on disk we report a clear
error to the user instead of sending an empty document.

### Privacy decision

```
sessionInfo := activeSessions[uuid] ?? null
url         := sessionInfo?.url ?? extract from $ --status command line
parsed      := parseGitHubUrl(url) — yields { owner, repo } or null

if parsed:
   { isPublic } := detectRepositoryVisibility(owner, repo)
   target = isPublic ? sender chat : DM with the user
else:
   # Cannot determine repository — fail closed
   target = DM with the user  (treat as private)
```

The "fail closed" rule is crucial: if we cannot identify the repo we still must
not leak the log, so we send to DM. This inverts the default of
`detectRepositoryVisibility` (which defaults to public for cleanup-cost
reasons) for this command only.

### Owner-only enforcement

We enforce the existing convention from `/stop`, `/start`, `/top`: the user
must be the **creator** of the chat where they invoked `/log`. In the DM-only
flow (private chat, `/log <UUID>`) we additionally require that the requester
is the creator of the chat where the original session was tracked, when that
chat is known via `activeSessions`. This blocks the case where a non-owner
opens a DM with the bot and tries to harvest logs from groups they don't own.

If the session is no longer tracked (process restart, etc.) we can't know the
original chat. In that case `/log` only works from the chat where the user is
creator AND the repository is public, OR via DM if the requester is in the
bot's `TELEGRAM_ALLOWED_CHATS` whitelist as creator of at least one of those
chats. (For the first iteration we keep the simpler rule: if the session is
not tracked, only allow `/log` from the chat where it is invoked by its
creator. This matches the issue text — "owners of chats" — and avoids
introducing a new authorisation concept.)

### Delivery format

We use Telegraf's `ctx.replyWithDocument({ source: localPath, filename })`
helper, which posts `sendDocument` with the file streamed from disk. We always
set `reply_to_message_id` to the message that contained `/log` (in both group
and DM flows). For the DM flow we additionally `forwardMessage` the original
message that carried the session id (so the audit trail is preserved in DM)
before posting the document as a reply to that forwarded message.

If the log file is larger than Telegram's 50MB document upload limit we fall
back to uploading via `gh-upload-log` (already used elsewhere in the repo, see
`src/log-upload.lib.mjs`) and replying with the resulting URL — but this is
out of scope for the first iteration; we just log the error if the file is
oversized.

## Test Strategy

The implementation lives in two small, pure modules so we can unit-test the
logic without spinning up a real Telegram bot:

1. `src/telegram-log-command.lib.mjs` — the command registration and the
   request orchestration. The `extractSessionIdFromText`, the privacy
   decision (`decideLogDestination`), and the `$ --status` parser extension
   are exported so tests can drive them directly.
2. `src/isolation-runner.lib.mjs` — extended `parseSessionStatusOutput` so
   `logPath`, `command`, `isolation`, `workingDirectory` are surfaced.

Unit tests in `tests/test-issue-1686-log-command.mjs` cover:

- UUID extraction from a direct command (`/log <UUID>`),
- UUID extraction from a reply text (`📊 Session: \`<UUID>\``),
- Rejection of malformed/missing UUIDs,
- `parseSessionStatusOutput` exposes `logPath` from JSON and from text format,
- `decideLogDestination` returns `chat` for public repos, `dm` for private
  repos, and `dm` (fail-closed) when the repository visibility cannot be
  determined,
- `decideLogDestination` enforces "isolation only" — sessions whose
  `isolation` is `null`/`direct` are rejected as out-of-scope per R4.

The bot wiring in `telegram-bot.mjs` is registered through the same shared
`registerStartStopCommands` / `registerTopCommand` pattern so it stays small
and readable.

## Out of Scope (for this iteration)

- Streaming `tail -f` of a running session log (would require periodic
  `editMessageMedia` updates and chunked re-uploads).
- Automatic upload to GitHub gist for files larger than 50MB.
- Acting on `--isolation docker` containers' log files differently from
  screen/tmux — start-command already abstracts this for us.
