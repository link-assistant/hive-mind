# Release-note formatter hides a failed child process and reports success

## Reproduction

The successful [`gh-upload-log@0.9.1` release
run](https://github.com/link-foundation/gh-upload-log/actions/runs/35485018540/job/106009749351)
contains this sequence in the `Format GitHub release notes` step:

```text
Formatting release notes for v0.9.1...
❌ Error formatting release notes: $ is not a function
✅ Formatted release notes for v0.9.1
```

The step and the complete release job both conclude successfully. The release
body remains in its unformatted changeset form rather than receiving the npm
badge and PR link.

## Root cause

There are two cooperating failures:

1. `scripts/format-github-release.mjs` is run with Bun, but launches the child
   through `node scripts/format-release-notes.mjs`. Both scripts dynamically
   load an unpinned `command-stream` through `use-m` and destructure a named
   `$` export. In the Node child that value is not callable; the child catches
   the resulting error and exits 1.
2. The parent awaits the `command-stream` template at line 77 without calling
   `.run()` or checking its result code. As with the npm publishing failure
   fixed in #41, a nonzero command result is not thrown, so the parent prints
   its unconditional success message.

The dynamic load also bypasses the repository's declared
`command-stream@^0.7.1` dependency. At release time npm `latest` was 0.24.1, so
the release helper's effective dependency was neither pinned nor represented
by `package.json`/the lockfile.

## Suggested fix

1. Run both helpers with the same runtime and use the locked package dependency
   (or pin the `use-m` specifier explicitly). Validate that the loaded `$` is a
   function before executing commands.
2. Execute the child using `.run()`, inspect `code`, and throw when it is
   nonzero. Print the parent success message only after a verified zero result.
3. Add an integration test whose child exits 1 without causing
   `command-stream` itself to throw. The parent must exit nonzero and must not
   print `Formatted release notes`.
4. Add a test under the same Node/Bun combination as the workflow so export
   shape or runtime differences are caught before release.

This was found while verifying the resolution of link-foundation/gh-upload-log#40
for link-assistant/hive-mind#2264.

Reported as https://github.com/link-foundation/gh-upload-log/issues/43.
