# Root Cause Analysis

Two independent defects combine to produce the symptom in the gist log: an
upstream gemini-cli bug, and several gaps in our wrapper.

## RC1 — Upstream: `validateNonInteractiveAuth` does not emit STREAM_JSON

**File:** `packages/cli/src/validateNonInterActiveAuth.ts` in
`google-gemini/gemini-cli` (as of the version reproduced).

```ts
} catch (error) {
  if (nonInteractiveConfig.getOutputFormat() === OutputFormat.JSON) {
    handleError(
      error instanceof Error ? error : new Error(String(error)),
      nonInteractiveConfig,
      ExitCodes.FATAL_AUTHENTICATION_ERROR,
    );
  } else {
    debugLogger.error(error instanceof Error ? error.message : String(error));
    await runExitCleanup();
    process.exit(ExitCodes.FATAL_AUTHENTICATION_ERROR);
  }
}
```

Only `OutputFormat.JSON` routes the error through the structured `handleError`
path. `OutputFormat.STREAM_JSON` and `OutputFormat.TEXT` both fall into the
`else` branch, which prints a plain-text message via `debugLogger.error` and
exits with code 41 without emitting a `result`/`error` JSONL event.

`handleError` in `packages/cli/src/utils/errors.ts` *does* know how to emit a
proper stream-json error event when `OutputFormat.STREAM_JSON` is active:

```ts
if (config.getOutputFormat() === OutputFormat.STREAM_JSON) {
  const streamFormatter = new StreamJsonFormatter();
  const metrics = uiTelemetryService.getMetrics();
  streamFormatter.emitEvent({
    type: JsonStreamEventType.RESULT,
    timestamp: new Date().toISOString(),
    status: 'error',
    error: { type: getErrorType(error), message: errorMessage },
    stats: streamFormatter.convertToStreamStats(metrics, 0),
  });
  runSyncCleanup();
  process.exit(getNumericExitCode(errorCode));
}
```

So the fix upstream is small: in `validateNonInteractiveAuth`, replace
`=== OutputFormat.JSON` with a check that also matches `STREAM_JSON`, or just
route every non-text format through `handleError`. The upstream report draft
proposes exactly that change.

## RC2 — Wrapper: success determined by absence of JSON errors

**File:** `src/gemini.lib.mjs`, around the old `executeGeminiCommand` return:

```js
if (exitCode !== 0 || geminiJsonState.errorMessages?.length > 0) {
  // failure path
}
// otherwise — return { success: true, ... }
```

When the upstream bug bites:

- `geminiJsonState.errorMessages.length === 0` (no JSON, nothing to parse).
- `exitCode` should be `41` but in practice can be `0` when:
  - `command-stream` does not set `pipefail` and the pipeline ends with
    `gemini`, which `command-stream` correctly takes — yet some configurations
    of the helper pick up `cat`'s exit code instead, depending on how the
    spawned shell is built.
  - The exit chunk arrives after the stream has already been declared
    finished by a previous iteration that observed only stdout.
- The wrapper therefore falls into the success branch with `messageCount: 0`
  and `toolUseCount: 0`.

## RC3 — Wrapper: plain-text stderr is not parsed as an error signal

The chunk loop logs stderr but does not feed it into any heuristic that says
"this looks like an unrecoverable error." A pattern such as `Please set an
Auth method` should immediately mark the run as failed.

## RC4 — Wrapper: missing gemini-cli flags

The wrapper passes only:

```
--output-format stream-json --model X --approval-mode yolo --skip-trust [--resume]
```

But the latest gemini-cli (`docs/cli/cli-reference.md` and
`docs/cli/headless.md`) supports several flags we never use, including:

| Flag | Use in wrapper |
| --- | --- |
| `--debug` | toggle when `argv.verbose` |
| `--include-directories` | propagate `workspaceTmpDir` for tool-side access |
| `--allowed-mcp-server-names` | mirror Claude's MCP allow-list once we add MCP for Gemini |
| `--extensions` | opt-in for gemini-cli extensions |
| `--sandbox` | wire through `argv.sandbox` |
| `--prompt` (`-p`) | use explicit flag instead of relying on stdin |
| `--session-id` | optional session id propagation |

Without these the wrapper cannot reach parity with `claude.lib.mjs`.

## RC5 — Wrapper: log labeling of stderr

The chunk loop calls `log(errorOutput, { stream: 'stderr' })` (good). However
for the case where `gemini` *prints to stdout* even though the content is an
error (as happens with `process.exit(...)` after `debugLogger.error` — the
internal logger writes to stderr but our terminal log was tagged `[INFO]`
because we logged the chunk before classification), the wrapper had no way to
flag it. The fix is to (a) ensure we always classify the chunk via the
upstream's stream channel, and (b) run plain-text detection regardless of the
channel.

## Cross-check: gemini-cli exit codes

From `docs/cli/headless.md`:

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | General error |
| 41 | FATAL_AUTHENTICATION_ERROR |
| 42 | FATAL_INPUT_ERROR |
| 53 | FATAL_TURN_LIMITED_ERROR |

Our wrapper must respect any non-zero exit code as a hard failure.
