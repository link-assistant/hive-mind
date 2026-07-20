---
'@link-assistant/hive-mind': patch
---

fix(2092): make every `use-m` call site self-healing

`/fix --ci-cd` crashed on `await use('command-stream')` — once on a truncated
global install, once on a failed `npm install -g`. The existing corrupt-install
recovery was wired into 3 of 100 `use(...)` call sites, so the ~40 top-level
`command-stream` loads were unprotected.

- `ensureUseM()` now returns a retry-wrapped `use`, so every call site inherits
  the recovery (idempotent, no per-call-site edits).
- New retry mode for `Failed to install <pkg> globally into '<dir>'`, with
  exponential backoff.
- Cleanup deletes the whole `<pkg>-v-<version>` alias directory instead of the
  entry file's parent directory.
- Retries bust Node's ESM cache, which otherwise replays the original
  `SyntaxError` even after a healthy reinstall.
- `formatFatalError` restores cause chains (and stacks under `HIVE_MIND_VERBOSE`)
  in `fix.mjs`/`cleanup.mjs`; `HIVE_MIND_USE_M_DEBUG=1` logs each loader attempt.
