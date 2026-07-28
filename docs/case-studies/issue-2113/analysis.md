# Root-cause analysis

## Observed failure

The alias entry point existed:

```text
.../command-stream-v-latest/src/$.mjs
```

but Node could not resolve a relative file imported from it:

```text
.../command-stream-v-latest/src/terminal-capture.mjs
code: ERR_MODULE_NOT_FOUND
```

This distinguishes the failure from issue #2092's truncated `$.mjs`
(`SyntaxError`) and failed `npm install -g`. It is another incomplete-tree
state: enough of the alias exists for use-m to reuse it, but not enough for Node
to evaluate it.

## Root causes

1. **Incomplete alias install.** A versioned global package directory was visible
   before or after an interrupted/partial installation, while an internal file
   was absent. The evidence does not identify whether interruption, concurrent
   mutation, or filesystem behavior caused the partial tree; all produce the
   same recoverable state.
2. **Classifier gap.** `isCorruptInstallError()` recognized syntax corruption,
   invalid `package.json`, and use-m resolution failure, but not Node's
   `ERR_MODULE_NOT_FOUND` nested as the cause of use-m's import wrapper.
3. **Sticky reuse.** use-m sees the alias directory as installed, so without
   removing it a later load can reuse the same incomplete tree.

## Selected solution

Recognize `ERR_MODULE_NOT_FOUND` only when it is the cause of use-m's
`Failed to import module from '…'` error. This guard avoids retrying arbitrary
application-level missing imports. Existing shared recovery then:

1. extracts the entry-point path from the wrapper;
2. walks upward to the `<package>-v-<version>` alias;
3. removes that entire alias;
4. calls use-m again, causing a clean install;
5. uses the existing cache-busted import fallback if Node replays a failed ESM
   evaluation for the same entry URL.

Because `ensureUseM()` wraps `globalThis.use`, this applies to all dependency
imports rather than only `command-stream` or the failing `/fix` path.

## Alternatives

- **Retry only in `/fix`:** rejected because the failure happens during shared
  module loading and affects every command.
- **Add retries at every `use(...)`:** rejected because it duplicates policy and
  misses future call sites.
- **Rely only on CI/Docker pre-installation:** insufficient for runtime installs
  and for aliases that become incomplete after the pre-install step.
- **Move every dynamic dependency into local `package.json`:** potentially more
  reproducible, but a broad architectural migration that does not repair the
  current global alias cache. It can be evaluated separately.
- **Retry all `ERR_MODULE_NOT_FOUND`:** rejected because permanently broken
  package releases and application coding errors should remain visible. The
  use-m wrapper guard keeps the workaround narrow.

## Verification strategy

The unit test recreates the exact nested error and asserts both classification
and whole-alias cleanup. The hermetic experiment asks Node to import an entry
whose relative dependency is absent, confirms `ERR_MODULE_NOT_FOUND`, then
simulates a clean reinstall during shared recovery. Full default tests, lint,
format, syntax, and file-size checks provide regression coverage.
