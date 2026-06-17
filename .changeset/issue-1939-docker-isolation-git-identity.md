---
'@link-assistant/hive-mind': patch
---

fix(isolation): mount git identity into docker-isolated containers and stop trusting premature terminal status (#1939)

A `solve` task launched with `--isolation docker` inside a Docker-in-Docker host
(`konard/hive-mind-dind:2.0.2`) failed at the system-check stage with
`❌ Git identity not configured`, even though `gh` was fully authenticated
(account `konard`). The captured terminal log shows the native start-command
(`$`) invocation mounting only `~/.config/gh`, `~/.claude`, and `~/.claude.json`
— **no git identity** — so `git config user.name`/`user.email` were unset inside
the container and `solve` aborted before doing any work.

Root cause: `getDockerIsolationAuthMounts` (`src/isolation-runner.lib.mjs`)
mounted `gh` and the per-tool credentials but never the git identity. `gh`
authentication is not a git identity. The fix mounts the host git identity
(`~/.gitconfig` and the XDG `~/.config/git`, honoring `GIT_CONFIG_GLOBAL` /
`XDG_CONFIG_HOME`) for **every** tool, alongside `gh`, so the fix applies to all
isolation callers at once. A new self-healing preflight,
`ensureHostGitIdentityForIsolation`, gives the mount something to mount: when the
host has no git identity it derives one from the authenticated `gh` account
(`gh-setup-git-identity` / `repairGitIdentity`) and, if that is impossible, emits
one actionable warning naming the exact downstream failure.

The same run also exposed a second problem: `$ --list` reported the detached
session as `status executed` with `exitCode -1` (and no `containerId`) while the
container was still running, masking the live container and its real exit code.
`isUnknownDockerExitCode` plus a docker-only cross-check in `isSessionRunning`
and `getIsolationSessionState` (`src/session-monitor.lib.mjs`) keep an ambiguous
`terminal + -1` docker session "running" until `docker inspect` confirms the
container has actually exited; real exit codes and non-docker backends are
unaffected. A verbose post-launch diagnostic now records `$ --status`, container
state, and local image presence so the next iteration can confirm the premature
status and the image re-pull from data.

The premature-terminal-status behaviour was reported upstream to
link-foundation/start and fixed there in `start-command@0.29.1`
(link-foundation/start#136); `Dockerfile` and `Dockerfile.dind` now pin
`start-command@0.29.1` so the fixed `$` binary ships in the images, while the
downstream cross-check stays as defense-in-depth for older hosts.

Added `tests/test-issue-1939-docker-isolation.mjs` (25 assertions) and a full
case study with timeline, root-cause analysis, and the captured logs under
`docs/case-studies/issue-1939`.
