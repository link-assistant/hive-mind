# Native Codex npm packages

Issue #4050. Versions 2.40.0 and 2.40.1 bundled both native Codex executables
in the main npm tarball, making it 249,847,872 and 249,862,346 bytes. npm
refused both with `E413 413 Payload Too Large`. Neither
version was published, so no Docker image was built and the Formal AI draft
workflow could not pull one.

Each executable is now its own npm package. This follows the approach used by
`@openai/codex`, which keeps its 165,142,849-byte linux-x64 build separate.

## Layout

| What                   | npm identity                                             | Contents                                            |
| ---------------------- | -------------------------------------------------------- | --------------------------------------------------- |
| Main package           | `@link-assistant/hive-mind@<v>`                          | Everything except `src/native-codex/runtime`        |
| linux-x64 executable   | `@link-assistant/hive-mind@<v>-native-codex-linux-x64`   | `runtime/linux-x64/**`, `os: linux`, `cpu: x64`     |
| linux-arm64 executable | `@link-assistant/hive-mind@<v>-native-codex-linux-arm64` | `runtime/linux-arm64/**`, `os: linux`, `cpu: arm64` |

- **Same package name.** Each variant is a version of
  `@link-assistant/hive-mind`, so OIDC trusted publishing covers it. A new name
  would have to be created by hand before the release workflow could publish
  to it.
- **Separate dist-tags.** Variants are published under
  `native-codex-linux-<arch>` dist-tags, never `latest`. Their versions are
  prereleases, so no ordinary semver range resolves to them.
- **Pinned on publish only.** Just before `changeset publish`, the release adds
  these entries to the main package's `optionalDependencies`:

  ```json
  "@link-assistant/hive-mind-native-codex-linux-x64": "npm:@link-assistant/hive-mind@<v>-native-codex-linux-x64",
  "@link-assistant/hive-mind-native-codex-linux-arm64": "npm:@link-assistant/hive-mind@<v>-native-codex-linux-arm64"
  ```

  The committed `package.json` never contains them. npm and Bun skip the
  variant whose `os`/`cpu` does not match the machine.

- **Variants run nothing on install.** A variant has no `scripts`, `bin` or
  dependencies.
- **The runtime refuses a mismatched variant.**
  `src/native-codex-runtime.lib.mjs` resolves the alias from the main package.
  It admits the variant only if its `name` matches the main package and its
  `version` is `<main version>-native-codex-<platform>`. It then applies the
  same byte, manifest and license checks as before.

## Size budget

`scripts/check-npm-tarball-size.mjs` refuses any tarball above 157 MiB
(164,626,432 bytes). That is below the largest tarball npm is known to have
accepted here. The budget applies to:

- every variant, in `native-codex-packages.mjs pack`, before it is uploaded;
- the wired main archive, in `scripts/verify-native-codex-publish.mjs`, before
  `changeset publish`;
- the CI artifacts, in `.github/workflows/native-codex-build.yml`
  (`experiments/issue-3785/probe_native_codex_package.py`).

When a tarball is over the budget, the error is a GitHub `::error` annotation
that lists the largest files first. To check the current tree:

```bash
npm pack --dry-run --json | node scripts/check-npm-tarball-size.mjs --stdin
```

## Release flow

`npm run changeset:publish` runs these steps in order:

1. `build:pre`.
2. `node scripts/native-codex-packages.mjs publish`. This packs each variant
   from `src/native-codex/runtime` (the assembled CI artifacts), checks its
   size and verifies its bytes with `build-native-codex.py verify-variant`. It
   then publishes each variant that `npm view` does not already show. A version
   conflict counts as success. Finally it wires the `optionalDependencies`.
3. `node scripts/verify-native-codex-publish.mjs`. This packs the wired main
   archive, checks its size and runs `verify-package`. The archive must contain
   the recipe, contain no executable, and pin both variants.
4. `changeset publish`.

`scripts/publish-to-npm.mjs` retries the whole command up to 3 times. Variants
that are already published are skipped on retry. An E413 is not retried: it is
reported once with an annotation and stops the run before the main package
(`scripts/publish-failure-classifier.mjs`).

## Docker images and pull requests

- **Release images** run
  `bun install -g @link-assistant/hive-mind@<v>`, which installs the matching
  variant from the registry.
- **Pull request images** have no published variant. For them,
  `scripts/install-image-package.sh`:
  1. packs the main package and refuses it if it contains a runtime;
  2. packs only the image's own platform variant from the assembled runtime;
  3. installs the main archive with Bun's copyfile backend;
  4. extracts the variant to the alias path next to the main package in Bun's
     global `node_modules`.

  `install-native-codex.mjs` then checks the bytes, exactly as for a release.

## Troubleshooting

- **`installation and execution were refused`** / **`Native Codex installation
failed`**: the variant for this machine is missing or does not match. Install without
  `--omit=optional` / `--no-optional`. Confirm that
  `node_modules/@link-assistant/hive-mind-native-codex-linux-<arch>/package.json`
  has the main package's version followed by `-native-codex-linux-<arch>`.
- **`HIVE_MIND_NATIVE_CODEX_DEBUG=1`** (off by default) prints the refused
  phase and error code to stderr, for example
  `[native-codex] Refused during packaged artifact admission (MODULE_NOT_FOUND).`
  It never prints paths.
- **`HIVE_MIND_PUBLISH_VERBOSE=true`** (off by default) shows the raw output of
  the `npm view` probe that decides whether a variant is already published.
- **`HIVE_MIND_NPM_TARBALL_BUDGET_BYTES=<n>`** overrides the budget. It exists
  for tests; do not raise it to get a release through.
