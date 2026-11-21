# Case study — issue #3190: `--auto-merge` did not go through the pipeline

Issue: https://github.com/link-assistant/hive-mind/issues/3190 · PR: https://github.com/link-assistant/hive-mind/pull/3191

## Data in this folder

| File                          | What it is                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| `screenshot.png`              | Screenshot attached to the issue (Telegram `/claude … --think high --auto-merge` request)     |
| `telegram-bot.log.txt`        | Telegram bot log covering the request and the isolated `solve` launch                         |
| `solve-log-sanitized.log.txt` | Log of the **resumed** `solve` run that was uploaded to link-foundation/browser-commander#177 |

## Timeline (UTC, 2026-10-13)

| Time           | Evidence                                  | Event                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~07:09         | `telegram-bot.log.txt:94849`              | The user sends `/claude https://github.com/link-foundation/browser-commander —think high —auto-merge`. The em-dashes are normalized correctly.                                                                                                                                                                                                                                                                                     |
| 07:09          | `telegram-bot.log.txt:95153`              | The bot replies `Options: --think high --auto-merge --tool claude` with the locked options `--attach-logs --verbose --no-tool-check --disable-report-issue --isolation docker`.                                                                                                                                                                                                                                                    |
| 07:09:43       | `telegram-bot.log.txt:95160-95169`        | The isolated container runs `solve <repo> --think high --auto-merge --tool claude --attach-logs --verbose --no-tool-check --disable-report-issue --language en`. **The bot → solve hop is correct**, so `--auto-merge` IS present in the first `solve` command.                                                                                                                                                                    |
| 07:09 → ~11:12 | —                                         | The first session works on issue #176 / PR #177 and hits the Claude usage limit. `--auto-resume-on-limit-reset` (default on) waits for the reset and then relaunches `solve`.                                                                                                                                                                                                                                                      |
| 11:12:36       | `solve-log-sanitized.log.txt:10`          | Relaunched command: `solve …/issues/176 --resume 15d67d09… --auto-continue --auto-resume-on-limit-reset --auto-resume-iteration 1 --auto-resume-max-iterations 5 --previous-anthropic-cost 9.64… --session-type auto-resume --model opus --fallback-model opus-5 --verbose --attach-logs --working-directory …`. **`--think high`, `--auto-merge`, `--no-tool-check`, `--disable-report-issue` and `--language en` are all gone.** |
| 11:13:23       | `solve-log-sanitized.log.txt:512,515-516` | Because `--think` fell back to its default `off`, the run logs `--think off → --thinking-budget 0`, `MAX_THINKING_TOKENS: 0` and `CLAUDE_CODE_EFFORT_LEVEL: low`. The user had asked for `high`.                                                                                                                                                                                                                                   |
| 11:32:50       | `solve-log-sanitized.log.txt:6161-6163`   | PR #177 is converted to "ready for review". No auto-merge happens because `argv.autoMerge` is `false` in the resumed process.                                                                                                                                                                                                                                                                                                      |

## Requirements (from the issue)

1. Find out why `--auto-merge` (present in the Telegram request and in the first `solve` command) did not take effect.
2. Check the same for **all options** and **all commands**.
3. Use **universal, deduplicated** and **configurable** mechanisms to pass options through across the codebase, instead of per-option code.
4. Collect logs and data in `docs/case-studies/issue-3190`, with a timeline, requirements, root causes and solutions. Look for existing libraries.
5. Add debug output where the cause would otherwise be unclear.
6. Report upstream issues if a third-party project is at fault.

## Root cause

`autoContinueWhenLimitResets` (`src/solve.auto-continue.lib.mjs`) relaunches `solve` after a usage-limit reset. It built the child's argv from a **hand-written allowlist**:

```js
if (argv.tool && argv.tool !== 'claude') resumeArgs.push('--tool', argv.tool);
if (argv.model !== 'sonnet') resumeArgs.push('--model', argv.model);
if (argv.fallbackModel) resumeArgs.push('--fallback-model', argv.fallbackModel);
if (argv.verbose) resumeArgs.push('--verbose');
if (argv.fork) resumeArgs.push('--fork');
if (shouldAttachLogs) resumeArgs.push('--attach-logs');
```

Every other option was dropped. `solve` has 147 options in `SOLVE_OPTION_DEFINITIONS`, so `--auto-merge`, `--think`, `--language`, `--disable-report-issue`, `--no-tool-check`, `--prompt-*`, `--auto-restart-*`, `--base-branch` and the rest were all lost on the first auto-resume or auto-restart. That second hop is invisible in the Telegram UI, and the original command shown there still contains the options, so the report says the option "is present in logs".

### Secondary defects found while auditing all forwarding sites

| #   | Where                                                                        | Defect                                                                                                                                                                                                                            |
| --- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2   | `solve.auto-continue.lib.mjs`                                                | `if (argv.model !== 'sonnet')` dropped an **explicit** `--model sonnet`. When the tool's default is not sonnet (for example opus), the resumed run silently switched models.                                                      |
| 3   | `solve.auto-continue.lib.mjs`                                                | `--fallback-model` was always forwarded, which turned an _implicit_ fallback (derived from `--model`, issue #2037) into an explicit pin in the child. Incident: `--fallback-model opus-5`.                                        |
| 4   | `solve.resume-command.lib.mjs` (used by `solve.mjs` ×4 and `gemini.lib.mjs`) | The printed "resume the full solve flow" command contained only `--tool/--model/--fallback-model`, so a user copy-pasting it lost every other option as well.                                                                     |
| 5   | `github.lib.mjs` `handlePRNotFoundError`                                     | The "did you mean the issue?" suggestion used another allowlist (`--auto-continue --attach-logs --verbose --model --think --thinking-budget`). It dropped user options and added `--thinking-budget` values the user never typed. |
| 6   | `hive.config.lib.mjs`                                                        | The internal, hidden `--previous-anthropic-cost` was registered in `hive` and forwarded to every `solve` worker as `--previous-anthropic-cost 0`.                                                                                 |
| 7   | `hive.mjs`                                                                   | The definition-driven forwarding loop (issue #1209) was inline in `hive.mjs` and could not be reused elsewhere, which is how the solve relaunch ended up with its own allowlist.                                                  |

### Forwarding-site inventory (after the fix)

| Hop                                              | Mechanism                                                                       | Status                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Telegram `/solve` → `solve` (isolation/screen)   | The user's tokens are passed verbatim, plus locked options (`telegram-bot.mjs`) | Was already correct (incident log line 95169)        |
| Telegram `/hive` → `hive`                        | Tokens are passed verbatim                                                      | Was already correct                                  |
| `hive` → `solve`                                 | `buildArgsFromParsedArgv` (shared, from `SOLVE_OPTION_DEFINITIONS`)             | Moved to the shared module; internal options removed |
| `solve` → `solve` (auto-resume / auto-restart)   | `getPreservedSolveCliArgs` → `forwardRawCliArgs` (shared)                       | **Fixed (root cause)**                               |
| Printed manual resume command                    | `buildSolveResumeCommand({ extraArgs })` + `getPreservedSolveCliArgs`           | Fixed                                                |
| PR-not-found suggestion                          | `getPreservedSolveCliArgs`                                                      | Fixed                                                |
| `/fix` → `solve`                                 | `buildSolveArgs({ passthrough })` forwards the user's tokens verbatim           | Was already correct                                  |
| Killed-session resume (`session-resume.lib.mjs`) | Persisted args reused verbatim minus `--resume`                                 | Was already correct                                  |

## Solution

One generic, definition-driven module, `src/cli-option-forwarding.lib.mjs`, is used everywhere a child command is built:

- **`forwardRawCliArgs({ rawArgs, definitions, exclude })`** replays the **original command-line tokens** and drops only the options the caller sets itself. It recognizes every spelling yargs accepts: `--name`, `--camelName`, aliases (`-r`, `--worker-model`), `--no-*`/`--noCamel` negations, `--opt=value`, `true`/`false` after booleans, greedy arrays, and `--`. Unknown tokens are kept verbatim. It replays raw tokens rather than re-serializing parsed values because solve's post-parse normalization depends on which flags were literally present: explicit `--model`/`--fallback-model`/`--think`, `--plan`, `--escalate`, `--claude-file` vs `--gitkeep-file`, and so on.
- **`buildArgsFromParsedArgv({ argv, definitions, optionNames, skip })`** is the parsed-value serializer `hive` already used (issue #1209 / #1718 semantics). It is now shared, not inline.

`src/solve.forwarded-args.lib.mjs` holds the configuration, so the "configurable" part lives in data rather than in code:

- `SOLVE_RELAUNCH_STATE_OPTIONS` lists the options that describe one process's place in a relaunch chain (`--resume`, `--working-directory`, `--session-type`, `--auto-resume-iteration`, `--previous-anthropic-cost`). They are never replayed.
- `SOLVE_AUTO_RELAUNCH_CONTROLLED_OPTIONS` / `SOLVE_MANUAL_RESUME_CONTROLLED_OPTIONS` list what each call site re-sets from live state. An example is the model, which can switch to a fallback mid-run.
- Everything else is forwarded automatically, including options added in the future.

Debug output: the relaunch now logs `🧷 Preserved original options (issue #3190): …` in verbose mode, so the next incident shows directly which options were carried.

### Existing libraries considered

- [`yargs-unparser`](https://www.npmjs.com/package/yargs-unparser) ([README](https://chromium.googlesource.com/devtools/devtools-frontend/+/0611f278abe052d949540e84bd85395ea792823a/node_modules/yargs-unparser/README.md)) converts a parsed yargs `argv` back into an array, with `alias`/`default` handling. It works from parsed values, so it would forward defaults and normalized values. That breaks solve's "was this flag explicitly given?" logic described above, and it does not know which options a caller must override.
- [`dargs`](https://www.npmjs.com/package/dargs) converts an options object to CLI arguments, with include/exclude filters. It has the same parsed-value limitation and no knowledge of aliases or option types.
- [`unparse-args`](https://www.npmjs.com/package/unparse-args) is similar and minimist-oriented.

None of these handles "replay the original tokens minus a set of canonical options in all their alias spellings". That logic is small and depends on the existing option definitions, so it is implemented in-repo with no new dependency. `buildArgsFromParsedArgv` covers the `dargs`/`yargs-unparser` use case for `hive`, keeping the #1718 rule that string options with `default: false` are never forwarded as `false`.

### Upstream

No third-party project is at fault. yargs and Claude Code behaved as documented, and the options were dropped by our own relaunch code, so no upstream issue is needed.

## Verification

- `tests/test-issue-3190-option-forwarding.mjs` contains these checks:
  - It takes the exact incident argv, builds the relaunch argv the way `solve.auto-continue.lib.mjs` does, and re-parses it with solve's real `parseArguments`. It asserts `think === 'high'`, `autoMerge === true`, `toolCheck === false`, `disableReportIssue === true` and `language === 'en'`.
  - Across **two** relaunch hops, every solve option parses identically to the original, and no state option is duplicated.
  - Every one of the 149 solve options (and aliases) is forwarded unless it is caller-controlled. This guards future options.
  - Every buildSolveResumeCommand call site passes the preserved options. hive no longer forwards `--previous-anthropic-cost`.
- `tests/test-issue-1718-hive-passthrough-false.mjs` now exercises the shared serializer.
- `experiments/issue-3190-import-graph.mjs` and `experiments/issue-3190-list-aliases.mjs` are the helper scripts used during the investigation.
