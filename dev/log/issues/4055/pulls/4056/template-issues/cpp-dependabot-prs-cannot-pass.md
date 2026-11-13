## Summary

Both open Dependabot pull requests fail CI for reasons the bot cannot fix:

- #26, `Bump the ci-tools group across 1 directory with 2 updates`
- #27, `Bump the actions group across 1 directory with 3 updates`

Both opened 2026-11-13. The checks that fail them would fail every future Dependabot pull request the same way, and no workflow reports a bot pull request that cannot merge.

Found while auditing [link-assistant/hive-mind#4055](https://github.com/link-assistant/hive-mind/issues/4055). That repository had a Dependabot pull request stuck for 52 days with every Dependabot run green.

## Reproduction

Run 43402801047 on #26:

```
Changelog Fragment Check: ##[error]This pull request changes code but adds no changelog fragment. Add one with `python3 scripts/create_changelog_fragment.py --bump-type patch --description "..."` ...
Release Script Tests:     E   AssertionError: Unaudited workflow tool: zizmor==1.31.1
                          FAILED scripts/tests/test_workflows.py::test_python_audit_covers_explicit_pipx_tools
Pipeline Status:          ##[error]Failed jobs: changelog, script-tests
```

#27 fails `Changelog Fragment Check` the same way.

There are two causes:

1. `scripts/check_changelog_fragment.py` requires a fragment from every code-changing pull request, and Dependabot never writes one.
2. The zizmor version is pinned twice. Dependabot (`pip`, `/scripts`) bumps `scripts/requirements-security.txt` to `zizmor==1.32.0`. The `pipx run zizmor==1.31.1` lines in `.github/workflows/workflows.yml` (lines 104 and 120) are not a Dependabot manifest, so they stay. `test_python_audit_covers_explicit_pipx_tools` then correctly reports the mismatch.

## Workaround

Push a commit to each Dependabot branch: add a `changelog.d/` fragment and, for #26, update the two `pipx run zizmor==` lines.

## Suggested fix

1. Exempt `dependabot[bot]` from the fragment check (`github.event.pull_request.user.login`), or have a scheduled job commit a fragment generated from the Dependabot title to the bot branch.
2. Keep one source for the zizmor version: have the workflow run `pipx run --spec "$(grep '^zizmor==' scripts/requirements-security.txt)" zizmor`, so the requirements file Dependabot updates is the only pin.
3. Report bot pull requests that do not merge. A scheduled job can fail when a `dependabot[bot]` pull request is older than N days (hive-mind uses 14). Reference: [`scripts/dependabot-health.lib.mjs`](https://github.com/link-assistant/hive-mind/blob/issue-4055-672ac9297a9a/scripts/dependabot-health.lib.mjs) and [`.github/workflows/dependabot-health.yml`](https://github.com/link-assistant/hive-mind/blob/issue-4055-672ac9297a9a/.github/workflows/dependabot-health.yml) (link-assistant/hive-mind#4056).
