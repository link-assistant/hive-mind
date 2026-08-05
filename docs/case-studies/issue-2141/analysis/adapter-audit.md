# Codebase-wide audit — every place a structured error payload reached a string

Method: grep every `${…error…}` interpolation and every consumer of a
JSON-parsed record's `message` / `error` field in `src/**.mjs`, then classify.
Sites that interpolate `error.message` / `error.stack` of a real `Error` are
safe by construction and are not listed.

| #   | Site (v2.11.11)                                             | Symptom before                                                                                                                                             | Fix                                                                              |
| --- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | `src/agent.lib.mjs:671` (streaming error event)             | `data.message \|\| data.error` — `data.error` is `{name,data}` → `[object Object]`                                                                         | `extractAgentErrorText()` → `firstErrorText()`                                   |
| 2   | `src/agent.lib.mjs:773` (`detectAgentErrors`, post-hoc)     | `msg.message \|\| msg.error` — same object → `[object Object]`                                                                                             | `detectAgentErrorsInOutput()` → `extractAgentErrorText()`                        |
| 3   | `src/claude.lib.mjs` (`checkForJsonError`)                  | returned `errorObj.error` verbatim, which is an object for structured payloads                                                                             | `stringifyErrorValue(errorObj.error, { fallback: jsonMatch[0] })`                |
| 4   | `src/claude.lib.mjs` (`type === 'error'` stream branch)     | `lastMessage = data.error`; every later `.includes()` check then ran against an object                                                                     | `stringifyErrorValue(data.error, { fallback: JSON.stringify(data) })`            |
| 5   | `src/interactive-codex-events.lib.mjs` (`handleCodexError`) | `data.message \|\| data.error \|\| 'Unknown Codex error'` → `[object Object]` in the PR comment                                                            | `firstErrorText([...])`                                                          |
| 6   | `src/qwen.lib.mjs`                                          | had a _local_ `stringifyErrorValue` — correct, but a private copy that the other adapters lacked                                                           | now imports the shared helper (single implementation)                            |
| 7   | `src/codex.lib.mjs` (`error` / `turn.failed` events)        | `typeof data.message === 'string'` **skipped** object payloads → an object-shaped `turn.failed` was silently dropped and the run was reported as a success | `firstErrorText([...])`, push whenever anything readable is found                |
| 8   | `src/gemini.lib.mjs`                                        | fell back to a raw `JSON.stringify(data.error)` dump                                                                                                       | `stringifyErrorValue(…, { fallback: JSON.stringify(data.error) })`               |
| 9   | `src/cancelled-ci-rerun.lib.mjs` (`formatRerunFailure`)     | `failure?.error` is a string today, but the value is published verbatim into a GitHub comment                                                              | `stringifyErrorValue(failure?.error, { fallback: 'Unknown error' })` (defensive) |

Defence in depth — the publishing path itself now refuses the symptom, so any
site missed by this audit degrades to an honest short message instead of
`[object Object]`:

| Site                                    | Behaviour after                                                               |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| `isMeaningfulErrorText` (`src/lib.mjs`) | returns `false` for `[object Object]`, `[object Error]`, `undefined`, `{}`, … |
| `extractToolErrorCore` (`src/lib.mjs`)  | returns `null` when the core embeds `[object Object]`                         |
| `formatToolExecutionFailure`            | publishes `AGENT execution failed` rather than `… with … [object Object]`     |

Not changed on purpose:

- `src/codex.lib.mjs:267` (`error: item.error ?? null`) and
  `src/interactive-codex-events.lib.mjs:76` — these keep the **object** and
  render it as a fenced JSON block, which is already readable.
- `src/hive.mjs:305` (`parsedUrl.error`) — a parser string, never an object.
