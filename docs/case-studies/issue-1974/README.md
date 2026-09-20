# Issue 1974 Case Study: PR 199 Had No Real Changes

## Scope

Issue #1974 asked why `rumaster/vpn` PR #199 ended with no meaningful code changes, whether changes were applied but left uncommitted, why no summary was extracted, and whether the root cause still exists in this codebase.

Evidence is stored in this directory:

- `raw/solution-draft-log-pr-1779277313962.txt`: full attached solver log from PR #199.
- `raw/rumaster-vpn-pr-199.json`: PR #199 metadata.
- `raw/rumaster-vpn-pr-199-issue-comments.json`: PR #199 comments, including the log and billing-limit comments.
- `raw/link-assistant-hive-mind-issue-1974.json`: original investigation issue.
- `checks/`: local verification logs from this fix.

I also searched the public web for `solution-draft-log-pr-1779277313962`, `rumaster/vpn pull/199 issuecomment-4498003949`, and the PR/comment URL. No additional relevant public records were found beyond the GitHub issue, PR comments, and gist log captured here.

## Timeline

- 2026-05-20 11:33:32 UTC: the solver created only the initial `.gitkeep` file and committed it for branch `issue-198-e1bad48f8b60` (`raw/solution-draft-log-pr-1779277313962.txt:211`-`224`).
- 2026-05-20 11:33:40 UTC: draft PR #199 was created from that branch. The PR metadata shows one commit, one changed file, one addition, and zero deletions (`raw/solution-draft-log-pr-1779277313962.txt:357`).
- 2026-05-20 11:39:21 UTC: Claude auto-compacted. The synthetic continuation message included a detailed root cause and pending implementation plan for the target repo, but it was not a terminal result event (`raw/solution-draft-log-pr-1779277313962.txt:13245`-`13262`).
- 2026-05-20 11:41:43 UTC: the last useful Claude event was a failed tool result: `Path does not exist: /tmp/gh-issue-solver-1779276811027/apps/bot/src` (`raw/solution-draft-log-pr-1779277313962.txt:20723`-`20733`).
- 2026-05-20 11:41:45 UTC: no terminal `result` event appeared, but the wrapper logged `Claude command completed` and `Total messages: 0, Tool uses: 0` (`raw/solution-draft-log-pr-1779277313962.txt:20798`-`20799`).
- 2026-05-20 11:41:45 UTC: the solver checked the working tree and found no uncommitted changes (`raw/solution-draft-log-pr-1779277313962.txt:20859`).
- 2026-05-20 11:41:45 UTC: no working-session summary was available because no success result was emitted (`raw/solution-draft-log-pr-1779277313962.txt:20872`).
- 2026-05-20 11:41:49 UTC: finalization generated a PR description from the diff, but the diff was only `.gitkeep` (`raw/solution-draft-log-pr-1779277313962.txt:20900`-`20906`).
- 2026-05-20 11:41:52 UTC: the wrapper converted PR #199 from draft to ready for review (`raw/solution-draft-log-pr-1779277313962.txt:20911`-`20913`).

## Findings

No target-repo changes were applied. The end-of-run `git status` showed no uncommitted changes, and PR #199 contained only the initial `.gitkeep` change. This answers the central issue: there were no real edits to auto-commit.

The target-repo investigation did reach a useful analysis state before failing. The compaction summary identified a likely AmneziaWG registration deadlock: the node agent did not send AWG public-key/obfuscation metadata during registration, while the API selected AWG nodes only when `amneziaWgPublicKey` was present. That work stayed in Claude's context/log only; it was not written into repo files.

The hive-mind root cause was stream handling:

- The parser counted only top-level `message` and `tool_use` events, but Claude stream-json emits `assistant` and `user` events with nested `message.content` items.
- A failed nested `tool_result` did not make the command fail.
- A zero-exit Claude process without a terminal `result` event was treated as success.
- Summary extraction depended on a successful terminal `result`, so the synthetic compaction summary was ignored.
- PR finalization then removed `[WIP]`, synthesized a summary from the `.gitkeep` diff, and marked the draft ready.

## Implemented Fix

This PR adds `src/claude.stream-events.lib.mjs` to normalize Claude stream event facts:

- counts `assistant`, `user`, and legacy `message` events;
- counts nested tool uses;
- captures failed nested tool results as the last meaningful error;
- captures synthetic compaction summaries as fallback working-session summaries;
- classifies a non-interactive Claude stream that exits without any terminal `result` event as a command failure.

`src/claude.lib.mjs` now uses those facts in both the normal streaming path and the leftover-buffer path. On this failure shape, `/solve` will now fail before `verifyResults()` finalizes and marks a placeholder PR ready.

The small model/resume helpers were extracted to keep `src/claude.lib.mjs` under the repository's 1500-line cap.

## Regression Test

`tests/test-issue-1974-claude-stream-completion.mjs` reconstructs the relevant event sequence from PR #199:

- nested assistant `tool_use`;
- failed nested user `tool_result`;
- synthetic compaction summary;
- stream completion without a terminal result event.

The test verifies that the event facts are detected and that the missing-result stream is classified as failure.

## Verification

Local checks run from this workspace:

- `node tests/test-issue-1974-claude-stream-completion.mjs`
- `bash scripts/check-file-line-limits.sh`
- `npm ci` (succeeded with the local Node 20 vs package Node 24 engine warning)
- `npm test`
- `npm run lint`
- `npm run format:check`

`npm test` passed all 286 selected default test files. Logs are in `checks/`.

## Follow-Up

The implemented fix prevents this exact false-success path. A separate hardening option would be to make PR finalization refuse to mark a draft ready when the only diff is the initialization file, but that is broader policy and was not required once incomplete Claude streams fail earlier.
