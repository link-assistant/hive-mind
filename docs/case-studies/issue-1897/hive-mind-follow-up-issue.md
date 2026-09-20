# Remove npm global prefix workaround after use-m handles non-writable global roots

Upstream issue: https://github.com/link-foundation/use-m/issues/54
Introduced workaround PR: https://github.com/link-assistant/hive-mind/pull/1898
Original bug report: https://github.com/link-assistant/hive-mind/issues/1897

## Problem

PR 1898 keeps Hive Mind users unblocked by redirecting npm global installs to a
user-writable prefix before `use-m` can run `npm install -g`. The long-term owner
of this behavior should be `link-foundation/use-m`, because use-m is the code
that resolves `npm root -g` and installs alias packages globally.

Once use-m handles non-writable npm global roots itself, Hive Mind should remove
the downstream workaround to reduce startup code and avoid keeping duplicated
resolver policy.

## Acceptance criteria

- Confirm the upstream use-m release includes handling for non-writable npm
  global roots or provides an equivalent supported configuration.
- Verify Hive Mind no longer needs to set `npm_config_prefix` before loading
  use-m.
- Remove or simplify:
  - `src/npm-global-prefix.lib.mjs`
  - the npm-prefix logic inside `src/use-m-bootstrap.lib.mjs`
  - workaround-specific tests in `tests/test-npm-global-prefix.mjs`
  - the issue #1897 changeset text if still unreleased at the time
- Keep a regression test that proves Hive Mind's use-m bootstrap no longer
  contains a project-local npm global prefix workaround.
- Run local checks and verify CI on the removal PR.

## Notes

Do not remove the workaround until a concrete upstream version or upstream source
change can be verified. The original failure occurred before solve loaded its
normal dependency graph, so removal without upstream coverage would regress
installed CLI startup.
