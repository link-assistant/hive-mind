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
- **Tracing:** `HIVE_MIND_SANITIZER_DEBUG=1` prints value-free decisions (rule ids, input lengths, rounds, counts) to stderr.

## A latent bug found on the way: `gh auth status` collector

The old `getGitHubTokensFromCommand` searched the output of `gh auth status` for tokens. Current gh versions (checked with 2.102.0) print the token masked (`gho_****…`), so this collector found **no** token. Only the `hosts.yml` reader and the environment remained, and they miss a token kept in the system keyring. The library's `knownSecretsFromGitHubAuth` runs `gh auth token` and gets the actual value without printing it. `experiments/issue-3739-known-local-collectors.mjs` compares the collectors. It prints only counts and 4-character prefixes.

## Latest-library audit and remaining workarounds

The dependency is now 0.21.1, published during the November 10 review. Its document-attribute changes were reviewed and all seven library-only probes below were repeated; these gaps remain. Upstream #131–#141 were closed by #142 in 0.21.0. Their fixes were read and the migration regressions were rerun. The old gap detectors, clipping rules, environment-name filter, encoded-limit splitting and short-hex fallback were removed. All rendering uses the library; the private-key workaround corrects only the type on native findings so the native type-based renderer applies full redaction. The adapter uses the lazy synchronous `/credentials` entry and the library's verified `sanitize()` API.

Seven additional gaps were found with library-only probes and reported:

| Adapter key          | Upstream report                                                                | Reproduction and retained workaround                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maskedProse`        | [#148](https://github.com/link-foundation/sensitive-data-sanitizer/issues/148) | A second pass consumes the sentence after `User token: ghp…b4N. Next sentence`. Exempt a context finding starting with a complete existing mask followed by prose. Other real credentials on the same line remain detectable; exact known secrets cannot be exempted.                                                                                                                                                                    |
| `wrappedPayload`     | [#149](https://github.com/link-foundation/sensitive-data-sanitizer/issues/149) | A wrapped binary image over 8192 characters is redacted wholesale; preceding alphabet words can shift a wrapped JSON record's byte alignment. The existing bounded wrapped decoder sanitizes decoded text through the library, checks re-encoding and retains layout. Only native encoded findings within those inspected runs (at most 256 KiB) are exempted; plaintext findings remain active and larger uninspected runs fail closed. |
| `constructorKeyword` | [#150](https://github.com/link-foundation/sensitive-data-sanitizer/issues/150) | Preserve exactly `new` followed by a constructor call; keyword-prefixed credentials remain masked. Existing #2400 regression.                                                                                                                                                                                                                                                                                                            |
| `markdownValues`     | [#151](https://github.com/link-foundation/sensitive-data-sanitizer/issues/151) | Preserve complete angle placeholders and exact documented nonsecret configuration enums/booleans when followed by Markdown backticks. Existing #3445 release-note regressions.                                                                                                                                                                                                                                                           |
| `overlappingScheme`  | [#152](https://github.com/link-foundation/sensitive-data-sanitizer/issues/152) | Gitleaks still masks `SharedAccessSignature` despite correct native Authorization detection. Exempt only the exact scheme word before a separate payload. Existing #2111 acceptance test.                                                                                                                                                                                                                                                |
| `encodedMask`        | [#153](https://github.com/link-foundation/sensitive-data-sanitizer/issues/153) | Keep canonical short base64/base64url forms of complete masks; inspect bounded escaped-JSON views with the configured policy before exempting an already-clean outer view. Existing #2156 GHCR/Secretlint regression.                                                                                                                                                                                                                    |
| `privateKeyType`     | [#154](https://github.com/link-foundation/sensitive-data-sanitizer/issues/154) | Native private-key findings have type `SECRET`. Retype native private-key findings (including Gitleaks/PuTTY) as `PRIVATE_KEY` so the native renderer fully redacts bodies; all other findings keep native Hive masks. Existing #2111 multiline-key acceptance test.                                                                                                                                                                     |

`experiments/issue-3739/latest-library-audit.mjs` probes the current library without the adapter. `experiments/issue-3739-upstream-repros.mjs` retains the historical 0.19.3 probes for the resolved reports. Keep the regression when removing each remaining workaround after an upstream fix.

## Open-issue review

All 157 open issues were inventoried, with full bodies and comments reviewed for the matching sanitizer issues. PR conversation comments, inline comments and reviews were included. The November 10 review asked for all related open sanitizer work, beyond the original header bug.

| Issue        | Implementation and regression evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #3739, #3740 | Shared library engine, credentials-only policy, known-local collectors and all sink integrations: `issue-3739-sensitive-data-sanitizer-migration.test.mjs` (38 cases), plus existing credential/publication/Sentry/post-finish regressions.                                                                                                                                                                                                                                                                                  |
| #3747        | Replace the quadratic suffix regex and absent-CR full-buffer scans in both terminal and file-stream boundary paths. `sanitizer-open-issues-3741.test.mjs` uses finite 200 KiB JSON-image and wrapped-binary inputs, small writes, byte-for-byte output and LF/CR/CRLF splits. `experiments/issue-3739/base64-stream-perf.mjs` records bounded timings.                                                                                                                                                                       |
| #2841        | Preserve Actions `id-token: write/read/none` and `${{ secrets.GITHUB_TOKEN }}` via native library policy. Repair AI-created evidence with a bounded private sibling file, verify, then atomically replace it; residual diagnostics identify file, line and rule without values. Regression covers clean workflow text, a synthetic credential on line 6, diagnosis and successful repair.                                                                                                                                    |
| #2837        | Its [later comment](https://github.com/link-assistant/hive-mind/issues/2837#issuecomment-6364073966) supersedes hiding account identifiers. Keep useful SDK/OTEL diagnostics and public identifiers, remove credentials. A realistic account/email/organization/workspace example verifies the current credentials-only requirement.                                                                                                                                                                                         |
| #2647        | Add `--configuration-file` / `HIVE_MIND_CONFIGURATION_FILE`; replace inline token options with environment transport using `execve`, retaining PID and CLI precedence. Real child processes inspect `/proc/self/cmdline`, covering 12 long, short, attached, equals and grouped option forms; verbose flags and the `--` separator retain their meaning. File/default precedence and missing-file tests supplement existing parser coverage. Helm Secret and private-file Ubuntu examples are updated in all four languages. |
| #3951        | Use `YOUR_TELEGRAM_BOT_TOKEN` in `.lenv.example` and both archived control-script `LENV_EXAMPLE_TEMPLATE` source copies. A regression inspects all three. The issue reports the operator's live template already fixed; this PR synchronizes repository copies and makes no claim to change a live host.                                                                                                                                                                                                                     |

## Verification

- The relevant test list is `experiments/issue-3739-sanitizer-tests.txt`; run sequentially with `bash experiments/issue-3739-run-sanitizer-tests.sh /tmp/sanitizer-tests`. Each file gets its own log and the runner records exit codes in `summary.txt`. CI also discovers the new regression files in the default suite.
- Do not pass a V8 heap flag to that runner. Worker threads inherit it and override the log-sanitize worker's `resourceLimits`, invalidating the containment check in `test-issue-2189-bounded-sanitize-worker.mjs`.
- The older #2397 arrow-function test now requires the complete noncredential expression to survive, consistent with #2400 and credentials-only preservation; hash-rocket literal credentials remain masked. The #2111 staging regression now requires AI-created evidence to be repaired and verified before Git runs, matching #2841; unrepaired residuals still fail closed.
- Synthetic fixtures are assembled at runtime. Tracing is off by default and emits only rule ids, input lengths, rounds and counts.
- CI follow-up: the first full 795-file run failed four files ([run 42882837227](https://github.com/link-assistant/hive-mind/actions/runs/42882837227), job log lines 7463, 8204, 8242 and 16961). Binary timing fixtures now use repeatable content; a separate injected vendor-key assertion guards credential removal inside image data. Unconstrained random base64 can match a credential format and cannot always remain unchanged. The two real-bot IPC harnesses use private environment input because Node `execve` closes non-stdio descriptors; their existing responsiveness assertions remain. Dependency-pin assertions now match Sentry 11.12.0. All four corrected files pass locally, extending the focused inventory to 45 files. The finite 12-seed binary probe preserved all 24 image/wrapped samples.
- Full default-suite and native-build verification runs in the existing CI workflows; local checks stay focused to respect the container's memory limit.
