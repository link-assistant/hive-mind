Additional evidence from a multi-container integration using Codex 0.164.0:

- Our launcher copied a base `auth.json` into each repository's `CODEX_HOME`.
  After one task rotated its credential, the base and the next task still held
  the predecessor. Repeating preflight overwrote the first task's replacement.
  That copy/overwrite bug is in our launcher, not attributed to Codex.
- We reproduced that divergence offline with synthetic generation markers.
  The incident's real Codex log reports HTTP 401 with refresh-token reuse;
  the historical successful exchange was not captured, so the identity of
  the process that consumed the predecessor is inferred rather than observed.
- A file bind mount is not a complete replacement for the copy flow. On Linux,
  the actual 0.164.0 CLI's offline `codex logout` fails with `EBUSY` when
  `auth.json` is a bind-mount point. A directory-mounted control supports logout
  and synthetic API-key login. Host atomic replacement also leaves a file bind
  mount reading its original inode. These probes make no provider requests.

Reproduction scripts and retained structural outputs:

- [Launcher copy/overwrite probe](https://github.com/link-assistant/hive-mind/blob/issue-3785-4c28551ac612/experiments/issue-3785/probe-auth-copy.mjs)
- [Actual CLI logout/login Docker probe](https://github.com/link-assistant/hive-mind/blob/issue-3785-4c28551ac612/experiments/issue-3785/probe-codex-storage.sh)
- [Filesystem atomic-replacement probe](https://github.com/link-assistant/hive-mind/blob/issue-3785-4c28551ac612/experiments/issue-3785/probe-file-mount.sh)

Run the first with Node 24+, the other two with Docker and the installed static
Linux Codex binary. They use disposable directories, synthetic values, bounded
resources, networking disabled for the actual CLI, and cleanup traps.

The pinned [file storage implementation](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/login/src/auth/storage.rs)
places auth under `CODEX_HOME`. The
[refresh manager](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/login/src/auth.rs)
has a process-local guard and reread. A lock in an embedding launcher cannot
coordinate an unmodified second CLI process.

Suggested code-level interface: an independently selectable credential authority
with directory-level replacement/logout semantics, plus a cross-process lock
covering reread, token exchange and commit. Auth/config separation alone would
not coordinate concurrent refresh. Required conversation indexes and archives
also need explicit persistence when configuration homes are isolated.

Until there is a participating shared authority, avoid treating copied mutable
auth files, a file symlink, or a single-file bind mount as a concurrency-safe
solution. A single credential-owning broker is a possible alternative, provided
all participating clients explicitly use it. Documentation should distinguish
one-time transfer from ongoing parallel use. Existing issue #15410 already
tracks the separation request; this comment adds reproducible filesystem and
launcher evidence rather than opening another duplicate.
