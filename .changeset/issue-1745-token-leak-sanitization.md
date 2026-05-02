---
"@link-assistant/hive-mind": patch
---

Sanitize all user-facing output to prevent token leaks (#1745).

- All comment-posting paths (`postComment`, `editComment`, `postTrackedComment`) run bodies through `sanitizeOutput` (canonical name) / `sanitizeCommentBody` (active-token wrapper). `sanitizeLogContent` is preserved as a backward-compatible alias.
- `KNOWN_LOCAL_TOKEN_ENV_VARS` registry masks tokens by exact env value (Telegram, GitHub, Anthropic/Claude, OpenAI/Codex, Gemini/Google, Qwen/Dashscope, OpenCode, AgentCLI, HuggingFace).
- Three independent CLI flags: `--dangerously-skip-output-sanitization`, `--dangerously-skip-code-output-sanitization`, `--dangerously-skip-active-tokens-output-sanitization` — all default false; active-tokens skip stays separate so the broad skip flag still keeps active-token masking on.
- Process-wide sanitization counters (`getSanitizationStats`, `formatSanitizationSummary`) print a one-line summary at the end of each run with a hint to use `--dangerously-skip-output-sanitization` when masking blocks the user's workflow.
- `extractTokensFromUserContent` carve-out helper: tokens already present in user-provided content (issue body, non-bot comments, pre-existing code) are passed as `excludeTokens` so the sanitizer leaves them untouched while still masking active local tokens.
- Post-finish sweep (`runPostFinishSweep`) re-reads bot-authored PR comments and the PR description after the AI session completes and edits in place if a leak slipped past the live sanitizer.
- ESLint guardrail (`gh-rate-limit/require-sanitized-output`) flags raw `gh pr comment`, `gh issue comment`, `gh pr edit`, and `gh api .../comments` calls that bypass the sanitizer.
- Out-of-band Telegram leak DM with masked summaries when a known-local token is detected in an outbound comment.
- Hidden owner-only `/tokens` Telegram command lists configured tokens (always masked, private chat only).
- `maskToken` defaults to 3+3 characters per issue requirements.
- secretlint preset (best-of-breed) runs alongside our custom patterns; mismatch warnings surface gaps.
