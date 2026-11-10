### Is there an existing issue for this?

- [x] I have searched the existing issues

Closest existing reports, all closed without a fix: #7391 (open pull requests not closed although the default branch already had the update; closed as not planned by the stale bot), #13606 (closed as a duplicate of #4652), #2282 (orphaned pull requests ignore commands). This report has a narrower, reproducible trigger: the `dependabot.yml` entry that opened the pull requests was changed afterwards.

### Package ecosystem

pip (`requirements.txt` and `pyproject.toml`)

### Package manager version

pip / uv (Dependabot-managed)

### Language version

Python 3.14

### Manifest location and content before the Dependabot update

- `scripts/unimedvl-requirements.txt` (pinned `==` versions), used by konard/medical-neural-network-ml#13, konard/medical-neural-network-ml#15, konard/medical-neural-network-ml#16 and konard/medical-neural-network-ml#17
- `pyproject.toml` (`mypy>=1.13.0,<2.0` in the `dev` extra), used by konard/medical-neural-network-ml#14

### dependabot.yml content

When the pull requests were opened (commit `4e23b0f8a`, 2026-10-16):

```yaml
  - package-ecosystem: pip
    directories:
      - /
      - /docs
    schedule:
      interval: weekly
      day: monday
    cooldown:
      default-days: 7
    groups:
      python-minor-and-patch:
        update-types:
          - minor
          - patch
    commit-message:
      prefix: deps
```

Since commit `c1cb53cae` (2026-10-17 09:20 UTC) the same entry is part of a multi-ecosystem group and excludes the requirements file:

```yaml
multi-ecosystem-groups:
  python:
    schedule:
      interval: weekly
      day: monday
    commit-message:
      prefix: deps

updates:
  - package-ecosystem: pip
    directories:
      - /
      - /docs
    exclude-paths:
      - scripts/unimedvl-requirements.*
    patterns:
      - '*'
    multi-ecosystem-group: python
    cooldown:
      default-days: 7
```

Later commits only added `versioning-strategy: increase` to this entry (2026-10-17) and a separate `uv` entry for `/scripts` that now owns the requirements file (2026-10-19).

Full files: [at `4e23b0f8a`](https://github.com/konard/medical-neural-network-ml/blob/4e23b0f8a/.github/dependabot.yml), [at `c1cb53cae`](https://github.com/konard/medical-neural-network-ml/blob/c1cb53cae/.github/dependabot.yml), [current](https://github.com/konard/medical-neural-network-ml/blob/main/.github/dependabot.yml).

### Updated dependency

| Pull request | Update | Version on `main` since 2026-10-17/19 |
| --- | --- | --- |
| konard/medical-neural-network-ml#13 | python-minor-and-patch group, 12 updates in `scripts/unimedvl-requirements.txt` | every package at the same or a newer version (torch 2.14.1, …) |
| konard/medical-neural-network-ml#14 | mypy `<2.0,>=1.13.0` → `>=1.13.0,<3.0` in `pyproject.toml` | `mypy>=2.4.0` |
| konard/medical-neural-network-ml#15 | packaging 25.0 → 26.3 | `packaging==26.3` |
| konard/medical-neural-network-ml#16 | transformers 4.49.0 → 5.19.0 | `transformers==5.20.1` |
| konard/medical-neural-network-ml#17 | numpy 1.24.4 → 2.2.6 | `numpy==2.5.4` |

### What you expected to see, versus what you actually saw

Expected: once the default branch has the same or a newer version, Dependabot closes the pull request ("… is no longer updatable, so this is no longer needed"), as it did in the same repository for the `github-actions` pull request konard/medical-neural-network-ml#18 four minutes after the default branch caught up (2026-10-17 16:07). If the configuration no longer covers the pull request's file or update entry, I would expect Dependabot to close the pull request with a message saying so, or at least to react to `@dependabot recreate` / `@dependabot rebase` by closing or rebuilding it.

Actual: the five pull requests in the table were opened on 2026-10-16 19:40 and have not been touched by Dependabot since (no push, no comment, no close), more than two weeks later, across the scheduled runs of 2026-10-19 and 2026-10-26. They all conflict with `main` (`mergeable: CONFLICTING`, `mergeStateStatus: DIRTY`), `gh pr merge` fails with "the merge commit cannot be cleanly created", and every update they carry has been on `main` since 2026-10-17/19. Commenting on them to explain they were superseded did nothing.

The only change between "Dependabot closes superseded pull requests" (konard/medical-neural-network-ml#18, `github-actions`, entry unchanged) and "Dependabot ignores them" (the five above) is that their `pip` entry was regrouped into a `multi-ecosystem-group` and its requirements file was moved to `exclude-paths` / a `uv` entry. I cannot see the Dependabot job logs that would confirm which of the two orphans them, so that part is an inference.

### Images of the diff or a link to the PR, issue, or logs

- Pull requests: konard/medical-neural-network-ml#13, konard/medical-neural-network-ml#14, konard/medical-neural-network-ml#15, konard/medical-neural-network-ml#16, konard/medical-neural-network-ml#17 (left open), konard/medical-neural-network-ml#18 (closed by Dependabot as expected)
- Collected timelines, diffs and configurations: https://github.com/link-assistant/hive-mind/tree/issue-3863-e5ade92d4bf8/docs/case-studies/issue-3863/raw
- Downstream impact: link-assistant/hive-mind#3863 — an automation that merges open Dependabot pull requests before a dependency-update run could not merge any of them

### Smallest manifest that reproduces the issue

1. `requirements.txt` with `numpy==1.24.4`, and a `dependabot.yml` with a plain `pip` entry for `/` (weekly). Let Dependabot open "bump numpy from 1.24.4 to 2.x".
2. Change the `pip` entry to `exclude-paths: [requirements.txt]` (or move it into a `multi-ecosystem-group`), then push `numpy==<newer than the PR>` to the default branch yourself.
3. The Dependabot pull request now conflicts and is superseded, but it is never closed or rebased, while pull requests of unchanged entries in the same repository are closed as usual.

### Workaround

Close the pull requests by hand (a `@dependabot close` comment or `gh pr close`). link-assistant/hive-mind now does this automatically: before a dependency-update run it compares each conflicting Dependabot pull request's diff with the base branch, closes it when the base already pins every dependency at the same or a newer version, and otherwise comments `@dependabot recreate` and merges the recreated pull request.

### Suggested fix

When an update job no longer has a configuration entry (or `exclude-paths` / `multi-ecosystem-group` change) that covers an open Dependabot pull request, either close that pull request with a message such as "this file is no longer covered by dependabot.yml", or keep checking it against the default branch with its original entry so it is closed as "no longer updatable" like other superseded pull requests. `@dependabot recreate` / `@dependabot rebase` on such a pull request should answer with an explanation instead of silently doing nothing.
