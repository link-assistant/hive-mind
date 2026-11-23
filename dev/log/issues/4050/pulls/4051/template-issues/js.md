## Summary

The release pipeline uploads the npm tarball without checking its size first. When npm refuses an oversized tarball with `E413 Payload Too Large`, `scripts/publish-to-npm.mjs` treats the refusal as a temporary failure and retries the same bytes. The release then fails at the very end, after every build has passed, with only a generic "failed after N attempts" message.

This happened downstream in link-assistant/hive-mind#4050: `@link-assistant/hive-mind` 2.40.0 and 2.40.1 (249,847,872 and 249,862,346 bytes) were refused three times each. As a result no version, Docker image or Helm chart was released. The Rust template already prevents this class of failure with `scripts/check-crate-size.rs` (crates.io's 10 MiB limit, also enforced with a 413).

## Reproduce

`scripts/publish-failure-classifier.mjs` at `main`:

```js
import { isNonRetryableFailure } from './scripts/publish-failure-classifier.mjs';
isNonRetryableFailure('└ E413: 413 Payload Too Large - PUT https://registry.npmjs.org/example');
// => false: NON_RETRYABLE_PATTERNS covers only 401/403/404/auth, so the loop retries
```

Downstream log, from the `Publish to npm` step of run https://github.com/link-assistant/hive-mind/actions/runs/43242624306:

```
Publish attempt 1 of 3...
└ E413: 413 Payload Too Large - PUT https://registry.npmjs.org/@link-assistant%2fhive-mind
Publish attempt 1 failed: exit code 1
Publish attempt 2 of 3...
└ E413: 413 Payload Too Large - PUT https://registry.npmjs.org/@link-assistant%2fhive-mind
Publish attempt 2 failed: exit code 1
Publish attempt 3 of 3...
└ E413: 413 Payload Too Large - PUT https://registry.npmjs.org/@link-assistant%2fhive-mind
Publish attempt 3 failed: exit code 1
Failed to publish @link-assistant/hive-mind@2.40.1: exit code 1
```

Each attempt spent about 87 seconds uploading before being refused.

## Workaround

Run `npm pack --dry-run --json` before publishing and fail if `size` exceeds a budget. The largest tarball we have seen npm accept is 165,142,849 bytes (`@openai/codex@0.164.0-linux-x64`); we use 157 MiB.

## Suggested fix

1. Add `'e413'`, `'npm error 413'` and `'payload too large'` to `NON_RETRYABLE_PATTERNS`. Give them their own guidance that says what grew, rather than reusing the authentication text.
2. Add a size gate that reads `npm pack --dry-run --json` and refuses any tarball above the budget. It should print a `::error` annotation listing the largest `files[]` entries. Run it in the release job before `changeset publish`, and on pull requests that change `package.json` `files`.
3. Document how to ship large platform-specific binaries: as per-platform packages pinned through `optionalDependencies`, as `@openai/codex` does.

Reference implementation:
- https://github.com/link-assistant/hive-mind/pull/4051
- `scripts/check-npm-tarball-size.mjs`
- `scripts/publish-failure-classifier.mjs` (`PAYLOAD_TOO_LARGE_PATTERNS`)
- `tests/native-codex-packages-4050.test.mjs`
