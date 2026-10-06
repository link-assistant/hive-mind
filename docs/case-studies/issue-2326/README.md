# Input error locations

Issue [#2326](https://github.com/link-assistant/hive-mind/issues/2326) shows
`/claude https://github.com/bpmbpm/mdld-test/issuese/1` repeatedly failing with
“URL must be a GitHub issue, pull request, repo (not other)”. The malformed
`-think` option in the same screenshot already had a correction, but neither
error identified a position in the input.

The URL parser classified an unknown repository path as `other`. Telegram
reported that category and discarded the path that caused it. Syntax diagnostics
now retain the offending segment and its column, echo the URL, and suggest a
unique nearby known path or host spelling. Suggestions leave the parsed target
unchanged. Existing URL recovery, valid targets, owner/repository names, and
query strings/fragments retain their behavior.

Shared CLI and Telegram option parsing adds the argument position and original
flag to validation errors. Invalid values include the flag and its value;
unrelated argument values are omitted. Malformed flags also include their
positions. `solve` previously swallowed some validation failures and continued
with `error.argv` or `{}`; those failures now reach its existing error handler.

## Caret display (review feedback)

Review of the first version ([comment](https://github.com/link-assistant/hive-mind/pull/2562#issuecomment-6023335244))
found a quoted segment and a column number not user friendly enough, and asked
for bold text, a capitalization fallback, or — preferably — a compiler-style
arrow in a code block. Hints now show the input with a caret line under the
offending part:

```text
Check URL path segment "issuese" (column 37):
  https://github.com/bpmbpm/mdld-test/issuese/1
                                      ^^^^^^^
```

Telegram replies use legacy Markdown (`parse_mode: 'Markdown'` in
`safeReply`): the part is bold and the snippet is in a ` ``` ` block, so the
caret stays aligned in a monospace font. Telegram's legacy Markdown does not
allow escapes inside entities ([Bot API, Markdown style](https://core.telegram.org/bots/api#markdown-style)),
so input containing a backtick falls back to escaped text with the offending
part in capitals, and a part containing Markdown characters is quoted instead
of bold. For the same reason, the "Did you mean" suggestion inside inline code is no
longer escaped (an underscore would otherwise show as `\_`). Wide characters
count as two columns and zero-width characters as none. Telegram snippets
longer than 48 columns are trimmed around the offending part at a `/` or space
boundary, so a long URL is less likely to wrap and misalign the caret on a
narrow phone screen (wrapping was not verified on a device). Missing issue or
pull request numbers put the caret after the end of the URL. The `/task` reply
uses the same block.

Preview the Telegram replies without contacting Telegram:

```sh
node experiments/issue-2326/preview-telegram.mjs
node experiments/issue-2326/preview-task.mjs
```

## Reproduction and verification

```sh
node tests/issue-2326-input-diagnostics.test.mjs
node experiments/issue-2326/reproduce.mjs
npm test
```

The regression file reproduced the missing URL correction/location, missing
option positions, and swallowed validation error before the implementation.
It covers 24 cases, including caret alignment, trimming and Markdown fallbacks, the production Telegram validator and `/task` reply, CLI and
Telegram parsers, malformed flags, invalid values, multiple errors, duplicate
path words, unsafe guesses, preserved recovery, and error metadata/idempotence.

Logs are saved locally in `experiments/issue-2326/*.log`; GitHub workflow logs
are saved in `ci-logs/`. The initial workflow
[37480900675](https://github.com/link-assistant/hive-mind/actions/runs/37480900675)
ran against prepared commit `32e1f339`, before the fix. Its log at lines
2524–2529 reports four stale declarations: `start-command` 0.35.3 → 0.35.4 in
three Dockerfiles and `command-stream` 1.5.0 → 1.6.2 in the runtime package map.
The mandatory freshness check reproduced these failures locally. The pins and
matching fixtures were refreshed without changing the check.

The [follow-up run](https://github.com/link-assistant/hive-mind/actions/runs/37486418864)
failed the same gate for `links-notation` 0.22.0 → 0.23.0 (detector job log
lines 2517–2519). Registry metadata shows 0.23.0 was published at
2026-10-06 15:23:08 UTC, after this run was queued at 15:18:48 UTC. Its runtime
pin and matching alias fixture were also refreshed.

The first security scan of the implementation flagged the regression test's
URL substring assertion as incomplete URL validation ([annotation](https://github.com/link-assistant/hive-mind/pull/2562#discussion_r4196927353)).
That assertion checks displayed error text, not host authorization. It now
compares the complete `Input:` field against the quoted original URL, which
tests the intended behavior more precisely without disabling the scanner.

A later [security run](https://github.com/link-assistant/hive-mind/actions/runs/37484415408)
failed npm audit at log lines 235–247 for existing `shell-quote` 1.10.0, a
development dependency of Changesets through `launch-editor`.
[GHSA-pqg4-j6r4-53mv](https://github.com/advisories/GHSA-pqg4-j6r4-53mv) identifies
a command injection vulnerability fixed from 1.11.0. Updating only that lockfile
entry to 1.12.0 stays within the existing dependency range; npm audit then
reports zero vulnerabilities.

## Visual evidence

Original screenshot from the issue:

![Original Telegram errors](before.png)

Offline browser render comparing the original reply with the production
validator's reply. This is a reply preview, not a live Telegram conversation.
Recreate its HTML with the experiment script above.

![Before and after validation replies](comparison.png)
