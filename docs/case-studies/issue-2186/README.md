# Issue #2186 — the 31 GB that no disk check could see

A single 9.5 h Hive Mind task left **115 directories / 31 GB** behind in
`~/.local/share/link-assistant-agent/snapshot/`, growing at roughly **5 GB/h**,
while every disk check Hive Mind owns reported a healthy workspace.

This case study records how that was diagnosed, what was verified first-hand
before changing any version pin, and which parts of the fix belong upstream
versus here.

## 1. Why the growth was invisible

`@link-assistant/agent` keeps a rollback snapshot per _project_, where the
project id is the worktree's **root commit**, under
`$XDG_DATA_HOME/link-assistant-agent/snapshot/<project id>`, and records the
worktree it belongs to in `storage/project/<project id>.json`.

Hive Mind runs every task in a throwaway checkout, so each run looks like a
brand-new project and mints a brand-new store. Up to agent **0.26.0** that store
was a _standalone_ git object database — no `objects/info/alternates` — so it was
a full copy of the repository's objects (~270 MB each here), and nothing ever
deleted one.

Meanwhile every disk check on the Hive Mind side looked only at `/tmp`:
`disk-guard.lib.mjs` defaults to `DEFAULT_TMP_ROOT = '/tmp'`, `cleanup` walks
`['/tmp', '/var/tmp']`, and the resource snapshots reported a `statfs` reading
for `/`. Nothing in `src/` referenced `XDG_DATA_HOME` or `.local/share` at all,
so the leak was in the one place no check was looking.

## 2. Evidence: agent 0.26.1 fixes both halves upstream

Reproduced by downloading both published tarballs and comparing them, rather
than trusting a changelog — [`experiments/issue-2186/verify-agent-snapshot-fix.sh`](../../../experiments/issue-2186/verify-agent-snapshot-fix.sh),
output in [`evidence/agent-0.26.0-vs-0.26.1.log`](evidence/agent-0.26.0-vs-0.26.1.log):

- **Object sharing.** 0.26.1's `src/snapshot/index.ts` resolves the repository's
  object directory with `git rev-parse --path-format=absolute --git-path objects`
  and writes it to `objects/info/alternates`. 0.26.0 has no such file, which is
  exactly why each store was a full copy.
- **Pruning.** 0.26.1 adds `Project.prune()` (`src/project/project.ts:109`),
  called from `Project.fromDirectory()` (line 30) and `Instance.dispose()`
  (`src/project/instance.ts:61`). It keeps the newest store and anything modified
  within `recentSnapshotAge` (15 minutes). 0.26.0 has no project-level prune at
  all — its only `prune` is session compaction.

Hive Mind cannot fix an older CLI from the outside, so `src/agent.lib.mjs` grew
`MIN_AGENT_SNAPSHOT_HYGIENE_VERSION = '0.26.1'` and refuses to start on anything
older, and both images pin `@link-assistant/agent@0.26.1`.

## 3. Why Hive Mind still needs its own reclamation

The version floor stops _new_ leaks; it does not cover:

- **The disk gate runs before agent does.** `ensureDiskSpaceForWorker` decides
  whether a task may start at all, long before any agent process exists — and
  `--tool codex` / `--tool claude` tasks never run agent, so nothing ever prunes.
- **Hosts upgraded from 0.26.0 keep what they already leaked.** Upstream prune
  only removes stores it can see once it runs; the 31 GB already on disk needs
  someone to reclaim it.
- **The disk model itself was wrong.** Any check that only measures `/tmp` will
  keep mis-reporting a full disk, whatever agent does.

So `src/agent-snapshot-store.lib.mjs` implements the issue's proposed rule
directly: a store is garbage only when the worktree recorded in its project
record no longer exists (or the record is gone) **and** the store has been idle
for 15 minutes — agent's own `recentSnapshotAge`, which keeps a just-created
store from being mistaken for an orphan. A store whose worktree still exists is
never touched, so this is safe next to a concurrent session.

That rule is used from three places:

| Place                          | Behaviour                                                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/disk-guard.lib.mjs`       | Reclaims orphaned stores **before** solver workspaces when disk is low: an orphan has nothing left to restore into, a workspace may still be wanted for debugging. |
| `src/solve.repository.lib.mjs` | `cleanupAgentSnapshotStores()` runs at the end of every task, unconditionally — _not_ gated on `--auto-cleanup`.                                                   |
| `src/cleanup.mjs`              | New `hive-cleanup` category with `--dry-run` reporting and a `--no-agent-snapshots` opt-out.                                                                       |

`src/solve.resource-diagnostics.lib.mjs` now measures the store count and size
and prints them in the `📈 Resource usage` block, so `after_agent` shows this
growth instead of a flat `/` reading. The measurement is bounded
(`AGENT_SNAPSHOT_USAGE_ENTRY_LIMIT`) so sizing a 31 GB tree cannot itself become
the next incident, and the marker fields are only emitted when there is agent
state to report, so older markers keep parsing unchanged.

The rule in action, on a fixture built to look like the incident host
([`examples/agent-snapshot-reclaim-demo.mjs`](../../../examples/agent-snapshot-reclaim-demo.mjs),
output in [`evidence/reclaim-demo.log`](evidence/reclaim-demo.log)):

```
KEPT:
   live-task          worktree still exists
   just-started       modified too recently to be considered idle
WOULD REMOVE:
   crashed-task       no project record, idle
   finished-task-2    recorded worktree no longer exists
   finished-task-1    recorded worktree no longer exists
```

## 4. Evidence: Formal AI 0.345.0 is a safe bootstrap pin

The same task refreshed the rest of the stack, and the Formal AI bootstrap pin is
the one that has previously broken the image build, so it was verified the same
way — [`experiments/issue-2186/verify-formal-ai-bootstrap.sh`](../../../experiments/issue-2186/verify-formal-ai-bootstrap.sh),
output in [`evidence/formal-ai-0.339.1-vs-0.345.0.log`](evidence/formal-ai-0.339.1-vs-0.345.0.log):

- `Cargo.lock` carries **no `openssl-sys`** in either 0.339.1 or 0.345.0, so the
  builder stage keeps building on a stock `rust:slim` image (the failure mode
  from formal-ai#988).
- `rust-version = "1.96"` in both, so the pinned toolchain still satisfies it.
- The four memory-contract sources — `src/cli_memory.rs`, `src/server.rs`,
  `src/shared_memory.rs`, `src/memory/upgrade.rs` — are **byte-identical**
  between the two releases, so the `memory upgrade-status` / `memory migrate`
  contract the updater depends on is unchanged.

## 5. Regression tests

- `tests/test-issue-2186-agent-snapshot-leak.mjs` — the version floor, the
  refusal path in `validateAgentConnection`, and that both Dockerfiles pin
  exactly the version the runtime guard demands.
- `tests/test-issue-2186-agent-snapshot-reclaim.mjs` — the classification rules
  against real directories, the disk-guard and cleanup wiring, the bounded size
  measurement, and marker round-tripping.
