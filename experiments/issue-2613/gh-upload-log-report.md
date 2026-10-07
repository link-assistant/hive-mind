Repository fallback requires GET /user, which GitHub App installation tokens cannot access

Investigated while fixing [hive-mind #2613](https://github.com/link-assistant/hive-mind/issues/2613) in [PR #2614](https://github.com/link-assistant/hive-mind/pull/2614). Installed gh-upload-log: 0.9.2. The current repository-upload source also calls `gh api user --jq .login` before choosing the repository owner.

Reproduction:

1. In GitHub Actions, authenticate gh with a GitHub App installation token that can write to the current repository.
2. Write a small diagnostic file and run `gh-upload-log session.log --public --auto`.
3. Gist creation fails with `HTTP 403: Resource not accessible by integration`; repository fallback then fails with `Failed to fetch authenticated GitHub username: gh: Resource not accessible by integration (HTTP 403)`.

The complete real job log is [preserved here](https://github.com/link-assistant/hive-mind/blob/issue-2613-2efa14ce78a7/docs/case-studies/issue-2613/evidence/formal-job-2613.log#L4331), along with the [source inspected](https://github.com/link-assistant/hive-mind/blob/issue-2613-2efa14ce78a7/docs/case-studies/issue-2613/evidence/upstream-repository-upload.js#L152). A second independent workflow had the same failure. This is distinct from transient rate limiting: retries cannot grant a token access to Gists or the user endpoint.

Expected: a caller can explicitly target an existing repository and branch without requiring a user identity, permission to create another repository, or Gist access. A current-repository installation token should work for that repository target.

Workaround implemented in Hive Mind: sanitize the full log, verify the PR head/local checkout/origin, commit only the log artifacts to that existing PR branch, push it, and link the exact commit. [Regression tests](https://github.com/link-assistant/hive-mind/blob/issue-2613-2efa14ce78a7/tests/issue-2613-regressions.test.mjs) cover permanent-permission failure, secret removal, unrelated staged work, mismatched origins and failed pushes. A user access token with the necessary permissions remains another workaround.

Suggested implementation: add an explicit existing-repository `OWNER/REPO` target and branch option; derive the owner from that target (or an explicitly selected `GITHUB_REPOSITORY`) and bypass `getGitHubUsername()`/repository creation. Validate access through `GET /repos/OWNER/REPO`. Keep the authenticated-user default for callers that select a personal shared repository. Add mocks for Gist 403, user-endpoint 403 and successful writes to the explicitly selected repository, plus a test that a generic rate-limit 403 remains retryable.
