## Summary

`use-m@8.15.0` returns the wrong module shape on Node.js 24 when its npm resolver imports a CommonJS package whose `module.exports` is a callable object. The returned object has only `default` and `module.exports`; named properties attached to the callable default are not exposed at the top level.

This broke every `use('command-stream')` consumer in `link-assistant/hive-mind` after `command-stream@0.19.0` added its CommonJS entry point: callers expect `(await use('command-stream')).$`, but Node 24 gets `undefined`.

Downstream incident: https://github.com/link-assistant/hive-mind/issues/2150

## Minimal reproduction

```bash
npx --yes node@24 --input-type=module -e "
  const code = await (await fetch('https://unpkg.com/use-m@8.15.0/use.js')).text();
  const { use } = await eval(code);
  const loaded = await use('command-stream@0.19.0');
  console.log({
    node: process.version,
    type: typeof loaded,
    keys: Object.keys(loaded),
    dollar: typeof loaded?.\$,
    default: typeof loaded?.default,
    moduleExports: typeof loaded?.['module.exports'],
    defaultDollar: typeof loaded?.default?.\$,
  });
"
```

Actual Node 24 output:

```text
{
  node: 'v24.19.0',
  type: 'object',
  keys: [ 'default', 'module.exports' ],
  dollar: 'undefined',
  default: 'function',
  moduleExports: 'function',
  defaultDollar: 'function'
}
```

The same command with `node@20` returns the callable default directly and `dollar` is `function`.

## Root cause

Node 23.0.0+ adds a synthetic `'module.exports'` named export to CommonJS namespaces. In `src/use.js`, `baseUse()` unwraps `module.default` only when every other key is included in `metadataKeys`. That set includes `default` and `__esModule`, but not the new `module.exports` interop marker. It therefore treats the marker as a meaningful named export and returns the two-key namespace instead of the callable default.

`use-m` reaches the CommonJS entry because its npm path resolver uses `createRequire(...).resolve`, so the `require` export condition is selected even though the resolved file is subsequently loaded with dynamic `import()`.

Node documents the synthetic marker here: https://nodejs.org/api/esm.html#commonjs-namespaces

## Workarounds

Consumers can normalize either shape:

```js
const loaded = await use('command-stream@0.19.0');
const commandStream = loaded?.default ?? loaded;
const $ = loaded?.$ ?? commandStream?.$ ?? commandStream;
```

Packages can also keep an ESM-only `main`/`exports` path, but that removes the CommonJS support that `command-stream@0.19.0` intentionally added.

## Suggested fix

At minimum, treat `'module.exports'` as CJS metadata in `baseUse()`:

```diff
 const metadataKeys = new Set([
-  'default', '__esModule', 'Symbol(Symbol.toStringTag)',
+  'default', 'module.exports', '__esModule', 'Symbol(Symbol.toStringTag)',
```

More robustly, when `module.default === module['module.exports']`, regard both keys as the same CommonJS default and unwrap it. Please add a Node 24 regression fixture whose CommonJS export is a function with enumerable properties, and assert `use()` preserves the callable shape and its attached properties.

## Evidence

The failing Hive Mind run was on Node 24 and failed in three independent jobs with `TypeError: $ is not a function`. The standalone reproduction above produces the exact missing `$` shape; Node 20 is a passing control.
