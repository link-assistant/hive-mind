# Telegram alias recovery

The killed task's persisted `command` is `solve`; `commandAlias` is Telegram
syntax such as `claude`, `codex`, or `agent`. The resume builder previously put
`/claude` in its executable command. The in-place recovery then handed that
display string to a shell inside the snapshot container, which exited 127.

The regression tests reproduce that command mismatch and cover executable
overrides, literal shell arguments, immediate exits 126/127, cleanup errors,
one fresh fallback, and reporting on GitHub and Telegram:

```sh
node tests/issue-2630-alias-recovery.test.mjs
node tests/issue-2630-resume-startup.test.mjs
```

The first file had 10 failing tests before the fix. Its 10 tests and the
startup/reporting file's 13 tests pass after the fix.

For a real Docker reproduction using a small fixture executable:

```sh
node experiments/issue-2630/reproduce-docker-startup.mjs
```

The script commits a stopped BusyBox container containing a fixture `solve`
executable, launches the broken chat command and the fixed executable command
against derived images, checks their exits, and verifies artifact cleanup. It
runs finite commands with no network and default CPU/memory limits; it does
not launch an AI tool or reproduce OOM pressure. All fixture containers and
images are removed at the end.

This workspace's nested Docker daemon rejects resource limits because its
cgroup controllers are not delegated. The same finite fixture passed with:

```sh
node experiments/issue-2630/reproduce-docker-startup.mjs --without-resource-limits
```

[Captured Docker output](docker-reproduction.txt) shows the before/after
results. The production startup observation is limited to ten seconds. A
quick 126/127 exit triggers cleanup and a single fresh launch within the
existing recovery budget. Other exits remain with normal completion
monitoring. An unavailable Docker probe keeps the accepted replacement under
monitoring so it cannot cause a duplicate launch. Cleanup uses the returned
snapshot artifacts and never forces removal; errors identify retained
artifacts in the recovery report.
