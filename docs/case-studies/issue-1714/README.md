# Issue 1714 Case Study: `--auto-accept-invite` hint shown in Telegram bot even when the flag is active

## Summary

When a user invokes the Telegram bot's `/claude` (alias of `/solve`) command on a private/inaccessible repository, the bot prints:

```
❌ Repository 'xlabtg/anti-corruption' is not accessible.

💡 Please check:
• Repository may be private — ensure the bot has been granted access
• The repository name is spelled correctly
• The repository has not been deleted, transferred, or never existed
• If Hive Mind bot was recently invited, try using --auto-accept-invite to accept pending invitations
```

…even though `--auto-accept-invite` is now **default-on** (see issue #1694) and the auto-accept pre-check has already run. The hint is misleading: it suggests using a flag that is already in effect.

This is the same UX problem that issue #1692 thought it had fixed, but a regression slipped in when the default was flipped.

## Source Artifacts

- Issue metadata: `raw-data/issue-1714.json`
- Reporter screenshot of the Telegram conversation: `raw-data/screenshot.png`
- Prior related issues:
  - `raw-data/issue-1692.json` — first round of message tightening + introduction of the `autoAcceptInvite` parameter on `validateGitHubEntityExistence()` (PR #1693).
  - `raw-data/issue-1694.json` — flipped `--auto-accept-invite` (and two other options) to default-on (PR a0a25de5).
- PR snapshot for the fix being prepared: `raw-data/pr-1715.json`

## External Research

- GitHub REST API documents that `GET /repos/{owner}/{repo}` returns `404` for both _truly missing_ and _private but not visible_ repositories — there is no separate status code: <https://docs.github.com/en/rest/repos/repos#get-a-repository>.
- Yargs documentation on boolean negation: <https://github.com/yargs/yargs/blob/main/docs/tricks.md#boolean-negation>. With `default: true`, users still pass `--no-auto-accept-invite` to opt out — but **the literal string `--auto-accept-invite` will only appear in `args` if the user types it explicitly**, which is now rare.
- Nielsen Norman Group on error messages: do not suggest actions the user has already taken — that is blame, not help. <https://www.nngroup.com/articles/error-message-guidelines/>.

## Timeline

1. **2026-04-22** — PR #1693 (issue #1692) added the `autoAcceptInvite` parameter to `validateGitHubEntityExistence()` so the repo-404 message could suppress the `--auto-accept-invite` hint when the flag is active. Two call sites were updated:
   - `src/solve.mjs:293` → `autoAcceptInvite: !!argv.autoAcceptInvite` (uses parsed `argv`, default-aware).
   - `src/telegram-bot.mjs:974` → `autoAcceptInvite: args.some(a => a === '--auto-accept-invite')` (uses raw `args`, only true when the user **literally types** the flag).
   - At that point this was fine: the flag defaulted to `false`, so checking for the literal flag in `args` was equivalent to "is the flag active right now?".
2. **2026-04-26** — PR a0a25de5 (issue #1694) flipped `--auto-accept-invite` to default-on. The companion change in `src/telegram-bot.mjs` correctly migrated the auto-accept **pre-check** from `args.some(...)` to `parsedSolveArgs?.autoAcceptInvite`. **But the call to `validateGitHubEntityExistence()` two lines below it was left on the old `args.some(...)` form.** From that moment on, the literal-args check returns `false` for the now-typical default-on invocation, and the suppression silently breaks.
3. **2026-04-29** — Reporter ran `/claude https://github.com/xlabtg/anti-corruption/pull/4 —model opus` against a private repo, with the default `--auto-accept-invite` active, and got the suggestion to "try using `--auto-accept-invite`" anyway. Issue #1714 filed.

## Requirements Extracted from the Issue

The reporter's screenshot and prose imply two top-level requirements:

1. **The repo-404 hint must not suggest `--auto-accept-invite` when that flag is active**, regardless of whether the user typed it explicitly or relied on the new default. This is the same expectation set by issue #1692.
2. **Avoid silent regressions of suppression rules when defaults are flipped.** When a CLI flag's default flips from `false` to `true`, every code path that branches on "did the user pass that flag" must be re-checked — literal `args` membership is no longer a proxy for "active". This argues for using the parsed argv as the single source of truth.

The issue text additionally asks us, as in our prior case studies, to:

3. Compile data and analysis under `docs/case-studies/issue-1714/`.
4. Add debug/verbose output if it would meaningfully help on a future iteration. (See _Out of Scope_ below — there is already enough data for this fix.)
5. Open upstream issues if a third-party project is implicated. (Not applicable: the bug is fully internal.)

## Root Cause Analysis

| Symptom                                                               | Root cause                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--auto-accept-invite` suggestion shown despite the flag being active | `src/telegram-bot.mjs:970` passes `autoAcceptInvite: args.some(a => a === '--auto-accept-invite')` to `validateGitHubEntityExistence()`. After PR a0a25de5 flipped the default to `true`, the literal flag is no longer present in the typical args list, so the function receives `autoAcceptInvite=false` and re-emits the suggestion line. The pre-check **above** uses `parsedSolveArgs?.autoAcceptInvite` (correct) but the entity check **below** was missed in the same migration. Classic two-call-site oversight. |
| The same defect could recur on the next default flip                  | The fact that the bot has _two_ places that care about "is `--auto-accept-invite` active" and they read state from different sources (parsed argv vs. raw args). Any future change to the flag's surface that touches one path can again miss the other.                                                                                                                                                                                                                                                                   |

The single, deepest root cause is therefore **stale `args.some(...)` reading on a flag whose default has been flipped to `true`.** The fix is to read the same parsed-argv source the pre-check already uses.

## Proposed Solution

### Code change

`src/telegram-bot.mjs:970`:

```diff
- const entityCheck = await validateGitHubEntityExistence({ owner: validation.parsed.owner, repo: validation.parsed.repo, number: validation.parsed.number, type: validation.parsed.type, verbose: VERBOSE, autoAcceptInvite: args.some(a => a === '--auto-accept-invite') });
+ const entityCheck = await validateGitHubEntityExistence({ owner: validation.parsed.owner, repo: validation.parsed.repo, number: validation.parsed.number, type: validation.parsed.type, verbose: VERBOSE, autoAcceptInvite: !!parsedSolveArgs?.autoAcceptInvite });
```

This makes the entity-check call read the same parsed `argv` that the auto-accept pre-check above already uses (line 963). After this change:

- When the user runs `/claude <url>` (no flag, default-on path) → `parsedSolveArgs.autoAcceptInvite === true` → suggestion line **is suppressed** (correct).
- When the user runs `/claude <url> --auto-accept-invite` (explicit) → still `true` → suppressed (correct, unchanged).
- When the user runs `/claude <url> --no-auto-accept-invite` → `parsedSolveArgs.autoAcceptInvite === false` → suggestion line **is shown** (correct, the only path that should still see it).
- When parsing failed and `parsedSolveArgs` is `undefined` → `!!undefined` is `false` → suggestion line shown (safe fallback).

### Tests

`tests/test-issue-1714-auto-accept-invite-hint.mjs` (new) is a focused test that exercises the exact contract above against a fake `validateGitHubEntityExistence`-shaped function, plus a yargs round-trip for `parsedSolveArgs.autoAcceptInvite`. It covers all four cases above.

The pre-existing `tests/test-entity-validation-1552.mjs` already covers the validator-side behaviour ("flag inactive ⇒ hint shown" / "flag active ⇒ hint suppressed") — that suite is unaffected.

## Considered Alternatives

- **Make `validateGitHubEntityExistence` parse the flag itself by accepting `args`.** Rejected: the validator should not know about CLI shapes; passing a parsed boolean keeps it pure and reusable from non-CLI callers (e.g. future API surfaces).
- **Detect the flag by also checking the absence of `--no-auto-accept-invite` in `args`.** Rejected: this still re-implements yargs' negation logic in two places and will drift when more aliases or env-var defaults are added. Reading parsed argv is one boolean and impossible to drift.
- **Always suppress the invite hint everywhere.** Rejected: when the user has explicitly opted out with `--no-auto-accept-invite`, the hint is exactly the right next step and we should keep it.

## Verification

- New test: `node tests/test-issue-1714-auto-accept-invite-hint.mjs` passes.
- Existing test: `node tests/test-entity-validation-1552.mjs` still passes.
- Existing test: `node tests/test-issue-1694-stabilized-defaults.mjs` still passes (defaults unchanged).

## Out of Scope / Follow-ups

- No additional verbose tracing was needed: the code path is short and the regression was reproducible from the existing screenshot + git blame. If a future regression on the same path is harder to reproduce, we can add a `verbose && console.log(...)` in `telegram-bot.mjs` next to the call to record the resolved `autoAcceptInvite` boolean.
- No upstream / external project issue is warranted; the bug is fully internal.
- We should consider a lint rule that flags `args.some(a => a === '--<flag>')` patterns inside Telegram-bot handlers when the same flag is read from `parsedSolveArgs` nearby, to catch this drift class. Tracked informally — not part of this PR.
