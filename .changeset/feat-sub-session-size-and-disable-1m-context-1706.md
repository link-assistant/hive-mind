---
'@link-assistant/hive-mind': minor
---

Add `--sub-session-size` and `--disable-1m-context` options for Claude and Codex (issue #1706)

`--sub-session-size` (default: `150k`) caps the size of each sub-session
between auto-compaction events. It accepts a token count (`150k`, `1m`,
`200000`), a percentage of the model context window (`50%`), or `default`
to keep the tool's built-in threshold.

`--disable-1m-context` (default: `true`) opts out of the 1M extended
context window so models stay on their standard 200K-400K window. This
preserves reasoning quality and avoids the long-context price tier.
Use `--no-disable-1m-context` to allow 1M.

Both options work for `--tool claude` and `--tool codex`. For Claude Code
the wrapper sets `CLAUDE_CODE_DISABLE_1M_CONTEXT`,
`CLAUDE_CODE_AUTO_COMPACT_WINDOW`, and `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`
env vars (clamped per upstream's "lower-only" semantics). For Codex the
wrapper appends `-c model_context_window=200000` and
`-c model_auto_compact_token_limit=<tokens>` overrides.

Verbose mode logs the applied env vars and `-c` overrides so operators
can confirm they reached the spawned tool process.
