---
'@link-assistant/hive-mind': patch
---

fix(claude): repair corrupted thinking-block transcripts so resume preserves context (#1834)

Follow-up to the Issue #1834 recovery ("can we do even better?"). The previous
recovery (PR #1835) was reactive: a plain resume of a transcript poisoned by a
corrupted extended-thinking block (`{ "type": "thinking", "thinking": "" }` with a
kept signature) just repeats the `400 ... thinking blocks ... cannot be modified`
error, so recovery almost always fell through to a **fresh restart that discards
dozens of turns** of accumulated context (50 turns / $3.84 in the second
reproduction log).

Recovery Phase 1 now **proactively repairs the on-disk session transcript** before
resuming: `repairCorruptedThinkingBlocks` (new
`src/claude.session-transcript-repair.lib.mjs`) strips the empty-text
`thinking`/`redacted_thinking` blocks from the session JSONL — a workaround proven
upstream (the Anthropic API permits *omitting* earlier thinking, just not
*modifying* it). When repair succeeds the resume keeps all accumulated context;
when it can't help, recovery still falls back to a fresh restart, so there is no
regression.

The repair is conservative: it never throws, only removes empty-text blocks (valid
signed thinking is untouched), never empties an assistant message, and writes a
one-time `<session>.jsonl.pre-repair-backup` before rewriting. The case study under
`docs/case-studies/issue-1834` is updated with a second reproduction log and the
new repair-then-resume design.
