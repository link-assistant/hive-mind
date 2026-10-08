# Automatic base branch creation

Issue: https://github.com/link-assistant/hive-mind/issues/1771

The issue supplies only a title. The implementation assumes an opt-in boolean flag, an explicit `--base-branch`, and the canonical repository's default branch as the source commit. A fork alone cannot create a PR target in upstream without upstream write access.

Run the automated coverage:

```sh
node --test tests/auto-base-branch-creation-1771.test.mjs tests/auto-base-branch-git-1771.test.mjs
```

The first file exercises argument parsing, actual read-only entity validation with a mock command runner, API creation, preservation of existing branches, concurrent creation, and failure reporting. The second uses local Git repositories: clone before the target exists, add the target remotely, then verify that the solver fetches it and creates the issue branch from its commit.

Reproduce the unsupported-option failure against the base revision:

```sh
python3 experiments/issue-1771/reproduce-before.py origin/main
```

The baseline probe temporarily replaces `src/solve.config.lib.mjs` with the base revision and restores the working copy in `finally`. Run it separately from other tests. Before implementation, both CLI parsing tests fail with `Unknown arguments: auto-base-branch-creation, autoBaseBranchCreation`. With the implementation, all 16 feature tests pass. The reused-checkout test fails before its fetch step is implemented with `Branch operation failed`.
