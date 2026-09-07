# CI/CD Best Practices for AI-Driven Development (languages: en • [zh](CI-CD-BEST-PRACTICES.zh.md) • [hi](CI-CD-BEST-PRACTICES.hi.md) • [ru](CI-CD-BEST-PRACTICES.ru.md))

This document describes CI/CD best practices that significantly improve the quality and reliability of AI-driven development workflows. When properly configured, Hive Mind AI solvers are forced to iterate with CI/CD checks until all tests pass, ensuring code quality meets the highest standards.

## Why CI/CD Matters for AI Development

Hive Mind's AI issue solver is instructed to pay attention to CI/CD checks in each pull request. This creates a powerful feedback loop:

1. **AI creates a solution** - The solver generates code based on issue requirements
2. **CI/CD validates the solution** - Automated checks verify code quality
3. **AI iterates until passing** - The solver fixes issues until all checks pass
4. **Quality is guaranteed** - No code merges without passing all gates

This approach ensures consistent quality regardless of whether the team consists of humans, AIs, or both.

## Recommended CI/CD Templates

We provide ready-to-use templates for multiple languages with all best practices pre-configured:

| Language              | Template Repository                                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| JavaScript/TypeScript | [js-ai-driven-development-pipeline-template](https://github.com/link-foundation/js-ai-driven-development-pipeline-template)         |
| Rust                  | [rust-ai-driven-development-pipeline-template](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template)     |
| Python                | [python-ai-driven-development-pipeline-template](https://github.com/link-foundation/python-ai-driven-development-pipeline-template) |
| Go                    | [go-ai-driven-development-pipeline-template](https://github.com/link-foundation/go-ai-driven-development-pipeline-template)         |
| C#                    | [csharp-ai-driven-development-pipeline-template](https://github.com/link-foundation/csharp-ai-driven-development-pipeline-template) |
| Java                  | [java-ai-driven-development-pipeline-template](https://github.com/link-foundation/java-ai-driven-development-pipeline-template)     |
| PHP                   | [php-ai-driven-development-pipeline-template](https://github.com/link-foundation/php-ai-driven-development-pipeline-template)       |

> **Tip:** You don't have to pick a template by hand. Run `fix <repository-url> --ci-cd` (see [Automatic CI/CD Remediation](#automatic-cicd-remediation)) and Hive Mind detects the repository's languages and selects the matching templates for you.

## Key CI/CD Principles

### 1. Run Checks Only on Relevant File Changes

**Only trigger checks when relevant files change.** This dramatically reduces CI costs and run times.

Use a `detect-changes` job at the start of your workflow to determine which file categories changed:

```yaml
jobs:
  detect-changes:
    runs-on: ubuntu-latest
    outputs:
      code-changed: ${{ steps.changes.outputs.code }}
      docs-changed: ${{ steps.changes.outputs.docs }}
      docker-changed: ${{ steps.changes.outputs.docker }}
      workflow-changed: ${{ steps.changes.outputs.workflow }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 2
      - name: Detect changes
        id: changes
        run: node scripts/detect-code-changes.mjs
```

Then gate each job on the relevant output:

```yaml
test-suites:
  needs: [detect-changes]
  if: needs.detect-changes.outputs.code-changed == 'true' || needs.detect-changes.outputs.workflow-changed == 'true'
  # ...

validate-docs:
  needs: [detect-changes]
  if: needs.detect-changes.outputs.docs-changed == 'true'
  # ...

docker-pr-check:
  needs: [detect-changes]
  if: needs.detect-changes.outputs.docker-changed == 'true' || needs.detect-changes.outputs.workflow-changed == 'true'
  # ...
```

**What to exclude from "code changes" detection:**

- Markdown files (`*.md`) — documentation-only changes don't need changeset files
- `.changeset/` folder — changeset metadata isn't code
- `data/` and `experiments/` folders — non-production content
- `.gitkeep` files — placeholder files with no functional impact

**What always triggers checks when changed:**

- Source code files (`.mjs`, `.ts`, `.py`, `.rs`, `.go`, etc.)
- `package.json` / dependency manifests
- CI/CD workflow files (`.github/workflows/*.yml`)
- `Dockerfile` and related infrastructure files

### 2. File Size Limits

**Enforce a maximum of 1000-1500 lines per code file.**

This constraint benefits both AI and human developers:

- AI models can read and understand entire files within context windows
- Humans can navigate and comprehend files without cognitive overload
- Forces modular, well-organized code architecture

Example enforcement in CI (bash):

```bash
find src/ -name "*.mjs" -type f | while read -r file; do
  line_count=$(wc -l < "$file")
  if [ "$line_count" -gt 1500 ]; then
    echo "ERROR: $file has $line_count lines (limit: 1500)"
    echo "::error file=$file::File has $line_count lines (limit: 1500)"
    exit 1
  fi
done
```

**Synchronize the file-size ESLint rule with the CI check** to catch violations locally before CI:

```js
// eslint.config.mjs
{
  rules: {
    'max-lines': ['error', { max: 1500 }]
  }
}
```

### 3. Automated Code Formatting

Consistent formatting eliminates style debates and reduces diff noise:

| Language              | Tool                          |
| --------------------- | ----------------------------- |
| JavaScript/TypeScript | ESLint + Prettier             |
| Rust                  | rustfmt                       |
| Python                | Ruff                          |
| Go                    | gofmt                         |
| C#                    | dotnet format                 |
| Java                  | Spotless (Google Java Format) |
| PHP                   | PHP CS Fixer                  |

All templates include pre-commit hooks that run formatters automatically before each commit.

### 4. Static Analysis & Linting

Catch bugs and enforce patterns before code reaches review:

| Language              | Tools                               |
| --------------------- | ----------------------------------- |
| JavaScript/TypeScript | ESLint with strict rules            |
| Rust                  | Clippy (pedantic + nursery)         |
| Python                | Ruff + mypy                         |
| Go                    | go vet + staticcheck                |
| C#                    | .NET analyzers (warnings as errors) |
| Java                  | SpotBugs (maximum effort)           |
| PHP                   | PHPStan (max level)                 |

### 5. Fast-Fail Job Ordering

**Run fast checks before slow checks** to give the fastest possible feedback:

```
Fast checks (~7-30s each):     Slow checks (~1-10 min each):
├── test-compilation            ├── test-suites (unit tests)
├── lint (format + ESLint)      ├── test-execution (integration)
└── check-file-line-limits      ├── docker-pr-check
                                └── helm-pr-check
```

Gate slow checks on fast checks:

```yaml
test-suites:
  needs: [test-compilation, lint, check-file-line-limits]
  if: |
    always() &&
    !cancelled() &&
    !contains(needs.*.result, 'failure') &&
    needs.test-compilation.result == 'success' &&
    needs.lint.result == 'success' &&
    needs.check-file-line-limits.result == 'success'
```

### 6. Changeset-Based Versioning

All templates use a changeset system that:

- **Eliminates merge conflicts** - Each PR creates an independent changeset file
- **Automates version bumps** - Highest bump type wins when merging
- **Generates changelogs** - Release notes are compiled automatically
- **Supports semantic versioning** - patch/minor/major bumps are explicit

| Language              | Tool                         |
| --------------------- | ---------------------------- |
| JavaScript/TypeScript | @changesets/cli              |
| Rust                  | changelog.d + custom scripts |
| Python                | Scriv                        |
| PHP                   | changelog.d + custom scripts |
| Go, C#, Java          | Custom changeset workflows   |

**Exempt docs-only PRs from changeset requirements:**

```yaml
changeset-check:
  needs: [detect-changes]
  if: github.event_name == 'pull_request' && needs.detect-changes.outputs.any-code-changed == 'true'
```

Documentation-only changes (updating `.md` files) should not require a version bump.

### 7. Validate the Actual Merge Result

**CI must test what will actually be merged, not a stale PR snapshot.**

When a PR is opened against a base branch that later receives new commits, the GitHub merge preview can become stale. Simulate a fresh merge before running checks:

```yaml
- name: Simulate fresh merge with base branch (PR only)
  if: github.event_name == 'pull_request'
  env:
    BASE_REF: ${{ github.base_ref }}
  run: |
    git config user.email "github-actions[bot]@users.noreply.github.com"
    git config user.name "github-actions[bot]"
    git fetch origin "$BASE_REF"
    BEHIND_COUNT=$(git rev-list --count HEAD..origin/$BASE_REF)
    if [ "$BEHIND_COUNT" -gt 0 ]; then
      git merge origin/$BASE_REF --no-edit || \
        (echo "::error::Merge conflict! PR must be rebased before merging." && exit 1)
    fi
```

This ensures lint, file-size, and other checks validate the final merged state.

### 8. Pre-commit Hooks

Local quality gates prevent broken commits from reaching CI:

1. Format check and auto-fix
2. Lint and static analysis
3. Type checking (where applicable)
4. File size validation
5. Secrets detection

This "shift left" approach catches issues immediately rather than waiting for CI.

### 9. Release Automation

Automated release workflows ensure:

- **No manual version management** - Versions update automatically
- **OIDC trusted publishing** - No API tokens needed in CI (npm, PyPI, crates.io)
- **Validated releases only** - All checks must pass before publishing
- **Dual trigger modes** - Both automatic (on merge) and manual (workflow dispatch)
- **A rule-blocked push is not a failed release** - When a repository ruleset requires that changes arrive through a pull request, the release job opens one for its version bump instead of dying on the rejection. That path, and the rebase-and-retry path for a lost race, are two different recoveries for two rejections that print the same word (see principle 10)

**Prohibit manual version changes** in PRs — all version bumps should be managed by the CI release workflow:

```yaml
version-check:
  if: github.event_name == 'pull_request'
  steps:
    - name: Check for version changes in package.json
      run: node scripts/check-version.mjs
```

### 10. Concurrency Control

**Separate cancellable read-only checks from non-cancellable write jobs.** Configure concurrency at the job level when a workflow contains both kinds of work:

```yaml
jobs:
  lint:
    # Include the job identity (and matrix values, when present) so unrelated
    # checks remain parallel while a newer run replaces only the stale check.
    concurrency:
      group: check-${{ github.workflow }}-${{ github.ref }}-lint
      cancel-in-progress: true
    # ...

  deploy:
    needs: [lint]
    if: ${{ !cancelled() && needs.lint.result == 'success' }}
    # Every job that writes to main or an external deployment target uses this
    # repository-wide group, even when the jobs live in different workflows.
    concurrency:
      group: main-writer-${{ github.repository }}-main
      cancel-in-progress: false
    # ...
```

- **Read-only jobs:** Cancel superseded checks on both pull requests and `main` to reduce runner load. Give each job a distinct suffix; include relevant matrix values so different matrix entries can still run in parallel.
- **Dependent writers:** Use `needs` and require successful prerequisites. A cancelled prerequisite must make its write job not start.
- **Active writers:** Give every release, deploy, tag, generated-content push, and other write job the same repository-scoped group with `cancel-in-progress: false`. An already started writer finishes while the next writer waits in the queue, including writers from another workflow file.
- **Workflow scope:** Do not put cancellable concurrency at workflow level when the workflow has write jobs. Cancelling the workflow would also interrupt a writer that has already started.

By default, a concurrency group keeps at most one running and one pending job; a newer pending writer replaces the older pending writer. If every queued write must run, add `queue: max` to the writer's concurrency block (up to 100 jobs can wait). `queue: max` cannot be combined with `cancel-in-progress: true`, and execution order follows when jobs start waiting rather than workflow dispatch order, so write jobs should remain idempotent. See [GitHub's concurrency documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency) for the current queue limits and semantics.

Use `!cancelled()` instead of `always()` in job conditions so cancellation propagates correctly through the job graph. A bare `always()` can keep downstream work running after cancellation.

**Serialisation orders writers; it does not rebase them.** The concurrency group decides _when_ each writer runs, not _what_ it has checked out. `actions/checkout` checks out `github.sha` — the commit that triggered the run — so the second writer in the queue starts one or more commits behind the branch the instant the first one lands, and its push is rejected:

```
 ! [rejected]        main -> main (non-fast-forward)
```

The bullets above without this one convert "two writers collide" into "the second writer reliably fails" — better, because it is deterministic and loud, but still a broken release. `link-foundation/browser-commander` implemented the group to the letter (three language releases in three workflow files, zero overlap in their timings) and two of its three releases still ended on that line. Each run looked like ordinary flaky CI, so the damage accumulated unnoticed: the Rust crate reached 0.10.11 on crates.io while `Cargo.toml` on `main` still said 0.9.0, and the Python package was never published at all, because the job dies at a changelog push that sits before the publish step.

**Do not fix it with `ref: main` on the checkout.** That silences the rejection by building, testing and publishing a tree that is not the tree CI validated, with nothing in the log to say so. The rejection is the honest outcome; what is missing is the recovery.

**Give every write job a push that classifies the rejection, then rebases and retries.** A repository-ruleset rejection (GH006, GH013 — "Changes must be made through a pull request") also prints `[rejected]`, and no number of rebases can ever satisfy a rule; it needs the pull-request path instead (see principle 9). Retrying it burns the queue slot and reports the wrong cause.

```js
for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  const result = await run('git', ['push', remote, branch]);
  if (result.code === 0) return { pushed: true, attempt };
  // A rule can never be satisfied by a rebase: land the same commit via a PR.
  if (isBlockedByRepositoryRule(result)) return landViaPullRequest({ branch, ...ctx });
  // Auth, network, a missing remote: rebasing would hide the real error.
  if (!isNonFastForward(result) || attempt === maxAttempts) throw new CommandFailedError('git', ['push', remote, branch], result);
  await run('git', ['pull', '--rebase', remote, branch]);
}
```

- **Never `--force`, and never `--force-with-lease`, on a shared branch.** Both turn a lost race into a silent deletion of whatever the writer ahead of you landed. Rebasing is the point: the later commit has to end up on top of the earlier one.
- **Recompute after the rebase whatever was derived before it.** A version number, a changelog entry or a tag chosen against the stale tip may already be taken by the writer that won the queue. Re-read the state instead of replaying the plan.
- **Report success only after the push landed.** A step that sets `version_committed=true` before the push is confirmed leaves the downstream publish job working from a commit that exists only on that runner.
- **Bound the retries and name the reason in the log.** A handful of attempts with a short delay covers a queue; an unbounded loop against a branch that is genuinely protected turns a fast failure into a long one.

### 11. Secrets Detection

Prevent accidental credential leaks in CI:

- Include a secrets scan step using tools like `secretlint` or `truffleHog`
- Fail CI immediately if secrets are detected
- Never log environment variables or token values

### 12. Documentation Validation

**Validate documentation files in CI just like code:**

- Check file size limits (e.g., max 2500 lines for docs)
- Verify required sections exist in key documents
- Check for broken links using tools like `lychee`

```yaml
validate-docs:
  needs: [detect-changes]
  if: needs.detect-changes.outputs.docs-changed == 'true'
  steps:
    - run: node tests/docs-validation.mjs
```

### 13. Container Images: Native Runners per Architecture

**Build each architecture on its own native runner.** GitHub provides free arm64 Linux runners for public repositories (`ubuntu-24.04-arm`). Emulating arm64 with QEMU on an x86 runner is much slower for compiled languages, and building two architectures inside one job makes them sequential instead of parallel.

```yaml
build-image:
  strategy:
    matrix:
      include:
        - platform: linux/amd64
          runner: ubuntu-latest
        - platform: linux/arm64
          runner: ubuntu-24.04-arm
  runs-on: ${{ matrix.runner }}
  steps:
    - uses: docker/build-push-action@v7
      with:
        platforms: ${{ matrix.platform }}
        cache-from: type=gha
        cache-to: type=gha,mode=max
        outputs: type=image,push-by-digest=true,name-canonical=true,push=true

merge-manifest:
  needs: [build-image]
  steps:
    - run: docker buildx imagetools create -t $IMAGE:$VERSION $DIGESTS
```

- **No `setup-qemu-action`.** Its presence means an architecture is being emulated; use a native runner instead.
- **Publish images for every architecture your users run.** A single-architecture image silently excludes Apple Silicon, Graviton, and arm CI runners.
- **Always cache.** Set `cache-from: type=gha` and `cache-to: type=gha,mode=max` on every build step; otherwise every architecture rebuilds the full dependency tree for every release.
- **Never gate the release on the image push.** Publish the GitHub Release and language-registry package first, then attach images as they finish. Release notes contain no data derived from image bytes, so a slow or failed registry push must not hide an otherwise completed release.
- **Assert what you shipped.** Verify that the published manifest lists every intended platform and that each default-branch tag has a corresponding GitHub Release; a missing release is otherwise easy to overlook.

Reference implementations: [`link-foundation/box`](https://github.com/link-foundation/box) and [`link-assistant/hive-mind`](https://github.com/link-assistant/hive-mind).

### 14. Lint the Workflows Themselves

**The pipeline is code, and nothing lints it by default.** Workflow files accumulate shell quoting bugs, over-broad `permissions`, unpinned actions and template-injection sinks that no job in the pipeline is looking for, because every job is busy checking the application.

Two complementary tools, in their own workflow, triggered on changes to `.github/`:

- [`actionlint`](https://github.com/rhysd/actionlint) — syntax, expressions, and (crucially) the shell inside every `run:` block.
- [`zizmor`](https://docs.zizmor.sh/) — security audits: `excessive-permissions`, `unpinned-uses`, `template-injection`, `artipacked`.

```yaml
- uses: docker://rhysd/actionlint:1.7.12
  with:
    args: -color
```

- **Run actionlint as the Docker image, not a bare binary.** The image bundles `shellcheck` and `pyflakes`. A binary without `shellcheck` on `PATH` silently skips every shell check and exits 0 — so a green local run means nothing. This one detail is the difference between finding fourteen shell bugs and finding none.
- **Prefer annotations to SARIF** for zizmor unless code scanning is enabled everywhere the workflow runs. SARIF upload fails silently on forks; annotations fail loudly in both.
- **Set a confidence floor, not a severity floor.** `--min-confidence medium` filters by how sure the tool is, not by how bad the finding is. Review what falls below the floor once and record the decision, rather than discovering later that the floor was hiding a real finding.
- **Scope suppressions to a file, and write down when they can be removed.** A blanket `ignore` is indistinguishable from no gate at all.

### 15. Audit the Dependency Tree

**Code scanning does not audit your dependencies, and PR-scoped dependency review does not audit the ones you already have.** These two jobs look like coverage together and leave a hole between them: CodeQL analyses your source, while `dependency-review-action` runs only on `pull_request` and only inspects the dependencies a PR _changes_. An advisory published against a package that has been pinned for a year is invisible to both, forever, because no PR touches that line.

```yaml
- run: npm audit --package-lock-only --audit-level=high
```

- **Audit the lockfile as committed** (`--package-lock-only`). It reports what a consumer would get, and cannot be turned green by a resolution that only happens on this runner.
- **Put the job on the schedule**, not only on push. A scheduled run is the only thing that can notice an advisory published after the code stopped changing.
- **Set the level explicitly.** The default is `low`, which trains everyone to ignore the job; no flag at all is a different failure from a deliberate `--audit-level=high`.

### 16. Prove You Can Publish Before You Build

**A pull request exists to test the code; a push to the default branch exists to produce a release.** Those are different jobs, and a missing credential means different things to each. On a pull request it is a warning — forks have no secrets, and the code can still be tested. On the default branch it is the answer: if any credential needed for any planned release is unusable, nothing the run does afterwards can produce a release, and every minute spent building is waste.

Put a `preflight` job first and make every publishing job `needs:` it.

```yaml
release-preflight:
  runs-on: ubuntu-latest
  permissions:
    contents: read
    id-token: write # so the probe can confirm OIDC works before `npm publish` needs it
  steps:
    - uses: actions/checkout@v7
    - env:
        PREFLIGHT_MODE: ${{ github.event_name == 'push' && github.ref == 'refs/heads/main' && 'release' || 'report' }}
      run: node scripts/preflight-credentials.mjs --mode "$PREFLIGHT_MODE"

release:
  needs: [release-preflight]
  if: ${{ !cancelled() && needs.release-preflight.result == 'success' }}
```

- **Probe with a write, not with a login.** ghcr.io's token endpoint returns 200 for any scope and verifies nothing — the push then fails 403. docker.io answers an anonymous push-scope request with 200 and a pull-only `access` claim. Open a blob upload session (`POST /v2/<repo>/blobs/uploads/`) and cancel it with `DELETE <Location>`: one round trip, nothing stored, and the only form of the check that is not a guess.
- **Report every failure, not the first.** The preflight's value is one report naming all missing credentials. A login step that aborts the job hides the rest, so make it `continue-on-error: true` and let the preflight script decide.
- **Check reachability, not just writability.** A GHCR package is private on first push and stays private until someone clicks; publishing more versions of a package nobody can pull is exactly the compute this job exists to skip. GitHub exposes no API for package visibility (the packages REST API is GET/DELETE/restore only), so this is a manual step that the pipeline can only detect and name.
- **Prefer trusted publishing.** A credential that expires is a release outage waiting for a calendar date. npm (`id-token: write` + `--provenance`) and Docker Hub (`DOCKERHUB_OIDC_CONNECTIONID`, no `password:`) both support OIDC. Check `ACTIONS_ID_TOKEN_REQUEST_URL` before trying — the runner injects it only when `id-token: write` is granted, so a half-wired setup fails with a message about the permission rather than about the token request.
- **Verify the published result anonymously, and separately.** Never gate the release on the push (a failed mirror must not delete a good release), but do check afterwards, with no credentials, that what you published can be pulled. A check that authenticates measures the publisher's view; a reader gets neither the login nor the benefit of the doubt.
- **Report `unknown`, never a guess.** A registry that times out or answers HTTP 429 has not said the credential is broken, and a run in which nothing could be verified is not a pass. Say which of the two happened: "0 verified, 3 unknown" is actionable, "no failures" is not.

## Quality Enforcement Strategy

The templates implement a defense-in-depth approach:

```
Developer Machine    →    CI/CD Pipeline    →    Release
├── Pre-commit hooks      ├── detect-changes      ├── All checks pass
├── Local tests           ├── version-check       ├── Version bump
└── IDE integration       ├── changeset-check     ├── Changelog update
                          ├── test-compilation    └── Publish package
                          ├── lint (format+ESLint)
                          ├── check-file-line-limits
                          ├── test-suites
                          ├── test-execution
                          ├── validate-docs
                          └── docker-pr-check
```

Each layer catches different issues, ensuring no problematic code reaches production.

## Getting Started

1. **Choose a template** from the table above matching your language
2. **Use it as a GitHub template** to create your new repository
3. **Configure secrets** if needed for publishing (OIDC preferred)
4. **Start developing** with all best practices pre-configured

The AI solvers will automatically respect and iterate with all configured checks, producing higher quality output than repositories without CI/CD enforcement.

## Automatic CI/CD Remediation

For an existing repository, you don't need to apply these practices by hand. The `fix` command automates the whole flow:

```bash
fix https://github.com/owner/repo --ci-cd
```

This command:

1. **Detects the repository's languages** using the GitHub Linguist API (`GET /repos/{owner}/{repo}/languages`), ordered by the number of bytes per language.
2. **Selects the matching CI/CD templates** from the table above, sorted so the template for the most-used language comes first.
3. **Inspects the latest default-branch commit** and collects its CI/CD runs (falling back to the most recent runs on the default branch when the latest commit has none).
4. **Creates a remediation issue** that lists the failing runs, the detected languages, the recommended templates, and a link back to this document. The issue is created as a **Bug** (with a `bug` label) and its title and text are taken from the [standard remediation template](https://github.com/link-assistant/web-capture/issues/139).
5. **Hands the issue off to `/solve --development-log --deep-analysis --auto-merge`**, which iterates until the fixes are merged. Every option `fix` does not consume itself (for example `--tool`, `--model`, `--think`) is forwarded to `/solve`.

### Why the issue is a Bug, and what it leaves out

`--development-log` replaces the template's retired case-study-folder instruction and collects artifacts under `./dev/log/issues/{issue-id}/pulls/{pull-id}`. `/fix` never emits the retired paragraph, including with `--no-solve` or partial option sets. `--deep-analysis` supplies the timeline, root-cause, debug-output, and upstream-reporting guidance, so `fix` conditionally omits the matching paragraphs instead of delivering them twice.

That omission is only lossless because `/solve` emits the root-cause wording **only for bug-typed issues** — which is why `fix` creates the issue as a Bug. Issue types are configured per organization and labels per repository, so if the target repository accepts neither, the issue is still created without them.

The retired paragraph cannot be restored by an option combination; `--development-log` is the only supported collection workflow. The remaining conditional omissions are controlled by `--deep-analysis`.

### Language → Template Mapping

The command maps detected languages to templates as follows (JavaScript and TypeScript share a single template):

| Detected Language(s)  | Template                                                         |
| --------------------- | ---------------------------------------------------------------- |
| JavaScript/TypeScript | `link-foundation/js-ai-driven-development-pipeline-template`     |
| Rust                  | `link-foundation/rust-ai-driven-development-pipeline-template`   |
| Python                | `link-foundation/python-ai-driven-development-pipeline-template` |
| Go                    | `link-foundation/go-ai-driven-development-pipeline-template`     |
| C#                    | `link-foundation/csharp-ai-driven-development-pipeline-template` |
| Java                  | `link-foundation/java-ai-driven-development-pipeline-template`   |
| PHP                   | `link-foundation/php-ai-driven-development-pipeline-template`    |

Languages without a dedicated template (for example Shell or Dockerfile) are listed in the issue for awareness, and the closest matching template is recommended.

Use `--dry-run` to preview the issue without creating it, and `--no-solve` to create the issue without starting `/solve`:

```bash
fix owner/repo --ci-cd --dry-run
fix owner/repo --ci-cd --no-solve
```

## References

- [Code Architecture Principles](https://github.com/link-foundation/code-architecture-principles)
- [Contributing Guidelines](./CONTRIBUTING.md)
- [Best Practices](./BEST-PRACTICES.md)
