# @link-assistant/hive-mind

## 1.29.0

### Minor Changes

- 161b595: feat: add --auto-accept-invite option to solve command

  Adds a new `--auto-accept-invite` boolean option to the `solve` command that automatically accepts the pending GitHub repository or organization invitation for the specific repository/organization being solved, before checking write access.

  Unlike the `/accept_invites` Telegram command (which accepts ALL pending invitations), this option is scoped to the target repo/org only, making it safer and more targeted. Useful when you've just been invited to a repository and want to run `solve` without manually accepting the invitation first.

## 1.28.0

### Minor Changes

- docs: expand best practices with CI/CD guide, universal prompts, and architecture improvement (Issue #1403)

  Splits the existing `docs/BEST-PRACTICES.md` into two focused documents:
  - **`docs/CI-CD-BEST-PRACTICES.md`** (renamed from the original) — Updated and expanded CI/CD guide covering all key points from existing workflow templates, including: running checks only on relevant file changes, fast-fail job ordering, fresh merge simulation, concurrency control, changeset exemptions for docs-only PRs, secrets detection, documentation validation, and OIDC trusted publishing.
  - **`docs/BEST-PRACTICES.md`** (new general guide) — Universal best practices for AI-driven development including: deep analysis bug/feature prompts, universal validation prompt, plan mode prompt, issue writing guidelines with acceptance criteria patterns, an architecture improvement prompt linking to the Code Architecture Principles repository, CI/CD summary with link to the CI/CD guide, and subagent coordination patterns.

  Also updates `README.md` to link to both new documents in the Best Practices section.

  feat: enable --auto-restart-until-mergeable by default (Issue #1360)

  The `--auto-restart-until-mergeable` feature has become stable enough to be enabled by default. Previously, users had to explicitly pass this flag to enable automatic restart until the PR becomes mergeable.

  Now the feature is enabled by default, meaning the solver will automatically restart on new comments from non-bot users, CI failures, merge conflicts, or other issues — without requiring any extra flags. Users who want to disable this behavior can pass `--no-auto-restart-until-mergeable`.

  fix: filter GitHub Pages deployment workflows from PR CI check (Issue #1399)

  `getActiveRepoWorkflows()` included the `pages-build-deployment` workflow (path: `dynamic/pages/pages-build-deployment`) as if it were a PR CI workflow. This workflow is auto-created by GitHub for GitHub Pages and only runs on the default branch after merge — it never creates check-runs on PR branches. As a result, `--auto-restart-until-mergeable` got stuck in an infinite loop waiting for CI checks that would never appear.

  The fix filters out workflows with the `dynamic/pages/` prefix from `getActiveRepoWorkflows()`. These are GitHub Pages internal workflows, not user-defined CI pipelines.

  Affected scenario: repositories with GitHub Pages enabled but no `.github/workflows/` files (e.g., `konard/links-visuals`).

  fix: resolve Prettier formatting issue in README.md (Issue #1401)

  The CI/CD `lint` job was failing on the `main` branch because README.md had Prettier formatting violations after commit `da376061` ("Clarify Time Freedom and Any Device Programming features"). That commit added longer text to two table cells, which made the table column widths inconsistent with Prettier's expected format.

  The fix runs `prettier --write` on README.md to re-align the table column widths, bringing the file back into conformance with the `format:check` CI step.

## 1.27.0

### Minor Changes

- f6e909e: feat: make --gitkeep-file enabled by default for all --tools (Issue #1385)

  Previously, `--claude-file` was the default for `--tool claude`, while `--gitkeep-file` was the default for other tools. Now `--gitkeep-file` is the universal default for all `--tool` values, including `--tool claude`.

  As explained in the referenced video, CLAUDE.md and AGENT.md files generally do not help AI tools and should be avoided. Users who need CLAUDE.md-based task passing can still explicitly opt in with `--claude-file`.

## 1.26.4

### Patch Changes

- ff46719: fix: update default agent model to minimax-m2.5-free (Issue #1391)

  `kimi-k2.5-free` is no longer supported by OpenCode Zen and returns a `ModelError` (HTTP 401). The new default for `--tool agent` is now `minimax-m2.5-free`, matching the upstream fix in [agent PR #209](https://github.com/link-assistant/agent/pull/209).
  - `minimax-m2.5-free` is now the default model for `--tool agent`
  - `kimi-k2.5-free` is moved to the deprecated backward-compatibility section across all model maps
  - Updated `docs/FREE_MODELS.md` to reflect the new default and document `kimi-k2.5-free` as discontinued

## 1.26.3

### Patch Changes

- 864023d: Add case study and regression test for issue #1389: no `ready to merge` comment when `--auto-restart-until-mergeable` is enabled

  Documents root cause (checkForExistingComment searching all-time PR history in v1.25.7),
  timeline reconstruction from log b623ee9f, and confirms the fix from issue #1371 (in-memory
  readyToMergeCommentPosted flag) resolves the cross-session notification suppression.
  Adds test-ready-to-merge-cross-session-1389.mjs to prevent regression to the old approach.

## 1.26.2

### Patch Changes

- 72c933c: Skip empty Claude subsection headers when auth error occurs in /limits output

## 1.26.1

### Patch Changes

- 278415a: fix: post "Ready to merge" comment after auto-restart sequence with --auto-restart-until-mergeable (Issue #1371)

  When `--auto-restart-until-mergeable` was used after a regular auto-restart sequence (triggered by uncommitted changes), the "Ready to merge" comment was silently suppressed because `checkForExistingComment` found a matching comment from a previous `solve` run.

  The deduplication logic in `watchUntilMergeable` now uses an in-memory flag (`readyToMergeCommentPosted`) scoped to the current session, rather than searching all PR comment history. This correctly prevents duplicate comments within a single run while allowing new notifications when a fresh `solve` invocation starts.

## 1.26.0

### Minor Changes

- d96ae3b: feat: /merge command syncs ready tags between linked PRs and issues (Issue #1367)

  The `/merge` Telegram bot command now syncs the `ready` label between PRs and their linked issues before building the merge queue.
  - If a PR has the `ready` label and its body links to an issue via standard GitHub closing keywords (fixes/closes/resolves #N), the linked issue also gets the `ready` label
  - If an issue has the `ready` label and has a clearly linked open PR (found via body search), the PR also gets the `ready` label
  - Sync happens during `MergeQueueProcessor.initialize()`, before the final list of ready PRs is collected

## 1.25.8

### Patch Changes

- fix: update system messages to use authenticated curl for private GitHub issue images

  Images attached to GitHub issues/PRs (github.com/user-attachments/assets/\*) require authentication. Without auth, GitHub returns "Not Found" (9 bytes ASCII) with HTTP 200 — a silent failure. The AI would then call Read on the non-image file, encoding "Not Found" as base64, causing Anthropic API to return "Could not process image" (HTTP 400), crashing the session.

  Updated system messages in all 4 prompt files (claude, agent, codex, opencode) to explicitly identify user-attachments URLs as requiring GitHub authentication and provide the exact authenticated curl command using `gh auth token`.

  fix: auto-restart with --resume on "Request timed out" in --tool claude (Issue #1353)

  When Claude CLI encounters a network timeout, it exhausts its own internal retries and emits a synthetic result event: `{"type":"result","is_error":true,"result":"Request timed out","session_id":"..."}`. Previously hive-mind treated this as a fatal failure and exited, losing all session context (conversation history, cached tokens, partially completed work).

  This fix detects the timeout pattern and automatically retries with `--resume <session-id>` to preserve the session, using exponential backoff starting at 5 minutes (increasing to max 1 hour) — longer than regular API errors since Claude CLI has already exhausted its own retries before reporting the timeout.

## 1.25.7

### Patch Changes

- ad57ea6: fix: prevent false positive error detection when multi-line stderr chunks contain JSON warnings (Issue #1354)

  Previously, when Claude CLI emitted multiple JSON log lines in a single stderr chunk (newline-separated), the entire multi-line string was passed to `isStderrError()` as one unit. Since `JSON.parse()` would fail on two concatenated JSON objects, it fell through to keyword matching — finding words like `"failed"` inside warning messages — and incorrectly flagged a successful run as an error.

  Additionally, `messageCount === 0 && toolUseCount === 0` could fire even after a 60-turn successful session, because the counter only checked for `data.type === 'message'` but Claude CLI emits outer events as `"assistant"` type.

  Now the fix applies two targeted changes to `src/claude.lib.mjs`:
  1. **Split multi-line stderr chunks by newline** and check each line individually with `isStderrError()`, so valid JSON warning lines are correctly parsed and not conflated with error patterns.
  2. **Track `resultSuccessReceived`** when `data.type === 'result' && data.subtype === 'success'` is received, and add a `!resultSuccessReceived` guard to the false positive detection condition — ensuring a confirmed successful result prevents spurious error reporting.

  Full case study analysis including timeline reconstruction, root cause analysis, and evidence in `docs/case-studies/issue-1354/`.

## 1.25.6

### Patch Changes

- 5200c2a: Fix auto-restart spamming PR with comments when usage limit is reached (#1356)

  When the AI tool's usage limit is reached during --auto-restart-until-mergeable mode, the loop now:
  1. Detects the `limitReached` flag from the tool result
  2. Silently waits for the limit reset time plus a 10-minute buffer (no GitHub comment posted)
  3. Resumes the session using `--resume <sessionId>` with a "Continue" prompt, preserving context

  For non-limit tool failures, the loop now stops immediately instead of retrying, preventing infinite loops on unrecoverable errors.

## 1.25.5

### Patch Changes

- e0d68a4: fix: prevent false positive 'Ready to merge' for repos with CI but no required branch protection (Issue #1363)

  Previously, the auto-merge logic would incorrectly declare a PR "Ready to merge — no CI/CD configured" when a repository had GitHub Actions workflows but no required status checks in branch protection rules. This happened because:
  - `mergeStateStatus=CLEAN` (no required checks to block merging)
  - `check_runs=[]` (CI hadn't started yet — race condition, GitHub takes ~10-30s to register checks)

  The fix adds a workflow detection step (`getActiveRepoWorkflows`) that queries the GitHub Actions API to check if the repository has any active workflows. When workflows exist but no checks have started, the system now correctly identifies this as a race condition (CI hasn't started yet) rather than "no CI configured", and waits for the checks to appear before proceeding.

  Full case study analysis in `docs/case-studies/issue-1363/`.

## 1.25.4

### Patch Changes

- 2a670b0: fix: use universal GitHub blob URL format for screenshots to fix broken images in private repositories (Issue #1349)

  Previously, the system prompt instructed AI agents to embed screenshots using `raw.githubusercontent.com` URLs. These URLs always return HTTP 404 for private repositories because GitHub does not authenticate raw content requests when rendering PR description markdown.

  Now agents are instructed to use the `https://github.com/{owner}/{repo}/blob/{branch}/path?raw=true` URL format instead, which works for both public and private repositories. This simplifies the implementation by removing the need to check repository visibility at all.

## 1.25.3

### Patch Changes

- 0ed3ccb: fix: prevent --auto-restart-until-mergeable infinite loop when no CI/CD is configured (Issue #1345)

  Previously, when a repository had no GitHub Actions workflows configured, `--auto-restart-until-mergeable` would loop indefinitely because `getDetailedCIStatus()` returned `{ status: 'no_checks' }` and the code always treated this as a transient race condition (checks haven't started yet).

  Now the fix correctly handles the `no_checks` case by also checking `checkPRMergeable()`. If GitHub reports the PR as `MERGEABLE` (`mergeStateStatus: CLEAN`), the repository has no required CI checks and the process exits immediately with an appropriate message ("No CI/CD checks are configured for this repository — PR is mergeable"). If the PR is not yet mergeable, the existing wait behavior is preserved.

  Full case study analysis including timeline reconstruction from logs in `docs/case-studies/issue-1345/`.

## 1.25.2

### Patch Changes

- 0453550: feat: show all limits even when Claude authentication is expired (Issue #1343)

  Previously, when Claude authentication expired, the `/limits` command would fail completely and show no information at all.

  Now the command gracefully handles Claude auth failures:
  - The error message (e.g., "Claude authentication expired. Please use /solve or /hive commands to trigger re-authentication of Claude.") is shown inline in the Claude limits sections
  - All other limits sections (CPU, RAM, Disk space, GitHub API) continue to display normally

## 1.25.1

### Patch Changes

- 2a87d56: tests: expand unit tests for token accumulation logic (Issue #1313)

  Added comprehensive unit tests for the token accumulation fix (Issue #1250)
  that resolved the "Token usage: 0 input, 0 output" bug reported in Issue #1313.

  New test coverage includes:
  - End-to-end token display pipeline (accumulation → display format)
  - Large token count handling (millions of tokens across many steps)
  - NDJSON boundary cases (CRLF line endings, arrays, extra fields)
  - Accumulator state isolation (independent accumulators)
  - Exact reproduction of the Issue #1313 bug scenario
  - Demonstration of why the streaming fix was necessary (concatenated JSON)

  Total: 44 tests covering both `parseAgentTokenUsage` and streaming accumulation.

## 1.25.0

### Minor Changes

- cbac3dd: feat: wait for post-merge CI to complete before merging next PR (Issue #1341)

  This change ensures that the /merge command waits for GitHub Actions to complete after each merge before processing the next PR in the queue.

  **Problem:**
  - Merge queue was merging PRs too quickly (70 seconds apart)
  - Workflow runs were being cancelled (superseded by new commits)
  - Only one version published instead of multiple

  **Solution:**
  1. Check branch CI health before starting the queue
  2. Wait for post-merge CI after each successful merge
  3. Stop queue on CI failure (configurable)

  **New configuration options:**
  - `HIVE_MIND_MERGE_QUEUE_WAIT_FOR_POST_MERGE_CI` (default: true)
  - `HIVE_MIND_MERGE_QUEUE_STOP_ON_CI_FAILURE` (default: true)
  - `HIVE_MIND_MERGE_QUEUE_CHECK_BRANCH_HEALTH` (default: true)
  - `HIVE_MIND_MERGE_QUEUE_POST_MERGE_CI_TIMEOUT_MS` (default: 60 minutes)
  - `HIVE_MIND_MERGE_QUEUE_POST_MERGE_CI_POLL_INTERVAL_MS` (default: 30 seconds)

  **New API functions:**
  - `waitForCommitCI()` - Wait for workflow runs on a commit
  - `checkBranchCIHealth()` - Check for failed CI on a branch
  - `getMergeCommitSha()` - Get merge commit SHA for a PR

## 1.24.6

### Patch Changes

- Make `--auto-resume-on-limit-reset` enabled by default to improve user experience when hitting API rate limits. Previously defaulted to `false`, now defaults to `true` for both `solve` and `hive` commands. Users can explicitly disable with `--no-auto-resume-on-limit-reset` if needed.

  Fix false positive error detection for step_finish with reason stop

  When an agent encounters a timeout error during execution but successfully recovers and completes (indicated by `step_finish` with `reason: "stop"`), the error detection was incorrectly flagging this as a failure due to fallback pattern matching.

  The `agentCompletedSuccessfully` flag was only being set for `session.idle` and `"exiting loop"` log messages (Issue #1276), but not for the more common `step_finish` event with `reason: "stop"`. This meant the fallback pattern matching would still trigger and detect error patterns in the full output, even when the agent had clearly completed successfully.

  Fix: Add `step_finish` with `reason: "stop"` as a success marker in both stdout and stderr processing loops in `src/agent.lib.mjs`.

## 1.24.5

### Patch Changes

- 17317bb: fix: prevent false positive error detection for JSON-structured stderr warnings (Issue #1337)

  Claude Code SDK can emit structured JSON log messages to stderr with format `{"level":"warn","message":"..."}`. When these messages contained error-related keywords like "failed", the detection logic incorrectly flagged them as errors.

  Added JSON parsing for stderr messages starting with `{`. If the parsed JSON has a `level` field that is not `"error"` or `"fatal"`, the message is treated as a warning (non-error), preserving existing emoji-prefix detection as a fallback.

  Also enables `ANTHROPIC_LOG=debug` when running with `--verbose` flag, allowing users to see detailed API request information as suggested by the BashTool pre-flight warning.

## 1.24.4

### Patch Changes

- 40282f3: fix: escape '...' ellipsis in MarkdownV2 and retry on UNKNOWN merge state (Issue #1339)

  Two root causes fixed:
  1. **MarkdownV2 escaping**: In `formatProgressMessage()`, literal '...' was appended in PR titles, error messages, and overflow lines. Telegram's MarkdownV2 requires '.' to be escaped as '\.' - unescaped periods caused 400 Bad Request errors on every message update during CI wait.
  2. **UNKNOWN merge state**: GitHub computes PR mergeability asynchronously, so initial queries may return `mergeStateStatus: 'UNKNOWN'`. The old code immediately skipped PRs in this state. Fixed by adding retry logic to `checkPRMergeable()` that retries up to 3 times with 5-second delays before giving up.

## 1.24.3

### Patch Changes

- 297e07c: Fix incorrect iteration counter and duplicate comments in auto-restart mode
  - Fixed iteration counter to show actual AI restart count instead of check cycle number
  - Added deduplication check to prevent duplicate "Ready to merge" status comments
  - Added case study documentation for issue #1323

## 1.24.2

### Patch Changes

- a74e10c: fix: add auto-resume with session preservation on Internal Server Error (Issue #1331)

  When Claude tool returns `API Error: 500 Internal server error`, automatically retry with exponential backoff starting from 1 minute, capped at 30 minutes per retry, up to 10 retries. Session ID is preserved so Claude Code can resume from where it left off using `--resume <sessionId>`.

## 1.24.1

### Patch Changes

- 4b032ca: fix: use headRepository.name from PR data to construct fork name correctly

  Previously, when solving a PR from a fork where the fork's repository name
  differs from the base repository name, the tool incorrectly built the fork
  name using the base repo's name instead of the actual head repo name.

  Example failure scenario (Issue #1332):
  - Base repo: `konard/MILANA808-Milana-backend` (a fork itself)
  - PR head repo: `MILANA808/Milana-backend`
  - Tool tried: `MILANA808/MILANA808-Milana-backend` (wrong, 404)
  - Should try: `MILANA808/Milana-backend` (correct)

  The fix propagates `forkRepoName` (from `headRepository.name` in PR data)
  through the call chain: `solve.mjs` → `setupRepositoryAndClone` →
  `setupRepository`, where it's used as the correct source of truth for
  building fork repo names. Falls back to base repo name if unavailable.

  Also improves the error message when a fork cannot be found, clarifying
  that the fork name may differ from the base repo name.

## 1.24.0

### Minor Changes

- c93b8cd: Add support for Claude Sonnet 4.6 and set it as the default model for `--tool claude`
  - Added `claude-sonnet-4-6` as the new default model when using `sonnet` alias
  - Added `sonnet-4-6` short alias for explicit Sonnet 4.6 selection
  - Added backward compatibility aliases: `sonnet-4-5` and `claude-sonnet-4-5` for Sonnet 4.5
  - Added 1M token context window support for Sonnet 4.6 (`sonnet[1m]`, `sonnet-4-6[1m]`)
  - Maintained full backward compatibility with previous model versions

## 1.23.14

### Patch Changes

- 069d437: Parallelize version gathering with Promise.all for 6-30x performance improvement
  - Replaced sequential `execSync` calls with parallel `execAsync` using `Promise.all`
  - Reduced execution time from 30-150s to ~2-5s for version info gathering
  - Added support for all `--tool` options: agent, codex, opencode, qwen-code, gemini, copilot
  - Reorganized Telegram output to group tools by programming language instead of generic categories
  - Consolidated hive-mind version display to show single version with restart warning when process version differs from installed
  - Added `gatherTimeMs` metric to track performance

## 1.23.13

### Patch Changes

- af1f456: fix: suppress dotenvx MISSING_ENV_FILE warnings in hive-telegram-bot --version
  - Add early --version handling before loading dotenvx to avoid warnings
  - Add ignore: ['MISSING_ENV_FILE'] option to make .env file optional
  - Add tests for version output in tests/test-telegram-bot-version.mjs

## 1.23.12

### Patch Changes

- 50a69ae: Update free models: replace minimax-m2.1-free with minimax-m2.5-free

  OpenCode Zen:
  - Replace `minimax-m2.1-free` with `minimax-m2.5-free` (M2.1 no longer free)
  - Remove `glm-4.7-free` from recommended free models (no longer free)

  Kilo Gateway:
  - Add `glm-4.5-air-free` (agent-centric model)
  - Add `minimax-m2.5-free` (upgraded from M2.1)
  - Add `deepseek-r1-free` (advanced reasoning model)

  Breaking change: Users relying on `minimax-m2.1-free` or `glm-4.7-free` should switch to the updated models. Deprecated models are kept for backward compatibility but may not work.

## 1.23.11

### Patch Changes

- f1ba29d: Comprehensive CI/CD status handling for --auto-restart-until-mergeable mode
  - Detect when CI failures are caused by billing/spending limits via check run annotations
  - For private repositories: Post an explanatory comment and stop (requires human intervention)
  - For public repositories: Apply exponential backoff and wait (unusual case)
  - Distinguish between CI failure, cancelled, pending, queued, and billing limit states
  - Automatically re-trigger cancelled CI/CD workflow runs instead of restarting AI
  - Only restart AI when genuine code failures occur (not for cancelled/pending/billing)
  - Wait for all CI/CD checks to complete before deciding on AI restart
  - New functions: getDetailedCIStatus(), rerunWorkflowRun(), rerunFailedJobs(), getWorkflowRunsForSha()
  - Expanded test coverage: 45 tests covering all CI/CD status scenarios and decision logic

## 1.23.10

### Patch Changes

- cc57624: Add retry logic for fork validation network errors (Issue #1311). The validateForkParent function now retries up to 3 times with exponential backoff for transient network errors like TCP timeouts. Network errors now show a distinct error message with helpful retry suggestions instead of incorrectly reporting a fork parent mismatch.

## 1.23.9

### Patch Changes

- 4456760: Fix merge queue to wait for target branch CI before merging (Issue #1307). The merge queue now checks for active CI runs on the target branch (main) before processing the first PR in the queue. This prevents cancelled workflows, incomplete releases, and failed post-merge checks when multiple PRs are merged in quick succession.

## 1.23.8

### Patch Changes

- Fix spelling: rename --auto-restart-until-mergable to --auto-restart-until-mergeable throughout the codebase. This includes CLI options, function names, variable names, documentation, and code comments to use the correct English spelling.

  Increase limit reset buffer from 5 to 10 minutes and add random jitter (0-5 min) to avoid thundering herd problem when multiple instances wait for the same limit reset. Format reset time in PR comments with relative time and UTC timezone for better user understanding.

## 1.23.7

### Patch Changes

- d951635: Fix --auto-restart-until-mergeable false positive on empty CI checks

  The `--auto-restart-until-mergeable` mode was incorrectly posting "Ready to merge" when CI checks hadn't started yet. This was caused by JavaScript's vacuous truth: `[].every(fn)` returns `true`, so an empty checks array would pass all validation.

  Fix: Return `pending` status when no CI checks exist yet, instead of `success`.

## 1.23.6

### Patch Changes

- 0a7dbcf: Add exponential backoff retry when bot launch fails with 409 Conflict error (e.g., due to restart overlap, stale connections, or network issues). Retry schedule: 1s, 2s, 4s, ... up to 10 minutes max. Non-retryable errors (401 Unauthorized) still cause immediate exit.

## 1.23.5

### Patch Changes

- 28b7f22: Add code duplication detection with jscpd
  - Add .jscpd.json configuration for JavaScript code duplication detection
  - Add jscpd (^4.0.5) as devDependency
  - Add npm script: `npm run check:duplication`
  - Integrate code duplication check into CI workflow
  - Set 11% threshold baseline (current codebase level)

## 1.23.4

### Patch Changes

- 22a1940: fix: display skip/fail reasons in merge queue Telegram messages (#1294)

  Previously, when PRs were skipped or failed during merge queue processing, the Telegram message only showed the PR number without explaining why it was skipped. This left users unable to understand what action was required to resolve the issue.

  Now the merge queue displays the reason for each skipped or failed PR in both:
  - Progress messages (during processing)
  - Final report messages (after completion)

  Example output:

  ```
  Results:
  ⏭️ #1241 (Issue #1240): PR has merge conflicts
  ⏭️ #1257 (Issue #1256): PR has merge conflicts
  ```

  This change follows UX best practices for error messages by:
  - Showing the specific reason for each failure
  - Using clear, human-readable language
  - Helping users understand what action is needed

## 1.23.3

### Patch Changes

- a797e56: fix: escape owner/repo names for Telegram MarkdownV2 in /merge command

  Fixed the `/merge` command silently failing when updating Telegram messages for repositories with hyphens in their names (e.g., `link-assistant/hive-mind`). The issue was caused by unescaped special characters in MarkdownV2 format.

## 1.23.2

### Patch Changes

- 241ce36: Fix false error categorization and missing log upload for `--tool agent` auto-restart
  - Fix `isUsageLimitError()` "resets" pattern causing false positives when scanning code output
    - Changed from substring match to regex that requires time-like content after "resets"
    - Prevents ordinary English words like "loads a shell and resets" from triggering usage limit detection
  - Fix agent fallback pattern matching running after agent successfully recovered from errors
    - Skip fallback when exitCode=0 and agentCompletedSuccessfully to prevent false error detection
  - Upload failure logs when auto-restart iteration fails for `--tool agent` with `--attach-logs`
  - Add comprehensive tests for false positive scenarios (Issue #1290)

## 1.23.1

### Patch Changes

- 5c635fc: Fix agent tool error handling: upload failure logs to PR even when sessionId is not available
  - Remove overly strict sessionId requirement for failure log upload in solve.mjs
  - Add FreeUsageLimitError pattern detection for Agent/OpenCode Zen rate limits
  - Improve rate limit detection by checking multiple sources (lastMessage, errorMatch, fullOutput)
  - Add comprehensive case study documentation for issue #1287
  - Add tests for FreeUsageLimitError detection

## 1.23.0

### Minor Changes

- 7a74bc6: Add Kilo Gateway free models support for --tool agent

  This release adds support for 6 free models from Kilo Gateway:
  - `kilo/glm-5-free` - Z.AI flagship model (free for limited time)
  - `kilo/glm-4.7-free` - Z.AI agent-centric model
  - `kilo/kimi-k2.5-free` - MoonshotAI agentic model
  - `kilo/minimax-m2.1-free` - MiniMax general-purpose model
  - `kilo/giga-potato-free` - Evaluation model
  - `kilo/trinity-large-preview` - Arcee AI preview model

  Short aliases are also supported (e.g., `glm-5-free`, `kilo-glm-4.7-free`).

  Usage:

  ```bash
  solve https://github.com/owner/repo/issues/123 --tool agent --model kilo/glm-5-free
  /solve https://github.com/owner/repo/issues/123 --tool agent --model glm-5-free
  ```

  See docs/FREE_MODELS.md for comprehensive documentation.

  Fixes #1282

## 1.22.6

### Patch Changes

- ed87517: Fix: Add workaround for process stream hanging after completion (Issue #1280)

  After the Claude CLI sends the final result event, the `for await` loop over
  `command-stream`'s `stream()` can hang indefinitely. Root cause: `command-stream` v0.9.4's
  `stream()` async iterator waits for both process exit AND stdout/stderr pipe close before
  ending. If the CLI process keeps stdout open after sending the result, `pumpReadable()` hangs,
  `finish()` never fires, and the stream iterator never terminates.

  Additionally, `command-stream` v0.9.4 `stream()` does NOT yield `{type:'exit'}` chunks,
  making the exit code detection via `chunk.type === 'exit'` dead code (exit code is obtained
  from `execCommand.result.code` after the loop instead).

  Workaround: after receiving the result event, start a configurable timeout (default 30s,
  `HIVE_MIND_RESULT_STREAM_CLOSE_MS`) to force-kill the process with SIGTERM/SIGKILL.

  Related: https://github.com/link-foundation/command-stream/issues/155

## 1.22.5

### Patch Changes

- fdd8eaa: Fix auto-merge failure in fork mode with permission pre-check (Issue #1226)
  - Add fork-mode guard in `startAutoRestartUntilMergeable()` to detect when `--auto-merge` cannot work
  - Add `checkMergePermissions()` function to verify write/push/admin/maintain access before merge attempts
  - Add permission pre-check in `attemptAutoMerge()` to fail fast when user lacks write access
  - Post "Ready to merge" comment to PR when auto-merge cannot be performed due to permissions
  - Prevent silent failures and infinite restart loops in fork mode scenarios

## 1.22.4

### Patch Changes

- 2204f18: Fix workflow cancellation blocking by replacing always() with !cancelled() in Docker jobs (Issue #1278)
  - Replace `always()` with `!cancelled()` in all Docker publish and Helm release job conditions
  - Allow concurrency cancellation to properly interrupt Docker builds when new commits are pushed
  - Reduce Docker job timeout from 60 to 30 minutes to minimize blocking time
  - Fix issue where PR merges to main branch did not trigger releases due to stuck workflow runs

## 1.22.3

### Patch Changes

- 34a6937: Fix false positive error detection when agent recovers from transient errors (Issue #1276)
  - Trust exit code 0 as authoritative indicator of success even if errors occurred during execution
  - Clear streaming error detection when agent completes successfully (emits session.idle or "exiting loop")
  - Fix message extraction to prefer "error" field over "message" field for agent error events
  - Add tests for agent recovery scenarios and false positive prevention

## 1.22.2

### Patch Changes

- 5b018dc: fix: prevent CI/CD release blocking by enabling cancel-in-progress for main branch (Issue #1274)

  When multiple commits are pushed to main quickly (e.g., multiple PRs merged in succession),
  the old concurrency configuration would queue newer runs indefinitely until older runs complete.
  This caused releases to be blocked when Docker ARM64 builds took too long.

  Changes:
  - Add `cancel-in-progress: true` for main branch to allow newer releases to proceed
  - PR branches still queue runs to avoid cancelling checks during development
  - Document the issue and solution in docs/case-studies/issue-1274/

## 1.22.1

### Patch Changes

- fix: add --merge flag to gh pr merge command to prevent "not running interactively" error (Issue #1269)

  The merge queue was stuck because `gh pr merge` requires an explicit merge method flag
  (`--merge`, `--squash`, or `--rebase`) when running in a non-interactive context.
  Without a merge method, the command would fail with:
  "--merge, --rebase, or --squash required when not running interactively"

  This fix:
  - Adds `--merge` flag by default to the `mergePullRequest()` function
  - Adds `mergeMethod` option to configure the merge strategy ('merge', 'squash', 'rebase')
  - Adds `HIVE_MIND_MERGE_QUEUE_MERGE_METHOD` environment variable for configuration

  Fix release notes to show ALL related pull requests when multiple PRs are merged before a release (Issue #1271)
  - Extract ALL commit hashes from changelog entry (not just the first one)
  - Look up PRs for each commit hash via GitHub API
  - Display all unique PR numbers in release notes (e.g., "Related Pull Requests: #1268, #1270")
  - Use plural "Pull Requests" label when multiple PRs are found
  - Add comprehensive case study documentation in docs/case-studies/issue-1271/

## 1.22.0

### Minor Changes

- c000f7b: Add `--attach-solution-summary` and `--auto-attach-solution-summary` options

  This feature allows users to automatically attach the AI's result summary as a PR/issue comment:
  - `--attach-solution-summary`: Always attach the solution summary when available
  - `--auto-attach-solution-summary`: Only attach the summary if the AI didn't create any comments during the session

  The solution summary is extracted from the JSON output stream of all AI tools (claude, agent, codex, opencode). Each tool captures the last text content from various JSON event types (text, assistant, message, result) to provide a summary of the work done.

  Fixes #1263

## 1.21.4

### Patch Changes

- ea19c72: Fix queue issues: rejection, display, and formatting
  - Fix disk rejection not blocking queue placement when threshold exceeded
  - Restore "used" label on progress bars when below threshold
  - Show per-queue breakdown in /limits command
  - Group queue items by tool and use human-readable time in /solve_queue

- aa42f3a: fix: improve merge queue error handling and debugging (Issue #1269)
  - Always log errors (not just in verbose mode) for critical merge queue failures
  - Always notify users via Telegram when merge queue fails unexpectedly
  - Add timeout wrapper (60s) for onStatusUpdate callback to prevent infinite blocking
  - Add error handling for CI check failures in waitForCI loop
  - Add comprehensive case study documentation in docs/case-studies/issue-1269/

## 1.21.3

### Patch Changes

- 4426112: Fix error detection for `--tool agent` when JSON errors are pretty-printed (Issue #1258)
  - Add fallback pattern matching for error events when NDJSON parsing fails
  - Detect `"type": "error"` and `"type": "step_error"` patterns in raw output
  - Detect critical error patterns like `AI_RetryError` and `UnhandledRejection`
  - Extract error messages from output for better error reporting

## 1.21.2

### Patch Changes

- 586b84d: Add retry mechanism for GitHub 500 errors during repository clone

  This change adds intelligent retry logic with exponential backoff to handle transient GitHub server errors during repository cloning operations.

## 1.21.1

### Patch Changes

- fbfc0c3: Fix `--tool agent` pricing display for free models (Issue #1250)
  - Add base model pricing lookup for free model variants (e.g., `kimi-k2.5-free` → `kimi-k2.5`)
  - Show actual market price as "Public pricing estimate" based on the underlying paid model
  - Display base model reference in cost output: "(based on Moonshot AI kimi-k2.5 prices)"
  - Distinguish between truly free models and free access to paid models
  - Fix token usage showing "0 input, 0 output" by accumulating tokens during streaming
  - Token accumulation now happens in real-time as step_finish events arrive, avoiding NDJSON concatenation issues

## 1.21.0

### Minor Changes

- 6cf54b7: Add configurable queue threshold strategies (reject, enqueue, dequeue-one-at-a-time)
  - Add three handling strategies for each queue threshold:
    - `reject`: Immediately reject the command, no queueing
    - `enqueue`: Block and wait in queue until metric drops
    - `dequeue-one-at-a-time`: Allow one command, block subsequent
  - Support configuration via `HIVE_MIND_QUEUE_CONFIG` environment variable (links notation format)
  - Support individual strategy env vars (e.g., `HIVE_MIND_DISK_STRATEGY`)

  **Breaking change:** Disk threshold default strategy changed from `dequeue-one-at-a-time` to `reject`
  because the queue is lost on server restart. To restore old behavior: `HIVE_MIND_DISK_STRATEGY=dequeue-one-at-a-time`

## 1.20.1

### Patch Changes

- 1689caf: Fix agent tool pricing display to show correct provider
  - Add proper model mapping for free models (kimi-k2.5-free, gpt-4o-mini, etc.)
  - Add getProviderName helper function to detect provider from model ID
  - Prioritize provider from model ID over API response to fix issue #1250
  - Display correct provider names: Moonshot AI, OpenAI, Anthropic instead of generic "OpenCode Zen"

## 1.20.0

### Minor Changes

- 98a7582: Set kimi-k2.5-free as default model for --tool agent and enhance documentation with free model examples.

## 1.19.0

### Minor Changes

- 64687ce: Add support and documentation for free AI models:
  - Added support for opencode/big-pickle, opencode/gpt-5-nano, opencode/kimi-k2.5-free, opencode/glm-4.7-free, opencode/minimax-m2.1-free
  - Updated model mapping and validation to handle free models
  - Created comprehensive documentation in FREE_MODELS.md
  - Added tests for all free model support
  - Created case study analysis for issue #1244

## 1.18.0

### Minor Changes

- 6b7f026: Add threshold markers to /limits command progress bars

  This change implements visual threshold markers in the progress bars displayed by the /limits command. Users can now see:
  - **Threshold position marker (│)**: Shows where queue behavior changes (e.g., blocking, one-at-a-time mode)
  - **Warning emoji (⚠️)**: Appears when usage exceeds the threshold

  Thresholds displayed:
  - RAM: 65% (blocks new commands)
  - CPU: 65% (blocks new commands)
  - Disk: 90% (one-at-a-time mode)
  - Claude 5-hour session: 65% (one-at-a-time mode)
  - Claude weekly: 97% (one-at-a-time mode)
  - GitHub API: 75% (blocks parallel claude commands)

  Example output:

  ```
  CPU
  ▓▓▓▓▓▓▓░░░░░░░░░░░░│░░░░░░░░░░ 25%
  0.04/6 CPU cores used

  Claude 5 hour session
  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│▓ 98% ⚠️
  Resets in 2h 10m (Dec 6, 12:00pm UTC)
  ```

  Fixes #1242

## 1.17.2

### Patch Changes

- ae013b3: Default thinking budget to zero (thinking disabled by default), align Opus 4.6 max thinking budget with standard models (31999), change `opus` alias to map to Opus 4.5 by default (supports both `opus-4-5` and `opus-4-6` aliases)

## 1.17.1

### Patch Changes

- 0e59647: Fix /solve-queue command: register /solve_queue handler, fix hint text to use underscore instead of hyphen (Telegram Bot API only supports underscores in command names)

## 1.17.0

### Minor Changes

- 52cef77: feat: automatic solve option forwarding from hive config (issue #1209)

  Refactored hive-to-solve option forwarding to be fully automatic. New solve options are now
  automatically available in hive and TELEGRAM_HIVE_OVERRIDES without manual code changes.
  - Extracted `SOLVE_OPTION_DEFINITIONS` from solve.config.lib.mjs as a shared data structure
  - hive.config.lib.mjs auto-registers all solve options (minus hive-only and solve-only exclusions)
  - hive.mjs uses a generic forwarding loop instead of per-option if statements
  - Added `getSolvePassthroughOptionNames()` export for programmatic access to passthrough list

## 1.16.1

### Patch Changes

- f596d3e: Fix branch checkout failure when PR is from fork with different naming convention

## 1.16.0

### Minor Changes

- 5f78253: Add Claude Opus 4.6 model support with [1m] suffix
  - `opus` alias now defaults to `claude-opus-4-6` (latest and most capable Opus model)
  - Added shorter version aliases: `opus-4-6`, `opus-4-5`, `sonnet-4-5`, `haiku-4-5`
  - Added `claude-haiku-4-5` alias for consistency
  - `[1m]` suffix enables 1 million token context window for supported models
  - Opus 4.6 gets 128K max output tokens and 64K thinking budget
  - Backward compatibility: `claude-opus-4-5` maps to `claude-opus-4-5-20251101`

## 1.15.2

### Patch Changes

- 5723a93: fix: prevent early exit when --auto-merge flag is used

  The `verifyResults()` function was calling `safeExit(0)` before the auto-merge logic could run. This caused the `--auto-merge` flag to be silently ignored. Now the exit condition properly checks for `argv.autoMerge|autoRestartUntilMergeable` and `argv.autoMerge|autoRestartUntilMergeable` flags.

## 1.15.1

### Patch Changes

- docs: Expand auto-cleanup case study with 9 additional solutions (Issue #912)

  Expanded the case study analysis from 6 to 15 solutions covering:
  - OOM protection (earlyoom, systemd-oomd, OOM score tuning)
  - Resource isolation (cgroups via systemd)
  - Log management (logrotate)
  - Process monitoring (Monit, Supervisord)
  - Event-driven cleanup (incron)
  - Resource watchdog scripts
  - Kubernetes liveness probes and resource limits

  Added tiered recommendation system (Essential, Recommended, Advanced) and updated implementation guide with steps for earlyoom, OOM score tuning, cgroup limits, and logrotate configuration.

  Extract message filter functions to testable module with 34 unit tests for message recognition pipeline (issue #1207)

## 1.15.0

### Minor Changes

- c5dad3c: feat: add --auto-restart-on-non-updated-pull-request-description option (Issue #1162)

  When using `--tool agent` mode, the pull request title and description could remain
  in their initial WIP placeholder state. This adds an opt-in `--auto-restart-on-non-updated-pull-request-description`
  flag that detects placeholder content after agent execution and auto-restarts with a
  short factual hint. Also adds gentle checklist suggestions to agent/opencode/codex prompts
  (excluding Claude, which handles PR updates naturally).

## 1.14.2

### Patch Changes

- 69a34a6: fix: NDJSON stream buffering for Claude CLI output (Issue #1183)

  Fixed issue where `total_cost_usd` and other critical fields were not being captured from Claude CLI sessions when the output JSON was split across multiple stdout chunks.

  **Root Cause**: Claude CLI outputs NDJSON (newline-delimited JSON) format, but long JSON messages (like the `result` type containing `total_cost_usd`) can be split across multiple stdout buffer chunks. The code was splitting each chunk by newlines and parsing independently, causing partial JSON fragments to fail parsing.

  **Solution**:
  - Implemented line buffering to accumulate incomplete lines across chunks
  - Lines are only parsed when they're complete (have a trailing newline)
  - Added processing of any remaining buffer content after the stream ends

  This ensures that even very long JSON output (e.g., result messages with extensive usage data) is properly parsed and cost tracking works correctly.

  **Evidence from logs**: The broken session showed JSON truncated mid-word at `ephemeral_5m_input_tok` continuing on the next line with `ens":97252}}` - making both lines unparseable.

## 1.14.1

### Patch Changes

- b139b00: fix: detect agent tool errors during streaming for reliable failure detection (Issue #1201)

  Previously, agent tool errors (`"type": "error"`) could be missed when the post-hoc
  detection function failed to parse NDJSON lines that were concatenated without newline
  delimiters. Now errors are detected inline during stream processing, ensuring
  `"type": "error"` events always trigger a failure exit regardless of output buffering.

## 1.14.0

### Minor Changes

- 3a48254: Add configurable experiments/examples folder paths with ability to disable

  New CLI options for both `solve` and `hive` commands:
  - `--prompt-experiments-folder <path>`: Path to experiments folder used in system prompt. Set to empty string to disable experiments folder prompt. Default: `./experiments`
  - `--prompt-examples-folder <path>`: Path to examples folder used in system prompt. Set to empty string to disable examples folder prompt. Default: `./examples`

  Features:
  - Backwards compatible: defaults to `./experiments` and `./examples` as before
  - Custom paths: Specify custom folder paths for experiments and examples
  - Disable functionality: Set to empty string (`''`) to disable the experiments/examples prompt section entirely
  - Works with all AI tools: claude, opencode, codex, and agent

## 1.13.0

### Minor Changes

- 03adcb6: Add --auto-merge and --auto-restart-until-mergeable options for autonomous PR management

  New CLI options:
  - `--auto-merge`: Automatically merge the pull request when CI passes and PR is mergeable. Implies --auto-restart-until-mergeable.
  - `--auto-restart-until-mergeable`: Auto-restart the AI agent until PR becomes mergeable (no iteration limit). Restarts on new comments from non-bot users, CI failures, merge conflicts, or uncommitted changes. Does NOT auto-merge.

  Features:
  - Non-bot comment detection with configurable bot patterns
  - Automatic detection of CI/CD status and merge readiness
  - Continuous monitoring loop with configurable check intervals
  - Progress and status reporting throughout the process
  - Graceful handling of API errors with exponential backoff
  - Session data tracking for accurate pricing across iterations

## 1.12.0

### Minor Changes

- 8393f99: Improve auto-resume-on-limit-reset functionality
  - Add 5-minute buffer after limit reset to account for server time differences (configurable via HIVE_MIND_LIMIT_RESET_BUFFER_MS)
  - Add --auto-restart-on-limit-reset option for fresh start without previous session context
  - Remove CLI commands from GitHub comments when auto-resume is active (less confusing for users)
  - Differentiate work session comments: "Auto Resume (on limit reset)" vs "Auto Restart (on limit reset)"
  - Differentiate solution draft log comments based on session type
  - Improve reset time formatting with relative time + UTC (e.g., "in 1h 23m (Jan 15, 7:00 AM UTC)")

## 1.11.6

### Patch Changes

- 5eef9e4: Skip Claude API limits for --tool agent tasks in queue
  - Agent tools (Grok Code, OpenCode Zen) use different backends with their own rate limits
  - Add tool parameter to canStartCommand() and checkApiLimits() functions
  - Skip Claude-specific limits (5-hour session, weekly) when tool is 'agent'
  - Consumer loop now passes next queue item's tool to limit checks
  - Add 7 new tests for tool-specific limit handling
  - Add case study documentation

  Fixes #1159

## 1.11.5

### Patch Changes

- 7d3387c: Fix duplicate Solution Draft Log comments on GitHub PRs

  When a Claude session ends with uncommitted changes and --attach-logs is enabled, the solution draft log was being uploaded twice - once by verifyResults() during normal completion, and again after temporary watch mode completes. This fix tracks whether logs were already uploaded and skips the duplicate upload.

## 1.11.4

### Patch Changes

- b8318dd: fix: support opencode/gpt-5-nano and gpt-5-nano for --tool agent (Issue #1185)

  Fixed AGENT_MODELS mapping to correctly support free OpenCode Zen models:
  - `gpt-5-nano` short alias now correctly maps to `opencode/gpt-5-nano` (previously incorrectly mapped to `openai/gpt-5-nano`)
  - `opencode/gpt-5-nano` full model ID is now recognized as valid
  - Updated `mapModelToId` function in agent.lib.mjs to use correct provider prefix
  - Fixed regex filter in `getAvailableModelNames` to include `gpt-5-nano` in available models display
  - Added comprehensive test suite with 18 tests for agent model validation
  - Added case study documentation with root cause analysis

## 1.11.3

### Patch Changes

- 9f24356: Fix 'ready' label not being created by /merge command

  Two bugs prevented the /merge command from creating the 'ready' label:
  1. `checkReadyLabelExists()` incorrectly treated GitHub API's 404 JSON error response as the label existing. The function now properly checks for "Not Found" message in the response.
  2. `createReadyLabel()` used bash-specific heredoc syntax (`<<<`) which fails in `/bin/sh`. Now uses `gh api -f` flags for shell compatibility.

  Fixes #1177

## 1.11.2

### Patch Changes

- 8ee116a: fix: detect "command not found" errors to prevent false success

  When the `claude` CLI command is not found (not installed or not in PATH), the tool was incorrectly reporting "Claude command completed" instead of detecting the failure. This fix adds "not found" to the stderr error detection pattern to properly detect when commands fail to start.

## 1.11.1

### Patch Changes

- de2cc28: Use .gitkeep by default for --tool agent/opencode/codex instead of CLAUDE.md

  When using non-Claude tools (agent, opencode, codex), the system now defaults to creating a `.gitkeep` file for task details instead of `CLAUDE.md`. This prevents pollution of CLAUDE.md, which has special meaning for Claude Code as a project-level instruction file.

  **Tool-Specific Defaults:**
  - `--tool claude`: defaults to `--claude-file` (existing behavior)
  - `--tool agent/opencode/codex`: defaults to `--gitkeep-file`

  Users can still explicitly override defaults with `--claude-file` or `--gitkeep-file` flags regardless of the selected tool.

## 1.11.0

### Minor Changes

- ca28333: Add system prompt guidance for visual UI work when model supports vision

  **Changes:**
  - Add `checkModelVisionCapability` function in claude.lib.mjs to detect if a model supports image input using models.dev API
  - Add vision-specific system prompt section in claude.prompts.lib.mjs and agent.prompts.lib.mjs
  - When model supports vision, add guidance for including screenshots/renders of visual UI changes in pull request descriptions
  - Use "When x, do y." style as requested

  **Vision prompt guidance includes:**
  - When working on visual UI changes, include a render or screenshot in the PR description
  - When showing visual results, save screenshots to the repository (e.g., docs/screenshots/)
  - When referencing images, use permanent raw file links in the PR description markdown
  - When uploading images, commit them first, then use raw GitHub URL format
  - When the visual result is important, mention it explicitly with embedded image

  **Technical details:**
  - Uses models.dev API to check if 'image' is in the model's input modalities
  - All current Claude models (opus, sonnet, haiku) support vision
  - Gracefully handles unknown models by returning false

  Fixes #1175

## 1.10.2

### Patch Changes

- e1ed8fc: fix: enable large log file uploads using gh-upload-log (issue #1173)
  - Remove premature 25MB size check that incorrectly rejected large log files
  - Files larger than 25MB now use gh-upload-log which can handle any size
  - Default to private visibility when repository visibility cannot be determined (safer for private repos)
  - Add case study documentation for issue #1173

## 1.10.1

### Patch Changes

- 24e70f8: Fix agent --verbose output by properly handling stderr stream
  - Agent CLI sends ALL output (including verbose logs and structured events) to stderr, not stdout
  - Previous code only processed stdout with JSON parsing, treating stderr as plain error text
  - Now stderr is processed the same way as stdout: NDJSON line-by-line parsing with JSON formatting
  - Session IDs are now correctly extracted from stderr messages
  - stderr output is now collected for error detection

  Fixes #1151

## 1.10.0

### Minor Changes

- 9b56b26: feat(solve): configure MCP_TIMEOUT and MCP_TOOL_TIMEOUT for claude tool calls

  Added MCP timeout configuration to prevent tool calls from hanging indefinitely:
  - Added `mcpTimeout` config (default: 900000ms / 15 minutes) for MCP server startup
  - Added `mcpToolTimeout` config (default: 900000ms / 15 minutes) for MCP tool execution
  - Support for override via `MCP_TIMEOUT`/`HIVE_MIND_MCP_TIMEOUT` and `MCP_TOOL_TIMEOUT`/`HIVE_MIND_MCP_TOOL_TIMEOUT` environment variables
  - Updated `getClaudeEnv()` to pass both timeout values to Claude CLI
  - Added verbose logging for MCP timeout values

  Fixes #1066

## 1.9.2

### Patch Changes

- d39bf3e: Fix disk threshold to use one-at-a-time mode instead of blocking all commands
  - When disk usage exceeds threshold (90%), now allows exactly one command to run
  - Previously, disk threshold blocked ALL commands unconditionally (like RAM/CPU)
  - Now matches behavior of Claude API thresholds (CLAUDE_5_HOUR_SESSION_THRESHOLD, CLAUDE_WEEKLY_THRESHOLD)
  - Allows controlled task execution during high disk usage while preventing multiple tasks from exhausting resources

  Fixes #1155

## 1.9.1

### Patch Changes

- 06da02c: Improve /accept_invites command output with grouped items and real-time updates

  **Changes:**
  - Group output by "Repositories:" and "Organizations:" instead of repeating "Repository:" for each item
  - Add clickable GitHub links for each repository and organization
  - Implement real-time message updates after each invitation is processed
  - Show progress indicator (e.g., "Processing GitHub Invitations (3/10)") during processing

  Fixes #1148

## 1.9.0

### Minor Changes

- e15f307: Add bidirectional translation between --think and --thinking-budget options for Claude Code

  **Changes:**
  - Add 'off' option to --think values: ['off', 'low', 'medium', 'high', 'max']
  - Add --thinking-budget-claude-minimum-version option (default: 2.1.12)
  - For Claude Code >= 2.1.12: translate --think to --thinking-budget (off→0, low→8000, medium→16000, high→24000, max→31999)
  - For Claude Code < 2.1.12: translate --thinking-budget back to --think thinking keywords
  - Both options now coexist and support all Claude Code versions

  **Rationale:**
  Claude Code v2.1.12+ no longer responds to thinking keywords (think, think hard, ultrathink) because extended thinking is enabled by default. The only way to control thinking budget programmatically is via MAX_THINKING_TOKENS environment variable.

  Fixes #1146

## 1.8.0

### Minor Changes

- 53e1686: Add experimental /merge command to hive-telegram-bot for sequential PR merging
  - New `/merge <repository-url>` command to process merge queues
  - Automatically checks/creates 'ready' label in repository
  - Merges PRs with 'ready' label sequentially (oldest first)
  - Waits for CI/CD completion between each merge
  - Includes `/merge_cancel` and `/merge_status` helper commands
  - Supports linking issues to PRs (uses minimum creation date for ordering)

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
