# Cleanup discovery and deletion regression fixture

The production report is issue #2629. Before implementation,
`tests/cleanup-docker-2629.test.mjs` ran 14 focused tests: 11 failed and 3 passed.
The failures covered hidden daemon errors, resume names, retention, sizes,
non-force deletion, active/paused/restarting tasks and staging clones.
The original output is preserved locally in `reproduction-before.log`.

`discovery-before-after.mjs` extracts the baseline CLI from commit
`1675c0a575383089a7c4ba8d53b0a0def750c112` into an isolated temporary directory
and runs it and the fixed CLI against the same failing Docker fixture. It proves
the actual command changed from exit 0 with `(none detected)` after one attempt
to exit 1 with the snapshotter error after three attempts. It needs that Git
commit and installed repository dependencies; an alternate baseline ref can be
passed as its first argument.

`docker-fixture.mjs` is a finite fake Docker CLI used by
`tests/cleanup-cli-2629.test.mjs`. It supplies stopped containers, resume images,
unique bytes, persistent snapshotter errors and a restart racing with removal.
It never contacts a Docker daemon or removes host resources.

Run the regressions from the repository root:

```bash
node tests/cleanup-docker-2629.test.mjs
node tests/cleanup-cli-2629.test.mjs
node tests/test-issue-1980-docker-cleanup.mjs
node experiments/issue-2629/discovery-before-after.mjs
node experiments/issue-2629/policy-race.mjs
```

The CLI suite checks the real command through a bin symlink, uses an isolated
temporary root and XDG state directory, records all fake Docker calls, and verifies
exit status, dry-run output, environment retention policy, the successful-leak
warning, immutable container IDs, image references, private log permissions and
retention of concurrent writers. Tests clean up their own fixtures.

Large local validation logs are stored here and ignored by Git. Discovery errors
remain fatal; size measurement errors preserve discovered records and report
unknown bytes. No live Docker daemon was available in the implementation
workspace. The Docker command formats and unique image accounting were checked
against the official [Docker CLI documentation](https://github.com/docker/cli/blob/master/docs/reference/commandline/system_df.md).

Start-command's historical session log directory remains protected because
`$ --status`, `/log` and terminal watching rely on those files. Destructive
rotation of that directory and optional container worktree/log archival are
outside this fix. Existing dirty-worktree protection applies to recognized
log-upload staging clones.
