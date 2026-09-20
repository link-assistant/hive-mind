# F2 — 25 workflow findings had accumulated in `release.yml`, unseen

**Severity:** High · **Class:** False negative (defects present, no check reports them)
**Status:** All findings cleared in `2cf01935`; the gate that would have caught them is F3.

## Symptom

Running the two standard GitHub Actions linters against the tree as it stood produced
**25 findings in `release.yml` alone** and a clean report from neither.

Before-state evidence:
[`../local/actionlint-before.txt`](../local/actionlint-before.txt) (15 reports) and
[`../local/zizmor-before.txt`](../local/zizmor-before.txt), which ends:

```
141 findings (57 ignored, 74 suppressed, 5 unsafe fixes): 0 informational, 0 low, 1 medium, 9 high
```

## The findings, grouped by what they mean

| Tool | Audit / rule | Count | What it was |
| --- | --- | --- | --- |
| zizmor | `template-injection` | 5 | `${{ github.head_ref }}` at `release.yml:132`, and the `bump_type` / `description` `workflow_dispatch` inputs interpolated straight into `run:` shells at lines 927 and 1264 (two each) |
| zizmor | `unpinned-uses` | 4 | `azure/setup-helm` (×3) and `peter-evans/create-pull-request` outside the trusted-publisher list |
| zizmor | `excessive-permissions` | 1 | `permissions: read-all` at workflow level (see F7) |
| actionlint | `expression` | 1 | the same `github.head_ref` interpolation, reported independently |
| actionlint | `shellcheck` | 14 | SC2086 `>> $GITHUB_OUTPUT` unquoted (×3); SC2193 an always-false comparison; SC2046 unquoted `$(...)` in four byte-identical copies of the manifest-merge block |
| | **total** | **25** | |

### The one that was a live bug, not a style report

Four jobs merged Docker manifest lists by building the command line with unquoted
`$(...)`:

```bash
docker buildx imagetools create $(...tags...) $(...digests...)
```

A tag containing a space splits into two arguments, and an empty tag list pushes an
**untagged manifest** without complaining. Extracted to `scripts/create-manifest-list.sh`,
which uses arrays instead of word splitting, fails explicitly when there are no tags or
no digests, and has a `DRY_RUN` mode so the exact command line is testable.

`tests/test-issue-2198-manifest-list.mjs` pins the produced command line, the
space-in-tag case, both refusals, and that all four jobs call the script rather than
re-inlining it.

### The three that were security-relevant

`${{ github.head_ref }}` is attacker-controllable on a fork PR: a branch named
`` a"; curl evil `` is interpolated by the Actions runner *before* the shell sees it.
Same for a `workflow_dispatch` description. All three now pass through `env:` and are
read as `"$VAR"`.

## Root cause

Not one cause per finding — one cause for all of them: **nothing ran these linters.**
See F3. The repository's own structural checks (`scripts/workflow-lint.lib.mjs`, which
verifies timeouts and cancellation) were the only thing reading the workflow files at
all, and they check properties, not syntax or security.

## Verification

`../local/actionlint-after.txt` and `../local/zizmor-after.txt` are empty of findings;
`../local/zizmor-after-min-confidence-medium.txt` records
`No findings to report. Good job!`.
