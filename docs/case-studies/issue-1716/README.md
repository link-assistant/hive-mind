# Case Study: Issue #1716 — Skip Forks for Private Upstream Repositories

**Issue:** [link-assistant/hive-mind#1716](https://github.com/link-assistant/hive-mind/issues/1716)
**Pull Request:** [#1717](https://github.com/link-assistant/hive-mind/pull/1717)
**Triggering log:** [Gist 37fecd1108eac139d3b893c7827c692a](https://gist.githubusercontent.com/konard/37fecd1108eac139d3b893c7827c692a/raw/6954ab0c86934aba6fb3a9a2b13a55fdea0d5637/3b06db69-75bb-4cbc-82b1-145606a7429a.log)
**Labels:** `bug`
**Reported by:** @konard on 2026-04-29
**Status:** Implemented in PR #1717 — `solve` now bypasses fork mode when upstream is private and the user has write access.

---

## 1. Reported observation (verbatim from the issue)

> Full log: <https://gist.githubusercontent.com/konard/37fecd1108eac139d3b893c7827c692a/raw/6954ab0c86934aba6fb3a9a2b13a55fdea0d5637/3b06db69-75bb-4cbc-82b1-145606a7429a.log>
>
> The repository may have been public, and made private. Anyway if repository private it does not matter if fork exists or not, even if it is broken.
>
> When repository is private we should always access it directly and use regular branches and pull requests without fork.

The issue then asks for the standard case-study deliverables: download the data,
reconstruct the timeline, list requirements, find root causes, propose
solutions, add verbose output if anything is missing, and file upstream issues
where applicable.

---

## 2. Source data captured for this case study

| Path                                                                     | What it is                                                                                               |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| [`data/issue-1716.json`](./data/issue-1716.json)                         | Raw GitHub issue JSON.                                                                                   |
| [`data/solution-draft-log-1716.log`](./data/solution-draft-log-1716.log) | Full failure log linked from the issue (the user's `solve` invocation against `xlabtg/anti-corruption`). |
| [`facts.md`](./facts.md)                                                 | Distilled facts from the log and codebase: who set what, which fork name was tried, why it failed.       |
| [`root-causes.md`](./root-causes.md)                                     | Per-symptom root cause with file/line citations into `src/solve.mjs`.                                    |
| [`solution-plans.md`](./solution-plans.md)                               | Plan adopted in PR #1717 plus alternatives considered.                                                   |

---

## 3. Timeline / sequence of events (from `data/solution-draft-log-1716.log`)

| Timestamp (UTC)         | Event                                                                                                                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-29 10:04:28.358 | User runs `solve https://github.com/xlabtg/anti-corruption/pull/12 --model opus --tool claude --attach-logs --verbose --no-tool-check` (v1.58.0).                                               |
| 2026-04-29 10:04:35     | URL validated as PR URL (`Is PR URL: true`).                                                                                                                                                    |
| 2026-04-29 10:04:36     | `--auto-accept-invite` finds no pending invitations.                                                                                                                                            |
| 2026-04-29 10:04:37     | `gh api repos/xlabtg/anti-corruption --jq .visibility` → `private`. `permissions.push: true`.                                                                                                   |
| 2026-04-29 10:04:38     | Auto-fork prints: _"Write access detected to private repository, working directly on repository"_ — i.e. **auto-fork itself was bypassed.**                                                     |
| 2026-04-29 10:04:39     | Repository write access confirmed (second probe).                                                                                                                                               |
| 2026-04-29 10:04:40     | Auto-cleanup defaults to `true` (private repo). Continue mode activated for PR #12.                                                                                                             |
| 2026-04-29 10:04:43     | `gh pr view 12 --json …` returns `headRepository.nameWithOwner = konard/anti-corruption` (a fork created when `xlabtg/anti-corruption` was public).                                             |
| 2026-04-29 10:04:43     | `solve.mjs` logs: _"🍴 Detected fork PR from konard/anti-corruption … Will clone fork repository for continue mode"_. `forkOwner = konard`.                                                     |
| 2026-04-29 10:04:44     | `setupRepository` builds standard fork name `konard/xlabtg-anti-corruption` (uses `${forkOwner}/${owner}-${repo}` because the fork's repo name differs from the base — a #1332-style scenario). |
| 2026-04-29 10:04:45.400 | `gh repo view konard/xlabtg-anti-corruption` → 404. **Fork not accessible.** `Repository setup failed`. Exit code `1`.                                                                          |

The fork named `konard/xlabtg-anti-corruption` does not exist; the original
fork was `konard/anti-corruption`. Either way, **none of this matters**: the
upstream `xlabtg/anti-corruption` is private and the user has `push: true` on
it. The whole fork detour is unnecessary.

---

## 4. Requirements extracted from the issue

| #   | Requirement                                                                                                                                                                       | Source phrase                                                                                                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| R1  | When the upstream repository is **private**, `solve` must operate directly on it (regular branches + PRs) and must **not** route through a fork — even if a fork was used before. | _"When repository is private we should always access it directly and use regular branches and pull requests without fork."_ |
| R2  | The bypass must hold even if the head repository of the existing PR is a fork.                                                                                                    | _"if repository private it does not matter if fork exists or not, even if it is broken."_                                   |
| R3  | Compile the case study to `./docs/case-studies/issue-1716`.                                                                                                                       | _"compile that data to `./docs/case-studies/issue-{id}` folder"_                                                            |
| R4  | If data is insufficient, add debug/verbose output for the next iteration.                                                                                                         | _"add debug output and verbose mode if not present"_                                                                        |
| R5  | If applicable, file reproducible upstream issues.                                                                                                                                 | _"If issue related to any other repository/project … please do so."_                                                        |

---

## 5. Findings at a glance

> See [`root-causes.md`](./root-causes.md) for the full analysis.

- **Root cause.** `src/solve.mjs` already special-cases `--auto-fork` for
  private repos (line ~205: _"Write access detected to private repository,
  working directly on repository"_) by setting `forkOwner = null`.
  However, the **continue-mode fork detection** runs **after** that, in two
  places — the auto-continue path
  (`prCheckData.headRepositoryOwner.login`) and the direct PR-URL path
  (`prData.headRepositoryOwner.login`). Both unconditionally set `forkOwner`
  to whatever the existing PR's head is, even when the upstream is private and
  the user has direct write access. Downstream, `setupRepository` then tries
  to clone `forkOwner/<headRepoName>`, which (a) often fails when the upstream
  was re-privated or the fork was renamed/deleted, and (b) is structurally
  wrong — fork commits cannot be pushed to a private upstream PR anyway.

- **Why the auto-fork bypass at line 205 didn't help.** That bypass only
  guards `argv.autoFork`. Continue mode populates `forkOwner` from the **PR
  data**, not from auto-fork logic, so the bypass never sees it.

- **The ~$0 fix.** Compute `skipForkForPrivateUpstream = !isRepoPublic && !argv.fork && hasWriteAccess`
  once (after the existing visibility probe), and gate **both**
  fork-from-PR-data branches behind it. When set, log a clear message and
  leave `forkOwner = null`, so the regular non-fork code path runs.

---

## 6. Solution plans (summary)

> Detailed reasoning + alternatives in [`solution-plans.md`](./solution-plans.md).

- **R1 / R2.** In `src/solve.mjs`:
  1. Move the existing `detectRepositoryVisibility(owner, repo)` call out of
     the `if (argv.autoCleanup === undefined)` block so `isRepoPublic` is
     always available (it was only evaluated in the auto-cleanup path).
  2. Compute `const skipForkForPrivateUpstream = !isRepoPublic && !argv.fork && hasWriteAccess;`.
  3. In each of the two fork-from-PR-data branches, wrap the
     `forkOwner = …; forkRepoName = …;` assignments in
     `if (skipForkForPrivateUpstream) { log "Working directly on the private upstream repository"; }
else { /* old assignment */ }`.
  4. Gate the maintainer-modify auto-toggle on `forkOwner &&` so it only
     activates when a fork is actually being used.
  5. The explicit `--fork` flag still wins (the bypass requires `!argv.fork`).
  6. The `hasWriteAccess` requirement keeps behaviour safe when the user has
     no push permission — fork mode (auto-fork) remains the documented
     fallback.

- **R3.** ✅ This folder.
- **R4.** Existing `--verbose` already prints visibility, write-access and
  fork detection. The new bypass branch adds an explicit log line so future
  runs make the decision visible without extra flags.
- **R5.** No upstream component to file against — both the GitHub CLI and
  Anthropic API behaved correctly in the failing run; the bug is entirely in
  `solve.mjs`'s fork-detection logic.

---

## 7. Implementation status (PR #1717)

The bypass is implemented in `src/solve.mjs` at the three places listed in
plan §6. Tests are in
[`tests/test-issue-1716-private-repo-skip-fork.mjs`](../../../tests/test-issue-1716-private-repo-skip-fork.mjs)
(13 tests, all passing) — they cover:

1. The flag declaration and exact condition formula.
2. `detectRepositoryVisibility` runs unconditionally (not gated on autoCleanup).
3. Both fork-detection paths consult the flag.
4. `forkOwner` stays `null` when the bypass triggers.
5. Maintainer-modify is gated by `forkOwner`.
6. Scenario simulations: private+writeAccess → bypass; public → no bypass;
   `--fork` → no bypass; no writeAccess → no bypass (auto-fork still applies).

---

## 8. Existing components / libraries reviewed

| Need                         | Already in repo                                                                                 | Verdict                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Detect repository visibility | `detectRepositoryVisibility` in [`src/github.lib.mjs`](../../../src/github.lib.mjs) (line 1389) | ✅ Reuse — already returns `{ isPublic, visibility }`. No new call. |
| Detect write access          | `checkRepositoryWritePermission` in [`src/github.lib.mjs`](../../../src/github.lib.mjs)         | ✅ `hasWriteAccess` is already computed by the auto-fork path.      |
| Bypass auto-fork on private  | Existing branch in `src/solve.mjs` around the auto-fork block.                                  | ✅ Mirror the same logic for continue-mode fork detection.          |

No new library is needed.

---

## 9. Quick reference: file:line citations

- `src/solve.mjs` (auto-fork bypass for private) — already present, around the auto-fork block: _"Write access detected to private repository, working directly on repository"_.
- `src/solve.mjs` (auto-continue PR-detection path) — `prCheckData.headRepositoryOwner.login` block, where `forkOwner` was unconditionally set.
- `src/solve.mjs` (direct PR-URL path) — `prData.headRepositoryOwner.login` block, same pattern.
- `src/solve.repository.lib.mjs:898` — emits the `Fork not accessible` error when the constructed fork URL 404s.
- `src/github.lib.mjs:1389` — `detectRepositoryVisibility(owner, repo)` returns `{ isPublic, visibility }`.
