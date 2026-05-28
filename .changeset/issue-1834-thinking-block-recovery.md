---
'@link-assistant/hive-mind': patch
---

fix(claude): recover from corrupted extended-thinking blocks instead of looping (#1834)

A long Claude (Opus) agentic run with extended thinking + tool use can leave a
thinking block in the session transcript corrupted (text emptied while the
original signature is kept). The Anthropic API then rejects every following turn
with `400 ... `thinking` or `redacted_thinking` blocks in the latest assistant
message cannot be modified`, permanently poisoning the on-disk session — so any
`--resume` retry fails forever. This is an upstream Claude Code bug
(anthropics/claude-code#63147).

Hive Mind now detects this terminal error (`classifyRetryableError` →
`requiresFreshSession`) and recovers by discarding the un-resumable session and
restarting fresh (capped by `HIVE_MIND_MAX_THINKING_BLOCK_RESTARTS`, default 2),
rather than retrying the dead session or failing outright. Verbose logging
records the `request_id` and `messages.N.content.N` path for diagnostics. A deep
case study with the full reproduction log is added under
`docs/case-studies/issue-1834`.
