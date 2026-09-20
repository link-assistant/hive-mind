# Case Study: Issue #1603 — Document Codex setup, auth, updates, and persistent data mounting

## Issue Summary

**Issue**: [#1603](https://github.com/link-assistant/hive-mind/issues/1603)
**Type**: Documentation / Docker deployment

The issue reported that Hive Mind documentation did not match the actual Codex setup currently used with the project, especially in Docker-based deployments. The docs still described an older `codex login` flow and omitted the full `/workspace/.codex` persistence pattern that is required to keep Codex auth, config, and sessions across container restarts.

## Timeline

- **2026-04-15**: Issue #1603 opened with explicit required commands and Docker mount examples.
- **2026-04-15**: Maintainer comment requested a local case-study record under `docs/case-studies/issue-1603/`.
- **2026-04-15**: Repository inspection confirmed outdated Codex guidance in `README.md`, `docs/DOCKER.md`, and `docs/UBUNTU-SERVER.md`.

## Requirements

1. Document the actual Codex install/update command:
   `bun install -g @openai/codex@latest`
2. Document the actual login command:
   `codex login --device-auth`
3. Mention the success message:
   `Successfully logged in`
4. Document Codex data storage:
   `~/.codex`
5. Document the Docker-specific location when `HOME=/workspace`:
   `/workspace/.codex`
6. Recommend mounting the full Codex directory, not individual files.
7. Document the current host directories created by the Docker workflow:
   `/root/.hive-mind/claude`
   `/root/.hive-mind/codex`
   `/root/.hive-mind/gh`
   `/root/.hive-mind/claude.json`
8. Document the current Docker mount pattern and detached `docker run` shape.
9. Document the ownership fix using `docker exec ... id -u sandbox` and `chown`.
10. Document the real smoke test:
    `codex exec --model gpt-5.4-mini "hi"`

## Evidence Collected

### Issue-provided facts

The issue body included the exact commands and mount layout currently used by the maintainers. That is the strongest source of truth for this task.

### Repository drift found during inspection

- `README.md` documented persistence for `.claude`, `.claude.json`, and GitHub config, but not `.codex`.
- `docs/DOCKER.md` documented generic `/workspace` persistence and no Codex-specific auth or mount flow.
- `docs/UBUNTU-SERVER.md` still documented `codex login` instead of `codex login --device-auth`.
- `coolify/README.md` documented persistent Claude and GitHub storage, but not Codex storage.

## Root Cause

The documentation evolved around Claude-oriented flows first, then Codex support was added incrementally without updating the Docker and server setup guides to match the current operational workflow. As a result:

- the login command drifted from the actual `--device-auth` flow,
- persistence guidance stayed incomplete for Codex,
- the exact detached Docker run command used in practice was not recorded in the main docs,
- the smoke-test command for Codex was not documented alongside setup.

This was a documentation consistency problem rather than a runtime code bug.

## Solution Applied

Updated the primary setup docs to describe the actual Codex workflow now used with Hive Mind:

- `README.md`
- `docs/DOCKER.md`
- `docs/UBUNTU-SERVER.md`
- `coolify/README.md`

The updates align the docs on:

- installing/updating Codex with `bun install -g @openai/codex@latest`,
- authenticating with `codex login --device-auth`,
- verifying successful login with `Successfully logged in`,
- persisting `/workspace/.codex` in Docker deployments,
- using the actual host directories and mount arguments from the issue,
- running `codex exec --model gpt-5.4-mini "hi"` as the smoke test.

## Residual Gaps / Follow-up

- The translated docs (`*.ru.md`, `*.hi.md`, `*.zh.md`) still contain the older Codex login wording and were not updated as part of this issue.
- If the project wants full cross-language consistency, the same doc changes should be propagated to translated Docker and Ubuntu server guides.

## Verification

- Reviewed changed docs to confirm the requested commands, directories, mount points, and verification command are now present.
- Confirmed the case-study record exists at `docs/case-studies/issue-1603/README.md`.
