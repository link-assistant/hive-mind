# Repository Operating Notes

## GitHub issue automation

- Use `/home/deploy/.local/bin/github-create-issue check --repo OWNER/REPO` to verify allowlisted GitHub App access without mutation.
- Use `github-create-issue create --repo OWNER/REPO --title "..." --body-file PATH` to create issues.
- Allowed repositories and installation IDs are stored in `/home/deploy/.config/codex-github/config.json`.
- Never read, print, copy, or commit `/home/deploy/.config/codex-github/private-key.pem`.

## Canonical development environment

- Use the maintained Docker Compose toolchain for installs, builds, tests, and audits.
- The canonical repository gate is `docker compose run --rm toolchain pnpm check`.
- Do not silently fall back to host Node, pnpm, Go, or other host tooling when the Docker workflow fails.
- Use `sh -c`, not `sh -lc`, for ad-hoc commands inside the toolchain; a login shell resets `PATH` and hides `/usr/local/go/bin`.
- Preserve unrelated user changes and inspect `git status` before non-trivial work.
- Read the nearest nested `AGENTS.md` before changing a scoped component. The rules in `packages/gcs-engine/AGENTS.md` are normative for the engine.

## Mandatory Superpowers implementation workflow

- Before inspecting implementation details or changing files for an implementation issue, invoke `superpowers:using-superpowers` from `plugin://superpowers@openai-curated-remote`.
- If the official Superpowers capability is absent, attempt to install the exact plugin `superpowers@openai-curated-remote` through the environment-supported plugin installation workflow.
- If installation or skill invocation fails, stop before implementation, keep the worktree clean, and report the exact error and attempted steps. No manual workflow fallback is authorized.
- Execute approved plans in an isolated worktree using `superpowers:using-git-worktrees`.
- Use `superpowers:subagent-driven-development` for implementation plans: dispatch a fresh implementation subagent per plan task and run the required specification-compliance and code-quality reviews before continuing.
- Use `superpowers:test-driven-development` and record observed RED and GREEN evidence for every behavior change.
- Invoke `superpowers:systematic-debugging` for unexpected failures before proposing or applying fixes.
- Before completion, invoke `superpowers:verification-before-completion` and `superpowers:requesting-code-review`, run the canonical gate, inspect the complete diff, and resolve accepted findings through TDD.
- Use `superpowers:dispatching-parallel-agents` only after proving the delegated work has no shared files, mutable state, or unresolved interface dependencies.
- The primary agent remains responsible for reviewing, integrating, and verifying all subagent output.

## GCS source availability

- Do not require `/GCS`, `~/app/dragon-reaper/GCS`, or another contributor-specific path for the canonical gate.
- Use committed fixtures and the pinned Go modules documented by the nearest engine specification and `packages/gcs-engine/AGENTS.md`.
- If pinned upstream modules cannot be obtained and are not already available in the canonical environment, stop and report the blocker instead of using a moving branch or copied unpinned source.
