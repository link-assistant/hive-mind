# `codex exec --json` emits non-fatal app-server stream lag as `item.type="error"`

## Summary

In a long `codex exec --json` automation run, Codex completed successfully with a final assistant message, `turn.completed`, and process exit code 0. During the same run, the JSON stream also emitted item-level errors for app-server backpressure:

```json
{"type":"item.completed","item":{"id":"item_115","type":"error","message":"in-process app-server event stream lagged; dropped 133 events"}}
{"type":"item.completed","item":{"id":"item_116","type":"error","message":"in-process app-server event stream lagged; dropped 96 events"}}
```

Because these are represented as `item.type="error"`, downstream automation that treats structured Codex errors as fatal can misclassify a successful run as failed.

## Observed Environment

- Codex CLI/app version in logs: `0.125.0`
- Model: `gpt-5.5`
- Auth mode in logs: `Chatgpt`
- Transport in logs: `responses_websocket`
- Run mode: `codex exec --json`
- The run used verbose tracing (`RUST_LOG=debug`) and completed after a long automation task.

## Expected Behavior

Non-fatal app-server backpressure should be distinguishable from fatal model/tool errors. Possible options:

- emit it as a `warning` notification/event instead of an `item.completed` with `item.type="error"`;
- include a severity or `fatal: false` field;
- document this exact message as a non-fatal item error that clients should ignore when the turn completes.

The app-server README currently describes generic runtime warnings as non-fatal `warning` notifications, while `error` events are described as mid-turn errors that carry failure payloads. This stream-lag event behaves like a warning because the turn and process still succeed.

## Actual Behavior

The stream lag messages appeared as item-level errors. A downstream runner had previously fixed a different bug by treating Codex `error`, `turn.failed`, and `item.type="error"` as fatal even when process exit code is 0. That was correct for unsupported-model and quota failures, but this app-server stream-lag event created a false failure after the task succeeded.

## Minimal Consumer Reproduction

This is the problematic event sequence for consumers:

```json
{"type":"thread.started","thread_id":"thread_issue_1696"}
{"type":"item.completed","item":{"id":"item_115","type":"error","message":"in-process app-server event stream lagged; dropped 133 events"}}
{"type":"item.completed","item":{"id":"item_419","type":"agent_message","text":"Done. PR is updated and ready for review."}}
{"type":"turn.completed","usage":{"input_tokens":26436275,"cached_input_tokens":26045952,"output_tokens":63343}}
```

A consumer cannot reliably tell from `item.type="error"` alone whether this should fail the automation.

## Workaround

In our runner, we are filtering this exact item-level message as non-fatal:

```js
/^in-process app-server event stream lagged; dropped \d+ events?$/i;
```

We still treat top-level `type="error"` and `turn.failed` as fatal, and still treat other item-level errors as fatal.

## Related Downstream Context

Downstream repository issue: https://github.com/link-assistant/hive-mind/issues/1696

The issue was opened because a successful Codex run updated a pull request, pushed a commit, marked it ready, and confirmed CI, but the wrapper then posted a failure comment due to this item-level stream-lag event.
