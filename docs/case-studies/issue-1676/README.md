# Case Study: Issue #1676 - Duplicated Error Message Choices

## Summary

Issue #1676 reported a Telegram bot validation error where the `--think` allowed values were repeated many times. The screenshot shows this command:

```text
/codex https://github.com/link-assistant/web-capture/issues/106 --think ma
```

The expected result is a short validation error showing the valid `--think` values once. The actual result listed the same choices repeatedly:

```text
Choices: "off", "low", "medium", "high", "xhigh", "max", "off", ...
```

The root cause was yargs parser state reuse. In the use-m import shape for `yargs@17.7.2`, the module object creates fresh parser instances, but `module.default` behaves like a shared singleton. Hive Mind preferred `module.default`, so each Telegram-side validation pass registered the same options again and yargs appended duplicate `choices` values to its validation message.

## Captured Evidence

| File                                               | Purpose                                      |
| -------------------------------------------------- | -------------------------------------------- |
| `data/issue-1676.json`                             | Raw issue title, body, labels, and metadata  |
| `data/issue-1676-comments.json`                    | Issue comments, empty at capture time        |
| `data/pr-1677.json`                                | Prepared PR metadata                         |
| `data/pr-1677-comments.json`                       | PR conversation comments, empty at capture   |
| `data/pr-1677-review-comments.json`                | PR inline review comments, empty at capture  |
| `data/pr-1677-reviews.json`                        | PR reviews, empty at capture                 |
| `assets/issue-screenshot.png`                      | Verified PNG screenshot from the issue       |
| `ci-logs/branch-runs.json`                         | Recent branch CI run metadata                |
| `ci-logs/checks-release-24913361582.log`           | Preserved log for the initial PR CI run      |
| `data/related-prs-yargs.json`                      | Related merged PR search results for yargs   |
| `data/related-prs-telegram-options.json`           | Related Telegram option parsing PRs          |
| `data/related-prs-think-yargs.json`                | Related `think`/yargs PR search results      |
| `data/github-code-search-parseArgsWithYargs.json`  | GitHub code search for the Telegram parser   |
| `data/github-code-search-yargsModule-default.json` | GitHub code search for the risky import form |
| `research-sources.json`                            | External source list                         |

The screenshot file starts with PNG magic bytes `89 50 4e 47 0d 0a 1a 0a`.

## Timeline

| Time                    | Event                                                                 |
| ----------------------- | --------------------------------------------------------------------- |
| 2026-04-24 21:46:05 UTC | Issue #1676 opened with a screenshot of the duplicated choices error. |
| 2026-04-24 21:46:49 UTC | Prepared branch received its placeholder commit.                      |
| 2026-04-24 21:47:00 UTC | Initial PR CI run started and completed successfully.                 |
| 2026-04-24 21:49 UTC    | Screenshot, issue data, PR data, and CI logs were preserved locally.  |
| 2026-04-24 21:50 UTC    | Local reproduction confirmed repeated yargs validation grows choices. |

## Requirements

1. Preserve issue data, logs, screenshot, related PR data, and analysis under `docs/case-studies/issue-1676/`.
2. Reconstruct the visible failure from the screenshot.
3. Identify the root cause of the duplicate validation message.
4. Search related local/GitHub work and online yargs facts.
5. Propose and implement a fix when the root cause is in this repository.
6. Add regression coverage so repeated parser validations do not repeat `--think` choices.

## Local Reproduction

The failing Telegram flow does more than one yargs parse:

1. `getFirstParsedPositionalArg()` probes the args to find the configured positional URL.
2. Later `parseArgsWithYargs()` validates the final merged args.

Before the fix, running those steps repeatedly with the use-m `.default` yargs export produced this growth:

```text
attempt 1: Choices: "off", ..., "max", "off", ..., "max"
attempt 2: Choices: "off", ..., "max", "off", ..., "max", "off", ..., "max"
attempt 3: Choices: "off", ..., "max", "off", ..., "max", "off", ..., "max", "off", ..., "max"
```

After the fix, repeated validation remains stable:

```text
Invalid values:
  Argument: think, Given: "ma", Choices: "off", "low", "medium", "high", "xhigh", "max"
```

## Related Work

- PR #1663, "Support Telegram options before URL", introduced the shared Telegram yargs parsing helper used in this failure path. It made option-before-URL commands work, but also increased the number of validation parses in one command lifecycle.
- PR #1093, "Detect malformed flag patterns like `-- model`", added early option validation and helpful parse errors.
- PR #483, "Prevent false positives in strict options validation for telegram-bot", is older related strict-yargs validation work.
- PR #1229 fixed a different duplicated options display in successful `/solve` and `/hive` responses; it was not the same root cause as this yargs `choices` duplication.

## Online Research

Yargs' official docs show the normal parser setup pattern with command/options configuration followed by `.parse(hideBin(process.argv))`. The yargs release notes show this repository's pinned version, `17.7.2`, and note that yargs 18 removed singleton usage. That supports the local finding: this project is still on yargs 17, so a singleton import path can retain option state between parser construction calls.

Sources:

- https://yargs.js.org/
- https://github.com/yargs/yargs/releases

No upstream GitHub issue was filed because the reproduced failure is caused by this repository choosing the singleton-shaped `.default` export from the use-m import instead of the fresh factory available on the module object.

## Root Cause

The affected source files loaded yargs like this:

```js
const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;
```

In this environment:

- `yargsModule([]) !== yargsModule([])`, so the module object is the fresh parser factory.
- `yargsModule.default([]) === yargsModule.default([])`, so `.default` reuses a singleton parser.

Because `createYargsConfig()` registers `SOLVE_OPTION_DEFINITIONS` each time, the singleton accumulated `choices` entries for `think`, `tool`, and other options. Yargs then printed the accumulated choices in validation errors.

## Solution

The fix adds `src/yargs-factory.lib.mjs` with `resolveYargsFactory()`. It prefers the use-m module object when it exposes yargs parser internals, and falls back to `.default` only for import shapes that do not expose that fresh factory.

The source files that dynamically import yargs now use this resolver:

- `src/solve.config.lib.mjs`
- `src/telegram-bot.mjs`
- `src/hive.mjs`
- `src/memory-check.mjs`

The regression test in `tests/test-telegram-options-before-url.mjs` covers the screenshot scenario by probing the URL first and then validating `/codex <url> --think ma`. It asserts that `"off"` and `"max"` each appear exactly once in the validation error.

## Verification

Focused checks:

```bash
node tests/test-telegram-options-before-url.mjs
```

Broader checks:

```bash
npm run lint
npm run format:check
npm test
scripts/check-file-line-limits.sh
```

Manual reproduction:

```bash
node --input-type=module
```

Using the Telegram parser helpers and `resolveYargsFactory()`, repeated parsing of `/codex https://github.com/link-assistant/web-capture/issues/106 --think ma` reports each `--think` choice once across repeated attempts.
