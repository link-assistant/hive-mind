# Issue 1939 Case Study: `--isolation docker` Is Not Working

## Summary

Issue [#1939](https://github.com/link-assistant/hive-mind/issues/1939) is a
direct continuation of [#1860](https://github.com/link-assistant/hive-mind/issues/1860).
A `solve` task launched with `--isolation docker` from inside a
Docker-in-Docker (DinD) host (`konard/hive-mind-dind:2.0.2`) was supposed to
run `solve https://github.com/link-assistant/hive-mind/issues/1596` in a nested
container. The native start-command (`$`) docker backend started the container,
but the run failed and surfaced **three distinct problems**:

1. **Premature/ambiguous terminal status.** `$ --list` reported the detached
   session as `status executed` with `exitCode -1` while the container was still
   running (it had not even started `solve` yet), and the live log could not be
   followed during that window. The status was only corrected later
   (`exitCode 1`).
2. **Image re-download inside DinD.** The `konard/hive-mind-dind:2.0.2` image
   was (re)pulled inside the nested daemon instead of being passed through from
   the host that already had it.
3. **Credentials "not mounted".** The reported symptom; the _actual_ observed
   failure was `❌ Git identity not configured` — `gh` **was** authenticated
   (account `konard`), but no git `user.name`/`user.email` reached the
   container, so `solve` aborted at the system-check stage before doing any
   work.

This case study reconstructs the timeline from the captured terminal log,
enumerates every requirement in the issue, pins the root cause of each problem
to specific log evidence, and records the fixes applied in this repository plus
the upstream follow-up for the start-command (`$`) bug.

## Evidence Collected

All raw evidence lives under [`raw/`](./raw):

| File                          | What it is                                                                                                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issue-1939.json`             | Issue body, labels, metadata (`gh issue view --json`).                                                                                                                             |
| `issue-1939-body.md`          | Issue body as Markdown, including the full failure terminal log.                                                                                                                   |
| `issue-comments.json`         | Issue comments (empty at capture time).                                                                                                                                            |
| `pr-1940.json`                | The pull request that carries this fix.                                                                                                                                            |
| `failed-session-terminal.log` | **Primary evidence.** The 194-line operator terminal transcript from the failed run: the `$` invocation, two `$ --list` snapshots, the start-command log, and the `solve` failure. |
| `start-command-npm.json`      | npm registry metadata for `@link-foundation/start` (latest `0.29.0`).                                                                                                              |
| `start-command-repo.json`     | start-command repository metadata (for the upstream report).                                                                                                                       |

## Timeline

Reconstructed from the timestamps in `raw/failed-session-terminal.log` (all UTC).

| Time                | Event                                                                                                                                                                                                                | Evidence                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `01:01:54.286Z`     | Hive Mind launches the native detached docker session via `$ --isolated docker --image konard/hive-mind-dind:2.0.2 --privileged …`. Mounts requested: `.config/gh`, `.claude`, `.claude.json` — **no git identity**. | log lines 5–10, `startTime` 31 |
| `~01:02:49.543Z`    | First `$ --list` snapshot: `status executed`, `exitCode -1`, **no `containerId`** in `processIds`, and `docker ps -a` shows **no containers**. The session is reported finished although `solve` has not started.    | log lines 18–48 (`endTime` 32) |
| `01:01:54 → ~01:06` | Inside the container the dind entrypoint boots `dockerd` (fuse-overlayfs) and runs image preload/passthrough before `solve` can start.                                                                               | log lines 115–117              |
| `01:06:29.081Z`     | `solve` actually begins (`solve-2026-06-17T01-06-29-081Z.log` created) — **after** the session was already reported `executed`.                                                                                      | log line 118                   |
| `01:06:35.681Z`     | `solve` system check fails: `❌ Git identity not configured` (`user.name`/`user.email` not set).                                                                                                                     | log lines 145–169              |
| `01:06:38Z`         | Failure comment posted to issue #1596. The same log shows `gh` is authenticated: `✓ Logged in to github.com account konard`.                                                                                         | log lines 176–188              |
| `01:06:39.085Z`     | Container finishes, `Exit Code: 1`.                                                                                                                                                                                  | log lines 192–193              |
| `~01:11:38.300Z`    | Second `$ --list` snapshot: status corrected to `exitCode 1`, now with `containerId 11f9f04f…`.                                                                                                                      | log lines 63–93 (`endTime` 78) |
| `01:16:14Z`         | Issue #1939 opened by `konard`.                                                                                                                                                                                      | `issue-1939.json` `createdAt`  |

The two `$ --list` snapshots are the smoking gun for Problem 1: the same session
reports `executed/-1` (no container id, empty `docker ps -a`) and only later
`executed/1` (with the container id). The `-1` is a placeholder/sentinel exit
code recorded **before** the container's real exit code is known.

## Requirements From The Issue

The issue body sets both the concrete bug-fix scope and the meta deliverables.

**Bug-fix requirements**

- R1. Fix Problem 1: a running detached docker session must not be reported as a
  finished/failed execution (`executed` + `exitCode -1`) while its container is
  still alive, and the live log should remain followable.
- R2. Fix Problem 2: when the host already has the hive-mind image, the nested
  DinD run should reuse it (passthrough) instead of re-downloading it.
- R3. Fix Problem 3: GitHub **and** git identity credentials must reach the
  isolated container so `solve` does not abort with
  "Git identity not configured" while `gh` is authenticated.
- R4. Apply each fix across the **entire** codebase — if a problem exists in
  multiple places, fix all of them.

**Meta / process requirements**

- R5. Download all logs/data about the issue into
  `./docs/case-studies/issue-1939/`, and produce a deep case-study analysis
  (timeline, requirements, root causes, solution plans), searching online for
  additional facts, and checking for existing components/libraries.
- R6. If the data is insufficient to find the actual root cause, add debug
  output / verbose mode so the next iteration can.
- R7. If other repositories/projects are implicated, file issues there with a
  reproducible example, a workaround, and a code-level fix suggestion — in
  particular, report `$` (link-foundation/start) problems upstream.
- R8. Plan and execute everything in the single pull request #1940 on branch
  `issue-1939-f81a3d54f708`.

## Root Causes

### Root Cause 1 (Problem 3, definite): the isolation runner never mounted a git identity

The native docker invocation (log line 5) mounts only:

```
--volume /home/box/.config/gh:/home/box/.config/gh
--volume /home/box/.claude:/home/box/.claude
--volume /home/box/.claude.json:/home/box/.claude.json
```

`getDockerIsolationAuthMounts` mounted the `gh` config and the per-tool
credentials, but **not** the git identity (`~/.gitconfig` / XDG `~/.config/git`).
Inside the container `gh` was therefore fully authenticated
(`✓ Logged in to github.com account konard`, log line 176) yet `git config
user.name`/`user.email` were unset, so `solve`'s `checkGitIdentity` system check
failed immediately (log lines 145–169). "Credentials not mounted" in the issue
title is precisely this: the _git identity_ credential was missing.

Two contributing factors compound it:

- The bot **host** itself may have no `~/.gitconfig` (only `gh` auth), so even a
  correct mount has nothing to mount.
- `gh` authentication alone is not a git identity; Hive Mind already knows how to
  derive one (`gh-setup-git-identity` / `repairGitIdentity`), but that never ran
  for the isolation host.

### Root Cause 2 (Problem 1, definite, partly upstream): `-1` is a premature terminal exit-code sentinel

start-command records a detached session as terminal (`status executed`) with
`exitCode -1` before the container's real exit code is known. The first
`$ --list` snapshot (log lines 18–48) shows `executed/-1` with **no
`containerId`** and an empty `docker ps -a`; the second (lines 63–93) shows
`executed/1` **with** the container id. Hive Mind's monitor trusted the first
(terminal) status and treated `-1` as "failed", masking the still-running (and
then genuinely failing) container. The premature-status emission is an upstream
start-command bug (R7); Hive Mind must additionally not trust an ambiguous
`terminal + -1` status without cross-checking the container (R1).

### Root Cause 3 (Problem 2, environmental): missing host-image passthrough

Inside DinD the nested daemon starts empty, so an image that is not preloaded or
passed through from the host is pulled on demand. This is the host-passthrough
gap already diagnosed in [#1914](https://github.com/link-assistant/hive-mind/issues/1914)
and surfaced by `preflightDockerIsolation`. The failed run's entrypoint reports
`image preload/passthrough complete` (log line 117), so passthrough is the
intended mechanism; when it is not wired up, a re-pull is the symptom. This root
cause is primarily a deployment/entrypoint concern; Hive Mind's contribution is
to detect and report it loudly (existing preflight + new post-launch diagnostic,
R6) rather than silently re-pull.

## Online And Source Facts

- `@link-foundation/start` latest published version is `0.29.0`
  (`raw/start-command-npm.json`), the version whose native `--isolated docker`
  backend Hive Mind targets (introduced for #1914).
- start-command's detached docker mode prints
  `Container will exit automatically after command completes` and a `Live log:`
  path (log lines 110–114), confirming that the live log file is the supported
  way to follow a detached run — which is exactly what was unusable while the
  status was prematurely terminal.
- Git's own error for an empty identity, `fatal: empty ident name (for <>) not
allowed` (log line 166), matches Hive Mind's `checkGitIdentity` guard, so the
  failure is the documented identity precondition, not a transient fault.

## Solution Applied

All changes are in PR #1940 on branch `issue-1939-f81a3d54f708`.

### Git identity is mounted for every tool (R3, R4)

`getDockerIsolationAuthMounts` in `src/isolation-runner.lib.mjs` now mounts the
host git identity for **every** tool, alongside `gh`:

```js
maybeAddMount(mounts, env.GIT_CONFIG_GLOBAL || path.join(homeDir, '.gitconfig'), path.join(DOCKER_CONTAINER_HOME, '.gitconfig'), existsSync);
maybeAddMount(mounts, env.XDG_CONFIG_HOME ? path.join(env.XDG_CONFIG_HOME, 'git') : path.join(homeDir, '.config', 'git'), path.join(DOCKER_CONTAINER_HOME, '.config', 'git'), existsSync);
```

`GIT_CONFIG_GLOBAL` and `XDG_CONFIG_HOME` overrides are honored, and a missing
host identity is skipped (never invented). Because this lives in the shared
`getDockerIsolationAuthMounts`, every isolation caller inherits the fix (R4).

### Self-healing host git identity preflight (R3, R6)

`ensureHostGitIdentityForIsolation` (new, `src/isolation-runner.lib.mjs`) makes
the mount have something to mount:

- If the host already has `~/.gitconfig` (or XDG `~/.config/git`), it reports
  `present` and does nothing.
- If not, it runs the injectable repair probe (`repairGitIdentity` →
  `gh-setup-git-identity`, deriving the identity from the authenticated `gh`
  account) and re-checks.
- If still absent, it emits exactly one actionable warning naming the precise
  downstream failure ("Git identity not configured") and how to fix it.

It is wired into the telegram bot's docker-isolation preflight
(`src/telegram-bot.mjs`, right after `preflightDockerIsolation`), best-effort and
never throwing.

### Ambiguous docker terminal status is cross-checked (R1)

`src/isolation-runner.lib.mjs` adds `isUnknownDockerExitCode(exitCode)` (true for
`null`/`undefined`/`-1`) and, in `isSessionRunning`, a docker-only cross-check:
when a session is terminal **and** its exit code is unknown, it calls
`checkDockerContainerRunning` and keeps the session "running" while the container
is still alive. `src/session-monitor.lib.mjs`'s `getIsolationSessionState`
mirrors this: an ambiguous `docker` terminal status falls through to the live
cross-check instead of reporting premature completion. Non-docker backends and
real captured exit codes are unaffected.

### Verbose post-launch diagnostics (R6)

`logDockerIsolationPostLaunchDiagnostics` (verbose, best-effort) logs `$ --status`,
the container's running state, and whether the image is present locally after a
docker-isolation launch, so the next iteration can confirm Problems 1 and 2 from
data rather than inference. The mount-listing verbose block now also notes when a
git identity was propagated.

## Alternatives Considered

- **Inject `user.name`/`user.email` as `-e` env vars instead of mounting a
  gitconfig.** Rejected: it would not cover `gh`/credential-helper settings or
  signing config that a real `~/.gitconfig` carries, and it diverges from the
  existing "mount the host credential" pattern used for `gh` and tool creds.
- **Mount every credential into every container (drop per-tool scoping).**
  Rejected for the same reason as in #1860 — it over-shares secrets. Git
  identity and `gh` are genuinely tool-agnostic (every `solve`/`hive` run needs
  them), so only those two are made universal; Claude/Codex creds stay scoped.
- **Fix the premature status purely upstream in start-command.** Necessary but
  insufficient: Hive Mind cannot ship a start-command release, and it must remain
  correct against the deployed `0.29.0`. The defensive cross-check is kept and
  the upstream bug is also reported (R7).
- **Treat `exitCode -1` as success.** Rejected: `-1` is genuinely ambiguous; the
  only safe interpretation is "unknown — go ask the container", which is what the
  cross-check does.

## Regression Coverage

`tests/test-issue-1939-docker-isolation.mjs` (`@hive-mind-test-suite default`,
25 assertions) covers:

- Git identity is mounted for `claude` and `codex` tasks alongside `gh`.
- `GIT_CONFIG_GLOBAL` / `XDG_CONFIG_HOME` overrides are respected.
- A host without a git identity gets no phantom mount (the failure environment).
- `ensureHostGitIdentityForIsolation`: present / self-heal-via-repair /
  unrepairable-warns, plus `hostHasMountableGitIdentity`.
- `isUnknownDockerExitCode` for `-1`/`null`/`undefined`/`0`/`127`.
- `getIsolationSessionState` cross-check: ambiguous-but-alive stays running,
  ambiguous-and-gone completes, a real exit code is trusted without a
  cross-check, and a non-docker (screen) terminal status is unaffected.

`tests/test-issue-1860-docker-isolation.mjs` (33 assertions) continues to pass,
confirming the #1860 native-docker guarantees are intact.

## Remaining Follow-up

- **Upstream (R7):** report to `link-foundation/start` that a detached
  `--isolated docker` session is recorded as `status executed` with
  `exitCode -1` (and no `containerId`) while the container is still running, and
  that the live log is not followable during that window. Include the two
  `$ --list` snapshots from `raw/failed-session-terminal.log` as the reproducer,
  the cross-check as the workaround, and "do not record a terminal status/exit
  code until the container actually exits" as the fix suggestion.
- **Deployment (R2):** ensure the DinD host wires up image passthrough (host
  docker socket / preload) so `konard/hive-mind-dind:*` is reused, not re-pulled;
  the new verbose diagnostic confirms image presence post-launch.
