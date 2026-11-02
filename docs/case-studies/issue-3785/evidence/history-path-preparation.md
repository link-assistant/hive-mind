# Storage directory preparation

The final-directory check left Claude/Codex history preparation following linked
ancestors. Agent/OpenCode checked ancestors, but their recursive `mkdir` could
still follow a parent replaced between inspection and creation. The subsequent
rejection did not undo writes into that foreign location.

`tests/issue-3785-history-path-safety.test.mjs` uses only disposable synthetic
state. Six of eight controls fail before repair: two linked-parent admissions
and four parent-replacement cases at the actual creation boundary. The two
existing Agent/OpenCode static-link refusals pass before repair.

Preparation now walks components and rejects links and non-directories. On
Linux, it opens each directory with `O_DIRECTORY | O_NOFOLLOW`, creates children
through the held parent descriptor under `/proc/self/fd`, and closes all handles
on success or failure. A parent renamed during creation cannot redirect writes
into its replacement. Every public component must still match the observed
device/inode before preparation succeeds. New directories have mode 0700;
existing permissions and state are not rewritten.

All eight controls pass afterward, together with 44 related history, XDG,
mount and asynchronous-preparation tests. Each unsafe-path control preserves a
foreign credential/history sentinel's bytes, inode and permissions and verifies
that no directory was created in the foreign target. The existing mount-split
script also passes.

The descriptor guarantee applies to Linux preparation. Other platforms retain
component checks without Linux's descriptor-based creation guarantee. The
daemon's later mount operation and a running CLI remain separate boundaries;
this helper does not attest continuous canonical storage or complete history.
The full six-tool auth/history contract remains unfinished.

```sh
node --test tests/issue-3785-history-path-safety.test.mjs \
  tests/issue-3785-claude-history-mounts.test.mjs \
  tests/issue-3785-codex-history-scopes.test.mjs \
  tests/issue-3785-xdg-data-mounts.test.mjs \
  tests/isolation-launch-async-3278.test.mjs
node tests/test-issue-2190-docker-isolation-mount-split.mjs
```
