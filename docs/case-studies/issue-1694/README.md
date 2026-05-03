# Issue 1694 Case Study: Make Stabilized Options Enabled by Default

## Source Artifacts

- Issue metadata: `raw-data/issue-1694.json`
- Issue comments (empty at the time of solving): `raw-data/issue-1694-comments.json`
- Related, recently-stabilized features:
  - `raw-data/issue-1373-auto-accept-invite.json` — original feature request that introduced `--auto-accept-invite`.
  - `raw-data/issue-1491-tokens-budget-stats.json` — issue that hardened `--tokens-budget-stats`.
  - `raw-data/issue-1647-auto-attach-solution-summary.json` — bug fix that made `--auto-attach-solution-summary` reliable (work-session-bounded comment scan).
  - `raw-data/issue-1545-isolation-screen.json` — root-cause fix for `--isolation screen`.
  - `raw-data/issue-1658-isolation-config.json` — bug fix that made `(--isolation screen)` accepted as a valid LINO override in Telegram configuration.

## External Research

- GNU `screen` manual: terminal session multiplexing used by `--isolation screen`, ensuring detached sessions survive Telegram bot restarts. Reference: <https://www.gnu.org/software/screen/manual/screen.html>.
- The 12-Factor App, Section III "Config" notes that defaults should match the most common operating environment so that opt-out is the rare path: <https://12factor.net/config>. This guideline supports flipping the four flags from opt-in to opt-out once they are stable.
- Yargs documentation on boolean negation (`--no-foo`): <https://github.com/yargs/yargs/blob/main/docs/tricks.md#boolean-negation>. Confirms that switching a default from `false` to `true` keeps backward compatibility because users can still pass `--no-auto-accept-invite`, `--no-tokens-budget-stats`, etc.
- Anthropic Claude Code release notes for token usage transparency that motivated `--tokens-budget-stats`: <https://docs.anthropic.com/en/docs/claude-code/overview>.

## Timeline

1. PRs delivered in late March – mid-April 2026 stabilized each of the four flags individually:
   - `--auto-accept-invite` was introduced for issue #1373 to accept the pending repo/org invite specifically for the target repository, and validated by `tests/test-auto-accept-invite-1373.mjs`.
   - `--tokens-budget-stats` was hardened by issue #1491 and is now exercised by token-budget assertions in `src/claude.lib.mjs:1320`, `src/solve.results.lib.mjs:632/644`, `src/solve.watch.lib.mjs:357`, and `src/solve.auto-merge.lib.mjs:822`.
   - `--auto-attach-solution-summary` was fixed by issues #1625 and #1647 so that the work-session boundary is used and tool-generated comments are excluded.
   - `--isolation screen` was fixed by issue #1545 (screen runner) and issue #1658 (LINO override parsing in Telegram), and is the recommended Telegram bot deployment mode now that `start-screen` and the session monitor handle screen sessions correctly.
2. After all four features stabilized, issue #1694 was filed on 2026-04-26 to flip them from opt-in to default-on for both the `solve` CLI and the `hive-telegram-bot`.

## Requirements Extracted from the Issue

The issue body lists four flags and one cross-cutting requirement:

| #   | Requirement                                                                                         | Surface                                                                                                                     |
| --- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | `--auto-accept-invite` must be enabled by default for `solve` CLI (and therefore `hive`).           | `src/solve.config.lib.mjs` (option default), `src/telegram-bot.mjs` (auto-accept pre-check before entity validation).       |
| 2   | `--tokens-budget-stats` must be enabled by default for `solve` CLI (and therefore `hive`).          | `src/solve.config.lib.mjs` (option default).                                                                                |
| 3   | `--auto-attach-solution-summary` must be enabled by default for `solve` CLI (and therefore `hive`). | `src/solve.config.lib.mjs` (option default).                                                                                |
| 4   | `--isolation screen` must be enabled by default for `hive-telegram-bot`.                            | `src/telegram-bot.mjs` (`--isolation` option default).                                                                      |
| 5   | All places (codebase + docs in **all languages**) must be updated.                                  | `docs/CONFIGURATION.{md,hi.md,ru.md,zh.md}`, `docs/FEATURES.*.md` where relevant, `docs/case-studies/issue-1694/README.md`. |

## Root Cause Analysis

The features themselves are correct; the only gap is that their defaults are still `false` (CLI flags) or empty (Telegram `--isolation`):

- `src/solve.config.lib.mjs:380` — `'tokens-budget-stats'` defaults to `false`.
- `src/solve.config.lib.mjs:465` — `'auto-attach-solution-summary'` defaults to `false`.
- `src/solve.config.lib.mjs:470` — `'auto-accept-invite'` defaults to `false`.
- `src/telegram-bot.mjs:116` — `--isolation` falls back to the `TELEGRAM_ISOLATION` env var or empty string.

`src/hive.config.lib.mjs` auto-registers solve options via `SOLVE_OPTION_DEFINITIONS`, so flipping the defaults in solve automatically propagates to `hive` and to `TELEGRAM_*_OVERRIDES` parsing.

`src/telegram-bot.mjs:967` short-circuits the auto-accept-invite pre-check on the literal flag `--auto-accept-invite`, so once the default flips to true, the pre-check must be triggered by parsed `argv` (or the absence of `--no-auto-accept-invite`) instead of by raw arg presence.

## Solution Plan

1. **Flip CLI defaults in `src/solve.config.lib.mjs`** for the three solve options. Backward compatibility is maintained through yargs' boolean-negation: users who want the old behaviour pass `--no-auto-accept-invite`, `--no-tokens-budget-stats`, or `--no-auto-attach-solution-summary`.
2. **Flip the Telegram bot isolation default** in `src/telegram-bot.mjs` from empty string to `'screen'`, while still allowing `TELEGRAM_ISOLATION` to override (including to the empty string for opt-out).
3. **Update the auto-accept-invite pre-check** in `src/telegram-bot.mjs` to honor the new default by parsing the merged args with yargs and reading `argv.autoAcceptInvite`. This keeps `--no-auto-accept-invite` as a working opt-out.
4. **Documentation parity**: update the four `docs/CONFIGURATION.{md,hi.md,ru.md,zh.md}` tables and the relevant `docs/FEATURES.*.md` references. The hive-telegram-bot section in CONFIGURATION must reflect the new `--isolation` default.
5. **Tests**: add `tests/test-issue-1694-stabilized-defaults.mjs` to lock the new defaults in `SOLVE_OPTION_DEFINITIONS`, in the merged hive parser, and in the Telegram bot's `--isolation` resolution. Existing tests (`test-telegram-bot-configuration-isolation-links-notation.mjs`, `test-solution-summary.mjs`, `test-auto-accept-invite-1373.mjs`) must keep passing.
6. **Changeset**: add a `patch`-level changeset describing the new defaults and the negation flags users can pass to opt out.

## Existing Components Considered

- **Yargs negation**: provides the opt-out path without any custom code. We rely on it for `--no-auto-accept-invite`, `--no-tokens-budget-stats`, and `--no-auto-attach-solution-summary`.
- **`SOLVE_OPTION_DEFINITIONS` auto-registration in `src/hive.config.lib.mjs`**: ensures hive picks up the new defaults without any duplicated option definitions.
- **`extractIsolationFromArgs`** (`src/telegram-isolation.lib.mjs`): the Telegram bot already extracts `--isolation` from per-command and override args; flipping the default value of `--isolation` does not require touching that helper because it only ever inspects user/override args, not the bot-level fallback.
- **`isolation-runner.lib.mjs`**: lazy-loaded when `ISOLATION_BACKEND` is non-empty. Flipping the default to `'screen'` will trigger this loader at startup, which is the same behaviour today when `TELEGRAM_ISOLATION=screen`.

## Risks & Mitigations

- **Risk**: A user who ran the bot without `screen` installed will now see startup output `🔒 Isolation mode enabled: screen (experimental)` and may hit a runtime error if `screen` is not installed. **Mitigation**: documented in the changeset and CONFIGURATION docs, with `--isolation ''` (or `TELEGRAM_ISOLATION=`) as the explicit opt-out. The change does not introduce a new failure mode — it only flips the default of an already-supported flag.
- **Risk**: `--auto-accept-invite` issues a `gh api` call up front for every solve. **Mitigation**: the call is no-op when there are no pending invites and the helper already fails gracefully if the call errors.
- **Risk**: `--tokens-budget-stats` adds a small amount of stderr/stdout output. **Mitigation**: low; the feature is stable per issue #1491 and the noise is contained to a single block per session.

## Failure Tracking Verification

- Existing tests cover the option definitions and the option behaviour: `tests/test-solution-summary.mjs`, `tests/test-auto-accept-invite-1373.mjs`, `tests/test-telegram-bot-configuration-isolation-links-notation.mjs`.
- The new `tests/test-issue-1694-stabilized-defaults.mjs` regression test asserts the four new defaults so that any future flip back to opt-in is caught immediately.
