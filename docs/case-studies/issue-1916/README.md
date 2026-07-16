# Issue 1916 Case Study: Reply to message didn't produce a task on GitHub

## Summary

Issue: https://github.com/link-assistant/hive-mind/issues/1916

A user replied to a forwarded message that contained the issue text with the
command:

```text
/task https://github.com/link-assistant/formal-ai
```

The bot responded with:

```text
❌ Missing issue text.

Usage: /task <github-repository-url> followed by issue text.

Or reply to a message containing a repository URL and issue text with /task.

To split an existing issue, use /split <github-issue-url> or /task --split <github-issue-url>.
```

The expectation is that replying with `/task <repository-url>` to a message
containing the issue text should create a GitHub issue, using the repository
from the inline command and the issue text from the replied-to message.

The root cause was in `resolveTaskIssueCreationInput`: when any inline text was
present after the `/task` command, the function returned the inline text and
**completely ignored the replied-to message**. So with the repository URL inline
and the issue text in the reply, the reply text was dropped, leaving only the
repository — hence "Missing issue text."

## Data Collected

Raw data is in `raw-data/`:

- `issue-1916.json`: issue title, body, labels, and timestamps from GitHub.
- `issue-1916-comments.json`: issue comments (empty at investigation time).
- `pr-1917.json`: prepared PR metadata.
- `pr-1917-conversation-comments.json`, `pr-1917-review-comments.json`: PR
  comments / review comments (empty at investigation time).

The issue screenshot (Telegram conversation) shows three messages:

1. A forwarded message from "Yura" containing the issue text (Russian).
2. A message with a `link-assistant/formal-ai` repository link preview.
3. The user's `/task https://github.com/link-assistant/formal-ai` command,
   sent as a reply to the forwarded issue-text message.

## Timeline / Sequence of Events

1. User forwards a message containing the desired issue text into the chat.
2. User replies to that forwarded message with `/task <repository-url>`.
3. Telegram delivers an update where:
   - `message.text` = `/task https://github.com/link-assistant/formal-ai`
   - `message.reply_to_message.text` = the issue text.
4. `handleTaskCommand` (`src/telegram-task-command.lib.mjs`) runs in
   non-split mode and calls `resolveTaskIssueCreationInput({ commandText, replyText })`.
5. `resolveTaskIssueCreationInput` strips the `/task` prefix, sees a non-empty
   inline value (`https://github.com/link-assistant/formal-ai`), and returns it
   **without** the reply text.
6. `parseTaskIssueCreationInput` finds the repository but no body lines and
   returns `{ valid: false, error: 'Missing issue text.' }`.
7. The bot replies with the "Missing issue text." usage message.

## Requirements (extracted from the issue)

- Replying to a message, with a specified repository, must actually create a
  GitHub issue.
- Compile issue data/logs into `./docs/case-studies/issue-{id}`.
- Perform a case-study analysis: timeline, requirements, root causes, proposed
  solutions, and a check of existing components/libraries that could help.
- If there is not enough data to find the root cause, add debug output / a
  verbose mode to capture it on the next iteration.
- If the issue relates to another reportable repository, file an issue there
  with reproducible examples, workarounds, and code suggestions.
- Apply the fix across the entire codebase, in every place the problem occurs.

## Root Cause

`src/task.issue-creation.lib.mjs`, original `resolveTaskIssueCreationInput`:

```js
export function resolveTaskIssueCreationInput({ commandText = '', replyText = '' } = {}) {
  const inlineText = stripTaskCommandPrefix(commandText);
  if (inlineText) return inlineText; // <-- reply text discarded here
  return normalizeNewlines(replyText).trim();
}
```

The inline text and the replied-to message are **complementary**, not
mutually exclusive: in the reply flow one part typically carries the
repository URL and the other carries the issue text. Returning only one of
them loses information whenever the user splits repo and text across the
command and the reply.

A secondary issue: once the two parts are combined, the same repository can
legitimately appear in both the inline command and the reply. The original
`setRepository` rejected any second repository with
"Only one GitHub repository may be provided.", which would have turned a
harmless duplicate into an error.

## Fix

`src/task.issue-creation.lib.mjs`:

1. `resolveTaskIssueCreationInput` now **combines** inline and reply text when
   both are present (inline first, so it takes precedence for title/body
   ordering); otherwise it returns whichever one is non-empty.

   ```js
   export function resolveTaskIssueCreationInput({ commandText = '', replyText = '' } = {}) {
     const inlineText = stripTaskCommandPrefix(commandText);
     const reply = normalizeNewlines(replyText).trim();
     if (inlineText && reply) return `${inlineText}\n${reply}`;
     return inlineText || reply;
   }
   ```

2. `setRepository` now treats an identical repository as a no-op and only
   rejects genuinely different repositories, so combining a reply that repeats
   the repository URL no longer errors.

`src/telegram-task-command.lib.mjs` adds a `VERBOSE` log line recording whether
the command was a reply and the resolved input length, to ease future
debugging of this path.

## Behavior After Fix

| Scenario                                             | Before                   | After                                                       |
| ---------------------------------------------------- | ------------------------ | ----------------------------------------------------------- |
| Reply with `/task <repo>` to issue-text message      | ❌ Missing issue text    | ✅ Issue created                                            |
| Reply with `/task <issue text>` to repo-link message | ❌ Missing repository    | ✅ Issue created                                            |
| Reply with bare `/task` to repo+issue message        | ✅                       | ✅ (unchanged)                                              |
| Inline `/task <repo>\n<issue text>` (no reply)       | ✅                       | ✅ (unchanged)                                              |
| Same repo inline and in reply                        | ❌ would error/lose text | ✅ deduped, issue created                                   |
| Two **different** repos inline and in reply          | n/a                      | ❌ "Only one GitHub repository may be provided." (intended) |

## Tests

`tests/test-telegram-task-command.mjs` adds regression tests covering:

- combining inline repo with replied issue text,
- combining inline issue text with replied repo,
- bare `/task` reply using repo + issue text from the reply,
- tolerating the same repo inline and in reply,
- still reporting a conflict for two different repositories,
- an end-to-end `handleTaskCommand` reply path that creates the issue.

Reproduction script: `experiments/issue-1916-repro.mjs`.

## Existing Components / Libraries Considered

The parsing already reuses `parseGitHubUrl` (`src/github.lib.mjs`) for
repository detection and the existing `parseTaskIssueCreationInput` pipeline.
No new dependency was needed — the fix is purely in how the two text sources
are merged before parsing, so it composes with the existing, tested parser.

## Other Repositories

The bug is entirely within this repository's Telegram `/task` handling. No
external repository needed an issue filed.
