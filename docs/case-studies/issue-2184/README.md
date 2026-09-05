# Case Study: Issue #2184 — `/fix --update-all-dependencies`

|                       |                                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Issue                 | [link-assistant/hive-mind#2184](https://github.com/link-assistant/hive-mind/issues/2184) — `` `/fix --update-all-dependencies` `` |
| Opened                | 2026-08-28 by @konard, labels `documentation`, `enhancement`                                                                      |
| Comments on the issue | none — every requirement below comes from the description itself                                                                  |
| Pull request          | [#2214](https://github.com/link-assistant/hive-mind/pull/2214)                                                                    |
| Branch                | `issue-2184-8300c30afbb5`                                                                                                         |
| Sibling case study    | [`issue-1733`](../issue-1733/README.md) — `/fix --ci-cd`, the mode this one is explicitly modelled on                             |

## 1. Summary

`/fix` had exactly one mode, `--ci-cd` (issue #1733): point it at a repository, it
collects the repository's real state from the GitHub API, writes a remediation
issue from that state plus a fixed "standard prompt", and hands the issue to
`/solve --development-log --deep-analysis --auto-merge`.

Issue #2184 asks for the same machine aimed at a different target: update every
dependency, in every language, in the repository. Plus a `/solve` option, off by
default, so the same instructions can ride along with any other task.

Three things made this more than copying a file:

1. **"All dependencies" is ecosystem-specific, and the obvious command is usually
   wrong.** `npm update` never crosses a major version. `cargo update --breaking`
   is nightly-only. Maven versions usually live in `<properties>`, not in
   `<dependency>`. A prompt that says "update all dependencies" without saying
   _how_ produces a run that bumps patch versions and reports success. The
   commands shipped in the catalog were each verified against the tool's own
   documentation ([`data/ecosystem-update-commands.json`](data/ecosystem-update-commands.json)).
2. **`/fix` was written for one mode.** Argument parsing, GitHub access and the
   mode-specific issue building all lived in `fix.ci-cd.lib.mjs`. Adding a second
   mode by copying it would have produced two divergent copies of the handoff.
   The shared parts were extracted first, so the flow (validate → prepare →
   dry-run → create → solve) is written once for both modes.
3. **The prompt is shared between two carriers.** The same paragraphs go into the
   generated issue body (`/fix`) and into the AI system prompt
   (`/solve --update-all-dependencies`). They are built from one array of tagged
   paragraphs, so the two cannot drift.

Result: `/fix --update-all-dependencies`, `/task --update-all-dependencies`,
`/solve --update-all-dependencies` (and via passthrough `/hive` and the Telegram
bot), a 15-ecosystem catalog, a four-language best-practices document, and 45
unit tests.

## 2. Original issue (verbatim)

> Add a feature to update all dependencies in the repository in all programming
> languages, similar to how we do `/fix --ci-cd`.
>
> We also should add similar option to all our `/solve` commands.
>
> By default it is disabled.
>
> We need to collect data related about the issue to this repository, make sure
> we compile that data to `./docs/case-studies/issue-{id}` folder, and use it to
> do deep case study analysis (also make sure to search online for additional
> facts and data), list of each and all requirements from the issue, and propose
> possible solutions and solution plans for each requirement (we should also
> check known existing components/libraries, that solve similar problem or can
> help in solutions).
>
> Please plan and execute everything in this single pull request, you have
> unlimited time and context, as context auto-compacts and you can continue
> indefinitely, until it is each and every requirement fully addressed, and
> everything is totally done.

The full record, including the empty comment thread, is in
[`data/issue-2184.json`](data/issue-2184.json) and
[`data/issue-2184-comments.json`](data/issue-2184-comments.json).

## 3. Enumerated requirements

| #   | Requirement                                                                                                                         | Source                                                                                        | Where it is satisfied                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| R1  | A `/fix` mode that updates all dependencies, in all programming languages                                                           | "Add a feature to update all dependencies… in all programming languages"                      | `src/fix.update-dependencies.lib.mjs`, `src/fix.update-dependencies-issue.lib.mjs`, `src/fix.mjs`              |
| R2  | It works "similar to how we do `/fix --ci-cd`" — same shape: collect real repository state, generate an issue, hand off to `/solve` | "similar to how we do `/fix --ci-cd`"                                                         | `MODE_HANDLERS` in `src/fix.mjs`; shared `src/fix.args.lib.mjs` + `src/fix.github.lib.mjs`                     |
| R3  | A matching option on **all** `/solve` commands                                                                                      | "We also should add similar option to all our `/solve` commands"                              | `SOLVE_OPTION_DEFINITIONS['update-all-dependencies']`; hive passthrough; Telegram; all six tool prompts        |
| R4  | Disabled by default                                                                                                                 | "By default it is disabled"                                                                   | `default: false`; `getUpdateAllDependenciesSubPrompt` returns `''` unless `argv.updateAllDependencies`; tested |
| R5  | Collect the data about the issue into `./docs/case-studies/issue-2184`                                                              | "compile that data to `./docs/case-studies/issue-{id}` folder"                                | [`data/`](data/) — 9 files                                                                                     |
| R6  | Deep case study analysis, including online research                                                                                 | "do deep case study analysis (also make sure to search online for additional facts and data)" | this document; [`research-sources.json`](research-sources.json)                                                |
| R7  | List each and all requirements from the issue                                                                                       | "list of each and all requirements"                                                           | this table                                                                                                     |
| R8  | Propose solutions and solution plans per requirement                                                                                | "propose possible solutions and solution plans for each requirement"                          | §6                                                                                                             |
| R9  | Check existing components/libraries that solve a similar problem                                                                    | "we should also check known existing components/libraries"                                    | §5                                                                                                             |
| R10 | Everything in this single pull request                                                                                              | "plan and execute everything in this single pull request"                                     | PR #2214                                                                                                       |

## 4. Evidence collected

| File                                                                                 | What it is                                                                                               | How it was captured                                                                                         |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [`data/issue-2184.json`](data/issue-2184.json)                                       | The issue itself: body, labels, author, timestamps                                                       | `gh issue view 2184 --json …`                                                                               |
| [`data/issue-2184-comments.json`](data/issue-2184-comments.json)                     | The comment thread — empty, so the description is the whole specification                                | `gh api repos/link-assistant/hive-mind/issues/2184/comments`                                                |
| [`data/repo-languages.json`](data/repo-languages.json)                               | GitHub's language breakdown of this repository                                                           | `gh api repos/link-assistant/hive-mind/languages`                                                           |
| [`data/hive-mind-manifest-inventory.json`](data/hive-mind-manifest-inventory.json)   | Every manifest, lockfile, Dockerfile and workflow in this repository                                     | `git ls-files`, filtered by the catalog's own matchers                                                      |
| [`data/ecosystem-update-commands.json`](data/ecosystem-update-commands.json)         | The "update everything to latest" command for 13 ecosystems, each with the upstream quote that proves it | WebFetch against each tool's documentation                                                                  |
| [`data/dependabot-package-ecosystems.json`](data/dependabot-package-ecosystems.json) | All 33 accepted `package-ecosystem` values                                                               | WebFetch against GitHub's Dependabot options reference, cross-checked against the supported-ecosystems page |
| [`data/links-notation-issue-292.json`](data/links-notation-issue-292.json)           | Prior art: "Update all dependencies in all eight languages…"                                             | `gh issue view` on link-foundation/links-notation#292                                                       |
| [`data/lino-objects-codec-issue-47.json`](data/lino-objects-codec-issue-47.json)     | Prior art: "Update all dependencies in all four languages…"                                              | `gh issue view` on link-foundation/lino-objects-codec#47                                                    |
| [`data/router-issue-372.json`](data/router-issue-372.json)                           | Prior art: "Update all dependencies… and use all the best new features from them"                        | `gh issue view` on link-assistant/router#372                                                                |

### 4.1 What the prior art contributed

The three prior-art issues are hand-written instances of exactly the issue this
feature generates. They were read for structure, and the structure was kept:

- **Per-language sections, each with a table of `dependency | pinned | latest`.**
  All three issues are built this way. That table became a required deliverable
  in the standard prompt ("produce a table of every dependency with the version
  pinned today and the version released today, resolved from the registry — not
  from memory"), because it is what turns "update everything" into something a
  reviewer can check.
- **"Use all the best new features from them, where relevant, so we reuse modern
  features, and duplicate code and logic less"** (router#372, verbatim). This is
  not a normal dependency-bot requirement, and it is the reason a bot is not a
  sufficient answer to this issue — see §5. It became the "Use the new features"
  paragraph.
- **One version per dependency across the whole repository.** lino-objects-codec#47
  singles out "four different `links-notation` pins" as "the sharpest case
  because it changes what documents mean". That became its own paragraph and its
  own principle in the best-practices document.
- **The toolchain counts as a dependency.** links-notation#292 and #47 both flag
  `edition = "2021"` / `rust-version = "1.70"` alongside the package versions.

### 4.2 What the evidence says about this repository

`data/repo-languages.json` reports JavaScript, Shell, Dockerfile and Go Template.
`data/hive-mind-manifest-inventory.json` finds 12 files: `package.json`,
`package-lock.json`, five Dockerfiles and five workflows. So on hive-mind itself
the feature must detect three ecosystems — npm, Docker and GitHub Actions — from
a repository whose GitHub language stats mention neither of the latter two by
those names. This is why detection is by _file path_ as well as by language:
`mapRepositoryToEcosystems({ languages, files })` unions both signals.

## 5. Existing components and libraries surveyed

| Component                                                                                                                                                                                                                                     | What it does                                                         | Why it is not the answer here                                                                                                                                                                        | What was taken from it                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Dependabot version updates](https://docs.github.com/en/code-security/dependabot)                                                                                                                                                             | Opens one PR per outdated dependency, per ecosystem, on a schedule   | Stays inside what it can bump mechanically; will not adapt code to a new API, will not delete a hand-rolled implementation that upstream now provides, and does not produce a repository-wide report | Its 33 `package-ecosystem` values are the mapping the generated issue recommends; `buildAutomationSection` emits a ready `.github/dependabot.yml` for the detected ecosystems |
| [Renovate](https://docs.renovatebot.com/)                                                                                                                                                                                                     | Same, with grouping, auto-merge rules and far more ecosystems        | Same limit: it is a bumper, not a migrator                                                                                                                                                           | Named as the alternative in the automation section and in the best-practices document                                                                                         |
| [`npm-check-updates`](https://github.com/raineorshine/npm-check-updates)                                                                                                                                                                      | `ncu -u` rewrites `package.json` to each package's `latest` dist-tag | It is a tool, not a workflow — nothing decides what to do with the breakage                                                                                                                          | It is the JavaScript command in the catalog, precisely because `npm update` cannot cross a major                                                                              |
| [`cargo-edit`](https://github.com/killercup/cargo-edit) (`cargo upgrade --incompatible`)                                                                                                                                                      | Rewrites `Cargo.toml` across major versions                          | idem                                                                                                                                                                                                 | Rust command in the catalog; the nightly-only `cargo update --breaking` is recorded as the alternative                                                                        |
| [`dotnet-outdated`](https://github.com/dotnet-outdated/dotnet-outdated), [`versions-maven-plugin`](https://www.mojohaus.org/versions/versions-maven-plugin/), [`gradle-versions-plugin`](https://github.com/ben-manes/gradle-versions-plugin) | Ecosystem-native "what is outdated / upgrade it" tools               | idem                                                                                                                                                                                                 | C#/Java commands in the catalog                                                                                                                                               |
| `/fix --ci-cd` (issue #1733, this repository)                                                                                                                                                                                                 | The same generate-issue-then-solve pipeline for CI/CD                | Not applicable to dependencies as-is                                                                                                                                                                 | **The architecture.** Everything reusable was extracted and shared rather than copied                                                                                         |
| `--deep-analysis`, `--development-log` (this repository)                                                                                                                                                                                      | Existing `/solve` sub-prompts                                        | —                                                                                                                                                                                                    | Their paragraphs overlap the dependency prompt; the `providedBy` mechanism from #1733 drops the duplicates                                                                    |

The conclusion of the survey is the design: the mechanical part of this problem
is solved well by existing tools, so the generated issue _recommends and
configures them_ (`buildAutomationSection`) instead of reimplementing them, and
the AI-driven part is the part they cannot do — crossing majors, adapting code,
adopting new features, and reporting blockers upstream.

## 6. Per-requirement solution plans

### R1 + R2 — the `/fix` mode

**Options considered.** (a) Copy `fix.ci-cd.lib.mjs` and edit it. (b) Generalize
`/fix` into a mode registry and share everything that is not mode-specific.
(c) Make dependency updating a flag _on_ `--ci-cd`.

(c) was rejected because the two produce different issues with different labels
and different solve options. (a) was rejected because the handoff to `/solve` —
the part most likely to change — would exist twice.

**What was built (b).** Three extractions, then one addition:

- `src/fix.args.lib.mjs` — repository parsing, `partitionFixArgs`, and the mode
  registry `FIX_MODES`. `partitionFixArgs` now returns `modes[]`, so "no mode"
  and "two modes" are both first-class errors instead of one mode silently
  winning.
- `src/fix.github.lib.mjs` — `runCommand`, `detectLanguages`, `getDefaultBranch`,
  `getLatestCommit`, the workflow-run readers, and the new
  `getRepositoryFiles(repository, branch)` (a `git/trees?recursive=1` read that
  reports GitHub's `truncated` flag rather than pretending the listing is
  complete).
- `MODE_HANDLERS` in `src/fix.mjs` — each mode contributes only `prepare`,
  `create` and `summarize`; the flow around them is written once.
- `src/fix.update-dependencies.lib.mjs` — the new mode's catalog, detection and
  issue body. Pure functions, no network: everything is unit-testable.

**The catalog.** 15 ecosystems (JavaScript/TypeScript, Python, Rust, Go, C#/.NET,
Java/Kotlin/Scala, PHP, Ruby, Elixir/Erlang, Dart/Flutter, Swift, Haskell,
GitHub Actions, Docker, infrastructure as code), each with manifests, lockfiles,
path patterns, Dependabot values, an update command and a note about that
ecosystem's trap.

### R3 — the `/solve` option, everywhere

**Plan.** Do _not_ thread a new flag through each command by hand. This
repository already has a single source of truth: `SOLVE_OPTION_DEFINITIONS` in
`src/solve.config.lib.mjs`, from which `src/hive.config.lib.mjs` derives hive's
passthrough list automatically. One definition therefore reaches `/solve`,
`/hive`, and the Telegram `/solve` and `/hive` commands.

The prompt injection follows the established sub-prompt module pattern
(`architecture-care`, `handoff`, `experiments-examples`):
`src/update-dependencies.prompts.lib.mjs` exports
`buildUpdateAllDependenciesSubPrompt()` and `getUpdateAllDependenciesSubPrompt(argv)`,
wired into all six tool prompt builders — claude, codex, opencode, agent, qwen,
gemini — inside `buildSystemPrompt`. A test asserts all six, so a seventh tool
added later without the wiring fails the suite.

`/task --update-all-dependencies` was added alongside, mirroring
`/task --ci-cd`: same generated issue, but it stops before `/solve` so a human
decides when to start. The two `/task` modes are now a data table
(`TASK_GENERATED_ISSUE_MODES`) rather than two branches.

### R4 — disabled by default

`default: false` in the option definition; `getUpdateAllDependenciesSubPrompt`
returns `''` when `argv.updateAllDependencies` is falsy. The Telegram `/fix`
default needed care: it implies `--ci-cd` when no mode is given, and implying it
on top of an explicit `--update-all-dependencies` would make the CLI reject the
request as two modes at once. `applyFixCommandDefaults` now checks for _any_
mode. Tested in both directions.

### R5–R9 — the case study

Data collected into [`data/`](data/) as it was used, not reconstructed
afterwards; the shipped code cites it (the JavaScript note in the catalog is the
`npm-check-updates` finding; `buildAutomationSection`'s values are the Dependabot
list). Online research is recorded with the quote that justified each command, in
[`research-sources.json`](research-sources.json).

The research also caught a bug in the shipped code. `DEPENDENCY_ECOSYSTEMS`
declared `dependabot: ['npm', 'yarn', 'pnpm', 'bun']` for JavaScript — but
`pnpm` is not one of the 33 accepted `package-ecosystem` values. GitHub covers
`pnpm-lock.yaml` under `npm`. Since `buildAutomationSection` prints these values
verbatim into a recommended `.github/dependabot.yml`, the generated issue would
have advised a configuration GitHub rejects. Fixed, with a regression test that
checks every catalog value against the captured list.

## 7. The documentation requirement

The issue is labelled `documentation` as well as `enhancement`, and the standard
prompt ends with a link to `docs/DEPENDENCY-UPDATE-BEST-PRACTICES.md` — the
dependency-side counterpart of the `CI-CD-BEST-PRACTICES.md` that
`/fix --ci-cd` links. That document did not exist, so every generated issue would
have carried a 404.

It now exists in all four repository languages
([en](../../DEPENDENCY-UPDATE-BEST-PRACTICES.md) ·
[zh](../../DEPENDENCY-UPDATE-BEST-PRACTICES.zh.md) ·
[hi](../../DEPENDENCY-UPDATE-BEST-PRACTICES.hi.md) ·
[ru](../../DEPENDENCY-UPDATE-BEST-PRACTICES.ru.md)), covering what "all
dependencies" means, the per-ecosystem command table with its three traps, ten
principles, and how to keep it current with Dependabot or Renovate. The `/fix`
section of all four READMEs and one row per language in `docs/CONFIGURATION*.md`
document the new mode and option where users look for them.

## 8. Implementation map

| File                                                                    | Role                                                                                                                                        |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/fix.args.lib.mjs`                                                  | **new** — repository parsing, `FIX_MODES`, `partitionFixArgs`, `solveOptionsForMode`, `buildSolveArgs` (extracted from `fix.ci-cd.lib.mjs`) |
| `src/fix.github.lib.mjs`                                                | **new** — shared GitHub reads, plus `getRepositoryFiles`                                                                                    |
| `src/fix.update-dependencies.lib.mjs`                                   | **new** — ecosystem catalog, detection, issue title/body, standard prompt paragraphs                                                        |
| `src/fix.update-dependencies-issue.lib.mjs`                             | **new** — `prepareUpdateDependenciesIssue` / `createUpdateDependenciesIssue`                                                                |
| `src/update-dependencies.prompts.lib.mjs`                               | **new** — the `/solve` sub-prompt module                                                                                                    |
| `src/fix.mjs`                                                           | `MODE_HANDLERS`; mode required, exactly one                                                                                                 |
| `src/fix.ci-cd.lib.mjs`, `src/fix.ci-cd-issue.lib.mjs`                  | re-export from the extracted modules; behaviour unchanged                                                                                   |
| `src/solve.config.lib.mjs`, `src/option-suggestions.lib.mjs`            | the option definition and its typo suggestions                                                                                              |
| `src/{claude,codex,opencode,agent,qwen,gemini}.prompts.lib.mjs`         | sub-prompt wiring                                                                                                                           |
| `src/telegram-fix-command.lib.mjs`, `src/telegram-task-command.lib.mjs` | mode-aware `/fix` and `/task`                                                                                                               |
| `docs/DEPENDENCY-UPDATE-BEST-PRACTICES{,.zh,.hi,.ru}.md`                | **new** — the document the prompt links                                                                                                     |
| `tests/test-fix-update-dependencies.mjs`                                | **new** — 45 tests                                                                                                                          |

## 9. Reproduction

```bash
# Preview the generated issue without creating anything:
./src/fix.mjs https://github.com/owner/repo --update-all-dependencies --dry-run

# Create the issue but do not start /solve:
./src/fix.mjs owner/repo --update-all-dependencies --no-solve

# Full flow, forwarding solve options:
./src/fix.mjs owner/repo --update-all-dependencies --tool codex --think max

# Attach the same instructions to an unrelated task:
./src/solve.mjs https://github.com/owner/repo/issues/1 --update-all-dependencies

# The tests:
node tests/test-fix-update-dependencies.mjs
```

## 10. Files in this case study

```
docs/case-studies/issue-2184/
├── README.md                                  this analysis
├── research-sources.json                      every source, with what it settled
└── data/
    ├── issue-2184.json                        the issue
    ├── issue-2184-comments.json               its (empty) comment thread
    ├── repo-languages.json                    this repository's languages
    ├── hive-mind-manifest-inventory.json       its manifests, lockfiles, images, workflows
    ├── ecosystem-update-commands.json         13 verified update commands
    ├── dependabot-package-ecosystems.json     the 33 accepted package-ecosystem values
    ├── links-notation-issue-292.json          prior art (8 languages)
    ├── lino-objects-codec-issue-47.json       prior art (4 languages)
    └── router-issue-372.json                  prior art ("use the best new features")
```
