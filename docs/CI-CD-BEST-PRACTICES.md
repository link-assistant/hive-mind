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

**Prohibit manual version changes** in PRs — all version bumps should be managed by the CI release workflow:

```yaml
version-check:
  if: github.event_name == 'pull_request'
  steps:
    - name: Check for version changes in package.json
      run: node scripts/check-version.mjs
```

### 10. Concurrency Control

**Prevent multiple workflow runs from conflicting:**

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  # Cancel older runs on main to always release the latest version
  cancel-in-progress: ${{ github.ref == 'refs/heads/main' }}
```

Use `!cancelled()` instead of `always()` in job conditions so cancellation propagates correctly through the job graph.

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
