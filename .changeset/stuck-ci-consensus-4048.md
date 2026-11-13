---
'@link-assistant/hive-mind': patch
---

`--auto-restart-until-mergeable` no longer waits silently for hours on CI signals that will never change (#4048).

**Out-of-band runs.** A failed or running `workflow_dispatch`, `schedule`, `repository_dispatch` or `workflow_run` run on the HEAD commit no longer holds the multi-mechanism CI consensus or the `/merge` queue (`checkPRCIStatus`). GitHub leaves these runs out of the pull request's merge state, and a `CLEAN`/`MERGEABLE` PR is now trusted by the consensus exactly as by `getMergeBlockers` (#2031).

**Ghost runs.** Workflow runs stuck in `queued` with zero jobs, for example after a GitHub Actions incident, are handled as follows (`HIVE_MIND_STUCK_QUEUED_RUN_MINUTES`, default 30):
- on older PR commits they are ignored and reported;
- on HEAD they are cancelled (falling back to force-cancel) and re-run, at most `HIVE_MIND_STUCK_RUN_RERUN_ATTEMPTS` times (default 2), and only when githubstatus.com reports no active Actions/Webhooks incident. Runs that started on their own are never touched.

**Visibility.** Each disagreement now logs which checks and runs disagree, together with the githubstatus.com incidents that overlap the wait. After `HIVE_MIND_CONSENSUS_DISAGREE_NOTICE_CHECKS` identical checks (default 15), one `CI wait is stuck` comment is posted on the PR.

**Stopping.** A stop request now parks the auto-merge, watch and auto-continue loops, so they no longer start new checks while the interrupt handler uploads the log.
