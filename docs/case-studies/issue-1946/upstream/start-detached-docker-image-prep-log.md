# Detached docker session log omits the image-preparation phase (`docker pull` / dind boot) — `$` does not preserve the full log in one file

## Summary

When a command is launched with `--isolated docker --detached`, the session log
file (`/tmp/start-command/logs/isolation/docker/<uuid>.log`) does **not** capture
the **image-preparation phase** — the `docker pull` of the image and the
docker-in-docker daemon boot that happen before the container's command stream is
attached. The whole point of `$` is to guarantee that _every_ step that ran ends
up in one log file; this phase is silently missing.

This is a concrete continuation of #103 ("Log is not being recorded in real
time") and #89 ("better output for the virtual docker pull command"), both of
which are closed but whose symptom still reproduces on `start-command 0.29.1`.

## Environment

```
start-command version: 0.29.1
OS: linux 6.8.0-124-generic
Bun: 1.3.14
docker: 29.5.3
```

Launch (detached docker, multi-GB image):

```
$ --isolated docker --detached --session <uuid> \
  --image konard/hive-mind-dind:2.0.6 \
  solve <url> --model opus --tool claude ...
```

## Reproduction

1. Launch any detached docker session whose image is **not** already present, so a
   real `docker pull` occurs (a multi-GB image makes the window large enough to
   observe). The image pull / dind boot then runs for minutes.
2. While the pull is in progress (e.g. ~7 minutes in), upload the session log:

   ```
   $ --upload-log <uuid>
   ⏳ Uploading 546 B (🔒 private)...
   ```

   The log is **546 bytes** — only the header. None of the `docker pull`
   progress, layer extraction, or dind-entrypoint output is in the file yet.

3. After the container finally starts, `cat` the session log. It jumps straight
   from the header to:

   ```
   Command started in detached docker container: <session>
   Container ID: ...
   ...
   [dind-entrypoint] Starting dockerd (...)
   [dind-entrypoint] dockerd is ready after 1s
   [dind-entrypoint] image preload/passthrough complete
   📁 Log file: /home/box/solve-...log
   ```

   i.e. the minutes spent pulling/preparing the image left **no trace** in the
   log; the first ~7+ minutes are unaccounted for between `Timestamp:` (header)
   and the container start line.

## Expected

The session log should stream the image-preparation phase from the first byte:
the `docker pull` progress (or at least its start/finish + duration), and the
dind boot, so the single session-log file is a faithful, gap-free record of
everything that ran — which is the reason `$` exists.

## Impact

- Operators tailing `$ --upload-log` during startup see an empty/header-only log
  and cannot tell whether the run is progressing, hung, or pulling a huge image.
- The "one complete log" guarantee is broken precisely for the longest, most
  failure-prone phase of a docker run.

## Workaround

Read the host docker logs separately during the prep window:

```
docker pull <image>            # observe progress on the host
docker logs <session>          # once the container exists
```

…but this defeats the purpose of the unified `$` session log.

## Suggested fix (code level)

In the detached-docker backend, before attaching the container command stream,
tee the image-preparation output into the session log file:

1. When an image pull is required, run it with progress and append its
   stdout/stderr (or a periodic progress summary) to the session-log path
   instead of discarding it.
2. Append the dind-entrypoint boot lines to the same file as they occur (they
   already appear later — start them streaming from boot, not only once the
   container command stream attaches).
3. Write a `Preparing image <name>…` marker with a timestamp at the start of the
   prep phase and an `Image ready (<duration>)` marker at the end, so even
   without full progress the elapsed prep time is visible in the log.

## References

- start-command #103 (log not recorded in real time) — closed, symptom persists.
- start-command #89 (better output for virtual docker pull) — closed, symptom
  persists.
- Downstream report: link-assistant/hive-mind #1946 (full case study with
  evidence).

---

**Filed as:** https://github.com/link-foundation/start/issues/138
