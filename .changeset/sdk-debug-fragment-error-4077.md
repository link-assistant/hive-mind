---
'@link-assistant/hive-mind': patch
---

A Claude failure no longer publishes a line of an SDK debug dump or of printed source as its reason, such as `CLAUDE execution failed with } ReadableStream { locked: false, state: 'readable', supportsBYOB: false }` (issue #4077).

- With `--verbose`, Claude Code runs with `ANTHROPIC_LOG=debug`. `@anthropic-ai/sdk` logs every streamed response as `response 200 <url> Headers {` … `} ReadableStream {…}`. This is the only SDK debug line without a `[log_<id>]` prefix. These lines and the `[log_<id>, request-id: …] post … succeeded …` summary lines are now recognised as debug output.
- A new shared guard, `isSourceFragmentErrorText`, is applied at the publishing boundary for every tool (`isMeaningfulErrorText`). It rejects the tail of an inspected object or code block (`}`, `]`, `)`), quoted header keys, inspected function values, stack frames and SDK debug-logger lines.
- When Claude is killed without a readable reason, the message now names the signal, e.g. `Claude command failed with exit code 137 (SIGKILL)`.

Also, for the CI dependency freshness gate: `secretlint`, `@secretlint/core` and `@secretlint/profiler` are updated to 14.0.1, and `act` in the e2e hello-world matrix to v0.2.98.
