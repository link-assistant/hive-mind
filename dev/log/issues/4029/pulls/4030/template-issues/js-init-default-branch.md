## Summary

`release.yml` sets `init.defaultBranch` through `GIT_CONFIG_*`, but `.github/workflows/javascript-first-example.yml` and the reusable `.github/workflows/javascript-first-gate.yml` do not, and reusable workflows do not inherit the caller's `env`. Every `actions/checkout` in those jobs runs `git init` and prints the 11-line `hint: Using 'master' as the name for the initial branch...` block. Run 42674292426 on `main` (commit 34415b0) has 4 of them.

The hints are harmless, but they are noise in every log, and #115 fixed the same thing for two other workflows.

## Reproduction

```bash
gh run view 42674292426 --repo link-foundation/js-ai-driven-development-pipeline-template --log | grep -c "Using 'master' as the name for the initial branch"
```

## Workaround / suggested fix

Add the same block at workflow level in both files. Workflow-level `env` reaches every job, including the reusable workflow's own jobs:

```yaml
env:
  GIT_CONFIG_COUNT: '1'
  GIT_CONFIG_KEY_0: init.defaultBranch
  GIT_CONFIG_VALUE_0: main
```

A test that lists every workflow containing `actions/checkout` and requires this `env` stops it from coming back. link-assistant/hive-mind did this in link-assistant/hive-mind#4029 (`tests/workflow-git-init-default-branch-4029.test.mjs`).
