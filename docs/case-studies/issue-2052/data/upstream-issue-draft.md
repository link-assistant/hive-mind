# Upstream issue draft — configurable stop grace period for `$ --stop`

**Target:** `@link-assistant/start` (the `$` / start-command package that owns
isolation-session lifecycle, including `$ --stop <uuid>`).

## Title

`$ --stop <uuid>` should support a configurable grace period (`--time`) so a
graceful shutdown can finish before SIGKILL

## Problem

`$ --stop <uuid>` stops an isolation (docker) session by sending SIGTERM and
then, after docker's fixed default grace period (~10 s), SIGKILL. hive-mind's
interrupt handler uses that window to (1) auto-commit uncommitted changes and
(2) upload the session log to the GitHub PR. Auto-commit is fast and always
completes, but uploading a multi-MB log (Gist attach) can take several seconds
and is frequently **cut off by SIGKILL**, so the PR ends up with the commit but
no log — reported downstream as link-assistant/hive-mind#2052 ("No log uploaded
on stop").

## Reproduction

1. Start a long `$ ` isolation session that produces a large (8–13 MB) log.
2. Run `$ --stop <uuid>` while the session is running.
3. Observe the child receives SIGTERM, and ~10 s later SIGKILL (exit 137),
   interrupting any in-flight network upload started by the SIGTERM handler.

## Workaround (already applied downstream)

Do the fast, must-not-lose work (git auto-commit) **first**, before the slow
network upload, so at least the commit survives the grace window.

## Suggested fix

Forward a configurable grace period to `docker stop --time <sec>`:

```
$ --stop <uuid> --time 60
```

Default can stay at docker's 10 s; allowing callers to raise it lets a graceful
shutdown (large log upload) complete before SIGKILL. Optionally expose it via an
env var (e.g. `START_STOP_TIMEOUT`) for callers that cannot pass flags.
