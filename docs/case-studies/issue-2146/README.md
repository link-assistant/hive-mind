# Issue 2146: Formal AI full-support follow-up

## Executive summary

The Aug 8 reproduction found three independent defects, not one shared tool failure:

1. Hive Mind built Agent flags as one interpolated string. `command-stream` preserved that string as one argv atom, so Agent did not parse `--model formalai/formal-ai`. Agent logged that it would use its default, selected `opencode/minimax-m2.5-free`, and contacted `https://opencode.ai/zen/v1/messages`. This was the only run that reached a non-Formal-AI provider.
2. Claude and Codex were correctly pointed at a local Formal AI server, but every session reproduced Formal AI issue #904's old plan-only terminal behavior. Because the run used `--no-tool-check`, Hive Mind never recorded the Formal AI version. The exact runtime version is therefore not provable from the logs; the signature strongly indicates a binary older than the v0.326.1 fix.
3. Hive Mind inserted the structured `general_change_plan` result directly into a GitHub Markdown comment. GitHub collapsed the space/tab-indented Lino because it was not fenced.

The fix keeps Agent argv as an array, stops a Formal AI Agent process as soon as it announces another provider, treats idle as state rather than proof that an error recovered, requires Formal AI 0.333.2 at runtime even when preflight checks are disabled, pins every distributed image to that release, logs the active version, and fences structured result blocks before posting them to GitHub.

The five Claude and five Codex auto-restarts were correct. Each completed with no source diff (or only the solver placeholder), so the completion gate retried and eventually failed at its configured 5/5 limit. The restart machinery exposed the deterministic upstream no-op; it did not cause it.

A 22:18 UTC follow-up expanded the scope to idle-only updates, an on-demand Formal AI sidecar, task-only internal networking, persistent memory across stopped containers, and equivalent refresh behavior for every bundled agentic CLI. The current Compose service is permanent, not task-scoped, and Formal AI has no machine-readable persisted-memory upgrade transaction. That prerequisite is reported in [Formal AI #982](https://github.com/link-assistant/formal-ai/issues/982); missing native Docker-network selection is reported separately in non-blocking [start-command #154](https://github.com/link-foundation/start/issues/154). Per issue #2146's pause requirement, PR #2147 remains draft rather than enabling an unsafe health-check-only image replacement.

## Scope and evidence

This study combines:

- [Hive Mind issue #2146](https://github.com/link-assistant/hive-mind/issues/2146), all issue comments, and all three feedback channels on [PR #2147](https://github.com/link-assistant/hive-mind/pull/2147);
- the complete Aug 8 Agent, Claude, and Codex logs attached to the three reproduction PRs;
- the reproduction PR conversation, review-comment, and review feeds;
- the implementation and evidence from [issue #2119](https://github.com/link-assistant/hive-mind/issues/2119), [issue #2130](https://github.com/link-assistant/hive-mind/issues/2130), and recent merged PRs;
- current Agent source/release state and Formal AI issues #848 and #902–#909, releases, and merged fixes.
- the complete 34,667-line solution-draft log attached after the first implementation session, the later lifecycle/update feedback, and the resulting upstream reports.

The complete local inventory and checksums are in [MANIFEST.md](./MANIFEST.md). Raw GitHub snapshots are in [`data/github/`](./data/github/), compressed logs in [`data/tool-logs/`](./data/tool-logs/), and current upstream facts in [`data/upstream-snapshots.json`](./data/upstream-snapshots.json).

No screenshot or image appeared in the issue, comments, or linked PR discussion, so there was no image artifact to download or inspect.

## Requirements reconstructed across the three issues

| Requirement                                                                                                                               | Source            | Aug 8 result                                                                                               | Resolution in PR #2147                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Drive native Claude, Agent, OpenCode, Codex, Qwen, and Gemini through Formal AI without restoring the lossy `formal-ai with` argv wrapper | #2130             | Direct server architecture remained active                                                                 | Preserved; no wrapper rollback                                                                                           |
| Never silently substitute another LLM when Formal AI was requested                                                                        | #2146             | Agent contacted OpenCode Zen                                                                               | Separate argv atoms plus a pre-request provider guard                                                                    |
| Preserve structured stream events, model provenance, tokens, result summary, and terminal failures                                        | #2119/#2130       | Agent model provenance was contradicted by its verbose HTTP trace; Claude/Codex telemetry parsed correctly | Provider drift becomes a terminal error; idle no longer erases errors                                                    |
| Reject false-positive completion when no repository work happened                                                                         | #2119/#2130/#2146 | Claude/Codex correctly restarted and failed after 5/5                                                      | Completion gate retained; stale Formal AI now fails before a run                                                         |
| Make the active Formal AI implementation diagnosable                                                                                      | #2130/#2146       | `--no-tool-check` meant no version appeared in any run                                                     | Unconditional runtime version probe/log and matching image pins                                                          |
| Preserve spaces, tabs, and code-like Formal AI output on GitHub                                                                           | #2146             | Plan records rendered as collapsed prose                                                                   | Structured paragraph is wrapped in a `text` fence                                                                        |
| Keep all incident data and produce a deep case study                                                                                      | #2146             | Evidence existed only across comments/Gists                                                                | All 15 incident logs, the solution log, API snapshots, manifest, timeline, analysis, and upstream reports committed here |
| Report actionable upstream defects with reproduction, workaround, and code-level suggestion                                               | #2146             | Agent knew it was falling back but continued                                                               | Filed [Agent #293](https://github.com/link-assistant/agent/issues/293)                                                   |
| Start Formal AI only while Formal AI tasks exist and stop it when the last task ends                                                      | PR follow-up      | Compose starts the sidecar permanently with `restart: unless-stopped`                                      | Hive-owned implementation pending upstream unblock                                                                       |
| Connect only Formal AI task containers to a private internal Docker network                                                               | PR follow-up      | Tasks receive an outer-Compose URL; start-command has no Docker network option                             | Startup-gate workaround designed; reported [start-command #154](https://github.com/link-foundation/start/issues/154)     |
| Preserve Formal AI memory across tasks, stopped containers, and restarts                                                                  | PR follow-up      | Named volume exists, but no safe candidate-image migration contract                                        | Volume remains; replacement blocked by [Formal AI #982](https://github.com/link-assistant/formal-ai/issues/982)          |
| Pin only the bootstrap Formal AI version and update the sidecar to latest while idle                                                      | PR follow-up      | Images pin 0.333.2; no idle updater exists                                                                 | Blocked until Formal AI exposes compatibility preflight and transactional migration                                      |
| Refresh Claude, Codex, Agent, and other agentic CLIs only while no task is active, or inside each isolated task                           | PR follow-up      | CLIs are fixed at Hive Mind image-build time                                                               | Hive-owned follow-up remains in scope; no upstream Agent defect is required to install `latest`                          |
| Report every missing prerequisite to its upstream repository                                                                              | PR follow-up      | Formal memory-upgrade and start-command network contracts were absent                                      | Filed Formal AI #982 (blocking) and start-command #154 (non-blocking)                                                    |

## Timeline (UTC)

| Time              | Event                                                                                                                                           | Evidence                                                                                                                                                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 15:24:18          | Agent work session starts                                                                                                                       | [Agent PR comment](https://github.com/konard/test-hello-world-019fb330-00e1-73b9-955e-f357a1600d5b/pull/2#issuecomment-5226751979)                                                                                                                               |
| 15:24:26          | Hive Mind's displayed command looks correct: `agent --model formalai/formal-ai --verbose`                                                       | Agent log line 324                                                                                                                                                                                                                                               |
| 15:24:29          | Agent reports one argv atom containing all flags, `cliModelArg` missing, and yargs defaulting to `opencode/minimax-m2.5-free`                   | Agent log lines 448–478                                                                                                                                                                                                                                          |
| 15:24:29          | Agent emits a `CRITICAL` record saying the requested model will not be used, then resolves the OpenCode model                                   | Agent log lines 478–488                                                                                                                                                                                                                                          |
| 15:24:32          | Agent sends the prompt to `https://opencode.ai/zen/v1/messages`; the API rejects the unsupported model                                          | Agent log line 1692 onward                                                                                                                                                                                                                                       |
| 15:24:32          | Agent emits idle/exiting state and Hive Mind logs a false “recovered” message, although the run remains failed through post-hoc error detection | Agent log lines 3036 onward                                                                                                                                                                                                                                      |
| 15:24:38          | GitHub correctly receives an Agent failure, but its static model report still says Formal AI                                                    | [Agent failure](https://github.com/konard/test-hello-world-019fb330-00e1-73b9-955e-f357a1600d5b/pull/2#issuecomment-5226753134)                                                                                                                                  |
| 15:30:09          | Claude work session starts against Formal AI                                                                                                    | [Claude start](https://github.com/konard/test-hello-world-019fb330-fa49-7c9d-a664-b7ea33bb698a/pull/2#issuecomment-5226776090)                                                                                                                                   |
| 15:30:35          | Initial Claude session only reports `pwd`; Hive Mind accurately says the PR still has no changes                                                | [Claude initial summary](https://github.com/konard/test-hello-world-019fb330-fa49-7c9d-a664-b7ea33bb698a/pull/2#issuecomment-5226777869)                                                                                                                         |
| 15:32:54–15:43:55 | Five Claude restarts all report the same `general_change_plan`; each no-diff gate triggers the next restart                                     | [First plan summary](https://github.com/konard/test-hello-world-019fb330-fa49-7c9d-a664-b7ea33bb698a/pull/2#issuecomment-5226788515), [fifth](https://github.com/konard/test-hello-world-019fb330-fa49-7c9d-a664-b7ea33bb698a/pull/2#issuecomment-5226829519)    |
| 15:37:01          | Codex work session starts in parallel against Formal AI                                                                                         | [Codex start](https://github.com/konard/test-hello-world-019fb331-c107-78c7-8ff6-9f127a3c593c/pull/2#issuecomment-5226803918)                                                                                                                                    |
| 15:39:17–15:52:27 | Initial Codex session and five restarts return the same plan-only result; placeholder/no-source-change gate keeps rejecting completion          | [Initial Codex summary](https://github.com/konard/test-hello-world-019fb331-c107-78c7-8ff6-9f127a3c593c/pull/2#issuecomment-5226812621), [fifth](https://github.com/konard/test-hello-world-019fb331-c107-78c7-8ff6-9f127a3c593c/pull/2#issuecomment-5226863061) |
| 15:46:07          | Claude stops at the configured 5/5 limit                                                                                                        | [Claude limit](https://github.com/konard/test-hello-world-019fb330-fa49-7c9d-a664-b7ea33bb698a/pull/2#issuecomment-5226838335)                                                                                                                                   |
| 15:54:39          | Codex stops at the configured 5/5 limit                                                                                                         | [Codex limit](https://github.com/konard/test-hello-world-019fb331-c107-78c7-8ff6-9f127a3c593c/pull/2#issuecomment-5226871788)                                                                                                                                    |
| 16:35:53          | The remaining upstream fail-open behavior is reported with reproduction, workaround, expected behavior, and suggested patch/test                | [Agent #293](https://github.com/link-assistant/agent/issues/293)                                                                                                                                                                                                 |
| 18:05:17          | The first solution session finishes, uploads its complete sanitized 34,667-line log, and records the then-green final-head CI                   | [Solution-draft log comment](https://github.com/link-assistant/hive-mind/pull/2147#issuecomment-5227417131)                                                                                                                                                      |
| 22:18:11          | Maintainer requests on-demand Formal AI lifecycle, task-only networking, durable memory, idle updates, and equivalent agentic-CLI refresh       | [PR follow-up](https://github.com/link-assistant/hive-mind/pull/2147#issuecomment-5228459541)                                                                                                                                                                    |
| 22:30:04          | Missing unattended persisted-memory compatibility/migration transaction is reported upstream as a blocker                                       | [Formal AI #982](https://github.com/link-assistant/formal-ai/issues/982)                                                                                                                                                                                         |
| 22:31:40          | Missing native Docker network selection is reported to start-command with the startup-gate workaround                                           | [start-command #154](https://github.com/link-foundation/start/issues/154)                                                                                                                                                                                        |
| 22:32:17          | The ownership split and pause are recorded on both the issue and draft PR                                                                       | [Issue status](https://github.com/link-assistant/hive-mind/issues/2146#issuecomment-5228508712), [PR status](https://github.com/link-assistant/hive-mind/pull/2147#issuecomment-5228508716)                                                                      |

## Root cause 1: Agent flags were one argv atom

The command shown in the log is deceptive:

```text
agent --model formalai/formal-ai --verbose
```

Hive Mind constructed this suffix as one JavaScript string:

```js
let agentArgs = `--model ${mappedModel}`;
agentArgs += ' --verbose';
execCommand = commandRunner`${toolInvocation.command} ${agentArgs}`;
```

`command-stream` does not ask a shell to split an interpolated value. It safely preserves the value as one process argument. Agent's own `processArgv` record proves the result:

```json
["/home/box/.bun/bin/bun", "…/@link-assistant/agent/src/index.js", "--model formalai/formal-ai --verbose"]
```

That explains the full sequence without invoking the Bun/yargs theory from Agent's error message:

1. There is no argv element equal to `--model`, so Agent's direct parser returns null.
2. yargs returns its configured default, `opencode/minimax-m2.5-free`.
3. Agent notices the raw joined argv contains `--model ` and logs a critical inconsistency.
4. Agent nevertheless continues with the default provider/model.
5. Three seconds later the verbose HTTP record shows a POST to OpenCode Zen.

The reusable experiment [`experiments/issue-2146-agent-argv-shape.mjs`](../../../experiments/issue-2146-agent-argv-shape.mjs) runs a harmless argv-printing child under command-stream:

```text
string interpolation: ["--model formalai/formal-ai --verbose"]
array interpolation:  ["--model","formalai/formal-ai","--verbose"]
```

### Local correction

`buildAgentArgs` returns an array from the beginning, including resume and stream-json flags. That array is interpolated directly for execution. A separate shell-quoting formatter exists only for the human-readable dry-run command, so display concerns cannot change the process shape.

### Defense in depth

Hive Mind also watches the Agent stream while Formal AI is selected. Either of these pre-request records is terminal:

- Agent's critical “requested model will NOT be used” parser record;
- a resolved `providerID/modelID` other than `formalai/formal-ai`.

Hive Mind sends `SIGTERM` immediately and reports `AgentModelRoutingMismatch`. This protects the provider boundary if Agent's parser or a future caller regresses.

The guard is intentionally limited to Formal AI Agent sessions. It does not rewrite or reject ordinary Agent model selection.

## Root cause 2: Agent knowingly failed open

The caller created the malformed argv, but Agent owned the unsafe continuation. At the Aug 8 source head, `js/src/cli/model-config.js:68-90`:

- detects a raw `--model` marker;
- knows both parsers returned the default;
- says the requested model will not be used;
- logs only, then proceeds into provider/model resolution.

Agent 0.25.7 had already added a structured/non-zero path for fatal startup errors, so the correct upstream repair is to enter that path here before initializing a provider. [Agent #293](https://github.com/link-assistant/agent/issues/293) includes:

- a Node `spawn` reproduction with the intentionally malformed one-atom argv;
- warning that the current reproduction makes a real default-provider request;
- the distinct-argv workaround for Node and command-stream;
- a code-level fix location and an integration-test proposal asserting no provider transport call.

## Root cause 3: `session.idle` was treated as recovery

The Agent trace emits terminal API errors, then state disposal/idle/exiting records and exits zero. Hive Mind set `agentCompletedSuccessfully` for `session.idle` and the “exiting loop” log, producing:

```text
Agent recovered from earlier error and completed successfully
```

Post-hoc JSON error detection still failed this particular run, so GitHub did not receive a false success. The recovery log and policy were nevertheless wrong: idle means the loop is waiting or disposed, not that the last model step succeeded.

The corrected policy separates two concepts:

- idle events update bidirectional input state;
- only `step_finish` with `reason: stop` or an explicit successful `result` can prove a preceding error was recovered.

This preserves issue #1276/#1296's legitimate retry recovery while preventing issue #2146's terminal 401 from being erased.

## Root cause 4: a stale Formal AI runtime could bypass preflight

Claude and Codex did not route to the wrong provider. Their logs show the local Formal AI environment, endpoint, model name, tokens, and repeated structured response. The repeated response is the important signature:

```text
Recorded and verified the bounded repository work-item plan …

general_change_plan
  …
  step 1
    capability "Write"
    action "append the bounded repository work-item plan to .formal-ai/general-change-plan.lino"
  step 2
    capability "Run"
    command "cat .formal-ai/general-change-plan.lino"
```

It writes only its own plan, reads that plan, and reports the repository work item as handled. This is the exact defect described in [Formal AI #904](https://github.com/link-assistant/formal-ai/issues/904).

Formal AI [v0.326.1](https://github.com/link-assistant/formal-ai/releases/tag/v0.326.1), published Aug 4, changed that behavior: a plan-only repository item must terminate as `planned_not_executed` with “Planned, not executed,” and the goal must come from the actual `Issue to solve:`/`Task:`/`Goal:` request. Neither `planned_not_executed` nor “Planned, not executed” occurs in the Aug 8 Claude/Codex logs.

This is strong version-signature evidence, but it is not direct version evidence. The invocation included `--no-tool-check`, and before this fix Formal AI's version was only read during optional validation. The log records no version. Other explanations, such as an unversioned development binary that retained the old behavior, cannot be ruled out.

### Why 0.333.2 is the supported floor

Hive Mind now requires Formal AI >= 0.333.2 during optional connection validation and, independently, at the point where it prepares the runtime. Disabling preflight cannot bypass the runtime gate. This is stricter than the minimum #904 fix because 0.333.2 is the latest Aug 8 release and also includes the tool-result/verification guarantees from #905 needed for honest repository completion.

The root, DinD, Formal-AI-service, and Coolify images previously pinned 0.317.0. Leaving those pins in place would make every shipped image fail the new runtime contract, so all four now install the same 0.333.2 baseline. The existing all-tools/image uniformity test imports the runtime's version constant, preventing the two policies from drifting again.

The runtime:

1. runs the resolved `HIVE_MIND_FORMAL_AI_PATH --version` before creating a server or native CLI;
2. rejects a missing, malformed, or lower version with an upgrade instruction;
3. always logs `Formal AI: version … (minimum 0.333.2)`;
4. exposes the version on the returned runtime object for diagnostics.

The check also applies with a configured persistent endpoint because Hive Mind still uses the local Formal AI binary to obtain and materialize the native client's provider configuration.

## Root cause 5: structured output crossed GitHub's Markdown boundary raw

The AI summary body is not inherently Markdown-safe. Formal AI returned Lino with leading spaces and embedded tabs, but `attachSolutionSummary` only redacted workspace paths and concatenated the text into the comment. Two-space indentation is not a Markdown code block, so GitHub collapsed the plan's structure.

Formatting now occurs at the final publication boundary, after redaction. A multi-line structured paragraph following a lead-in that ends in `:` is wrapped in:

````markdown
```text
general_change_plan
  id "…"
  …
```
````

The formatter is idempotent, leaves existing backtick/tilde fences alone, and leaves ordinary Markdown unchanged.

## Auto-restart and completion analysis

The restart behavior satisfies the earlier correctness requirements:

- Claude's PR remained net-empty.
- Codex's PR contained only the placeholder used to open the PR.
- Each summary explicitly warned that nothing was implemented.
- Each restart reason named the empty/placeholder-only diff.
- Both stopped after exactly five configured restart iterations.
- Both final errors named the remaining no-change blocker.

Increasing the retry count would only spend more time reproducing the same deterministic Formal AI plan. Version fail-fast is the useful correction; changing the restart limit is not.

The Agent run did not auto-restart because its initial tool execution failed immediately. That is also correct: no mergeability loop should reinterpret a terminal model/provider failure as a no-diff iteration.

## Post-review container lifecycle and update analysis

### Current lifecycle does not meet the follow-up

The root `docker-compose.yml` declares Formal AI as an always-on sibling service. Hive Mind depends on its health, both services join `formal-ai-network`, and the sidecar uses `restart: unless-stopped`. Docker-isolated work sessions are created in the Hive Mind container's Docker daemon, so they cannot join that outer Compose network. `resolveFormalAiIsolationEnv` currently resolves the Compose hostname to an address and passes the address into the task instead.

The task launcher already has the synchronization primitive needed for a safe correction: a new Docker task waits behind a per-session filesystem gate. Hive Mind captures the writable-layer baseline and releases the gate only afterward. It can therefore attach the still-gated task container to an internal Formal AI network before any agent process starts. start-command 0.30.3 cannot express the network on its own (`--network` is rejected as an unknown wrapper option), but `docker network connect <network> <session-id>` is a safe downstream workaround while the gate remains closed.

### Required Hive Mind invariants

The future implementation must make these properties testable rather than relying on queue state alone:

1. A Formal AI task is identified from the task's parsed model, not merely its selected CLI tool.
2. The sidecar and its private `--internal` network are created before the first Formal AI task gate is released.
3. Only task containers whose model is Formal AI join that network; the server is not published to the host or unrelated task networks.
4. Concurrent Formal AI launches share one sidecar and hold an explicit lifecycle lease. The sidecar stops only after the last live Formal AI task releases its lease.
5. Startup reconciliation derives truth from Docker container/network state as well as the durable session store, so a Hive Mind process restart cannot stop a sidecar still serving a detached task.
6. The memory named volume is never removed by ordinary task cleanup, sidecar stop, candidate failure, or rollback.
7. An image pull, CLI refresh, or migration begins only after a fresh liveness check proves no relevant task is executing; a task launch and an update are serialized by the same lock.
8. A candidate digest is health-checked and memory-validated before task gates can use it. Failure restores the previous digest and an exact verified memory backup.
9. Verbose logs record old/new digests, binary versions, schema compatibility, backup identity, migration receipt, rollback result, lease count, and network membership, with updater behavior off until the compatibility contract exists.

### Why `/health` plus a file copy is insufficient

Formal AI 0.333.2 describes normal memory writes as append-only and deliberately accepts older records without newer optional fields. It also provides full memory/bundle export and import. Those are strong recovery primitives, but they do not define future-version behavior:

- `/health` reports the process version but does not inspect the configured memory file or expose its schema;
- the current migration helper compares imported seed versions and returns human-readable review advice after import;
- no side-effect-free command reports candidate compatibility with the on-disk file;
- no explicit command locks writers, creates/verifies a backup, atomically commits a migration, emits a receipt, and defines downgrade behavior.

Starting `latest` against the production volume and treating a healthy HTTP response as proof would therefore be a false-positive migration check. [Formal AI #982](https://github.com/link-assistant/formal-ai/issues/982) contains the named-volume reproduction, conservative pin/backup/copy workaround, proposed JSON preflight, transaction requirements, and compatibility/interruption/idempotence/rollback tests. It is the blocking prerequisite identified by issue #2146's mandatory pause rule.

### Agentic CLI updates

The Hive Mind, DinD, and Coolify images install Claude through its native installer and install Codex, Agent, Gemini, Qwen, Copilot, and OpenCode as global Bun packages. Those versions are snapshots from image-build time. Updating the parent container in place would not update already-built Docker isolation images, while updating each fresh task after its gate is released would spend task time and allow concurrent version drift.

The updater therefore remains a Hive Mind orchestration concern: build or materialize a versioned candidate runtime only while globally idle, probe every CLI and its configuration contract, publish the candidate atomically for subsequent tasks, retain the last known-good runtime, and keep credentials/configuration in their existing persistent mounts rather than baking them into the candidate. Agent already has a normal published package update path, so there is no separate Agent upstream defect to report for installation. Provider-specific atomic update/rollback details must be designed and tested when work resumes after Formal AI #982.

### Attached solution-draft log

The later Gist is the complete first implementation session, not another model-routing reproduction. It has 34,667 lines covering 16:13:53–18:05:17 UTC. Its terminal section records 380 passing local test files, passing lint/format/duplication/compilation/line-limit checks, successful final-head CI run 31270565413, a clean tree, and the original ready-for-review transition. It is retained because the new feedback arrived after that session and explains why the formerly ready PR returned to draft; it introduces no additional pre-feedback root cause.

## Upstream research

As of the 2026-08-08 snapshot, Formal AI #902–#909 were closed. Their relevance and the downstream posture are:

| Upstream item                                                                                                                    | Finding                                                             | Hive Mind posture                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [#848](https://github.com/link-assistant/formal-ai/issues/848)                                                                   | Coding ladder originally found no level where agent mode wrote code | Historical capability baseline; completion remains evidence-gated                      |
| [#902](https://github.com/link-assistant/formal-ai/issues/902)                                                                   | Codex provider overrides were lost around `exec`/caller `-c` flags  | Native CLI + direct endpoint avoids wrapper argv ownership                             |
| [#903](https://github.com/link-assistant/formal-ai/issues/903)                                                                   | `formal-ai with` rewrote/dropped native argv                        | Wrapper remains prohibited by regression tests                                         |
| [#904](https://github.com/link-assistant/formal-ai/issues/904)                                                                   | Plan file + self-`cat` was reported as completed repository work    | Runtime requires a release newer than its v0.326.1 fix                                 |
| [#905](https://github.com/link-assistant/formal-ai/issues/905) / [PR #927](https://github.com/link-assistant/formal-ai/pull/927) | Failed writes and failed verification could still yield success     | 0.333.2 floor includes tool-result evidence fix; Hive also checks diff/CI              |
| [#906](https://github.com/link-assistant/formal-ai/issues/906)                                                                   | Language router extracted words such as “the” as language names     | Fixed upstream; preserved in incident snapshot                                         |
| [#907](https://github.com/link-assistant/formal-ai/issues/907)                                                                   | Caller/session framing hijacked intent routing                      | Fixed upstream; direct request still retains completion evidence gate                  |
| [#908](https://github.com/link-assistant/formal-ai/issues/908)                                                                   | Verification ignored exit status in both directions                 | Fixed upstream; 0.333.2 and Hive diff/CI checks provide layered evidence               |
| [#909](https://github.com/link-assistant/formal-ai/issues/909)                                                                   | Global Gemini/Qwen config omitted headless auth selection           | Closed after 0.333.2; Hive already supplies explicit Gemini settings and Qwen auth env |

The latest Formal AI release when captured was [v0.333.2](https://github.com/link-assistant/formal-ai/releases/tag/v0.333.2) from Aug 6. Formal AI `main` had advanced on Aug 7 but still declared `0.333.2`, which is why Hive Mind does not assume an unreleased #909 change is present. It keeps the explicit headless-client compatibility settings from issue #2130.

The latest Agent release was [0.25.7](https://github.com/link-assistant/agent/releases/tag/js-v0.25.7). Its release fixed other fatal startup errors, but current `main` still retained the fail-open parser branch, justifying the new focused report rather than reopening the broad closed #239.

## Solutions considered

### Restore `formal-ai with`

Rejected. Issues #902/#903 and the issue #2130 experiments show that the wrapper owns, reorders, or consumes native CLI flags and prompts. It cannot express Hive Mind's stream format, resume, system prompt, MCP, and headless requirements reliably. The direct server architecture is the supported foundation.

### Split the existing string at spaces

Rejected. Resume identifiers and future values can contain spaces or shell-significant characters. Constructing argv as semantic atoms is simpler and correct.

### Trust Agent's displayed/requested model report

Rejected. The incident printed “requested/actual formal-ai” while the verbose transport proved OpenCode was used. Provider resolution and network destination are stronger evidence. The new guard observes the resolved provider before the request.

### Warn about old Formal AI and continue

Rejected. Five deterministic no-op retries demonstrate that a warning does not protect correctness or cost. Unknown/stale runtimes now fail before model work.

### Require only Formal AI 0.326.1

Not selected. That release fixes #904, but #2119/#2130 require the later tool-result verification work. Version 0.333.2 is the first released baseline that contains the full relevant evidence guarantees evaluated here.

### Fence the entire AI summary

Rejected. Whole-summary fencing would destroy legitimate headings, links, lists, and emphasis. The formatter targets the structured paragraph while preserving ordinary Markdown and already fenced content.

## Implementation map

| Component                                     | Responsibility                                                                                                    |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/agent-command.lib.mjs`                   | Pure argv construction, safe display rendering, idle/strong-completion policy, Formal AI provider-drift detection |
| `src/agent.lib.mjs`                           | Execute array argv, stop on routing mismatch, retain strong completion semantics                                  |
| `src/formal-ai-version.lib.mjs`               | Version parsing, non-throwing probe, supported-version assertion                                                  |
| `src/formal-ai-runtime.lib.mjs`               | Unconditional version check/log before server or client configuration                                             |
| Four distributed Dockerfiles                  | Install the same Formal AI version required by runtime policy                                                     |
| `src/formal-ai.lib.mjs`                       | Reuse the shared version reader for optional connection validation                                                |
| `src/working-session-summary.lib.mjs`         | Idempotent structured-text fencing                                                                                |
| `src/solve.results.lib.mjs`                   | Apply redaction and formatting at the GitHub comment boundary                                                     |
| `tests/test-issue-2146-formal-ai-support.mjs` | Minimal regression for argv, provider guard, completion policy, version floor, and Markdown                       |
| `tests/test-issue-2130-formal-ai-runtime.mjs` | Runtime rejects a stale binary before the server starts                                                           |

## Reproduction and verification

The test was added before the implementation. Its first execution failed with `ERR_MODULE_NOT_FOUND` for the not-yet-created `src/agent-command.lib.mjs`, establishing a red baseline.

Focused verification:

```bash
node tests/test-issue-2146-formal-ai-support.mjs
node tests/test-issue-2130-formal-ai-runtime.mjs
node tests/test-working-session-summary-2119.mjs
node tests/test-agent-error-detection.mjs
node experiments/issue-2146-agent-argv-shape.mjs
```

The runtime test injects version `0.326.0` and a server spy. It asserts the actionable >=0.333.2 error and that the server spy was never called. No real model request is needed.

The issue-specific test asserts:

- exact distinct argv atoms, including a resume value with spaces;
- mismatched OpenCode selection is terminal while `formalai/formal-ai` is accepted;
- `session.idle` is not strong completion;
- valid/current, stale, and unknown Formal AI versions;
- an observed Formal AI plan becomes a `text` fence;
- formatting is idempotent and normal/existing-fenced Markdown is unchanged.

## Remaining limits

- Hive Mind can verify the local binary version and client routing, but the current Formal AI server protocol does not expose a separate remote build version. With `HIVE_MIND_FORMAL_AI_BASE_URL`, the local binary used for config is verified; operators remain responsible for keeping the remote server compatible.
- The Agent provider guard relies on the current structured model-resolution log. Correct argv is the primary guarantee; the guard is independent defense in depth.
- Version comparison accepts standard `major.minor.patch[-prerelease]` forms. Formal AI's published versions use this shape.
- This PR does not claim Formal AI will solve every repository task. It ensures old known-no-op behavior, unauthorized provider fallback, and false terminal signals do not masquerade as a supported run.
