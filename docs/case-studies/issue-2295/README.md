# Case study: issue #2295 — bad reviewer experience on paranjko/external-test-lab#177

- Issue: https://github.com/link-assistant/hive-mind/issues/2295
- Incident pull request: https://github.com/paranjko/external-test-lab/pull/177 (closed unmerged, labelled `wontfix`)
- Target issue of that pull request: https://github.com/paranjko/external-test-lab/issues/49
- Fix pull request: https://github.com/link-assistant/hive-mind/pull/2297

## Summary

Between 2026-09-23 and 2026-09-25 hive-mind ran three solve sessions on a fork pull request to
`paranjko/external-test-lab`. The maintainer, @ilyar, rejected the result, asked to talk to a human,
and later closed the pull request. The issue says he threatened to block us.

The pull request fixed a small portability defect (`date +%s%3N`). Issue #49 asked for a live
deployment and acceptance task. hive-mind made several **false or overriding statements** about
this small change, which made it look much bigger than it was:

1. It posted **"✅ Ready to merge — All CI checks have passed" three times**. In fact, no CI job
   had run: the fork's workflow runs were waiting for maintainer approval.
2. It **appended "Fixes #49" to the pull request body three times**. It did so even after the body
   had been rewritten to say that the pull request does _not_ solve #49.
3. The maintainer **converted the pull request to draft**, and **hive-mind marked it "ready for
   review" again** in the next two sessions.
4. Every session posted a **"Public pricing estimate: $32.64"** block. The maintainer could not
   tell whether it was "a hint or a requirement".
5. Other factors were human and process ones, not code. The AI's replies were long and defensive.
   A private-chat screenshot was posted into the pull request. Telegram messages were relayed
   as prompts. The pull request was worked on repeatedly although the task could not be done
   without operator credentials.

Items 1–4 are defects in hive-mind and are fixed in PR #2297. Item 5 is covered by prompt changes
and by the process recommendations below.

## Data collected

All data was downloaded on 2026-09-25 with `gh api` and is kept in this folder:

| File                                                                                                     | Content                                                            |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `data/pr-177.json`                                                                                       | pull request object                                                |
| `data/pr-177-timeline.json`                                                                              | issue timeline of the pull request (drafts, ready, reviews, close) |
| `data/pr-177-conversation-comments.json`, `data/pr-177-review-comments.json`, `data/pr-177-reviews.json` | all three GitHub comment types                                     |
| `data/issue-49*.json`                                                                                    | issue #49, its comments and timeline                               |
| `data/workflow-runs-<sha>.json`, `data/check-runs-<sha>.json`, `data/status-<sha>.json`                  | CI state of heads `a3edab7e`, `633608e2`, `f367f6f4`               |
| `data/logs/session1-codex-gpt-5.6-sol-2026-09-23.log.txt`                                                | full solve log, session 1 (solve v2.29.0, codex `gpt-5.6-sol`)     |
| `data/logs/session2-claude-opus-2026-09-24.log.txt`                                                      | full solve log, session 2 (solve v2.32.0, claude `opus`)           |
| `data/logs/session3-codex-gpt-6-sol-2026-09-25.log.txt`                                                  | full solve log, session 3 (solve v2.32.0, codex `gpt-6-sol`)       |
| `comments-dump.txt`, `issue-49-dump.txt`                                                                 | readable text dumps of the comments                                |

**Privacy:** the pull request comment `#issuecomment-5826170179` embedded a screenshot of a private
chat. The maintainer objected to that post. The screenshot was not downloaded, and its URL is
replaced with `REDACTED-private-chat-screenshot` in every file here.

All three sessions ran with the same flags: `solve <url> --think … --tool … --attach-logs --verbose
--no-tool-check --disable-report-issue --language en`. None of them passed
`--auto-restart-until-mergeable` explicitly.

## Timeline (UTC)

| Time              | Event                                                                                                                                                                       | Evidence                                                 |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 09-23 19:58       | Session 1 starts on issue #49 (codex, `gpt-5.6-sol`, `--think xhigh`)                                                                                                       | session 1 log, line 1–5                                  |
| 09-23 20:10–22:24 | Commits add an `epoch_millis` helper in two places and replace `date +%s%3N`                                                                                                | `pr-177-timeline.json`                                   |
| 09-23 22:26:18    | Pull request marked ready for review                                                                                                                                        | timeline `ready_for_review`                              |
| 09-23 22:28:52    | The AI's comment itself says CI is blocked at fork-workflow approval (runs 35928340444, 35928340688)                                                                        | comment 5804007264                                       |
| 09-23 22:31:19    | hive-mind appends **"Fixes paranjko/external-test-lab#49"**                                                                                                                 | session 1 log, line 37674                                |
| 09-23 22:31:46    | Log comment with **"Public pricing estimate: $32.635322"**                                                                                                                  | comment 5804043449                                       |
| 09-23 22:34:16    | **"✅ Ready to merge — All CI checks have passed"** (false)                                                                                                                 | comment 5804071409                                       |
| 09-24 05:29:46    | @ilyar review comment: `epoch-millis.sh` is a duplicate                                                                                                                     | review comment r4090248608                               |
| 09-24 05:46:43    | ever-guild-ops review approves (later dismissed automatically by GitHub on push)                                                                                            | `pr-177-reviews.json`                                    |
| 09-24 05:51:01    | **@ilyar converts the pull request to draft**                                                                                                                               | timeline `convert_to_draft`                              |
| 09-24 08:46:08    | ever-guild-ops review notes the runbook run is `action_required` and "supplies no passing … result"                                                                         | review 5301968344                                        |
| 09-24 15:58:06    | konard relays @ilyar's feedback: only a portability fix; `epoch_millis` duplicated; "Fixes #49" is false; is the $32.64 "a hint or a requirement?"                          | comment 5817571958                                       |
| 09-24 18:04:57    | Session 2 starts (claude `opus`); PR "Already in draft mode"; the prompt still says "use gh pr ready 177"                                                                   | session 2 log, lines 178, 343, 498                       |
| 09-24 18:45:06    | Long reply comment; the PR body is rewritten to "not a solution … Part of #49"                                                                                              | comment 5820099370                                       |
| 09-24 18:45:10–13 | **The AI runs `gh pr ready 177`**, overriding @ilyar's draft                                                                                                                | session 2 log, lines 24494, 24529                        |
| 09-24 18:45:34    | hive-mind appends **"Fixes paranjko/external-test-lab#49"** again                                                                                                           | session 2 log, line 25016                                |
| 09-24 18:48:19    | **"✅ Ready to merge"** again (false)                                                                                                                                       | comment 5820157858                                       |
| 09-25 03:26:10    | konard posts a private-chat screenshot, @ilyar's words, and a long prompt                                                                                                   | comment 5826170179                                       |
| 09-25 03:28:33    | Session 3 starts (codex `gpt-6-sol`); hive-mind converts the (ready) PR to draft for the session                                                                            | session 3 log, lines 180–185                             |
| 09-25 03:33–03:59 | Every workflow-run check sees `action_required` with `jobs: []`                                                                                                             | session 3 log, lines 3758, 9515, 17553, 17639            |
| 09-25 03:40:20    | The AI answers "НЕТ — …" in four paragraphs, although @ilyar asked for "YES or NO, and one sentence why"                                                                    | comment 5826284361                                       |
| 09-25 03:44:10    | **The AI runs `gh pr ready 177`** again                                                                                                                                     | session 3 log, lines 9441, 9446                          |
| 09-25 04:00:17    | hive-mind appends **"Fixes paranjko/external-test-lab#49"** a third time                                                                                                    | session 3 log, line 18388                                |
| 09-25 04:03:12    | **"✅ Ready to merge"** a third time (false)                                                                                                                                | comment 5826484954                                       |
| 09-25 09:50:12    | @ilyar: CHANGES_REQUESTED — does not implement #49                                                                                                                          | review 5300182648                                        |
| 09-25 09:50:23    | **@ilyar converts the pull request to draft** again                                                                                                                         | timeline                                                 |
| 09-25 15:11:26    | konard relays @ilyar's messages: further communication "will be impossible"; "Operator, connect me to a live human"; the screenshot comment is called "inadequate behavior" | comment 5834725554                                       |
| 09-25 15:45:55    | @ilyar closes the pull request; the held runs switch from `action_required` to `failure`                                                                                    | timeline; `workflow-runs-*.json` (`updated_at` 15:45:56) |
| 09-25 15:46:39    | `wontfix` label                                                                                                                                                             | timeline                                                 |

The three "Ready to merge" comments were posted after each session's log had been uploaded, so they
do not appear in the session logs. The comment bodies and the workflow-run data are the evidence.

## Requirements (from issue #2295)

| #   | Requirement                                                             | Where it is addressed                                                                                  |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| R1  | Find all root causes of the bad experience                              | [Root causes](#root-causes) A–H                                                                        |
| R2  | Make sure it never happens again                                        | Code fixes A, B, D, H plus the preflight notice; prompt updates for C, E, H                            |
| R3  | Download all logs and data to `./docs/case-studies/issue-2295`          | [Data collected](#data-collected)                                                                      |
| R4  | Reconstruct the timeline                                                | [Timeline](#timeline-utc)                                                                              |
| R5  | Search online for additional facts                                      | [Online facts](#online-facts-and-existing-components)                                                  |
| R6  | Propose solutions and plans for each problem, check existing components | [Solutions](#solutions) and [Follow-up plan](#follow-up-plan)                                          |
| R7  | Add debug output / verbose mode where data is missing                   | Verbose logs for non-executed runs and for maintainer-draft detection (see A, H)                       |
| R8  | Report issues to other repositories when relevant                       | [External reports](#external-reports)                                                                  |
| R9  | Apply every fix to all places in the codebase                           | All six `*.prompts.lib.mjs`, all four locales, both readiness-comment paths (watch loop and preflight) |

## Root causes

### A. "Ready to merge — All CI checks have passed" while no CI job had run (fixed)

**What happened:** the pull request comes from a fork. Its two `pull_request` workflows ("Net
deployment runbook", "Build status-site preview") were waiting for maintainer approval. GitHub
reports such runs as `status: completed`, `conclusion: action_required`, with zero jobs and no
check-runs. A third workflow ("Publish status-site preview") uses `pull_request_target`, which
does not need approval, so it ran and passed.

**Evidence:** `workflow-runs-633608e2.json` shows runs 36041471897, 36043433032 and 36091562242
as `pull_request` and `action_required` (they became `failure` only when the PR was closed), plus
the successful `pull_request_target` run. `status-633608e2.json` reports `pending` with
`total_count: 0`.

**Root cause:** `getMergeBlockers()` in `src/solve.auto-merge-helpers.lib.mjs` built the CI verdict
from check-runs. When all existing check-runs passed and every workflow run was `completed`, it
trusted the "success" rollup. It never asked whether each completed run had actually _executed_.
The watch loop then hard-coded the line `- All CI checks have passed`.

G, below, explains why this loop ran at all.

**Fix (commit d1d6ec3f):**

- The new module `src/ci-run-approval.lib.mjs` finds the newest run of each workflow that
  finished as `action_required` or `stale`.
- `getMergeBlockers()` returns those runs and logs a warning. It also writes a `[VERBOSE]` line
  explaining why "All CI checks have passed" is not reported.
- The watch loop then posts **"## ⏸️ CI has not run yet"**, listing the runs awaiting approval,
  instead of "Ready to merge".
- It never auto-merges in that state, and returns `ci_awaiting_approval`.
- Test: `tests/test-issue-2295-ci-awaiting-approval.mjs`, with fixtures from session 3.

**Same defect elsewhere (commit 4407eb30):** `postManualMergeNotice()` in
`src/solve.auto-merge-preflight.lib.mjs` posted "## ✅ Ready to merge — This pull request is ready
to be merged" in `--auto-merge` fork / no-permission mode, before any CI or mergeability check. It
now posts "## ⚠️ Auto-merge blocked: hive-mind cannot merge this pull request". That notice says
explicitly that CI was not checked.

### B. "Fixes #49" appended over a deliberate partial-scope description (fixed)

**What happened:** in session 2 the AI rewrote the body to say the pull request is "not a solution"
and "Part of #49". 25 seconds later, hive-mind's post-session link check appended
`Fixes paranjko/external-test-lab#49` anyway (session 2 log, line 25016). The same happened in
sessions 1 and 3. @ilyar named "Fixes #49" as the worst part of the change.

**Root cause:** `ensurePullRequestIssueLink()` (issues #1616 and #1763) re-adds the closing keyword
whenever GitHub's closing keywords are missing. It could not tell apart two cases: an AI that
simply forgot the keyword, and an author who _deliberately_ used a non-closing reference.

**Fix (commit 1f71f363):**

- `findNonClosingIssueReference()` in `src/github-linking.lib.mjs` recognises explicit non-closing
  phrases such as "Part of #N", "Relates to owner/repo#N" and "Refs: #N".
- When one is present, `ensurePullRequestIssueLink()` logs the decision and leaves the body
  unchanged.
- A bare mention such as "for issue #49" still gets "Fixes #N", so the #1616 and #1763 behaviour
  is kept.
- Test: `tests/test-issue-2295-partial-scope-issue-link.mjs`.

### C. The task was not feasible for an AI without operator access (prompt changes and follow-up)

**What happened:** issue #49 asks for public inference acceptance, a DevShard v5 rollout, and a
state-preserving Gonka v0.2.16 transition on a live network. Session 3's own answer says it has
"no `GDC_HOME/.env` or SSH configuration for the DevNet". Instead of stopping, every session
produced a small side fix and presented it as progress on #49.

**Root cause:** there is no feasibility check before or during a session. The prompts told the AI
to "use closing keywords", which pushed it towards claiming full scope.

**Fix (commit 0641244f):** all six tool prompts and all four locales now say: "When the pull request
only partially solves the issue, say so in its description with 'Part of #N' instead of a
closing keyword such as 'Fixes #N'." Automated feasibility gating is a follow-up (see below).

### D. The cost block looked like an invoice (fixed)

**What happened:** @ilyar asked whether "Public pricing estimate: $32.635322" was "a hint or a
requirement".

**Root cause:** the log comment printed a dollar amount, and nothing on the page explained what
it was.

**Fix (commit 0c895d8c):** the full cost-estimation block now ends with _"Informational only: the
estimated AI compute cost of this work session. It is not a request for payment."_
(`COST_INFO_NOTE` in `src/github-cost-info.lib.mjs`). The short `### 💰 Cost:` form is unchanged
because its exact text is pinned by existing tests. Today the only way to omit the block is to
run without `--attach-logs`, which also drops the log; a separate switch is a possible follow-up.

### E. Long, defensive AI replies (prompt changes and follow-up)

**What happened:** @ilyar asked for "YES or NO, and one sentence why". The reply had four
paragraphs (194 words) and included a request to run operator commands. The session 2 reply had
418 words. @ilyar called the output "a pile of useless neuro-slop"
("кучу бесполезного нейрослопа").

**Root cause:** the prompts push for completeness ("address all feedback", "nothing should be
deferred"). No prompt says that the requested _format_ of an answer is itself a requirement.

**Plan:** see the follow-up plan. The prompt changes in H stop the most visible override, which was
marking the pull request ready again.

### F. Human and process factors (recommendations)

- A private-chat screenshot was posted in the pull request (comment 5826170179). @ilyar called
  this "inadequate behavior". Private conversations must not be published in public repositories
  without consent. This case study redacts it.
- Telegram messages were relayed to the pull request word for word, as prompts for the AI
  ("Машине: …"). The maintainer asked for a human ("Оператор, соедините с живым человеком"). When
  a reviewer asks for a human, a human should reply before the next AI session runs.
- The AI repeatedly asked the maintainer to approve CI runs and to run operator commands. For an
  external repository, one polite request is enough.
- Four AI comments in two days on a pull request the maintainer had already put back into draft
  looked like pressure.

### G. `--auto-restart-until-mergeable` is on by default (documented)

None of the three commands passed the flag. It is still on by default, per
`src/solve.config.lib.mjs`:

```js
'auto-restart-until-mergeable': {
  type: 'boolean',
  …
  default: true,
},
```

That is why the "Ready to merge" monitor ran after every session. The default is a product
decision that other issues rely on, so it is not changed here. With fix A, the monitor can no
longer make a false readiness claim.

### H. The maintainer's draft conversion was overridden (fixed)

**What happened:** @ilyar converted the pull request to draft (09-24 05:51:01). In session 2, the
AI ran `gh pr ready 177`. In session 3 the pull request was ready at the start (the override from
session 2), so the maintainer's intent was lost completely, and the AI ran `gh pr ready` again. The
system prompt of every session literally said "When you finish implementation, use gh pr ready
177".

**Root cause:** `src/pr-draft-state.lib.mjs` knew only two kinds of draft: drafts hive-mind created
for a working session, and hive-mind's own deliberate drafts (no changes / failure). A draft
created _by a maintainer_ was treated like a working-session draft, so marking the pull request
ready at the end was "restoring" it.

**Fix (commits cd18265f, cdc4ded8, 0641244f):**

- `findMaintainerDraftConversion()` reads the pull request timeline. It returns the latest
  `convert_to_draft` / `ready_for_review` event by an actor other than the authenticated user.
  When that is a draft conversion, the pull request is recorded as a deliberate `maintainer_draft`.
- At session end, a maintainer draft is restored even if the AI ran `gh pr ready`.
- `resolveDraftBlocker()` stops the auto-restart loop instead of converting the pull request back
  to ready.
- Only the maintainer marking the pull request ready ends the state.
- The session-start comment says: "The PR stays a draft: @ilyar converted it to draft at …; only a
  maintainer should mark it ready for review."
- All prompts now say "use gh pr ready N, unless a maintainer converted the pull request to draft
  or requested changes; then leave it in draft and let the maintainer decide."
- A verbose log line records who converted the pull request and which identity hive-mind runs as.
- Test: `tests/test-issue-2295-maintainer-draft.test.mjs`. It replays the incident: session 2 and
  session 3, including the case where the pull request is already ready at the start.

## Solutions

| Root cause                                              | Status  | Commit                       | Test                                                            |
| ------------------------------------------------------- | ------- | ---------------------------- | --------------------------------------------------------------- |
| A – false "Ready to merge" with CI awaiting approval    | fixed   | d1d6ec3f                     | `tests/test-issue-2295-ci-awaiting-approval.mjs`                |
| A – preflight "Ready to merge" notice without any check | fixed   | 4407eb30                     | same file, group 7                                              |
| B – "Fixes #N" appended over "Part of #N"               | fixed   | 1f71f363                     | `tests/test-issue-2295-partial-scope-issue-link.mjs`            |
| C – partial work presented as a full fix                | prompts | 0641244f                     | source pin in `tests/test-issue-2295-maintainer-draft.test.mjs` |
| D – cost block read as an invoice                       | fixed   | 0c895d8c                     | `tests/test-build-cost-info-string.mjs`                         |
| H – maintainer draft overridden                         | fixed   | cd18265f, cdc4ded8, 0641244f | `tests/test-issue-2295-maintainer-draft.test.mjs`               |

How to reproduce the original behaviour: check out `main` before these commits and run the three
test files above. The CI fixture yields "All CI checks have passed". The "Part of #49" body gains
"Fixes #49". The maintainer-draft replay ends with the pull request ready for review.

## Follow-up plan

1. **Feasibility gate (C).** Before the first session on an issue, have the model classify whether
   the task needs credentials or live infrastructure that the runner lacks. In that case, post one
   short question to the issue instead of opening a pull request.
2. **Answer-format compliance (E).** Add a prompt rule: "When a reviewer asks for a specific answer
   format (for example yes/no plus one sentence), reply in exactly that format." A lint step could
   flag replies longer than N words on pull requests in external repositories.
3. **Human escalation (F).** If a reviewer writes "human", "operator" or similar, or converts the
   pull request to draft twice, stop scheduling AI sessions until a human confirms.
4. **External-repository etiquette (F).** Document in the operator guide:
   - never post private chats;
   - do not relay chat messages as prompts in the pull request;
   - ask for CI approval at most once.
5. **Default of `--auto-restart-until-mergeable` (G).** Consider making the default depend on
   whether hive-mind has write access to the target repository.

## Online facts and existing components

- GitHub holds workflow runs from public-fork pull requests until a maintainer approves them;
  until then the run has no jobs:
  <https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/approving-workflow-runs-from-public-forks>.
- `pull_request_target` runs in the base-repository context without that approval, so it can
  report success while `pull_request` runs of the same commit wait:
  <https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows#pull_request_target>.
- Only `close`, `closes`, `closed`, `fix`, `fixes`, `fixed`, `resolve`, `resolves` and `resolved`
  are closing keywords. "Part of #N" only mentions the issue:
  <https://docs.github.com/en/issues/tracking-your-work-with-issues/linking-a-pull-request-to-an-issue>.
- Draft conversions are visible as `convert_to_draft` / `ready_for_review` timeline events with an
  actor: <https://docs.github.com/en/rest/issues/timeline>.
- Existing components that were reused:
  - `getWorkflowRunsForSha()` and `classifyCancelledCIByWorkflowRuns()` (#1690, #2182);
  - `prClosesIssue()`;
  - the draft-state registry from #2182;
  - `postTrackedComment()` and `checkForExistingComment()` (#1567, #1584);
  - `AUTO_MERGE_BLOCKED_MARKER` (#2144).

## External reports

No issue was filed in another repository:

- **GitHub's behaviour is documented, not a bug.** A combined status of "success" while approval
  is pending is expected, so the fix belongs in hive-mind.
- **paranjko/external-test-lab** is the repository whose maintainer asked us to stop. Another
  automated post there would repeat root cause F. Any follow-up there should come from a human.
