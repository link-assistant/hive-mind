## Summary

Dependabot pull request #135 (`chore(deps): bump the actions group across 1 directory with 3 updates`, opened 2026-11-02) cannot pass CI. The reason is not the update itself: the tests hard-code the action versions it updates. Dependabot's own runs stay green while #135 waits, and no workflow reports a bot pull request that cannot merge. So every weekly `actions` update will queue up the same way.

Found while auditing [link-assistant/hive-mind#4055](https://github.com/link-assistant/hive-mind/issues/4055). That repository had a Dependabot pull request stuck for 52 days with every Dependabot run green.

## Reproduction

`Test (Python 3.13)` on #135 fails (run 43399754022, job 131799534756):

```
>       assert "uses: actions/cache/restore@v5" in job
E       AssertionError: assert 'uses: actions/cache/restore@v5' in '  link-checker: ...
```

The tests that pin versions Dependabot owns:

- `tests/test_issue_118_workflows.py:51`: `assert "uses: actions/cache/restore@v5" in job`
- `tests/test_issue_147_workflows.py:16`: `assert "actions/cache/restore@v5" in restore`
- `tests/test_issue_98.py:60`: `assert "uses: zizmorcore/zizmor-action@v0.6.4" in job`. The `ZIZMOR_VERSION` assertion next to it is tied to that tag.

Locally: check out #135's branch and run `python -m pytest tests/test_issue_118_workflows.py tests/test_issue_147_workflows.py`.

## Workaround

Push a commit to the Dependabot branch that updates the three assertions, then merge.

## Suggested fix

1. Assert what a test is about, not the version Dependabot is allowed to change. For example: `assert re.search(r"uses: actions/cache/restore@v\d+\b", job)`. Where a version really is coupled (zizmor-action ↔ `ZIZMOR_VERSION`), assert the coupling: read both values and check them against the same table. Then a bump that keeps them consistent passes, and one that does not fails with a clear message.
2. Report bot pull requests that do not merge. A scheduled job can list open pull requests by `dependabot[bot]` and fail when one is older than N days (hive-mind uses 14), or when its body has accumulated "Dependabot is rebasing this PR" banners. Reference implementation: [`scripts/dependabot-health.lib.mjs`](https://github.com/link-assistant/hive-mind/blob/issue-4055-672ac9297a9a/scripts/dependabot-health.lib.mjs) and [`.github/workflows/dependabot-health.yml`](https://github.com/link-assistant/hive-mind/blob/issue-4055-672ac9297a9a/.github/workflows/dependabot-health.yml) (link-assistant/hive-mind#4056).
