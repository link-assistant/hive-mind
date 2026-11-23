We hit this with a **multi-ecosystem group** (`multi-ecosystem-groups: all-dependencies`, daily, npm + github-actions + docker + docker-compose + helm). Two more symptoms come from the same flow:

1. **The `recreate` job also defers, so an obsolete group PR is never closed.** link-assistant/hive-mind#2285 bumped `@sentry/node` to 10.75.2 while the default branch already had `^11.12.0`. For 52 days every scheduled run queued `"command":"recreate"` with `"dependency-group-to-refresh":"all-dependencies"` and `"existing-group-pull-requests":[{"pr-number":2285,…}]`. Each of those jobs logged:

   ```
   INFO Starting grouped update job for link-assistant/hive-mind
   INFO Found 1 group(s).
   INFO Detected existing pull request # for the dependency group 'all-dependencies'.
   INFO Deferring creation of a new pull request. The existing pull request will update in a separate job.
   INFO Finished job processing
   ```

   It then exited green. The PR number is empty in the log line. No job ever updated or closed the PR, and no new group PR was opened.
2. **Rebase banners stack up.** Each cycle prepended another `⚠️ Dependabot is rebasing this PR ⚠️` block. The description ended with 37 copies (26.8 KB).

Also seen in the same run: the `docker_compose` job warns `Please check your configuration as there are groups where no dependencies match` when every compose service uses `build:`. We removed that entry on our side.

**Repro.** Use a multi-ecosystem group with `patterns: ['*']`. Let a group PR open, then move the default branch past the proposed versions by a manual bump. Every following scheduled run then repeats the log above.

**Workaround.** Close the group PR; the next scheduled run opens a fresh one. We also added a daily check that fails on Dependabot PRs open more than 14 days or showing more than 2 rebase banners: [`scripts/dependabot-health.lib.mjs`](https://github.com/link-assistant/hive-mind/blob/issue-4055-672ac9297a9a/scripts/dependabot-health.lib.mjs).

**Fix suggestions.**
- When the job is itself the refresh of the group PR (`updating-a-pull-request: true`, `dependency-group-to-refresh` set), it should not take the "existing PR, defer" branch.
- If none of the PR's dependencies still needs updating, close it as superseded, as single-dependency PRs already are.
- Replace the rebase banner instead of prepending a new one.
- Interpolate the PR number in the log line.
