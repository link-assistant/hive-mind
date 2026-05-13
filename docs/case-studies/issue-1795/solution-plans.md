# Solution plans — Issue #1795

## Plan adopted in PR #1796

Add an `allow_forking` probe between "no write access" and the fatal exit
in `handleAutoForkOption`, then enable fork mode when forking is allowed.

**Files changed (production code):**

- `src/solve.fork-detection.lib.mjs`
  - New helper `detectAllowForking(owner, repo)` calls
    `gh api repos/${owner}/${repo} --jq .allow_forking` via `ghCmdRetry`
    and returns `true`, `false`, or `null` (indeterminate).
  - In `handleAutoForkOption`, after the `(!isPublic)` branch detects a
    private repo with no write access, call `detectAllowForking`:
    - `false` → keep the original fatal exit with an updated message that
      mentions `allow_forking` and a tip for the owner to enable it.
    - `true` → set `argv.fork = true` and log
      `✅ Auto-fork: Read-only access to private repository, enabling fork mode (allow_forking=true)`.
    - `null` → emit a verbose warning and fall through to the
      `argv.fork = true` path so that `gh repo fork` can produce a precise
      downstream error.

**Files changed (tests):**

- `tests/test-issue-1795-private-readonly-auto-fork.mjs` — 14 unit tests
  that grep the source for the new logic plus pure-data simulations of
  every branch (private + read-only + allow_forking: `true | false | null`,
  public + read-only, write-access-on-private). All previously passing
  tests for #1716 / #1206 still pass.

### Why this preserves "everything that worked previously"

| Pre-fix path                                       | Post-fix behaviour                      |
| -------------------------------------------------- | --------------------------------------- |
| Public + no write access → `argv.fork = true`      | Unchanged.                              |
| Public + write access → bypass auto-fork           | Unchanged.                              |
| Private + write access → bypass auto-fork          | Unchanged.                              |
| Private + no write access + `allow_forking: true`  | **NEW:** `argv.fork = true`.            |
| Private + no write access + `allow_forking: false` | Fatal exit (message slightly improved). |
| Private + cannot fetch permissions at all          | Fatal exit (unchanged).                 |

### Why we did not gate the fix behind a new flag

Hive Mind's existing defaults already opt every caller into `--auto-fork`.
Adding a new opt-in flag would require contributors to discover and
explicitly request the more useful behaviour. The issue requirements
explicitly call out _"intelligently detect level of permissions, and do
everything we can with a given level of permissions"_, which is the
default-on behaviour landed here.

## Alternatives considered

1. **Try the fork unconditionally and rely on `gh repo fork` to fail.**
   Avoids the extra API call but produces a noisier and less actionable
   log; deferred in favour of the cheap `--jq .allow_forking` probe (one
   field on an endpoint we already hit elsewhere in the run).
2. **Skip fork mode entirely and just post an analysis comment on the
   issue.** This is a strictly weaker outcome — read-only callers would
   still not be able to open a PR, which is what `solve` is for. Worth
   keeping as a future enhancement (Section "Future work" below) but not
   the right primary fix.
3. **Cache the repo metadata.** The cleanest long-term fix would be a
   single `gh api repos/{owner}/{repo}` call whose JSON is shared by
   `detectRepositoryVisibility`, the existing permissions probe in
   `handleAutoForkOption`, and the new `detectAllowForking`. That refactor
   touches `github.lib.mjs` and several call sites; deliberately
   out-of-scope for this PR to keep the patch minimal and reviewable.
4. **Skip the fork attempt for organisation-owned repos.** Some orgs
   forbid private-repo forks at the org level, and `allow_forking: true`
   on the repo will still produce a `403` from `gh repo fork`. We chose to
   keep the call and let `gh repo fork` emit its real error — it is more
   informative than anything we could synthesize from the repo metadata
   alone.

## Future work

- **Read-only fallback path.** When the upstream has `allow_forking: false`
  but the caller has `pull: true`, we could still post a structured
  analysis comment on the issue instead of failing. This is a meaningful
  follow-up to R2 of the issue (do whatever is possible with the
  permissions on hand). Track in a separate issue.
- **Cached repo metadata.** Consolidate `detectRepositoryVisibility` /
  permissions / `allow_forking` into one API call (see alternative 3).
- **Org-level forking opt-out detection.** Use `gh api orgs/{org}` plus
  `members_can_fork_private_repositories` to detect the org policy
  proactively instead of waiting for `gh repo fork` to 403.
