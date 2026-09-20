# F7 — `permissions: read-all` as the workflow default

**Severity:** Medium · **Class:** Security posture / zizmor `excessive-permissions`
**Status:** Fixed in `2cf01935` (release.yml) and `e5e99f32` (the rest, plus the test).

## Symptom

```
$ grep -n "^permissions" dev/log/issues/2198/pulls/2199/workflows-before/*.yml
workflows-before/release.yml:37:permissions: read-all
workflows-before/cleanup-test-repos.yml:12:permissions: read-all
```

`read-all` grants the default `GITHUB_TOKEN` read access to *every* scope — actions,
packages, security events, deployments — for jobs that only need to check the repository
out. Every job that actually writes already declares its own `permissions:` block, so the
blanket default was granting reads nothing consumed.

`cleanup-test-repos.yml` is the sharper case: it deletes repositories, and does so
through `TEST_GITHUB_USER_REPO_DELETION_TOKEN` — never `GITHUB_TOKEN`. The broad default
bought it nothing at all.

## The interesting part: a test was pinning the wrong thing

`tests/ci-integrity-2150.test.mjs` **asserted** `permissions: read-all` for the release
and cleanup workflows. Tightening the default made that test fail.

Its own failure message read *"defaults to least-privilege read permissions"* — which
`contents: read` satisfies strictly more than `read-all` does. The expectation had been
written to match the file rather than the intent, so the test was locking in the defect
it was meant to prevent. This is a false positive in the literal sense the issue asks
about: a red signal produced by a correct change.

The assertion now rejects `read-all` outright and requires `contents: read`. All four
workflows declare:

```yaml
permissions:
  contents: read
```
