# Credential sanitization

Hive Mind treats generated terminal output, logs, error reports, development-log artifacts, and GitHub mutations as potentially credential-bearing.

This control reduces accidental disclosure through Hive Mind's own output paths. It does not make an autonomous agent or an internet-connected host safe: an agent can still access data and communicate through channels outside these sinks. Use short-lived, least-privilege credentials in an isolated environment and rotate any credential that may have been exposed.

## Contract

All maintained sinks use the sanitizer in `src/token-sanitization.lib.mjs`.

- Values longer than 12 characters retain exactly their first and last three characters: `abc…xyz`.
- Values of 12 characters or fewer become `[REDACTED]`.
- Unrelated text and structural context are retained where possible.
- Every credential occurrence is sanitized, including multiple values on one line.
- Terminal stdout/stderr uses a record buffer so a credential split across child-process chunks is not emitted before it can be scanned.
- Encoded copies of a credential are sanitized as well as plain ones, and the mask contract survives the encoding. See [Encoded credentials](#encoded-credentials).
- GitHub comments, PR/issue bodies and titles, releases, log uploads, gists, development-log repository copies, and Sentry payloads are scanned at their exact outbound boundary.
- Publication is fail-closed. If the synchronous core, Secretlint, or the residual scan fails, the external mutation is blocked with `ERR_CREDENTIAL_SANITIZATION`.
- Temporary publication files and local audit sources are owner-readable only (`0600`); temporary upload directories are `0700`.
- `--development-log` leaves raw local audit sources unchanged and stages only sanitized copies.

The synchronous core runs on [`@link-foundation/sensitive-data-sanitizer`](https://github.com/link-foundation/sensitive-data-sanitizer) (`src/sensitive-data-sanitizer.lib.mjs`). It protects terminal and local log paths. At publication boundaries, Hive Mind then runs the core, known-active-token matching, Secretlint, and a residual rescan. Dangerous compatibility switches for local output do not bypass publication boundaries.

- Only credentials are masked (`credentialsOnly`). E-mail addresses, account and user IDs, and GitHub logins stay readable ([#3724](https://github.com/link-assistant/hive-mind/issues/3724), rule 14).
- Format context around a credential stays readable, and only the credential itself is masked. This covers the scheme word of an `Authorization` header (`Authorization: token ghp…b4N`, `Authorization: CustomScheme f3a…3e5`), a URL user name, cookie names, PEM markers, and webhook endpoints ([#3739](https://github.com/link-assistant/hive-mind/issues/3739)).
- Shell expressions such as `Authorization: token $(gh auth token)` are kept, because they reference a credential without containing one.
- Set `HIVE_MIND_SANITIZER_DEBUG=1` to trace sanitizer decisions on stderr. The trace shows rule ids, input lengths, rounds, and counts, but never the matched text.

## Covered forms

The library rules (vendor formats, the Gitleaks rule set, and contextual keys) cover:

- GitHub, GitLab, OpenAI, Anthropic, AWS, Google/GCP, Azure, Slack, Discord, Telegram, Stripe, Twilio, SendGrid, npm, PyPI, Docker, and common CI credential formats;
- OAuth access/refresh tokens, JWT/JWS tokens, webhook URLs, HTTP Authorization headers, and Cookie/Set-Cookie values;
- JSON, YAML, TOML, INI, XML, environment/shell assignments, CLI flags, sensitive query parameters, connection-string passwords, and PEM private keys;
- exact values discovered from local credentials. The library collects them: credential environment variables (`knownSecretsFromEnv`), every token in the gh `hosts.yml` (`knownSecretsFromGitHubConfig`), and `gh auth token` (`knownSecretsFromGitHubAuth`). `KNOWN_LOCAL_TOKEN_ENV_VARS` lists the variables that are always read.

Detection is intentionally conservative at external boundaries. A false positive may mask a credential-like value; a scanner failure blocks the publication instead of sending the original bytes.

Library 0.21.5 owns credential rules, environment selection, format context, npm-package and token-count exemptions. The adapter lazily loads `/credentials`. Obsolete workarounds for #131–#141, #148, the binary part of #149, #153 and #152 were removed; four remaining gaps are reported as upstream #150, #151, #154 and #162 and documented individually in the [case study](./case-studies/issue-3739/README.md). They cover constructor syntax, Markdown placeholders/configuration, private-key typing and wrapped-text boundaries. Secretlint and `containsKnownToken` remain independent publication verifiers.

## Encoded credentials

A pattern scanner matches the bytes it is given, so a credential that reaches a log only in encoded form is invisible to every surface-text rule at once. That is not a hypothetical evasion: ordinary tooling encodes constantly without intending to obscure anything, and issue [#2156](https://github.com/link-assistant/hive-mind/issues/2156) is a leak caused by exactly this — a registry token endpoint echoed the supplied credential back base64-encoded inside a JSON body, which was logged, published, and revoked by GitHub's scanner. The [case study](./case-studies/issue-2156/README.md) has the full analysis.

The library decodes before matching (`preserveEncoding`). Release 0.21.4 natively preserves short encoded masks and applies configured policy to bounded escaped JSON views (#153); both local exemptions were removed. Release 0.21.3 resolves the binary case of [upstream #149](https://github.com/link-foundation/sensitive-data-sanitizer/issues/149), preserving bounded harmless wrapped binary while retaining embedded credential detection; binary exemptions were removed. [Upstream #162](https://github.com/link-foundation/sensitive-data-sanitizer/issues/162) still requires disambiguating wrapped text from following prose. The retained prepass delegates credential decisions to the library, verifies reconstruction and exempts only complete canonical text views up to 256 KiB that the configured engine inspects as clean. Plaintext and known-secret matches stay active; larger uninspected runs remain fail-closed. Short known-secret hex is also handled natively. The independent decoder remains for Secretlint and known-token verification:

- Bounded base64, base64url, hex, percent-encoded, byte-escape, and HTML-entity runs are decoded, and the plaintext rules run over the decoded text.
- Base64 is read at all three byte alignments, so a credential embedded mid-blob is still found. Line-wrapped blobs are scanned as contiguous groups of base64-only lines, because every common wrapper folds its output (76 columns for MIME, 64 for PEM) and a folded blob contains no single-line run to match.
- A masked payload is re-encoded and the round trip is verified before substitution. Only a run that decodes back to exactly what was intended for publication is spliced in; otherwise the whole run becomes `[REDACTED]`. This is what preserves the `abc…xyz` contract through an encoding: `{"token":"gho_…"}` stays valid base64 and decodes to `{"token":"gho…999"}`, so the surrounding structure and the credential's ends are still readable.
- The stream sanitizer holds a trailing group of base64-only lines back until a line arrives that cannot belong to the blob. Releasing them individually would hand the sanitizer byte-misaligned slices. The line a blob _starts_ on is held too, for one record: it is not base64-only, so it does not join the group, and once released on its own a credential straddling the first fold is in neither piece. Ordinary output is not delayed by this, because the test is not the length of the line's trailing base64 run but whether that run decodes to text — a URL, a commit SHA or a content digest does not.
- Secretlint runs over the decoded payloads too, each run scanned separately, using Hive Mind's own decoder (`findDecodableRuns`), so it does not depend on the library's decoding. Redundancy between detectors is useful because their vocabularies differ — Secretlint knows formats the library rules do not — but it only helps behind the decoder. Measured against the incident log, Secretlint's recommended preset reports zero findings across all 16.9 MB; see [the library survey](./case-studies/issue-2156/data/library-survey-output.txt).
- Exclusion carve-outs for user-supplied content are surface-level and deliberately stop at the decoder. They name literal spans to leave alone, which an encoded run does not contain, so a caller's exclusion list cannot open a hole in this layer. Over-redacting an encoded blob costs a line of log detail; the reverse costs a credential.

Encoded-payload detections are reported separately in the verbose sanitization summary, with the rule identifiers that fired, so an incident of this class is attributable from the log.

## Adding or changing a format

1. Verify the format in the vendor's current official security or authentication documentation. Never paste a live credential into an issue, test, log, or commit.
2. Add only synthetic examples to `tests/test-credential-sanitization-2111.mjs`. Cover standalone, structured assignment, multiple-per-line, and chunk-split forms where applicable.
3. Report the missing format to [`@link-foundation/sensitive-data-sanitizer`](https://github.com/link-foundation/sensitive-data-sanitizer/issues) first. Until it is fixed there, add a narrow adapter workaround using native detection and rendering in `src/sensitive-data-sanitizer.lib.mjs` with an `UPSTREAM` link, and a row in `tests/issue-3739-sensitive-data-sanitizer-migration.test.mjs`.
4. Run the focused security tests and the default suite:

   ```bash
   node tests/test-credential-sanitization-2111.mjs
   node tests/issue-3739-sensitive-data-sanitizer-migration.test.mjs
   node tests/test-encoded-credential-leak-2156.mjs
   node tests/test-encoded-secretlint-layer-2156.mjs
   node tests/test-require-sanitized-output-rule.mjs
   npm test
   npm run lint
   ```

5. For a new outbound sink, use `sanitizeForPublication`, `writeSanitizedPublicationFile`, or a helper that already calls them. Add a static-rule test proving that an unsanitized equivalent is rejected.
6. Record the source, test cases, and any false-positive tradeoff in the pull request.

Review the vendor inventory at least quarterly and whenever a provider announces an authentication change. Useful primary references include the [GitHub authentication overview](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-authentication-to-github), [GitLab token guidance](https://docs.gitlab.com/security/tokens/), [AWS IAM identifiers](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_identifiers.html), [Slack token types](https://api.slack.com/concepts/token-types), [Stripe API keys](https://docs.stripe.com/keys), [Twilio API keys](https://www.twilio.com/docs/iam/api-keys), [npm access tokens](https://docs.npmjs.com/about-access-tokens/), and the [PyPI secret reporting format](https://docs.pypi.org/api/secrets/).

## Incident response

Sanitization is not revocation. If a real credential reached a terminal capture, repository, GitHub object, upload, telemetry event, or another external system:

1. revoke or rotate it immediately;
2. restrict access to the affected artifact;
3. remove the exposed value from current content and retained history where the platform supports it;
4. inspect provider audit logs for misuse;
5. add a synthetic regression for the missed format or sink before restoring publication.
