# Issue #2264: dependency freshness across CI and long-lived containers

## Executive summary

Issue [#2264](https://github.com/link-assistant/hive-mind/issues/2264) began
with an apparent version contradiction: a running Hive Mind container printed
`gh-upload-log --version` as 0.1.0 although GitHub showed release 0.9.0. The
contradiction was real, but it combined three independent kinds of drift:

1. the CLI printed a hard-coded version;
2. GitHub release 0.9.0 existed while npm still served 0.8.2 because the
   upstream publish command failed and its wrapper reported success anyway;
3. Hive Mind installed operational tools during image construction but its
   six-hour, idle-only updater refreshed only agentic CLIs. A long-lived
   container therefore could not acquire a corrected operational tool.

The repository also had no unified inventory of its dependency declarations.
`package.json`, Dockerfiles, `use-m` runtime pins, workflow action refs, setup
tool inputs, base images, and embedded binaries all had different update paths.
The first complete automated pass found 17 stale declarations in 138 records;
expanding the inventory to the remaining embedded versions produced 148
tracked declarations. All 148 are current after this change.

The solution has four layers:

- a fail-closed freshness scanner runs before the release workflow publishes
  its change-detection outputs;
- Dependabot proposes one daily, multi-ecosystem update across npm, actions,
  Docker, Compose, and Helm;
- long-lived containers refresh safe operational CLIs under the existing idle
  lock and six-hour throttle;
- the repository's main ruleset requires the terminal workflow status, making
  the freshness failure a merge blocker rather than advisory output.

The upstream publication problem was fixed concurrently by
[gh-upload-log PR #41](https://github.com/link-foundation/gh-upload-log/pull/41),
and npm published 0.9.1 on 2026-09-20. A second false-success defect discovered
in that successful release was reported as
[gh-upload-log issue #43](https://github.com/link-foundation/gh-upload-log/issues/43).
A real executable probe also found that npm's current `gh-load-issue` artifact
cannot start; the source fix is on its main branch but remains unpublished. That
was reported as
[gh-load-issue issue #18](https://github.com/link-foundation/gh-load-issue/issues/18),
and prompted a package-manager metadata fallback in the idle updater.

## Requirements and disposition

| ID  | Requirement reconstructed from #2264                                                                        | Disposition                                                                                                                                                                                                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Prevent a PR from merging while a newer dependency/tool version is available.                               | `scripts/check-dependency-freshness.mjs` checks every supported declaration before `detect-changes`; the terminal workflow status observes that job and the active main ruleset requires the terminal status. Resolution errors fail closed.                                                      |
| R2  | Dynamically update dependencies in already-running Hive Mind containers where safe.                         | The idle updater now covers six operational utilities in addition to the agentic CLIs. It keeps the existing active-task guard, lock, interval, allow-list, deny-list, and per-target failure isolation.                                                                                          |
| R3  | Bring all dependency surfaces current, with special attention to Link Foundation/Link Assistant components. | npm, runtime `use-m`, Docker, Formal AI, Helm, workflow-action, loader, and internal CLI pins were audited and updated. The final inventory is 148/148 current.                                                                                                                                   |
| R4  | Reduce local workarounds and report reusable defects to upstream projects.                                  | The `gh-upload-log` release failure was diagnosed from archived logs and reported in #42; it was closed as a duplicate after PR #41 shipped the same fix. The release-note false success was reported in #43. The unpublished `gh-load-issue` entry-point fix was reported in gh-load-issue#18.   |
| R5  | Preserve all related logs and data in `docs/case-studies/issue-2264`.                                       | Issue/PR API payloads, registry metadata, workflow metadata, compressed full logs, dependency scans, reports, and ruleset snapshots are stored in `data/` and indexed below.                                                                                                                      |
| R6  | Reconstruct the timeline, root causes, alternatives, and evidence using online research.                    | This document records the reconstruction, maps each conclusion to evidence, and cites the primary GitHub/npm documentation used for the design.                                                                                                                                                   |
| R7  | Apply the requirement to the whole codebase rather than the reported utility alone.                         | The scanner covers package manifests, all workflow YAML, all production Dockerfiles, runtime pins, bootstrap URLs, base images, embedded tool versions, and setup inputs. Dependabot covers every supported manifest ecosystem and runtime updating covers every safe globally installed utility. |

## Timeline

All times are UTC.

| Time                   | Event and evidence                                                                                                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-06-22 09:43       | npm publishes `gh-upload-log@0.8.2`; it remains the registry's `latest` for almost three months. See `data/gh-upload-log-npm-metadata-before.json`.                                                   |
| 2026-08-22 17:46       | Release run 32588725260 attempts to publish 0.9.0. `changeset publish` receives npm `E404`, but the helper prints `Published gh-upload-log@0.9.0` and proceeds. GitHub marks the workflow successful. |
| 2026-08-22 17:47       | GitHub release v0.9.0 is published even though npm has no 0.9.0 artifact.                                                                                                                             |
| 2026-09-20 02:34       | Hive Mind issue #2264 opens after issue gh-upload-log#40 shows the relative-path defect and the misleading CLI output `0.1.0`.                                                                        |
| 2026-09-20 02:42–02:46 | Upstream PR #41 commits fixes for the hard-coded version, trusted-publishing toolchain, nonzero result checks, retries, and tests.                                                                    |
| 2026-09-20 02:50       | PR #41 merges and closes gh-upload-log#40. Release run 35485018540 begins.                                                                                                                            |
| 2026-09-20 02:51       | The corrected job publishes 0.9.1 with result code 0 and creates GitHub release v0.9.1.                                                                                                               |
| 2026-09-20 02:52       | npm metadata exposes 0.9.1 as `latest`, proving registry and GitHub state are aligned.                                                                                                                |
| 2026-09-20 02:57       | Upstream issue #42 is filed from this investigation with the archived 0.9.0 failure and exit-status reproduction.                                                                                     |
| 2026-09-20 03:08       | #42 is closed as resolved/duplicate of the concurrently merged PR #41.                                                                                                                                |
| 2026-09-20 03:13       | Review of the successful 0.9.1 log finds the formatter print an error followed by success; upstream issue #43 is filed.                                                                               |
| 2026-09-20 03:35       | A real operational-CLI probe finds the published `gh-load-issue@0.3.2` entry point cannot start; upstream issue #18 is filed.                                                                         |
| 2026-09-20             | The `command-stream` 0.24.1 update activates its quote-context-aware interpolation fix; the issue #2119 regression is updated to prove both quoted and bare forms preserve exact arguments.           |
| 2026-09-20             | Hive Mind's 148-declaration inventory is brought current, the CI/Dependabot/runtime layers are implemented, and regression coverage is added.                                                         |

## What was stale

The first scanner run reported 121 current declarations out of 138 and listed
17 stale declarations. The finished scanner adds Formal AI, Bun, Node, Helm,
Box, Rust, and `use-m` bootstrap coverage, so the final denominator is 148.
That denominator increase is coverage growth, not dependency growth.

| Surface                  | Before                                                                     | After                                                   |
| ------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------- |
| Runtime npm dependencies | `@sentry/node` and `@sentry/profiling-node` 10.74.0                        | 10.75.0                                                 |
| Development dependencies | Changesets 3.0.2, ESLint 10.10.0, jscpd 5.2.0, Prettier 3.9.6              | 3.0.3, 10.11.0, 5.3.0, 3.9.8                            |
| Runtime `use-m` pins     | dotenvx 2.21.0, command-stream 0.18.0, links-notation 0.13.0, yargs 17.7.2 | 2.28.2, 0.24.1, 0.20.0, 18.1.0                          |
| `use-m` bootstrap        | 8.15.1 on both CDNs                                                        | 8.16.0 on both CDNs                                     |
| Internal Docker tools    | `@link-assistant/agent` 0.26.2; `start-command` 0.33.0                     | 0.26.3 and 0.34.0 in both release Dockerfiles           |
| Formal AI bootstrap      | 0.349.2                                                                    | 0.351.0 in all four Dockerfiles and the source contract |
| Helm CI tool             | 3.14.0                                                                     | 4.3.0 in all three jobs                                 |
| Workflow analysis action | zizmor 0.6.2                                                               | 0.6.4                                                   |

The audit also verified current declarations for the Box base image, Rust 1.98
line, Bun, Node 24 LTS line, every action ref, and every remaining npm/runtime
package. Moving major action refs are checked at major precision because their
maintainers advance the ref in place; `rust:1.98-slim-bookworm` is checked at
minor precision because Docker resolves its patch; exact declarations are
checked exactly. Node deliberately stays on the selected supported 24 LTS line
rather than interpreting a newer nonselected major as a patch update.

The `command-stream` update also removed a local behavioral limitation. Version
0.18.0 required Hive Mind's issue #2119 workaround because an interpolation
inside shell quotes leaked literal quote characters. Version 0.20.0 introduced
quote-context-aware interpolation, and 0.24.1 retains it. The regression now
executes quoted and bare placeholders with spaces and requires both to preserve
the exact argument. Source keeps the bare form as a simple repository convention
that remains compatible with older releases.

## Root-cause analysis

### RC1: no single source of dependency truth

`npm outdated` can evaluate `package.json` and its lockfile, but it cannot see a
version embedded in a Docker `RUN`, a `use-m` map, a CDN URL, an action comment,
a Helm setup input, or a base-image tag. Existing checks such as `npm audit` and
dependency review answer vulnerability/diff questions; neither asserts that
the repository is at the latest release.

The result was a set of individually reasonable update mechanisms with no
repository-level postcondition. The freshness scanner converts them into one
inventory and one pass/fail result.

### RC2: proposal automation and merge enforcement are different controls

Dependabot creates update PRs, but an outstanding or delayed Dependabot PR does
not make an unrelated PR fail. Conversely, a live registry check can block a
stale PR but does not prepare the update. Both are necessary.

GitHub applies a three-day cooldown to version updates by default. That safety
default conflicts with this issue's immediate gate: CI would reject every PR as
soon as a stable release appears while Dependabot withheld the remediation for
three days. Each configured ecosystem therefore explicitly excludes all
dependencies from cooldown. The scoped zizmor policy records that intentional
zero-day threshold; review and the complete CI suite remain the acceptance
boundary for a proposed update.

The initial main ruleset required PRs but no status checks. Therefore even an
accurate workflow failure was advisory to a maintainer with merge access. The
final design attaches the existing terminal `pipeline-status` context to that
ruleset after verifying this PR, closing the last enforcement gap.

### RC3: build-time latest is not runtime latest

The Dockerfiles install several operational utilities without version pins,
which is appropriate for a fresh image build. It says nothing about a container
that stays alive across subsequent publications. Hive Mind already had the
right safety primitive—an updater that runs only with no active task, under an
inter-process lock, and at most once per six hours—but its target list stopped
at agentic CLIs.

The safe utilities now share that mechanism. Self-updating Hive Mind remains
excluded because it owns the running process. `start-command` remains excluded
because Hive Mind deliberately tests and pins its process-lifecycle semantics.
Formal AI retains its separate digest, lease, memory migration, health-check,
and rollback protocol.

### RC4: a GitHub release did not prove an npm publication

The archived 0.9.0 log contains both npm's `E404` failure and an immediate
success line. `command-stream` returned a nonzero result object, while the
release helper treated only thrown exceptions as failure. It then set the
published output and created a GitHub release. The CLI's hard-coded `0.1.0`
output obscured whether a container had npm 0.8.2 or some newer source.

PR #41 fixed the publishing environment (Node/npm trusted-publishing
requirements), validated result codes, added retries and postconditions, and
read the CLI version from the installed package. npm 0.9.1 is the observed
postcondition.

### RC5: the same false-success shape survived in the formatter

Run 35485018540 proves package publication is fixed, but its release formatter
still logs `$ is not a function` and then logs success. The Bun parent starts a
Node child; both dynamically request an unpinned `command-stream` through
`use-m`, bypassing the package lock. The child exits nonzero on an incompatible
export shape. The parent again does not inspect the command result before
printing success. This distinct residual defect is tracked by upstream #43.

## Implemented design

### Merge-time freshness gate

`scripts/dependency-freshness.lib.mjs` inventories declarations and resolves
their current upstream versions. It deduplicates network requests, retries
transient fetch failures three times, and classifies an unresolved registry or
GitHub API response as an error rather than silently passing.

The release workflow runs the CLI in `detect-changes` before it emits outputs.
All downstream paths already depend on that job, and the terminal
`pipeline-status` job includes it. This placement avoids duplicating a second
large workflow job and guarantees that stale dependencies stop every path.

```text
PR -> detect-changes -> dependency inventory -> npm/GitHub versions
                       | stale or unresolved -> failed terminal status
                       ` current             -> normal CI jobs -> terminal status

active main ruleset -> requires terminal status -> merge allowed or blocked
```

### Update proposal automation

`.github/dependabot.yml` groups npm, GitHub Actions, Docker, Docker Compose, and
Helm in one daily multi-ecosystem PR. The custom scanner covers declarations
that Dependabot cannot edit, including `use-m` maps, bootstrap URLs, action
version comments, and setup inputs.

### Safe runtime convergence

The existing updater now includes:

- `@link-assistant/claude-profiles`;
- `gh-setup-git-identity`;
- `gh-pull-all`;
- `gh-load-issue`;
- `gh-load-pull-request`;
- `gh-upload-log`.

Each target is compared with npm and reinstalled through Bun only when its
installed version differs. A target failure is reported without making the
other targets unsafe. The established `HIVE_MIND_AGENTIC_CLI_*` names remain
for compatibility; their documentation now states that they control agentic
and operational target IDs. Version detection first trusts the executable, then
falls back to `bun pm ls -g`. The fallback matters for an upstream entry point
that is installed but temporarily cannot execute: it keeps the package visible
to freshness maintenance instead of misclassifying it as absent.

## Alternatives considered

| Alternative                                | Why it was not sufficient or not selected                                                                                                                                           |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dependabot alone                           | It proposes supported updates but does not block another PR while an update is pending, and cannot edit nonstandard runtime pins/setup inputs.                                      |
| `npm outdated` alone                       | It sees only the npm manifest/installation, omitting Docker, actions, Helm, CDNs, base images, and `use-m`.                                                                         |
| Update tools at task start or mid-task     | A task would observe a changing toolchain, harming reproducibility and risking replacement while the binary is active. The idle lock is the existing safe boundary.                 |
| Dynamically update Hive Mind itself        | Replacing the package that owns the bot process can leave a partially swapped process tree. Releases/images remain the self-update boundary.                                        |
| Dynamically update `start-command`         | Its behavior is coupled to isolation and post-mortem contracts and already has exact regression coverage. It remains a CI-gated image pin.                                          |
| Treat all newest majors as mandatory       | Some declarations intentionally select a compatibility line, notably Node 24 LTS and Rust 1.98. The scanner follows each declaration's stated precision.                            |
| Trust a GitHub release or success badge    | The 0.9.0 evidence demonstrates that a workflow and GitHub release can both be green while the consumer registry is missing the package. Registry postconditions are authoritative. |
| Add a local workaround for `gh-upload-log` | The defect belongs in the reusable publishing/formatting project. Upstream fixes remove duplicated downstream defensive code.                                                       |

## Primary-source research

- GitHub's [Dependabot options
  reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference)
  documents `directories`, package ecosystems, grouping, and the
  `multi-ecosystem-group` relationship.
- GitHub's [multi-ecosystem update
  guide](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/configuring-multi-ecosystem-updates)
  confirms that `patterns: ["*"]` includes all dependencies and that a shared
  schedule can produce one cross-ecosystem PR.
- GitHub's [supported ecosystems
  table](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories)
  confirms version-update support for npm, Actions, Docker, Docker Compose, and
  Helm.
- GitHub's [Dependabot cooldown
  reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference#cooldown)
  documents the default three-day delay and that `exclude` takes precedence so
  matching dependencies update immediately.
- npm's [trusted publishing
  documentation](https://docs.npmjs.com/trusted-publishers/) requires npm
  11.5.1+ and Node 22.14+ for OIDC publication. That directly explains the
  Node/npm toolchain part of the failed upstream releases and supports PR #41's
  Node 24 correction.

## Evidence index

| Artifact                                                        | Purpose                                                                          |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `data/issue-2264.json`, `data/issue-2264-comments.json`         | Original requirements and complete issue discussion snapshot.                    |
| `data/dependency-freshness-before.txt`                          | First complete scan: 17 stale, zero unresolved.                                  |
| `data/dependency-freshness-after.txt`                           | Expanded final scan: 148/148 declarations current.                               |
| `data/npm-outdated-before.json`, `data/npm-outdated-after.json` | Direct npm audit snapshots taken during the manifest update.                     |
| `data/main-ruleset-before.json`                                 | Active default-branch ruleset before adding a required terminal status.          |
| `data/gh-upload-log-issue-40*.json`                             | Original relative-path/version report and comments.                              |
| `data/gh-upload-log-release-v0.9.0.json`                        | GitHub release metadata for the registry-missing release.                        |
| `data/gh-upload-log-release-run-32588725260.json`               | Metadata/jobs for the false-success release run.                                 |
| `data/gh-upload-log-release-run-32588725260.log.gz`             | Complete 4,078-line false-success log, compressed without truncation.            |
| `data/gh-upload-log-npm-metadata-before.json`                   | npm registry snapshot showing latest 0.8.2 and no 0.9.0.                         |
| `data/gh-upload-log-pr-41*.json`                                | Upstream fix PR, all conversation/review comments, reviews, and commits.         |
| `data/gh-upload-log-issue-42*.json`                             | First upstream report and its duplicate-resolution comment.                      |
| `data/gh-upload-log-release-v0.9.1.json`                        | Corrected GitHub release metadata.                                               |
| `data/gh-upload-log-release-run-35485018540.json`               | Metadata/jobs for the successful publication run.                                |
| `data/gh-upload-log-release-run-35485018540.log.gz`             | Complete 6,085-line corrected release log, including residual formatter failure. |
| `data/gh-upload-log-npm-metadata-after.json`                    | npm registry proof that 0.9.1 is latest.                                         |
| `data/gh-upload-log-issue-43*.json`                             | Residual formatter false-success report and comments.                            |
| `upstream-gh-upload-log-report.md`                              | Reproduction/root-cause report submitted as #42, plus resolution.                |
| `upstream-gh-upload-log-format-report.md`                       | Reproduction/root-cause report submitted as #43.                                 |
| `data/gh-load-issue-issue-18.json`                              | Metadata for the published-entry-point defect and source/publish timestamps.     |
| `upstream-gh-load-issue-report.md`                              | Reproduction/root-cause report submitted as gh-load-issue#18.                    |

The workflow logs exceed 1,500 lines, so they are kept compressed and were
reviewed in bounded chunks. The JSON metadata preserves job IDs, timestamps,
SHAs, and URLs needed to reproduce the investigation.

## Verification and residual risks

The regression test uses a mocked registry to prove stale/current/error
classification without depending on the network. It also inventories the real
repository, asserts Dependabot coverage and workflow wiring, and simulates a
running container moving `gh-upload-log` from the misleading 0.1.0 report to
the now-published 0.9.1. A second simulation proves a broken executable remains
discoverable through Bun's installed-package inventory and can still be
updated. The issue #2119 test also exercises the corrected `command-stream`
quote-context behavior discovered during the full dependency-suite run.

The live check requires an authenticated `GITHUB_TOKEN` in CI so 148
declarations do not consume the small anonymous API quota. Registry/API errors
remain deliberate failures. The workflow already provides the repository token
to the detector job.

The freshness result is point-in-time by definition: a package can publish
after a check and before a merge. Dependabot's daily scan and the next workflow
run bound that window; rerunning required checks immediately before merge gives
the strongest available result without introducing a registry webhook service.

Upstream issues #43 and gh-load-issue#18 remain open. The first does not block
npm 0.9.1 consumption or the relative-path fix, but release notes may remain
unformatted until that helper checks the child result and uses one pinned
runtime/export shape. The second leaves `gh-load-issue@0.3.2` unusable as a
consumer executable until its already-merged Bun shebang is published. Hive
Mind's metadata fallback can still detect and refresh that package, but it does
not pretend to repair the upstream executable.
