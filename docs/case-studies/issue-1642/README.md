# Issue 1642 Case Study: Quiet Claude Code Solve Runs

## Summary

Issue #1642 requests deterministic, quiet Claude Code execution for the `solve` command and Docker images. The root cause was local to hive-mind: Claude subprocesses inherited host Claude Code configuration, `solve` did not merge required quiet settings into `~/.claude/settings.json`, and Docker images only pre-seeded the issue #1627 `disallowedTools` defaults.

Later PR feedback expanded the scope: the quiet configuration must be available as a reusable `configure-claude` package bin, and Docker images must be built only after the npm package version containing that bin is published and visible in the registry.

## Collected Data

- `data/issue-1642.json`: issue title, body, comments, timestamps, and metadata.
- `data/issue-1642-comments.json`: issue discussion, including the case-study requirement.
- `data/pr-1643.json`: current prepared pull request metadata, body, comments, commits, and merge state.
- `data/pr-1643-comments.json`: full PR conversation comment payloads, including maintainer feedback and AI work-session logs.
- `data/pr-1643-review-comments.json` and `data/pr-1643-reviews.json`: PR inline review data; both were empty during investigation.
- `external/*.html`: downloaded official Claude Code documentation pages for configuration, environment variables, memory, interactive mode, and data usage.

## Timeline

- 2026-04-18 15:07 UTC: Issue #1642 opened with the requirement to disable noisy Claude Code features in `solve` and Docker.
- 2026-04-18 15:09 UTC: PR #1643 created as a draft for branch `issue-1642-51e94ad4ccf4`.
- 2026-04-18 15:09 UTC: Issue comment requested all related issue/PR data and external research be saved under `docs/case-studies/issue-1642`.
- 2026-04-18 16:09 UTC: PR feedback added attribution, co-author, reduced-motion, thinking-summary, verbose view, fast-mode, feedback-survey, mouse, away-summary, and tool-concurrency requirements; it also reversed the original `CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS` request by asking to keep git instructions enabled.
- 2026-04-18 17:26 UTC: PR feedback requested a reusable package bin named `configure-claude` for users and administrators.
- 2026-04-18 17:47 UTC: PR feedback clarified that Docker images must be built after npm publish and after verifying the package version is available, so Dockerfiles can run the published bin instead of copying repo source files.

## Requirements

- `solve` must read the global Claude settings file at `~/.claude/settings.json`, creating an empty object only if the file is absent.
- `solve` must override only the target keys, preserving unrelated user fields and unrelated nested `env`, `attribution`, and `permissions` fields.
- `solve` must merge these top-level settings: `autoMemoryEnabled=false`, `spinnerTipsEnabled=false`, `awaySummaryEnabled=false`, `feedbackSurveyRate=0`, `includeCoAuthoredBy=false`, `includeGitInstructions=true`, `prefersReducedMotion=true`, `showThinkingSummaries=false`, `skipDangerousModePermissionPrompt=true`, and `viewMode="verbose"`.
- `solve` must merge `attribution.commit=""`, `attribution.pr=""`, and `permissions.defaultMode="bypassPermissions"`.
- `solve` must merge and export these env vars: `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, `CLAUDE_CODE_DISABLE_CRON=1`, `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1`, `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1`, `CLAUDE_CODE_DISABLE_FAST_MODE=1`, `CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY=1`, `CLAUDE_CODE_DISABLE_MOUSE=1`, `CLAUDE_CODE_ENABLE_AWAY_SUMMARY=0`, `CLAUDE_CODE_ENABLE_TASKS=1`, `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY=4`, `CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1`, and `DISABLE_FEEDBACK_COMMAND=1`.
- `CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS` must not be set; built-in Claude git/PR instructions stay enabled through `includeGitInstructions=true`.
- `configure-claude` must ship as a reusable npm bin, apply the same settings by default, and support `--verify` for non-mutating drift detection.
- Dockerfiles must keep the env vars at image scope, install the exact published `@link-assistant/hive-mind` version, run `configure-claude --settings-path /workspace/.claude/settings.json`, and verify the result.
- CI/CD must publish npm first, wait until that exact version is visible in npm, and only then build Docker images with that version passed into the Docker build.
- Startup logs must make the effective quiet configuration auditable without logging unrelated user settings or secrets.

## External Research

- Claude Code settings documentation says user settings live in `~/.claude/settings.json`, and settings support an `env` object for environment variables that apply to every session: https://code.claude.com/docs/en/configuration
- Claude Code environment variable documentation confirms the quiet env vars used here, including auto-memory, CLAUDE.md, cron, terminal-title, feedback command, feedback survey, fast mode, mouse, away summary, tasks, concurrency, and interrupted-turn resume controls: https://code.claude.com/docs/en/env-vars
- Claude Code memory documentation confirms `autoMemoryEnabled=false` and `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` disable auto memory: https://code.claude.com/docs/en/memory
- Claude Code interactive mode documentation confirms session recap can be disabled by configuration: https://code.claude.com/docs/en/interactive-mode
- Claude Code data usage documentation confirms session quality surveys can be suppressed through settings such as `feedbackSurveyRate=0`: https://code.claude.com/docs/en/data-usage

## Root Causes

- `src/config.lib.mjs#getClaudeEnv()` exported Claude-specific limits and timeouts, but not the quiet env vars required by the issue and PR feedback.
- `src/claude.lib.mjs#executeClaudeCommand()` invoked Claude without verifying or merging global user settings first.
- `src/useless-tools.lib.mjs` already had a settings merge pattern for `disallowedTools`, but that helper was scoped to issue #1627 and did not cover noisy Claude Code features.
- The Dockerfiles originally embedded or copied local configuration code. That made PR Docker builds possible before npm publish, but conflicted with the maintainer requirement that Docker images use the package-published `configure-claude` command.

## Solution Plan

- Add `src/claude-quiet-config.lib.mjs` with the required env vars, required settings keys, subprocess env builder, and safe merge helper.
- Update `getClaudeEnv()` to overlay required env vars after `process.env` so host values cannot re-enable disabled features for Claude subprocesses.
- Call the settings merge helper from `executeClaudeCommand()` before launching Claude.
- Add `src/configure-claude.mjs` and `src/configure-claude.lib.mjs` as the reusable package bin and shared apply/verify runner.
- Update both Dockerfiles to install `@link-assistant/hive-mind@${HIVE_MIND_VERSION}` and run the published `configure-claude` bin directly.
- Update release CI so Docker publish jobs depend on npm publish, wait for npm availability, and pass the exact published version through the Docker build arg. PR Docker checks should statically verify this contract instead of building images before npm publish.
- Add regression tests for settings preservation, subprocess envs, bin apply/verify behavior, Dockerfile release contract, and global command installation.

## Reproduction And Verification

Before the fix, `node tests/test-claude-quiet-config.mjs` failed with:

```text
AssertionError [ERR_ASSERTION]: getClaudeEnv should force CLAUDE_CODE_DISABLE_AUTO_MEMORY=1
undefined !== '1'
```

After the fix, focused tests verify:

- every required env var is present in `getClaudeEnv()` and merged into settings `env`;
- unrelated settings, env, attribution, and permissions keys are preserved;
- `configure-claude` applies and verifies the same configuration;
- Dockerfiles install the exact published package version and run the published bin;
- CI waits for the npm package version before Docker builds.

## Upstream Reporting

No upstream Claude Code issue was filed. The external behavior needed here is documented; the defect was hive-mind not applying the documented configuration consistently in `solve`, the reusable package bin, and Docker release flow.
