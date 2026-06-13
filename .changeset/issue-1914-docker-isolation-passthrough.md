---
'@link-assistant/hive-mind': patch
---

fix(isolation): use native Docker isolation and seed the nested daemon for `--isolation docker` (#1914)

Two problems made `--isolation docker` behave wrong on the Docker-in-Docker bot
host:

1. **It wasn't real Docker isolation.** Hive Mind launched isolated tasks as
   `$ --isolated screen -- docker run …`, so `$ --status` reported
   `options / isolated screen` — a screen wrapper around a raw `docker run`, not
   the native Docker backend. Hive Mind now builds
   `$ --isolated docker --image <img> [--privileged] --shell sh … --detached --session <uuid> -- '<cmd>'`,
   so start-command owns the container lifecycle and `--status` reports real
   Docker isolation.

2. **The 30+ GB image was re-downloaded for every task.** The bot runs inside a
   DinD container whose nested `dockerd` starts with an empty image store. box
   can seed that daemon from the host (host-image passthrough), but only when the
   host Docker socket is bind-mounted — and when it isn't, passthrough is a
   *silent* no-op, so the first isolated task pulled the whole image from the
   registry. Hive Mind now runs a startup preflight (`preflightDockerIsolation`)
   that probes the nested daemon and, when the image is absent, prints the exact
   remediation (mount `/var/run/docker.sock` + set `DIND_HOST_PASSTHROUGH_IMAGES`,
   or run `scripts/preload-dind-isolation-image.mjs`). The production deploy
   script was the real root cause — its `docker run` never mounted the host
   socket — and has been fixed to pass `-v /var/run/docker.sock:…:ro` plus the
   allowlist.

Also filed the silent-passthrough footgun upstream as link-foundation/box#102
(warn when an allowlist is set but no socket is mounted) and added a deep case
study with the full reproduction, timeline, and root-cause analysis under
`docs/case-studies/issue-1914`.
