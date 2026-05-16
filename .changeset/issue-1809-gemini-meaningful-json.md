---
'@link-assistant/hive-mind': minor
---

Make the `--tool gemini` integration produce meaningful JSON output and reach
feature parity with `--tool claude` / `--tool codex`. Resolves #1809.

- The wrapper now feeds the prompt to gemini-cli through `command-stream`'s
  `stdin` option instead of `cat <prompt-file> | gemini`, so the upstream
  non-zero exit code is no longer swallowed by the pipeline.
- A new `detectGeminiPlainTextError` helper surfaces gemini-cli's plain-text
  failures (auth required, quota exceeded, invalid model, unknown argument,
  fatal error) as structured wrapper errors so headless callers stop seeing
  silent `success: true` runs when authentication is missing. Tracked upstream
  in [`google-gemini/gemini-cli`'s `validateNonInteractiveAuth`](https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/src/validateNonInterActiveAuth.ts);
  see `docs/case-studies/issue-1809/upstream-issue-draft.md` for the proposed
  upstream fix.
- A run that emits zero `init`/`message`/`tool_use`/`result` JSONL events is
  now classified as a failure regardless of exit code, so empty runs cannot be
  reported as success anymore.
- New optional flags wired through to gemini-cli: `--gemini-sandbox`
  (`--sandbox`), `--gemini-extensions` (`--extensions`),
  `--gemini-include-directories` (`--include-directories`, in addition to
  `tempDir`/`workspaceTmpDir` which are always included), and
  `--gemini-allowed-mcp-servers` (`--allowed-mcp-server-names`). `--verbose`
  now also toggles gemini-cli's own `--debug` flag.
- New tests in `tests/test-gemini-support.mjs` lock in plain-text auth-error
  surfacing, zero-event failure detection, and the verbose/include-directories
  argv plumbing.
- Case study published in `docs/case-studies/issue-1809/`.
