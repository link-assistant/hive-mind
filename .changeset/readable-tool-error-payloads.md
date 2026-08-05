---
'@link-assistant/hive-mind': patch
---

Render structured tool error payloads as readable text instead of
`[object Object]` (issue #2141).

A `solve --tool agent --model formal-ai` run failed 22 seconds in and published
one artefact: a "Solution Draft Failed" comment reading `AGENT execution failed
with Agent reported error: [object Object]`. `--attach-logs` was off, so that
string was the entire post-mortem and the real cause is unrecoverable.
`@link-assistant/agent` emits `NamedError.toObject()` — `{"type":"error",
"error":{"name":"…","data":{"message":"…"}}}` — and the adapter interpolated that
object into a template literal. The `|| JSON.stringify(msg)` fallback that would
have saved the diagnosis was unreachable, because the object is truthy.

- New `src/error-text.lib.mjs` renders strings, `Error` instances, `NamedError`
  payloads, nested `{error:{…}}` envelopes and arrays into one readable line —
  circular-safe, depth-limited, truncated at 2000 characters, never a
  placeholder.
- A codebase-wide audit found the same defect class in nine places across six
  adapters; all now use the shared renderer. One of them was not cosmetic:
  `codex.lib.mjs` guarded `error` / `turn.failed` events with `typeof
  data.message === 'string'` and therefore **discarded** object-shaped failures,
  reporting the run as a success.
- Defence in depth: `isMeaningfulErrorText` and `extractToolErrorCore` now reject
  a core polluted by `[object Object]`, so any site this audit missed degrades to
  the honest `AGENT execution failed` rather than the misleading long form.
- The agent adapter now fails fast when the CLI logs a fatal startup error
  (`ProviderModelNotFoundError` and friends) and then exits 0 with no error event
  and no output — a silent failure reproduced against agent CLI 0.25.5 and
  reported upstream.
- `--verbose` dumps the raw JSON of every error and fatal log record, and the
  pre-PR failure comment now tells the reader to rerun with
  `--attach-logs --verbose`.

Case study, raw evidence and the upstream reports:
`docs/case-studies/issue-2141/README.md`.
