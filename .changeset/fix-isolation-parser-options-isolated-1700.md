---
"@link-assistant/hive-mind": patch
---

Fix /log and /terminal_watch falsely rejecting real `$` isolation sessions (issue #1700)

`parseSessionStatusOutput` looked for the isolation backend at `data.isolation`
or `data.options.isolation`, but the published `link-foundation/start` 0.25.x
CLI reports it at `options.isolated` in both JSON and the default
`links-notation` output. As a result, replying `/log` (or `/terminal_watch`) to
a `Work session finished` message rejected every screen / tmux / docker session
with `❌ This command currently supports only sessions launched with $
isolation`. The parser now reads `options.isolated` first and keeps the legacy
field names as fallbacks. The rejection site additionally emits a `[VERBOSE]`
diagnostic line so future contract drifts can be triaged from a single bot log
entry. Regression test in `tests/test-issue-1700-isolation-parsing.mjs`.
