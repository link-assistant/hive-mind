# GitHub CLI authentication research

Collected 2026-09-23 while investigating active workflow run `18496075671`.

## Primary sources

- [GitHub CLI environment manual](https://cli.github.com/manual/gh_help_environment): `GH_TOKEN`/`GITHUB_TOKEN` is used directly for `github.com`, takes precedence over stored credentials, and avoids authentication prompts.
- [GitHub CLI `auth login` manual](https://cli.github.com/manual/gh_auth_login): environment-token authentication is the recommended headless/automation mode and Actions should set `GH_TOKEN`.
- [GitHub CLI `auth refresh` manual](https://cli.github.com/manual/gh_auth_refresh): the command expands or repairs scopes on **stored credentials** and uses an interactive browser/device authorization flow.
- [GitHub CLI issue #2922](https://github.com/cli/cli/issues/2922): a maintainer confirms that an environment token needs no `gh auth login` and that GitHub CLI deliberately rejects storing another credential while it is set.
- [GitHub CLI discussion #9647](https://github.com/cli/cli/discussions/9647): reproduces the corresponding `gh auth refresh` error when `GITHUB_TOKEN` supplies authentication.
- [GitHub REST delete-repository documentation](https://docs.github.com/en/rest/repos/repos#delete-a-repository): a fine-grained token needs repository `Administration: write`; a classic PAT uses `delete_repo`.

## Repository conclusion

The cleanup workflow already supplies `TEST_GITHUB_USER_REPO_DELETION_TOKEN` as `GH_TOKEN`, then invokes `gh auth refresh`. That asks GitHub CLI to mutate stored interactive credentials while an environment credential has precedence, so it deterministically exits instead of reaching the cleanup script. The token must be provisioned with deletion permission before the workflow starts; an Actions job cannot add permission to a static PAT. The repair therefore verifies `gh auth status` and `gh api user`, removes the refresh command, and provides environment-aware permission guidance.

The cleanup script also parsed the human-readable `gh auth status` output for the classic `delete_repo` scope. Fine-grained and environment PATs do not reliably expose that classic OAuth scope string, creating a false warning. The script now verifies authentication only and reports permission guidance from an actual delete API failure.
