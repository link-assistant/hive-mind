# Solution Plan and Mapping

For each requirement and root cause, the table below lists the change shipped
in PR #1810. References point at `src/gemini.lib.mjs` unless noted otherwise.

## Implementation map

| Requirement           | Root cause    | Change                                                                                                                                                                                                                       |
| --------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1 — meaningful JSON  | RC1, RC2, RC3 | Detect plain-text upstream errors (auth/quota/etc.) and surface them as wrapper errors. Require either an `init` or `result` JSONL event before reporting success.                                                           |
| R1, R6                | RC2           | Treat _any_ non-zero `exitCode` as failure regardless of JSONL parser state. Gemini-cli exit codes (1/41/42/53) are mapped to human-readable labels.                                                                         |
| R2 — option coverage  | RC4           | Add `--debug` (when `argv.verbose`), `--include-directories`, `--sandbox`, `--extensions`, `--allowed-mcp-server-names`. Use explicit `--prompt-from-file` via stdin redirection (existing pipe) and log the resolved flags. |
| R3 — parity           | RC2, RC4      | Reuse `classifyRetryableError`, `detectUsageLimit`, the verbose plumbing, the session-id surfacing, and the `argv.fork`/`forkedRepo` logging that already exist in Claude/Codex.                                             |
| R5 — upstream report  | RC1           | Draft prepared in [`upstream-issue-draft.md`](./upstream-issue-draft.md).                                                                                                                                                    |
| R6 — debug visibility | RC3, RC4      | Print every parsed event count and the final state under `--verbose`, and pass `--debug` to gemini-cli so the upstream emits its own diagnostics.                                                                            |
| R7 — single PR        | n/a           | All changes committed to `issue-1809-ad1b428698b3`. Tests updated to lock the new behavior.                                                                                                                                  |

## Wrapper change list (`src/gemini.lib.mjs`)

1. **Plain-text error detector** — a `detectGeminiPlainTextError(text)` helper
   matches well-known upstream messages
   ("Please set an Auth method", "Invalid model name", "Quota exceeded", etc.)
   and returns a structured `{ type, message }` record. Used when JSONL
   parsing yields no events.
2. **Exit-code strictness** — `success` requires `exitCode === 0` _and_ at
   least one parsed event of type `init`, `message`, `tool_use`, or `result`.
3. **Optional flags builder** — a new `buildGeminiArgs(argv, mappedModel)`
   function assembles the argv list, threading new flags through (gated on
   their corresponding `argv.*` values).
4. **Verbose plumbing** — when `argv.verbose`, pass `--debug` to gemini-cli
   and log the resolved JSON event counts at the end of the run.
5. **`tempDir` & `workspaceTmpDir` inclusion** — pass `--include-directories`
   for both directories when present so the model can read scratch logs that
   solve.mjs writes.
6. **Resume invariants** — keep `--resume <sessionId>` opt-in; do not pass it
   when no session is being resumed.
7. **Stderr classification** — feed stderr chunks through both the JSONL
   parser AND the plain-text detector, so an upstream error printed to either
   channel is recognized.
8. **Pipefail-equivalent** — switch the runtime invocation away from
   `cat | gemini` in favor of `stdin: prompt`-style execution that the
   command-stream `$` helper exposes directly. Removes any reliance on shell
   pipefail behavior.

## Test plan (`tests/test-gemini-support.mjs`)

- Existing tests stay green (JSONL parsing, prompts, model aliases).
- New cases:
  - When the fake `$` yields a plain-text auth error and exit code 41, the
    wrapper returns `{ success: false }`, classifies the error as
    `AuthenticationRequired`, and logs the upstream guidance.
  - When the fake `$` yields exit code 0 but no JSONL events at all, the
    wrapper returns `{ success: false }` (it was _never_ started).
  - When `argv.verbose` is true, the resolved command contains `--debug`.
  - When `argv.workspaceTmpDir` is set, the command contains
    `--include-directories <tempDir>,<workspaceTmpDir>`.

## Out of scope (deliberately deferred)

- Interactive bidirectional input for Gemini (`--input-format stream-json` is
  Claude-only; gemini-cli does not currently support it).
- Per-call cost calculation — `pricingInfo` continues to return `null` since
  Google does not publish authoritative per-token prices through the CLI.
- MCP config dispatch for gemini-cli — preparation only; full integration
  needs `--mcp-config`-equivalent (`--allowed-mcp-server-names` is a name
  filter, not a config injection).

## Release plan

- Update `package.json` minor version (1.70.0 → 1.71.0) and add a changeset
  describing the fix.
- Mark PR #1810 ready for review once CI is green.
