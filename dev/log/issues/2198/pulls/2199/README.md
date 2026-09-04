# Issue #2198 — CI/CD false positives, false negatives, warnings and errors

Evidence pack and deep analysis for
[issue #2198](https://github.com/link-assistant/hive-mind/issues/2198) /
[PR #2199](https://github.com/link-assistant/hive-mind/pull/2199).

## Contents

| Path | What it holds |
| --- | --- |
| `github/` | Issue #2198, PR #2199, the two default-branch runs, job lists, recent run index |
| `ci-logs/` | Full log of run 33861728465 ("Checks and release", **failed**) and 33861728549 ("Security", success), plus the isolated `Release` job. Stored gzipped (`gunzip -k` to read) — `.gitignore` excludes `*.log`, so a raw log here would be silently untracked, and the line numbers cited in `analysis/` refer to the decompressed files |
| `workflows-before/` | The three workflow files as they stood before this PR |
| `template-workflows/`, `template-scripts/`, `template-head.txt` | Snapshot of `link-foundation/js-ai-driven-development-pipeline-template` at `7ae16b0e` (tag 0.11.28, 2026-09-03) |
| `local/` | Before/after output of every linter run locally: actionlint, zizmor, secretlint, the `npm link` matrix, the reproduction of the release failure, the full test run |
| `analysis/` | Per-finding root-cause write-ups `F0`–`F16`, plus the implementation log |

Reproduction experiments are kept in the repository at `experiments/issue-2198/` and
`experiments/npm-link-allow-scripts.sh`.

## Requirements extracted from the issue

| # | Requirement | Status |
| --- | --- | --- |
| R1 | Check for **all false positives** in CI/CD and fix them all | 5 found — F7 (a test pinning `read-all`), F9 (code spans read as links), F11 (zizmor vs actionlint), F14 (13 unreachable-by-design URLs), F16 (this PR's own check red on an npm rename) |
| R2 | Check for **all false negatives** and fix them all | 8 found — F3, F5, F8, F9, F10, F12, F14, and F15, which this PR's own green runs were hiding |
| R3 | Check for **all warnings** and fix them all | The run's entire `::warning` inventory is 2 annotations (F6) plus 4 `npm warn` lines (F4, still absent after npm's 11.19 rename — F16); both cleared |
| R4 | Check for **all errors** and fix them all | 1 — the `Release` job failure (F1), root-caused and fixed |
| R5 | Compare the **full file tree** against the JS pipeline template and reuse the best practices | `analysis/F13-template-gap-analysis.md` — 5 adopted, 4 deferred with reasons, 4 places hive-mind is ahead |
| R6 | **If the same issue exists in the template, report it there too** | 4 upstream reports filed — see below |
| R7 | Follow `docs/CI-CD-BEST-PRACTICES.md` | Followed; §11 (secrets) was documented but unimplemented until F8. The reverse gap also existed — workflow linting and dependency auditing were *undescribed*, so the guide could not have prevented F3 or F12; both added as §14/§15 in all 4 translations (`a4bea2c6`) |
| R8 | Add debug output / a verbose mode where evidence was missing, default off | `setup-buildx-resilient` traces on `verbose: true` **or** `RUNNER_DEBUG=1`; `create-manifest-list.sh` has `DRY_RUN` |
| R9 | Apply each fix **everywhere** it applies, not just where it was found | F10 across all 8 Docker jobs; F7 across all 4 workflows; F9 across all 4 translations of `FREE_MODELS.md`; F2's manifest merge across all 4 merge jobs |
| R10 | Plan and execute everything in the single PR #2199 | This pack is the plan; `analysis/implementation-log.md` is the execution record |

## Headline result

The issue points at one red run. The red run was the **least** of it.

> Run 33861728465 failed on `spawn bun ENOENT` — a lockfile for a package manager this
> repository does not use, sitting in the tree since June, that changesets 3.x started
> believing (F1).

Underneath it, four things that had **never been checked at all**:

- **the workflows themselves** — 25 accumulated findings, including four copies of a
  manifest-merge command that would split a tag containing a space, and three
  attacker-controllable interpolations (F2/F3);
- **secrets** — secretlint was installed on every build and run as a *library*, never as
  a linter, so the dependency looked like coverage (F8);
- **documentation links** — a link in `docs/FREE_MODELS.md` and its three translations
  pointed at a file that has **never existed in any commit**, and had been broken for six
  months (F9);
- **the dependency tree** — CodeQL scans our source and `dependency-review` only sees
  dependencies a PR *changes*, so a high-severity advisory against a long-pinned package
  was invisible forever (F12);
- **whether the green check meant anything** — a docs commit pushed a minute after a code
  commit cancels the code commit's run and then skips the code jobs itself, so the head is
  green over code no job ever saw. Found on *this PR's own runs* (F15).

The recurring shape is worth naming: **a plausible-looking control that does not check
the thing you assumed it checked.** An installed scanner (F8), a security workflow with
two jobs (F12), a `build:pre` script nothing runs (F5), a test asserting the defect it
was written to prevent (F7), a `Pipeline Status` job that answers "did anything fail"
when the question is "was this code tested" (F15).

## Timeline

| Date | Event |
| --- | --- |
| 2025-09-14 | `e77debc9` adds `cspell.json`. No workflow or npm script ever references it — an editor-only config, noted here so it is not mistaken for a spell-check gate. |
| 2026-03-04 | `ff467191` adds `[Case Study: Issue #1391](./case-studies/issue-1391/README.md)` to `docs/FREE_MODELS.md` and 3 translations. The target has never existed. Broken on arrival; nothing looks. (F9) |
| 2026-06-11 | npm 11.17.0 is released. It is the version the runners use on 2026-09-04, and the version under which `npm link` prints four `allow-scripts` lines. (F4) |
| 2026-06-19 | `5e059ea1` commits a root `bun.lock` that nothing installs from. Inert for 2½ months. (F1) |
| 2026-07-19 | Issue #2082 / PR #2083 — the same request, one round earlier — run the first template comparison. Job timeouts, cancellation, rebase-retry and `check-release-needed` are back-ported. Workflow linting, link checking, secret scanning and dependency auditing are not. (F3, F8, F9, F12) |
| 2026-07-30 | GitHub ships the `uses: $/...` self-repository syntax. actionlint support is opened as [#711](https://github.com/rhysd/actionlint/issues/711) and is still unreleased. (F11) |
| 2026-08-28 | The template's `Workflows` job runs green for the last time ([33167328667](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/actions/runs/33167328667)). |
| 2026-08-30 | zizmor 1.30.0 adds the `self-repository` audit. Because `zizmor-action` tracks `latest`, the template is now red on its next push and does not know it. (F11) |
| **2026-09-04 10:24** | Run [33861728465](https://github.com/link-assistant/hive-mind/actions/runs/33861728465): `changeset version` → `@changesets/format` → `package-manager-detector` reads `bun.lock` → `spawn bun ENOENT`. **Release fails.** (F1) |
| 2026-09-04 11:53 | Issue #2198 filed. |
| 2026-09-04 | This PR: F1–F14, three upstream reports. |
| 2026-09-04 (later) | `main` merges #2186, growing `src/agent.lib.mjs` to 1357 lines. Merging it in reintroduces the F6 warning class — and F6's guard catches it locally, which is what a threshold that is *enforced* rather than *announced* buys. |
| 2026-09-04 14:52 | Run [33886267473](https://github.com/link-assistant/hive-mind/actions/runs/33886267473) starts at `237acd2d` (the extraction above) and is **cancelled while still queued** — the API records zero jobs for it. (F15) |
| 2026-09-04 14:53 | Run [33886365226](https://github.com/link-assistant/hive-mind/actions/runs/33886365226), one docs commit later, reports **success** with `test-suites`, `test-compilation`, `check-file-line-limits` and `memory-check-linux` skipped. All four workflows green; the extraction inside them tested by nothing. (F15) |
| 2026-09-04 15:35 | Run [33890315861](https://github.com/link-assistant/hive-mind/actions/runs/33890315861) is the first on this branch whose code jobs the F15 fix keeps alive — `test-suites`, `test-compilation`, `check-file-line-limits` and `memory-check-linux` all run instead of skipping. `test-suites` fails, on F4's own test. (F15, F16) |
| 2026-09-04 (same run) | The runners are on npm 11.19.0, which renamed `npm warn allow-scripts` to `npm warn install-scripts`. F4's test matched the old label verbatim, so a rename was reported as "npm fixed linkPkg()". It had not. (F16) |

## Findings

### Errors

- **[F1](analysis/F1-stale-bun-lockfile-release-failure.md)** — the release dies with
  `spawn bun ENOENT`. Critical. `5e918d50`.

### False negatives

- **[F15](analysis/F15-incremental-detection-trusts-untested-head.md)** — the change
  detector trusts a head that cancellation ensured was never tested; the pipeline reports
  green over code no job ran. High. `fba98a4a`.
- **[F3](analysis/F3-no-workflow-lint-gate.md)** — no job ever linted the workflows.
  High. `e6152f95`.
- **[F8](analysis/F8-secretlint-installed-never-run.md)** — secretlint installed on every
  build, never run. High. `b1479a18`.
- **[F12](analysis/F12-dependency-tree-never-audited.md)** — nothing audited the
  dependency tree. High. `19a25d4d`.
- **[F9](analysis/F9-documentation-links-never-checked.md)** — documentation links never
  checked; one broken for six months. Medium. `d1832ad6`.
- **[F14](analysis/F14-link-checker-first-real-run.md)** — 11 links to this repository
  under its former owner; the API says `301`, the pages a reader clicks say `404`. Medium.
- **[F5](analysis/F5-declared-bins-not-executable.md)** — two declared bins ship
  non-executable; the guard was dead code. Medium. `515843e8`.
- **[F10](analysis/F10-bare-buildx-boot.md)** — eight Docker jobs boot BuildKit with no
  resilience. Medium. `6501cdd3`.

### False positives

- **[F16](analysis/F4-npm-link-allow-scripts-warning.md#f16--the-fixs-own-check-went-red-on-a-rename-2026-09-04)** —
  F4's own test keyed on a vendor label, so npm 11.19 renaming it turned `test-suites`
  red under the message "npm fixed linkPkg()". npm had not. Medium.
- **[F11](analysis/F11-zizmor-actionlint-self-repository-deadlock.md)** — the two workflow
  linters now contradict each other. Medium. `6501cdd3`.
- **[F7](analysis/F7-excessive-permissions.md)** — a test asserted `permissions: read-all`,
  so tightening it reported red. Medium. `e5e99f32`.
- **[F9](analysis/F9-documentation-links-never-checked.md)** — Markdown inside code spans
  read as links (`CHANGELOG.md:2155`). Fixed while writing the checker.
- **[F14](analysis/F14-link-checker-first-real-run.md)** — 13 of the link checker's first
  18 errors are unreachable-by-design, not broken: GitHub gates `/stargazers` behind login
  for every public repo, and npmjs/claude.ai answer 403 to any client. Medium.

### Warnings

- **[F6](analysis/F6-file-line-limit-warnings.md)** — the run's only two `::warning`
  annotations. Medium. `bcc3df08`.
- **[F4](analysis/F4-npm-link-allow-scripts-warning.md)** — 4 `npm warn allow-scripts`
  lines per run whose documented remedy does not work. Medium. `ca8eacd6`.
- **[F6, again](analysis/F6-file-line-limit-warnings.md#the-guard-earning-its-keep)** —
  merging `main` reintroduced the threshold breach; caught by F6's own guard, fixed by
  extracting `src/agent.version-gates.lib.mjs`.

### Aggregate

- **[F2](analysis/F2-release-yml-unlinted-findings.md)** — the 25 findings F3 had been
  hiding. High. `2cf01935`.

### Cross-cutting

- **[F0](analysis/F0-existing-solutions-research.md)** — existing components and libraries
  surveyed per requirement, with confidence labels.
- **[F13](analysis/F13-template-gap-analysis.md)** — full comparison against the pipeline
  template; every gap adopted, deferred-with-reason, or marked as hive-mind being ahead.

## Upstream reports

The issue requires that a problem also present in the template be reported there.

| Report | Where | Status |
| --- | --- | --- |
| `npm link` warns about install scripts no `allowScripts` mechanism can cover; `linkPkg()` never calls `resolveAllowScripts()` | [npm/cli#9951](https://github.com/npm/cli/issues/9951) | Open — filed with reproducer, root cause and suggested patch; re-confirmed unfixed on npm 11.19.0, which renamed the warning and nothing else (F4, F16) |
| `changeset version` will spawn `deno x prettier` after the changesets 3.x upgrade: `deno.lock` outranks `package-lock.json` and `package.json` declares no package manager | [js-ai-driven-development-pipeline-template#154](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/154) | Open — the template has hive-mind's F1 latent, with `deno.lock` in place of `bun.lock` |
| `detect-code-changes.mjs` classifies a PR by its **last commit only**, so code jobs skip on a multi-commit push — and on any push that cancels the previous run | [js-ai-driven-development-pipeline-template#156](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/156) | Open — filed with the synthetic-merge-commit reproducer, both routes to the hole, and the two-stage fix (F15) |
| The template's `Workflows` job is latently broken: `zizmor-action` tracks `latest`, zizmor 1.30.0 added `self-repository`, and the syntax it asks for breaks the actionlint job next to it | [js-ai-driven-development-pipeline-template#155](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/155) | Open — filed with the twelve-line reproducer, the 2×2 linter matrix, the ignore block, and the 1.7.7 → 1.7.12 bump (F11) |

## Method note

Every fix in this PR has a test that was **seen to fail before the fix**, and the two that
guard against a future regression rather than a present defect (F10's checkout ordering,
F12's job wiring) were mutation-checked — the assertion was verified to fail on a
deliberately broken tree. A fix whose test cannot be made to fail is not evidence of
anything. Per-finding detail in `analysis/implementation-log.md`.
