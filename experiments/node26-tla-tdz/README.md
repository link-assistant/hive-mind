# Node 26 / V8 14.6: `await import()` of an evaluating-async module resolves too early

Minimal reproduction for issue #3469. Run it with `node experiments/node26-tla-tdz/main.mjs`.

```
main.mjs ── import ──> a.mjs ── await import() ──> d.mjs
   │                     └──── await import() ──> b.mjs ── import ──> c.mjs (top-level await)
   └────── import ──> b.mjs
```

`main` evaluates `a` first. `a` suspends on its first `await import()`, so the
entry goes on to `b`. `b` depends on `c`, which awaits at the top level, so `b`
becomes _evaluating-async_. `a` then resumes and runs `await import('./b.mjs')`.

| Runtime                    | V8          | Result                                                    |
| -------------------------- | ----------- | --------------------------------------------------------- |
| Node 24.22.0               | 13.6.233.17 | `ok 2 2`                                                  |
| Node 25.9.0                | 14.1.146.11 | `ok 2 2`                                                  |
| Bun 1.4.3 (JavaScriptCore) | -           | `ok 2 2`                                                  |
| Node 26.12.0               | 14.6.202.34 | `ReferenceError: Cannot access 'x' before initialization` |
| Deno 2.9.7                 | 15.0.245.2  | `ReferenceError: Cannot access 'x' before initialization` |

ECMA-262 says this is wrong. `Evaluate()` on an _evaluating-async_ module
whose cycle root has an empty `[[TopLevelCapability]]` creates a new capability,
`InnerModuleEvaluation` returns at once, and the promise stays pending. Only
`AsyncModuleExecutionFulfilled` (or the `GatherAvailableAncestors` loop) resolves
it, after `b` has run. V8 14.6 (still in 15.0) resolves the `import()` promise with the namespace
of a module that has not run yet, so destructuring an export hits its TDZ.

hive-mind ran into this as soon as a host moved to Node 26. CI used Node 24, so
it never saw the error. Merge guards threw `Cannot access 'wrapDollarWithGhRetry'
before initialization` and the like
(`experiments/scan-tla-sibling-tdz-3469.mjs` found 43 such imports in `src/`).

Workaround used in `src/`: import the module statically. A static import is
part of the graph, so it is evaluated before the importer's body runs on every
runtime. `experiments/static-imports-3469.mjs` rewrites the imports the scan
reports; after three rounds, the scan finds 0 TDZ failures on Node 26.12.0.
