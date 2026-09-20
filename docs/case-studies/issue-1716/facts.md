# Facts distilled from the failing run (`data/solution-draft-log-1716.log`)

These are the **actual values** observed in the user's failing `solve` run for
PR `xlabtg/anti-corruption#12`. They drive the test assertions and the
case-study analysis.

| Field                                          | Value                                                                           | Source line in log                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------- |
| solve version                                  | `1.58.0`                                                                        | line 20                                  |
| Input URL                                      | `https://github.com/xlabtg/anti-corruption/pull/12`                             | line 22                                  |
| Is PR URL                                      | `true`                                                                          | line 48                                  |
| `--auto-fork` enabled                          | implicit (default behaviour shown later)                                        | lines 55–59                              |
| Upstream visibility                            | `private`                                                                       | lines 57–58, 66                          |
| User permissions on upstream                   | `push: true, pull: true, triage: true, admin: false`                            | lines 56, 61                             |
| Auto-fork decision                             | _"Write access detected to private repository, working directly on repository"_ | line 59                                  |
| Auto-cleanup default                           | `true` (because private)                                                        | line 68                                  |
| PR head repository                             | `konard/anti-corruption` (a fork created when upstream was public)              | line 73 (`headRepository.nameWithOwner`) |
| Fork detected by continue-mode                 | _"🍴 Detected fork PR from konard/anti-corruption"_                             | line 74                                  |
| Fork name **constructed** by `setupRepository` | `konard/xlabtg-anti-corruption`                                                 | line 84 (`Using fork:`)                  |
| Outcome                                        | `Fork not accessible` → `Repository setup failed`                               | lines 87–92                              |
| Exit code                                      | `1`                                                                             | line 97                                  |
| Total wall-clock time                          | ~10 s (10:04:35 → 10:04:45)                                                     | lines 17, 96                             |

## Reconciliation

- The fork name `konard/xlabtg-anti-corruption` is derived in
  `src/solve.repository.lib.mjs` as `${forkOwner}/${owner}-${headRepoName}`
  where `headRepoName = forkRepoName || repo`. The actual fork is at
  `konard/anti-corruption`, so the constructed URL legitimately 404s — but the
  point of this issue is that **the constructed URL should not have been
  attempted at all**, because:
  - Upstream `xlabtg/anti-corruption` is **private** and
  - The user has **`push: true`** on it.

- The auto-fork code path **already** does the right thing
  (line 59: _"Write access detected to private repository, working directly on
  repository"_). The bug is that **continue mode** ignores that decision and
  re-introduces a fork from the PR's head repository.

## Reproducer

Without write access to a private repo this can't be reproduced end-to-end,
but the **decision logic** is fully covered by
[`tests/test-issue-1716-private-repo-skip-fork.mjs`](../../../tests/test-issue-1716-private-repo-skip-fork.mjs),
which simulates each scenario:

| Scenario                            | `isRepoPublic` | `argv.fork` | `hasWriteAccess` | Expected `skipForkForPrivateUpstream` |
| ----------------------------------- | -------------- | ----------- | ---------------- | ------------------------------------- |
| Private + write access (this issue) | `false`        | `false`     | `true`           | **`true`** (bypass fork)              |
| Public repo                         | `true`         | `false`     | `true`           | `false`                               |
| Private but explicit `--fork`       | `false`        | `true`      | `true`           | `false`                               |
| Private but no write access         | `false`        | `false`     | `false`          | `false` (auto-fork still applies)     |
