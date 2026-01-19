# @link-assistant/hive-mind

## 1.7.2

### Patch Changes

- e6a656f: Use `screen -R` instead of `screen -S` and `screen -r` in all docs and code for better session management. The `-R` flag ensures we open existing screen if created, and new if not yet created, making it the most safe and universal option.

## 1.7.1

### Patch Changes

- d86ba79: Prevent duplicate URLs from being added to the /solve queue (Issue #1080)
  - Added `findByUrl()` method to SolveQueue to detect existing items by URL
  - Updated /solve command handler to check for duplicates before queueing
  - Uses normalized URLs for consistent comparison
  - Returns informative error message when duplicate is detected

## 1.7.0

### Minor Changes

- 5794e2f: Add `--working-directory` / `-d` option for proper session resume

  Claude Code stores sessions per-directory path, so resuming a session in a different directory fails. This change:
  1. Adds `--working-directory` / `-d` option to solve.mjs
     - If directory exists with git repo, uses it without cloning
     - If directory exists but empty, clones into it
     - If directory doesn't exist, creates it and clones
  2. Updates `--auto-resume-on-limit-reset` to pass `--working-directory`
     - When limit resets and session auto-resumes, it uses the same directory as the original session
     - This ensures Claude Code can find and resume the session
  3. Improves resume error messaging
     - Warns when resuming without --working-directory
     - Explains that Claude Code sessions are tied to directory paths

  Example usage:

  ```bash
  ./solve.mjs "<url>" --resume <session-id> --working-directory /tmp/gh-issue-solver-123
  ```

## 1.6.3

### Patch Changes

- Fix Anthropic cost extraction from JSON stream when session has error_during_execution
  - Added anthropicTotalCostUSD to all failure return paths in executeClaudeCommand
  - Changed cost capture logic to only extract from `subtype === 'success'` results
  - This is explicit and reliable - error_during_execution results have zero cost
  - Added case study documentation for issue #1104

  Fixes #1104

  Synchronize line count checks in CI/CD
  - Add ESLint max-lines rule (1500 lines) to match CI workflow check
  - Extract handleClaudeRuntimeSwitch to claude.runtime-switch.lib.mjs
  - Reduce claude.lib.mjs from 1506 to 1354 lines
  - Add case study documentation for issue #1141

  Fixes #1141

## 1.6.2

### Patch Changes

- 4ccbbd7: Fix CLAUDE_WEEKLY_THRESHOLD not enforcing one-at-a-time mode when external Claude processes are running
  - Fixed oneAtATime mode to also consider externally running Claude processes (detected via pgrep), not just queue-internal processing
  - Standardized all threshold comparisons to use >= (inclusive) instead of mixed > and >= operators
  - Updated documentation comments to accurately reflect inclusive threshold behavior
  - Added README recommendation to capture bot logs using tee for post-incident analysis
  - Added case study documentation for issue #1133

## 1.6.1

### Patch Changes

- b07fa91: Improve /limits output format for better clarity and consistency: use 5m load average for CPU calculation (matching /solve queue), show CPU cores as "X.XX/Y CPU cores used" format consistent with RAM and Disk display

## 1.6.0

### Minor Changes

- 56d95bd: Add `--prompt-subagents-via-agent-commander` option to guide Claude to use agent-commander CLI for subagent delegation instead of native Task tool. This allows using any supported agent type (claude, opencode, codex, agent) with a unified API and saves main agent context. The prompt guidance is only included when agent-commander (start-agent) is actually installed on the system.

## 1.5.0

### Minor Changes

- 2d41edb: Add /accept_invites command to Telegram bot for automatically accepting GitHub repository and organization invitations via gh CLI

## 1.4.0

### Minor Changes

- 4a476ae: Add separate log comment for each auto-restart session with cost estimation
  - Each auto-restart iteration now uploads its own session log with cost estimation to the PR
  - Log comments use "Auto-restart X/Y Log" format instead of generic "Solution Draft Log"
  - Issue #1107

### Patch Changes

- 3239fa1: Add git identity validation to prevent commit failures
  - Added `checkGitIdentity()` and `validateGitIdentity()` functions to validate git user configuration
  - Added git identity check to `performSystemChecks()` that runs before any work begins
  - Added `--auto-gh-configuration-repair` option that uses external `gh-setup-git-identity` command for automatic repair
  - Added unit tests for identity validation

  This fix prevents the "fatal: empty ident name" error that occurs when git user.name and user.email are not configured. When git identity is missing, users now see a clear error message with instructions for fixing it. The auto-repair feature requires the external [gh-setup-git-identity](https://github.com/link-foundation/gh-setup-git-identity) package to be installed.

## 1.3.0

### Minor Changes

- a403c0e: Add --auto-gitkeep-file option to automatically fallback to .gitkeep when CLAUDE.md is in .gitignore

  This feature pre-checks if CLAUDE.md would be ignored by .gitignore BEFORE creating the file, preventing the "paths are ignored by one of your .gitignore files" error. When detected, automatically switches to .gitkeep mode. Enabled by default (--auto-gitkeep-file=true).

## 1.2.11

### Patch Changes

- 8404b75: fix: Support weekly limit date parsing in extractResetTime and parseResetTime
  - Added Pattern 0 to extractResetTime() to handle date+time formats like "resets Jan 15, 8am"
  - Updated parseResetTime() to parse date+time strings with month name and day
  - This ensures weekly limit messages are displayed with the "Usage Limit Reached" format

## 1.2.10

### Patch Changes

- 7ba1476: Auto-cleanup .playwright-mcp/ folder to prevent false auto-restart triggers
  - Add auto-cleanup of .playwright-mcp/ folder before checking uncommitted changes
  - Add --playwright-mcp-auto-cleanup option (enabled by default)
  - Use --no-playwright-mcp-auto-cleanup to disable cleanup for debugging
  - Add comprehensive case study documentation for issue #1124

## 1.2.9

### Patch Changes

- b5e047a: Fix branch checkout error showing null/null instead of actual repository URL
  - Pass owner/repo/prNumber to branch error handlers for accurate error messages
  - Add upstream remote fallback when PR branch not found in origin (handles bot PRs)
  - Add case study documentation for issue #1120

## 1.2.8

### Patch Changes

- Add case study for issue #1114 analyzing AI solver performance in hyoo-ru/mam_mol repository

  fix: Propagate --verbose flag to agent tool for debugging DecimalError issues
  - Added --verbose flag propagation to agent tool execution in agent.lib.mjs
  - Created case study documentation for DecimalError root cause analysis

## 1.2.7

### Patch Changes

- 12831a1: fix: Allow issues_list and pulls_list URLs for /hive command (Issue #1102)
  - Accept issues_list URLs (e.g., `https://github.com/owner/repo/issues`) for /hive command
  - Clean non-printable characters from URLs to prevent Markdown parsing errors
  - Escape special characters in error messages
  - Normalize issues_list URLs to base repo URLs before processing

## 1.2.6

### Patch Changes

- 94dfb13: Fix gh-upload-log argument parsing bug causing "File does not exist" error
  - Fixed bug where `gh-upload-log` received all arguments as a single concatenated string
  - The issue was caused by using `${commandArgs.join(' ')}` in command-stream template literal, which treats the entire joined string as one argument
  - Now using separate `${}` interpolations for each argument to ensure proper argument parsing
  - Also fixed: description flag is now properly passed to gh-upload-log (was only displayed, never sent)
  - Added comprehensive regression tests and case study documentation

## 1.2.5

### Patch Changes

- 65ee214: fix: Detect malformed flag patterns like "-- model" (Issue #1092)

  Added `detectMalformedFlags()` function that catches malformed command-line options and provides helpful error messages:
  - Detects "-- option" (space after --) and suggests "--option"
  - Detects "-option" (single dash for long option) and suggests "--option"
  - Detects "---option" (triple dash) and suggests "--option"
  - Integrated into both Telegram bot and CLI argument parsing
  - Added 23 comprehensive unit tests

- af950c8: fix(hive): require closing keywords for PR detection

  The `/hive` command was incorrectly skipping issues by reporting they had
  PRs when those PRs only mentioned the issues without actually solving them.

  **Root cause**: The `batchCheckPullRequestsForIssues` function used GitHub's
  `CROSS_REFERENCED_EVENT` timeline items, which are created whenever a PR
  body/title/commit mentions an issue number - regardless of whether the PR
  actually solves the issue.

  **Example**: PR #369 in VisageDvachevsky/StoryGraph is an audit PR that
  created 28 new issues (#370-#397) and listed them in a table. This caused
  GitHub to create cross-reference events linking that PR to all 28 issues,
  but PR #369 only actually fixes #368.

  **Solution**:
  - Add `prClosesIssue()` function to detect GitHub closing keywords
    (fixes, closes, resolves - case-insensitive)
  - Update GraphQL query to include PR body text
  - Only count PRs that contain "fixes #N", "closes #N", or "resolves #N"
    for the specific issue number
  - Add verbose logging when PRs are skipped for only mentioning issues

  This aligns with GitHub's own auto-close behavior where only specific
  keywords trigger issue closure when a PR is merged.

  Fixes #1094

- 0d997ac: fix(telegram-bot): stop solve queue on SIGINT/SIGTERM for clean exit

  The telegram bot was hanging after pressing Ctrl+C because the SolveQueue
  consumer loop kept running with active timers that prevented the Node.js
  event loop from emptying.
  - **Root cause identified**: The SIGINT/SIGTERM handlers only called
    `bot.stop()` (Telegraf) but did not stop the SolveQueue, whose `sleep()`
    timers kept the event loop alive.
  - **Solution**: Added `solveQueue.stop()` call in both SIGINT and SIGTERM
    handlers to stop the consumer loop before calling `bot.stop()`.
  - **Added verbose logging**: When running with `--verbose`, the bot now
    logs "Solve queue stopped" during shutdown.
  - **Case study documentation**: Added detailed analysis in
    `docs/case-studies/issue-1083/` with timeline, root cause investigation,
    and evidence collection.

  Fixes #1083

## 1.2.4

### Patch Changes

- 14ea4b6: Add validation for LINO configuration to detect invalid input
  - Add validation in `lenv-reader.lib.mjs` to reject multiple values on the same line (e.g., `--option1  --option2`)
  - Add validation to reject unrecognized characters in command-line options (e.g., `?`, `@`, `!`)
  - Errors include clear messages showing the problematic value and instructions for correction
  - Valid option characters: letters, numbers, hyphens, underscores, equals signs
  - Add comprehensive unit tests for LINO parsing logic (`test-lino.mjs`)
  - Add validation tests to lenv-reader test suite (`test-lenv-reader.mjs`)
  - Add lino tests to CI/CD workflow

  This approach helps users identify and correct configuration errors early, rather than silently dropping invalid options.

  Fixes #1086

## 1.2.3

### Patch Changes

- 5411e77: Fix gh-upload-log command invocation error caused by empty string argument
  - Fixed bug where `gh-upload-log` failed with "Unknown argument: ''" when verbose=false
  - The issue was caused by template literal interpolation `${verbose ? '--verbose' : ''}` passing empty string as an argument
  - Now using array-based command building to avoid empty arguments
  - Added improved handling for `error_during_execution` result subtype from Claude CLI
  - Added tests for log upload command construction to prevent regression

## 1.2.2

### Patch Changes

- db84104: Remove QEMU from CI/CD entirely
  - Remove unnecessary QEMU and Docker Buildx setup from docker-pr-check job
  - The PR check only builds for linux/amd64, so QEMU was never needed
  - docker-publish jobs already use native ARM64 runners (ubuntu-24.04-arm)
  - This addresses feedback to remove QEMU from CI/CD to avoid slowdowns and freezes

## 1.2.1

### Patch Changes

- 04cb3d2: Fix false positives in token masking for log sanitization
  - Remove overly broad regex pattern that was matching legitimate identifiers like `browser_take_screenshot` and MCP tool names
  - Add allowlist of safe token patterns (browser\_, mcp\_\_, function names with underscores, UUIDs)
  - Add context-aware detection for 40-char hex strings to avoid masking git commit hashes and gist IDs
  - Export new helper functions `isSafeToken` and `isHexInSafeContext` for testing
  - Add comprehensive unit tests for false positive prevention

## 1.2.0

### Minor Changes

- Add experimental --execute-tool-with-bun option to improve speed and memory usage

  This feature adds the `--execute-tool-with-bun` option that allows users to execute the AI tool using `bunx claude` instead of `claude`, which may provide performance benefits in terms of speed and memory usage.

  **Supported commands:**
  - `solve` - Uses `bunx claude` when option is enabled
  - `task` - Uses `bunx claude` when option is enabled
  - `review` - Uses `bunx claude` when option is enabled
  - `hive` - Passes the option through to the `solve` subprocess

  **How It Works:**
  When `--execute-tool-with-bun` is enabled, the `claudePath` variable is set to `'bunx claude'` instead of `'claude'` (or `CLAUDE_PATH` environment variable).

  **Usage Examples:**

  ```bash
  # Use with solve command
  solve https://github.com/owner/repo/issues/123 --execute-tool-with-bun

  # Use with task command
  task "implement feature X" --execute-tool-with-bun

  # Use with review command
  review https://github.com/owner/repo/pull/456 --execute-tool-with-bun

  # Use with hive command (passes through to solve)
  hive https://github.com/owner/repo --execute-tool-with-bun
  ```

  The option defaults to `false` to maintain backward compatibility.

  Fixes #812

  feat(hive): recheck issue conditions before processing queue items

  Added `recheckIssueConditions()` function to validate issue state right before processing,
  preventing wasted resources on issues that should be skipped due to changed conditions since queuing.

  **Checks performed:**
  - **Issue state**: Verifies the issue is still open
  - **Open PRs**: Checks if issue has PRs (when `--skip-issues-with-prs` is enabled)
  - **Repository status**: Confirms repository is not archived

  **Benefits:**
  - Prevents processing closed issues
  - Avoids duplicate work when PRs already exist
  - Stops work on newly archived repositories
  - Saves AI model tokens and compute resources

  **Performance impact:**
  Minimal overhead per issue (~300-500ms for API calls), negligible compared to 5-15 minute solve time.

  Fixes #810

## 1.1.0

### Minor Changes

- 4c46685: Add --enable-workspaces option for separate workspace directories

  This feature adds support for creating separate workspace directories for all AI tools (claude, opencode, codex, agent). When enabled with `--enable-workspaces`, the tool creates a structured workspace:
  - `/tmp/hive-mind-solve-gh-{owner}/{repo}-issue-{issueNumber}-workspace-{timestamp}/repository` - for the cloned repo
  - `/tmp/hive-mind-solve-gh-{owner}/{repo}-issue-{issueNumber}-workspace-{timestamp}/tmp` - for temp files, logs, downloads

  The workspace tmp directory is passed to all tool prompts, with explicit examples for saving CI logs, diffs, and command outputs.

- Add relative time display for usage limit reset messages in GitHub comments

  When the AI tool hits its usage limit, GitHub comments now show the reset time in a more user-friendly format:
  - Before: `11:00 PM`
  - After: `in 1h 23m (11:00 PM UTC)`

  This helps users in different timezones understand when the limit will reset more quickly.

## 1.0.5

### Patch Changes

- a68a9f2: fix(queue): simplify queue logic based on PR feedback
  - **Use 5-minute load average for CPU**: Uses `loadAvg5` instead of instantaneous CPU usage,
    providing a more stable metric not affected by transient spikes during claude startup.
    Cache TTL is 2 minutes.
  - **Keep RAM threshold with caching**: RAM_THRESHOLD (50%) is still checked but uses cached
    values only (no uncached rechecks) to simplify the logic.
  - **Increase MIN_START_INTERVAL_MS to 2 minutes**: Allows enough time for solve command to
    start actual claude process, ensuring running processes are counted when API limits are checked.
  - **Increase CONSUMER_POLL_INTERVAL_MS to 1 minute**: Reduces unnecessary system checks.
    One-minute polling is sufficient for queue management.
  - **Running processes not a blocking limit**: Commands can run in parallel as long as actual
    limits (CPU, API, etc.) are not exceeded. Claude process info is only supplementary.

  Fixes #1078

## 1.0.4

### Patch Changes

- 4e5e1ab: Use gh-upload-log for log file uploads (issue #587)
  - Replace custom gist creation with gh-upload-log command
  - Implement smart linking: 1 chunk = direct raw link, >1 chunks = repo link
  - Update case study documentation with gh-upload-log v0.5.0 fixes
  - Remove custom log compression in favor of gh-upload-log auto mode

## 1.0.3

### Patch Changes

- 26b69f2: Fix Claude Code output token limit by setting CLAUDE_CODE_MAX_OUTPUT_TOKENS to 64000
  - Claude Code CLI defaults to 32K output token limit, but Claude Sonnet/Opus/Haiku 4.5 models support 64K
  - Added `claudeCode.maxOutputTokens` configuration in `config.lib.mjs` (default: 64000)
  - Pass `CLAUDE_CODE_MAX_OUTPUT_TOKENS` environment variable when executing Claude CLI
  - Configuration can be overridden via `CLAUDE_CODE_MAX_OUTPUT_TOKENS` or `HIVE_MIND_CLAUDE_CODE_MAX_OUTPUT_TOKENS` environment variables
  - Added comprehensive case study analysis in `docs/case-studies/issue-1076/`

  See: https://github.com/link-assistant/hive-mind/issues/1076

## 1.0.2

### Patch Changes

- 1a96d9f: Fix Claude Usage API rate limiting by increasing cache TTL to 20 minutes
  - The Claude Usage API (`/api/oauth/usage`) was returning null values due to rate limiting when called too frequently
  - Increased default cache TTL from 3 minutes to 20 minutes for Claude Usage API
  - Added configurable environment variable `HIVE_MIND_USAGE_API_CACHE_TTL_MS` (default: 1200000ms = 20 minutes)
  - Added HTTP response status logging for easier debugging
  - Added explicit 429 rate limit error handling
  - Updated documentation in `docs/CONFIGURATION.md`

  See: https://github.com/link-assistant/hive-mind/issues/1074

## 1.0.1

### Patch Changes

- 2a3848d: Add --prompt-architecture-care flag for managing REQUIREMENTS.md and ARCHITECTURE.md files

  Adds an optional experimental flag `--prompt-architecture-care` that provides guidance for:
  - Managing REQUIREMENTS.md (high-level why/what documentation)
  - Managing ARCHITECTURE.md (high-level how documentation)
  - TODO.md workflow management for task persistence across sessions

  The flag is disabled by default and works with all tools (claude, agent, opencode, codex).

- a18a664: Fix session ID extraction error for --tool agent
  - Fixed JSON parsing logic in agent tool to extract session IDs from NDJSON output
  - Modified session summary to show informational message for agent tool instead of error

## 1.0.0

### Major Changes

- 4e8d141: Rename `--auto-continue-on-limit-reset` to `--auto-resume-on-limit-reset` for clarity

  BREAKING CHANGE: The `--auto-continue-on-limit-reset` option has been renamed to `--auto-resume-on-limit-reset`. Users must update their commands and configurations to use the new flag name.

  The option is related to `--resume` for `claude` command and has an entirely different meaning from `--auto-continue` mode. This rename makes the distinction clearer and aligns the terminology with the resume functionality.

  Migration:
  - Replace `--auto-continue-on-limit-reset` with `--auto-resume-on-limit-reset` in all commands
  - Update environment variables and configuration files accordingly

## 0.54.6

### Patch Changes

- f734d5d: feat: Add --base-branch to /help and implement option typo suggestions
  - Added --base-branch option to Telegram bot /help command
  - Implemented intelligent option name suggestions using Levenshtein distance
  - Added --base-branch to README.md solve options section
  - Enhanced error messages with helpful suggestions for typos (e.g., --branch → --base-branch)

## 0.54.5

### Patch Changes

- Fix duplicate APT sources warning in installation script
  - Add `cleanup_duplicate_apt_sources()` function to detect and remove duplicate APT source files
  - Clean up duplicate Microsoft Edge sources (`microsoft-edge.list` vs `microsoft-edge-stable.list`)
  - Clean up duplicate Google Chrome sources (`google-chrome.list` vs `google-chrome-stable.list`)
  - Run cleanup before `apt update` to prevent "Target Packages configured multiple times" warnings
  - Ensures script supports clean upgrade mode when run on previously installed systems

  Improve Telegram bot error messages for better user experience (issue #1070)
  - Enhanced URL validation to provide specific, actionable error messages based on URL type (issues list, pulls list, repository)
  - Added step-by-step fix instructions with examples when users provide wrong URL formats
  - Improved global error handler to properly escape Markdown special characters, preventing "400: Bad Request: can't parse entities" errors
  - Added special handling for Telegram API parsing errors with clearer messaging
  - Added `cleanNonPrintableChars()` to automatically remove invisible Unicode characters from user input
  - Added `makeSpecialCharsVisible()` to show users exactly where problematic special characters are in their input
  - Enhanced error messages to display user input with special characters made visible for easier debugging
  - Refactored telegram-bot.mjs to meet 1500 line limit requirement
  - Created comprehensive test suites to verify URL validation improvements and special character handling
  - Documented case study analysis in docs/case-studies/issue-1070/ANALYSIS.md

## 0.54.4

### Patch Changes

- 4e53d67: fix: resolve TypeError in telegram-bot when using --tokens-budget-stats

  Fixed type safety bug that prevented the --tokens-budget-stats option from working via telegram bot configuration overrides. Changed from lino.parse() to lino.parseStringValues() to ensure only string values are returned, making .trim() safe to call. The feature was already fully implemented but crashed when used via TELEGRAM_HIVE_OVERRIDES or TELEGRAM_SOLVE_OVERRIDES.

## 0.54.3

### Patch Changes

- 4d4b461: Add Playwright browser verification to installation script and CI
  - Enhanced `scripts/ubuntu-24-server-install.sh` with detailed browser verification after installation
  - Added CI checks in `.github/workflows/release.yml` to verify required Playwright browsers (chromium, firefox, webkit) are installed
  - CI now fails if required browsers are missing, ensuring Playwright MCP server has all dependencies

## 0.54.2

### Patch Changes

- c5f5194: Fix Telegram message getting stuck at "Starting solve command..."
  - Add error handling to `executeAndUpdateMessage` function to catch Telegram API errors
  - Fix critical bug where `messageInfo` was being cleared before the final message update
  - Add proper error logging for message edit failures in both immediate and queued execution paths

## 0.54.1

### Patch Changes

- 55576af: fix: allow parallel queue execution when no limits exceeded

  Previously, "Claude process is already running" was treated as a blocking reason on its own, preventing parallel execution even when all system and API limits were within thresholds.

  Changes:
  - `claude_running` is now tracked as a metric, not a blocking reason
  - Commands can run in parallel as long as actual limits are not exceeded
  - When any limit >= threshold, allow exactly one claude command to pass

## 0.54.0

### Minor Changes

- 4af584c: Add producer/consumer queue for /solve command in Telegram bot

  This feature implements resource-aware throttling to prevent system overload when multiple /solve commands are submitted simultaneously.

  **Queue Configuration (using usage ratios 0.0-1.0):**
  - `RAM_THRESHOLD: 0.5` - Stop new commands if RAM usage > 50%
  - `CPU_THRESHOLD: 0.5` - Stop new commands if CPU usage > 50%
  - `DISK_THRESHOLD: 0.95` - One-at-a-time mode if disk usage > 95%
  - `CLAUDE_5_HOUR_SESSION_THRESHOLD: 0.9` - Stop if Claude 5-hour limit > 90%
  - `CLAUDE_WEEKLY_THRESHOLD: 0.99` - One-at-a-time mode if weekly limit > 99%
  - `GITHUB_API_THRESHOLD: 0.8` - Stop if GitHub API > 80% with parallel claude commands
  - 1-minute minimum interval between command starts
  - Running claude process detection

  **Status Flow:**
  - `Queued` - Initial status when command is added to queue
  - `Waiting` - When start conditions are not met (with human-readable reason)
  - `Starting` - When command is being started
  - `Started` - Terminal status with session info (message tracking is released)

  **Caching:**
  - API calls (Claude, GitHub): 3-minute cache
  - System metrics (RAM, CPU, disk): 2-minute cache
  - Shared cache between /solve queue and /limits command

  **Files Changed:**
  - `limits.lib.mjs` - Merged from `claude-limits.lib.mjs` with added caching layer (replaces both `claude-limits.lib.mjs` and `telegram-limits.lib.mjs`)
  - `telegram-solve-queue.lib.mjs` - Queue implementation with status tracking

  **User Experience:**
  - Messages are updated in-place as status changes
  - Clear waiting reasons displayed (e.g., "Disk usage is 96% (threshold: 95%)")
  - Queue status added to /limits command output

## 0.53.2

### Patch Changes

- 5030fe1: Fix --auto-continue-on-limit-reset flag not working

  When Claude hit its usage limit with --auto-continue-on-limit-reset enabled, the code would exit early
  via the failure branch before reaching showSessionSummary() where autoContinueWhenLimitResets() is called.

  This patch adds a condition to skip the failure exit when limit is reached with auto-continue enabled,
  allowing the code to properly wait for the limit to reset and resume the session.

## 0.53.1

### Patch Changes

- 6d7fb43: Add --auto-continue-on-limit-reset option to hive command

  The hive command was missing the --auto-continue-on-limit-reset option that is available
  in the solve command. This caused yargs strict mode to reject the option with an
  "Unknown arguments" error. The option is now properly defined in hive.config.lib.mjs
  and passed to the solve command when spawning workers.

## 0.53.0

### Minor Changes

- b750286: Add `--prompt-check-sibling-pull-requests` flag (default: true) to control whether the AI is prompted to study related/sibling pull requests during issue solving

## 0.52.1

### Patch Changes

- 1a4f1a2: Reduce Telegram messages by updating instead of sending new ones

  The `/solve` and `/hive` commands now update the initial "Starting..." message with the success/error result instead of sending a separate message. This follows the same pattern already used by the `/limits` command.

  **Before:** Two separate messages per command
  **After:** Single message that gets updated with the result

## 0.52.0

### Minor Changes

- b280bcc: Add `--prompt-playwright-mcp` flag to control Playwright MCP hints in system prompt

  Users can now explicitly control whether Playwright MCP browser automation hints appear in the AI's system prompt:
  - Use `--no-prompt-playwright-mcp` to disable hints even when Playwright MCP is installed
  - Use `--prompt-playwright-mcp` to explicitly enable hints
  - Omit the flag to keep the default auto-detection behavior

## 0.51.21

### Patch Changes

- Increase swap space from 2GB to 4GB in installation script for improved stability

  Fix: Show Claude CLI resume command using `(cd ... && claude --resume ...)` pattern

  When using `--tool claude` (or the default tool), the console now displays a copyable Claude CLI resume command at the end of every session (success, failure, or usage limit reached):

  ```
  💡 To continue this session in Claude Code interactive mode:

     (cd "/tmp/gh-issue-solver-..." && claude --resume <session-id>)
  ```

  Changes in this PR:
  - Refactored `claude.command-builder.lib.mjs` to build Claude CLI commands instead of solve.mjs commands
  - Added `buildClaudeResumeCommand()` for generating `(cd ... && claude --resume ...)` pattern
  - Added `buildClaudeInitialCommand()` for generating `(cd ... && claude ...)` pattern
  - Removed solve.mjs resume command display from console output
  - Updated PR comments to use Claude CLI resume command pattern

  This allows users to:
  - Investigate sessions interactively in Claude Code
  - Resume from where they left off after usage limits reset
  - See full context and history
  - Debug issues

  The command uses the `(cd ... && claude --resume ...)` pattern for a fully copyable, executable command that works regardless of the current directory.

  Note: The resume command is only shown for `--tool claude` since other tools (codex, opencode, agent) have different resume mechanisms.

  Fixes #942

## 0.51.20

### Patch Changes

- 9327e83: Fix CI/CD check differences between pull request and push events

  Changes:
  - Make lint job independent of changeset-check (runs based on file changes only)
  - Allow docs-only PRs without changeset requirement
  - Handle changeset-check 'skipped' state in dependent jobs
  - Fix unformatted markdown files in case studies
  - Add case study documentation for issue #1023

## 0.51.19

### Patch Changes

- 0326eb5: Update /help and docs, add CPU/RAM metrics to /limits
  - Remove obsolete options (--fork, --auto-fork, --auto-continue) from /help command
  - Reorder options in /help: --model and --think now listed first
  - Move --model example from /hive to /solve
  - Update /limits to show CPU and RAM usage metrics
  - Fix README.md defaults for --auto-fork and --auto-continue (now true)

## 0.51.18

### Patch Changes

- bf6ac23: Fix Claude Code terms acceptance treated as success
  - Detect Claude CLI terms acceptance messages and treat as error requiring human intervention
  - Hide cost estimation section when all values are unknown
  - Fix code block escaping in log comments using zero-width spaces

## 0.51.17

### Patch Changes

- 91e43bf: Fix: Do not retry on 404 errors, display user-friendly permission suggestions

  This fix addresses issue #808 by improving error handling when attempting to fork inaccessible repositories.

  **Key improvements:**
  1. **No retry on 404 errors** - 404 errors are detected immediately and fail fast, saving ~30 seconds and ~10 API requests per failure
  2. **User-friendly error messages** - Comprehensive error messages explain what happened, list common causes, and provide step-by-step troubleshooting
  3. **Reduced API requests** - Early 404 detection in getRootRepository and immediate exit on 404 during fork creation eliminates unnecessary retries

  **Impact:**
  - Time saved: ~30 seconds per failed fork attempt
  - API requests saved: ~10 requests per failed fork attempt
  - Better UX: Clear guidance on diagnosing and resolving repository access issues

## 0.51.16

### Patch Changes

- 312c600: Fix issue #894: Add final log file reference at end of solve command CLI output

  Following the pattern used by Claude and other agents, the solve command now consistently displays the log file path as the final line of output. This ensures users always know where to find the complete log file, regardless of operations like log uploads, watch mode, or cleanup messages.

## 0.51.15

### Patch Changes

- 93a0af9: Add case study for issue #964: Discussion comments not loaded to AI context

  This case study documents the root cause analysis of why the AI solver failed to see and respond to repository owner feedback on PR #13 in the eg0rmaffin/vapor-rice-i3 repository. The investigation revealed two independent root causes:
  1. The feedback system tells the AI the count of new comments but not their content
  2. The AI used an incomplete API command that only fetches conversation comments, missing review comments

  The case study includes proposed solutions to fix this issue.

## 0.51.14

### Patch Changes

- 4e4fe08: Improve fork divergence error message clarity
  - Remove misleading "Option 3: Work without syncing fork (NOT RECOMMENDED)"
  - Add new Option 1 for deleting and recreating fork (marked as SIMPLEST)
  - Reorder options by simplicity: deletion → auto-resolution → manual resolution
  - Move risk warnings inline with relevant options for better context
  - Add comprehensive case study documentation in docs/case-studies/issue-972/

  This change makes the error message more useful by removing options that were never actually viable and adding the fork deletion option as the cleanest solution for most fork divergence scenarios.

## 0.51.13

### Patch Changes

- 20d6f3a: Fix URL hash fragment parsing - URLs with hash fragments like #issuecomment-123 are now correctly parsed. Previously, solving a PR with a comment URL like /pull/9#issuecomment-123 would fail because the PR number was extracted as "9#issuecomment-123" instead of "9".

## 0.51.12

### Patch Changes

- c5bcaf4: fix: add trailing newlines to generated CLAUDE.md files and prompts

  Ensures all automatically generated CLAUDE.md files and prompt strings comply with POSIX text file standards by adding trailing newlines. This fix prevents linter warnings and eliminates the need for manual fixes in subsequent pull requests.

  Changes:
  - Modified `src/solve.auto-pr.lib.mjs` to add trailing newline to CLAUDE.md template
  - Updated all prompt builder files (`agent.prompts.lib.mjs`, `claude.prompts.lib.mjs`, `codex.prompts.lib.mjs`, `opencode.prompts.lib.mjs`) to append `\n` to return values
  - Added comprehensive case study documentation in `docs/case-studies/issue-971/`

  Fixes #971

## 0.51.11

### Patch Changes

- 001dcdb: Fix missing comment detection when PRs have more than 30 comments by adding --paginate flag to GitHub API calls

## 0.51.10

### Patch Changes

- 0f20e0b: Add missing language runtimes, agents, and tools to /version command output

  This patch adds comprehensive version detection for all components installed by the ubuntu-24-server-install.sh script:

  **New Language Runtimes:**
  - Deno (JavaScript/TypeScript runtime)
  - Go (Golang)
  - Java (via SDKMAN)
  - Lean (theorem prover)
  - Perl (via Perlbrew)
  - OCaml (via Opam)
  - Rocq/Coq (theorem prover)

  **New Development Tools:**
  - SDKMAN (Java version manager)
  - Elan (Lean version manager)
  - Lake (Lean package manager)
  - Perlbrew (Perl version manager)
  - Opam (OCaml package manager)

  **New C/C++ Development Tools Section:**
  - Make
  - CMake
  - GCC
  - G++
  - Clang
  - LLVM
  - LLD (LLVM linker)

  The /version command now displays all installed components that are available in the hive environment.

  Fixes #1007

## 0.51.9

### Patch Changes

- Keep hive user's home directory clean
  - Move Go GOPATH from `~/go` to `~/.go/path` to keep everything under the hidden `.go` directory
  - Move Perlbrew from `~/perl5` to `~/.perl5` (hidden directory)
  - Remove automatic cloning of hive-mind repository to `~/hive-mind`

  This keeps the user's home directory empty by default, giving users freedom to organize their workspace as they prefer.

  Fixes #1004

  fix: ensure log attachment works when PR is merged during session

  Fixes issue where log files would not be attached to pull requests when the PR was merged during the AI solving session. The `gh pr list` command only returns OPEN PRs by default, causing merged PRs to not be found. Added `--state all` flag to find PRs regardless of their state (OPEN, MERGED, or CLOSED), and added handling to skip operations that don't work on merged PRs (like `gh pr edit` and `gh pr ready`) while still allowing log attachment.

## 0.51.7

### Patch Changes

- b7c7a2c: feat: add GitHub API rate limits to /limits command

  Adds GitHub API core rate limit information to the Telegram bot's /limits command output, allowing users to monitor GitHub API usage alongside Claude usage limits and disk space. This helps plan issue execution when GitHub API limits are approaching.

## 0.51.6

### Patch Changes

- 9ee79c8: fix(ci): Add timeout, verbose diagnostics, and pre-fetch caching for Docker ARM64 builds

  Addresses issue #998 where Docker Publish (linux/arm64) was stuck for >1.5 hours due to slow Homebrew bottle downloads on GitHub's ARM64 runners.

  Changes:
  - Added 90-minute timeout to docker-publish jobs to prevent indefinite hangs
  - Switched from ubuntu-24.04-arm to ubuntu-22.04-arm for better network performance
  - Added documentation comments about known ARM64 runner issues
  - Added Homebrew verbose mode (`HOMEBREW_VERBOSE=1`) for detailed diagnostics
  - Added `brew fetch --deps --retry` to pre-download bottles before installation
  - Added timing measurements for fetch and install steps
  - Updated case study with diagnostic approach

  Root cause: GitHub's ubuntu-24.04-arm runners have known network performance issues (actions/runner-images#11790, actions/partner-runner-images#101). The ARM64 build was stuck downloading Homebrew bottles for PHP dependencies at extremely slow speeds.

  See docs/case-studies/issue-998/README.md for detailed analysis.

## 0.51.5

### Patch Changes

- 1a17f74: feat: add disk space information to /limits command

  Adds free disk space percentage and size information to the Telegram bot's /limits command output, allowing users to monitor disk usage alongside Claude API limits and plan issue execution accordingly.

## 0.51.4

### Patch Changes

- Test patch release

## 0.51.3

### Patch Changes

- 2fdb8b8: Fix Docker publish jobs being skipped after successful npm releases by adding always() to job conditions and explicit result checks

## 0.51.2

### Patch Changes

- a605d9d: Fix perlbrew bashrc unbound variable error (issue #989)

  **Problem:** The error `/home/hive/perl5/perlbrew/etc/bashrc: line 71: $1: unbound variable` appeared during Docker builds when running Perl version checks.

  **Root Cause:** Perlbrew's generated bashrc uses positional parameter `$1` and other variables without protection against `set -u` (nounset mode).

  **Solution:**
  - Patch perlbrew bashrc after installation to use `${1:-}`, `${PERLBREW_LIB:-}`, and `${outsep:-}` syntax
  - Add CI check to detect and fail on any unbound variable errors in Docker builds
  - Add case study documentation for future reference

  **Changes:**
  - `scripts/ubuntu-24-server-install.sh`: Patch perlbrew bashrc for set -u compatibility
  - `.github/workflows/release.yml`: Add CI check for unbound variable errors
  - `docs/case-studies/issue-989/`: Add case study documentation

  References:
  - Issue: https://github.com/link-assistant/hive-mind/issues/989
  - Upstream fix: https://github.com/gugod/App-perlbrew/pull/850

## 0.51.1

### Patch Changes

- ec08ef4: Fix Rocq installation verification (issue #952)
  - Installation script: Check binary accessibility instead of just package listing
  - Installation script: Use `opam pin add rocq-prover` per official documentation
  - CI workflow: Require Rocq accessibility in container (not optional)
  - CI workflow: Enhanced diagnostics when Rocq verification fails
  - Dockerfile: Add opam environment variables (OPAM_SWITCH_PREFIX, CAML_LD_LIBRARY_PATH, OCAML_TOPLEVEL_PATH)

  References:
  - Issue: https://github.com/link-assistant/hive-mind/issues/952
  - Rocq docs: https://rocq-prover.org/docs/using-opam

## 0.51.0

### Minor Changes

- 36f23fb: Add fork parent validation to prevent nested fork hierarchy issues (#967)

  This release adds early validation of fork parent relationships to prevent issues where a fork was created from an intermediate fork (fork of a fork) instead of directly from the intended upstream repository.

  **Problem solved:**
  When a user's fork was created from an intermediate fork (e.g., `user/repo` forked from `someone-else/repo` which was itself forked from `upstream/repo`), any pull requests created would include all commits that exist in the intermediate fork but not in the upstream. This could result in PRs with hundreds or thousands of unexpected commits.

  **Case study (Issue #967):**
  A fork `konard/zamtmn-zcad` was created from `veb86/zcadvelecAI` (intermediate fork with 1,678 extra commits) instead of `zamtmn/zcad` (the upstream). This resulted in a PR with 1,681 commits instead of the expected 3 commits.

  **Changes:**
  - **New function `validateForkParent()`**: Validates that a fork's parent matches the expected upstream repository before using it. Checks both the immediate parent and ultimate source (root) of the fork hierarchy.
  - **Early validation**: Fork parent is now validated immediately after an existing fork is found, BEFORE syncing or creating branches. This prevents wasted work and provides clear error messages early.
  - **Detailed error messages**: When a fork parent mismatch is detected, users receive comprehensive information including:
    - The actual fork hierarchy (parent and source repositories)
    - Why this is a problem (unexpected commits in PRs)
    - Three concrete fix options:
      1. Delete the problematic fork and create a fresh one
      2. Use `--prefix-fork-name-with-owner-name` to create a new fork with a different name
      3. Work directly on the repository with `--no-fork` if you have write access
  - **Unit tests**: Added comprehensive test suite (`tests/test-fork-parent-validation.mjs`) with 10 tests covering the validation logic, error handling, and documentation.

  **Technical details:**
  - Uses GitHub API to fetch fork relationship: `gh api repos/{fork} --jq '{fork: .fork, parent: .parent.full_name, source: .source.full_name}'`
  - Validates in two code paths: when finding existing forks (strict error) and when using forkOwner from PR mode (warning only)
  - Reports validation errors to Sentry for monitoring

## 0.50.11

### Patch Changes

- 6f51d29: fix: add screen terminal multiplexer to Docker image

  The screen package is now installed by default in the Docker image, resolving issue #986 where users encountered "command not found" errors when attempting to use screen. Includes comprehensive case study documenting the issue analysis, root cause, and solution evaluation.

## 0.50.10

### Patch Changes

- Test patch release

## 0.50.9

### Patch Changes

- Fix stuck Docker multi-platform builds by using native ARM64 runners

  The Docker publish workflow was getting stuck for hours when building ARM64 images using QEMU emulation on x86_64 runners. QEMU emulation introduces 10-100x slowdown, especially for complex Dockerfiles that compile native packages.

  **Solution**: Refactored docker-publish jobs to use GitHub's native ARM64 runners (`ubuntu-24.04-arm`) with a matrix strategy:
  - Each platform (amd64, arm64) builds natively in parallel on dedicated runners
  - Build artifacts (digests) are uploaded and merged into a multi-platform manifest
  - Eliminates QEMU emulation overhead entirely
  - Build times should now be similar for both platforms (~10-15 minutes each)

  This fix applies to both:
  - `docker-publish` job (triggered by regular releases)
  - `docker-publish-instant` job (triggered by manual instant releases)

  Fixes #982

  Fix Docker Publish jobs being skipped after npm publish

  Added explicit shell-based output passthrough step for `published` output in both `release` and `instant-release` jobs. This ensures reliable output propagation to dependent jobs (`docker-publish` and `docker-publish-instant`).

  Root cause: Node.js `appendFileSync` to `GITHUB_OUTPUT` was not reliably propagating outputs to dependent jobs. The fix uses a dedicated shell step to echo outputs, which is proven to work correctly.

  Also added debug logging to `setOutput` function in `publish-to-npm.mjs` and `version-and-commit.mjs` scripts.

  Add case study for harmful prompts and resource exhaustion attacks

  Documents analysis of LLM resource exhaustion attacks including:
  - Timeline and root cause analysis
  - OWASP LLM Top 10 (2025) attack classification
  - Attack patterns database with detection rules
  - Five proposed solution approaches
  - Raw attack samples for research

## 0.50.8

### Patch Changes

- Test patch release

## 0.50.7

### Patch Changes

- 9eea96a: Fix Docker publish jobs failing with "No space left on device" error

  Added disk space cleanup step to both `docker-publish` and `docker-publish-instant` jobs in the release workflow. This step removes large pre-installed packages (dotnet, android SDK, GHC, CodeQL) and prunes unused Docker images before building multi-platform Docker images.

  This fixes issue #975 where instant releases failed during arm64 build due to insufficient disk space when installing Rust toolchain.

## 0.50.6

### Patch Changes

- 7733b32: Detect OpenCode permission prompts and recommend @link-assistant/agent for autonomous workflows
  - Configure all OpenCode permissions to "allow" (edit, bash, webfetch, skill, doom_loop, external_directory)
  - Detect interactive permission prompts that block automated execution
  - Recommend @link-assistant/agent (100% unrestricted OpenCode fork) when prompts are detected

## 0.50.5

### Patch Changes

- Test patch release

## 0.50.4

### Patch Changes

- d58e5dd: fix: enable Docker and Helm publishing for instant releases

  Previously, when using the "instant release" workflow (triggered via workflow_dispatch),
  Docker images and Helm charts were not published because they only depended on the
  `release` job outputs. This fix adds dedicated `docker-publish-instant` and
  `helm-release-instant` jobs that depend on the `instant-release` job outputs.

  This resolves the issue where Docker Hub images were 14 days behind npm releases.

  Additionally, duplicated CI/CD logic has been moved to reusable scripts:
  - `scripts/wait-for-npm.sh` - Waits for NPM package availability
  - `scripts/helm-release.sh` - Packages and publishes Helm charts to gh-pages

## 0.50.3

### Patch Changes

- ca9f1b2: Fix sentry-cli source maps upload command for v3.0.0+ API

  Updated `scripts/upload-sourcemaps.mjs` to use the new `sentry-cli sourcemaps upload` command syntax instead of the deprecated `sentry-cli releases files upload-sourcemaps` which was removed in sentry-cli 3.0.0.

## 0.50.2

### Patch Changes

- Test patch release

## 0.50.1

### Patch Changes

- 8fdf8dd: Fix Sentry CLI 3.x compatibility to restore Docker image publishing
  - Update `scripts/upload-sourcemaps.mjs` to use `sourcemaps upload` command instead of deprecated `releases files` command
  - Add case study documentation for issue #962 investigation

## 0.50.0

### Minor Changes

- 8934ed6: Improve changeset CI/CD robustness for multiple concurrent PRs
  - Update validate-changeset.mjs to only check changesets ADDED by the current PR (not pre-existing ones)
  - Add merge-changesets.mjs script to combine multiple pending changesets during release
  - Merged changesets use highest version bump type (major > minor > patch) and combine descriptions chronologically
  - Update release workflow to merge multiple changesets before version bump
  - This prevents PR failures when multiple PRs merge before a release cycle completes

## 0.49.0

### Minor Changes

- Add --claude-file and --gitkeep-file CLI options for choosing between CLAUDE.md and .gitkeep files

  This feature allows users to choose which file type to use for PR creation:
  - `--claude-file` (default: true): Use CLAUDE.md file for task details
  - `--gitkeep-file` (default: false): Use .gitkeep file instead

  The flags are mutually exclusive:
  - Using `--gitkeep-file` automatically disables `--claude-file`
  - Using `--no-claude-file` automatically enables `--gitkeep-file`
  - Both flags cannot be disabled simultaneously

  This is a step toward making .gitkeep the default behavior in future releases.

## 0.48.4

### Patch Changes

- b010ce6: Increase minimum disk space requirement from 512 MB to 2 GB to provide more room for commands to gracefully finish before running out of disk space and prevent potential OS issues

## 0.48.3

### Patch Changes

- ba6d6e4: Add comprehensive research on folder naming best practices for documentation

  Added expanded documentation in `docs/case-studies/folder-naming-best-practices.md` covering:
  - Industry standards (Google SRE, ITIL, NIST, Diataxis, Oxide RFD, NASA FRB, FEMA AAR)
  - Terminology mapping for alternative document type names (PIR, AAR, RCA, TDR, etc.)
  - Recommended folder structure for incidents, investigations, problems, case studies, decisions, reviews, retrospectives, and runbooks
  - Extended folder structure for larger organizations
  - File naming conventions for 18+ document types following kebab-case and ISO 8601 date formats
  - Document templates with YAML front matter including RFD, Spike, AAR, Retrospective, and One-Pager templates
  - 30+ verified authoritative sources from industry leaders

## 0.48.2

### Patch Changes

- Test patch release

## 0.48.1

### Patch Changes

- 279642e: Comprehensive release and validation fixes

  This release includes multiple critical fixes that work together to ensure reliable releases and prevent unvalidated code from merging:

  **1. Fix workflow conditions to prevent unvalidated code from merging (#958)**

  Updated lint job conditions in release.yml to check all file types that Prettier formats (.mjs, .md, .json, .js), not just .mjs files. This ensures the lint check runs consistently for both pull requests and main branch, preventing formatting issues from bypassing validation. Previously, PRs changing only .md or .json files would skip lint checks, allowing unformatted code to merge and cause main branch CI failures.

  Documentation added:
  - Case study analysis (docs/case-studies/issue-958/ANALYSIS.md) with root cause analysis and timeline reconstruction
  - Branch protection policy guide (docs/BRANCH_PROTECTION_POLICY.md) with required status checks specification and configuration instructions

  **2. Fix perlbrew bashrc unbound variable error at perl version check (#954)**

  Resolves an issue where running `perl --version` during installation would trigger an "unbound variable" error from perlbrew's bashrc file at line 71. The error occurred because:
  - The version check command triggered .bashrc sourcing in a subshell
  - Perlbrew's bashrc referenced positional parameter $1 without guards
  - With `set -u` enabled, unbound variables cause errors

  Solution:
  - Only load perlbrew in interactive shells (PS1 check in .bashrc)
  - Temporarily disable `set -u` when sourcing perlbrew bashrc in the install script
  - Re-enable strict mode immediately after sourcing
  - Added comprehensive test script (experiments/test-perlbrew-fix.sh)

  **3. Enhance README.md initialization for empty repositories (#706)**

  Enhanced the existing empty repository handling to include repository description in the auto-generated README.md file. When the solve command encounters an empty repository that cannot be forked, it now creates a more descriptive README with both the repository title and description (if available).

  **4. Fix package-lock.json sync in changeset version bump flow**
  - Add `npm install --package-lock-only` after `npm run changeset:version` in version-and-commit.mjs
  - Ensures package-lock.json stays in sync with package.json during changeset-based releases
  - Fixes issue where version bumps only updated package.json

## 0.48.0

### Minor Changes

- 93ea94b: Add solution drafts listing feature to hive command. When processing completes, hive now displays all completed issues with their linked pull requests before showing the "✅ All issues processed!" message.

### Patch Changes

- a44ab88: Add system prompt guidance to prefer using existing code as examples
  - Added guideline to encourage searching for similar existing implementations before implementing from scratch
  - Applied consistently across all three prompt modules (claude, codex, opencode)
  - Helps maintain consistency with existing patterns and reduces redundant work

- 1bdc96d: Fix --base-branch option to properly create branches from the specified base branch instead of from current HEAD

## 0.47.1

### Patch Changes

- 68c0417: Fix Rocq installation verification by sourcing opam environment
  - Source opam environment before verifying Rocq in installation summary
  - Use `rocq -v` for verification as recommended by official documentation
  - Update CI workflow to require Rocq to be accessible (not optional)
  - Add case study documenting the issue and solution

## 0.47.0

### Minor Changes

- 1351ffe: Add Prettier for automatic code formatting with ESLint integration
  - Added Prettier configuration with project code style settings
  - Created format and format:check npm scripts for code formatting
  - Integrated Prettier with ESLint to warn about formatting issues
  - Added eslint-config-prettier and eslint-plugin-prettier dependencies

## 0.46.1

### Patch Changes

- 3707189: Implement fail-fast CI strategy for release.yml workflow
  - Added dependency ordering so long-running checks wait for all fast checks to pass
  - Fast checks (test-compilation, lint, check-file-line-limits) run first (~7-21s each)
  - Long-running checks (test-suites, test-execution, memory-check-linux, docker-pr-check) only run after fast checks pass
  - Added smart conditionals with `!contains(needs.*.result, 'failure')` to skip long checks when fast checks fail
  - Added section markers to clearly document FAST vs LONG-RUNNING checks in the workflow

  Benefits:
  - Time savings: If fast checks fail, ~4+ minutes of long-running tests are skipped
  - Faster feedback: Developers get quick feedback on common issues
  - Resource efficiency: Reduces unnecessary GitHub Actions minutes consumption

## 0.46.0

### Minor Changes

- a436ee4: Add --prompt-case-studies CLI option for comprehensive issue analysis. When enabled, instructs the AI to download logs, create case study documentation in ./docs/case-studies/issue-{id}/, perform deep analysis, reconstruct timeline, identify root causes, and propose solutions. Works only with --tool claude, disabled by default.

### Patch Changes

- 1110e7a: Add comprehensive changeset documentation to CONTRIBUTING.md explaining how contributors should use the changesets workflow for version management and changelog generation

## 0.45.0

### Minor Changes

- 81f8da0: Add `--tokens-budget-stats` option for detailed token usage analysis. This experimental feature shows context window usage and output token usage in absolute values and ratios when using `--tool claude`. Disabled by default.

## 0.44.0

### Minor Changes

- b72136f: Add /version command to hive-telegram-bot

  Implements a new /version command that displays comprehensive version information including:
  - Bot version (package version with git commit SHA in development)
  - solve and hive command versions
  - Node.js runtime version
  - Platform information (OS and architecture)

  This helps users and administrators quickly check version information without accessing logs or the server directly.

### Patch Changes

- 445091b: Fix Perl version detection in ubuntu-24-server-install.sh

  The `perlbrew available` command output was not being parsed correctly, causing the installation script to skip Perl installation with the message "Could not determine latest Perl version."

  **Changes:**
  - Use `grep -oE` to robustly extract Perl version strings regardless of line formatting
  - Capture stderr from `perlbrew available` for better debugging
  - Add debug output showing `perlbrew available` response when version detection fails
  - Works with 'i' markers for already-installed versions and variable indentation

  This ensures the latest Perl version is properly detected and installed via perlbrew.

  Fixes #948

## 0.43.0

### Minor Changes

- fe002f8: Add --prompt-issue-reporting flag for automatic issue creation

  This release introduces a new opt-in feature that enables the AI to automatically create GitHub issues when it spots bugs, errors, or minor issues during working sessions that are not related to the main task.

  **New Features:**
  - Added `--prompt-issue-reporting` CLI flag (disabled by default)
  - Issues include reproducible examples, workarounds, and fix suggestions
  - Supports creating issues in both current and third-party repositories
  - Automatic duplicate checking before creating issues

  **Usage:**

  ```bash
  hive solve <issue-url> --prompt-issue-reporting
  solve <issue-url> --prompt-issue-reporting
  ```

  **Implementation:**
  - New guideline in system prompt (conditional on flag)
  - Flag added to both `hive` and `solve` commands
  - Uses `gh` CLI for authenticated issue creation (works with private repos)

  This feature helps ensure that no bugs slip through the cracks during development while giving users full control over when it's active.

## 0.42.3

### Patch Changes

- 64d6cf8: Add experimental /top command to Telegram bot
  - Added /top command to show live system monitor in Telegram
  - Displays auto-updating `top` output in a single message (updates every 2 seconds)
  - Owner-only access with chat authorization checks
  - Session isolation per chat using GNU screen
  - Clean stop button to terminate monitoring session
  - Marked as EXPERIMENTAL feature with user warnings
  - Not documented in /help as requested
  - Requires GNU screen to be installed on the system

  Fixes #500

## 0.42.2

### Patch Changes

- dca5bed: Make --auto-continue enabled by default
  - Changed default value from false to true for --auto-continue in both hive and solve commands
  - Smart handling of -s (--skip-issues-with-prs) flag interaction:
    - When -s is used, auto-continue is automatically disabled to avoid conflicts
    - Explicit --auto-continue with -s shows proper error message
    - Users can still use --no-auto-continue to explicitly disable
  - This improves user experience as users typically want to continue working on existing PRs

  Fixes #454

## 0.42.1

### Patch Changes

- acd70a9: Add Lean runtime preinstallation support via elan
  - Install elan (Lean version manager) with stable toolchain in all deployment environments
  - Add Lean/elan to PATH in Dockerfile, .gitpod.Dockerfile, coolify/Dockerfile
  - Add installation verification for elan, lean, and lake commands
  - Add CI checks to verify Lean installation in Docker builds

## 0.42.0

### Minor Changes

- d98d9c9: Add Java (OpenJDK) runtime installation support via SDKMAN in Ubuntu 24 server installation script
  - Install SDKMAN as Java version manager (following pattern of pyenv for Python, nvm for Node.js)
  - Install Java 21 LTS (Eclipse Temurin distribution) by default with fallback to OpenJDK
  - Add SDKMAN configuration to .bashrc for persistence
  - Add Java and SDKMAN to installation summary output
  - Add zip package to prerequisites (required by SDKMAN)

  Fixes #737

### Patch Changes

- d42d221: Add Perl runtime installation support via Perlbrew to Ubuntu 24 server installation script and Docker environment with CI verification

## 0.41.10

### Patch Changes

- f77fdf8: Add Golang runtime installation support to Ubuntu 24 server installation script with proper success verification
- ca4d83d: Add preinstalled Rocq (formerly Coq) theorem prover runtime support
  - Install opam (OCaml package manager) as prerequisite
  - Configure Rocq-released repository for package installation
  - Add Rocq prover with fallback to classic Coq package if unavailable
  - Add CI verification checks for Opam and Rocq/Coq installation
  - Include Opam paths in Docker environment variables
  - Support both Rocq and Coq theorem provers across all deployment configurations

## 0.41.9

### Patch Changes

- 1635432: Add C/C++ development tools (CMake, Clang/LLVM, GCC, Make) to Ubuntu 24 server installation script with CI verification

## 0.41.8

### Patch Changes

- 80aff72: Add Deno runtime installation support to Ubuntu 24 server installation script and Docker environment

## 0.41.7

### Patch Changes

- 781a8e4: Fix: Upload logs when usage limit is reached

## 0.41.5

### Patch Changes

- 27bbc44: Add backslash detection and validation in GitHub URLs

  When users provide URLs with backslashes (e.g., `https://github.com/owner/repo/issues/123\`), the system now properly validates them and provides helpful error messages with auto-corrected URL suggestions. According to RFC 3986, backslash is not a valid character in URL paths.

  **Changes:**
  - Enhanced `parseGitHubUrl()` function to detect backslashes in URL paths
  - Updated all validation points (Telegram bot `/solve` and `/hive` commands, CLI `hive` and `solve` commands)
  - Provides user-friendly error messages with corrected URL suggestions
  - Comprehensive test suite for backslash validation scenarios

  Fixes #923

## 0.41.3

### Patch Changes

- db8cef7: Fix CLAUDE.md not being deleted in continue mode

  When a work session completes successfully but the CLAUDE.md commit hash was lost between sessions (e.g., due to session interruption), the system now attempts to detect the CLAUDE.md commit from the branch structure instead of silently skipping cleanup.

  **Safety Checks (Preventing Issue #617 Recurrence):**
  1. CLAUDE.md must exist in current branch
  2. Find merge base to isolate PR-only commits
  3. Must have at least 2 commits (CLAUDE.md + actual work)
  4. First commit message must match expected pattern
  5. First commit must ONLY change CLAUDE.md file

  Fixes #940

## 0.41.2

### Patch Changes

- 43d5e01: Add image format validation warning to system prompts to prevent "Could not process image" errors. AI solvers are now instructed to verify image files with the 'file' command before reading them, avoiding crashes from corrupted downloads or HTML 404 pages. Includes reference to case study documenting the root cause of GitHub image processing failures.

## 0.41.0

### Minor Changes

- 5d193ef: Add `--prompt-general-purpose-sub-agent` flag for Claude tool to enable general-purpose sub-agent usage prompting when processing large tasks with multiple files or folders

## 0.40.3

### Patch Changes

- f8ebd99: Make Playwright MCP usage guidelines conditional based on MCP availability
  - Add `checkPlaywrightMcpAvailability()` function to detect if Playwright MCP is installed
  - Conditionally include Playwright MCP section in Claude system prompt only when MCP is detected
  - Integration in both main execution (solve.mjs) and watch mode (solve.watch.lib.mjs)
  - Resolves merge conflicts from main branch

## 0.40.1

### Patch Changes

- 1ee78c9: fix: prefer Anthropic provider for public price calculation

  When calculating public pricing for Claude models, fetchModelInfo now checks the Anthropic provider first instead of using the first match from the models.dev API (which was Helicone). This ensures pricing calculations show "Provider: Anthropic" as expected.

## 0.40.0

### Minor Changes

- 9115337: Add --prompt-plan-sub-agent option to encourage Plan sub-agent usage. When enabled, the AI receives suggestive instructions to consider using the Plan sub-agent for initial research and planning, improving solution quality through better upfront analysis.

## 0.39.0

### Minor Changes

- 5751dbf: Add --prompt-explore-sub-agent option to encourage Claude to use Explore sub-agent for codebase exploration

## 0.38.9

### Patch Changes

- 40545f6: Consolidate CI/CD workflows to single release.yml following js-ai-driven-development-pipeline-template best practices
  - Removed verify-version-bump job (replaced by changeset-check)
  - Consolidated main.yml, ci.yml, and helm-pr-check.yml into release.yml
  - Added template scripts for release automation (validate-changeset, version-and-commit, publish-to-npm, etc.)
  - Tests now run before release on main branch
  - Added manual release support (instant and changeset-pr modes)
  - Maintained all existing hive-mind CI checks (docker-pr-check, helm-pr-check, memory-check, etc.)
