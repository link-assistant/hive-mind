# Case Study: Issue #1733 — `/fix --ci-cd <repository>`

> Automatic CI/CD remediation: detect a repository's languages, list the latest
> default-branch CI/CD runs, auto-generate a remediation issue from the
> [web-capture#139](https://github.com/link-assistant/web-capture/issues/139)
> template, and hand it off to `/solve --auto-merge`.

- **Issue:** [link-assistant/hive-mind#1733](https://github.com/link-assistant/hive-mind/issues/1733)
- **Pull request:** [link-assistant/hive-mind#1929](https://github.com/link-assistant/hive-mind/pull/1929)
- **Branch:** `issue-1733-2f309a19e44b`
- **Captured:** 2026-06-15

This folder contains the raw data captured while solving the issue
([`data/`](./data)), an empty [`logs/`](./logs) placeholder for run logs, the
list of external research sources
([`research-sources.json`](./research-sources.json)), and this deep-dive
analysis.

---

## 1. Summary

Issue #1733 asks for a new `fix` command (mode `--ci-cd`) that, given a target
repository URL, **automatically creates a CI/CD remediation issue** describing
the current state of the repository's CI/CD on its default branch and then
**automatically solves it** by chaining into the existing `/solve --auto-merge`
flow. The command must:

1. detect the repository's languages and pick the matching CI/CD templates,
2. order the template links by detected language,
3. inspect the latest default-branch commit and its CI/CD runs,
4. reference `docs/CI-CD-BEST-PRACTICES.md`,
5. forward every option `fix` does not consume itself to `/solve`,
6. keep `docs/CI-CD-BEST-PRACTICES.md` current across all four language
   translations (adding the PHP template), and
7. produce this case study.

The hive-mind codebase already contained every building block: an
issue-creation helper (`/task`'s `createTaskIssue`), an issue-solver with
`--auto-merge` (`/solve`), an option-passthrough pattern (`hive.mjs`), the
GitHub Actions run-listing patterns, and the GitHub `/languages` endpoint for
language detection. The work was therefore primarily **composition of existing
components**, not new infrastructure.

---

## 2. Original Issue (verbatim intent)

> Add automatic issue generation + start of solve command on it to fix CI/CD
> based on template web-capture#139.
>
> We should check latest default branch commit, get all CI/CD runs from it, list
> it in the issue, after that use standard prompt from web-capture#139 (links to
> CI/CD templates should be sorted by detected languages in the target
> repository).
>
> After we emulate or call /task, we should also do similar to what
> `/solve --auto-merge`, with ability to pass through `--tool` and `--model` and
> `--think` options (or even better all options, that are not used by /fix
> itself).
>
> We should also detect languages used in the repository … include link to
> `docs/CI-CD-BEST-PRACTICES.md` in the automatically created issue.
>
> Also make sure `docs/CI-CD-BEST-PRACTICES.md` is fully updated in all languages
> … and add the PHP template to the list.
>
> Collect data … compile to `./docs/case-studies/issue-{id}` … deep case study
> analysis … list of each and all requirements … propose possible solutions and
> solution plans … check known existing components/libraries.
>
> Plan and execute everything in a single pull request.

(Full text saved in [`data/hive-mind-issue-1733.json`](./data/hive-mind-issue-1733.json).
The issue had no comments at capture time.)

---

## 3. Enumerated Requirements

| #   | Requirement                                                           | Where addressed                                              |
| --- | --------------------------------------------------------------------- | ------------------------------------------------------------ |
| R1  | New `fix` command with a `--ci-cd` mode                               | `src/fix.mjs`, `package.json` bin                            |
| R2  | Inspect the latest default-branch commit                              | `getDefaultBranch` + `getLatestCommit` in `src/fix.mjs`      |
| R3  | Collect all CI/CD runs for that commit                                | `getRunsForCommit` (with branch fallback) in `src/fix.mjs`   |
| R4  | List those runs in the auto-created issue                             | `buildRunsSection` in `src/fix.ci-cd.lib.mjs`                |
| R5  | Use the standard prompt/template from web-capture#139                 | `buildStandardPrompt` in `src/fix.ci-cd.lib.mjs`             |
| R6  | Sort/select CI-CD template links by detected languages                | `mapLanguagesToTemplates` + `buildTemplatesSection`          |
| R7  | After creating the issue, chain into solving                          | `main()` in `src/fix.mjs` spawns `solve.mjs`                 |
| R8  | Behave like `/solve --auto-merge`                                     | `buildSolveArgs` always injects `--auto-merge`               |
| R9  | Pass through `--tool`, `--model`, `--think`                           | `partitionFixArgs` passthrough                               |
| R10 | Ideally pass through ALL options not consumed by `fix`                | `partitionFixArgs` forwards every non-fix-owned arg verbatim |
| R11 | Detect languages used in the target repository                        | `detectLanguages` via `gh api .../languages`                 |
| R12 | `docs/CI-CD-BEST-PRACTICES.md` updated in all languages (en/zh/hi/ru) | all four `docs/CI-CD-BEST-PRACTICES*.md`                     |
| R13 | Add the PHP template to the list                                      | `CI_CD_TEMPLATES` + all four docs                            |
| R14 | Include a link to `docs/CI-CD-BEST-PRACTICES.md` in the created issue | `CI_CD_BEST_PRACTICES_URL` referenced in the issue body      |
| R15 | Compile issue data into `docs/case-studies/issue-1733/`               | this folder                                                  |
| R16 | Deep case-study analysis incl. online research                        | this README + `research-sources.json`                        |
| R17 | Exhaustive requirement enumeration                                    | this section                                                 |
| R18 | Propose solution approaches & plans per requirement                   | §5                                                           |
| R19 | Identify existing components/libraries                                | §4, §6                                                       |
| R20 | `--dry-run` preview support                                           | `partitionFixArgs` / `main()`                                |
| R21 | `--no-solve` to create the issue without solving                      | `partitionFixArgs` / `main()`                                |
| R22 | `--help` / `--version`                                                | `main()`                                                     |
| R23 | Unit tests                                                            | `tests/test-fix-ci-cd.mjs`                                   |
| R24 | Changeset for the version bump                                        | `.changeset/`                                                |

---

## 4. Existing Components Reused (high-reuse-value map)

- **`/task` issue creation** — `src/task.issue-creation.lib.mjs::createTaskIssue()`
  builds `gh issue create --repo … --title … --body-file …` and parses the
  returned URL. `/fix` calls it directly to create the remediation issue (R7).
- **`/solve --auto-merge`** — `src/solve.config.lib.mjs` defines the positional
  `<issue-url>` and the `--auto-merge` option ("Auto-restart until PR becomes
  mergeable… restarts on CI failures"). `/fix` spawns `solve.mjs <issue-url>
--auto-merge …` (R8). This is exactly the auto-restart loop #1733 wants.
- **Option passthrough** — `src/hive.mjs` already forwards solve options the
  wrapper does not consume. `/fix` mirrors the spirit with a simpler
  partition: strip only the fix-owned flags + the repo positional, forward
  everything else verbatim (R9, R10), so `--tool`/`--model`/`--think` reach
  `/solve` untouched and the mechanism stays in sync as solve options evolve.
- **CI-run patterns** — the `gh run`/`gh api .../actions/runs` calls already
  used across `src/*.prompts.lib.mjs` informed `getRunsForCommit` (R3).
- **Case-study convention** — `docs/case-studies/issue-1823/`
  (`README.md` + `data/` + `logs/` + `research-sources.json`) is mirrored here
  (R15).

## 4.1 External APIs / Facts (verified live)

- **Language breakdown:** `GET /repos/{owner}/{repo}/languages` →
  `gh api repos/OWNER/REPO/languages`. Returns `{ "JavaScript": 8178338, … }`
  (bytes per language, already computed by GitHub Linguist server-side). Used
  for byte-weighted template ordering (R6, R11). Captured in
  [`data/hive-mind-languages.json`](./data/hive-mind-languages.json).
- **Workflow runs:** `GET /repos/{owner}/{repo}/actions/runs?head_sha={sha}` and
  `…?branch={branch}`. Fields used: `name`, `status`, `conclusion`, `head_sha`,
  `html_url`. Captured in
  [`data/hive-mind-main-runs.json`](./data/hive-mind-main-runs.json).
- **Prior art (auto-issue-from-CI):** `dacbd/create-issue-action`,
  "Failed Build Issue" action, flows.network `create-github-issue-workflow-fails`,
  the OpenAI Codex CLI "autofix CI failures" cookbook, and GitHub's IssueOps
  blog. `/fix` is the issue-first variant of these, delegating the fix to
  `/solve --auto-merge`. See [`research-sources.json`](./research-sources.json).
- **Linguist npm fallbacks** (not used; the `/languages` API is authoritative):
  `linguist-js`, `linguist-sense`.

A key live finding: the **latest default-branch commit frequently has zero runs
of its own** (release/tag commits). The exact-SHA query for `062151bd` ("1.78.12")
returned `0` runs, while the branch query returned 20. `/fix` therefore falls
back to the most recent runs on the default branch (clearly relabelled "Recent
CI/CD runs on `<branch>`") so the generated issue stays actionable.

---

## 5. Per-Requirement Solution & Implementation Notes

- **R1 / R22:** `package.json` registers `"fix": "./src/fix.mjs"` and adds the
  `chmod +x` to `build:pre`. `src/fix.mjs` handles `--version`, `--help`/`-h`,
  and no-args early; pure logic lives in `src/fix.ci-cd.lib.mjs`.
- **R2:** `gh api repos/OWNER/REPO --jq .default_branch`, then
  `gh api repos/OWNER/REPO/commits/{branch}` for sha/message/url.
- **R3 / R4:** `gh api "…/actions/runs?head_sha={sha}&per_page=100"` →
  `buildRunsSection` renders a Markdown table. Branch fallback as above.
- **R5 / R14:** `buildStandardPrompt` reproduces the web-capture#139 prompt
  (compare full file trees, report upstream template issues, compile a case
  study, single PR) and injects a link to `docs/CI-CD-BEST-PRACTICES.md`.
- **R6 / R11:** `detectLanguages` → `normalizeLanguages` (byte-sorted) →
  `mapLanguagesToTemplates` (merges JavaScript + TypeScript into one template,
  aggregates bytes, sorts templates so the most-used language comes first; the
  array order in `CI_CD_TEMPLATES` is the stable tie-breaker). Unmatched
  languages (Shell, Dockerfile, …) are listed for awareness.
- **R7 / R8 / R9 / R10:** `partitionFixArgs` splits argv into fix-owned flags
  (`--ci-cd`, `--dry-run`, `--no-solve`/`--no-auto-solve`, `--help`,
  `--version`) + the repository positional + a passthrough list; `buildSolveArgs`
  prepends the new issue URL and `--auto-merge` (deduped) then appends the
  passthrough. `fix.mjs` spawns `process.execPath solve.mjs …` with inherited
  stdio.
- **R12 / R13:** PHP rows added to the templates / formatting (PHP CS Fixer) /
  static-analysis (PHPStan) / changeset (changelog.d) tables across en, zh, hi,
  ru, plus a new "Automatic CI/CD Remediation" section documenting the command
  and the language→template mapping.
- **R20 / R21:** `--dry-run` prints the title + full issue body and creates
  nothing; `--no-solve` creates the issue but prints the manual `solve` command
  instead of spawning it.
- **R23:** `tests/test-fix-ci-cd.mjs` (default suite) covers the PHP template,
  repo parsing, language normalization/sorting, JS+TS merge, unmatched
  languages, template-section priority + fallback, run summarization, run-table
  rendering, issue title/body sections + sorting, the branch-fallback heading,
  arg partitioning (extract / dry-run / no-solve), and solve-arg assembly.

---

## 6. Architecture Fit & Risk Notes

`/fix` is a **thin orchestrator** beside `/task` and `/solve`:
_detect → describe → create issue → delegate to `/solve --auto-merge`_. No new
heavyweight subsystem is required.

Design decisions worth recording:

- **Network-free pure lib.** `src/fix.ci-cd.lib.mjs` deliberately does **not**
  import `github.lib.mjs` (whose transitive import chain performs a top-level
  network fetch via `use-m`). It carries a small self-contained `owner/repo`
  parser instead, so the unit tests run fast and offline.
- **Self-trigger loop avoidance.** The created issue → `/solve` → PR → CI cycle
  must not re-invoke `/fix`; `/fix` is only ever started by a human/operator,
  never by CI on the produced PR.
- **`--dry-run` truly creates nothing** — verified by the dry-run code path
  returning before `createTaskIssue`.

---

## 7. Reproduction

```bash
# Preview the remediation issue without creating anything:
fix https://github.com/link-assistant/hive-mind --ci-cd --dry-run

# Create the issue but do not start /solve:
fix link-assistant/hive-mind --ci-cd --no-solve

# Full flow, forwarding solve options:
fix link-assistant/hive-mind --ci-cd --tool codex --model gpt-5.5 --think max
```

---

## 8. Files in This Case Study

- [`data/hive-mind-issue-1733.json`](./data/hive-mind-issue-1733.json) — the issue.
- [`data/hive-mind-issue-1733-comments.json`](./data/hive-mind-issue-1733-comments.json) — comments (empty at capture).
- [`data/hive-mind-languages.json`](./data/hive-mind-languages.json) — live `/languages` output for hive-mind.
- [`data/hive-mind-main-runs.json`](./data/hive-mind-main-runs.json) — recent CI/CD runs on `main`.
- [`data/web-capture-issue-139.txt`](./data/web-capture-issue-139.txt) — the source prompt template.
- [`research-sources.json`](./research-sources.json) — external research sources.
- [`logs/`](./logs) — placeholder for captured run logs.
