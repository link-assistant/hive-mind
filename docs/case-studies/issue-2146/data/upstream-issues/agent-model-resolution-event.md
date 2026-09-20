# Expose model routing as a stable machine-readable event, not as an English log message

Follow-up to [#293](https://github.com/link-assistant/agent/issues/293) / [PR #294](https://github.com/link-assistant/agent/pull/294), released in [js-0.25.8](https://github.com/link-assistant/agent/releases/tag/js-v0.25.8). Failing closed on an unparseable `--model` fixed the reported incident — thank you. This asks for the remaining half: a consumer-facing way to _verify_ which model was actually selected.

## Why a downstream integration needs it

[link-assistant/hive-mind#2146](https://github.com/link-assistant/hive-mind/issues/2146) requires that a task requesting `formalai/formal-ai` can reach **no other model**. The original incident was a run that requested Formal AI and contacted `https://opencode.ai/zen/v1/messages`, silently completing on `opencode/minimax-m2.5-free`.

Hive Mind now defends this in three layers: distinct argv atoms, an Agent `>= 0.25.8` version floor, and a streamed guard that terminates the process if Agent resolves anything other than the requested provider/model. The third layer is the only one that observes what actually happened — and today it can only do so by matching a log message by its English prose:

```js
// hive-mind/src/agent-command.lib.mjs
if (message !== 'using explicit provider/model' || !record.providerID || !record.modelID) return null;
const actualModel = `${record.providerID}/${record.modelID}`;
```

against

```js
// js/src/cli/model-config.js:118
Log.Default.info(() => ({
  message: 'using explicit provider/model',
  rawModel: modelArg,
  providerID,
  modelID,
}));
```

`providerID`/`modelID` are structured, which is good, but the discriminator is the free-text `message`. Rewording that string — an ordinary, non-breaking change from Agent's point of view — silently disables a downstream _safety_ guard: the integration keeps running and stops noticing substitutions. A guard that fails silently on a cosmetic upstream edit is the wrong shape for a security-relevant check, and the fix belongs upstream where the fact is known.

There is also no attestation at all on the paths that do not go through that branch: a bare `--model kimi-k2.5-free` without a provider prefix, or the default model when no `--model` is passed. A consumer cannot currently ask "what did you settle on, and did I ask for it?" — it can only hope to recognize one particular log line.

## Reproduction

```bash
agent --output-format stream-json --model formalai/formal-ai -p 'say hi' \
  | jq -c 'select(.type != "text")'
```

Observed: the only routing evidence is `{"type":"log","message":"using explicit provider/model","providerID":"formalai","modelID":"formal-ai",...}`, i.e. a record whose meaning is carried by a human-readable string.

Expected: a first-class event with a `type` a consumer can switch on.

## Suggested implementation

`js/src/cli/output.ts` already owns the event vocabulary (`OutputType`). Add one member and emit it once per session, immediately after resolution in `js/src/cli/model-config.js`, on **every** path — explicit provider/model, bare model id, and default:

```jsonc
{
  "type": "model_resolved",
  "requested": "formalai/formal-ai",   // raw --model, or null when defaulted
  "providerID": "formalai",
  "modelID": "formal-ai",
  "source": "cli" | "config" | "default",
  "matchesRequest": true
}
```

`source` and `matchesRequest` are what make it useful: a consumer that asked for X can assert `matchesRequest === true` without reimplementing Agent's own resolution rules, and `source: "default"` makes a silent fallback explicit rather than something to be inferred from an absence.

The existing `Log.Default.info` record can stay exactly as it is — this is additive, and nothing needs to be removed or reworded.

For the Claude stream-json standard (`js/src/json-standard/index.ts`), the natural mapping is the existing `init` event, whose `ClaudeEvent` interface already declares an optional `model?: string`; `convertOpenCodeToClaude` currently never populates it.

## Acceptance tests

- `--model provider/model`, `--model model`, and no `--model` each emit exactly one `model_resolved` event, with `source` `cli`/`cli`/`default` respectively.
- `matchesRequest` is `false` when the resolved provider/model differs from the request, and the run still fails closed as `0.25.8` does.
- The event is emitted before the first `step_start` / first upstream HTTP request, so a consumer can terminate the process before a request reaches another provider.
- Claude-standard output carries the resolved model on `init`.
- A test asserts the event _type_ string, so a future reword of the human-readable log message cannot silently change the machine contract.

## Impact

Not a blocker: Hive Mind's first two layers (separate argv atoms and the `>= 0.25.8` floor) already prevent the incident that started this, and the log-matching guard works against `0.25.8`. This request is about making the third layer depend on a contract instead of on prose, so an unrelated upstream edit cannot quietly remove a downstream safety property.
