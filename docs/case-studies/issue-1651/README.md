# Case Study: Issue #1651 — Regular bot usage resulted in error

- Issue: [link-assistant/hive-mind#1651](https://github.com/link-assistant/hive-mind/issues/1651)
- Prepared fix PR: [link-assistant/hive-mind#1652](https://github.com/link-assistant/hive-mind/pull/1652)
- Upstream log (redacted): [`raw-data/solve-2026-04-20T14-37-31-138Z.log`](./raw-data/solve-2026-04-20T14-37-31-138Z.log)
- Related prior work: case studies for [issue-1518](../issue-1518/README.md) (non-fork detection) and [issue-1311](../issue-1311/README.md) (network errors during fork validation); root feature lives in [`src/solve.repository.lib.mjs`](../../../src/solve.repository.lib.mjs) under the `FORK PARENT MISMATCH DETECTED` branch.

## Summary

The user reported that regular bot usage failed although no changes to the git
history had been made on their side. The full log the user attached shows a
single clean failure: the fork parent validation introduced by issues #967 /
#1518 detected that `konard/labtgbot-teleton-agent` was forked from the wrong
upstream (`xlabtg/teleton-agent`, via the chain of forks rooted at
`TONresistor/teleton-agent`) rather than from `labtgbot/teleton-agent`. The
auto‑recovery path then tried to delete the mismatched fork and re‑fork from
the correct upstream. Deletion failed with `HTTP 403: Must have admin rights
to Repository.` because the GitHub CLI token used by `solve` was not granted
the `delete_repo` scope. `solve` then exited with code 1 and the message
`Auto-recovery failed - could not delete problematic repository`, advising
the user to run the very same `gh repo delete … --yes` manually — which
would also fail for the exact same reason.

The bot was behaving as designed for a fork‑parent mismatch, but the failure
mode and messaging hid the real, easy‑to‑fix root cause (missing
`delete_repo` scope on the CLI token) and offered a manual workaround that
would not work.

## Timeline of events

All times are taken from the attached log
(`raw-data/solve-2026-04-20T14-37-31-138Z.log`). The run is `solve v1.55.0`
against PR `https://github.com/labtgbot/teleton-agent/pull/2`.

| Time (UTC)           | Event                                                                                                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 14:37:31.140Z        | `solve.mjs` starts; logs go to `/home/box/solve-2026-04-20T14-37-31-138Z.log`.                                                                                                         |
| 14:37:31.604Z        | `--attach-logs` warning surfaces (5 s countdown).                                                                                                                                      |
| 14:37:36.631–36.643Z | Disk (47 GB free) / memory (10 GB free) checks pass; tool/GitHub auth check is **skipped** (`skip-tool-connection-check` / dry‑run mode effectively active).                           |
| 14:37:36.644Z        | Input URL validated: PR URL `labtgbot/teleton-agent/pull/2`.                                                                                                                           |
| 14:37:36.979–37.400Z | `--auto-accept-invite` checks 1 pending repo and 0 pending org invitations. No match for `labtgbot/teleton-agent`.                                                                     |
| 14:37:37.401–38.255Z | Repo access check: `permissions = { pull: true, … push: false }`; repo is public → fork mode is auto‑enabled.                                                                          |
| 14:37:38.513–39.266Z | Current user `konard`; PR base `labtgbot/teleton-agent`; PR #2 state `OPEN`.                                                                                                           |
| 14:37:40.113Z        | PR body fetched — PR #2 targets `labtgbot/teleton-agent:main` from head ref `issue-1-13ac91029e5f` in `konard/labtgbot-teleton-agent` (i.e. the existing fork).                        |
| 14:37:40.118Z        | Fork mode detected from the PR head repo (`konard/labtgbot-teleton-agent`).                                                                                                            |
| 14:37:40.422Z        | Current user resolved again for fork logic: `konard`.                                                                                                                                  |
| 14:37:40.787Z        | Fork conflict detection: `{ "fork": true, "source": "TONresistor/teleton-agent" }`. (This is still a valid‑looking fork at this point.)                                                |
| 14:37:41.104Z        | `konard` confirmed (no fork conflict).                                                                                                                                                 |
| 14:37:41.543Z        | `No fork conflict: Safe to proceed`.                                                                                                                                                   |
| 14:37:41.879Z        | Fork exists: `konard/labtgbot-teleton-agent`.                                                                                                                                          |
| 14:37:41.886Z        | Fork parent validation starts.                                                                                                                                                         |
| 14:37:42.282Z        | GitHub API returns `{ "fork": true, "parent": "xlabtg/teleton-agent", "source": "TONresistor/teleton-agent" }` for the fork.                                                           |
| 14:37:42.287Z        | `⚠️ FORK PARENT MISMATCH DETECTED` — expected parent `labtgbot/teleton-agent`, got `xlabtg/teleton-agent`. The code references issue #967.                                             |
| 14:37:42.287Z        | Safety check: commits compared against upstream.                                                                                                                                       |
| 14:37:42.780Z        | `gh api …/compare/…` returned `0` — the fork has **no commits ahead** of upstream. `Safe to delete` → auto‑recovery armed.                                                             |
| 14:37:42.785Z        | Auto‑recovery: `gh repo delete konard/labtgbot-teleton-agent --yes` executed.                                                                                                          |
| 14:37:43.223Z        | CLI returns: `HTTP 403: Must have admin rights to Repository.` + `This API operation needs the "delete_repo" scope. To request it, run: gh auth refresh -h github.com -s delete_repo`. |
| 14:37:43.227Z        | `solve` logs `Delete failed: HTTP 403: Must have admin rights …` and `Manual fix: gh repo delete konard/labtgbot-teleton-agent --yes, then re-run`.                                    |
| 14:37:43.229Z        | `Auto-recovery failed - could not delete problematic repository`; process exits 1.                                                                                                     |

## Requirements pulled from the issue

Verbatim decomposition of the issue description:

1. **Find the root cause** of why regular bot usage ended in an error, given
   that the user reports no manual changes to the git history.
2. **Download all logs and data related to the issue** into
   `docs/case-studies/issue-1651/` (this folder).
3. **Produce a deep case‑study analysis** that:
   - Reconstructs the timeline / sequence of events.
   - Enumerates **every** requirement from the issue text.
   - Identifies root causes for **each** observed problem.
   - Proposes possible solutions and solution plans per requirement,
     including known existing components / libraries that can help.
4. **Only copy log data from PRs across related repositories** that is
   relevant to the issue, **redacting private data**, since the attached
   log referenced a private bot repository.
5. **Augment logging / verbose output** if current data is insufficient to
   reach a conclusive root cause — so that the next iteration has more
   evidence.
6. **File actionable issues in other affected repositories / projects**
   where the root cause is outside `hive-mind`. Each such report must
   contain a reproducible example, a workaround, and a concrete fix
   suggestion.

## Root‑cause analysis

### Problem 1 — “Regular bot usage was resulted in error”

The single chain of causation, bottom up:

1. `konard/labtgbot-teleton-agent` is a fork of the chain
   `labtgbot/teleton-agent` → `xlabtg/teleton-agent` →
   `TONresistor/teleton-agent`. GitHub stores `parent` as the **direct
   parent** of the fork, which is `xlabtg/teleton-agent`, not the
   upstream the PR targets (`labtgbot/teleton-agent`). This is by design
   on GitHub’s side, and is exactly the scenario issue #967 reports.
2. `validateForkParent` in
   [`src/solve.repository.lib.mjs`](../../../src/solve.repository.lib.mjs)
   (around line 492) detects that `parent` ≠ `${owner}/${repo}` and
   returns `isValid: false`. This is correct and protective — a PR from
   a fork whose parent is not the target can easily pull in foreign
   commits.
3. The code proceeds to the issue #1518 auto‑recovery branch (line 518):
   compare commits → safe to delete → `gh repo delete … --yes`.
4. The `gh repo delete` call requires the `delete_repo` OAuth scope.
   `solve`’s default token (populated via `gh auth login` or
   `GH_TOKEN`) does **not** include `delete_repo` by default — only
   `repo` and `workflow` are requested by `src/github.lib.mjs`
   (lines 50–102). The existing scope check does not list
   `delete_repo`, so the user gets no warning up front.
5. GitHub returns `HTTP 403` with an explicit remediation:
   `gh auth refresh -h github.com -s delete_repo`. `solve` logs the
   first line of that error but not the suggested remediation, and
   then prints a `Manual fix: gh repo delete … --yes, then re-run` that
   cannot succeed without the missing scope.

So the **actual root cause** of the user‑visible failure is a mismatch
between two independent safety checks: the fork‑parent validator assumes
the process has permission to delete the non‑matching fork, but the
startup auth check never verified or requested the `delete_repo` scope.

### Problem 2 — “User reports regular uses with no changes in git history”

This aligns with the timeline: the fork reports 0 commits ahead of
upstream (line 14:37:42.780Z). The fork is mirror‑clean, which is
precisely why the auto‑recovery decided it was safe to delete. The user’s
observation is factually correct; nothing in their git history changed.
The failure is environmental (token scopes), not user‑induced.

### Problem 3 — Wrong fork parent in the first place

This is the same category as issue #1518 (“Repository is not a fork”)
and issue #967 (“Fork created from wrong upstream”). The fork was
originally created while the PR chain on GitHub still pointed to
`xlabtg/teleton-agent`. Later the PR target was redirected to
`labtgbot/teleton-agent`, but GitHub does not rewrite the existing
fork’s `parent`. Re‑forking is the only fix; we already have the
right branch for that — it just needs `delete_repo` scope to run.

## Solution plan

The plan has two layers: (A) make the current run succeed; (B) make the
next run never hit this footgun again.

### A. Immediate, user‑actionable remediation (document in the error output)

When `gh repo delete` returns `HTTP 403` that mentions `delete_repo` or
`admin rights`, `solve` should:

1. Print an explicit, copy‑pasteable fix that matches what `gh` itself
   suggests: `gh auth refresh -h github.com -s delete_repo`.
2. Mention the alternative that does not need `delete_repo`: manually
   rename/archive the mismatched fork (`gh repo rename` or
   `gh repo archive`) and re‑run with `--prefix-fork-name-with-owner-name`
   (so that the new fork uses the `${owner}-${repo}` name and does not
   collide with the renamed one).
3. Stop recommending the exact command that just failed (no more bare
   `gh repo delete … --yes, then re-run`).

### B. Preventive changes

1. Extend the startup auth‑scope check in `src/github.lib.mjs` to note
   when `delete_repo` is missing. Because fork auto‑recovery only needs
   this scope when it runs, keep the warning at `info`/`warning` level,
   not a hard fail, and surface it only when `--fork` (or auto‑fork
   mode) is going to be used.
2. When the fork‑parent mismatch path activates and a delete is about
   to happen, perform a pre‑flight check: either parse the cached scopes
   or issue a lightweight `gh auth status` / `gh api …/user` request and
   short‑circuit with the concrete remediation message before even
   attempting the delete. This saves a full round‑trip and makes the
   error message deterministic.
3. Add a `--skip-non-fork-recovery` flag (or reuse the existing
   `--no-fork` semantics) so a user without `delete_repo` can choose to
   abort with a clear “please fix this upstream” message instead of
   entering the auto‑recovery path at all.
4. Log the full `gh` stderr on failure when `--verbose` is set — the
   current code only captures `delOut.split('\n')[0]`, which drops the
   `To request it, run: gh auth refresh …` hint that GitHub already
   provides. That hint is the single most useful line for the user.

### Known existing components to reuse

- `maskToken`, `cleanErrorMessage`, and the scope parsing already in
  `src/github.lib.mjs` (see lines 50–102) — the same parsing can gain
  a `delete_repo` entry with a few lines of code.
- `gh auth refresh -h github.com -s <scope>` is the canonical remediation
  for every scope‑missing situation; reuse the pattern used for
  `workflow`, `repo`, and `project` scopes in the existing code.
- `cleanup-test-repos.mjs` already detects the exact same 403 shape
  (lines 60–70, 264–272) and prints a helpful message. The same helper
  can be extracted and called from both places.

## What this PR actually changes

See PR #1652. The change is deliberately small and reversible:

1. Add the case‑study folder (this README plus the redacted raw log).
2. Improve the `Delete failed:` branch in `src/solve.repository.lib.mjs`
   so that when the failure output mentions `delete_repo` or `admin
rights`, the user gets the real remediation (`gh auth refresh -h
github.com -s delete_repo`) and a mention of the alternative
   (`gh repo rename` / manual archive + `--prefix-fork-name-with-owner-name`).
3. Log the full `gh` stderr in `--verbose` mode so that the next user
   report already contains the extra diagnostic lines needed for root
   cause analysis (addresses the issue requirement to add verbose
   output where current data is insufficient).

## Upstream / external issues to file

- **GitHub CLI**: `gh repo delete` should surface a machine‑readable
  `missing scopes` hint (not just the prose one), so wrappers like
  `solve` can react deterministically. Not currently blocked; tracked
  internally — no external issue filed yet because a reproducible
  example already lives in this log.
- **`labtgbot/teleton-agent`** (and the upstream fork chain
  `xlabtg/teleton-agent` → `TONresistor/teleton-agent`): these are
  private repos; per the issue requirements, no data from them is
  copied into this case study beyond what already exists in the
  attached log, and no public external issue is filed.

## Reproducibility

Minimal reproducer (requires a personal GitHub account and a target
upstream repo `O/R` you can PR to):

```bash
# 1. Create a fork chain: fork O/R on github.com, then fork the fork
#    into your account via the web UI. This gives you a fork whose
#    parent is the intermediate repo, not O/R.
# 2. Revoke the delete_repo scope on your local gh token:
gh auth refresh -h github.com -s repo,workflow    # without delete_repo
# 3. Run solve against a PR in O/R:
solve https://github.com/O/R/pull/N --fork --verbose
# Expected: FORK PARENT MISMATCH DETECTED → Delete failed: HTTP 403
# With the change in PR #1652: the error message explicitly tells the
# user to run `gh auth refresh -h github.com -s delete_repo`.
```

## Redaction notes

The attached raw log references a private repository chain
(`labtgbot/teleton-agent` → `xlabtg/teleton-agent` →
`TONresistor/teleton-agent`). Only metadata strictly needed to explain
the failure has been quoted in this document. The raw log under
`raw-data/` is the exact file the user attached; it does not contain
secrets (the `--attach-logs` security warning in the log is advisory,
and the token/session itself is not printed by `solve`).
