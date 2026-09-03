---
'@link-assistant/hive-mind': patch
---

Authenticate git downloads so a run no longer dies with `Reason: Repository setup failed` (issue #2192).

A run ended after three clone attempts, each answered by GitHub with `fatal: remote error: GitHub is temporarily limiting some unauthenticated downloads to protect the stability of the platform. Please retry later or authenticate.` — while every `gh api` call in the same process succeeded. Three defects lined up, and each is fixed:

- **Public clones were sent anonymously even though a token was available.** `gh auth setup-git` installs a credential helper, but git only consults a helper after the server answers `401`, and github.com answers `200` for a public repository. Measured with `GIT_TRACE_CURL=1`, a public `git clone`/`gh repo clone` sent **0** `Authorization` headers. The new `src/git-auth-transport.lib.mjs` sends the token preemptively via `http.https://github.com/.extraheader`, injected through `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n` environment variables (**3** headers now sent) — so the token never reaches `.git/config` or a command line, and every git child process (`clone`, `fetch`, `pull`, `push`, `gh repo clone`) inherits it. `HIVE_MIND_DISABLE_GIT_AUTH_TRANSPORT=1` opts out.
- **The refusal was reported as `Unknown error`.** `classifyCloneError` now returns `ANONYMOUS_RATE_LIMIT`, and `src/transient-errors.lib.mjs` gains the shared `github-anonymous-rate-limit` category, so the log names the real cause and the "How to fix" section stops suggesting `gh auth login` to an already-logged-in run.
- **Retries only slept.** The clone loop and `gitCmdRetry` now upgrade the transport before the next attempt, falling back to `gh-setup-git-identity --repair` (non-interactive) when no token is reachable; only a genuinely absent token still fails.

Authentication now happens *before* the first clone in `setupRepositoryAndClone`, `review`, and `create-test-repo`. Full analysis, the run log excerpts and a reproduction script are in `docs/case-studies/issue-2192/`.
