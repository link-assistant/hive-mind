# External Research - Issue #2009

Official references checked on 2026-07-03:

1. Git `git push` documentation:
   https://git-scm.com/docs/git-push

   Relevant data: `--force-with-lease` overrides the normal fast-forward
   restriction only when the remote ref still has the expected value. `--force`
   disables more safety checks and can cause the remote repository to lose commits.

2. GitHub Docs, "Syncing a fork":
   https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/syncing-a-fork

   Relevant data: people need write access to a forked repository to sync the fork.
   GitHub documents web UI, GitHub CLI, and command-line flows; command-line sync
   starts with fetching the upstream remote.

3. GitHub Docs, "About comparing branches in pull requests":
   https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-comparing-branches-in-pull-requests

   Relevant data: GitHub compare views can compare committish references in the
   same repository or its forks, and GitHub documents the difference between
   two-dot and three-dot comparisons. The solver's human-facing compare URL should
   therefore identify the exact fork and upstream branch refs being compared.
