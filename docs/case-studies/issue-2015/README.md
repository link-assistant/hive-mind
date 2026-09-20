# Issue 2015: Docker OOM and False Killed Telegram Sessions

## Summary

Issue #2015 reported three Docker-isolated Telegram work sessions with confusing
or incorrect final state:

- `ad934035-03bd-41ff-b766-2722a02a5141` / internal session
  `5ff719b9-9d2d-4479-b124-c4b8bda61dd0`: Telegram reported the session as
  killed, but `$ --status` later showed `status executed` and `exitCode 0`.
- `58ab247d-595e-4c7a-a2b5-0dffe839a2e7` / internal session
  `1e9e7513-edd7-43a2-b143-169cfd794af6`: Telegram reported killed, while
  `$ --status` still said `status executing` with `oomKilled true`.
- `526880a3-a1fc-45cf-8880-87d0a0d913f2` / internal session
  `d90880d4-aa05-4145-ac02-7542eea2041a`: Telegram still showed executing,
  while `$ --status` said `status executing` with `oomKilled true`.

The fix teaches Hive Mind to parse `oomKilled`, treats that marker as terminal
`oom-killed` even if start-command still says `executing`, restores localized
killed-session copy, and adds a short Docker backend-gone grace period so a
single stale liveness miss does not immediately create a false killed
notification. A follow-up hardens the solve queue against resource-recovery
bursts by enforcing at least 10 minutes between task starts globally and by
capping CPU/RAM/disk cache freshness at one minute.

## Preserved Data

- `logs/hive-telegram-bot.log.txt`: full Telegram bot log from the issue gist.
- `logs/bot-session-summary.txt`: extracted timeline and key bot events.
- `logs/start-command-5ff719b9.log.txt`: task 1 start-command log.
- `logs/start-command-5ff719b9-summary.txt`: task 1 extracted resource and
  footer summary.
- `logs/start-command-1e9e7513.log.txt`: task 2 start-command log.
- `logs/start-command-1e9e7513-summary.txt`: task 2 extracted resource summary.
- `logs/start-command-d90880d4.log.txt`: task 3 start-command log.
- `logs/start-command-d90880d4-summary.txt`: task 3 extracted resource summary.
- `images/task-5ff719b9-status.png`: task 1 Telegram screenshot.
- `images/task-1e9e7513-killed.png`: task 2 Telegram screenshot.
- `images/task-d90880d4-executing.png`: task 3 Telegram screenshot.
- `images/waiting-for-ci-clear.png`: GitHub checks screenshot.
- `logs/upstream-start-issue-search.json`: upstream duplicate search result.
- `logs/upstream-start-issue-144.json`: related upstream start issue snapshot.
- `upstream-start-oomkilled-status.md`: body used for the focused upstream
  follow-up issue.

## Requirements

1. Determine whether the reported failures were caused by RAM, disk, or false
   positives.
2. Preserve logs, screenshots, summaries, requirements, and solution notes under
   `docs/case-studies/issue-2015`.
3. Fix Telegram completion behavior for Docker OOM-killed sessions that still
   report `status executing`.
4. Stop leaking the raw localization key `telegram.work_session_killed`.
5. Avoid false killed notifications when Docker status is temporarily stale.
6. Open or reference an upstream `link-foundation/start` issue for the
   `oomKilled true` plus `status executing` contract gap.
7. Add a reproducing automated test.
8. Use the fixed upstream `start-command` release once it is available.
9. Enforce a minimum 10-minute interval between task startups, including after
   restrictions lift and when immediate starts are queued.
10. Do not cache CPU, RAM, or disk usage for longer than one minute. API caches
    remain separate.

## Findings

Task 1 was a false killed notification, not a proven RAM or disk kill. The
start-command log for `5ff719b9-9d2d-4479-b124-c4b8bda61dd0` records
`Exit Code: 0` at `2026-07-04 15:09:11.338`. The Telegram bot log, however,
reported the work session killed earlier after a stale `executing` status and a
backend-gone probe. The same task did grow a large writable layer, and the bot
warned that the container filesystem exceeded 5 GB, but the preserved log
footer is explicit success evidence.

Tasks 2 and 3 are Docker OOM cases exposed by start-command but not consumed by
Hive Mind. The issue's `$ --status` snippets show `oomKilled true` while status
remained `executing`; the linked start-command logs do not contain normal
`Finished` / `Exit Code` footers. Docker's Engine API exposes `State.OOMKilled`
as a container-state field, so downstream consumers should treat that marker as
terminal even when a separate status string has not caught up.

The raw key `telegram.work_session_killed` appeared because locale catalogs had
`finished`, `failed`, and `executing` copy for work sessions, but no `killed`
entry. The formatter had a fallback, but the initialized i18n path surfaced the
missing key in Telegram.

The host was under resource pressure during the incident. Bot queue entries show
CPU at 100 percent and disk warnings around 79 to 96 percent. That pressure is a
contributing risk, but it does not by itself explain every symptom:

- Task 1 ultimately exited 0, so the Telegram killed state was premature.
- Tasks 2 and 3 carried explicit Docker `oomKilled true` evidence.
- The CI screenshot for task 1 showed GitHub checks passed; the relevant problem
  was that Hive Mind had already reported the work session as killed.

The follow-up PR comment identified a second operational risk: when resource
limits clear, a backlog of queued tasks can start together before host pressure
has time to settle. Existing per-tool queue spacing could also allow a task from
another tool queue to bypass the recent start from the first tool. For issue
#2015, startup pacing needs to be global across tool queues.

## Root Causes

1. `parseSessionStatusOutput` ignored `oomKilled` in both JSON and
   links-notation `$ --status` output.
2. `session-monitor` trusted stale `executing` too much in one direction and too
   little in another: it did not treat `oomKilled true` as terminal, but it did
   treat Docker backend-gone as immediate killed when there was no terminal
   status, exit code, or log footer.
3. Locale files were missing `telegram.work_session_killed`.
4. Upstream start-command still has a contract gap: a Docker session can expose
   `oomKilled true` while the primary status remains `executing`.
5. Queue startup pacing was too permissive for recovery from host resource
   pressure: it allowed short intervals and was scoped by tool.
6. CPU/RAM/disk cache configuration allowed stale host-pressure data for longer
   than the follow-up requirement permits.

## Solution

The implementation changes:

- Parse `oomKilled` from JSON status fields including `oomKilled`, `OOMKilled`,
  `options.oomKilled`, and Docker-like `State.OOMKilled`.
- Parse `oomKilled true` / `false` from links-notation status output.
- Treat `oomKilled true` as terminal `oom-killed` before backend liveness
  probing. If no useful exit code exists, synthesize exit code 137, matching the
  SIGKILL/OOM convention used elsewhere in Hive Mind.
- Add localized killed-session messages for English, Russian, Chinese, and
  Hindi.
- Pass `exitSuffix` into the localized killed-session formatter so locale copy
  can include the same exit details as the fallback.
- Add a two-minute Docker backend-gone grace period when no terminal status or
  log footer exists. Screen and tmux backend-gone detection remains immediate
  after the existing age gate; explicit Docker `oomKilled true` also remains
  immediate.
- Pin Docker images to `start-command@0.30.3`, which includes upstream start PR
  #149 and reconciles detached Docker `OOMKilled=true` sessions as terminal in
  `--status` / `--list`.
- Clamp `HIVE_MIND_MIN_START_INTERVAL_MS` to a minimum of 10 minutes.
- Apply that minimum interval globally across all tool queues, so an `agent`
  start cannot bypass a recent `claude` start.
- Return only the oldest startable item per queue consumer pass. Tool-specific
  limits are still checked independently, but ready queues no longer launch as a
  burst.
- Cap `HIVE_MIND_SYSTEM_CACHE_TTL_MS` to one minute for CPU, RAM, and disk
  metrics while leaving API cache TTLs unchanged.

## Verification

Before the fix, the new issue-2015 regression failed because `oomKilled` was not
parsed, no Telegram completion edit was sent, and the session stayed tracked.
That output is saved in `logs/test-issue-2015-before-fix.log`.

After the fix:

- `node tests/test-issue-2015-oom-killed-status.mjs` passed with 17 assertions.
- `node tests/test-issue-2015-queue-stability.mjs` passed with 12 assertions,
  covering the 10-minute global start interval, immediate-start burst
  prevention, and one-minute system cache cap.
- `node tests/test-issue-1927-killed-detection.mjs` passed with 25 assertions,
  confirming the older screen-session killed detection still works.
- Related targeted tests for completion labeling, log command behavior, Telegram
  UI i18n, i18n preload, queue config, solve queue behavior, and tool queue
  tracking were also run and saved under `logs/test-runs/`.

Full local CI logs are preserved under `logs/` as they are produced. This local
workspace runs Node 20.20.2 while the repository declares Node `>=24.0.0`, so
engine warnings in local install logs are expected and should be compared
against GitHub Actions, which uses Node 24.

## Upstream Follow-Up

Related upstream issue
`https://github.com/link-foundation/start/issues/144` requested surfacing
Docker resource-exhaustion markers, including `State.OOMKilled`. Issue #2015
shows a narrower remaining contract problem: `oomKilled true` is now visible,
but the primary session status can still remain `executing`.

A focused upstream follow-up was opened as
`https://github.com/link-foundation/start/issues/148`. The body used to create
that issue is preserved in `upstream-start-oomkilled-status.md`.

That upstream follow-up has since been fixed by
`https://github.com/link-foundation/start/pull/149` and released in
`start-command@0.30.3`. Hive Mind still keeps the downstream `oomKilled` parser
and terminal-state handling as defense in depth for older installed versions and
partially stale status output.

## Source Links

- Hive Mind issue #2015:
  `https://github.com/link-assistant/hive-mind/issues/2015`
- Hive Mind PR #2016:
  `https://github.com/link-assistant/hive-mind/pull/2016`
- Related upstream start issue #144:
  `https://github.com/link-foundation/start/issues/144`
- Focused upstream start issue #148:
  `https://github.com/link-foundation/start/issues/148`
- Upstream start PR #149:
  `https://github.com/link-foundation/start/pull/149`
- Docker Engine API v1.45 container state reference:
  `https://docs.docker.com/reference/api/engine/version/v1.45/`
- GitHub REST check runs documentation:
  `https://docs.github.com/rest/checks/runs`
- GitHub REST workflow runs documentation:
  `https://docs.github.com/rest/actions/workflow-runs`
