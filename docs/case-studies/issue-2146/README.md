# Issue 2146: Formal AI full-support follow-up

## Executive summary

The Aug 8 reproduction found three independent defects, not one shared tool failure:

1. Hive Mind built Agent flags as one interpolated string. `command-stream` preserved that string as one argv atom, so Agent did not parse `--model formalai/formal-ai`. Agent logged that it would use its default, selected `opencode/minimax-m2.5-free`, and contacted `https://opencode.ai/zen/v1/messages`. This was the only run that reached a non-Formal-AI provider.
2. Claude and Codex were correctly pointed at a local Formal AI server, but every session reproduced Formal AI issue #904's old plan-only terminal behavior. Because the run used `--no-tool-check`, Hive Mind never recorded the Formal AI version. The exact runtime version is therefore not provable from the logs; the signature strongly indicates a binary older than the v0.326.1 fix.
3. Hive Mind inserted the structured `general_change_plan` result directly into a GitHub Markdown comment. GitHub collapsed the space/tab-indented Lino because it was not fenced.

The fix keeps Agent argv as an array, stops a Formal AI Agent process as soon as it announces another provider, refuses to start a Formal AI task on an Agent CLI old enough to fall back to its default model, treats idle as state rather than proof that an error recovered, requires Formal AI 0.336.0 at runtime even when preflight checks are disabled, pins every distributed image to the current 0.337.0 release, logs the active version, and fences structured result blocks before posting them to GitHub.

The five Claude and five Codex auto-restarts were correct. Each completed with no source diff (or only the solver placeholder), so the completion gate retried and eventually failed at its configured 5/5 limit. The restart machinery exposed the deterministic upstream no-op; it did not cause it.

A 22:18 UTC follow-up expanded the scope to idle-only updates, an on-demand Formal AI sidecar, task-only internal networking, persistent memory across stopped containers, and equivalent refresh behavior for every bundled agentic CLI. Two prerequisites were missing at that moment and both were reported the same evening: Formal AI had no machine-readable persisted-memory upgrade transaction ([Formal AI #982](https://github.com/link-assistant/formal-ai/issues/982)) and start-command could not select a Docker network ([start #154](https://github.com/link-foundation/start/issues/154)). Per issue #2146's pause requirement the PR stayed in draft until both were answered upstream.

Both are now delivered: Formal AI [PR #985](https://github.com/link-assistant/formal-ai/pull/985) shipped the preflight/migration contract in [0.336.0](https://github.com/link-assistant/formal-ai/releases/tag/v0.336.0), start [PR #155](https://github.com/link-foundation/start/pull/155) shipped `--network`/`--network-alias` in [js-0.31.0](https://github.com/link-foundation/start/releases/tag/js-v0.31.0), and Agent [PR #294](https://github.com/link-assistant/agent/pull/294) shipped the fail-closed `--model` parser in [js-0.25.8](https://github.com/link-assistant/agent/releases/tag/js-v0.25.8). The lifecycle work therefore resumed inside this same PR and is implemented, not deferred: a lease-counted on-demand sidecar on an `--internal` network, an idle-only image update that follows the new memory contract end to end, an idle-only agentic CLI refresh, and a durable memory volume.

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

| Requirement                                                                                                                               | Source            | Aug 8 result                                                                                               | Resolution in PR #2147                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Drive native Claude, Agent, OpenCode, Codex, Qwen, and Gemini through Formal AI without restoring the lossy `formal-ai with` argv wrapper | #2130             | Direct server architecture remained active                                                                 | Preserved; no wrapper rollback                                                                                                                 |
| Never silently substitute another LLM when Formal AI was requested                                                                        | #2146             | Agent contacted OpenCode Zen                                                                               | Separate argv atoms plus a pre-request provider guard                                                                                          |
| Preserve structured stream events, model provenance, tokens, result summary, and terminal failures                                        | #2119/#2130       | Agent model provenance was contradicted by its verbose HTTP trace; Claude/Codex telemetry parsed correctly | Provider drift becomes a terminal error; idle no longer erases errors                                                                          |
| Reject false-positive completion when no repository work happened                                                                         | #2119/#2130/#2146 | Claude/Codex correctly restarted and failed after 5/5                                                      | Completion gate retained; stale Formal AI now fails before a run                                                                               |
| Make the active Formal AI implementation diagnosable                                                                                      | #2130/#2146       | `--no-tool-check` meant no version appeared in any run                                                     | Unconditional runtime version probe/log and matching image pins                                                                                |
| Preserve spaces, tabs, and code-like Formal AI output on GitHub                                                                           | #2146             | Plan records rendered as collapsed prose                                                                   | Structured paragraph is wrapped in a `text` fence                                                                                              |
| Keep all incident data and produce a deep case study                                                                                      | #2146             | Evidence existed only across comments/Gists                                                                | All 15 incident logs, the solution log, API snapshots, manifest, timeline, analysis, and upstream reports committed here                       |
| Report actionable upstream defects with reproduction, workaround, and code-level suggestion                                               | #2146             | Agent knew it was falling back but continued                                                               | Filed [Agent #293](https://github.com/link-assistant/agent/issues/293); fixed upstream and now required at >= 0.25.8                           |
| Start Formal AI only while Formal AI tasks exist and stop it when the last task ends                                                      | PR follow-up      | Compose starts the sidecar permanently with `restart: unless-stopped`                                      | `src/formal-ai-sidecar.lib.mjs` lease counting; last release stops the container                                                               |
| Connect only Formal AI task containers to a private internal Docker network                                                               | PR follow-up      | Tasks receive an outer-Compose URL; start-command has no Docker network option                             | `docker network connect` inside the closed start gate; reported and fixed as [start #154](https://github.com/link-foundation/start/issues/154) |
| Preserve Formal AI memory across tasks, stopped containers, and restarts                                                                  | PR follow-up      | Named volume exists, but no safe candidate-image migration contract                                        | `hive-mind-formal-ai-memory` volume plus the [Formal AI #982](https://github.com/link-assistant/formal-ai/issues/982) migration contract       |
| Pin only the bootstrap Formal AI version and update the sidecar to latest while idle                                                      | PR follow-up      | Images pin 0.333.2; no idle updater exists                                                                 | Images pin the 0.337.0 bootstrap only; `src/formal-ai-updater.lib.mjs` adopts newer digests while idle                                         |
| Refresh Claude, Codex, Agent, and other agentic CLIs only while no task is active, or inside each isolated task                           | PR follow-up      | CLIs are fixed at Hive Mind image-build time                                                               | `src/agentic-cli-updater.lib.mjs` refreshes every bundled CLI only while no task holds the lock                                                |
| Report every missing prerequisite to its upstream repository                                                                              | PR follow-up      | Formal memory-upgrade and start-command network contracts were absent                                      | Filed Formal AI #982 and start #154; both closed as completed and both releases are now consumed here                                          |

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
| 22:45:08 (Aug 8)  | Agent merges the fail-closed `--model` parser; `ModelResolutionError` exits before provider resolution                                          | [Agent PR #294](https://github.com/link-assistant/agent/pull/294)                                                                                                                                                                                                |
| 22:47:45 (Aug 8)  | Agent publishes that fix as js-0.25.8, which becomes Hive Mind's Formal AI floor for the Agent CLI                                              | [js-v0.25.8](https://github.com/link-assistant/agent/releases/tag/js-v0.25.8)                                                                                                                                                                                    |
| 03:28:33 (Aug 9)  | start-command merges `--network`/`--network-alias` for Docker isolation, closing the non-blocking report                                        | [start PR #155](https://github.com/link-foundation/start/pull/155)                                                                                                                                                                                               |
| 03:30:29 (Aug 9)  | start-command publishes js-0.31.0; Hive Mind's images move to that pin                                                                          | [js-v0.31.0](https://github.com/link-foundation/start/releases/tag/js-v0.31.0)                                                                                                                                                                                   |
| 08:38:37 (Aug 9)  | Formal AI merges the persisted-memory upgrade contract that blocked the lifecycle work                                                          | [Formal AI PR #985](https://github.com/link-assistant/formal-ai/pull/985)                                                                                                                                                                                        |
| 09:57:20 (Aug 9)  | Formal AI 0.336.0 publishes the preflight, locked migration, receipts, and `/health` memory block                                               | [v0.336.0](https://github.com/link-assistant/formal-ai/releases/tag/v0.336.0)                                                                                                                                                                                    |
| 12:11:56 (Aug 9)  | Formal AI 0.337.0 becomes the newest release and the bootstrap pin for every distributed image                                                  | [v0.337.0](https://github.com/link-assistant/formal-ai/releases/tag/v0.337.0)                                                                                                                                                                                    |
| Aug 9–10          | With every blocker delivered, the lifecycle, idle updater, agentic CLI refresh, and their regression tests land in this PR                      | `src/formal-ai-sidecar.lib.mjs`, `src/formal-ai-updater.lib.mjs`, `src/agentic-cli-updater.lib.mjs`, `tests/test-issue-2146-*.mjs`                                                                                                                               |

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

Agent adopted exactly that: [PR #294](https://github.com/link-assistant/agent/pull/294) replaced the log-only branch in `js/src/cli/model-config.js` with a named `ModelResolutionError` routed through the existing fatal-startup handler, so the process exits 1 before provider resolution, and its integration test asserts zero requests reach the local provider. The fix is published as [js-0.25.8](https://github.com/link-assistant/agent/releases/tag/js-v0.25.8).

Hive Mind now depends on that guarantee instead of only observing it. `MIN_AGENT_FORMAL_AI_VERSION = '0.25.8'` in `src/agent.lib.mjs` makes `validateAgentConnection` refuse a Formal AI task on any older Agent CLI, before the "hi" probe is sent. The reason is ordering: the streamed-record guard can only react _after_ Agent has decided which model to use, whereas issue #2146 requires that no other model can be reached at all. The distinct-argv construction, the version floor, and the streamed provider guard are three independent layers over the same failure.

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

### Why 0.336.0 is the supported floor and 0.337.0 is the bootstrap pin

Hive Mind requires Formal AI >= 0.336.0 during optional connection validation and, independently, at the point where it prepares the runtime. Disabling preflight cannot bypass the runtime gate. The floor moved twice, for two different reasons:

- 0.333.2 was chosen first because it is stricter than the minimum #904 fix and also carries the tool-result/verification guarantees from #905 needed for honest repository completion;
- 0.336.0 replaced it once the container lifecycle landed. Hive Mind now replaces the Formal AI image while it is idle, so a binary that cannot answer `memory upgrade-status` cannot be validated against the persisted memory at all. An unattended non-destructive upgrade is part of the baseline rather than an optional extra, and 0.336.0 is the first release that provides it.

The two constants are deliberately separate. `FORMAL_AI_MINIMUM_VERSION` is the run-time floor, `FORMAL_AI_MEMORY_CONTRACT_MINIMUM_VERSION` is what the updater requires of a _candidate image_, so a future run-time bump for an unrelated reason still lets the updater say precisely why a candidate was refused. `FORMAL_AI_BOOTSTRAP_VERSION` is a third, weaker thing: the version baked into the images.

The root, DinD, Formal-AI-service, and Coolify images previously pinned 0.317.0, then 0.333.2. Per the PR review, that pin is now only the _initial_ version: all four install 0.337.0, and once the sidecar runs the idle updater replaces it with whatever `HIVE_MIND_FORMAL_AI_UPDATE_TAG` resolves to. The existing all-tools/image uniformity test imports the version constants, preventing the policies from drifting again.

The runtime:

1. runs the resolved `HIVE_MIND_FORMAL_AI_PATH --version` before creating a server or native CLI;
2. rejects a missing, malformed, or lower version with an upgrade instruction;
3. always logs `Formal AI: version … (minimum 0.336.0)`;
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

### The lifecycle the review found, and the one that replaced it

The root `docker-compose.yml` declared Formal AI as an always-on sibling service. Hive Mind depended on its health, both services joined `formal-ai-network`, and the sidecar used `restart: unless-stopped`. Docker-isolated work sessions are created in the Hive Mind container's Docker daemon, so they cannot join that outer Compose network; `resolveFormalAiIsolationEnv` resolved the Compose hostname to an address and passed the address into the task instead. An always-on container also contradicts every clause of the follow-up: it runs when no Formal AI task does, it is never replaced, and its memory lives wherever Compose put it.

The correction reuses a synchronization primitive the task launcher already had: a new Docker task waits behind a per-session filesystem gate while Hive Mind captures the writable-layer baseline, and only then is the gate released. That window is the one moment where a container exists but no agent process has started, so it is where the task is attached to the Formal AI network ([`src/isolation-runner.lib.mjs`](../../../src/isolation-runner.lib.mjs)). `start-command` 0.31.0 can now name a network at launch ([start#154](https://github.com/link-foundation/start/issues/154), [PR #155](https://github.com/link-foundation/start/pull/155)), but `docker run --network` _replaces_ the default bridge, and the Formal AI network is `--internal`; a task launched onto it directly would lose its route to GitHub. Attaching a second network with `docker network connect` inside the closed gate is therefore not a workaround for a missing upstream feature — it is the correct shape, and the upstream feature is used for the sidecar itself rather than for tasks.

### The nine invariants, and where each one is enforced

These are stated as properties rather than steps because each one is asserted by a test against an in-memory Docker daemon ([`tests/formal-ai-docker-simulator.mjs`](../../../tests/formal-ai-docker-simulator.mjs)) — a broken lifecycle is otherwise only visible in production, and its production symptom is exactly the failure issue #2146 forbids: a Formal AI task that starts, cannot reach its model, and continues on another one.

| #   | Invariant                                                                                                                                   | Enforced by                                                                                                                                                                                                                     | Asserted by                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A Formal AI task is identified from the task's parsed model, not from the selected CLI tool.                                                | `isFormalAiTask` reads `--model` out of the task argv as well as an explicit model field.                                                                                                                                       | `isFormalAiTask({args: ['--model', 'formalai/formal-ai']})`, and `--model sonnet` staying false.                                                               |
| 2   | The sidecar and its private `--internal` network exist before the first Formal AI gate is released.                                         | `acquireFormalAiSidecarForTask` runs inside the closed gate and creates network, volume and container before returning a base URL.                                                                                              | The lease test asserts `networks.get(...).internal === true` on the first acquire.                                                                             |
| 3   | Only Formal AI task containers join that network, and nothing is published to the host.                                                     | `buildFormalAiSidecarRunArgs` emits no `-p`/`--publish`; `acquireFormalAiSidecarForTask` returns `{sidecar: null}` for any other model or a non-Docker backend.                                                                 | Run-args assertions plus `acquireCalls === 0` for `sonnet`, `backend: 'none'` and the opt-out.                                                                 |
| 4   | Concurrent launches share one sidecar under explicit leases; it stops after the last one.                                                   | Lease list in `~/.hive-mind/formal-ai-sidecar.json`, keyed on the session UUID that is also the container name.                                                                                                                 | Two acquires → `leaseCount: 2` and exactly one `run --detach`; two releases → `{leaseCount: 0, stopped: true}`.                                                |
| 5   | Reconciliation derives truth from Docker, not only from the durable store.                                                                  | `reconcileFormalAiSidecar` inspects each lease's container: unseen containers get a bounded one-hour launch grace, a container once seen and now gone is stale immediately.                                                     | Four cases: launching, expired grace, crashed, and a long-running task that keeps its lease and is marked `containerSeen`.                                     |
| 6   | The memory volume survives every stop, failure and rollback.                                                                                | `hive-mind-formal-ai-memory` is mounted at `/home/box/.formal-ai`; no code path issues `docker volume rm`.                                                                                                                      | Both suites assert `volumes.has(...)` after the last release and after an update, and `ran(/^volume rm/) === false`.                                           |
| 7   | Pulls, migrations and CLI refreshes begin only when nothing is running, serialized against launches.                                        | `withFormalAiSidecarLock` wraps acquire, release, reconcile and update; the updater re-derives the lease count first and the CLI updater asks the live task list.                                                               | A live lease yields `{status: 'busy'}` without reaching the registry; an active task yields `{status: 'busy'}` before any command runs.                        |
| 8   | A candidate digest is health- and memory-validated before any task can use it; failure restores the previous digest and a verified backup.  | `updateFormalAiSidecarWhenIdle`: pull → `memory upgrade-status` → `memory migrate` → boot candidate → check `/health` `memory.compatible` → stop. Any failure restores `backup_path` and verifies the SHA-256 from the receipt. | The `rolled-back` cases at stage `verify` and stage `preflight-side-effect`, both asserting `{restored: true, verified: true}` and an unchanged `imageDigest`. |
| 9   | Verbose logs record digests, versions, schema compatibility, backup identity, receipt, rollback result, lease count and network membership. | `--verbose` lines in the sidecar, updater and maintenance modules; `lastUpdate` in the state file keeps version, migration id and schema version.                                                                               | State assertions on `lastUpdate.version`, `lastUpdate.migrationId` and `lastUpdate.memorySchemaVersion`.                                                       |

The one deliberate deviation from the original wording of invariant 9 is its final clause. It said updater behavior stays off "until the compatibility contract exists". The contract now exists and ships in Formal AI 0.336.0, so the updater is on by default and is instead disabled by an explicit operator pin (`HIVE_MIND_FORMAL_AI_IMAGE`) or `HIVE_MIND_FORMAL_AI_AUTO_UPDATE=0`.

### Why `/health` plus a file copy was insufficient, and what replaced it

Formal AI 0.333.2 described normal memory writes as append-only and deliberately accepted older records without newer optional fields, and it offered full memory/bundle export and import. Those are strong recovery primitives, but they did not define future-version behavior:

- `/health` reported the process version but did not inspect the configured memory file or expose its schema;
- the migration helper compared imported seed versions and returned human-readable review advice _after_ import;
- no side-effect-free command reported candidate compatibility with the on-disk file;
- no explicit command locked writers, created and verified a backup, atomically committed a migration, emitted a receipt, and defined downgrade behavior.

Starting `latest` against the production volume and treating a healthy HTTP response as proof would therefore have been a false-positive migration check. [Formal AI #982](https://github.com/link-assistant/formal-ai/issues/982) carried the named-volume reproduction, the conservative pin/backup/copy workaround, the proposed JSON preflight, the transaction requirements, and compatibility/interruption/idempotence/rollback tests. Under issue #2146's mandatory pause rule it was the blocking prerequisite, and the lifecycle work stopped there.

It is now delivered. [Formal AI PR #985](https://github.com/link-assistant/formal-ai/pull/985) closed the issue and shipped in [v0.336.0](https://github.com/link-assistant/formal-ai/releases/tag/v0.336.0):

- `formal-ai memory upgrade-status --path <file> --format json` is side-effect free and reports `compatible`, `path_exists`, `migration_required`, `migration_state`, `detected_schema_version`, `target_schema_version`, `migration_id` and `source_sha256`;
- `formal-ai memory migrate --path <file> --backup <file> --receipt <file>` takes the writer lock, writes the backup first, commits atomically, and emits a receipt naming `original_sha256`, `rollback_supported` and `rollback_strategy`;
- `/health` gained a `memory` block with `compatible`, `schema_version`, `migration_required` and `migration_state`, so the candidate is asked about _the memory it was actually given_ rather than about itself.

Hive Mind consumes exactly that contract in [`src/formal-ai-updater.lib.mjs`](../../../src/formal-ai-updater.lib.mjs), including one detail that is easy to get wrong: both commands print their JSON payload on **stdout** and then exit nonzero when they refuse (`src/cli_memory.rs`). A naive runner reduces that to "exit code 1" and loses the reason, so `parseJsonBlock` is applied to the output of a failed command as well, and `describeMemoryRefusal` turns `refusal_code`/`refusal_reason` and the `{error: {code, message}}` migration shape into the surfaced error. Two tests pin those two payload shapes.

Two properties are checked that the contract does not itself promise. The preflight's `source_sha256` is compared against the receipt's `original_sha256`, which catches a preflight that mutated the file — the contract's core promise — and treats it as a rollback-worthy stage of its own. And the candidate is stopped again after verification, because a successful update while idle must leave the host idle rather than deploy the new image.

### Agentic CLI updates

The Hive Mind, DinD, and Coolify images install Claude through its native installer and install Codex, Agent, Gemini, Qwen, Copilot, and OpenCode as global Bun packages. Those versions are snapshots from image-build time. Updating the parent container in place does not update already-built Docker isolation images, while updating each fresh task after its gate is released would spend task time and allow concurrent version drift.

[`src/agentic-cli-updater.lib.mjs`](../../../src/agentic-cli-updater.lib.mjs) resolves this the same way as the image update: it acts only when the live task list is empty, so no running task ever has its toolchain swapped underneath it. Each target is probed with `--version`; a CLI that is not installed in this image is skipped rather than reported as failed; the published version comes from `npm view`; Claude is refreshed with its own `claude update` because the native installer owns its install path, and the Bun-installed CLIs with `bun install -g <package>@latest`. The registry poll is throttled independently of the maintenance tick, since it is the only step that leaves the host.

Two exclusions are asserted rather than merely intended: `@link-assistant/hive-mind` is never a target, because the bot would be replacing the package that owns its own running process, and `start-command` is never a target, because its version is pinned by the Dockerfile and is part of the image contract. `HIVE_MIND_AGENTIC_CLI_UPDATE_ONLY` and `HIVE_MIND_AGENTIC_CLI_UPDATE_EXCLUDE` narrow the set, and `HIVE_MIND_AGENTIC_CLI_AUTO_UPDATE=0` disables it.

All three duties run from one tick in [`src/formal-ai-maintenance.lib.mjs`](../../../src/formal-ai-maintenance.lib.mjs), in the only safe order: reconcile-and-stop first (both other steps require an idle host, and a crashed task would otherwise pin the sidecar forever), then the image update while the sidecar is stopped, then the CLI refresh. Every step is best-effort and reported, because maintenance must never take the bot down.

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

The latest Formal AI release when the incident was captured was [v0.333.2](https://github.com/link-assistant/formal-ai/releases/tag/v0.333.2) from Aug 6. Formal AI `main` had advanced on Aug 7 but still declared `0.333.2`, which is why Hive Mind did not assume an unreleased #909 change was present. It keeps the explicit headless-client compatibility settings from issue #2130.

The latest Agent release at that moment was [0.25.7](https://github.com/link-assistant/agent/releases/tag/js-v0.25.7). Its release fixed other fatal startup errors, but `main` still retained the fail-open parser branch, justifying a new focused report rather than reopening the broad closed #239.

### Reports filed from this incident, and what shipped

| Report                                                                                                                                       | Filed        | Outcome                                                                                                                                                                                                                                                         | Consumed here as                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| [Agent #293](https://github.com/link-assistant/agent/issues/293) — an unparseable `--model` logs CRITICAL and answers with the default model | Aug 8, 22:0x | [PR #294](https://github.com/link-assistant/agent/pull/294) merged; released in [js-0.25.8](https://github.com/link-assistant/agent/releases/tag/js-v0.25.8) Aug 8, 22:47                                                                                       | `MIN_AGENT_FORMAL_AI_VERSION = '0.25.8'` in `src/agent.lib.mjs`; a Formal AI task refuses to start below it                      |
| [Formal AI #982](https://github.com/link-assistant/formal-ai/issues/982) — no machine-readable, non-destructive persisted-memory upgrade     | Aug 8, 22:30 | [PR #985](https://github.com/link-assistant/formal-ai/pull/985) merged; released in [v0.336.0](https://github.com/link-assistant/formal-ai/releases/tag/v0.336.0) Aug 9, 09:57                                                                                  | `src/formal-ai-updater.lib.mjs` preflight/migrate/verify/rollback; floor `FORMAL_AI_MEMORY_CONTRACT_MINIMUM_VERSION = '0.336.0'` |
| [start #154](https://github.com/link-foundation/start/issues/154) — no way to select a Docker network at launch                              | Aug 8, late  | [PR #155](https://github.com/link-foundation/start/pull/155) merged; released in [js-0.31.0](https://github.com/link-foundation/start/releases/tag/js-v0.31.0) / [rust-0.18.0](https://github.com/link-foundation/start/releases/tag/rust-v0.18.0) Aug 9, 03:30 | Pinned in `Dockerfile` and `Dockerfile.dind`; used for the sidecar, deliberately not for tasks (see above)                       |

All three are closed as completed, and every release they produced is consumed here.

Re-reading the delivered releases against what this PR actually depends on surfaced two follow-ups, both filed rather than left as private knowledge:

| Follow-up                                                                                                                                                  | Gap                                                                                                                                                                                                             | Why it is not a blocker                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Agent #295](https://github.com/link-assistant/agent/issues/295) — publish model routing as a typed event instead of an English log message                | The provider guard discriminates on `message === 'using explicit provider/model'` (`js/src/cli/model-config.js:118`). Rewording that string is non-breaking upstream and would silently disable a safety guard. | It is the third layer. Separate argv atoms and the 0.25.8 floor stop the incident on their own, and the guard works against every released 0.25.8+ build.                   |
| [start #156](https://github.com/link-foundation/start/issues/156) — make `--network` repeatable so a task can keep the bridge _and_ join a private network | PR #155 shipped a single-valued `--network`, and `docker run --network` replaces the default bridge, so no single-network invocation can express "reach GitHub and the sidecar".                                | The launch gate already exists for an unrelated reason, so `docker network connect` inside it is race-free here; the gap is that every other caller must rebuild that gate. |

### Field-by-field verification against Formal AI v0.337.0

Consuming a contract from its issue text is how integrations drift. Every field this PR reads was therefore checked against the released sources rather than against #982's proposal:

- `src/memory/upgrade.rs` — `MemoryUpgradeStatus` really does serialize `binary_version`, `path_exists`, `detected_schema_version`, `minimum_readable_schema_version`, `maximum_readable_schema_version`, `target_schema_version`, `compatible`, `migration_required`, `migration_id`, `rollback_supported`, `migration_state`, `event_count`, `source_sha256`, and the two skip-if-none fields `refusal_code`/`refusal_reason`. `MemoryMigrationReceipt` carries `changed`, `from_schema_version`, `to_schema_version`, `memory_path`, `backup_path`, `receipt_path`, `original_sha256`, `migrated_sha256`, `event_count`, `rollback_supported` and `rollback_strategy`. Hive Mind reads only fields that exist, and the SHA-256 cross-check it performs — preflight `source_sha256` against receipt `original_sha256` — is possible precisely because both are present.
- `src/cli_memory.rs` — `run_memory` prints the payload with `println!` and _then_ returns `Err`, for both `upgrade-status` (when `!status.compatible`) and `migrate` (as `{"error": {"code", "message"}, "status"}`). That is the stdout-then-nonzero shape `runFormalAiMemoryCommand` handles, and losing it would reduce an actionable refusal code to "exit status 1".
- `src/server.rs` — `memory_health_status()` calls the same `preflight_memory_upgrade` and exposes `schema_version`, `compatible`, `migration_required` and `migration_state` under `/health`'s `memory` key. Verification asks the candidate about the memory it was actually given, not about itself.
- `src/shared_memory.rs` — `resolve_memory_path_from` prefers `FORMAL_AI_MEMORY_PATH` and otherwise falls back to `$HOME/.formal-ai/memory.lino`. The sidecar mounts `hive-mind-formal-ai-memory` at `/home/box/.formal-ai` _and_ passes `FORMAL_AI_MEMORY_PATH` explicitly, so the CLI subcommands, the server and the health check all address the same file even if `HOME` differs in a future image.
- `MemoryMigrationState` is a four-value enum (`missing`, `ready`, `upgrade_required`, `incompatible`). Hive Mind branches on the booleans and prints the state, rather than comparing against state strings it does not own — one less field whose vocabulary can change under it.

Schema versions 1 and 2 are readable and 2 is the target in this release, so a memory file written by 0.336.0/0.337.0 needs no migration today. The path that matters is the future one, which is exactly why it is exercised by tests with a simulated v1→v2 migration rather than left untested until a real schema bump arrives.

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

Not selected. That release fixes #904, but #2119/#2130 require the later tool-result verification work. Version 0.333.2 was the first released baseline containing the full evidence guarantees evaluated here, and 0.336.0 replaced it once unattended image replacement became part of the design: a binary that cannot answer `memory upgrade-status` cannot be validated against the persisted memory at all.

### Fence the entire AI summary

Rejected. Whole-summary fencing would destroy legitimate headings, links, lists, and emphasis. The formatter targets the structured paragraph while preserving ordinary Markdown and already fenced content.

## Implementation map

| Component                                       | Responsibility                                                                                                        |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `src/agent-command.lib.mjs`                     | Pure argv construction, safe display rendering, idle/strong-completion policy, Formal AI provider-drift detection     |
| `src/agent.lib.mjs`                             | Execute array argv, refuse Formal AI below Agent 0.25.8, stop on routing mismatch, retain strong completion semantics |
| `src/formal-ai-version.lib.mjs`                 | Version parsing, non-throwing probe, supported-version assertion                                                      |
| `src/formal-ai-runtime.lib.mjs`                 | Unconditional version check/log before server or client configuration                                                 |
| Four distributed Dockerfiles                    | Pin the bootstrap Formal AI version and the start-command release that provides `--network`                           |
| `src/formal-ai.lib.mjs`                         | Reuse the shared version reader for optional connection validation                                                    |
| `src/formal-ai-sidecar.lib.mjs`                 | On-demand sidecar: internal network, memory volume, lease counting, reconciliation, health, cross-process lock        |
| `src/formal-ai-isolation.lib.mjs`               | Task-facing policy: acquire only for Formal AI Docker tasks, attach inside the gate, fail closed, release             |
| `src/isolation-runner.lib.mjs`                  | Attach the still-gated task container to the internal network before any agent process starts                         |
| `src/formal-ai-updater.lib.mjs`                 | Idle-only image update: pull, preflight, migrate, verify, roll back, stay stopped                                     |
| `src/agentic-cli-updater.lib.mjs`               | Idle-only refresh of Claude, Codex, Agent, Gemini, Qwen, Copilot and OpenCode                                         |
| `src/formal-ai-maintenance.lib.mjs`             | One periodic tick ordering stop-idle → image update → CLI refresh, best-effort throughout                             |
| `src/working-session-summary.lib.mjs`           | Idempotent structured-text fencing                                                                                    |
| `src/solve.results.lib.mjs`                     | Apply redaction and formatting at the GitHub comment boundary                                                         |
| `tests/test-issue-2146-formal-ai-support.mjs`   | Minimal regression for argv, provider guard, completion policy, version floor, and Markdown                           |
| `tests/test-issue-2146-formal-ai-lifecycle.mjs` | Sidecar invariants 1–6 against a simulated Docker daemon                                                              |
| `tests/test-issue-2146-idle-updates.mjs`        | Invariants 7–9: idle gating, the memory contract end to end, rollback, and the CLI refresh                            |
| `tests/test-codex-support.mjs`                  | The Agent CLI version floor, including a PATH stub proving an outdated CLI is never asked to answer                   |
| `tests/formal-ai-docker-simulator.mjs`          | In-memory Docker daemon: containers, networks, volumes, digests, health, and memory command payloads                  |
| `tests/test-issue-2130-formal-ai-runtime.mjs`   | Runtime rejects a stale binary before the server starts                                                               |

## Reproduction and verification

The test was added before the implementation. Its first execution failed with `ERR_MODULE_NOT_FOUND` for the not-yet-created `src/agent-command.lib.mjs`, establishing a red baseline.

Focused verification:

```bash
node tests/test-issue-2146-formal-ai-support.mjs
node tests/test-issue-2146-formal-ai-lifecycle.mjs
node tests/test-issue-2146-idle-updates.mjs
node tests/test-codex-support.mjs
node tests/test-issue-2130-formal-ai-runtime.mjs
node tests/test-working-session-summary-2119.mjs
node tests/test-agent-error-detection.mjs
node experiments/issue-2146-agent-argv-shape.mjs
```

The runtime test injects version `0.326.0` and a server spy. It asserts the actionable `>=0.336.0` error and that the server spy was never called. No real model request is needed.

The issue-specific test asserts:

- exact distinct argv atoms, including a resume value with spaces;
- mismatched OpenCode selection is terminal while `formalai/formal-ai` is accepted;
- `session.idle` is not strong completion;
- valid/current, stale, and unknown Formal AI versions;
- an observed Formal AI plan becomes a `text` fence;
- formatting is idempotent and normal/existing-fenced Markdown is unchanged.

The Agent version floor is checked in `tests/test-codex-support.mjs` in the only way that proves the property. A stub `agent` binary is placed on `PATH` and records every invocation that is not `--version`. On `0.25.7`, `validateAgentConnection('formal-ai')` returns false _and_ the recording file is never created — the outdated CLI is not asked to answer anything, so it never gets the chance to answer with another model. On `0.25.8` the same call succeeds and the probe is recorded. Asserting only the boolean would pass against an implementation that refuses after sending the request.

The lifecycle and update suites run against `tests/formal-ai-docker-simulator.mjs`, an in-memory Docker daemon that models containers, networks (including `internal`), volumes, image digests, `/health` payloads and the two `formal-ai memory` subcommands, including their stdout-then-nonzero refusals. Those tests are deterministic and need no Docker daemon, no registry and no Formal AI image, which is what lets them run in CI on every change.

## Remaining limits

These are known, deliberate, and none of them is a deferred requirement from issue #2146 or the PR review:

- Hive Mind verifies the local binary version and client routing, but the Formal AI server protocol still exposes only the process version at `/health`, not a separately attested remote build. With `HIVE_MIND_FORMAL_AI_BASE_URL` the local binary used for configuration is verified and operators remain responsible for the remote server.
- The Agent provider guard relies on Agent's structured model-resolution log. It is the third layer, behind distinct argv atoms and the 0.25.8 floor; a future Agent release that reworded that log message would weaken the guard without weakening the two layers in front of it. Filed as [agent#295](https://github.com/link-assistant/agent/issues/295).
- The idle-only agentic CLI refresh updates the CLIs inside the Hive Mind container. Already-built Docker isolation images still carry the versions baked in at image-build time, so a task that runs in a nested image gets the newer CLI only after that image is rebuilt. The review explicitly allowed either approach ("or support update inside each separate task's docker"); the in-container path was chosen because it cannot spend task time or drift between concurrent tasks.
- The memory migration path is exercised against a simulated v1→v2 migration because Formal AI 0.337.0 reads schema 1 and 2 and targets 2, so no real migration is pending today. The contract is followed exactly as released; the first real schema bump will be its first production exercise.
- The sidecar is one shared container per Hive Mind host, not one per task. That is what makes memory shared and persistent across tasks, as the review required, and it means a Formal AI task cannot be isolated from another Formal AI task's memory.
- This PR does not claim Formal AI will solve every repository task. It ensures old known-no-op behavior, unauthorized provider fallback, and false terminal signals cannot masquerade as a supported run.

## What is left

Nothing in issue #2146 or in the two PR #2147 review comments is outstanding in this repository, and nothing is blocked upstream. Concretely:

- every requirement row in the two tables above names a shipped module and a test;
- all three upstream prerequisites ([agent#293](https://github.com/link-assistant/agent/issues/293), [formal-ai#982](https://github.com/link-assistant/formal-ai/issues/982), [start#154](https://github.com/link-foundation/start/issues/154)) are closed as completed and their releases are consumed here at the newest published versions (formal-ai 0.337.0, agent js-0.25.8, start js-0.31.0 / rust-0.18.0);
- the mandatory pause rule no longer applies, because the blockers it was waiting on are delivered;
- the two robustness gaps that remain after those releases are filed as [agent#295](https://github.com/link-assistant/agent/issues/295) and [start#156](https://github.com/link-foundation/start/issues/156). Neither blocks this PR — both are the difference between "works" and "cannot be broken by an unrelated upstream edit" — and the table above records why.

The one thing that genuinely cannot be closed from this repository is the original behavioral complaint behind root cause 2: Formal AI's agent mode produced a plan and no code in every reproduction. That is tracked upstream on its own coding-capability track ([#848](https://github.com/link-assistant/formal-ai/issues/848), [#904](https://github.com/link-assistant/formal-ai/issues/904)) and is not something Hive Mind can fix. What Hive Mind can do — refuse to call it a success, refuse to retry it forever, and refuse to quietly finish the work on another model — it now does.
