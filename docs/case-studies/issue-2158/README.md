# Issue 2158: Formal AI reached the repository and still changed nothing

## Executive summary

Issue [#2154](https://github.com/link-assistant/hive-mind/issues/2154) fixed the launch path: the Formal AI image became publicly pullable, launch failures became visible, and every supported native CLI could reach the sidecar. The three post-fix Hello World runs investigated here prove that transport now works. They also expose the next boundary.

Between 2026-08-13 and 2026-08-15, Hive Mind ran Formal AI 0.339.1 through Agent, Claude Code, and Codex against three deliberately small repository tasks. The result was 21 attached log snapshots, five automatic restarts per repository, three empty pull requests, and no Scala, Kotlin, Rust, or GitHub Actions files:

| Repository task                                                                                    | Native client | What Formal AI did                                       | End state                                                                                                                                 |
| -------------------------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [Scala](https://github.com/konard/test-hello-world-019fb330-00e1-73b9-955e-f357a1600d5b/issues/1)  | Agent         | Recorded the same repository plan without executing it   | Empty [PR #2](https://github.com/konard/test-hello-world-019fb330-00e1-73b9-955e-f357a1600d5b/pull/2), restart limit exhausted            |
| [Kotlin](https://github.com/konard/test-hello-world-019fb330-fa49-7c9d-a664-b7ea33bb698a/issues/1) | Claude Code   | First ran `pwd`; subsequent attempts only recorded plans | Empty [PR #2](https://github.com/konard/test-hello-world-019fb330-fa49-7c9d-a664-b7ea33bb698a/pull/2), restart limit exhausted            |
| [Rust](https://github.com/konard/test-hello-world-019fb331-c107-78c7-8ff6-9f127a3c593c/issues/1)   | Codex         | Ran bare `sudo` on every attempt                         | Placeholder-only [PR #2](https://github.com/konard/test-hello-world-019fb331-c107-78c7-8ff6-9f127a3c593c/pull/2), restart limit exhausted |

Two upstream limitations caused the no-op behavior:

1. Formal AI's intent router could choose command examples from caller-owned workflow text instead of the actual repository objective. Hive Mind gave four clients that text and the objective as one flattened user message; the other two received separate system and user messages, but the same oversized request still left incidental command cues in the model context.
2. When Formal AI did recognize a repository work item, its general planner intentionally wrote only `.formal-ai/general-change-plan.lino` and returned `planned_not_executed`. This behavior is still encoded in Formal AI main at version 0.345.0.

Three Hive Mind defects amplified those upstream limitations:

1. The native clients exited zero, so Hive Mind treated `planned_not_executed` as a successful AI session.
2. A deterministic non-execution was fed into the mergeability restart loop five more times.
3. Auto-continue sometimes labelled the issue URL as the prepared pull request URL, weakening the task boundary further.

The fix is deliberately narrow. All six client adapters now send Formal AI the same bounded repository objective and no Hive Mind workflow system prompt. The objective contains canonical issue, branch, and pull request references but no workspace path, command examples, or copied review text. Hive Mind recognizes Formal AI's explicit non-execution marker as a terminal tool failure, and auto-continue constructs the actual pull request URL. Native models retain their existing prompts unchanged.

This does **not** claim that Formal AI can now implement arbitrary repository issues. It makes Hive Mind honest and deterministic while that upstream capability is absent: request metadata can no longer hijack the task, and a known no-op fails once instead of consuming five restarts.

## Scope and evidence

The investigation includes:

- issue #2158 and every issue comment;
- all three PR feedback streams (conversation comments, inline review comments, and reviews) for Hive Mind PRs #2108, #2120, #2131, #2147, #2155, and #2159;
- issues #2059, #2119, #2130, #2146, and #2154, which define the carried-forward Formal AI contract;
- the three external issue/PR pairs and all of their feedback streams;
- every post-PR-#2155 attached tool log: 21 authenticated Gist downloads, stored as deterministic gzip files with source metadata and SHA-256 checksums;
- Formal AI #904 and #907, which previously addressed truthful repository-plan outcomes and caller-context intent hijacking;
- a source audit of Formal AI 0.339.1 and current main (0.345.0 at commit `98cb3c8`);
- real Codex 0.147.0 → Formal AI experiments against production 0.339.1 and current main 0.345.0 using isolated temporary repositories.

The evidence fetcher is [`experiments/issue-2158-fetch-evidence.mjs`](../../../experiments/issue-2158-fetch-evidence.mjs). The full inventory and reproduction commands are in [MANIFEST.md](./MANIFEST.md). No issue, issue comment, PR description, or PR discussion in scope contained an image, so there was no screenshot artifact to download.

Each repository has seven log **snapshots**: initial solution-draft log, five `N/5` restart logs, and the final failure log. The files grow cumulatively, so they are not 21 independent AI attempts. The last snapshot for each repository is the complete run history; earlier snapshots preserve what was visible at each publication point.

## Requirements reconstructed

### Issue #2158

| ID  | Requirement                                                                          | Result                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Continue Formal AI support after #2154                                               | The post-launch execution boundary is isolated and made honest; native launch/configuration remains unchanged                                                                                      |
| R2  | Study the latest three post-fix logs                                                 | All 21 post-merge snapshots downloaded, hashed, indexed, and analyzed                                                                                                                              |
| R3  | Find every root cause, including false positives and false negatives                 | Seven observed failure modes mapped to two upstream and three local root causes below                                                                                                              |
| R4  | Fix everything belonging to Hive Mind first                                          | Bounded prompt adapter, terminal-state classifier, canonical PR URL, and regression coverage implemented                                                                                           |
| R5  | Report Formal AI defects upstream with reproduction, workaround, and fix suggestions | Follow-up drafts for the exact existing upstream issues #904 and #907 are preserved under [`upstream/`](./upstream/); live comment links are added when filed                                      |
| R6  | Search current libraries/components for a better integration                         | Native role APIs, the Responses-compatible endpoint, and MCP structured results evaluated in [IMPROVEMENTS.md](./IMPROVEMENTS.md); no dependency can restore provenance after a caller flattens it |
| R7  | Download all data into this case-study directory                                     | 78 GitHub JSON snapshots plus 21 compressed logs and their index                                                                                                                                   |
| R8  | Give a timeline and requirements list                                                | This document                                                                                                                                                                                      |
| R9  | Make the solution reusable across the codebase                                       | One shared prompt builder and one shared result classifier cover Agent, Claude, Codex, Gemini, OpenCode, Qwen, and Agent Commander through Agent                                                   |
| R10 | Verify with a reproducing test before the fix                                        | The regression test failed on the old tree because Formal AI received the workflow prompt; the real-client experiment records command hijacking before the boundary                                |
| R11 | Keep all changes in PR #2159                                                         | Branch `issue-2158-b622a1cbe93e`; no direct default-branch changes                                                                                                                                 |

### Carried-forward contract

| Requirement                                                                                  | Source       | State after this change                                                          |
| -------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------- |
| All six tools plus Agent Commander can dispatch `--model formal-ai`                          | #2059, #2119 | Preserved; prompt policy now comes from one shared Formal AI adapter             |
| Provider is Link.Assistant and price is zero                                                 | #2119        | Unchanged                                                                        |
| Empty work cannot be reported ready; restart budget is globally capped                       | #2119        | Preserved; explicit upstream non-execution now fails before mergeability retries |
| Direct native-client integration, structured streams, and correct headless auth              | #2130        | Preserved; no wrapper or client invocation was replaced                          |
| Formal AI only, with no silent provider downgrade                                            | #2146        | Preserved                                                                        |
| Minimum runtime version, local sidecar lifecycle, isolated client config, and durable memory | #2146        | Preserved                                                                        |
| Public image availability, launch diagnostics, task/execution UUIDs                          | #2154        | Preserved; all three studied runs reached Formal AI 0.339.1                      |

## Timeline

All times are UTC.

| Date/time               | Event                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 2026-07-13              | Hive Mind #2059 opens the initial request for Formal AI model dispatch                                             |
| 2026-07-24              | Formal AI #848 records that repository-level coding requests produce no patch                                      |
| 2026-07-26              | Hive Mind PR #2108 merges initial model dispatch support                                                           |
| 2026-07-30 13:21–13:23  | Scala, Kotlin, and Rust Hello World issues are created                                                             |
| 2026-07-30 14:13–14:25  | Their PR #2 branches are opened with scaffolding; the original #2119 runs produce no implementation                |
| 2026-07-30 → 2026-08-01 | Hive Mind #2119 / PR #2120 correct false success, pricing, stream parsing, restart budgets, and scratch handling   |
| 2026-08-02              | Hive Mind #2130 / PR #2131 establish direct native-client endpoint integration; Formal AI #904 and #905 are opened |
| 2026-08-04              | Formal AI #904 closes after replacing false repository completion with the truthful `planned_not_executed` state   |
| 2026-08-05              | Formal AI #905 closes after verification failures stop being described as successful                               |
| 2026-08-06              | Formal AI #907 closes after adding caller-context stripping and task-over-intent routing                           |
| 2026-08-08 → 2026-08-11 | Hive Mind #2146 / PR #2147 harden runtime lifecycle, version checks, and all-client support                        |
| 2026-08-13 07:51        | Hive Mind PR #2155 merges launch diagnostics and the public-image mitigation from #2154                            |
| 2026-08-13 18:13–18:28  | Post-fix Agent/Scala run reaches Formal AI, records plans, exhausts five restarts, and fails with an empty PR      |
| 2026-08-15 07:21–07:36  | Post-fix Codex/Rust run repeatedly executes bare `sudo`, then exhausts the restart limit                           |
| 2026-08-15 07:24–07:39  | Post-fix Claude/Kotlin run executes `pwd`, then repeatedly records plans and exhausts the limit                    |
| 2026-08-15 13:48        | Hive Mind #2158 opens to investigate the post-launch failures                                                      |

## Observed failure modes

| ID  | Type                  | Evidence                                                                                   | Disposition                                                                                                 |
| --- | --------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| F1  | Wrong action          | Kotlin's first session runs only `pwd`; Rust runs only bare `sudo`                         | Caller workflow text reached Formal AI's task classifier; bounded locally and reported upstream             |
| F2  | Missing capability    | Scala and later Kotlin attempts only write `.formal-ai/general-change-plan.lino`           | Formal AI repository work is intentionally plan-only; terminal state surfaced locally and reported upstream |
| F3  | False positive        | Native CLI exits zero after `planned_not_executed`                                         | Hive Mind now classifies explicit non-execution as failure                                                  |
| F4  | Wasteful retry        | The same deterministic outcome consumes all five mergeability restarts                     | Classification happens at both initial and shared restart execution boundaries                              |
| F5  | Wrong target metadata | Auto-continue can call an issue URL “Your prepared Pull Request”                           | Canonical `/pull/{number}` URL builder used after PR discovery                                              |
| F6  | False progress signal | A command result or plan summary looks like useful agent output while the PR remains empty | The terminal error states that repository work was not executed                                             |
| F7  | Diagnostic ambiguity  | Attached logs are cumulative, making repeated text look like additional attempts           | Index and manifest label snapshots and identify the complete terminal snapshot                              |

No authentication, registry, model-routing, pricing, log-parsing, or client-launch failure appears in these post-#2155 logs. Those older defects are therefore not reopened by this evidence.

## Root causes and ownership

| Root cause                                          | Owner                                       | Why it happened                                                                                                                                                                    | Fix                                                                                                                                                             |
| --------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RC-A: task provenance was lost                      | Hive Mind boundary plus upstream classifier | Agent, Codex, Gemini, and OpenCode concatenate the workflow and objective; command vocabulary in the prefix can win. Separate-role clients still receive unnecessary caller policy | Shared Formal AI prompt builder omits the caller policy and sends only canonical repository intent; upstream should classify only the latest user-authored task |
| RC-B: repository work has no executor               | Formal AI                                   | `GeneralPlanMode::RepositoryWorkItem` persists a plan record and deliberately ends as `planned_not_executed`                                                                       | Upstream must implement bounded repository execution and verify requested artifacts; Hive Mind fails honestly meanwhile                                         |
| RC-C: process success was treated as task success   | Hive Mind                                   | A zero exit code was the only completion signal consumed                                                                                                                           | Shared result classifier recognizes the explicit terminal marker and sets `success: false` with code `FORMAL_AI_PLANNED_NOT_EXECUTED`                           |
| RC-D: retry policy received the wrong failure class | Hive Mind                                   | Mergeability logic saw a successful tool session followed by an empty PR                                                                                                           | Classify immediately after every initial or restart tool invocation, before mergeability processing                                                             |
| RC-E: continue-mode PR URL reused the input URL     | Hive Mind                                   | Auto-discovery can start from an issue URL, but `prUrl` was assigned that same input                                                                                               | Build the canonical PR web URL from owner, repository, and discovered PR number                                                                                 |

The causal chain is:

```text
caller workflow + repository objective
                 |
                 +-- command cue wins --> pwd/sudo --> exit 0 --+
                 |                                             |
                 +-- repository intent --> plan only ----------+--> false success --> empty PR --> 5 retries
```

The patch cuts both local arrows: the workflow never enters a Formal AI task request, and non-execution never becomes success.

## Reproduction and verification

The real-client experiment is [`experiments/issue-2158-formal-ai-prompt-boundary.mjs`](../../../experiments/issue-2158-formal-ai-prompt-boundary.mjs). It produced the same behavior against production Formal AI 0.339.1 and a release build of current main 0.345.0 at `98cb3c8`:

| Request                    |    Prompt size | Tool activity                                                              | Process result                                      |
| -------------------------- | -------------: | -------------------------------------------------------------------------- | --------------------------------------------------- |
| Former flattened request   | 570 characters | Codex executes `/bin/bash -lc pwd`                                         | Exit 0 and reports the workspace path               |
| Bounded repository request | 281 characters | No requested repository artifact changed; Formal AI writes its plan record | Exit 0 with `terminal_state "planned_not_executed"` |

The sanitized machine-readable results are the [production replay](../../../experiments/issue-2158-formal-ai-prompt-boundary-results.json) and [current-main replay](../../../experiments/issue-2158-formal-ai-prompt-boundary-main-results.json). They demonstrate why both halves of the fix are necessary: bounding prevents the wrong command; classifying the remaining honest terminal state prevents false success. Reproducing both outcomes on current upstream main also rules out a stale-version explanation.

Regression coverage in [`tests/test-issue-2158-formal-ai-request-boundary.mjs`](../../../tests/test-issue-2158-formal-ai-request-boundary.mjs) verifies:

1. all six prompt builders return no Hive Mind system policy for Formal AI;
2. their shared user prompt excludes workspace paths, native policy, and caller-controlled command snippets;
3. provider-qualified Formal AI IDs take the same path;
4. native models retain their existing workflow prompt;
5. `planned_not_executed` becomes a scoped terminal failure without losing result metadata;
6. discovered PR numbers become canonical pull request URLs.

## Outcome

After this patch, a Formal AI repository-work run has one of two honest outcomes:

- it produces work and proceeds through the existing verification and mergeability pipeline; or
- it reports explicit non-execution, Hive Mind exits through the existing critical-error path, preserves the summary as evidence, and does not spend the mergeability restart budget on the same deterministic plan.

Actual repository execution remains an upstream prerequisite. The detailed integration analysis and proposed next steps are in [TECHNICAL_ANALYSIS.md](./TECHNICAL_ANALYSIS.md) and [IMPROVEMENTS.md](./IMPROVEMENTS.md).
