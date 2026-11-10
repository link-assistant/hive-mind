# Case study: issue #3739 and #3740, the `Authorization` scheme and the move to `@link-foundation/sensitive-data-sanitizer`

- Issue [#3739](https://github.com/link-assistant/hive-mind/issues/3739): the log sanitizer published the credential in `Authorization: token <value>`, because it masked the word `token` instead of the value.
- Issue [#3740](https://github.com/link-assistant/hive-mind/issues/3740): make [`@link-foundation/sensitive-data-sanitizer`](https://github.com/link-foundation/sensitive-data-sanitizer) the engine of every Hive Mind sanitizer and remove the duplicated rules.
- Pull request [#3741](https://github.com/link-assistant/hive-mind/pull/3741). As requested in the review, the library is now the engine everywhere. Every difference from Hive Mind's needs was reported upstream and has a workaround in place.

## Root cause of #3739

`UNQUOTED_ASSIGNMENT` in the old `src/credential-sanitization-core.lib.mjs` treated `authorization` as a key. It skipped only the schemes `Bearer`, `Basic`, and `SharedAccessSignature`. For any other scheme word (`token` for GitHub and Django REST, `ApiKey`, custom schemes), the scheme word was taken as the value and masked. The separate `Authorization` rule covered only `Bearer|Basic`, so the real credential was published whenever it had no known vendor prefix. The same rule also rewrote the solve system prompt in every log: `Authorization: token $(gh auth token)` became `Authorization: [REDACTED] $(gh auth token)`.

## Before and after

All values are synthetic. "main" is commit 133aedce4.

| Input                                     | main                                                        | this pull request                                 |
| ----------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------- |
| `Authorization: token 0123…4567` (40 hex) | `Authorization: [REDACTED] 0123456789abcdef…` (**leak**)    | `Authorization: token 012…567`                    |
| `authorization: Token a1b2…1f2`           | `authorization: [REDACTED] a1b2c3d4e5f6a7b8c9d0e1f2` (leak) | `authorization: Token a1b…1f2`                    |
| `Authorization: CustomScheme f3a9…3e5`    | `Authorization: [REDACTED] f3a9c2e1…` (leak)                | `Authorization: CustomScheme f3a…3e5`             |
| `curl -H "Authorization: token ghp_…"`    | `Authorization: [REDACTED] ghp…b4N`                         | `Authorization: token ghp…b4N`                    |
| `User token: ghp_… . Next sentence`       | `User token: [REDACTED] Next sentence`                      | `User token: ghp…b4N. Next sentence`              |
| `Authorization: token $(gh auth token)`   | `Authorization: [REDACTED] $(gh auth token)`                | unchanged: a shell expression is not a credential |
| `Authorization: Bearer 0123…4567`         | `Authorization: Bearer 012…567`                             | `Authorization: Bearer 012…567` (unchanged)       |

Reproduce on any commit:

```bash
node --input-type=module -e '
import { sanitizeCredentialText } from "./src/credential-sanitization-core.lib.mjs";
for (const s of ["Authorization: token 0123456789abcdef0123456789abcdef01234567", "authorization: Token a1b2c3d4e5f6a7b8c9d0e1f2", "curl -L -H \"Authorization: token $(gh auth token)\""]) console.log(sanitizeCredentialText(s));'
```

## What changed (#3740)

- **One engine.** `src/sensitive-data-sanitizer.lib.mjs` loads the library and adds only the Hive Mind policy on top. `sanitizeCredentialText`, `sanitizeOutput`, `sanitizeForPublication`, `createCredentialStreamSanitizer`, `sanitizeLogFileToFile`, and the residual check (`findCredentialResiduals`) all run on it. Hive Mind's own credential rule list was removed. The surrounding plumbing is kept: the post-finish sweep (#1745), Sentry `beforeSend`/`beforeSendLog`, and Telegram replies.
- **Credentials only.** The library runs with `credentialsOnly: true`. E-mail addresses, account and user IDs, and GitHub logins stay readable (#3724, rule 14).
- **Known local values come from the library.**
  - `knownSecretsFromEnv` reads credential environment variables, `KNOWN_LOCAL_TOKEN_ENV_VARS` included.
  - `knownSecretsFromGitHubConfig` reads every `oauth_token`/`api_token` in the gh `hosts.yml`. It honors `GH_CONFIG_DIR` and `XDG_CONFIG_HOME`.
  - `knownSecretsFromGitHubAuth` runs `gh auth token`, which also covers tokens kept in the system keyring.
- **Kept Hive Mind practices:**
  - the npm package-name exemption (#2156) and the token-count exemption (#2119);
  - the 8 MB `DEFAULT_MAX_HOLD_BYTES` stream hold cap;
  - the `abc…xyz` / `[REDACTED]` mask contract (`hive-mask`);
  - fail-closed publication.
- **Independent second opinions stay independent:**
  - Secretlint still scans publications.
  - `containsKnownToken` still checks known values with a plain substring test and Hive Mind's own decoder. A verifier that runs on the same engine as the masker would confirm the masker's misses.
- **Tracing:** `HIVE_MIND_SANITIZER_DEBUG=1` prints value-free decisions (rule ids, offsets, lengths) to stderr.

## A latent bug found on the way: `gh auth status` collector

The old `getGitHubTokensFromCommand` searched the output of `gh auth status` for tokens. Current gh versions (checked with 2.102.0) print the token masked (`gho_****…`), so this collector found **no** token. Only the `hosts.yml` reader and the environment remained, and they miss a token kept in the system keyring. The library's `knownSecretsFromGitHubAuth` runs `gh auth token` and gets the actual value without printing it. `experiments/issue-3739-known-local-collectors.mjs` compares the collectors. It prints only counts and 4-character prefixes.

## Upstream issues and workarounds

Each workaround lives in `src/sensitive-data-sanitizer.lib.mjs` and names its key in `UPSTREAM`. A matching row in `tests/issue-3739-sensitive-data-sanitizer-migration.test.mjs` keeps proving the behavior after the workaround is deleted. `experiments/issue-3739-upstream-repros.mjs [key]` reproduces each upstream problem with the library alone, using synthetic values.

| `UPSTREAM` key                                | Upstream issue                                                                 | Library 0.19.3 behavior                                                                                                                        | Hive Mind workaround                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `authorizationScheme`, `digestAuthorization`  | [#131](https://github.com/link-foundation/sensitive-data-sanitizer/issues/131) | `Authorization: token ghp_…` masks into the scheme word; Digest masks `Digest username=` as one value                                          | The scheme word and a Digest parameter name are visible parts cut out of the finding                    |
| `formatContext`, `pemSpan`, `lineContextSpan` | [#132](https://github.com/link-foundation/sensitive-data-sanitizer/issues/132) | URL user, cookie names, webhook endpoint, PEM markers, text between PEM blocks and rest of line are masked                                     | Findings are clipped to the credential itself                                                           |
| `idempotency`                                 | [#133](https://github.com/link-foundation/sensitive-data-sanitizer/issues/133) | A second pass changes its own encoded output; `***` masks of other tools are re-masked                                                         | Placeholders and re-encoded runs whose decoded text is already clean are kept                           |
| `configurationFlags`                          | [#134](https://github.com/link-foundation/sensitive-data-sanitizer/issues/134) | `AUTH_MODE=2`, `*_AUTH_GUARD=0` are masked                                                                                                     | Exemption for numeric and boolean configuration values                                                  |
| `exemptionHook`                               | [#135](https://github.com/link-foundation/sensitive-data-sanitizer/issues/135) | A transformation that keeps a value throws `ERR_RESIDUAL`                                                                                      | Exempt findings are removed between `inspect` and `redact`                                              |
| `missedShapes`                                | [#136](https://github.com/link-foundation/sensitive-data-sanitizer/issues/136) | All-caps test tokens, XML elements with attributes, hash rockets, `<…>` values, plural flags are missed                                        | Gap detectors passed through the `detectors` option                                                     |
| `syncLoading`                                 | [#137](https://github.com/link-foundation/sensitive-data-sanitizer/issues/137) | ESM-only, `import` condition only, about 1 s to load                                                                                           | Loaded lazily and synchronously through `require(esm)`                                                  |
| `wrappedEncoding`                             | [#138](https://github.com/link-foundation/sensitive-data-sanitizer/issues/138) | Wrapped base64 is re-encoded as one line and reported twice                                                                                    | Hive Mind's wrapped-run layer re-encodes with the original wrapping                                     |
| `candidateLimit`, `encodedLimitLines`         | [#139](https://github.com/link-foundation/sensitive-data-sanitizer/issues/139) | More than 4096 candidates throw `ERR_LIMIT`; 1000 identifier lines or `git rev-list` output are masked whole                                   | The text is inspected in line-aligned pieces (never inside a PEM block)                                 |
| `shortEncodedMask`, `shortHexKnownSecret`     | [#140](https://github.com/link-foundation/sensitive-data-sanitizer/issues/140) | The hex of a known secret under 16 characters is missed; at 16 characters the whole text throws `ERR_ENCODING`                                 | Short hex runs are found by Hive Mind's decoder; a run that cannot be re-encoded is masked as it stands |
| `environmentSelection`                        | [#141](https://github.com/link-foundation/sensitive-data-sanitizer/issues/141) | Default selection picks flags, counters, paths, `GIT_CONFIG_KEY_n` (`AUTH_GUARD=0` masks every `0`), misses `PGPASSWORD`, `*TOKEN`, `*_COOKIE` | `credentialEnvironmentValues` passes an explicit name list to `knownSecretsFromEnv`                     |

The pull request can merge with these workarounds in place. When an upstream issue is fixed, bump the library, delete the workaround, and keep the test row.

## Test notes

- Each sanitizer test file runs on its own with `experiments/issue-3739-run-sanitizer-tests.sh <out-dir>`, and the list of files is in `experiments/issue-3739-sanitizer-tests.txt`.
- Do not pass a V8 heap flag such as `--max-old-space-size` to that runner. Worker threads inherit it, and it overrides the `resourceLimits` of the log-sanitize worker. That breaks the containment check in `tests/test-issue-2189-bounded-sanitize-worker.mjs`.
- Tests and experiments use only synthetic secrets built at runtime. They never print a value: they print counts and prefixes, and assertions compare booleans. An early version of the hosts.yml test restored `GH_CONFIG_DIR` before the library's asynchronous read had finished. That is why `withEnv` in the migration test awaits its callback.
