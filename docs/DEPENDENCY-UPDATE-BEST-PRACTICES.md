# Dependency Update Best Practices for AI-Driven Development (languages: en • [zh](DEPENDENCY-UPDATE-BEST-PRACTICES.zh.md) • [hi](DEPENDENCY-UPDATE-BEST-PRACTICES.hi.md) • [ru](DEPENDENCY-UPDATE-BEST-PRACTICES.ru.md))

This document describes how to bring every dependency of a repository — in every language it uses — to its latest version, and how to keep it there. It is the document referenced by every issue that `fix <repository-url> --update-all-dependencies` generates and by the `--update-all-dependencies` prompt that `solve`, `hive` and the Telegram bot inject, so the practices below are the ones the AI solver is asked to follow.

## Why Dependency Updates Matter for AI Development

A stale dependency tree costs more than the security advisories everyone talks about:

1. **The model works from an outdated API.** An AI solver writes code against the version it finds installed. Four years of pinned versions means four years of workarounds that the current release made unnecessary.
2. **Hand-rolled code accumulates.** Almost every "small helper" in a mature repository exists because the dependency did not have that feature _at the time_. It usually does now.
3. **Advisories pile up silently.** `dependency-review-action` only inspects the dependencies a pull request _changes_. An advisory published for a package pinned a year ago is invisible to it forever (see [Audit the tree you actually ship](#9-audit-the-tree-you-actually-ship)).
4. **Drift becomes unfixable.** Six majors behind is not six times the work of one major behind; migration guides assume you came from the previous release.

Updating everything at once, deliberately, is cheaper than updating nothing until something forces it.

## The Meaning of "All Dependencies"

"All" is literal. A dependency is anything the build resolves from outside the repository:

| Category                     | Examples                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------ |
| Runtime dependencies         | `dependencies`, `[dependencies]`, `require`, `install_requires`                |
| Development dependencies     | test runners, linters, formatters, type checkers, build plugins                |
| Transitive lockfile entries  | `package-lock.json`, `Cargo.lock`, `uv.lock`, `composer.lock`, `Gemfile.lock`  |
| Base images                  | every `FROM` in every `Dockerfile`, `docker-compose.yml`, `devcontainer.json`  |
| CI/CD actions                | every `uses:` in `.github/workflows/*.yml` and in composite `action.yml` files |
| Toolchains and language pins | `engines`, `rust-version`, the `go` directive, `TargetFramework`, `.nvmrc`     |
| Infrastructure modules       | Terraform modules and providers, Helm chart dependencies, git submodules       |
| Pre-commit hooks             | `.pre-commit-config.yaml` revisions                                            |

If a version number is written down somewhere in the repository, it is in scope.

## Per-Ecosystem Update Commands

The default command of most package managers deliberately stays **inside** the constraints already written in the manifest, so it can never cross a major version. The right-hand column is the command that actually rewrites the constraints. Each was verified against the tool's own documentation; the citations are in [`docs/case-studies/issue-2184/data/ecosystem-update-commands.json`](./case-studies/issue-2184/data/ecosystem-update-commands.json).

| Ecosystem             | Stays inside constraints         | Updates to latest, crossing majors                                              |
| --------------------- | -------------------------------- | ------------------------------------------------------------------------------- |
| JavaScript/TypeScript | `npm update`                     | `npx npm-check-updates -u && npm install`                                       |
| Python                | `pip install -U`                 | `uv lock --upgrade` • `pip-compile --upgrade` • `poetry update`                 |
| Rust                  | `cargo update`                   | `cargo upgrade --incompatible && cargo update` (cargo-edit)                     |
| Go                    | —                                | `go get -u ./... && go mod tidy`                                                |
| C#/.NET               | `dotnet list package --outdated` | `dotnet outdated -u` (dotnet-outdated)                                          |
| Java/Kotlin/Scala     | `./gradlew dependencyUpdates`    | `mvn versions:use-latest-releases versions:update-properties`                   |
| PHP                   | `composer update`                | `composer require vendor/pkg:^X` then `composer update --with-all-dependencies` |
| Ruby                  | `bundle update`                  | `bundle update --all` after raising the Gemfile constraints                     |
| Elixir/Erlang         | `mix deps.update --all`          | edit `mix.exs`, then `mix deps.update --all`                                    |
| Dart/Flutter          | `dart pub upgrade`               | `dart pub upgrade --major-versions`                                             |
| Swift                 | `swift package update`           | edit `Package.swift` requirements, then `swift package update`                  |
| Haskell               | `cabal outdated`                 | `cabal update` • `stack upgrade --resolver latest`                              |
| GitHub Actions        | —                                | bump every `uses:` to the newest release (tag or pinned digest)                 |
| Docker                | —                                | bump every `FROM` tag and re-pin the digest                                     |
| Infrastructure        | —                                | `terraform init -upgrade` • `helm dependency update` • `pre-commit autoupdate`  |

Three traps hide in that table:

- **`npm update` never crosses a major.** It resolves inside the `^`/`~` ranges in `package.json`. Only `npm-check-updates -u` rewrites the ranges themselves; `--target latest` is its default.
- **`cargo update --breaking` is nightly-only** (`-Z unstable-options`). On stable, crossing a major means `cargo upgrade --incompatible` from `cargo-edit`.
- **Maven pins versions in `<properties>`.** `versions:use-latest-releases` alone leaves every property-pinned version behind — run `versions:update-properties` in the same invocation.

## Key Principles

### 1. Produce a Table Before Changing Anything

For each ecosystem, list every dependency with the version pinned today and the version released today, **resolved from the registry, not from memory**. A model's training data has a cutoff; the registry does not. Use `npm view <pkg> version`, `cargo search`, `pip index versions`, `gh release list`, or the ecosystem equivalent.

The table is what makes the result reviewable: a reader can see at a glance what moved, what did not, and what was skipped.

### 2. Anything Left Behind Needs a Written Reason

A dependency that stayed on an old version is a decision, and decisions get recorded — an upstream bug with a link, a dropped platform, a paid tier, a peer dependency that has not caught up. Silence is indistinguishable from an oversight, and the next person will spend an hour rediscovering it.

### 3. Cross Major Versions Deliberately

For every major bump: read the changelog and the migration guide, adapt the code to the new API, and delete the shims the old version needed.

**A constraint loosened or a test skipped to make a major "pass" is not an update.** The two anti-patterns to watch for:

```diff
- "some-lib": "^3.0.0"
+ "some-lib": "*"          # not an update: a range that hides the problem
```

```diff
- it('serialises nested nodes', () => { ... })
+ it.skip('serialises nested nodes', () => { ... })   # not an update: a deleted signal
```

### 4. Adopt the New Features and Delete the Hand-Rolled Copies

This is the principle with the highest payoff and the one most often skipped. When a newer version ships something the repository implements by hand, remove the local copy and use the upstream feature. Concretely:

- a local `deepMerge`/`retry`/`debounce` helper the library now exports,
- a polyfill for a platform API that the new runtime baseline provides,
- a custom CLI parser the framework now covers,
- a bespoke cache the client library gained natively.

**There should be less duplicated code and logic after the update than before it.** If the diff only moves version numbers, the update was not finished.

### 5. Make the Constraints Honest

- **Raise floors** that sit years below what is actually installed. A `>=1.0` floor with `4.2` in the lockfile means CI and a fresh `pip install` are not testing the same tree.
- **Drop upper bounds** that exclude the current release. `<5` written when `4` was current is a pin nobody decided on.
- **Regenerate and commit every lockfile.** An updated manifest with a stale lockfile is a repository where the CI result and the consumer's install disagree.

### 6. One Version per Dependency Across the Whole Repository

If the same dependency is pinned in more than one place — several language implementations of the same protocol, a `Dockerfile`, a workflow, a docs snippet — bring every pin to the same version. A repository that pins one library at four different versions has four different behaviours and only tests one of them.

### 7. Update the Toolchain, Not Only the Packages

The language version is a dependency:

- `engines.node` / `.nvmrc` / `actions/setup-node@v5` `node-version`
- `rust-version` and `edition` in `Cargo.toml`
- the `go` directive in `go.mod`
- `TargetFramework` in `*.csproj`, and `global.json`
- `maven.compiler.source`/`target`, the Gradle wrapper version
- `requires-python` in `pyproject.toml`

A test SDK or an assertion library major usually moves together with the toolchain, so update them in the same pass.

### 8. Green CI and Zero New Deprecation Warnings

Run the full build, test and lint suite of **every** ecosystem after updating — not only the one you changed last — and make CI green. Then resolve the deprecation warnings the update introduced. A warning left in place today is the breaking change that blocks the next update.

### 9. Audit the Tree You Actually Ship

After the update, check the advisories for the resulting tree:

```bash
npm audit --package-lock-only --audit-level=high   # JavaScript/TypeScript
cargo audit                                        # Rust
pip-audit                                          # Python
bundle audit                                       # Ruby
dotnet list package --vulnerable                   # C#/.NET
govulncheck ./...                                  # Go
```

`--package-lock-only` matters: it audits the lockfile **as committed**, so the result is what a consumer would get and cannot be turned green by a resolution that only happens on this runner. Put the equivalent job on a schedule, because a scheduled run is the only thing that can notice an advisory published after the code stopped changing. See [CI/CD Best Practices](./CI-CD-BEST-PRACTICES.md) for the workflow job itself.

### 10. Report Blockers Upstream

When an update is blocked by a bug in a dependency, open an issue on that project's GitHub with a reproducible example, the workaround used here, and a suggested fix in code — then link that report from the work instead of silently pinning back. A pin with a link is a tracked decision; a pin without one is permanent.

## Keeping It Current Automatically

Updating once and stopping produces the same backlog again in a year. Configure an updater so the next drift arrives as a pull request instead of another issue.

### Dependabot

Dependabot accepts 33 `package-ecosystem` values, covering every ecosystem in the table above except Haskell. One `updates:` entry is needed **per ecosystem and per directory** — a monorepo with three `package.json` files needs three `npm` entries.

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    groups:
      all-dependencies:
        patterns: ['*']
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
  - package-ecosystem: docker
    directory: /
    schedule:
      interval: weekly
```

Two settings do most of the work:

- **`groups`** collapses what would otherwise be dozens of single-dependency pull requests into one, so the CI cost and the review cost stay bounded.
- **`open-pull-requests-limit`** (default 5) silently stops opening pull requests once reached — if Dependabot seems to have stopped, this is usually why.

Note that Dependabot alone will not do the work described in principles 3 and 4: it bumps the version and stops. It keeps small drift from accumulating; it does not migrate an API or delete a shim.

### Renovate

[Renovate](https://github.com/renovatebot/renovate) covers a broader set of managers and can be self-hosted. Its `rangeStrategy: bump` and grouping presets serve the same purpose as the configuration above; pick one updater and configure it properly rather than running both.

## Automatic Dependency Remediation

You do not have to apply any of this by hand. The `fix` command automates the whole flow, exactly as `fix --ci-cd` does for pipelines:

```bash
fix https://github.com/owner/repo --update-all-dependencies
```

This command:

1. **Detects the repository's languages** using the GitHub Linguist API (`GET /repos/{owner}/{repo}/languages`), ordered by bytes per language.
2. **Lists the default branch's file tree** (`GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1`) and finds every committed manifest and lockfile, skipping vendored directories such as `node_modules/`, `vendor/`, `.venv/` and `target/`.
3. **Maps both signals onto package ecosystems.** Either signal alone is wrong: Linguist misses ecosystems with no source code of their own (GitHub Actions, Docker, Terraform), and manifests miss a language whose manifest is unusual or absent.
4. **Creates a maintenance issue** listing every detected ecosystem with the manifests found, the lockfiles to regenerate, the command that crosses majors there, a Dependabot configuration hint, and the standard prompt built from the principles above. The issue is created as a **Task** with a `dependencies` label.
5. **Hands the issue off to `/solve --development-log --deep-analysis --auto-merge --update-all-dependencies`**, which iterates until the update is merged. Every option `fix` does not consume itself (for example `--tool`, `--model`, `--think`) is forwarded to `/solve`.

Use `--dry-run` to preview the issue without creating it, and `--no-solve` to create the issue without starting `/solve`:

```bash
fix owner/repo --update-all-dependencies --dry-run
fix owner/repo --update-all-dependencies --no-solve
```

### Why the Issue Is a Task, and What It Leaves Out

`/solve --deep-analysis` emits its root-cause and debug-output guidance **only for bug-typed issues**, and a dependency bump has no root cause to find. Creating the issue as a `Task` selects the non-bug variant of that prompt — research, requirement coverage, solution planning — which is the useful one here. Issue types are configured per organization and labels per repository, so if the target repository accepts neither, the issue is still created without them.

`--deep-analysis` also supplies the upstream-reporting guidance of [principle 10](#10-report-blockers-upstream), so `fix` omits that paragraph from the issue body instead of delivering it twice. Every other paragraph is unconditional.

## The `--update-all-dependencies` Option

The same prompt is available as an option on every command that runs a solver, disabled by default:

```bash
solve https://github.com/owner/repo/issues/123 --update-all-dependencies
hive https://github.com/owner/repo --update-all-dependencies
```

In the Telegram bot, the flag is accepted on `/solve`, `/hive`, `/fix` and `/task` in the same form.

Turning it on appends a dependency-update section to the solver's system prompt, so the work the issue asks for is done **with** every dependency brought current, rather than on top of a stale tree. It is disabled by default because bundling an unrequested dependency migration into an unrelated bug fix makes the pull request unreviewable — turn it on when the update is part of what you want, or use `fix --update-all-dependencies` when it is the whole point.

Supported for `--tool claude`, `--tool codex`, `--tool opencode`, `--tool agent`, `--tool qwen` and `--tool gemini`.

## References

- [CI/CD Best Practices](./CI-CD-BEST-PRACTICES.md)
- [Configuration Reference](./CONFIGURATION.md)
- [Case study: issue #2184](./case-studies/issue-2184/README.md)
- [Dependabot options reference](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference)
- [npm-check-updates](https://github.com/raineorshine/npm-check-updates)
- [cargo-edit](https://github.com/killercup/cargo-edit)
- [versions-maven-plugin](https://www.mojohaus.org/versions/versions-maven-plugin/index.html)
