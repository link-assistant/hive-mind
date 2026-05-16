# Online Sources

This issue required checking current GitHub fork behavior and branch-sync tooling.

- GitHub Docs, "Syncing a fork": https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/syncing-a-fork
  - Forks can be synced from upstream, including via the GitHub CLI, when the fork branch is behind the upstream branch.
- GitHub CLI manual, `gh repo sync`: https://cli.github.com/manual/gh_repo_sync
  - `gh repo sync <destination-repository> -b <branch>` syncs a destination branch from the source repository and branch.
- GitHub Docs, "Creating a pull request from a fork": https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/creating-a-pull-request-from-a-fork
  - Pull requests from forks compare a head branch in the fork against a base branch in the upstream repository.
- Git documentation, `git checkout`: https://git-scm.com/docs/git-checkout
  - `git checkout -b <new-branch> <start-point>` creates a new branch from a specific start point, so the start point must resolve to a commit.
