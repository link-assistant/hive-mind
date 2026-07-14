# Issue 2057 Case Study: Live input without restart or resume

- **Issue:** [link-assistant/hive-mind#2057](https://github.com/link-assistant/hive-mind/issues/2057)
- **Pull request:** [#2061](https://github.com/link-assistant/hive-mind/pull/2061)
- **Related implementation:** [#1709](https://github.com/link-assistant/hive-mind/pull/1709), [#2008](https://github.com/link-assistant/hive-mind/pull/2008)
- **Research date:** 2026-07-14

## Executive conclusion

Claude and Codex both support receiving additional input without restarting the
tool process or resuming a saved conversation, but Hive Mind currently wires
that capability only for Claude (and Agent):

| Tool        | Upstream capability                                                                                        | Hive Mind today                                                                  | Meets the issue now? |
| ----------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------- |
| Claude Code | Persistent `stream-json` stdin; multiple user messages in one process/session                              | `--auto-input-until-mergeable` keeps stdin open and sends/queues feedback frames | **Yes**              |
| Codex       | App-server `turn/steer` adds input to an in-flight turn; `turn/start` adds a later turn to the same thread | `codex exec --json`; new feedback uses the restart/resume fallback               | **No**               |

The gap is therefore not an upstream Codex limitation. It is a runner mismatch.
`codex exec` is the correct one-shot automation interface but is not a live
input protocol. Hive Mind needs a Codex app-server runner to satisfy the same
process/no-resume requirement for Codex.

No new public option is required. The existing opt-in
`--auto-input-until-mergeable` should retain its meaning and select the best
live transport for each tool. Once the Codex runner is implemented, Codex can
move from `fallback` to `stream` in `src/live-input-capabilities.lib.mjs`.

## Artifacts

- [`raw/issue-2057.json`](./raw/issue-2057.json) — issue metadata and body
- [`raw/issue-comments.json`](./raw/issue-comments.json) — all issue comments
- [`raw/pr-2061.json`](./raw/pr-2061.json) — initial pull request metadata
- [`raw/pr-conversation-comments.json`](./raw/pr-conversation-comments.json)
- [`raw/pr-review-comments.json`](./raw/pr-review-comments.json)
- [`raw/pr-reviews.json`](./raw/pr-reviews.json)
- [`research/research-sources.json`](./research/research-sources.json) — online and repository sources
- [`research/capability-matrix.md`](./research/capability-matrix.md) — protocol-level comparison
- [`research/local-verification.md`](./research/local-verification.md) — installed CLI/schema evidence

The issue and all three PR feedback endpoints contained no comments or reviews
at the start of this study.

## What “same session” means

The phrase is ambiguous unless three levels are separated:

1. **Same operating-system process** — no CLI process exit/spawn.
2. **Same provider conversation** — Claude session or Codex thread identity and
   context are preserved.
3. **Same active model turn** — feedback changes work already in flight instead
   of waiting for the next turn.

Issue #2057 explicitly requires levels 1 and 2: “the same session with no auto
restart at all.” Codex `turn/steer` also supplies level 3. Claude's stream-json
pipe supplies levels 1 and 2; in Hive Mind's default queue mode, feedback waits
for Claude's `result` event and becomes the next user turn in the same process.
Immediate stream mode can write while Claude is busy, but callers should not
assume that a write cancels work already in progress.

Starting a new turn on an already-running app-server thread is not a restart or
resume. Resuming means loading a prior persisted thread after the runner has
ended; this design keeps both server and thread alive.

## Requirements traceability

| ID  | Requirement extracted from #2057                             | Finding / plan                                                                                                                             | Status                          |
| --- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| R1  | Check whether Claude fully supports same-session input       | Claude Code documents realtime `stream-json` input; Hive Mind already holds stdin open and sends multiple user frames                      | Answered                        |
| R2  | Check whether Codex fully supports same-session input        | Codex app-server documents `turn/steer` for an active turn and `turn/start` for another turn on the same thread                            | Answered                        |
| R3  | Send input about uncommitted changes interactively           | The existing status poller already detects worktree changes and formats feedback; transport is live for Claude and fallback-only for Codex | Partial today; Codex plan below |
| R4  | Do not auto-restart                                          | Claude meets this; Codex must replace `codex exec` with a persistent app-server process while live input is enabled                        | Planned                         |
| R5  | Do not auto-resume                                           | Claude meets this; Codex must keep the original app-server thread in memory and use `turn/steer`/`turn/start`                              | Planned                         |
| R6  | Collect repository data under `docs/case-studies/issue-2057` | Raw issue/PR/feedback snapshots are included                                                                                               | Complete                        |
| R7  | Perform deep analysis with online research                   | Official OpenAI, Anthropic, JSON-RPC, and Node sources were checked and recorded                                                           | Complete                        |
| R8  | List every requirement and propose solutions/plans           | This table and “Recommended solution” cover every extracted requirement                                                                    | Complete                        |
| R9  | Check existing components/libraries                          | Existing Hive Mind transports, native Node streams, app-server, and optional JSON-RPC libraries are compared below                         | Complete                        |
| R10 | Complete the requested study in PR #2061                     | All research artifacts and conclusions are contained in this PR                                                                            | Complete                        |

## Current repository behavior

### Shared event detection already exists

`--auto-input-until-mergeable` enables the bidirectional handler's status
poller. It watches:

- Git worktree/uncommitted-change snapshots;
- CI failures and merge blockers;
- pull request metadata;
- issue title and description metadata;
- issue and pull request conversation comments; and
- inline pull request review comments.

Those sources are not the missing part of #2057. The missing part is the Codex
delivery transport.

### Claude path

`src/claude.lib.mjs` starts Claude with `--input-format stream-json`, pipes
stdin, and passes incoming events to the bidirectional handler. The handler can
either:

- stream a user frame as soon as it detects feedback; or
- queue the frame until a Claude `result` event indicates that the current turn
  is idle (the default for `--auto-input-until-mergeable`).

Both modes keep one Claude process and one Claude session. Queue mode is safer
for uncommitted-change notifications because it avoids changing instructions in
the middle of a file mutation while still avoiding restart/resume.

### Codex path

`src/codex.lib.mjs` invokes `codex exec --json` for a new run and
`codex exec resume` for later feedback. It parses output events such as
`thread.started`, `turn.completed`, and `item.completed`, but it does not keep a
request channel to the running process. Piped stdin is consumed as initial
context, not as subsequent user turns.

`src/live-input-capabilities.lib.mjs` consequently marks Codex as `fallback`.
`validateBidirectionalModeConfig` leaves live input disabled and relies on
`--auto-restart-until-mergeable`. That is a valid compatibility fallback, but
it is exactly what #2057 wants to avoid.

## Upstream capability findings

### Claude Code

The official CLI reference describes `--input-format stream-json` as realtime
streaming input in print mode. `--replay-user-messages` can acknowledge the user
frames received through stdin. Anthropic's Agent SDK documentation describes
streaming input as a persistent interactive session that preserves context
across messages.

Hive Mind already uses this contract. The installed Claude Code 2.1.207 help
also reports `stream-json` as “realtime streaming input.” No upstream feature
request is needed.

### Codex

The official non-interactive documentation positions `codex exec` as a
pipeline/CI interface. `--json` makes its output a JSONL event stream, while
piped stdin is startup context. It does not document accepting later user turns
through that stdin stream.

Codex app-server is the rich-client integration interface. Its bidirectional
JSON-RPC lifecycle is:

1. `initialize`, followed by the `initialized` notification;
2. `thread/start` (or `thread/resume` only when intentionally loading an old
   thread);
3. `turn/start` with the initial prompt;
4. streamed item and turn notifications; and
5. `turn/steer` with `threadId`, `expectedTurnId`, and `input` while a regular
   turn is active.

`turn/steer` returns the same active turn ID. It does not emit a new
`turn/started`. It rejects stale IDs, a missing active turn, and non-steerable
turn kinds such as review or manual compaction. When the regular turn has
already completed, the client should use `turn/start` on the existing thread,
not restart the server or call `thread/resume`.

The installed Codex CLI 0.144.3 generated schema confirms all three steer
fields are required and that the response contains `turnId`. No upstream
feature request is needed; Hive Mind needs to consume the existing API.

## Options considered

| Option                                 | Same process/thread                                                                           | Same active turn       | Engineering cost               | Decision                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------ | ------------------------------------------------------- |
| Keep restart/resume fallback           | No process continuity; thread can resume                                                      | No                     | None                           | Retain only as compatibility/failure fallback           |
| Write more lines to `codex exec` stdin | Not a documented live-turn channel                                                            | No                     | Low but incorrect              | Reject                                                  |
| Interrupt `codex exec`, then resume    | No process continuity                                                                         | No                     | Existing                       | Reject for #2057                                        |
| Codex app-server over JSONL stdio      | Yes                                                                                           | Yes via `turn/steer`   | Moderate                       | **Recommended**                                         |
| Codex app-server over WebSocket        | Yes                                                                                           | Yes                    | Higher lifecycle/security cost | Useful later for remote runners                         |
| Codex SDK                              | Preserves threads/turns but does not replace the need for a live-steer-aware integration here | Depends on exposed API | Moderate plus dependency       | Re-evaluate if SDK exposes all required events/steering |

### Components and libraries

- **Existing bidirectional handler:** reuse event polling, deduplication,
  queue/stream policy, and lifecycle cleanup. Generalize its Claude-named frame
  formatter to produce transport-neutral text before provider encoding.
- **`codex app-server`:** use the installed official process and generated
  protocol schemas; do not invent a Codex stdin format.
- **Node `child_process.spawn` + `readline`:** already sufficient for JSONL
  stdio and avoids a production dependency. Hive Mind already uses child
  process streams extensively.
- **JSON-RPC libraries (`vscode-jsonrpc`, `jayson`):** can provide correlation,
  cancellation, and error handling, but add dependency weight. A small internal
  client is reasonable if it handles request IDs, server requests,
  notifications, malformed lines, pending-request rejection, and shutdown.
- **WebSocket libraries:** unnecessary for the first local implementation;
  stdio has a smaller security and operational surface.

## Recommended solution

### Phase 1 — transport-neutral live-input adapter

Define a narrow adapter used by the bidirectional handler:

```text
start(initialPrompt) -> session/thread identifiers
sendNow(feedback)    -> steer current turn or send provider frame
sendWhenIdle(feedback)
isBusy()
close()
```

Keep Claude behavior unchanged behind a Claude stream-json adapter. Convert
`formatFeedbackForClaude` into a neutral feedback envelope plus a Claude
encoder, so Codex receives plain app-server `UserInput` rather than
Claude-shaped NDJSON.

### Phase 2 — Codex app-server client

Add a focused client module that:

1. spawns `codex app-server --listen stdio://` with stdin/stdout pipes;
2. performs the initialization handshake;
3. starts exactly one thread and initial regular turn;
4. records authoritative `threadId` and active `turnId` from responses and
   notifications;
5. maps app-server items into the existing Codex result/usage structures;
6. answers or rejects any server request according to the configured approval
   and sandbox policy;
7. correlates responses by JSON-RPC request ID and rejects pending promises if
   the process exits; and
8. terminates the server only when the solve session itself ends.

Do not silently fall back after the app-server has started modifying files. A
mid-run fallback could create two concurrent agents in one worktree. Fail the
session clearly, or prove the app-server process is stopped before resuming.

### Phase 3 — correct steer/queue race handling

For immediate delivery during a regular active turn, send:

```json
{
  "method": "turn/steer",
  "params": {
    "threadId": "<thread>",
    "expectedTurnId": "<active-turn>",
    "input": [{ "type": "text", "text": "<feedback>" }]
  }
}
```

For default queue mode, wait for `turn/completed`, batch/deduplicate pending
events, and call `turn/start` on the same thread. If `turn/steer` loses a race
with completion and returns an invalid-request/stale-turn error, re-check
authoritative state and start the queued follow-up turn on that same thread.
Never respawn app-server or call `thread/resume` for this race.

Use `clientUserMessageId` as an idempotency key derived from the feedback event
signature. This makes retries observable and prevents duplicate operator input.

### Phase 4 — opt-in integration and tests

Keep `--auto-input-until-mergeable` experimental. When `--tool codex` is
selected:

- verify the installed Codex version/schema supports `turn/steer`;
- use app-server live mode when supported;
- use restart/resume only for an unsupported version or explicit compatibility
  setting, with a startup warning; and
- update the capability matrix from `fallback` to `stream` only after the
  integration tests pass.

Required automated coverage:

1. fake JSONL app-server handshake and initial turn;
2. uncommitted-change event -> `turn/steer` with the current IDs;
3. queue mode -> `turn/start` on the same thread after completion;
4. stale-turn race -> same-thread follow-up, no process restart/resume;
5. multiple events -> deterministic batching and deduplication;
6. malformed JSON/server exit -> pending requests rejected and process cleaned
   up;
7. review/manual-compaction turn -> queue until a regular turn is available;
8. approval request behavior under every supported policy; and
9. assertion that no `codex exec resume` or second spawn occurs in live mode.

An optional authenticated smoke test can start app-server, make an uncommitted
change during a deliberately long turn, steer the turn, and assert one process,
one thread, and one accepted active-turn ID. Keep it outside the default suite.

## Risks and safeguards

| Risk                                           | Safeguard                                                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Feedback arrives as a turn completes           | Require `expectedTurnId`; on stale-turn response, use `turn/start` on the same thread                                     |
| Duplicate polling events                       | Stable event signatures plus `clientUserMessageId` and existing processed-comment sets                                    |
| Concurrent writes from fallback and app-server | Single runner ownership; never start fallback until app-server is confirmed stopped                                       |
| Protocol changes                               | Generate/check schemas in tests and gate by capability, not only version text                                             |
| Backpressure or partial JSONL chunks           | Line buffering, bounded queues, write backpressure handling, and maximum frame size                                       |
| Approval requests deadlock                     | Explicit server-request handler and bounded approval timeout                                                              |
| User comment injects untrusted instructions    | Preserve source/author metadata, existing filtering, and clear feedback delimiters                                        |
| Endless same-session context growth            | Observe compaction events; keep app-server/thread alive through automatic compaction and queue during non-steerable turns |

## Acceptance criteria for the future implementation

For both `--tool claude` and `--tool codex` with
`--auto-input-until-mergeable`:

- a worktree change detected during the solve is delivered to the running tool;
- PID/process instance does not change;
- Claude session ID or Codex thread ID does not change;
- no auto-restart or `resume` command is invoked;
- queue mode waits for the current turn and then continues in the same session;
- immediate mode steers when the provider supports active-turn steering;
- delivery is logged with source, event signature, session/thread ID, and
  accepted turn ID, without logging secrets or full sensitive payloads; and
- disabling the experimental option preserves all current behavior.

## Final answer to #2057

- **Claude:** fully supported upstream and already supported in Hive Mind for
  the issue's no-restart/no-resume meaning.
- **Codex:** fully supported upstream through app-server, including stronger
  same-active-turn steering, but not yet supported by Hive Mind's `codex exec`
  runner.
- **Path forward:** reuse `--auto-input-until-mergeable`, add a persistent
  app-server transport, and keep restart/resume only as an explicit
  compatibility fallback.
