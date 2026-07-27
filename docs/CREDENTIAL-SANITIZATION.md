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

## Adding or changing a format

1. Verify the format in the vendor's current official security or authentication documentation. Never paste a live credential into an issue, test, log, or commit.
2. Add only synthetic examples to `tests/test-credential-sanitization-2111.mjs`. Cover standalone, structured assignment, multiple-per-line, and chunk-split forms where applicable.
3. Add or update the maintained pattern in `src/credential-sanitization-core.lib.mjs`.
4. Run the focused security tests and the default suite:

   ```bash
   node tests/test-credential-sanitization-2111.mjs
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
