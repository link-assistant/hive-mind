# Release script reports success after npm publish exits nonzero

## Reproduction

As of 2026-09-20:

```console
$ npm view gh-upload-log version
0.8.2

$ npm view gh-upload-log@0.9.0 version
npm error code E404
npm error 404 'gh-upload-log@0.9.0' is not in this registry.
```

However, [GitHub release v0.9.0](https://github.com/link-foundation/gh-upload-log/releases/tag/v0.9.0) exists and links to the nonexistent npm version.

The [release job](https://github.com/link-foundation/gh-upload-log/actions/runs/32588725260/job/97069116808) contains the complete contradiction:

- it confirms that `gh-upload-log@0.9.0` is absent from npm;
- `changeset publish` reports `E404 Not Found - PUT https://registry.npmjs.org/gh-upload-log` and “packages failed to publish”; then
- the next line says `✅ Published gh-upload-log@0.9.0 to npm`, and the workflow creates the GitHub release.

## Root cause

In [`scripts/publish-to-npm.mjs` at the v0.9.0 release commit](https://github.com/link-foundation/gh-upload-log/blob/a309aa89586411e7125652d002a34184707b320f/scripts/publish-to-npm.mjs#L100-L110), the publish loop does this:

```js
await $`npm run changeset:publish`;
setOutput('published', 'true');
```

The same file correctly calls `.run()` and inspects `checkResult.code` for `npm view` at lines 80-87. `command-stream` returns a result object for the failed publish rather than throwing, so the `catch` never runs and success is declared unconditionally.

The underlying npm 404 may be a registry/trusted-publishing configuration problem, but this control-flow bug masks it and lets a failed package publication become a successful GitHub release.

## Suggested fix

1. Execute the publish through `.run(...)`, inspect `result.code`, and throw/retry on every nonzero result.
2. After a zero exit, verify `npm view "${PACKAGE_NAME}@${currentVersion}" version` succeeds before setting `published=true` or permitting the GitHub release step.
3. Preserve the publish stdout/stderr on failure so the OIDC/registry error remains diagnosable.
4. Add a unit test whose command runner returns `{ code: 1 }` without throwing. It should exercise all retries, leave the GitHub outputs unset, and exit nonzero. Add a second test where publish returns zero but post-publish `npm view` still fails.

For example, the essential check is:

```js
const publishResult = await $`npm run changeset:publish`.run({ capture: true });
if (publishResult.code !== 0) {
  throw new Error(`npm publish exited ${publishResult.code}`);
}
```

The post-publish registry verification must still be authoritative, because a wrapper can itself return the wrong status.

## Workaround

Install the actual npm latest explicitly:

```console
npm install -g gh-upload-log@0.8.2
```

Consumers that specifically need the 0.9.0 source must install from the GitHub tag until a version is successfully published to npm. Merely using `gh-upload-log@latest` cannot reach 0.9.0.

Found while investigating link-assistant/hive-mind#2264 and link-foundation/gh-upload-log#40.

## Resolution

While this investigation was in progress, link-foundation/gh-upload-log#41
independently implemented the same exit-code validation, fixed the trusted
publishing toolchain, and replaced the hard-coded CLI version. It merged on
2026-09-20 at 02:50 UTC, closed issue #40, and successfully published
`gh-upload-log@0.9.1` to npm. Issue #42 was therefore closed as resolved by and
duplicate of PR #41.
