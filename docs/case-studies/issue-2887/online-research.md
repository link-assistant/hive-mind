# Online research for issue #2887

Checked on 2026-10-10. Quotes are verbatim from the linked pages.

## 1. Exit status 126 and 127

- POSIX.1-2024, Shell Command Language, §2.8.2 "Exit Status for Commands" (https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html):
  > If the command is not found, the exit status shall be 127.
  > Otherwise, if the command name is found, but it is not an executable utility, the exit status shall be 126.
- Docker, "Running containers" → exit status (https://docs.docker.com/engine/containers/run/):
  > Exit code `126` indicates that the specified contained command can't be invoked.
  > Exit code `127` indicates that the contained command can't be found.

So exit 127 from a container started as `sh -c "<command>"` means `sh` could not find the first word of `<command>`. It does not mean a signal or an OOM. Signal deaths are reported as 128 + signal number, e.g. 137 = 128 + SIGKILL(9). That is why hive-mind's `describeCommandStartFailure` maps 126/127 to "command not executable" / "command not found". `resolveOomKilledState` already lets an exit below 128 win over Docker's `OOMKilled` flag.

Local confirmation: [`data/alias-as-binary-experiment.txt`](./data/alias-as-binary-experiment.txt). On Ubuntu `sh` is dash, and `sh -c "/codex …"` prints `sh: 1: /codex: not found` and exits 127, matching the incident's `docker logs` byte for byte.

## 2. A word beginning with `/` is a path, not a command name

POSIX §2.9.1.4 "Command Search and Execution" and §2.9.1.6 "Non-built-in Utility Execution" (same page): "If the command name contains at least one `<slash>`", the shell does not search `PATH` and executes that path directly. `/codex` is therefore looked up as the file `/codex` in the container root, which does not exist. A Telegram bot command (`/codex`) can never be a valid program name in the task image. The guard `isRunnableShellCommand` rejects exactly `^/[A-Za-z0-9_-]+$` as the first word, so real absolute paths such as `/usr/local/bin/solve` stay allowed.

## 3. Quoting a command for `sh -c`

- Python `shlex.quote` (https://docs.python.org/3/library/shlex.html):

  > Return a shell-escaped version of the string _s_. The returned value is a string that can safely be used as one token in a shell command line, for cases where you cannot use a list.

  The documented technique is POSIX single quotes, with an embedded `'` written as `'\''`. The npm package [`shell-quote`](https://www.npmjs.com/package/shell-quote) does the same for Node. hive-mind's `shellQuoteArg` implements it in a few lines, without a new dependency, and leaves "safe" tokens (URLs, flags, UUIDs) bare so the command stays readable in logs and in the PR notice.

- The old `display` string used double quotes for readability. Inside double quotes `sh` still expands `$…`, `` `…` `` and `\`, so even with the right binary, a prompt containing `$HOME` would have changed meaning. The regression test round-trips such arguments through a real `sh -c`.

## 4. `docker commit` cost in the in-place resume

Docker CLI reference (https://docs.docker.com/reference/cli/docker/container/commit/):

> It can be useful to commit a container's file changes or settings into a new image.
> By default, the container being committed and its processes will be paused while the image is committed.
> Commits do not include any data contained in mounted volumes.

start-command's in-place resume of a stopped docker execution commits the whole writable layer before running the new command. In the incident that took 10–35 minutes and 11–24 GB per task. A command that cannot start therefore wastes the most expensive step of recovery. This is why this fix:

1. validates the command before calling `$ --resume` (`no-runnable-command` → the cheap fresh-run path), and
2. on a 126/127 from the resumed container, does not try in place again but starts a fresh run with the tool's `--resume <thread>` id.

Concurrency of these commits (disk and CPU load) is tracked separately in #2889, and cleanup of leftover `start-command-resume/*` images in #2629.

## 5. Docker `OOMKilled` and exit 137 after a daemon restart

When dockerd itself is killed and restarted without `"live-restore": true` (https://docs.docker.com/engine/daemon/live-restore/), running containers are stopped. In the incident they ended with exit 137 and kept `State.OOMKilled=true` in `docker inspect`. That describes the _original_ container. A resumed container is a new container with its own `State`, and its exit (127 here) has to be classified from that state. hive-mind's log-footer scoping (`scopeRecoveryFooter`, #2498) and `resolveOomKilledState` already make sure the predecessor's footer and the sticky flag do not leak into the recovery session's report. The new test §5 covers this for exit 127. Recommending live-restore is #2900.
