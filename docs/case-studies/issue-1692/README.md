# Issue 1692 Case Study: Conditional auto-accept-invite hint and clearer 404 message

## Source Artifacts

- Issue metadata: `raw-data/issue-1692.json`
- Reporter screenshot: `raw-data/issue-screenshot.png`
- Solution PR snapshot: `raw-data/pr-1693.json`
- Related fix history: `raw-data/related-prs.json`
- Cross-referenced parent issue (`#1552`, introduced the validation cascade and the current message): `raw-data/issue-1552-related.json`

## External Research

- GitHub REST API documents that the `GET /repos/{owner}/{repo}` endpoint returns `404` for both _truly missing_ and _private but not visible_ repositories — there is no separate status code: <https://docs.github.com/en/rest/repos/repos#get-a-repository>.
- The same behaviour is described in GitHub's general visibility note: "GitHub returns 404 to obscure existence of private repositories you do not have access to" — see <https://docs.github.com/en/rest/overview/troubleshooting-the-rest-api#404-not-found>.
- Microcopy guidance from Nielsen Norman Group on error messages: keep them short, avoid blame, and only suggest actions the user can take ("Help users recognize, diagnose, and recover from errors", <https://www.nngroup.com/articles/error-message-guidelines/>). Suggesting a flag the user has _already passed_ violates this guidance because the suggested action is no longer available to them.
- GitHub CLI's own pattern for the same situation (`gh repo view <owner>/<repo>`) prints `Could not resolve to a Repository with the name '<owner>/<repo>'.` — short, doesn't speculate on cause: <https://cli.github.com/manual/gh_repo_view>.

These references support keeping the message short and tailoring the suggestions to the actual run‑time context (was `--auto-accept-invite` active or not).

## Timeline

1. PR #1374 (issue #1373) added `--auto-accept-invite` to `/solve` (and to the Telegram bot) so the bot can auto-accept pending repository / org invitations before any access checks.
2. PR #1553 (issue #1552) introduced `validateGitHubEntityExistence` in `src/github-entity-validation.lib.mjs`, which runs after the permission check and prints the cascade error messages (user → repo → issue/PR). The repo‑404 branch hard-codes the suggestion line `• If you were recently invited, try using --auto-accept-invite to accept pending invitations`.
3. On 2026-04-26 the maintainer ran `/solve https://github.com/medmancifra/agro-mvp/issues/1` _with_ `--auto-accept-invite` already active and saw the same suggestion echoed back, even though that flag had already been used. They filed issue #1692 and asked us to:
   - stop printing the `--auto-accept-invite` hint when the flag is already active,
   - drop the parenthetical "(GitHub returns 404 for private repos without permissions)" — it is unnecessary technical detail, and
   - rewrite the message so the headline assumes the repository may be private (since GitHub indistinguishably returns 404 for private and missing repos).

## Requirements Extracted from the Issue

The issue lists four concrete requirements:

1. **Do not suggest `--auto-accept-invite` when it is already active.** The hint is only actionable when the user has _not_ passed the flag. If they already passed it, it becomes noise / blame and may even mislead them into thinking the flag did not work.
2. **Remove the parenthetical "(GitHub returns 404 for private repos without permissions)".** The reporter calls it "not required technical details". The same fact can be conveyed by the headline ("not accessible") and the first bullet ("Repository may be private…").
3. **Re-frame the message so private‑repo access is the leading hypothesis.** Because GitHub returns the same 404 for missing and inaccessible private repos, a useful UX puts the most-actionable possibility first.
4. **Keep the message short, but cover the same ground**: private/permissions, typo in name, deletion/transfer, never‑existed.

The reporter explicitly invited a tighter wording.

## Root Cause Analysis

| Requirement                                      | Root cause                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auto-accept-invite hint shown even when flag set | `validateGitHubEntityExistence` (in `src/github-entity-validation.lib.mjs`) does not receive the `autoAcceptInvite` flag from its callers (`src/solve.mjs:293` and `src/telegram-bot.mjs:974`). The repo-404 branch hard-codes the suggestion line regardless of run‑time context.                                                                  |
| Unnecessary technical detail in the message      | The message, introduced in PR #1553, was written before we had real-world reports about how it lands. The "(GitHub returns 404 for private repos without permissions)" parenthetical is internal-developer prose; it leaks GitHub-API behaviour into the user-facing surface.                                                                       |
| Wrong leading hypothesis                         | The current first bullet is "The repository name is spelled correctly", which prioritises the rarest case (typo). The real first‑order cause for `/solve` users is missing access to a private repo — we already detected the 404 _after_ the permission check passed for the bot, so the most useful next step is "ask the owner to grant access". |
| Message length                                   | Direct consequence of the points above — once the technical parenthetical and the redundant invite‑hint are gone, the bullet list naturally shrinks.                                                                                                                                                                                                |

The single deepest root cause is **lack of context propagation**: the validation library does not know whether the caller already used `--auto-accept-invite`, so it cannot tailor the suggestion. That is fixed by adding an `autoAcceptInvite` parameter to `validateGitHubEntityExistence`, threading it through both call sites, and only emitting the invite hint when the flag is _not_ active.

## Implemented Solution

1. **`src/github-entity-validation.lib.mjs`**
   - Added `autoAcceptInvite` to the function options (defaults to `false` so existing callers still build).
   - Replaced the hard-coded message with a tighter, prioritised one:
     - Headline: `Repository '<owner>/<repo>' is not accessible.` (drops "not found or" — 404 already covers both).
     - Bullets, in order of likelihood for `/solve` users:
       1. Repository may be private — ensure the bot has been granted access.
       2. The repository name is spelled correctly.
       3. The repository has not been deleted, transferred, or never existed.
     - Appends `• If you were recently invited, try using --auto-accept-invite to accept pending invitations` _only_ when `autoAcceptInvite === false`.
   - Updated the JSDoc to document the new option.

2. **`src/solve.mjs`** (`:293`) — passes `autoAcceptInvite: argv.autoAcceptInvite` into the call.

3. **`src/telegram-bot.mjs`** (`:974`) — passes `autoAcceptInvite: args.includes('--auto-accept-invite')` so the same suppression logic applies to the Telegram surface.

4. **Tests** — `tests/test-entity-validation-1552.mjs` extended to cover both the "flag inactive ⇒ hint shown" and "flag active ⇒ hint suppressed" paths, plus the new headline and the removal of the technical parenthetical. The test harness's local mirror of the function was updated to match the production behaviour (otherwise the suite would silently drift from the real code).

No changes to `solve.config.lib.mjs` or `solve.accept-invite.lib.mjs` were required — those govern the flag itself, not the error surface.

## Considered Alternatives

- **Detect "already accepted" via the GitHub API and special-case the message.** Rejected: the validation only sees the 404, not the invite history, and a second API round-trip on the failure path is wasteful. Threading the flag from the caller is one boolean.
- **Always suppress the invite hint.** Rejected: when the user has _not_ used the flag and the repo is genuinely private behind an invite, the hint is the single most useful pointer in the whole message.
- **Two separate messages (private‑suspected vs. user‑typo).** Rejected: GitHub deliberately collapses the two cases into a single 404, so guessing harder than "may be private" risks being wrong. The bullet list lets the user pick the matching cause without us pretending to know.

## Verification

- `node tests/test-entity-validation-1552.mjs` — all assertions pass, including the two new assertions for the auto-accept-invite-suppression behaviour.
- Manual sanity check via the call sites: `argv.autoAcceptInvite` and the `args.includes('--auto-accept-invite')` plumbing match the existing flag-detection patterns in `src/solve.mjs:208` and `src/telegram-bot.mjs:967`.

## Follow-ups / Out of Scope

- This case is contained to one error message; no upstream / external project issue is warranted.
- If similar "suggest flag X" hints appear in other validation messages in the future, the same pattern (caller passes a boolean, validator suppresses) should be applied.
