# Issue 1708 Case Study: `--auto-input-until-mergeable`

## Summary

Issue 1708 proposes a new experimental feature flag,
`--auto-input-until-mergeable`, that minimises the number of session
restarts/resumes Hive Mind currently performs to reach a mergeable PR. The
goal is to keep a single AI tool session alive for as long as possible and
stream new input (uncommitted changes, CI/CD failures, PR/issue comments,
issue title/description updates) directly into the running session via the
existing JSON streaming-input contracts of Claude Code (and equivalent
contracts for Codex/Agent/OpenCode where they exist).

This case study compiles the issue data, reconstructs the current
auto-restart/auto-resume architecture, lists every input source that
currently triggers a restart, evaluates the existing components that already
perform JSON streaming input, and proposes a concrete solution plan that can
be staged into smaller PRs without breaking any existing flag.

This case study originally staged the work into six PRs, but the
shipping PR was expanded after review feedback to land the full
streaming behavior on top of the existing bidirectional pipe. The
flag now ships with: queue-vs-stream delivery routing, busy/idle
tracking driven by Claude's `result` events, status streaming for
CI/uncommitted/PR-metadata/issue-metadata, and a "streaming-first"
banner in the auto-restart fallback loop. Stages 4–6 of the original
plan (smart restart batching for non-Claude tools, resume-aware
streaming, integration tests with a fake stream-json Claude binary)
remain as follow-up work.

## Issue text (verbatim)

> We need to reduce number of restarts and resumes, that happens only on new
> input like uncommitted changes, CI/CD fail, and comments from user. Check
> also other inputs that lead to auto-restart or auto-resume.
>
> So we should try when `--auto-input-until-mergeable` is enabled to extend
> single session as long as possible by streaming direct json input to
> Claude, Codex and Agent CLI tools.
>
> That should new experimental feature, and it should not break any existing
> features. Check how all similar like auto restart until mergeable are
> done, but also include reaction to comments in Pull Request and issue, and
> also reaction to issue description and title updates, that happen during
> working session.
>
> We need to collect data related about the issue to this repository, make
> sure we compile that data to `./docs/case-studies/issue-{id}` folder, and
> use it to do deep case study analysis (also make sure to search online for
> additional facts and data), list of each and all requirements from the
> issue, and propose possible solutions and solution plans for each
> requirement (we should also check known existing components/libraries,
> that solve similar problem or can help in solutions).

## Artifacts

- Issue data: `raw/issue-1708.json`
- PR data: `raw/pr-1709.json`
- Research source list: `research/research-sources.json`
- Restart/resume input matrix: `research/restart-input-matrix.md`

## Requirements (extracted from issue #1708)

The issue text covers six concrete requirements. Each is listed here so the
implementation PRs can be tracked against them.

| #   | Requirement                                                                                                                                                                                         | Source quote                                                                                                                                                                                                                                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Add a new opt-in experimental flag `--auto-input-until-mergeable`.                                                                                                                                  | "we should try when `--auto-input-until-mergeable` is enabled to extend single session as long as possible"                                                                                                                                                |
| R2  | When enabled, extend a single session as long as possible by streaming direct JSON input to the running CLI tool (Claude, Codex, Agent).                                                            | "by streaming direct json input to Claude, Codex and Agent CLI tools"                                                                                                                                                                                      |
| R3  | Stream every restart trigger as input instead of restarting: uncommitted changes, CI/CD failures, PR/issue comments, issue title/description updates, and any other auto-restart/auto-resume input. | "happens only on new input like uncommitted changes, CI/CD fail, and comments from user. Check also other inputs that lead to auto-restart or auto-resume."                                                                                                |
| R4  | The flag must be experimental and must not break any existing features.                                                                                                                             | "That should new experimental feature, and it should not break any existing features."                                                                                                                                                                     |
| R5  | Compile a case study at `./docs/case-studies/issue-1708/` with online research, requirements, and solution plans (this document).                                                                   | "We need to collect data related about the issue to this repository, make sure we compile that data to `./docs/case-studies/issue-{id}` folder, and use it to do deep case study analysis (also make sure to search online for additional facts and data)" |
| R6  | Identify and reuse existing components/libraries that solve a similar problem (so we don't reinvent the bidirectional pipe).                                                                        | "we should also check known existing components/libraries, that solve similar problem or can help in solutions"                                                                                                                                            |

## Existing architecture: how restarts are triggered today

`--auto-restart-until-mergeable` is enabled by default and is the primary
loop that currently consumes all the inputs the issue lists. It lives in
`src/solve.auto-merge.lib.mjs` (`watchUntilMergeable`) and is documented in
detail in `research/restart-input-matrix.md`. Summary of trigger sources:

- **Uncommitted changes** — `solve.restart-shared.lib.mjs#checkForUncommittedChanges` runs `git status --porcelain` after each iteration.
- **CI failures** — `solve.auto-merge-helpers.lib.mjs#getMergeBlockers` fans out to `github-merge.lib.mjs#getDetailedCIStatus`, `getWorkflowRunsForSha`, `checkCIConsensus`.
- **Merge conflicts / not-mergeable** — `getMergeBlockers` returns `not_mergeable` blockers that include "conflicts" in the message.
- **New non-bot comments on issue or PR** — `solve.auto-merge-helpers.lib.mjs#checkForNonBotComments` polls both endpoints (issue comments + PR conversation comments).
- **Cancelled CI** — re-triggered via `rerunWorkflowRun` (does not restart AI).
- **Billing limit** — stops the loop and posts a comment (does not restart AI).
- **Usage / rate limit** — `solve.auto-continue.lib.mjs#autoContinueWhenLimitResets` waits for the reset window + buffer + jitter, then `--resume`s the same session ID.
- **`--watch` mode** — `solve.watch.lib.mjs` performs the same pattern outside the auto-merge loop.

There is **one** trigger from the issue text that today does **not** cause
a restart: **issue title and issue description (body) updates during the
working session**. The current `checkForNonBotComments` only reads
comments, never the issue body or title. This is captured as gap **G1** in
the gap analysis below.

Each trigger today causes one of two transitions:

1. **Restart** — kill the current tool process, run the tool again with
   feedback prepended to the prompt. Everything before this restart that
   was not committed/checkpointed is lost from the model's working memory
   (only files on disk and any `--resume`d session ID survive).
2. **Resume** — `--resume <sessionId>` re-spawns the tool with the same
   conversation log. This is used by the usage-limit branch and by
   `solve.auto-continue.lib.mjs`.

Both transitions cost time (process spawn + repo re-init + warm-up turns
of the model rebuilding context) and tokens (the system prompt is replayed
on each restart). Issue 1708 calls this out as the cost we want to
amortize away by streaming the new input into the still-running session.

## Existing components we can reuse (R6)

The repository **already** has a bidirectional streaming-input pipe — built
for issue #817 (`Implement bidirectional interactive mode`) — which solves
about half of this problem for `--tool claude` and is the right starting
point for issue #1708.

The relevant modules:

| Module                                             | What it provides                                                                                                                                                                                                                                         |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/bidirectional-interactive.lib.mjs`            | NDJSON frame builder (`buildInitialUserFrame`), stdin writer (`writeFrameToStdin`), comment poller, queue, attach/detach helpers. Already wired to `claude --input-format stream-json`.                                                                  |
| `src/claude.lib.mjs` (lines 736–794)               | Spawns `claude` with `stdin: 'pipe'` and `--input-format stream-json` when `argv.acceptIncommingCommentsAsInput && bidirectionalHandler && !argv.resume`. Sets `CLAUDE_CODE_EXIT_AFTER_STOP_DELAY_MS` so the headless process stays alive between turns. |
| `src/solve.config.lib.mjs` (lines 349–369)         | Defines the three existing experimental flags: `--accept-incomming-comments-as-input`, `--exclude-all-own-incomming-comments-from-input`, `--bidirectional-interactive-mode`.                                                                            |
| `src/interactive-mode.lib.mjs`                     | Comment-posting helper used to post outgoing tool output as PR comments (orthogonal but composes with bidirectional).                                                                                                                                    |
| `src/solve.auto-merge.lib.mjs#watchUntilMergeable` | The full restart loop we are trying to replace turn-by-turn for the new flag.                                                                                                                                                                            |
| `src/solve.restart-shared.lib.mjs`                 | Shared `executeToolIteration` / `checkForUncommittedChanges` / `buildAutoRestartInstructions` — the current "feedback as a fresh prompt" pattern. Stays unchanged for non-streaming tools.                                                               |

Confirmed externally:

- **Claude Code CLI** supports `--input-format stream-json` for NDJSON-on-stdin input ([Anthropic Agent SDK docs](https://code.claude.com/docs/en/agent-sdk)). Our `bidirectional-interactive.lib.mjs#formatFeedbackForClaude` already produces the correct frame (`type: "user"`, `message.role: "user"`, `content[].type: "text"`).
- **Codex CLI** `exec` accepts a prompt argument plus stdin-piped context ("If stdin is piped and you also provide a prompt argument, Codex treats the prompt as the instruction and the piped content as additional context"). However, this is a one-shot stdin pipe at process start, not a long-lived NDJSON channel that accepts new user turns mid-session.
- **Agent CLI** (`@link-foundation/agent`) already runs with stdin piped in `src/agent.lib.mjs` (line 502). It does not currently document a multi-turn NDJSON contract on stdin; the existing one-shot pipe is what we have.
- **OpenCode** uses prompt-via-file/stdin in `src/opencode.lib.mjs` (line 271) and has no documented mid-session NDJSON channel.

The honest conclusion (R6 + R2): **only `--tool claude` has a true mid-session
JSON streaming-input channel today.** For the others, the issue's "extend
single session as long as possible" reduces to "batch as much new feedback
as possible into the next prompt, and only restart when the tool process
itself has exited" — still a real win (fewer process spawns, fewer
re-tokenizations of the system prompt), but the implementation must be
honest about which tools get true streaming and which get batching.

## Gap analysis: what's missing today

Each gap below maps to a requirement and is referenced from the solution
plan.

- **G1. Issue title / body updates are not monitored anywhere.** Required
  by R3. `checkForNonBotComments` reads only the comments endpoint. We
  need a `checkForIssueBodyChanges` helper (and PR body changes too) that
  diffs the cached body+title against a fresh fetch and emits a
  feedback frame when they change.
- **G2. The bidirectional handler ignores `argv.resume` sessions.** It is
  gated by `!argv.resume` in `src/claude.lib.mjs:739`. For
  `--auto-input-until-mergeable` we want streaming to work across resumed
  sessions too, otherwise the very first usage-limit hit ends the
  streaming experiment for the whole run.
- **G3. There is no top-level loop that translates "still not mergeable"
  into "new NDJSON frames" without exiting the tool process.**
  `watchUntilMergeable` always exits the tool between checks. We need a
  parallel loop that runs **alongside** a long-lived tool process, posting
  NDJSON frames whenever a blocker is detected, and only restarts when the
  tool dies or signals it cannot make progress.
- **G4. Codex/Agent/OpenCode have no mid-session input channel.** R2
  technically asks for streaming for all three. Since the upstream tools
  do not support it, the design must degrade gracefully: behave like the
  current `watchUntilMergeable` for non-Claude tools, but with the two
  improvements that _can_ be applied universally — coalescing multiple
  triggers into a single restart (so we don't restart for "uncommitted +
  CI fail" twice), and skipping the restart entirely when the tool is
  still running and we just received a single comment.
- **G5. The new flag does not exist.** R1. `--auto-input-until-mergeable`
  needs to be added to `src/solve.config.lib.mjs` with the right
  composition. After review feedback, the correct composition is:
  `--auto-input-until-mergeable` implies only
  `--accept-incomming-comments-as-input` (the input side of bidirectional
  mode) plus `--queue-comments-to-input` (a new delivery-mode flag — see
  G7). It does NOT imply `--interactive-mode` or
  `--bidirectional-interactive-mode`, because those would also push tool
  output back as PR comments — a separate feature with its own opt-in.
  `--auto-restart-until-mergeable` remains enabled as a fallback; the
  goal is for it to stay dormant when input streaming keeps the session
  alive. It must default to `false` per R4.
- **G7. Comment delivery has no mode toggle.** Today, when
  `--accept-incomming-comments-as-input` is enabled, comments are
  forwarded as soon as `pollIncomingComments` sees them. That works for
  short interactive sessions, but with `--auto-input-until-mergeable` we
  want the AI to finish the current step before being interrupted with
  new instructions. Two new opt-in flags are needed:
  `--stream-comments-to-input` (immediate forwarding — the existing
  behavior, default for `--accept-incomming-comments-as-input` on its
  own) and `--queue-comments-to-input` (defer until the AI signals it is
  idle — default for `--auto-input-until-mergeable`).
- **G6. There is no test coverage for the streaming → restart fallback
  path.** R4. Once G3 is implemented, we need an integration-style test
  that simulates "stdin write fails after writableEnded" and asserts that
  the loop falls back to `executeToolIteration` instead of dropping the
  feedback.

## Solution plan

The plan was originally staged across six PRs. Stages 1, 2 (PR/issue
title+body polling for the streaming path), 3 (queue-vs-stream
delivery + busy/idle routing on top of the existing #817 pipe), and
the parts of stage 6 that can run as unit tests are now shipped in
this PR. Stages 4 (smart restart batching for non-Claude tools), 5
(resume-aware streaming — drop the `!argv.resume` guard), and the
integration test with a fake stream-json Claude binary remain as
follow-up work.

### Stage 1 — Flag plumbing (R1, R5, this PR)

**Status: shipped in this PR.**

Add three flags to `src/solve.config.lib.mjs`, all defaulting to `false`
and marked `[EXPERIMENTAL]`:

- `--auto-input-until-mergeable` — top-level opt-in for the new
  experimental behavior.
- `--stream-comments-to-input` — comment-delivery mode: forward each
  comment immediately as it arrives. This is the default mode when
  `--accept-incomming-comments-as-input` is enabled on its own
  (preserves the existing #817 behavior).
- `--queue-comments-to-input` — comment-delivery mode: queue comments
  and only flush them once the AI signals it is idle. This is the
  default mode implied by `--auto-input-until-mergeable` so the AI can
  finish the current step before being interrupted.

Composition wired up in `validateBidirectionalModeConfig`:

- `--auto-input-until-mergeable` enables
  `--accept-incomming-comments-as-input` and defaults to
  `--queue-comments-to-input`. It does **not** enable
  `--interactive-mode` or `--bidirectional-interactive-mode` (those
  would also push tool output back as PR comments — a separate feature
  with its own opt-in).
- `--accept-incomming-comments-as-input` on its own defaults to
  `--stream-comments-to-input` (preserves #817 behavior).
- `--bidirectional-interactive-mode` keeps its existing #817 cascade
  (enables `--interactive-mode`, `--accept-incomming-comments-as-input`,
  `--exclude-all-own-incomming-comments-from-input`).
- For non-Claude tools, the validator warns and disables the streaming
  pipe — same graceful fallback that #817 already provides.
- `--auto-restart-until-mergeable` remains enabled as a fallback; the
  goal is for it to stay dormant once Stage 3 lands and streaming
  keeps the session alive.

Rationale for shipping flag plumbing in stage 1:

- R4 ("not break any existing features") is best satisfied by landing
  the flags with the smallest possible behavior change first, then
  enabling sub-features behind them in subsequent PRs.
- It lets the flags appear in `--help` and the option-suggestions
  library immediately so users / hive can pass them without errors.
- It mirrors how `--bidirectional-interactive-mode` was first added,
  then later wired to the streaming pipe.

The wiring of `--queue-comments-to-input` into the actual handler
(holding comments until the AI is idle) and the long-lived
`streamUntilMergeable` loop are described in stages 3 and 5 below.

### Stage 2 — Issue/PR body+title polling (R3, G1)

**Status: shipped in this PR (streaming side).**

`createBidirectionalHandler` in `src/bidirectional-interactive.lib.mjs`
now polls PR title/body and issue title/body via
`fetchMetadataSnapshot` + `diffMetadataSnapshot`, and emits a one-shot
NDJSON frame (`kind: 'metadata'`) into the live Claude stdin whenever
either changes during the session. The poller is gated on
`streamStatusToInput` (set when `--auto-input-until-mergeable` is on),
so the existing #817 path is unchanged.

Wiring `watchUntilMergeable` to also restart on title/body changes for
non-streaming tools is deferred to stage 4.

### Stage 3 — Long-lived streaming loop for Claude (R2, R3, G3)

**Status: partial — shipped in this PR via the existing #817 pipe.**

Rather than introducing a new file, this PR extends the existing
bidirectional pipe in `src/bidirectional-interactive.lib.mjs` so the
single Claude session that already starts under
`--accept-incomming-comments-as-input` now also receives status frames
(CI / uncommitted / metadata) while it is alive. The
`exitAfterStopDelayMs=60_000` window from #817 keeps the headless
Claude process waiting for new input between turns; while the handler
is alive it dispatches frames to that stdin via the queue/stream
delivery router.

A separate `streamUntilMergeable` loop that survives Claude exits is
still useful for very long sessions, but is no longer required to
deliver R2/R3 — every input source the issue lists is now streamed
into the same single session via the existing pipe. The original
design below is preserved for reference:

1. Spawn Claude with the bidirectional pipe (the path that already exists
   in `claude.lib.mjs`, but reachable from the auto-merge module instead
   of only from `executeClaude`'s direct caller).
2. Run a poller that, on every `watchInterval`, calls the same blocker
   detection that `watchUntilMergeable` uses today (`getMergeBlockers`,
   `checkForNonBotComments`, `checkForUncommittedChanges`,
   `checkForIssueAndPrMetadataChanges`).
3. When the poller detects a new trigger AND the Claude process is still
   alive AND the stdin pipe is still writable: format a feedback frame
   and write it via `writeFrameToStdin`. Increment a "frames sent" counter.
4. When the Claude process exits (graceful or otherwise) OR the stdin
   pipe is closed OR `getMergeBlockers` is clean for N consecutive checks
   AND no NDJSON frame has been written for M seconds: declare the
   session "settled". From there, behave exactly like
   `watchUntilMergeable`'s mergeable branch (post the "Ready to merge"
   comment, optionally `auto-merge`).
5. Fallback: when stdin writes fail or Claude dies with the work still
   not mergeable, restart via `executeToolIteration` (the existing
   `watchUntilMergeable` path). The streaming flag becomes a soft
   optimization on top of the proven loop.

Wire this from `solve.auto-merge.lib.mjs#startAutoRestartUntilMergeable`:
when `argv.autoInputUntilMergeable && argv.tool === 'claude'`, take the
streaming path; otherwise take the existing `watchUntilMergeable` path.
This isolates the new flag and preserves R4.

### Stage 4 — Smart restart for non-Claude tools (R2, G4)

For Codex/Agent/OpenCode, adopt the part of stage 3 that doesn't require
mid-session stdin:

- Coalesce all triggers detected during one `watchInterval` into a
  single restart with one combined feedback section. Today
  `watchUntilMergeable` already builds combined `feedbackLines`, so this
  is small; the change is to reduce the cooldown and the number of
  intermediate "Ready to merge"/"Auto-restart triggered" comments when
  multiple triggers fire in rapid succession.
- Detect process-still-alive in the very narrow window where new
  feedback arrives during the cooldown wait — skip the kill in that case
  and append the feedback to the next planned input.

This is best implemented as a small refactor of `watchUntilMergeable`'s
trigger-collection block, gated on `argv.autoInputUntilMergeable`, so the
default behavior is unchanged for users who don't opt in.

### Stage 5 — Resume-aware streaming (G2)

Drop the `!argv.resume` guard in `src/claude.lib.mjs:739` for the new
flag. After a usage-limit pause, the resumed Claude session should also
be able to receive NDJSON frames. The implementation is a one-line
change — the bigger work is the test that proves a usage-limit pause
followed by a streamed comment ends up in the resumed session's context.

### Stage 6 — Tests (R4, G6)

- Unit: extend `tests/test-bidirectional-interactive.mjs` to cover
  `formatFeedbackForClaude` for issue-body-diff frames and stdin-write
  failure recovery.
- Integration: a new `tests/test-auto-input-until-mergeable.mjs` that
  spawns a fake "Claude" binary (a Node script that reads NDJSON frames
  from stdin and prints `result` events) and asserts the new flag
  forwards comments / body changes / CI hints to it without spawning a
  second process.
- Regression: assert that without `--auto-input-until-mergeable`, the
  existing `watchUntilMergeable` loop is unchanged (use the existing
  `tests/test-auto-restart-*` suite as the baseline).

## Risks & non-goals

- **Risk: stuck-process detection.** A Claude process that has stopped
  making tool calls but hasn't exited (the `--exit-after-stop-delay-ms`
  window) could swallow streamed input without acting on it. Mitigation:
  a "no useful event in N seconds" idle timeout that converts to a
  restart, very close to the existing `streamActivityMs` guard already
  in `claude.lib.mjs`.
- **Risk: thrashing on flapping CI.** A CI job that flakes between
  failure and success would cause repeated NDJSON frames in the
  streaming mode. Mitigation: deduplicate frames by trigger signature
  (e.g. only one frame per `(blocker.type, blocker.details[0])` pair
  until that pair clears).
- **Non-goal: implementing streaming for non-Claude tools.** Stage 4 is
  explicitly a smarter restart loop, not a streaming pipe. We can't
  add a feature to upstream CLIs that don't expose it.
- **Non-goal: removing `--auto-restart-until-mergeable`.** The existing
  loop stays as the fallback. Users opt into streaming; if anything
  breaks the streaming path they get the existing behavior back.

## What this PR ships

This PR ships the full streaming behavior on top of the existing
#817 bidirectional pipe:

- The three new flags (`--auto-input-until-mergeable`,
  `--stream-comments-to-input`, `--queue-comments-to-input`) and
  their composition wiring in `validateBidirectionalModeConfig`.
- Queue-vs-stream delivery routing, busy/idle tracking driven by
  Claude `result` events, and FIFO flushing on idle in
  `createBidirectionalHandler`.
- Status streaming (CI failures, uncommitted local changes,
  PR/issue title and body diffs) emitted as one-shot NDJSON frames
  via `checkForStatusChanges`, gated on
  `--auto-input-until-mergeable`.
- A "streaming-first" banner in
  `watchUntilMergeable` so it is clear the auto-restart loop is the
  fallback rather than the primary handler.

The most critical hot path (`watchUntilMergeable`) is otherwise
unchanged; existing flags (`--auto-restart-until-mergeable`,
`--auto-merge`, `--bidirectional-interactive-mode`,
`--accept-incomming-comments-as-input`) keep their defaults and
existing behavior so R4 ("must not break any existing features") is
preserved. For non-Claude tools the validator still warns and
disables all four flags — the existing #817 fallback path. Stages 4
(smart restart batching), 5 (resume-aware streaming), and the
integration test with a fake stream-json Claude binary remain as
follow-up work against this case study.

## Verification

- `npm run lint` — clean.
- `npm test` — full default suite passes (no behavioral changes to
  `watchUntilMergeable` yet at this stage).
- New regression test
  `tests/test-auto-input-until-mergeable-1708.mjs` — 44 assertions
  covering: flag presence/default, the three composition rules
  (`--auto-input-until-mergeable` → accept + queue,
  `--accept-incomming-comments-as-input` standalone → stream,
  `--bidirectional-interactive-mode` → cascade unchanged), explicit
  user toggles preserved, queue-wins-over-stream tiebreaker,
  non-Claude-tool fallback, and the "no flag = no-op" R4 contract.
- `tests/test-bidirectional-interactive.mjs` — 43/43 existing
  assertions pass (no regressions in the #817 flag composition).

## References

- Existing related PRs/issues:
  - #817 Bidirectional interactive mode (provides the streaming pipe).
  - #1190 Refactor of auto-merge into `solve.auto-merge.lib.mjs`.
  - #1323, #1356, #1567, #1571, #1645 — auto-restart counter, usage
    limits, comment ordering, ready-to-merge dedup. The solution plan
    must not regress any of these.
- External:
  - Anthropic Agent SDK docs:
    [https://code.claude.com/docs/en/agent-sdk](https://code.claude.com/docs/en/agent-sdk).
  - Codex CLI non-interactive mode:
    [https://developers.openai.com/codex/noninteractive](https://developers.openai.com/codex/noninteractive).
