# Automatic CI/CD repair after merging

Use `--auto-fix-ci-cd` with `--auto-merge` to keep solving CI/CD problems after a pull request merges:

```bash
solve https://github.com/owner/repo/issues/123 --auto-merge --auto-fix-ci-cd
```

The same options work with Telegram `/solve` and with `hive`. The option is disabled by default; passing it without `--auto-merge` fails argument validation.

The solver checks the pull request's actual target branch after GitHub confirms the merge. It inspects the latest branch run of each active workflow and runs on the current branch commit, including tag-triggered publishers. Failed, cancelled, timed-out, and unknown workflow conclusions are errors. Running workflows and missing runs remain pending.

Publishing intent is detected from active workflow files, package manifests and referenced local scripts. Referenced scripts are read, never executed. Verification requires all detected outputs to exist:

| Output         | Required evidence                                                                                                                               |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub release | Published after the merge, with a tag whose commit contains the merged change; drafts do not count.                                             |
| npm            | The public npm registry contains the current manifest version and a publication timestamp after the merge. Private packages are excluded.       |
| PyPI           | The current static project/Poetry version has an uploaded distribution after the merge.                                                         |
| crates.io      | The current static crate version was published after the merge. Crates with `publish = false` or `publish = []` are excluded.                   |
| GitHub Pages   | A successful `github-pages` environment deployment, or a successful branch-based Pages build, after the merge whose commit contains the change. |

Version-bump commits may follow the original merge. The verifier reads package metadata from the current target-branch commit and checks Git ancestry for release/deployment commits. After each repair it obtains the merge commit from that repair's pull request; a release bot advancing the branch is insufficient evidence that the repair merged. An older release or registry version cannot make a fresh merge pass.

Passing CI without any release or deployment is an error. A skipped publishing step is insufficient. If a registry, dynamic version, or publishing configuration cannot be verified, the solver reports the missing evidence instead of assuming success. Direct registry verification supports public npm, PyPI and crates.io. Recognized NuGet, Maven/Gradle, RubyGems, Dart and Composer publishers require additional verification support; private registries and external reusable workflows also need additional support. Truncated inventories and unreadable files remain errors.

The monitor allows one minute after merging for delayed workflows to appear, waits up to one hour for CI, and allows five minutes for missing outputs to become visible after workflows complete. `--verbose` prints polling and evidence diagnostics.

When verification fails, the solver creates a Bug issue using the existing `/fix --ci-cd` template, including the target commit, workflow failures and missing output evidence. It solves that issue with `--development-log --deep-analysis --auto-merge`, preserving worker options such as `--tool`, `--model` and `--think`. Each repair uses a fresh checkout and tool session on the original target branch. The parent checks CI/CD again after the repair finishes; child solvers do not recursively start another repair chain.

Repairs consume the parent solve's shared `--auto-restart-max-iterations` budget (default: 5). Set `--auto-restart-max-iterations 0` for an unlimited repair chain. Budget exhaustion, a failing child, an unchanged target branch, or interruption fails the command and keeps the remediation issue/PR available for inspection.

GitHub API references: [releases](https://docs.github.com/en/rest/releases/releases), [deployment statuses](https://docs.github.com/en/rest/deployments/statuses), [Pages builds](https://docs.github.com/en/rest/pages/pages), and [commit comparison](https://docs.github.com/en/rest/commits/commits#compare-two-commits).
