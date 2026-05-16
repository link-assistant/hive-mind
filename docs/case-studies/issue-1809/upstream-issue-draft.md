# Upstream issue draft for `google-gemini/gemini-cli`

This is the text submitted (or to be submitted) to the gemini-cli repository.
Keep it self-contained — the maintainers cannot see our case study.

---

## Title

`--output-format stream-json` does not emit a structured error event when authentication is missing (and exit code 41 is undocumented)

## Versions

- Reproduced on `gemini` 0.42.x family (latest stable at filing time).
- Source snapshot inspected: `google-gemini/gemini-cli` `main`
  (`packages/cli/src/validateNonInterActiveAuth.ts`).

## Summary

When running `gemini` non-interactively with `--output-format stream-json` and
without any auth method configured, gemini-cli emits a plain text message and
exits with code 41 (`FATAL_AUTHENTICATION_ERROR`) instead of emitting a
structured `error` / `result` JSONL event as the docs imply.

Two distinct problems compound the impact for downstream tooling that consumes
JSONL streams:

1. **No structured error envelope.** Headless callers cannot distinguish a
   silent "model produced no output" run from an authentication failure
   without parsing free-form text.
2. **Exit code 41 is not listed in `docs/cli/headless.md`.** The docs only
   mention 0, 1, 42 and 53; consumers parsing exit codes alone will reach for
   a default of "general error" and miss the auth-specific recovery path.

## Reproduction

```bash
# Make sure no auth method is configured for the test user.
unset GEMINI_API_KEY
unset GOOGLE_GENAI_USE_VERTEXAI
unset GOOGLE_GENAI_USE_GCA
rm -f ~/.gemini/settings.json   # or temporarily move it aside

echo "say hi" | gemini \
  --output-format stream-json \
  --model gemini-2.5-flash \
  --approval-mode yolo \
  --skip-trust

# Observed: a plain text line "Please set an Auth method..." printed to stdout
# (or stderr depending on debugLogger configuration), exit code 41,
# no JSONL events emitted whatsoever.

# Expected: at minimum one JSONL line resembling:
# {"type":"result","timestamp":"...","status":"error",
#  "error":{"type":"AuthenticationRequired","message":"Please set an Auth method..."},
#  "stats":{...}}
# exit code 41
```

## Root cause (precise pointer)

`packages/cli/src/validateNonInterActiveAuth.ts` only routes errors through the
structured `handleError` helper when `getOutputFormat() === OutputFormat.JSON`.
For `OutputFormat.STREAM_JSON` (and `TEXT`), the `else` branch falls back to
`debugLogger.error(...)` and then `process.exit(ExitCodes.FATAL_AUTHENTICATION_ERROR)`,
bypassing the formatter entirely:

```ts
} catch (error) {
  if (nonInteractiveConfig.getOutputFormat() === OutputFormat.JSON) {
    handleError(error, nonInteractiveConfig, ExitCodes.FATAL_AUTHENTICATION_ERROR);
  } else {
    debugLogger.error(error.message ?? String(error));
    await runExitCleanup();
    process.exit(ExitCodes.FATAL_AUTHENTICATION_ERROR);
  }
}
```

`handleError` (in `packages/cli/src/utils/errors.ts`) already supports
`OutputFormat.STREAM_JSON`:

```ts
if (config.getOutputFormat() === OutputFormat.STREAM_JSON) {
  const streamFormatter = new StreamJsonFormatter();
  streamFormatter.emitEvent({
    type: JsonStreamEventType.RESULT,
    timestamp: new Date().toISOString(),
    status: 'error',
    error: { type: getErrorType(error), message: errorMessage },
    stats: streamFormatter.convertToStreamStats(uiTelemetryService.getMetrics(), 0),
  });
  ...
}
```

So `validateNonInteractiveAuth` should delegate to `handleError` for both
`JSON` and `STREAM_JSON` formats.

## Suggested fix

```ts
} catch (error) {
  const format = nonInteractiveConfig.getOutputFormat();
  if (format === OutputFormat.JSON || format === OutputFormat.STREAM_JSON) {
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

This single change makes the auth path consistent with every other failure
handled by `handleError` and unblocks JSON consumers.

## Docs follow-up

`docs/cli/headless.md` lists exit codes 0/1/42/53. Please add:

- `41`: Authentication error (`FATAL_AUTHENTICATION_ERROR`).

…and any other `ExitCodes.*` values present in
`packages/core/src/utils/exit-codes.ts`. We can submit a docs PR alongside the
code fix if helpful.

## Workaround applied in our wrapper

While the upstream lands, our wrapper at
[`link-assistant/hive-mind`](https://github.com/link-assistant/hive-mind)
detects the plain-text marker patterns (e.g. "Please set an Auth method") and
treats them as fatal regardless of JSONL output. PR with the workaround:
<https://github.com/link-assistant/hive-mind/pull/1810>.

## Additional impact

Any consumer that pipes `gemini` JSONL into a parser (CI jobs, monitoring,
auto-resume frameworks) currently has to silently dual-parse plain text or
risk reporting auth failures as zero-message successes. A structured envelope
keeps the contract simple and consistent with `--output-format json`.

Thanks for the great CLI — happy to follow up with a PR if it would help.
