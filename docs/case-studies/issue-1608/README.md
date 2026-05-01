# Issue 1608 Case Study

## Summary

Issue [#1608](https://github.com/link-assistant/hive-mind/issues/1608) reports a Claude execution failure while building the system prompt:

`TypeError: ...getExperimentsExamplesSubPrompt(...).png is not a function`

The failure happens before Claude can start work on the issue, so the solver aborts during prompt construction.

## Timeline

- 2026-04-15: Issue #1608 opened automatically with a stack trace pointing to `src/claude.prompts.lib.mjs`.
- 2026-04-15: Investigation confirmed the crash happens while interpolating the Claude system prompt near screenshot/image handling guidance.
- 2026-04-15: Regression test added to exercise the exact prompt-building path with case-study and vision guidance enabled.

## Root Cause

`src/claude.prompts.lib.mjs` builds one large template literal. Inside that template, the screenshot guidance included the literal text `` `.png` ``.

Because the outer string is also a template literal, the inner backticks prematurely terminated the string and caused the following `.png` text to be parsed as JavaScript code. That produced the runtime error:

- `.png is not a function`

This was limited to the Claude prompt module because that exact string existed there in template-literal context.

## Fix

- Escape the inner backticks around `.png` inside the Claude system prompt template.
- Add a regression test that verifies `buildSystemPrompt()` returns a string when both screenshot guidance and case-study guidance are enabled.

## Verification

- `node tests/test-issue-1608-claude-prompt-png.mjs`
- `node tests/test-private-repo-screenshots-1349.mjs`
- `node tests/test-fork-screenshot-url-1561.mjs`

## Notes

The stack trace mentioned `getExperimentsExamplesSubPrompt(...)`, but the underlying cause was not that helper. The helper result was simply adjacent to the malformed template segment in the final compiled expression.
