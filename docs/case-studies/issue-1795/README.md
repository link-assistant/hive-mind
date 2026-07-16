# Case Study: Issue #1795 — `--auto-fork` failed for private repo with read-only access

**Issue:** [link-assistant/hive-mind#1795](https://github.com/link-assistant/hive-mind/issues/1795)
**Pull Request:** [#1796](https://github.com/link-assistant/hive-mind/pull/1796)
**Triggering log:** [Gist 328e969be74c1f919371156bc7ee8a20](https://gist.githubusercontent.com/konard/328e969be74c1f919371156bc7ee8a20/raw/d133a031887857578b6a237f2e88f8eb1af54700/8eaf17a7-f8f0-460e-b6eb-952ebd6b78bc.log) — see [`data/triggering-log.txt`](./data/triggering-log.txt).
**Labels:** `bug`
**Reported by:** @konard on 2026-05-12
**Status:** Fixed in PR #1796 — `handleAutoForkOption` now probes `allow_forking` before failing on a private repo with read-only access.

---

## 1. Reported observation (verbatim from the issue)

> We have access to repository, but we still get message `private repository without access`.
>
> So we have some access (github.com/konard account), may be not full access, but still have it, can we still do something using limited access? For example I can definitely see the issue, but I don't have ability to set label or assign myself (we may skip these steps, if pull request creation and so on will work with current level of permission).
>
> I think we should intelligently detect level of permissions, and do everything we can with a given level of permissions, keeping warnings in the --verbose mode for everything we don't have access to actually do.
>
> And at the same time everything that worked previously should continue to work.

---

## 2. Source data captured for this case study

| Path                                                                                             | What it is                                                                                                 |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| [`data/issue-1795.json`](./data/issue-1795.json)                                                 | Raw GitHub issue JSON.                                                                                     |
| [`data/triggering-log.txt`](./data/triggering-log.txt)                                           | Full failure log linked from the issue (`solve` invocation against `Gls-full/wildberres-bidder/issues/1`). |
| [`data/current-access-snapshot-2026-05-13.json`](./data/current-access-snapshot-2026-05-13.json) | Live re-check of the current `konard` access level after PR review feedback.                               |
| `facts.md`                                                                                       | Distilled facts from the log and codebase.                                                                 |
| `root-causes.md`                                                                                 | Per-symptom root cause with file/line citations into `src/solve.fork-detection.lib.mjs`.                   |
| `solution-plans.md`                                                                              | Plan adopted in PR #1796 plus alternatives considered.                                                     |

---

## 3. Timeline / sequence of events (from `data/triggering-log.txt`)

| Timestamp (UTC)         | Event                                                                                                                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-12 23:02:38.085 | User runs `solve https://github.com/Gls-full/wildberres-bidder/issues/1 --model opus --tool claude --attach-logs --verbose --no-tool-check --disable-report-issue --language en` (v1.69.10). |
| 2026-05-12 23:02:51.631 | URL validated as Issue URL (`Is Issue URL: true`).                                                                                                                                           |
| 2026-05-12 23:02:51.632 | `--auto-accept-invite` finds no pending invitations.                                                                                                                                         |
| 2026-05-12 23:02:52.663 | `gh api repos/Gls-full/wildberres-bidder --jq .permissions` → `{"admin":false,"maintain":false,"pull":true,"push":false,"triage":false}`.                                                    |
| 2026-05-12 23:02:53.012 | `gh api repos/Gls-full/wildberres-bidder --jq .visibility` → `private`.                                                                                                                      |
| 2026-05-12 23:02:53.016 | `handleAutoForkOption` logs `❌ --auto-fork failed: Repository is private and you don't have write access` and calls `safeExit(1, …)`.                                                       |
| 2026-05-12 23:02:53.018 | Solver prints `❌ Auto-fork failed - private repository without access` (the reason string passed to `safeExit`).                                                                            |
| 2026-05-12 23:02:53.018 | Post-failure path runs: log sanitization, comment-on-issue rendering, token masking — all of which succeed despite `push: false`.                                                            |
| 2026-05-12 23:02:55.743 | Failure comment posted to the issue (`comment id=4435534043`) — i.e. **the user does have enough access to write a comment**.                                                                |

Two facts from the log are critical:

1. The user has `pull: true`, so they can read everything in the repository and comment on issues.
2. The current code never checked whether forking was allowed; it short-circuited the entire workflow on the basis of `push: false` alone.

## 3.1 Current access re-check (2026-05-13 08:28 UTC)

After PR review feedback, the live permissions for `konard` on
`Gls-full/wildberres-bidder` were checked again. The result is captured in
[`data/current-access-snapshot-2026-05-13.json`](./data/current-access-snapshot-2026-05-13.json).

| Check                                      | Result                                                                     | Meaning for `solve`                                                             |
| ------------------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `gh api user --jq '{login:.login,id:.id}'` | `{"login":"konard","id":1431904}`                                          | The commands are authenticated as the same account mentioned in the issue.      |
| `gh repo view ... --json viewerPermission` | `viewerPermission: "READ"`                                                 | GitHub classifies the account's effective repository role as read-only.         |
| `gh api repos/... --jq .permissions`       | `{"admin":false,"maintain":false,"pull":true,"push":false,"triage":false}` | The account can read the private repo but cannot push branches to the upstream. |
| `gh api repos/... --jq .allow_forking`     | `false`                                                                    | Fork mode is currently disabled by repository or organization owner settings.   |

Conclusion: the account does have repository access, but it is **read-only**.
Hive Mind cannot use direct branch and pull request creation unless the
maintainer grants Write/Maintain/Admin access. Hive Mind also cannot use the
fork workflow while `allow_forking` is false. The corrected behavior is:

1. If `push/admin/maintain` is true, work directly in the upstream repository.
2. If direct push is unavailable but private forking is allowed, use fork mode.
3. If both direct push and forking are unavailable, stop early with a concrete
   message explaining both blockers and the maintainer actions that fix them.

---

## 4. Requirements extracted from the issue

| #   | Requirement                                                                                                                                  | Source phrase                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| R1  | Recognise that a user with read-only access still has _some_ access, and stop failing immediately on `push: false`.                          | _"We have access to repository, but we still get message `private repository without access`."_                   |
| R2  | Do as much as the available permissions allow (e.g. fork-based PR flow), and demote the rest (labels, assignments) to verbose-mode warnings. | _"intelligently detect level of permissions, and do everything we can … keeping warnings in the --verbose mode."_ |
| R3  | Preserve every existing pathway that already worked — no regressions for callers with write access or for public repositories.               | _"everything that worked previously should continue to work."_                                                    |
| R4  | Compile the case study to `./docs/case-studies/issue-1795`.                                                                                  | _"compile that data to `./docs/case-studies/issue-{id}` folder"_                                                  |
| R5  | If data is insufficient, add debug/verbose output for the next iteration.                                                                    | _"add debug output and verbose mode if not present"_                                                              |
| R6  | If the issue affects another repository, file a reproducible upstream report.                                                                | _"If issue related to any other repository/project … please do so."_                                              |
| R7  | Explain the exact current access level and maintainer action needed in beginner-friendly terms.                                              | PR review comment on 2026-05-13.                                                                                  |

R6 does not apply here: the bug is entirely in `hive-mind`'s own auto-fork
detection. No external project needs an upstream report.

---

## 5. Findings at a glance

> See [`root-causes.md`](./root-causes.md) for the full analysis.

- **Root cause.** `src/solve.fork-detection.lib.mjs:53` (pre-fix) treated
  `!isPublic` as a terminal condition: it bailed out before checking whether
  the upstream allows forking, even though `gh repo fork` works for any
  reader of a repository that has `allow_forking: true`.
- **Why the previous decision held.** Earlier iterations of the file
  assumed that without `push` access to a private repo no useful work was
  possible. That is incorrect: with `pull: true` we can still fork (when
  permitted), clone the fork, push branches to it, and open cross-repo PRs.
- **What the fix changes.** A new `detectAllowForking` helper queries
  `allow_forking` via `gh api`. When the upstream allows forking, we set
  `argv.fork = true` (exactly as we do for public repos without write
  access). When forking is explicitly disabled we still print the
  actionable error and exit. When the field can't be determined we emit a
  verbose warning and let `gh repo fork` produce a precise downstream error
  instead of pre-emptively bailing out.

---

## 6. References

- GitHub REST API — `GET /repos/{owner}/{repo}` returns `allow_forking`
  (boolean) and `visibility` (`public`/`private`/`internal`):
  <https://docs.github.com/en/rest/repos/repos#get-a-repository>.
- GitHub Docs — "Managing the forking policy for your repository" describes
  the `allow_forking` toggle:
  <https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/managing-the-forking-policy-for-your-repository>.
- GitHub Docs — "Repository roles for an organization" documents that the
  Read role can pull/fork/comment, while Write/Maintain/Admin can push to the
  assigned repository:
  <https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/repository-roles-for-an-organization>.
- Related case study: [`docs/case-studies/issue-1716`](../issue-1716) — the
  reverse situation (private upstream **with** write access should not fork).
