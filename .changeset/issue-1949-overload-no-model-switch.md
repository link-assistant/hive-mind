---
'@link-assistant/hive-mind': patch
---

fix(retry): keep the requested `--model` on transient overloads instead of switching to the fallback (#1949)

A transient **HTTP 529 "Overloaded"** result used to be classified as a
model-*capacity* error (`isCapacity: true`), which made the shared retry helper
switch the user's requested `--model` to the configured fallback
(`opus -> opus-4-7`) on every overload. A 529 is a server-wide, transient
overload — not a signal that the selected model is full — so the run should retry
the **same** model. The overload branch in `src/tool-retry.lib.mjs` now returns
`isCapacity: false`; only a genuine "the selected model is at capacity" message
still triggers a `--model` switch. The fix lives in the shared helper, so every
tool (claude, codex, gemini, qwen, opencode, agent) inherits it.

Per-request fallback is now delegated to Claude Code itself: the claude tool
forwards `--fallback-model <id>` so overloads fall back *inside* the CLI while our
`--model` stays stable.

Two display fixes remove the ambiguity that made this hard to diagnose:

- Warnings now render the resolved model ID alongside the alias, e.g.
  `opus (claude-opus-4-8) -> opus-4-7 (claude-opus-4-7)`, via a new
  `formatModelWithResolvedId` helper.
- The verbose per-retry "execution context" block now uses a shared
  `logExecutionContext` helper that prints the resolved model actually passed to
  the CLI, replacing a broken `argv.model === 'opus' ? 'opus' : 'sonnet'`
  heuristic that mislabelled every non-`opus` alias as `sonnet`.

The PR/issue comment now shows the requested model with its resolved ID and the
requested thinking level (e.g. `high (~23999 tokens)`) via a new
`describeRequestedThinking` helper.
