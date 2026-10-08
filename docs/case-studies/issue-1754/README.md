# Agentic FDD investigation and Hive Mind practice inventory

Issue: [#1754](https://github.com/link-assistant/hive-mind/issues/1754). Research date: 2026-10-08 (UTC).

## Result and scope

The requested comparison is **blocked by source availability**. The issue names
`https://sourcecraft.dev/hyperonym/agentic-fdd`, but that address returns HTTP 404
and SourceCraft displays “Repository not found.” The Git endpoint also reports
that the repository was not found. No source files, revision, or verified mirror
were recovered, so this investigation cannot identify practices that Hive Mind
is missing **from Agentic FDD**. A 404 does not establish whether a repository
was deleted, moved, or made private.

The useful result available now is an evidence-based Hive Mind inventory and
provisional improvement candidates. These candidates are inferred from Hive
Mind's implementation; they are not attributed to Agentic FDD. The acronym's
meaning and the upstream project's methodology remain unverified. These
recommendations do not change solver behavior or require a new operator workflow.

The issue contains only its title, with no body or comments supplying an
alternative source. The issue was created on 2026-05-05. Hive Mind is assessed
at main commit `1675c0a575383089a7c4ba8d53b0a0def750c112` (version 2.34.0), rather
than assuming that practices absent when the issue was filed remain absent.

## Source recovery evidence

The observations are recorded in [source-access.json](source-access.json).

| Attempt                                                                          | Observation                                                                          | What it establishes                                                                              |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Open the exact issue URL with the web tool                                       | The tool could not access the page                                                   | That tool alone cannot supply the source                                                         |
| Fetch the exact URL with `curl -L`                                               | HTTP 404; response is HTML                                                           | No readable repository at that address in this session                                           |
| Open the exact URL in Playwright                                                 | HTTP 404; “Repository not found”                                                     | The browser renders an error page, not hidden dynamic repository content                         |
| `git ls-remote` with interactive authentication disabled                         | Exit 128; repository not found                                                       | The guessed HTTPS `.git` endpoint did not expose source                                          |
| Browse `hyperonym/overview` and `hyperonym/repos` on SourceCraft                 | The public listing showed `ruspeech2text`, not `agentic-fdd`                         | No replacement was visible in that listing                                                       |
| GitHub repository search, including forks, and `hyperonym`'s public repositories | No verified `agentic-fdd` mirror found                                               | The searched GitHub paths did not recover the source; this is not proof that no mirror exists    |
| Exact-name web searches and browser search fallback                              | No verified source; the Google browser fallback returned HTTP 429                    | Search did not recover content                                                                   |
| Wayback CDX and availability endpoints                                           | Initially HTTP 429 from both; availability retry returned HTTP 200 with no snapshots | CDX remains inaccessible; the successful availability lookup found no snapshot for the exact URL |

The SourceCraft profile displays the name `nivedano`. The GitHub account with the same name has a
`grace-marketplace` fork of `osovv/grace-marketplace`, created on 2026-08-19.
Its README and changelog did not establish a relationship to `agentic-fdd`, and
the exact-name code/commit searches returned no match. GRACE is therefore **not
used as a substitute source** for the requested comparison.

To repeat the direct access checks, from the repository root:

```bash
mkdir -p /tmp/issue-1754-source-check
curl -L -sS -o /tmp/issue-1754-source-check/sourcecraft.html \
  -w '%{http_code}\n' https://sourcecraft.dev/hyperonym/agentic-fdd
GIT_TERMINAL_PROMPT=0 git ls-remote \
  https://sourcecraft.dev/hyperonym/agentic-fdd.git
```

Inspect the response and browser-rendered text before treating either a
successful HTTP response or downloaded HTML as repository documentation.

## Hive Mind baseline

“Present” means there is an implementation or documented workflow in the linked
paths. “Partial” means the practice is optional, prompt-driven, or lacks the
specific evidence contract described here. Neither label demonstrates that an
agent followed a prompt in every run. No row claims coverage of an unread
upstream practice.

| Practice to compare once the source is recovered | Hive Mind status and evidence                                                                                                                                                                                                                                                                                     | Remaining limit in the reviewed paths                                                                                                                                                                        |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Clear requirements and acceptance criteria       | **Partial.** [Best Practices](../../BEST-PRACTICES.md#writing-good-issues) provides an issue checklist and templates. [`buildTaskSplitPrompt`](../../../src/task.split.lib.mjs) asks for objectives, scope, deliverables, and acceptance criteria.                                                                | `normalizeSplitTasks` validates task count, nonempty title/body, and normalizes dependencies; it does not validate the acceptance criteria inside the free-text body.                                        |
| Task decomposition                               | **Present.** [`task.mjs`](../../../src/task.mjs) supports clarification, decomposition, and split mode, which creates child issues and links them as GitHub sub-issues.                                                                                                                                           | Decomposition quality is model-dependent. Existing task splitting should be extended if needed, rather than replaced by a second planner.                                                                    |
| Dependency-aware parallel work                   | **Present.** [`createIssueRelationsGate`](../../../src/hive.issue-relations.lib.mjs) queues the ready frontier, prioritizes critical paths, reports cycles, and rechecks relations before a worker starts. [PR #2616](https://github.com/link-assistant/hive-mind/pull/2616) added this after the original issue. | A closed blocker is treated as resolved, including manual closure; relation-read failures fall back to queueing without relation ordering. Readiness is not proof of prerequisite acceptance or merged code. |
| Research and design before implementation        | **Partial.** [`buildDeepAnalysisPrompt`](../../../src/deep-analysis.lib.mjs) requests online research, every requirement, alternative solutions, and plans. [Configuration](../../CONFIGURATION.md) documents `--deep-analysis` with default `false`.                                                             | Plans are prose; the reviewed prompt module does not validate a persisted design schema. Lightweight issues can proceed without this optional mode.                                                          |
| Reproducing tests before a bug fix               | **Present as guidance.** [`codex.prompts.lib.mjs`](../../../src/codex.prompts.lib.mjs) and [`claude.prompts.lib.mjs`](../../../src/claude.prompts.lib.mjs) explicitly require a failing reproduction before a fix. [`run-tests.mjs`](../../../scripts/run-tests.mjs) discovers default and integration suites.    | A passing final suite does not by itself demonstrate that the reproduction failed before the fix or that every issue criterion is tested.                                                                    |
| Automated quality gates                          | **Present.** [`release.yml`](../../../.github/workflows/release.yml) runs formatting, lint, duplication, secret scanning, syntax and test checks according to changed paths. [`checkPRCIStatus`](../../../src/github-merge.lib.mjs) reads checks for the PR head SHA and treats an empty set as pending.          | CI verifies the configured checks. It cannot establish completeness of unencoded requirements; skipped checks are accepted by the status helper.                                                             |
| Review separate from implementation              | **Present as a separate workflow.** [`review.mjs`](../../../src/review.mjs) reviews the diff, tests, compatibility and documentation; [`reviewers-hive.mjs`](../../../src/reviewers-hive.mjs) queues labeled PRs and supports multiple reviews.                                                                   | A review command's availability is not evidence that each solve received independent review. Repository review policy remains relevant.                                                                      |
| Durable investigation and cross-session context  | **Partial.** [`development-log.lib.mjs`](../../../src/development-log.lib.mjs) supports collected evidence, and [`handoff.prompts.lib.mjs`](../../../src/handoff.prompts.lib.mjs) defines branch-committed task state, decisions, next steps and verified work.                                                   | `--development-log` and experimental `--use-handoff` are opt-in. Deep analysis alone does not enable evidence collection.                                                                                    |

The [issue #2615 case study](../issue-2615/README.md) is an existing example of a
requirements-to-implementation table. [PR #2550](https://github.com/link-assistant/hive-mind/pull/2550)
preserves agent-written PR descriptions, so additional evidence should fit the
reviewer's needs instead of reinstating automatically appended file statistics.

## Provisional improvement candidates

These priorities are local recommendations, not confirmed Agentic FDD gaps.
They describe possible follow-up work; this documentation PR does not implement
the gates or change defaults.

| Priority | Candidate and reason                                                                                                                                                                             | Smallest useful follow-up                                                                                                                                                                                      | Acceptance evidence for that follow-up                                                                                                                                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1       | Explicit criterion-to-verification mapping. Requirements and test-first guidance exist, but the reviewed solve/deep-analysis paths do not define a structured per-criterion verification record. | Pilot a concise table in a research artifact or agent-written PR description: criterion, implementation pointer, test/command or manual evidence, result, remaining limitation. Reuse the issue #2615 example. | A pilot accounts for every criterion, names the commit tested, and leaves unavailable evidence visibly unresolved. Bug criteria include the failing-before/passing-after result; research and visual criteria can use appropriate non-test evidence. |
| P2       | Consistent design and decision evidence for complex tasks. Deep analysis requests plans, and handoff captures decisions, but both are optional and prose-based.                                  | Use an optional, short design artifact with scope, alternatives, selected approach, risks, dependencies and verification plan. Link it from the existing handoff/log workflow; keep routine tasks lightweight. | Resume a pilot from a fresh checkout with the decision and next action recoverable from committed artifacts. Review identifies changed assumptions without rereading the entire session.                                                             |
| P2       | Acceptance quality in generated split tasks. `normalizeSplitTasks` can accept any nonempty task body, even when the requested success conditions are omitted.                                    | Evaluate an opt-in structured acceptance-criteria field alongside the existing task shape, with backwards compatibility for current free-text bodies.                                                          | Unit tests distinguish a structurally valid but unverifiable task from one with observable success conditions, preserve old task input, and cover a research task whose external source is unavailable.                                              |

## Completing the requested comparison

1. Recover the exact project or a mirror whose provenance is independently
   established. Record a revision, retrieval date, relevant file paths and
   licensing before collecting or quoting material.
2. Read its README, workflow instructions, templates, examples and checks.
   Extract each practice with a source pointer, including exceptions and
   applicability. Do not assume what “FDD” expands to.
3. Reassess Hive Mind at the then-current main revision. For each upstream
   practice, identify an equivalent implementation, a partial implementation,
   a missing practice, or a reason it does not apply. Link concrete evidence.
4. Prioritize confirmed gaps by expected benefit and adoption cost. Give each
   follow-up an integration point, compatibility constraints and a measurable
   acceptance condition. Preserve Hive Mind's autonomous operation.

Until that evidence is available, the upstream comparison remains open. This
report supplies a reproducible access diagnosis and the local half of the
comparison, without claiming that issue #1754 is fully resolved.
