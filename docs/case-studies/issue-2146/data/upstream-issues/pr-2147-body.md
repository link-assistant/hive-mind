Fixes #2146.

## Blocked follow-up

After the original implementation and green CI run, the maintainer expanded the requested scope to an on-demand Formal AI sidecar, task-only internal networking, persistent memory, idle-only latest-image replacement, and equivalent refresh behavior for every bundled agentic CLI.

PR #2147 remains draft because a safe Formal AI updater needs an upstream persisted-memory compatibility and migration contract that does not exist yet:

- **Blocking:** [formal-ai#982](https://github.com/link-assistant/formal-ai/issues/982) requests a machine-readable compatibility preflight plus an atomic, non-destructive, idempotent migration and rollback transaction.
- **Non-blocking:** [link-foundation/start#154](https://github.com/link-foundation/start/issues/154) requests native Docker network selection. Hive Mind can use its existing startup gate with `docker network connect` until that is available.

The ownership split, proposed lifecycle invariants, current workaround, and acceptance tests are preserved in the [case study](docs/case-studies/issue-2146/). Per issue #2146's explicit pause requirement, this PR does not implement a health-check-only `latest` replacement that could silently damage persisted memory or prevent rollback. Once the Formal AI prerequisite lands, Hive Mind owns task counting, idle pulls, digest comparison, sidecar start/stop, private-network attachment, volume backup/rollback orchestration, and idle-only CLI refresh.

## What was wrong

The Aug 8 reproductions exposed three separate failures:

| Path           | Observed behavior                                                             | Root cause                                                                                                                                                                                                              |
| -------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent          | A run requested Formal AI but contacted `https://opencode.ai/zen/v1/messages` | Hive Mind interpolated `--model formalai/formal-ai --verbose` as one command-stream argv atom. Agent could not parse it, announced that it would use its default, and then failed open to `opencode/minimax-m2.5-free`. |
| Claude/Codex   | Five restarts per tool returned the same plan without implementing the issue  | The logs match Formal AI #904's pre-v0.326.1 plan-only signature. `--no-tool-check` suppressed the only version probe, so the exact runtime version was not recorded and a stale/unversioned binary was allowed to run. |
| GitHub summary | Formal AI's structured Lino plan collapsed into ordinary prose                | The working-session summary posted indented structured text without a code fence.                                                                                                                                       |

The restart controller itself behaved correctly: every Claude/Codex iteration still had an empty or placeholder-only diff, so Hive Mind retried five times and then failed.

## The implemented fix

- Build every Agent flag as a distinct argv element, including resume identifiers and stream-json flags.
- Fail closed with `AgentModelRoutingMismatch` if an Agent Formal AI session announces an unparsable model flag or resolves any provider/model other than `formalai/formal-ai`; terminate the process before accepting further work.
- Treat `session.idle` as live-input state only. A prior streamed error is cleared only by `step_finish(reason=stop)` or an explicit successful result.
- Apply the same Formal AI version policy during optional connection validation and runtime preparation, even with `--no-tool-check`; reject unknown or pre-0.333.2 binaries before starting a server or spending a model request. Pin all four distributed Docker images to the same shared baseline. The 0.333.2 floor includes the plan-execution and tool-result evidence fixes relevant to #2119/#2130/#2146.
- Fence structured, indented result paragraphs at the GitHub-comment boundary while preserving ordinary Markdown and existing fences.
- Add a release changeset.

The remaining upstream Agent fail-open behavior is reported in [link-assistant/agent#293](https://github.com/link-assistant/agent/issues/293), with a minimal reproduction, safe workaround, code location, and integration-test proposal.

## Reproduction and regression coverage

Before the implementation, the issue-specific regression failed because the new policy module did not exist. The harmless command-stream experiment now demonstrates the original and corrected process shapes without contacting a model:

```text
string interpolation: ["--model formalai/formal-ai --verbose"]
array interpolation:  ["--model","formalai/formal-ai","--verbose"]
```

[`tests/test-issue-2146-formal-ai-support.mjs`](tests/test-issue-2146-formal-ai-support.mjs) covers exact argv atoms, provider drift, strong completion, the version floor, Markdown fencing, and idempotence. [`tests/test-issue-2130-formal-ai-runtime.mjs`](tests/test-issue-2130-formal-ai-runtime.mjs) proves a stale binary is rejected before a server starts.

## Case study and preserved evidence

[`docs/case-studies/issue-2146/`](docs/case-studies/issue-2146/) contains the reconstructed timeline, requirement matrix, per-defect root causes, upstream/release research, alternatives considered, limitations, implementation map, verification procedure, post-review lifecycle analysis, and upstream blocker reports.

The data bundle includes 16 sanitized logs (the 15 Agent/Claude/Codex incident logs plus the complete solution-draft log), authenticated Gist snapshots, issue/PR/comment/review API captures, current upstream facts, and SHA-256 hashes. Every JSON file parses, every gzip archive passes its integrity check, and every tool-log hash matches [`MANIFEST.md`](docs/case-studies/issue-2146/MANIFEST.md).

No screenshots are included because this is not a UI change and the issue or linked discussions contained no images.

## Checks completed before the expanded request

- `npm test` — 380 default test files
- `npm run lint`
- `npm run format:check`
- `npm run check:duplication`
- `git diff --check`
- issue-2146 focused tests and argv-shape experiment
- case-study JSON, gzip, checksum, and credential-signature validation
- final-head CI run 31270565413

The subsequent commit only refreshes documentation and evidence for the expanded request and its upstream blockers.
