# Timeline / Sequence of Events

All timestamps from
[`logs/solution-draft-log-pr-1778929244798.txt`](./logs/solution-draft-log-pr-1778929244798.txt).

## 1. Solve.mjs starts the Gemini run

```
2026-05-16T11:00:07.443Z  🚀 solve v1.70.0
2026-05-16T11:00:07.443Z  Raw command executed:
  solve https://github.com/uselessgoddess/sheepskin/issues/3 \
    --model pro --think max --tool gemini --attach-logs --verbose \
    --no-tool-check --disable-report-issue --language en
```

The user kicks off a Gemini-driven solve with model `pro` and `--verbose`.

## 2. Prep work succeeds

The pre-execution phase works fine:

- Disk and memory checks pass.
- Repository invitations are checked and none are pending.
- The repo `uselessgoddess/sheepskin` is cloned, branch `issue-3-ebca7d9c8fe5`
  is created, `.gitkeep` is committed, the draft PR `#4` is opened.

## 3. Gemini CLI is invoked

At `11:00:36.361Z` the wrapper prints the raw command:

```
(cd "/tmp/gh-issue-solver-1778929217031" && \
 cat "/tmp/gemini_prompt_1778929236360_2696957.txt" | \
 gemini --output-format stream-json \
        --model "gemini-2.5-pro" \
        --approval-mode yolo \
        --skip-trust)
```

## 4. Gemini CLI emits plain-text auth error

```
2026-05-16T11:00:37.917Z  YOLO mode is enabled. All tool calls will be automatically approved.
2026-05-16T11:00:37.918Z  Please set an Auth method in your /home/box/.gemini/settings.json
                           or specify one of the following environment variables before running:
                           GEMINI_API_KEY, GOOGLE_GENAI_USE_VERTEXAI, GOOGLE_GENAI_USE_GCA
```

These lines are tagged `[INFO]` in the log even though they came from stderr —
because the wrapper logs them at INFO level, not because the upstream emitted
them on stdout (the wrapper's stderr handler at the time used `log(output)` for
gemini, not `log(output, { stream: 'stderr' })`). Either way, **no JSON was
ever emitted** by gemini-cli. This is the core upstream defect.

## 5. Wrapper reports success

```
2026-05-16T11:00:37.963Z  ✅ Gemini command completed
2026-05-16T11:00:37.964Z  📊 Total messages: 0, Tool uses: 0
```

The wrapper claims success because:

- `geminiJsonState.errorMessages` is empty (no JSON ever got parsed).
- `exitCode` ended up `0` (the `cat | gemini` pipeline most likely propagated
  `cat`'s exit code or `command-stream` ran without `pipefail`).
- Our `success: true` path only checked these two conditions.

## 6. Downstream effects

- PR description gets converted out of `[WIP]` state.
- PR marked "ready for review" while the actual implementation never ran.
- `Total messages: 0, Tool uses: 0` is the only honest signal that something is
  wrong but the wrapper doesn't escalate it.

## 7. User files issue #1809

The user files the issue with:

- A pointer to the gist log above.
- Three concrete asks: produce meaningful JSON, support every gemini-cli option,
  and match Claude/Codex feature parity.
- A request to document the analysis in `docs/case-studies/issue-1809`.
- Instruction to file upstream issues if the bug crosses repository boundaries.

## 8. Investigation (this PR)

- Cloned `google-gemini/gemini-cli@main` to `/tmp/gemini-cli-src` and read:
  - `packages/cli/src/validateNonInterActiveAuth.ts` — confirms structured
    JSON output is only emitted for `OutputFormat.JSON`, not `STREAM_JSON`.
  - `packages/core/src/output/types.ts` — documents `JsonStreamEventType.RESULT`
    that should carry an error envelope.
  - `packages/core/src/output/stream-json-formatter.ts` — emit helper.
  - `packages/cli/src/utils/errors.ts` — proves the structured path *does* exist
    for STREAM_JSON, but it is bypassed during auth validation.
- Cloned the docs and read:
  - `docs/cli/headless.md` — exit codes 0/1/41/42/53.
  - `docs/cli/cli-reference.md` — complete flag list.
- Compared our wrapper to `src/claude.lib.mjs` and `src/codex.lib.mjs` for
  feature parity.
- Filed upstream issue draft (see `upstream-issue-draft.md`).
