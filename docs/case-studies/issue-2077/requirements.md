# Requirements traceability — issue 2077

Every requirement stated in the issue body, with where it is discharged.

| #   | Requirement (from the issue)                                                                                                     | Status                               | Where                                                                                                                                                                                                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | "Find a way to install that codex requested plugin in docker of the task, but not globally."                                     | **Reframed — premise does not hold** | No plugin was requested; `16:9` is an aspect ratio. Per-task, non-global scoping already exists from issue #2074 (`$CODEX_HOME/hive-mind/repositories/<owner>/<repo>`, propagated into Docker via the `.codex` mount) and was never reached in this run. See [analysis.md](analysis.md) and R1 discussion below. |
| R2  | "Download all logs and data related about the issue to this repository … compile that data to `./docs/case-studies/issue-{id}`." | Done                                 | `logs/isolation-docker-5ad4b2f9.log` (487 lines, full gist), `data/issue-2077.json`, `data/issue-2077-comments.json`, `data/original-issue-81.json`.                                                                                                                                                             |
| R3  | "Deep case study analysis."                                                                                                      | Done                                 | [analysis.md](analysis.md).                                                                                                                                                                                                                                                                                      |
| R4  | "Search online for additional facts and data."                                                                                   | Done                                 | [research.md](research.md).                                                                                                                                                                                                                                                                                      |
| R5  | "Reconstruct timeline/sequence of events."                                                                                       | Done                                 | [timeline.md](timeline.md), reconstructed from log line numbers and timestamps.                                                                                                                                                                                                                                  |
| R6  | "List each and all requirements from the issue."                                                                                 | Done                                 | This file.                                                                                                                                                                                                                                                                                                       |
| R7  | "Find root causes of each problem."                                                                                              | Done                                 | Two root causes identified: missing capability-name validation, and a heuristic guess wired to a fatal error. [analysis.md](analysis.md).                                                                                                                                                                        |
| R8  | "Propose possible solutions and solution plans for each requirement."                                                            | Done                                 | [analysis.md](analysis.md) "Fixes applied"; forward options in [research.md](research.md).                                                                                                                                                                                                                       |
| R9  | "Check known existing components/libraries that solve similar problem or can help."                                              | Done                                 | [research.md](research.md).                                                                                                                                                                                                                                                                                      |
| R10 | "If there is not enough data to find actual root cause, add debug output and verbose mode."                                      | Done                                 | Root cause _was_ determined, but the diagnostic gap it exposed is closed anyway: the detector now returns `evidence`/`rejected` traces and `--verbose` prints the source line behind every accepted and rejected token.                                                                                          |
| R11 | "If issue related to any other repository/project … report issues on GitHub."                                                    | **Not applicable — justified**       | Both defects are in this repository. Codex, its marketplace, the container image and the target repository all behaved correctly. See "What was _not_ the cause" in [analysis.md](analysis.md). Filing an upstream issue would be noise.                                                                         |
| R12 | "Fully apply requirements to entire codebase, so if we have issue in multiple places, it should be fixed in all them."           | Done                                 | A codebase audit for the same defect class (prose-scanning regexes, identifier regexes permitting a leading digit, fatal throws from heuristic guesses) was performed; findings and dispositions in [research.md](research.md).                                                                                  |
| R13 | "Plan and execute everything in this single pull request."                                                                       | Done                                 | All changes are in PR #2079 on branch `issue-2077-cf62a12ceb53`.                                                                                                                                                                                                                                                 |

## R1 in detail

The issue asks for per-task rather than global plugin installation. Three
separate points apply:

1. **Nothing needed installing in this incident.** The preflight reported
   `detected 0 plugin and 1 skill requirement(s)`, and the single "skill" was
   `16:9`. There was no real capability to provision.

2. **The requested mechanism already exists.** Issue #2074 built exactly this:
   `buildCodexCapabilityStatePath` creates
   `$CODEX_HOME/hive-mind/repositories/<owner>/<repo>`,
   `prepareScopedCodexHome` seeds it from the operator home while preserving
   repository-local `[plugins."…"]` enablement blocks, and
   `applyCodexCapabilityEnv` exports the scoped `CODEX_HOME` to `codex exec`. The
   operator's global plugin enablement is untouched. Because the scoped path sits
   under the operator `~/.codex`, the existing Docker `.codex` bind mount carries
   it into the task container; `tests/codex-capability-preflight.test.mjs`
   asserts this containment explicitly.

3. **What was actually wrong is that this mechanism was never reached.**
   Resolution failed before provisioning, and the failure was fatal. Fix 2
   (degrade to a warning) means a future resolution miss no longer prevents the
   run from proceeding.

So R1 needs no new scoping mechanism. It needed the detector to stop fabricating
requirements, which is what this PR delivers.
