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
- Publication is fail-closed. If the maintained scanner, Secretlint, or the residual scan fails, the external mutation is blocked with `ERR_CREDENTIAL_SANITIZATION`.
- Temporary publication files and local audit sources are owner-readable only (`0600`); temporary upload directories are `0700`.
- `--development-log` leaves raw local audit sources unchanged and stages only sanitized copies.

The dependency-free synchronous core protects terminal and local log paths. Publication boundaries then run the core, known-active-token matching, Secretlint, and a residual rescan. Dangerous local-output compatibility switches do not bypass publication boundaries.

## Covered forms

The maintained patterns cover:

- GitHub, GitLab, OpenAI, Anthropic, AWS, Google/GCP, Azure, Slack, Discord, Telegram, Stripe, Twilio, SendGrid, npm, PyPI, Docker, and common CI credential formats;
- OAuth access/refresh tokens, JWT/JWS tokens, webhook URLs, HTTP Authorization headers, and Cookie/Set-Cookie values;
- JSON, YAML, TOML, INI, XML, environment/shell assignments, CLI flags, sensitive query parameters, connection-string passwords, and PEM private keys;
- exact values discovered from active credential environment variables and local GitHub authentication.

Detection is intentionally conservative at external boundaries. A false positive may mask a credential-like value; a scanner failure blocks the publication instead of sending the original bytes.

The implementation review compared external scanners such as Gitleaks and detect-secrets with the project's existing Secretlint integration. Secretlint remains the publication scanner because it is a maintained rule set that runs inside the Node.js process without adding a Go or Python runtime dependency. The synchronous maintained rules cover terminal paths where an asynchronous scanner cannot run, while Secretlint and the residual rescan provide an independent publication check.

## Encoded credentials

A pattern scanner matches the bytes it is given, so a credential that reaches a log only in encoded form is invisible to every surface-text rule at once. That is not a hypothetical evasion: ordinary tooling encodes constantly without intending to obscure anything, and issue [#2156](https://github.com/link-assistant/hive-mind/issues/2156) is a leak caused by exactly this — a registry token endpoint echoed the supplied credential back base64-encoded inside a JSON body, which was logged, published, and revoked by GitHub's scanner. The [case study](./case-studies/issue-2156/README.md) has the full analysis.

`src/encoded-credential-detection.lib.mjs` therefore decodes before matching:

- Bounded base64, base64url, hex, percent-encoded, byte-escape, and HTML-entity runs are decoded, and the plaintext rules run over the decoded text.
- Base64 is read at all three byte alignments, so a credential embedded mid-blob is still found. Line-wrapped blobs are scanned as contiguous groups of base64-only lines, because every common wrapper folds its output (76 columns for MIME, 64 for PEM) and a folded blob contains no single-line run to match.
- A masked payload is re-encoded and the round trip is verified before substitution. Only a run that decodes back to exactly what was intended for publication is spliced in; otherwise the whole run becomes `[REDACTED]`. This is what preserves the `abc…xyz` contract through an encoding: `{"token":"gho_…"}` stays valid base64 and decodes to `{"token":"gho…999"}`, so the surrounding structure and the credential's ends are still readable.
- The stream sanitizer holds a trailing group of base64-only lines back until a line arrives that cannot belong to the blob. Releasing them individually would hand the sanitizer byte-misaligned slices.
- Secretlint runs over the decoded payloads too, each run scanned separately, sharing the same decoder walk as the synchronous core. Redundancy between detectors is useful because their vocabularies differ — Secretlint knows formats the maintained rules do not — but it only helps behind the decoder. Measured against the incident log, Secretlint's recommended preset reports zero findings across all 16.9 MB; see [the library survey](./case-studies/issue-2156/data/library-survey-output.txt).
- Exclusion carve-outs for user-supplied content are surface-level and deliberately stop at the decoder. They name literal spans to leave alone, which an encoded run does not contain, so a caller's exclusion list cannot open a hole in this layer. Over-redacting an encoded blob costs a line of log detail; the reverse costs a credential.

Encoded-payload detections are reported separately in the verbose sanitization summary, with the rule identifiers that fired, so an incident of this class is attributable from the log.

## Adding or changing a format

1. Verify the format in the vendor's current official security or authentication documentation. Never paste a live credential into an issue, test, log, or commit.
2. Add only synthetic examples to `tests/test-credential-sanitization-2111.mjs`. Cover standalone, structured assignment, multiple-per-line, and chunk-split forms where applicable.
3. Add or update the maintained pattern in `src/credential-sanitization-core.lib.mjs`.
4. Run the focused security tests and the default suite:

   ```bash
   node tests/test-credential-sanitization-2111.mjs
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
