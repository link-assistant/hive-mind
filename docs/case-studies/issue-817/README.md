# Case Study: Issue #817 — Bidirectional Interactive Mode

> Source issue: https://github.com/link-assistant/hive-mind/issues/817
> Source PR: https://github.com/link-assistant/hive-mind/pull/843
> Reference gist: https://gist.github.com/konard/e5e37ed9fc558ac605f8a2b643348b16

## Problem statement (from the issue)

Current `--interactive-mode` is read-only: solve pushes events as PR comments but
does not react to anything the human writes back. The issue asks the tool to
also read incoming PR comments and route them into the running Claude session
as live input, so a human reviewer can steer the agent without waiting for the
run to finish.

## Requirements gathered from the issue and PR comments

1. Monitor PR comments while Claude is running and forward them to Claude as
   input. System-generated comments (from interactive mode / AI signatures)
   must be ignored.
2. Provide three composable CLI options, all experimental and all disabled by
   default:
   - `--accept-incomming-comments-as-input` — enables the comment → Claude
     pipeline. Does **not** require `--interactive-mode`.
   - `--exclude-all-own-incomming-comments-from-input` — additionally filters
     out comments written by the same GitHub user that solve runs as, so the
     operator can avoid "talking to themselves".
   - `--bidirectional-interactive-mode` — convenience flag that turns on all
     three (`--interactive-mode`, `--accept-incomming-comments-as-input`,
     `--exclude-all-own-incomming-comments-from-input`).
3. Real JSON streaming input — incoming comments must be written to Claude's
   stdin using `--input-format stream-json`, matching the reference gist
   (`claude-stream-persistent.mjs`), not accumulated in a queue that is
   discarded at the end. `CLAUDE_CODE_EXIT_AFTER_STOP_DELAY_MS` should be set
   (≈ 1 minute) so the headless process stays alive between turns.
4. Reuse the existing "comments posted by solve" tracking that drives
   `--auto-attach-solution-summary`.
5. Changes must be experimental and must not alter behaviour when the flags
   are off. Every CI/CD check must pass.

## Existing components in the repo that help

- `src/interactive-mode.lib.mjs` / `src/interactive-mode.shared.lib.mjs` —
  outbound channel (solve → PR comments) and system-comment signatures we can
  reuse.
- `src/bidirectional-interactive.lib.mjs` — added by the earlier pass of this
  PR. Already implements polling, filtering, system-comment detection, own-user
  exclusion and stream-json payload formatting. This module is reused for the
  real-streaming fix.
- `src/config.lib.mjs::getClaudeEnv` — central place to set Claude environment
  variables (where `CLAUDE_CODE_EXIT_AFTER_STOP_DELAY_MS` belongs).
- `src/claude.lib.mjs` — the actual Claude spawn. Uses the `command-stream` `$`
  template; today it passes `stdin: prompt` as a single string. To stream
  messages we need to keep the stdin pipe open and write NDJSON frames when
  new comments arrive.

## Gap vs. current PR state (before this pass)

The existing implementation only builds a queue of feedback comments and
surfaces them in the final `queuedFeedback` return value. That satisfies the
"filter and collect" requirement but **skips the actual streaming into
Claude**, which was the core ask per the PR author's latest comment:

> I want real json streaming input for claude command, when
> `--accept-incomming-comments-as-input` is enabled. Also that option should
> work without interactive mode at all.

## Solution plan

1. Extend `bidirectional-interactive.lib.mjs` with `attachClaudeStdin(stream)`
   so it can push formatted NDJSON frames straight into a live Claude process
   as soon as a comment is detected (no end-of-run flush).
2. Add a helper that renders the initial prompt as a stream-json frame so the
   first message flows through the same channel — switching the Claude spawn
   to `--input-format stream-json` and leaving stdin open.
3. Propagate `CLAUDE_CODE_EXIT_AFTER_STOP_DELAY_MS=60000` through
   `getClaudeEnv` when the feature is enabled.
4. Guarantee the feature works without `--interactive-mode` — the setup call
   already only checks `acceptIncommingCommentsAsInput`, but we add a test to
   pin the decoupling.
5. Keep behaviour identical when the flags are off: stdin remains a one-shot
   string, no env var changes, no extra Claude CLI flags.
6. Extend `tests/test-bidirectional-interactive.mjs` with assertions covering
   the new stdin hook, the decoupling from interactive mode, and the env-var
   propagation.

## Related prior art / references

- Anthropic Claude Code docs on `--input-format stream-json` and
  `CLAUDE_CODE_EXIT_AFTER_STOP_DELAY_MS`.
- Gist `claude-stream-persistent.mjs` from the issue author — the canonical
  pattern for a single persistent Claude process driven by NDJSON frames on
  stdin.
