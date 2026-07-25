# Issue #2102 — the preflight never read the file the requirement was written in

Why two solver sessions against `CEHR2005/GCS-TS#5` spent ~$0.31 and produced
zero commits, while every stage of the repaired Codex provisioning pipeline sat
idle and silent.

## One-paragraph summary

`AGENTS.md` is where an agent-facing repository declares what an agent must do.
GCS-TS declared a mandatory Superpowers workflow there, in the imperative, with
the exact plugin selector. The Hive Mind Codex capability preflight built its
requirement corpus from the GitHub issue title, body and comments only — so it
saw a pure engineering spec about trait bonus calculation, detected zero
requirements, took its early return, and started `codex exec` against an
unprovisioned `CODEX_HOME`. The model then read `AGENTS.md` itself, did exactly
what it said, and reached for the only affordance Codex gives it —
`request_plugin_install` — which the ChatGPT backend allowlist rejected. Per
`AGENTS.md` ("No manual workflow fallback is authorized") the model stopped with
a clean worktree. Hive Mind logged `✅ Codex command completed`, published a
solution-draft log, and marked a pull request with **zero changed files** as
"✅ Ready to merge — All CI checks have passed". Then it happened again, an hour
later, identically. The fix is one input: feed the checked-out repository's
agent instruction files into the detector that already parses them correctly.

## Contents

| File                                 | Purpose                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| [`timeline.md`](timeline.md)         | Both failing runs reconstructed second by second, plus the #2074→#2094 lineage |
| [`analysis.md`](analysis.md)         | The three root causes, why they form one chain, and what each fix does         |
| [`requirements.md`](requirements.md) | Every requirement from the issue and the follow-up comment, with its status    |
| [`research.md`](research.md)         | Upstream mechanics verified from source, related issues, component survey      |
| `raw/`                               | Both complete production transcripts, RED/GREEN logs, upstream verification    |
| `data/`                              | Issue, comment and PR payloads, and GCS-TS's own instruction files             |

Reported upstream as
[openai/codex#35387](https://github.com/openai/codex/issues/35387) — under
`codex exec`, `request_plugin_install` cannot succeed for any input, and its
error message names the wrong cause. Archived verbatim at
[`raw/upstream-report-openai-codex-35387.md`](raw/upstream-report-openai-codex-35387.md).

Reproductions:
[`tests/test-issue-2102-codex-agents-md-capability-corpus.mjs`](../../../tests/test-issue-2102-codex-agents-md-capability-corpus.mjs)
(the regression test, offline) and
[`experiments/issue-2102/replay-production-log.mjs`](../../../experiments/issue-2102/replay-production-log.mjs)
(replays the real 256 KB / 281 KB transcripts through the shipped parser).

## The decisive evidence

The preflight's entire log surface is absent from both runs:

```console
$ grep -c "capability preflight" raw/solution-draft-log-pr-1784809014365.txt
0
$ grep -c "capability preflight" raw/solution-draft-log-pr-1784812579100.txt
0
```

Compare #2088 and #2094, whose logs are dense with `🔌 Codex capability
preflight`, `🧭 Scoped Codex loader` and `Model-visible skills`. A skipped
preflight was indistinguishable from a healthy one — that property is what made
this bug cost two sessions instead of one.

The requirement it should have found, from
[`data/gcs-ts-AGENTS.md`](data/gcs-ts-AGENTS.md) lines 21-23:

```markdown
- Before inspecting implementation details or changing files for an implementation issue, invoke `superpowers:using-superpowers` from `plugin://superpowers@openai-curated-remote`.
- If the official Superpowers capability is absent, attempt to install the exact plugin `superpowers@openai-curated-remote` through the environment-supported plugin installation workflow.
- If installation or skill invocation fails, stop before implementation, keep the worktree clean, and report the exact error and attempted steps. No manual workflow fallback is authorized.
```

And what the model did instead, 14 seconds into run 1
(`raw/solution-draft-log-pr-1784809014365.txt:911`):

```text
event.name="codex.tool_result" tool_name=request_plugin_install
  call_id=call_ccuteZ4s1AdV1wKVgJdt0Fk5
  arguments={"plugin_id":"superpowers@openai-curated-remote", …}
  duration_ms=0 success=false
  output=plugin_id must match one of the entries in the <recommended_plugins> list
ERROR codex_core::tools::router: error=plugin_id must match one of the entries in the <recommended_plugins> list
```

Seven seconds after that: `✅ Codex command completed`.

## What the fix does to those exact bytes

`experiments/issue-2102/replay-production-log.mjs` feeds both committed
transcripts through the shipped parser and the new health gate
(`raw/green-02-production-log-replay.log`):

```text
=== solution-draft-log-pr-1784809014365.txt
  events: unknown=23, thread.started=1, turn.started=1, item.completed=3, turn.completed=1
  fileChanges=0
  pluginInstallRejections=2
    ↳ source=tool_result pluginId=superpowers@openai-curated-remote callId=call_ccuteZ4s1AdV1wKVgJdt0Fk5
    ↳ source=router pluginId=- callId=-
  provisioning healthy=false detected=true producedWork=false
```

Both runs now fail with a named diagnostic instead of reporting success, and
both name the fix in their guidance:
`--require-codex-plugin superpowers@openai-curated`.

## Lineage

Six previous issues repaired this pipeline. Every one of them improved a stage
that runs **after** detection:

| Issue | What it fixed                                                | Why it could not catch this                 |
| ----- | ------------------------------------------------------------ | ------------------------------------------- |
| #2074 | Repo-scoped `CODEX_HOME`, provision before `codex exec`      | Corpus was issue + comments from day one    |
| #2077 | `16:9` false positive                                        | Tuned the detector, not its input           |
| #2080 | `additionalProperties: false` false positive                 | Same                                        |
| #2084 | `plugin list` ≠ model visibility; probe `debug prompt-input` | Verification stage, needs a detection first |
| #2088 | Repair ladder + fail-closed on explicit requirements         | Repair stage, needs a detection first       |
| #2094 | `features.remote_plugin = false` vs the curated loader merge | Loader config, written only after detection |

Detection _input_ was the one link never revisited. Which is why the fix is
small — and why it re-arms all six at once.
