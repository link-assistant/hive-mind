## Summary

`scripts/ci/merge-dependabot.py` (run by `.github/workflows/AutoMerge.yml`) falls back to an `@dependabot rebase` comment when `DEPENDABOT_AUTO_MERGE_TOKEN` is missing or unusable. That comment is posted with `GITHUB_TOKEN`, i.e. as `github-actions[bot]`, and Dependabot only accepts commands from users with push access, so every such request is rejected:

> Sorry, only users with push access can use that command.

Because a rejected request still counts as "update already requested" only until the next merge, the script keeps posting it. On #396 it was posted five times in five days, and Dependabot rejected it three times (the other two got no reply):

| Time (UTC)          | Author              | Comment                                                  |
| ------------------- | ------------------- | -------------------------------------------------------- |
| 2026-11-09 23:10:50 | github-actions[bot] | `@dependabot rebase`                                     |
| 2026-11-09 23:10:53 | dependabot[bot]     | Sorry, only users with push access can use that command. |
| 2026-11-10 23:56:27 | github-actions[bot] | `@dependabot rebase`                                     |
| 2026-11-11 23:31:48 | github-actions[bot] | `@dependabot rebase`                                     |
| 2026-11-11 23:31:52 | dependabot[bot]     | Sorry, only users with push access can use that command. |
| 2026-11-12 23:06:26 | github-actions[bot] | `@dependabot rebase`                                     |
| 2026-11-14 06:43:12 | github-actions[bot] | `@dependabot rebase`                                     |
| 2026-11-14 06:43:15 | dependabot[bot]     | Sorry, only users with push access can use that command. |

Two consequences:

1. **Behind pull requests are never brought up to date.** The `main` ruleset "Main requires same-commit ten-language CI" requires branches to be up to date (`strict_required_status_checks_policy: true`) and has no bypass actors. So a green Dependabot pull request that falls behind (e.g. #407) can be merged neither by this workflow nor with `gh pr merge --admin` ("GraphQL: Repository rule violations found").
2. **Superseded pull requests stay open.** #396 (actions group) and #407 (`dotnet-sdk` 11.0.100 in `csharp/global.json`) are still open, although `main` already had every update they carry when #408 was opened (commit 972d864), and #409 has merged since. Dependabot does not close them, and the script does not notice.

This was found while investigating link-assistant/hive-mind#4061, where hive-mind's `/fix --update-all-dependencies` also left #396 and #407 open.

## Reproduction

1. Leave `DEPENDABOT_AUTO_MERGE_TOKEN` unset (or set an expired token, which `usable()` rejects).
2. Have two green Dependabot pull requests open. Let the workflow merge one, so the other falls behind `main`.
3. The next sweep's `plan()` returns `("rebase", pull, "behind the base branch")` for the behind one. With `pat` empty, the script runs `gh pr comment N --body "@dependabot rebase"` with `GITHUB_TOKEN`.
4. Dependabot replies "Sorry, only users with push access can use that command." The branch is not rebased.
5. After the next merge, `rebase_requested()` no longer stops the request (`elif pull.rebase_requested and not merged`), and the comment is posted again.

The code involved (`scripts/ci/merge-dependabot.py` at 84f157ed1ecc70397e55736c8833b6bf280ead87):

```python
elif pat:
    github.run("pr", "update-branch", str(pull.number), "--repo", github.repository, "--rebase", token=pat)
else:
    github.run("pr", "comment", str(pull.number), "--repo", github.repository, "--body", REBASE)
```

## Workaround

- A maintainer with push access comments `@dependabot rebase` (or `@dependabot recreate`) on the behind pull request themselves, or
- stores a working token with the `repo` and `workflow` scopes as `DEPENDABOT_AUTO_MERGE_TOKEN`, so the script uses `gh pr update-branch --rebase`, and
- closes #396 and #407 by hand, since `main` already has their updates.

## Suggested fix

1. **Never post `@dependabot rebase` with `GITHUB_TOKEN`.** Dependabot always rejects it. Without a usable token, print a `::warning::` that names the behind pull requests and the missing `DEPENDABOT_AUTO_MERGE_TOKEN` instead. Alternatively, post the comment with a token of a user who has push access.
2. **Treat a rejected request as failed.** In `rebase_requested()`, ignore a request that Dependabot answered with "only users with push access", and do not repeat a request that has already been rejected for the same head.
3. **Close superseded pull requests.** Before deciding to merge or rebase, compare the versions a Dependabot pull request sets with the ones on `main`. Close it with an explanatory comment when `main` already has the same or newer ones. This is what hive-mind now does in link-assistant/hive-mind#4062, including the `global.json` `"version"` pin of the `dotnet-sdk` ecosystem.
