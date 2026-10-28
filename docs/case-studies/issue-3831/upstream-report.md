Additional Codex CLI evidence for the retained-state capacity-retry issue: [hive-mind#3831](https://github.com/link-assistant/hive-mind/issues/3831), with a deterministic wrapper regression test and workaround in [PR 3832](https://github.com/link-assistant/hive-mind/pull/3832).

Environment: Codex CLI 0.164.0, ChatGPT authentication, `gpt-6.1-sol`, unattended Linux `codex exec --json`. The public incident ran October 26–28, 2026. We did not create extra live model requests to force an overload.

Reproduction:

1. Run a task that completes commands and file changes through `codex exec --json`.
2. Let a later sampling request hit a genuine capacity rejection, or inject the following terminal stream fixture in a CLI harness:

   ```json
   {"type":"error","message":"Selected model is at capacity. Please try a different model."}
   {"type":"turn.failed","error":{"message":"Selected model is at capacity. Please try a different model."}}
   ```

3. Observe the exec attempt end rather than the outer task automatically continuing. `codex exec resume <thread-id>` can retain context: this incident successfully resumed the same thread after three earlier occurrences.

Evidence: [complete archived log and timeline](https://github.com/link-assistant/hive-mind/blob/issue-3831-289f71b61999/docs/case-studies/issue-3831/README.md). The final attempt emitted the two events above at 00:48:22.400 and 00:48:31.714 UTC on October 28; the wrapper then reported 10,298 completed items for that attempt. This establishes terminal capacity handling in the observed version, not the exact lower-level retry count or current-main behavior.

A second defect was in **our wrapper**, not Codex: it charged productive time between separate outages to one 12-hour retry budget. After three resumed attempts it refused another retry after 42h24m. We are fixing that in PR 3832 across all six wrapper adapters; this is not evidence that Codex itself uses that budget.

Workaround: preserve the emitted thread ID, wait with bounded exponential backoff, and invoke `codex exec resume <thread-id>` from the same workspace. Reset consecutive outage accounting only after genuine new assistant/tool progress, not on process initialization. Preserve workspace files and completed tool history instead of starting the prompt over.

Suggested upstream implementation: reuse the shared capacity-specific turn retry work in [PR 31058](https://github.com/openai/codex/pull/31058), with structured overload classification, an independently bounded backoff budget, cancellation-aware waits and retained thread/tool state. After exhaustion, leave the task resumable with explicit retry status. Test partial progress followed by capacity, successful recovery followed by another outage, repeated failures with no progress, and cancellation. Our focused harness reproduces the wrapper lifecycle problem instantly with a fake thirteen-hour interval; it is a reusable test pattern rather than a claim to have fault-injected the Codex backend.

The pending upstream PR and related desktop/extension reports are tracked separately. This report adds a CLI occurrence and avoids duplicating the existing tracker.
