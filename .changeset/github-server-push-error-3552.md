---
'@link-assistant/hive-mind': patch
---

A push answered by GitHub with `remote: fatal error in commit_refs` / `[remote rejected] … (failure)` is now treated as a transient GitHub server error, not a branch divergence (#3552):

- `git push`/`fetch`/`pull` retry it with the usual backoff instead of giving up after one attempt (`transient=no`).
- If every retry fails, the solver reports `GitHub server error while pushing …` and tells the user to check githubstatus.com and rerun. It no longer says "Local and remote branch histories differ" or asks the user to merge a branch that does not exist on the remote.
- Push explanations no longer claim "the remote branch changed" when the remote branch does not exist.
- The release version push retries such errors without rebasing, and the Helm `gh-pages` pushes retry them too.
- In verbose mode, the push-rejection classification and the remote branch state are logged.

Every GitHub operation now goes through one shared retry loop, and lint enforces it (#3552 review):

- command-stream's `$` resolves a failed `gh` call instead of rejecting, so `gh` commands sent through `wrapDollarWithGhRetry` ran only once, rate limits and 5xx included. `retryGitHubOperation` (`src/github-operation-retry.lib.mjs`) retries both shapes. `ghWithRateLimitRetry`, `ghRetry`, `ghCmdRetry`, `gitCmdRetry`, the runner and sync adapters, and the release scripts all use it in place of their own loops.
- `wrapDollarWithGitRetry` (codex, agent, gemini, opencode, qwen) now retries `gh` too, and wrapping an executor twice no longer nests two loops.
- Previously unretried call sites in `src/` and `scripts/` are routed through the shared loop. A retried `gh issue create` checks for the created issue first, so it is never filed twice.
- The `gh-rate-limit` ESLint rules decide per call site, not per file. They cover the `spawn`/`execFile` argv style and, for git, `scripts/`.
- Shell scripts and workflow steps run GitHub operations through `node scripts/github-retry.mjs …`. `scripts/check-github-retry-shell.mjs`, which is part of `npm run lint`, rejects any that do not. A deliberate single shot is marked `github-retry-ok: <reason>`.

Also brings the pins that the CI dependency-freshness gate reported as stale up to date: `start-command` 0.38.0 (all Dockerfiles), `links-notation` 0.27.1 (use-m pins), and the `ignore` lockfile entry 7.0.13.
