Agent PR #326 merged with green CI while explicitly leaving Agent #322 unfinished. Its negated sentence (`does not close #322`) fooled local link detection, and ordinary issue solves bypassed the optional completion gate.

Fixes #2335

This PR makes the shared merge function require fresh completion evidence for every required issue. It rejects missing links, omitted explicit criteria, blocked work, stale commits or feedback, and failed GitHub reads. Default-branch merges also require GitHub-confirmed closing references; the merge command matches the verified head commit. Non-default merges close every verified issue and report failures.

Link repair runs after initial and restarted sessions, retains requirements reports during description rewrites, and restores deleted primary references from issue branches. Discovery uses positive description links and the correct PR repository; the merge queue preserves known issue context. Repository mode retains every open issue in its body inventory beyond the 100 native-child attachment limit.

All six tools receive the complete-delivery objective and report instructions. Bounded completion retries run without optional flags. Both Codex adapters enable goals; prompts request the supported native API when available and retain a checklist otherwise. The current `codex exec` interface has no goal-setting flag, so this change does not invent one.

To reproduce the original defect, use the actual archived Agent PR #326 description: the previous parser treats its negative closing sentence as a link, and a repaired link alone still leaves two of Agent #322's three acceptance criteria unmet. The regression tests replay that evidence, exercise the actual shared merge function with a finite fake GitHub CLI, and verify that no merge occurs without current evidence.

Validation includes all 523 default test files, focused link/completion/prompt and existing regression tests, lint, formatting, duplication, secret scanning, syntax and file limits, audit, dependency freshness, package-manager consistency and a patch changeset. The four new focused guard modules have 100% line/function coverage and 99.64% combined branch coverage; the single remaining V8 range is whitespace on the link-repair `finally` line. The existing vulnerable transitive brace-expansion entry and three stale runtime pins were refreshed so the required security/freshness checks pass.

The [case study](https://github.com/link-assistant/hive-mind/blob/issue-2335-d92d19d37a1b/docs/case-studies/issue-2335/README.md) reconstructs the timeline, inventories every requested requirement, preserves the original gist/diff/metadata and all eleven incident CI logs, and records local validation with hashes. The [completion guide](https://github.com/link-assistant/hive-mind/blob/issue-2335-d92d19d37a1b/docs/ISSUE_COMPLETION.md) is supplied in all four documentation languages. The related upstream compatibility report is [OpenTUI #1550](https://github.com/anomalyco/opentui/issues/1550), with a bounded reproduction, workaround and code-level upgrade plan.

A current requirements report is a mandatory evidence inventory. Human review still has to assess prose completeness and evidence truth; no finite tests or model goal can prove arbitrary requirements or all future inputs. GitHub protects the commit but offers no atomic lock across descriptions and feedback. These limits and the unresolved OpenTUI compatibility task are explicit in the case study.

The report below records delivered mechanisms and their evidence. The literal demand for proof of every future regression and arbitrary prose completion remains `blocked`: this PR is prepared for human review, and its own new guard keeps it ineligible for automated merging. A green check is not substituted for that unavailable proof.

<!-- hive-mind:requirements:start -->
```json
{
  "version": 1,
  "headSha": "b51fa6e5c62156666ceedfe377733a0ef1af6873",
  "issues": [
    {
      "owner": "link-assistant",
      "repo": "hive-mind",
      "number": 2335,
      "sourceDigest": "37f85c0ebdf5ba29d2aeaad4443c9b65f53bae5003660be25e6210377cf6d655",
      "requirements": [
        {
          "text": "Restore the original issue link.",
          "status": "done",
          "evidence": "Always-on repair; actual PR #326 replay; positive/negative/title/foreign parser tests. Practical limit: Publishing permissions and GitHub availability remain external. Failures are blockers. See docs/case-studies/issue-2335/README.md and data/validation.json."
        },
        {
          "text": "Deliver every requirement in one PR, in the widest requested scope.",
          "status": "done",
          "evidence": "Shared full-scope prompts, current report, automatic completion retries; all-open repository body inventory. Practical limit: External blockers remain explicitly unfinished; they cannot be honestly relabeled complete. See docs/case-studies/issue-2335/README.md and data/validation.json."
        },
        {
          "text": "Prevent automatic merge of incomplete work.",
          "status": "done",
          "evidence": "Mandatory shared merge guard, unfinished-evidence tests, actual merge subprocess fixture, commit matching. Practical limit: Agent-written evidence still needs review; see limits below. See docs/case-studies/issue-2335/README.md and data/validation.json."
        },
        {
          "text": "Apply instructions to system and other prompts.",
          "status": "done",
          "evidence": "Six initial and continuation prompt tests, minimal resume regression, restart feedback. Practical limit: Other applications outside this repository are not controlled by these prompts. See docs/case-studies/issue-2335/README.md and data/validation.json."
        },
        {
          "text": "Try native goals in supporting tools.",
          "status": "done",
          "evidence": "Codex goals enabled in both adapters; official API instruction with persistent-plan fallback; saved schemas. Practical limit: The current exec interface does not expose every app-server API. See docs/case-studies/issue-2335/README.md and data/validation.json."
        },
        {
          "text": "Link exactly all required issues, including all-open solves.",
          "status": "done",
          "evidence": "Primary + nested native + body-only set; exact-repository references; 105-issue test; native-link pagination. Practical limit: Native attachments remain capped at 100; required scope is not capped there. See docs/case-studies/issue-2335/README.md and data/validation.json."
        },
        {
          "text": "Repair after solve/restart description edits.",
          "status": "done",
          "evidence": "Shared result verification, description rewrite repair and report preservation, iteration-final repair, continuation recovery. Practical limit: Concurrent description edits can require another repair. See docs/case-studies/issue-2335/README.md and data/validation.json."
        },
        {
          "text": "Find root causes and check relevant paths for regressions.",
          "status": "done",
          "evidence": "Commit history, full incident capture, ordinary/queue/one-shot/watch/continuation/restart/batch paths reviewed and covered; queue context handoff regression reproduced before its fix. Practical limit: A finite test suite cannot prove all future inputs or integrations. See docs/case-studies/issue-2335/README.md and data/validation.json."
        },
        {
          "text": "Cover the critical behavior with tests.",
          "status": "done",
          "evidence": "Failing reproductions before fixes; line/function coverage and failure-path tests; full default suite and local CI checks. Practical limit: Coverage is measured for the new focused modules, not asserted for the entire preexisting application. See docs/case-studies/issue-2335/README.md and data/validation.json."
        },
        {
          "text": "Download logs/data and produce a deep case study.",
          "status": "done",
          "evidence": "This document, original metadata, all 11 CI captures with manifest, full gist/diff, research and upstream examples. Practical limit: The original gist ends before merging; the timeline supplies that missing event. See docs/case-studies/issue-2335/README.md and data/validation.json."
        },
        {
          "text": "Research facts and existing components/libraries.",
          "status": "done",
          "evidence": "Primary GitHub/OpenAI documentation and upstream maintainer/package data; reuse described below. Practical limit: Research/package versions are a dated snapshot. See docs/case-studies/issue-2335/README.md and data/validation.json."
        },
        {
          "text": "Add diagnostic output if data is insufficient.",
          "status": "done",
          "evidence": "Existing trace proves the cause; new default-off verbose verification count/SHA and always-visible failure diagnostics. Practical limit: API outages are reported, not inferred as successful verification. See docs/case-studies/issue-2335/README.md and data/validation.json."
        },
        {
          "text": "Report related upstream issues with reproduction/workaround/code suggestions.",
          "status": "done",
          "evidence": "[OpenTUI #1550](https://github.com/anomalyco/opentui/issues/1550), preserved body and metadata, executable local reproduction. Practical limit: Filing a request does not complete Agent #322's compatibility criterion. See docs/case-studies/issue-2335/README.md and data/validation.json."
        },
        {
          "text": "Complete the work in this single PR.",
          "status": "done",
          "evidence": "All solver changes, reproductions, tests, release changeset, operating guide and case-study evidence are in PR #2336. Practical limit: Universal future-regression impossibility is not a truthful deliverable. See docs/case-studies/issue-2335/README.md and data/validation.json."
        },
        {
          "text": "Prove 100% absence of every future regression and make incomplete arbitrary prose requirements impossible to merge under all external races.",
          "status": "blocked",
          "evidence": "The reproduced critical mechanisms are tested, with 523 default test files passing and 100% focused line/function coverage. No finite test suite, model goal or agent-written report can prove arbitrary prose completion or all future behavior; GitHub offers no atomic lock across commit, description and feedback. The case study documents these limits. This literal universal guarantee is not certified, so the new guard must keep this PR ineligible for automated merging."
        }
      ]
    }
  ]
}
```
<!-- hive-mind:requirements:end -->

<!-- hive-mind:changes:start -->
### Changes
- 159 file(s) modified
- 33080 line(s) added
- 593 line(s) removed
- Files:
  - `.changeset/issue-2335-complete-issue-merges.md`
  - `.prettierignore`
  - `Dockerfile`
  - `Dockerfile.dind`
  - `README.hi.md`
  - `README.md`
  - `README.ru.md`
  - `README.zh.md`
  - `docs/CONFIGURATION.hi.md`
  - `docs/CONFIGURATION.md`
  - `docs/CONFIGURATION.ru.md`
  - `docs/CONFIGURATION.zh.md`
  - `docs/ISSUE_COMPLETION.hi.md`
  - `docs/ISSUE_COMPLETION.md`
  - `docs/ISSUE_COMPLETION.ru.md`
  - `docs/ISSUE_COMPLETION.zh.md`
  - `docs/case-studies/issue-2335/README.md`
  - `docs/case-studies/issue-2335/data/agent-ci-36700558729.log.gz`
  - `docs/case-studies/issue-2335/data/agent-ci-36702510792.log.gz`
  - `docs/case-studies/issue-2335/data/agent-ci-36702510793.log.gz`
  - `docs/case-studies/issue-2335/data/agent-ci-36702510811.log.gz`
  - `docs/case-studies/issue-2335/data/agent-ci-36702510841.log.gz`
  - `docs/case-studies/issue-2335/data/agent-ci-36702510955.log.gz`
  - `docs/case-studies/issue-2335/data/agent-ci-36702901747.log.gz`
  - `docs/case-studies/issue-2335/data/agent-ci-36702901786.log.gz`
  - `docs/case-studies/issue-2335/data/agent-ci-36702901811.log.gz`
  - `docs/case-studies/issue-2335/data/agent-ci-36702901827.log.gz`
  - `docs/case-studies/issue-2335/data/agent-ci-36702901842.log.gz`
  - `docs/case-studies/issue-2335/data/agent-ci-manifest.json`
  - `docs/case-studies/issue-2335/data/agent-experiment-readme.md`
  - `docs/case-studies/issue-2335/data/agent-experiment-script.mjs.txt`
  - `docs/case-studies/issue-2335/data/agent-final-ci.log`
  - `docs/case-studies/issue-2335/data/agent-goal-search.json`
  - `docs/case-studies/issue-2335/data/agent-initial-security.log`
  - `docs/case-studies/issue-2335/data/agent-issue-319.json`
  - `docs/case-studies/issue-2335/data/agent-issue-322-comments.json`
  - `docs/case-studies/issue-2335/data/agent-issue-322-timeline.json`
  - `docs/case-studies/issue-2335/data/agent-issue-322.json`
  - `docs/case-studies/issue-2335/data/agent-pin-0.26.10.json`
  - `docs/case-studies/issue-2335/data/agent-pr-326-ci-runs.json`
  - `docs/case-studies/issue-2335/data/agent-pr-326-review-comments.json`
  - `docs/case-studies/issue-2335/data/agent-pr-326-reviews.json`
  - `docs/case-studies/issue-2335/data/agent-pr-326-session.log`
  - `docs/case-studies/issue-2335/data/agent-pr-326-timeline.json`
  - `docs/case-studies/issue-2335/data/agent-pr-326.diff`
  - `docs/case-studies/issue-2335/data/agent-pr-326.json`
  - `docs/case-studies/issue-2335/data/brace-comma-advisory.json`
  - `docs/case-studies/issue-2335/data/brace-rewrite-advisory.json`
  - `docs/case-studies/issue-2335/data/brace-stack-advisory.json`
  - `docs/case-studies/issue-2335/data/codex-ThreadGoalSetParams.json`
  - …and 109 more
<!-- hive-mind:changes:end -->

