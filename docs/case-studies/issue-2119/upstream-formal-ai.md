# Upstream report — Formal AI

This is the consolidated report filed against
[`link-assistant/formal-ai`](https://github.com/link-assistant/formal-ai) from the
evidence in [`README.md`](./README.md). It is kept in the repository so the Hive Mind
side of the investigation and the upstream side stay linked.

**Filed as [link-assistant/formal-ai#879](https://github.com/link-assistant/formal-ai/issues/879)**
on 2026-07-30. The three Agent CLI defects found in the same logs are reported separately,
where they belong: [link-assistant/agent#285](https://github.com/link-assistant/agent/issues/285)
(see §8.2 of the case study).

Everything below concerns Formal AI itself. The thirteen defects Hive Mind owns are
fixed in https://github.com/link-assistant/hive-mind/pull/2120 and are **not** part of
this report.

---

## Title

`formal-ai with <tool>` produces no work on the simplest possible task across agent, claude and codex

## Summary

Three `hive-mind solve --model formal-ai` runs were started on 2026-07-30 against three
freshly generated hello-world repositories, one per tool (`agent`, `claude`, `codex`).
The task in each was a single sentence: _implement Hello World in `<language>`_. All
three produced zero lines of source code, each failing in a different way. The three
failures share one root: **the run has no way to notice that it accomplished nothing and
no mechanism to recover.**

The request is not three patches. It is the meta-capability the issue asks for:
generalization, self-learning and self-healing, so that a run which produces no artifact
detects that fact itself, diagnoses why, and retries differently — rather than exiting
successfully with an empty workspace.

## Reproduction

Common setup — a repository with one issue, `Implement Hello World in <language>`:

```bash
# hive-mind (any version; 2.10.3 was used)
solve https://github.com/<owner>/<repo>/issues/1 \
  --model formal-ai \
  --tool <agent|claude|codex|opencode|gemini|qwen> \
  --auto-continue --attach-logs --verbose
```

| Run | Tool     | Repository                                                                                                              | Pull request                                                                                    |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| A   | `agent`  | [`test-hello-world-019fb330-00e1-...`](https://github.com/konard/test-hello-world-019fb330-00e1-73b9-955e-f357a1600d5b) | [PR #2](https://github.com/konard/test-hello-world-019fb330-00e1-73b9-955e-f357a1600d5b/pull/2) |
| B   | `claude` | [`test-hello-world-019fb330-fa49-...`](https://github.com/konard/test-hello-world-019fb330-fa49-7c9d-a664-b7ea33bb698a) | [PR #2](https://github.com/konard/test-hello-world-019fb330-fa49-7c9d-a664-b7ea33bb698a/pull/2) |
| C   | `codex`  | [`test-hello-world-019fb331-c107-...`](https://github.com/konard/test-hello-world-019fb331-c107-78c7-8ff6-9f127a3c593c) | [PR #2](https://github.com/konard/test-hello-world-019fb331-c107-78c7-8ff6-9f127a3c593c/pull/2) |

Full session logs (13 of them, including all ten restart iterations of run A) are
archived in
[`docs/case-studies/issue-2119/data/`](https://github.com/link-assistant/hive-mind/tree/main/docs/case-studies/issue-2119/data)
with their public gist URLs in
[`data/log-gists.json`](https://github.com/link-assistant/hive-mind/blob/main/docs/case-studies/issue-2119/data/log-gists.json).

For comparison, three runs of the same generator in 2025 with a conventional model each
produced a two-file, 45–81 line pull request. The pipeline works when the model answers.

## Defect 1 — the task is reinterpreted into something else (`agent`)

Run A never wrote Scala. The log
([`agent-scala-solution-draft.log`](https://github.com/link-assistant/hive-mind/blob/main/docs/case-studies/issue-2119/data/logs/agent-scala-solution-draft.log))
shows the session concluding that it

> applied the general change request for `./examples` and verified it with `cat ./examples`

for an issue that says _Implement Hello World in Scala_. `./examples` did not exist; the
verification command was run against a path that is not a file, and the session ended
reporting success.

**Why this is a generalization problem, not a prompt problem.** The failure is not that
one prompt was misread — it is that the run had no acceptance criterion. "Implement X"
implies an artifact exists afterwards. A self-checking agent would derive that criterion
from the request itself, verify it (a `.scala` file exists, it compiles, it prints
`Hello, World!`), and treat its absence as a failed attempt rather than a completed one.

**Suggested direction.** Before declaring completion, re-derive the task's observable
postcondition from the original request and check it. Where the check fails, that is
training signal: record the (request, plan, outcome) triple and try a different
decomposition. This is the self-learning loop the request asks for, and it subsumes every
individual "the model misunderstood" bug.

**Workaround.** None on the caller side. Hive Mind can now _detect_ the empty result and
refuse to call it success (PR #2120), but it cannot make the tool produce work.

## Defect 2 — `formal-ai` does not route through the local server (`codex`)

Run C failed with

```
401 Missing bearer or basic authentication in header
POST https://api.openai.com/v1/responses
```

([`codex-rust-failure.log`](https://github.com/link-assistant/hive-mind/blob/main/docs/case-studies/issue-2119/data/logs/codex-rust-failure.log)).

The `formal-ai` model alias is supposed to resolve to the local Link.Assistant server.
On the codex path the alias was accepted but the request still went to OpenAI's public
API, where no credential exists — so the run failed for a reason entirely unrelated to
the task.

**Suggested direction.** Fail closed: if the resolved base URL for a `formal-ai`
invocation is not the local server, abort with a diagnostic naming the expected and the
actual endpoint, instead of issuing the request and surfacing a generic authentication
error. A single resolution step shared by all six tools removes the class of defect
rather than this instance of it.

**Workaround.** Set the tool's own base-URL environment variable explicitly before
invoking, so codex cannot fall back to the public endpoint.

## Defect 3 — the session ends after a single no-op command (`claude`)

Run B's entire session was one `pwd`. The result record reports `"num_turns": 2` and
`"stop_reason": "end_turn"`
([`claude-kotlin-solution-draft.log`](https://github.com/link-assistant/hive-mind/blob/main/docs/case-studies/issue-2119/data/logs/claude-kotlin-solution-draft.log), line 1045).
The workspace was untouched, and the session reported normal termination.

**Suggested direction.** `end_turn` after a single orientation command is
indistinguishable from a crash from the caller's side. A completion gate — "did this
session change anything, and if not, is that consistent with the request?" — turns this
into a retryable state instead of a silent success. Emitting a structured
`completion_state` in the result record would let callers act on it without heuristics.

**Workaround.** None; the caller sees a well-formed successful result.

## Defect 4 — `.formal-ai/` scratch state is left in the caller's workspace

Every run wrote a `.formal-ai/` plan directory into the working tree it was invoked in
and left it there. On the caller's side this shows up as untracked user changes:

```
?? .formal-ai/
📝 Found uncommitted changes
🔄 AUTO-RESTART: Restarting Agent to handle uncommitted changes...
```

Restarting re-creates the directory, so the condition never clears. Run A spent ten
restart iterations on this — visible in the PR's `Auto-restart 1/5` … `5/5` comments.
Worse, an auto-commit path doing `git add -A` would publish the tool's private planning
state in the user's pull request.

**Suggested direction.** Keep session scratch state outside the user's working tree (an
XDG state directory, or a temporary directory keyed by session id). If it must live in
the workspace, write the ignore entry along with it.

**Workaround (implemented caller-side).** Hive Mind now adds `.formal-ai/` to
`.git/info/exclude` so git itself stops reporting it
([`b1065b37`](https://github.com/link-assistant/hive-mind/commit/b1065b37)). This is a
local mitigation, not a fix — anyone invoking Formal AI without that mitigation still
gets the scratch directory in their tree.

## Defect 5 — the output stream is unparseable and carries no usage metadata

Two problems in one stream.

**5a. Pretty-printed instead of NDJSON.** `formal-ai with <tool> --verbose` emits
indented, multi-line JSON records. Every consumer that treats the stream as NDJSON —
which is what the tools' own `--output-format stream-json` contracts promise — fails to
parse every single record. Concretely: a session that used 21 677 input and 22 834 output
tokens was published as `Token usage: 0 input, 0 output`, because the record carrying the
usage never parsed.

**5b. Empty metadata.** The records that do carry a metadata field carry nothing in it:

```
rawMetadata": "{\"formalai\":{}}"
```

so even a correct parser learns no model, no usage and no cost.

**Suggested direction.** Emit one JSON value per line (NDJSON) when a machine-readable
output format is requested — pretty-printing is a human affordance and belongs behind a
separate flag. Populate `rawMetadata` with at least model id, input/output token counts
and the served endpoint, so callers can attribute and account for a session without
scraping prose.

**Workaround (implemented caller-side).** Hive Mind now frames records by balanced JSON
values instead of by lines
([`json-stream.lib.mjs`](https://github.com/link-assistant/hive-mind/blob/main/src/json-stream.lib.mjs)),
which tolerates pretty-printed, concatenated and chunk-split records. That recovers the
token counts, but it cannot invent the metadata that is not sent.

## Defect 6 — uniform behaviour across the six supported tools

`FORMAL_AI_SUPPORTED_TOOLS` is `claude, agent, opencode, codex, qwen, gemini`. Only three
were exercised, and each failed differently — one misread the task, one bypassed the
server, one no-opped. `qwen` and `gemini` were never run at all.

**Request.** A conformance suite that runs the identical trivial task through every
supported tool and asserts the same observable contract: an artifact exists, the model
alias resolved to the local server, the output stream is NDJSON, usage metadata is
populated, and the workspace is left clean. Anything a single tool can do that the others
cannot is a divergence to be closed, not documented.

Hive Mind added its half of this on 2026-07-30:
[`tests/test-formal-ai-uniform-tools-2119.mjs`](https://github.com/link-assistant/hive-mind/blob/main/tests/test-formal-ai-uniform-tools-2119.mjs)
asserts that all six tools share one stream framer and one pricing path, so a seventh
tool cannot be added with a divergent implementation. The equivalent on the Formal AI
side is what this request is for.

## What is being asked for, in one sentence

Not six patches — a run-level self-check that notices "I produced no artifact", explains
why, and retries differently; the individual defects above are what that check would have
caught.

## Related

- Hive Mind issue: https://github.com/link-assistant/hive-mind/issues/2119
- Hive Mind fixes (13 defects, 9 regression tests): https://github.com/link-assistant/hive-mind/pull/2120
- Full case study, timeline and raw evidence:
  https://github.com/link-assistant/hive-mind/tree/main/docs/case-studies/issue-2119
