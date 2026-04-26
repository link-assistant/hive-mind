# Issue 1633 Case Study: Claude Code Installed with Bun Has No Native Binary

## Summary

Issue [#1633](https://github.com/link-assistant/hive-mind/issues/1633) reports that `bun install -g @anthropic-ai/claude-code@latest` appeared to install Claude Code, but the resulting `claude` command failed with:

```text
Error: claude native binary not installed.
```

The same environment succeeded after running Anthropic's native installer:

```sh
curl -fsSL https://claude.ai/install.sh | bash
```

The repository root `Dockerfile` and `coolify/Dockerfile` both installed Claude Code with Bun, so Docker images could contain a `claude` launcher that exists on PATH but cannot execute.

## Data Collected

- `data/issue-1633.json`: issue title, body, metadata, and embedded comments.
- `data/issue-1633-comments.json`: paginated issue comments from the GitHub API.
- `data/pr-1632.json`: related PR where the failure was reported.
- `data/pr-1632-report-comment-4271462091.json`: the exact PR comment linked from the issue.
- `data/linked-solve-log.txt`: full linked gist log from the failed solve run.
- `data/repro-bun-install.log`: local isolated reproduction with Bun 1.3.11.
- `data/repro-native-install.log`: local isolated verification with the native installer.
- `data/claude-code-2.1.113-npm-view.json`: npm package metadata for the reported Claude Code version.
- `data/anthropics-claude-code-repo.json`: upstream repository metadata.
- `data/anthropics-claude-code-bun-issues.json`: search results for likely duplicate upstream reports.
- `data/bun-claude-code-postinstall-issues.json`: search results for related Bun reports.
- `data/upstream-anthropic-issue-url.txt`: upstream Claude Code issue created from this case study.
- `upstream-anthropic-issue.md`: body used for the upstream Claude Code report.
- `research-sources.json`: online source notes from official Claude Code and Bun documentation.

## Timeline

- 2026-04-17 21:38:09 UTC: `solve v1.53.0` starts for issue #1631 using Claude Code. See `data/linked-solve-log.txt`.
- 2026-04-17 21:38:39 UTC: the `claude` process exits before processing any messages with `claude native binary not installed`.
- 2026-04-17 21:38:44 UTC: PR #1632 receives a failure comment linking the log. See `data/pr-1632-report-comment-4271462091.json`.
- 2026-04-17 21:57:25 UTC: issue #1633 is opened with a manual reproduction showing Bun install failure and native installer success.
- 2026-04-17 investigation: an isolated local install with Bun 1.3.11 reproduces the same failure and records `Blocked 1 postinstall`. A separate isolated native installer run installs `2.1.113 (Claude Code)` successfully.

## Requirements From The Issue

1. Download all logs and data related to the issue into `docs/case-studies/issue-1633`.
2. Perform a deep case-study analysis.
3. Search online for additional facts and data.
4. Reconstruct the timeline and sequence of events.
5. List requirements from the issue.
6. Identify root causes for each problem.
7. Propose possible solutions and solution plans.
8. Check known existing components or libraries that solve the problem or help with solutions.
9. Add debug output if there is not enough data for root-cause analysis.
10. Report related upstream issues when applicable.

## Root Cause

The immediate root cause is that the project installed Claude Code through Bun:

```dockerfile
RUN bun install -g @anthropic-ai/claude-code
```

Claude Code's npm package metadata for version `2.1.113` includes:

- `bin.claude = "bin/claude.exe"`
- `scripts.postinstall = "node install.cjs"`
- platform-native optional dependencies such as `@anthropic-ai/claude-code-linux-x64`

Anthropic's docs explain that the npm package pulls the native binary through a per-platform optional dependency and uses a postinstall step to link it into place. Bun's docs explain that Bun does not run dependency lifecycle scripts such as `postinstall` unless the dependency is trusted. The local reproduction confirms this interaction:

```text
Blocked 1 postinstall. Run `bun pm -g untrusted` for details.
```

Bun returned exit code 0, so the Docker build could proceed even though the installed `claude` command was not usable.

## Secondary Cause

The Dockerfiles did not verify the Claude Code install with `claude --version` immediately after installation. That let a broken wrapper binary remain undetected until runtime, where `solve` failed before sending any prompt to Claude.

## Solution Options Considered

1. Native installer, selected

   Use `https://claude.ai/install.sh`, keep `/workspace/.local/bin` on PATH, and verify with `claude --version`. This is the documented recommended install path for macOS/Linux/WSL and avoids Bun's lifecycle-script trust model.

2. `npm install -g @anthropic-ai/claude-code`

   This is a documented alternative and should run postinstall scripts by default, but it still depends on npm global-install behavior and optional dependency handling. The issue already showed the native installer working in the target environment.

3. Bun with `trustedDependencies` or `bun pm trust`

   This preserves Bun for Claude Code but is brittle for a Docker global install. It also keeps the install coupled to Bun's lifecycle-script trust rules and may need special handling for global state.

4. Manual postinstall after Bun

   This follows the error message but is path-sensitive for global installs and less robust than using the supported native installer.

## Implemented Fix

- `Dockerfile` now installs Claude Code through the native installer and immediately runs `claude --version`.
- `coolify/Dockerfile` now does the same.
- Other AI CLI packages continue to use Bun where that install method was already working.
- `tests/test-claude-code-install-method.mjs` prevents reintroducing `bun install -g @anthropic-ai/claude-code` in either Dockerfile and verifies that the native installer plus `claude --version` checks remain present.

## Verification

Reproduction before the fix:

```text
bun add v1.3.11 (af24e281)
installed @anthropic-ai/claude-code@2.1.113 with binaries:
 - claude
Blocked 1 postinstall. Run `bun pm -g untrusted` for details.
Error: claude native binary not installed.
```

Verification of the selected installer:

```text
Installing Claude Code native build 2.1.113...
Claude Code successfully installed
2.1.113 (Claude Code)
```

The automated test is:

```sh
node tests/test-claude-code-install-method.mjs
```

## Upstream Notes

The upstream `anthropics/claude-code` repository has issues enabled. Searches for the exact Bun/native-binary failure did not find an obvious duplicate. This is not primarily a Bun bug because Bun is intentionally blocking dependency lifecycle scripts; it is an install-method mismatch in this repository. A useful upstream improvement would be for Claude Code's fallback error text or docs to mention Bun's blocked `postinstall` case explicitly.

An upstream report was created at [anthropics/claude-code#50203](https://github.com/anthropics/claude-code/issues/50203).

## Follow-Up Ideas

- Add a Docker build smoke test that asserts `claude --version`, `codex --version`, and `opencode --version` all work in the built image.
- Consider pinning the Claude Code native installer to a release channel (`stable`) if image reproducibility becomes more important than always receiving the latest CLI.
- Consider verifying the native installer manifest/signature in Docker builds if supply-chain hardening is prioritized.
