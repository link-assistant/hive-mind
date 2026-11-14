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
- Option placeholders such as `--secrets <path>`, `--password <value>` and `[file]`, and expressions such as `${{ secrets.GITHUB_TOKEN }}`, stay unchanged. A real value after the same option is masked: `--password Xy7…R8k` ([#4043](https://github.com/link-assistant/hive-mind/issues/4043)).
- Set `HIVE_MIND_SANITIZER_DEBUG=1` to trace sanitizer decisions on stderr. The trace shows rule ids, input lengths, rounds, and counts, but never the matched text.

## Log upload through gh-upload-log

Hive Mind sanitizes a log before it calls `gh-upload-log`. `gh-upload-log` then sanitizes the copy again with its own library. Up to `gh-upload-log` 0.13.1 that library was pinned to 0.12.1, which refused a record over 64 MiB or dense base64: `Sanitization failed (ERR_LIMIT) (record exceeds 64 MiB or detector limit); nothing was uploaded`. `gh-upload-log` 0.13.2 removes both limits ([gh-upload-log#63](https://github.com/link-foundation/gh-upload-log/issues/63)) and reports `Sanitization failed (CODE) (details); retryable|not retryable; nothing was uploaded`.

- A refusal marked `not retryable` (and any refusal from 0.13.1 or older) is deterministic, so Hive Mind does not retry it. It logs the refusal once and moves on: a whole log is re-sent as parts, and a refused part goes to the pull-request branch fallback ([#4042](https://github.com/link-assistant/hive-mind/issues/4042)). A failure marked `retryable` (`ERR_INPUT_CHANGED`, `ENOSPC`, `EAGAIN`, …) and network or server errors are retried with backoff.
- Parts are line-aligned. A single line longer than the part cap (at most 48 MiB, below the old 64 MiB record limit) is cut on a UTF-8 character boundary, and the log reports how many lines were cut. The parts concatenate to the exact sanitized log.
- `gh-upload-log` 0.13.2 still refuses (`ERR_SANITIZATION`) an ASCII letter or digit run of about 4 MiB, such as zero-filled binary as base64, next to non-ASCII text such as Hive Mind's emoji ([sensitive-data-sanitizer#172](https://github.com/link-foundation/sensitive-data-sanitizer/issues/172)). So no part holds more than 1 MiB of one such run together with a non-ASCII byte, a refused file is re-sent as such parts even when it fits in one part, and the log reports these extra cuts.
- If the failure comment is about a refusal, it does not suggest re-running the refused command. For `ERR_LIMIT` it says to upgrade `gh-upload-log` to 0.13.2 or later, or to split the log into 20 MB parts; for `ERR_SANITIZATION` it suggests 2 MiB parts.
- If the disk fills while the sanitized copy is written, the failure reason says to free disk space and retry ([#1212](https://github.com/link-assistant/hive-mind/issues/1212)).

## Long runs and long values

- Hive Mind's encoded-run detectors (base64, hex, percent escapes, byte escapes, HTML entities and wrapped base64 lines) are linear scanners, so one multi-MiB run, such as a screenshot in a JSONL record, no longer overflows the regular-expression stack and blocks the log ([#4049](https://github.com/link-assistant/hive-mind/issues/4049)).
- The library threw `ERR_SANITIZATION` on a letter or digit run of about 4 MiB in text with any character above U+00FF up to 0.22.3 ([sensitive-data-sanitizer#172](https://github.com/link-foundation/sensitive-data-sanitizer/issues/172)). 0.22.4 fixed it, so the adapter no longer needs its long-run fallback.
- A credential keyword followed by one very long value (`password=` and 1 MiB) is scanned about 100 times slower than plain text, about 13 seconds per MiB ([sensitive-data-sanitizer#173](https://github.com/link-foundation/sensitive-data-sanitizer/issues/173)). The value is still fully masked; this is a documented performance limit.

## Covered forms

The library rules (vendor formats, the Gitleaks rule set, and contextual keys) cover:

- GitHub, GitLab, OpenAI, Anthropic, AWS, Google/GCP, Azure, Slack, Discord, Telegram, Stripe, Twilio, SendGrid, npm, PyPI, Docker, and common CI credential formats;
- OAuth access/refresh tokens, JWT/JWS tokens, webhook URLs, HTTP Authorization headers, and Cookie/Set-Cookie values;
- JSON, YAML, TOML, INI, XML, environment/shell assignments, CLI flags, sensitive query parameters, connection-string passwords, and PEM private keys;
- exact values discovered from local credentials. The library collects them: credential environment variables (`knownSecretsFromEnv`), every token in the gh `hosts.yml` (`knownSecretsFromGitHubConfig`), and `gh auth token` (`knownSecretsFromGitHubAuth`). `KNOWN_LOCAL_TOKEN_ENV_VARS` lists the variables that are always read.

Detection is intentionally conservative at external boundaries. A false positive may mask a credential-like value; a scanner failure blocks the publication instead of sending the original bytes.

Library 0.22.3 owns credential rules, environment selection, format context, npm-package and token-count exemptions. The adapter lazily loads `/credentials`. Obsolete workarounds for #131–#141, #148–#154 and #162 were removed, and 0.22.2 and 0.22.3 fixed #168 (slow masked logs) and #170 (long mixed-case runs). Two adapter workarounds remain: the long-run fallback for #172 (see [Long runs and long values](#long-runs-and-long-values)), as recorded in the [case study](./case-studies/issue-3739/README.md), and an `exempt` hook for [#177](https://github.com/link-foundation/sensitive-data-sanitizer/issues/177), which keeps a complete placeholder (`<value>`, `$NAME`, `${NAME}`) that closes a Markdown code span after an `Authorization:` header, such as `` `Authorization: token <value>` `` in a release note ([#4050](https://github.com/link-assistant/hive-mind/issues/4050)). It keeps only values the library itself keeps when no backtick follows them, and known secrets are never offered to it. Native `PRIVATE_KEY` findings use the library's per-type full redaction. Secretlint and `containsKnownToken` remain independent publication verifiers.

## Encoded credentials

A pattern scanner matches the bytes it is given, so a credential that reaches a log only in encoded form is invisible to every surface-text rule at once. That is not a hypothetical evasion: ordinary tooling encodes constantly without intending to obscure anything, and issue [#2156](https://github.com/link-assistant/hive-mind/issues/2156) is a leak caused by exactly this — a registry token endpoint echoed the supplied credential back base64-encoded inside a JSON body, which was logged, published, and revoked by GitHub's scanner. The [case study](./case-studies/issue-2156/README.md) has the full analysis.

The library decodes before matching (`preserveEncoding`). Release 0.21.4 natively preserves short encoded masks and applies configured policy to bounded escaped JSON views (#153); both local exemptions were removed. Release 0.21.3 resolves the binary case of [upstream #149](https://github.com/link-foundation/sensitive-data-sanitizer/issues/149), preserving bounded harmless wrapped binary while retaining embedded credential detection; binary exemptions were removed. Release 0.22.1 resolves [upstream #162](https://github.com/link-foundation/sensitive-data-sanitizer/issues/162): complete unpadded wrapped base64 text is recovered before following prose, so the local wrapped-text prepass was removed. Short known-secret hex is also handled natively. The independent decoder remains for Secretlint and known-token verification:

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
