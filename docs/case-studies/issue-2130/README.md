# Case Study: `--model formal-ai` still not working on the simplest hello world (#2130)

> Companion data lives next to this file. Every claim below cites a stored artefact
> so it can be re-checked without re-running anything:
>
> | Folder                               | Contents                                                                                                                                      |
> | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
> | [`data/tool-logs/`](data/tool-logs/) | The seven distinct solver logs the issue links to, plus [`index.json`](data/tool-logs/index.json) mapping each gist → PR comment → byte size. |
> | [`data/github/`](data/github/)       | `gh api` captures of the six `test-hello-world-*` repositories (repo, issues, pulls, issue comments, commits).                                |
> | [`data/runs/`](data/runs/)           | 46 logs from the reproductions and bisections run while solving this issue.                                                                   |
> | [`data/probes/`](data/probes/)       | Formal AI 0.317.0 answers captured verbatim for a set of hand-written prompts.                                                                |

---

## 1. What the issue reports

Issue [#2130](https://github.com/link-assistant/hive-mind/issues/2130) is the second
round of [#2119](https://github.com/link-assistant/hive-mind/issues/2119) (fixed by
[PR #2120](https://github.com/link-assistant/hive-mind/pull/2120)). The reporter ran
`solve … --model formal-ai` against three freshly generated "hello world" repositories,
one per tool, and none of them produced a working program. The verbatim links:

| Tool     | Started at                                                                                                                                                 | Failure log                                                                                                                        |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `claude` | [`…698a/pull/2#issuecomment-5158866526`](https://github.com/konard/test-hello-world-019fb330-fa49-7c9d-a664-b7ea33bb698a/pull/2#issuecomment-5158866526)   | gist `1963a8876911f1087aa868c89839a837` → [`claude-02-FTn7sm.log`](data/tool-logs/claude-02-FTn7sm.log)                            |
| `codex`  | [`…593c/pull/2#issuecomment-5158964914`](https://github.com/konard/test-hello-world-019fb331-c107-78c7-8ff6-9f127a3c593c/pull/2#issuecomment-5158964914)   | gist `b97b374233894030445443e3da2d24bf` → [`codex-02-rv2k7W.log.gz`](data/tool-logs/codex-02-rv2k7W.log.gz)                        |
| `agent`  | [`…600d5b/pull/2#issuecomment-5158414013`](https://github.com/konard/test-hello-world-019fb330-00e1-73b9-955e-f357a1600d5b/pull/2#issuecomment-5158414013) | 18 restarts, ending at gist `32b1af3dddc10939d2ee8af95a46aa6b` → [`agent-18-V7E0Ee.log.gz`](data/tool-logs/agent-18-V7E0Ee.log.gz) |

The issue explicitly asks for **all** restart logs of the agent run, not just the last —
which is why `index.json` records all 18 uploads. Uploads 1–10 and 13–17 are byte-identical
prefixes of their successors (the log file grows and is re-uploaded whole on every restart),
so only the three logs that add new content are stored verbatim; the `stored: false` entries
keep the gist URL and the byte count so the chain is auditable.

### 1.1 Requirement inventory

Every sentence of the issue that asks for something, numbered so the rest of this document
can refer back:

| #   | Requirement (paraphrased; the issue's own words in quotes)                                                                                                                                                    | Status                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| R1  | "First of all we must fix all false positives, false negatives, warnings and errors on Hive Mind side."                                                                                                       | ✅ done, §4               |
| R2  | Report the remaining defects to `link-assistant/formal-ai` and `link-assistant/agent` "where applicable", each with "reproducible examples, workarounds and suggestions for fix the issue in code".           | ✅ done, §6               |
| R3  | "make sure that Formal AI is fully supported in Hive Mind" for **all** tools — claude, codex, agent, gemini, qwen.                                                                                            | ✅ done, §5               |
| R4  | Agent CLI "should be fully ready to operate Formal AI".                                                                                                                                                       | ✅ §5.4; upstream §6.8    |
| R5  | Formal AI "should be able to code by using reasoning" per its own vision.                                                                                                                                     | upstream, §6.1, §6.5      |
| R6  | "download all logs and data related about the issue to this repository … compile that data to `./docs/case-studies/issue-{id}`".                                                                              | ✅ done, [`data/`](data/) |
| R7  | Deep case study: "reconstruct timeline/sequence of events, list of each and all requirements … find root causes of the each problem, and propose possible solutions and solution plans for each requirement". | ✅ this file              |
| R8  | "check known existing components/libraries, that solve similar problem or can help in solutions".                                                                                                             | ✅ §7                     |
| R9  | "If there is not enough data to find actual root cause, add debug output and verbose mode if not present."                                                                                                    | ✅ §4.7                   |
| R10 | "double check to fully apply requirements to entire codebase, so if we have issue in multiple places, it should be fixed in all them."                                                                        | ✅ §4.6                   |

---

## 2. Timeline

Times are UTC and come from the `created_at` fields in
[`data/tool-logs/index.json`](data/tool-logs/index.json) and the GitHub captures in
[`data/github/`](data/github/).

| When                   | What                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2025-09-06 09:42–17:46 | Three reference runs succeed with ordinary LLM models: Rust, Common Lisp and COBOL hello-worlds, one PR each, titles clean. The issue cites them as the target behaviour. Captures: `data/github/01991e68-*`, `01991e7d-*`, `01992020-*`.                                                                                                                                        |
| 2026-07-30 13:21–13:23 | Three new `test-hello-world-*` repositories are generated for the `--model formal-ai` reproduction (`019fb330-00e1…`, `019fb330-fa49…`, `019fb331-c107…`).                                                                                                                                                                                                                       |
| 2026-07-30 14:13–14:33 | Round 1, on **solve v2.10.2**. `agent` restarts 11 times; `claude` and `codex` each fail once. All three PRs are opened with **literally quoted titles** — `'Implement Hello World in Scala'`. This round is what issue #2119 was filed about.                                                                                                                                   |
| 2026-07-30 16:10:50    | [`46b2df22`](https://github.com/link-assistant/hive-mind/commit/46b2df22fab53512e3d0e159e4eceb99e91770a2) — "stop leaking shell quotes into PR titles and API arguments" — lands on `main` via PR #2120, together with the "1 file(s) modified with an empty diff" fix.                                                                                                          |
| 2026-08-02 14:07–15:45 | Round 2, on **solve v2.11.5** (i.e. _with_ the #2119 fix). `agent` restarts 7 more times and hits the 5-iteration auto-restart limit; `claude` fails in 2 s; `codex` fails in 20 s. The PRs are not re-created, so the title fix cannot be observed in these logs — but the underlying `--model formal-ai` failure is unchanged. This round is what issue #2130 was filed about. |
| 2026-08-02 15:53       | Issue #2130 filed.                                                                                                                                                                                                                                                                                                                                                               |

The version split matters and is easy to get wrong: `grep '🚀 solve v' data/tool-logs/*.log*`
shows `claude-01`/`codex-01`/`agent-11` on `v2.10.2` and `claude-02`/`codex-02`/`agent-12`/`agent-18`
on `v2.11.5`. **The PR-title quoting and the empty-diff report visible in the round-1 logs were
already fixed before round 2** and are guarded by `tests/test-shell-quoting-2119.mjs`. Nothing in
this pull request re-fixes them; §4 and §5 deal only with what is still broken in `v2.11.5`.

---

## 3. Why each tool failed

All three runs go through `formal-ai with <tool> <args…>`, an argv wrapper that starts a temporary
Formal AI server and then re-invokes the native CLI on the caller's behalf. The three failures are
**not** the same defect, and it is worth being precise about that, because two of the three are
argv-handling bugs and the third is a reasoning bug that only becomes visible once the argv gets
through.

### 3.1 `claude` — the caller's `-p <prompt>` never reaches the CLI

Hive Mind passes the prompt as an argument, not on stdin:

```text
(cd "/tmp/gh-issue-solver-1785684430045" && formal-ai with claude --output-format stream-json --verbose \
  --dangerously-skip-permissions --model formal-ai --strict-mcp-config --mcp-config "…" \
  --disallowedTools AskUserQuestion CronCreate … -p "Issue to solve: https://github.com/…/issues/1
```

— [`claude-02-FTn7sm.log:182`](data/tool-logs/claude-02-FTn7sm.log)

1.9 s later, claude answers:

```text
Error: Input must be provided either through stdin or as a prompt argument when using --print
```

— [`claude-02-FTn7sm.log:466`](data/tool-logs/claude-02-FTn7sm.log)

claude only emits that message when neither the positional prompt nor stdin carried anything, so the
`-p "Issue to solve: …"` the caller supplied did not survive the wrapper. Formal AI's own completion
record agrees and is honest about it — `"completion_state": "failed"`, `"reason": "client_failed"`,
`"actual_endpoint": null`, `input_tokens: 0`, `output_tokens: 0`, `"attempts": 1`,
`"strategies_spent": []`
([`claude-02-FTn7sm.log:483-534`](data/tool-logs/claude-02-FTn7sm.log)) — so no model ever saw the
task, and the recovery ladder never engaged because the client died before the first turn. Total
elapsed: 2 s.

**The mechanism is not yet pinned down, and an attempt to reproduce it failed.**
[`experiments/issue-2130/repro-claude-lost-prompt.sh`](../../../experiments/issue-2130/repro-claude-lost-prompt.sh)
rebuilds the production command line — same flag order, same `--disallowedTools` list, same
multi-line prompt, `--append-system-prompt` after `-p` as in production — against a fake `claude`
that records its argv, and then replays that argv against the real `claude`. On formal-ai 0.317.0 the
prompt **is** forwarded:

```text
--permission-mode acceptEdits --output-format stream-json --verbose --print \
  --output-format stream-json --verbose --dangerously-skip-permissions --model formal-ai \
  --strict-mcp-config --mcp-config … --disallowedTools AskUserQuestion … ScheduleWakeup \
  -p 'Issue to solve: https://github.com/…'
```

and the replay reaches the API rather than the parse error. Several narrower hypotheses were tested
and each is disproved: claude accepts a duplicated `--print` before `-p <value>`; it accepts
`-p <value>` followed by `--append-system-prompt <value>`; and it accepts `-p <value>` after a
variadic `--disallowedTools` list. Replaying the reproduced attempt-1 argv verbatim against the real
`claude` 2.1.220 — duplicated `--output-format stream-json --verbose`, `--print`, the full
`--disallowedTools` list, `-p <prompt>` — reaches `https://api.anthropic.com/v1/messages` and exits 0. So the production failure is version- or condition-specific rather than an inherent property of
that command shape.

**Which version, though, is unrecoverable from the evidence.** No attached log records a Formal AI
version: `grep -niE 'formal-ai (v|version)'` over all four round-2 tool logs returns nothing.
Validation captured the _native_ CLI's version but never the wrapper's, even though the wrapper is
what builds the argv. That gap is the reason this root cause stayed out of reach, and it is fixed on
our side rather than left as a note — see §4.7.

#### 3.1.1 What the wrapper does reproducibly do to claude's argv

The same reproduction does surface three defects that are live on 0.317.0.
[`repro-with-argv.sh`](../../../experiments/issue-2130/repro-with-argv.sh) records them for all five
tools; [`wrapper-argv.log`](data/runs/wrapper-argv.log) is the stored output.

1. **Flags the caller already passed are re-emitted.** Attempt 1 begins
   `--permission-mode acceptEdits --output-format stream-json --verbose --print --output-format
stream-json --verbose --dangerously-skip-permissions …` — `--output-format stream-json` and
   `--verbose` each appear twice. claude tolerates the duplication (last wins), so this is latent
   rather than fatal, but it also means the wrapper's `--permission-mode acceptEdits` is injected
   alongside the caller's `--dangerously-skip-permissions`.

2. **Every caller passthrough flag is dropped from attempt 2 onwards.** When the workspace-effect
   check fails, the wrapper rebuilds argv from scratch:

   ```text
   --model formal-ai --permission-mode acceptEdits --output-format stream-json --verbose --print <recovery prompt>
   ```

   `--dangerously-skip-permissions`, `--strict-mcp-config`, `--mcp-config`, and the entire
   `--disallowedTools` list are gone. A retry therefore runs with a different permission posture and
   a different toolset than the attempt the caller configured — for Hive Mind, losing
   `--dangerously-skip-permissions` is the difference between a headless run and one that waits for
   a prompt that will never be answered.

3. **The recovery prompt describes the request as the caller's raw flag string.** Each retry ends
   with a `Request:` line built by joining argv rather than by taking the parsed prompt value:

   ```text
   Request: --output-format stream-json --verbose --dangerously-skip-permissions --model formal-ai
   --strict-mcp-config --mcp-config /tmp/…/mcp.json --disallowedTools AskUserQuestion CronCreate …
   ScheduleWakeup mcp__claude_ai_Gmail__* -p Issue to solve: https://github.com/…
   ```

   This is the same goal pollution seen in the production `agent` run (§3.2), and it is why the
   model is asked to satisfy a "request" that is mostly CLI plumbing. Note also that the recovery
   ladder only engages for prompts the wrapper classifies as coding tasks: a trivial prompt runs
   once and stops, which is why the smaller reproductions in this study show a single attempt.

### 3.2 `agent` — the argv is mangled, and the task is then reduced to a no-op

Here the prompt is piped:

```text
(cd "/tmp/gh-issue-solver-1785679629225" && cat "/tmp/agent_prompt_….txt" | formal-ai with agent --model formalai/formal-ai --verbose)
```

— [`agent-18-V7E0Ee.log.gz:340`](data/tool-logs/agent-18-V7E0Ee.log.gz)

agent 0.25.5 echoes its own `process.argv`, which shows exactly what the wrapper built:

```json
"processArgv": [
  "/home/box/.bun/bin/bun",
  "/home/box/.bun/install/global/node_modules/@link-assistant/agent/src/index.js",
  "--no-summarize-session", "--compaction-model", "same",
  "--model", "formalai/formal-ai",
  "-p", "--model formalai/formal-ai --verbose"
]
```

— [`agent-18-V7E0Ee.log.gz:466-476`](data/tool-logs/agent-18-V7E0Ee.log.gz)

Two argv defects are visible: the wrapper injects flags of its own
(`--no-summarize-session --compaction-model same`), and it **collapses the caller's trailing
arguments into a single argv element and hands it to `-p` as the prompt** — so agent's nominal
prompt is the literal string `--model formalai/formal-ai --verbose`.

That did **not** stop the run, and this is the part worth getting right. agent ignored the bogus
`-p` and started in `"mode": "stdin-stream"` with `alwaysAcceptStdin: true`
([`agent-18-V7E0Ee.log.gz:384-400`](data/tool-logs/agent-18-V7E0Ee.log.gz)), so the piped prompt
**was** received. The Hive Mind prompt is reproduced verbatim in the session's own plan record.

The run then failed for a different reason: Formal AI reduced the entire issue to writing a plan
file and reading it back. Its two steps, quoted from the plan it emitted:

```text
step 1
  capability "Write"
  action "append the bounded repository work-item plan to .formal-ai/general-change-plan.lino"
step 2
  capability "Run"
  action "read back the persisted work-item plan"
  command "cat .formal-ai/general-change-plan.lino"
verification_command "cat .formal-ai/general-change-plan.lino"
```

and its closing message:

> Recorded and verified the bounded repository work-item plan for `…/issues/1`.
> The deterministic sandbox preserved the requested goal without claiming unobserved source edits.

— [`agent-18-V7E0Ee.log.gz`](data/tool-logs/agent-18-V7E0Ee.log.gz), first iteration

No source file was ever written. The wording is careful not to _claim_ work it did not do — which
is the right instinct, and traceable to the honesty fix in formal-ai #843 — but the run still
terminates as if the request had been served. Hive Mind restarted it and got the identical no-op
five more times, then stopped: `❌ AUTO-RESTART LIMIT REACHED … after 5/5 iterations`.

The same record shows a third defect: the `goal` field contains the **entire** Hive Mind system
prompt — every guideline, every `gh` command pattern, the Playwright section — rather than the
issue's actual objective. The goal is polluted with its own preamble.

#### 3.2.1 The piped-stdin shape on 0.317.0

Replaying the production shape — `echo <prompt> | formal-ai with <tool> --model formalai/formal-ai
--verbose` — on 0.317.0 no longer collapses the trailing flags into `-p`, but it mishandles them in
three other ways ([`wrapper-argv.log`](data/runs/wrapper-argv.log), section B of each tool):

| Tool     | argv the tool actually receives                                                                    |
| -------- | -------------------------------------------------------------------------------------------------- |
| `agent`  | `--no-summarize-session --compaction-model same --model formalai/formalai/formal-ai --interactive` |
| `gemini` | `-m formalai/formal-ai`                                                                            |
| `qwen`   | `--model formalai/formal-ai`                                                                       |
| `claude` | `--model formalai/formal-ai`                                                                       |
| `codex`  | `--sandbox read-only -c model_providers.formalai.… -c model="formalai/formal-ai"`                  |

1. **The provider prefix is applied twice for `agent`**: the caller asked for
   `formalai/formal-ai` and agent is given `formalai/formalai/formal-ai`. The wrapper prepends
   `formalai/` unconditionally instead of only when the selector is unqualified. Hive Mind maps
   `--model formal-ai` to `formalai/formal-ai` for agent (`src/models/index.mjs`), so this is
   precisely the selector we send.

2. **`--verbose` is silently dropped for every tool.** The caller asked for verbose output and no
   tool receives it — which directly undercuts diagnosing any of this from the run's own logs.

3. **`--interactive` is injected for `agent`**, and `exec` is dropped for `codex` (section B's argv
   starts at `--sandbox read-only`, so codex runs its interactive TUI). Switching a headless,
   piped invocation into interactive mode is wrong on its face, and it matches the production
   `"mode": "stdin-stream"` / `alwaysAcceptStdin: true` record.

   It does **not**, however, explain the restarts, and an earlier draft of this section wrongly
   said it did. [`repro-agent-interactive-stdin.mjs`](../../../experiments/issue-2130/repro-agent-interactive-stdin.mjs)
   drives agent 0.25.5 — the production version — against a live Formal AI server with stdin closed
   right after the prompt, with and without `--interactive`:

   ```
   agent 0.25.5
   piped stdin, closed immediately after the prompt:
     args as Hive Mind sends them              exit=0  4s  exited on its own
     + --interactive (what Formal AI injects)  exit=0  4s  exited on its own
   ```

   Both shapes terminate. The production restarts came from Hive Mind's own
   auto-restart-until-mergeable feature reacting to a run that produced no work —
   `Mode: Auto-restart-until-mergeable`, `Max restart iterations: 5`,
   `shouldRestart (auto-detected): false`
   ([`agent-18-V7E0Ee.log.gz`](data/tool-logs/agent-18-V7E0Ee.log.gz):4470–4479) — not from a hung
   process. The flag injection is still a defect worth fixing upstream; it is simply not the cause
   of the restart loop.

In the argument shape (`-p <prompt>`) the prompt is forwarded correctly to `agent`, `gemini` and
`qwen` — but `codex` is handed `exec … --json -p <prompt> --verbose`, and **`codex exec` has no `-p`
flag**, so that invocation cannot parse.

### 3.3 `codex` — the provider configuration never reaches the session

```text
(cd "…" && cat "/tmp/codex_prompt_….txt" | formal-ai with codex exec --model "formal-ai" --json \
  --skip-git-repo-check -o "…" -c "model_reasoning_effort=none" … )
```

— [`codex-02-rv2k7W.log.gz:191`](data/tool-logs/codex-02-rv2k7W.log.gz)

codex then initialises with the stock vendor provider:

```text
codex_core::session::session: Configuring session: model=formal-ai;
  provider=ModelProviderInfo { name: "OpenAI", base_url: None, env_key: None, … wire_api: Responses, … }
```

— [`codex-02-rv2k7W.log.gz:249`](data/tool-logs/codex-02-rv2k7W.log.gz)

`base_url: None` is the whole story: no `model_providers` entry for Formal AI was in effect, so
every request went to the public API and came back `401 Unauthorized` against
`wss://api.openai.com/v1/responses`. The model name `formal-ai` was accepted; the endpoint was not
redirected.

#### 3.3.1 Why the provider block is lost — a controlled bisection

The two `-c` sets sit on opposite sides of the subcommand. `formal-ai with codex` passes its
provider block as **global** overrides, before `exec`
([`experiments/issue-2130/codex-shim-capture.txt`](../../../experiments/issue-2130/codex-shim-capture.txt),
a fake `codex` that records its argv):

```text
--sandbox read-only
-c model_providers.formalai.base_url=…  -c model_provider=\"formalai\"  -c model=\"formal-ai\"
exec --model formal-ai --json --skip-git-repo-check
```

Hive Mind appends its own overrides **after** `exec` ([`src/codex.lib.mjs:870`](../../../src/codex.lib.mjs)):

```js
codexArgs += ` --json --skip-git-repo-check -o ${shellQuote(lastMessageFile)} -c ${shellQuote(`model_reasoning_effort=${reasoningEffort}`)} -c ${shellQuote('model_reasoning_summary=auto')}`;
```

[`experiments/issue-2130/repro-codex-c-order.sh`](../../../experiments/issue-2130/repro-codex-c-order.sh)
runs the same prompt three ways against one live Formal AI server, changing only where the `-c`
overrides sit. Each variant gets a fresh `CODEX_HOME` whose `config.toml` is written identically (a
bare `trust_level = "trusted"` entry), so no on-disk state can account for the difference. The
provider each session actually resolved is read back out of its own session rollout
(`payload.model_provider`), not inferred from the outcome:

| Variant                                           | `-c` placement                                       | Session `model_provider` | 401s | Outcome                                                             |
| ------------------------------------------------- | ---------------------------------------------------- | ------------------------ | ---- | ------------------------------------------------------------------- |
| [before](data/runs/codex-order-before.stdout.log) | provider block only, all before `exec`               | `formalai`               | 0    | reaches Formal AI — `turn.completed`, `input_tokens: 24484`, exit 0 |
| [after](data/runs/codex-order-after.stdout.log)   | provider block before `exec` **+ Hive Mind's after** | `openai`                 | 7    | `401 Unauthorized` against `api.openai.com`, `turn.failed`, exit 1  |
| [fixed](data/runs/codex-order-fixed.stdout.log)   | both sets before `exec`                              | `formalai`               | 0    | identical to _before_                                               |

The only change between _before_ and _after_ is appending `-c model_reasoning_effort=none -c
model_reasoning_summary=auto` after `exec` — and that replaces the whole global set: a session that
had been configured with `model_provider=formalai` comes up as `openai`. Moving the same two
overrides ahead of `exec` (_fixed_) restores it. This is exactly the shape of the production log,
where Hive Mind's `-c model_reasoning_effort=…` also sits after `exec`.

Two consequences worth separating:

- **The workaround is on our side** and needs no upstream change: pass Hive Mind's `-c` overrides
  before the subcommand, or hand codex a prepared `CODEX_HOME` instead of overrides.
- **The upstream defect is real regardless**: codex-cli 0.146.0 silently discards a previously
  supplied provider configuration rather than merging it or rejecting the combination, which turns
  a configuration mistake into an authentication error against a completely different vendor. Since
  `formal-ai with codex` is what chooses the global position, this is reported against Formal AI —
  it can defend itself by materialising a `CODEX_HOME` instead of relying on argv precedence.

Two further observations from the same three runs:

- All variants print `Model metadata for 'formal-ai' not found. Defaulting to fallback metadata;
this can degrade performance and cause issues.` — separate and non-fatal, but it means codex is
  guessing the context window.
- Even the two _successful_ variants produce no useful work. Asked to `Reply with the single word:
ok`, Formal AI routes to its unknown handler and answers "I could not determine `Reply with the
single word: ok` from local Links Notation memory, cached public knowledge, or the source cache,
  and cannot infer a verified answer." So repairing the transport is necessary but not sufficient —
  §6 covers the reasoning-side defects that remain once the request does arrive.

### 3.4 What the three have in common

Not a single mechanism, but a single consequence: **in none of the three runs did a model receive
the task and attempt it.** Two failed before inference started; the third started and substituted a
bookkeeping task for the real one. That is why the reporter sees the same empty result from all
three tools despite three different error messages.

---

## 4. Hive-Mind-side defects (R1) — what the logs showed and what changed

R1 asks for false positives, false negatives, warnings and errors on the Hive Mind side to be fixed
**first**. Each item below is driven by a specific line in a stored log.

### 4.1 False negative — "No working session summary available from AI tool output"

agent 0.25.x and OpenCode nest assistant text one level down:

```json
{ "type": "text", "part": { "type": "text", "text": "…" } }
```

The stream parser only read a top-level `data.text`, so `resultSummary` was `null` for **every**
successful run and Hive Mind reported that no summary was available. Fixed in the parsers; covered
by `tests/test-issue-2130-formal-ai-runtime.mjs`.

### 4.2 False positive — `WARNING` from codex on every single run

codex-cli 0.146.0 refuses to create its PATH helper binaries when `CODEX_HOME` lives under the
system temp directory, and prints a warning. Hive Mind put the throwaway Formal AI `HOME` in
`os.tmpdir()`. Moved to `~/.cache/hive-mind/formal-ai`; verified in
[`data/runs/e2e-codex-home-root-fix.log`](data/runs/e2e-codex-home-root-fix.log).

### 4.3 False positive — an expected 404 printed as an error

`checkFileInBranch` asks GitHub whether a file exists on a branch. "Absent" is the normal answer,
but the probe printed `gh: Not Found (HTTP 404)` on a miss and the entire contents payload on a hit
([`claude-02-FTn7sm.log:84,86`](data/tool-logs/claude-02-FTn7sm.log)).

### 4.4 Error — `gh auth setup-git` on a bind-mounted `~/.gitconfig`

```text
failed to set up git credential helper: failed to run git: error: could not write config file
/home/box/.gitconfig: Device or resource busy
```

— [`claude-02-FTn7sm.log:106`](data/tool-logs/claude-02-FTn7sm.log) and
[`codex-02-rv2k7W.log.gz:112`](data/tool-logs/codex-02-rv2k7W.log.gz)

Hive Mind mirrored the raw error and then continued **with no credential helper at all**. It now
falls back to a clone-local helper, so the run keeps working and the message becomes informational.

### 4.5 Wrong remedy — "Please run: codex login"

```text
❌ Error executing Codex command: Codex authentication failed - 401 Unauthorized. Please run: codex login
```

— [`codex-02-rv2k7W.log.gz:765`](data/tool-logs/codex-02-rv2k7W.log.gz)

When the model is served by Formal AI the CLI never talks to the vendor, so `codex login` /
`claude login` is advice that cannot help. `buildAuthRemedyLines` now substitutes Formal-AI-specific
guidance.

### 4.6 Log noise — raw `gh`/`git` payloads mirrored into the attached log (R10)

This is the largest and least obvious item, and the one that most directly produces the "unexplained
errors" impression the issue complains about.

`src/lib.mjs:349` patches `process.stdout.write` and copies everything to the log file that
`--attach-logs` later uploads. That is correct for the AI tool's own output. But command-stream
mirrors every child process's stdout by default, so Hive Mind's own **read-only probes** — the ones
it runs to answer questions about itself — dumped their raw payloads into that log, between the
solver's own sentences, where they read as unexplained output or as errors.

Measured over the stored logs (`[STDOUT]`-tagged bytes ÷ total bytes):

| Log                                                               | Total      | Mirrored `[STDOUT]` | Share  |
| ----------------------------------------------------------------- | ---------- | ------------------- | ------ |
| [`claude-02-FTn7sm.log`](data/tool-logs/claude-02-FTn7sm.log)     | 96,333     | 36,673              | 38.1 % |
| [`codex-02-rv2k7W.log.gz`](data/tool-logs/codex-02-rv2k7W.log.gz) | 336,114    | 36,768              | 10.9 % |
| [`agent-18-V7E0Ee.log.gz`](data/tool-logs/agent-18-V7E0Ee.log.gz) | 4,456,925  | 455,076             | 10.2 % |
| [`agent-11-0JuEzF.log.gz`](data/tool-logs/agent-11-0JuEzF.log.gz) | 11,046,857 | 597,193             | 5.4 %  |

What those bytes are, in `agent-11-0JuEzF.log.gz`:

- **12 copies of a ~33.5 KB pull-request JSON object** — one per watch iteration of
  `checkGitHubTerminalState`, whose only question is "does this PR still exist?".
- **46,070 / 41,504 / 36,938 B comment-list dumps** — the post-finish sanitization sweep paginating
  `…/issues/N/comments`. In `agent-18` the same dump reappears once per restart and grows with the
  conversation: 57,544 → 62,166 → 66,788 → 71,410 → 76,032 → 80,654 B.
- **`konard` on a line by itself, 23 times** — `gh api user --jq .login`.
- **`public`, 12 times** — `gh api repos/…/… --jq .visibility`.
- **`I_kwDO…` and `PR_kwDO…`** — GraphQL node ids fetched to link the issue to the PR.
- **A live credential in clear text** — `gh auth status --show-token`, whose entire purpose is to
  print the token. This one is a security problem, not merely noise: the sanitizer masks tokens it
  _knows about_, and this is the call that discovers them.

The fix is a shared idiom rather than 40 scattered edits. `src/quiet-probe.lib.mjs` exports:

```js
export const QUIET_PROBE = Object.freeze({ mirror: false, capture: true });
export const quietProbe = dollar => {
  /* binds QUIET_PROBE, or returns dollar unchanged */
};
```

`capture: true` is not optional: it is what keeps `result.stdout` available to the caller, so the
probe is silenced without silencing the answer. Two call forms exist because roughly half the
helpers receive `$` as an injected parameter and the doubles callers pass are plain tagged templates
that throw `TypeError: strings.reduce is not a function` on `$({…})`:

- module-owned `$` → `await $(QUIET_PROBE)\`gh api …\``
- injected `$` → `await quietProbe($)\`gh api …\``(memoised per`$`in a`WeakMap`, falls back to
  the tag unchanged, and swallows the thenable a non-configurable tag may return)

`wrapDollarWithGhRetry` was extended to forward command-stream's options-call form, so the idiom
composes with rate-limit retry — all 24 modules build their `$` through that wrapper.

Applied repo-wide (R10) across 20 modules: `github-terminal-state`, `post-finish-sanitization-sweep`,
`token-sanitization`, `github`, `solve.feedback` (12 `gh api` reads and both `git log` date probes),
`git` (`getGitVersionAsync`'s four probes), `solve.auto-pr`, `solve.repo-setup`, `github-error-reporter`,
`solve.fork-sync`, `solve.results`, `solve.execution`, `solve.auto-continue`, `solve.repository`,
`bidirectional-interactive`, `solve.branch-errors`. Sites already using `$({ silent: true })` or a
private `$silent` were left alone.

`tests/test-issue-2130-log-noise.mjs` covers this with 23 tests, including a repo-wide static guard
that fails if any `src/**/*.mjs` reintroduces a bare, mirrored `gh api user --jq .login`.

### 4.7 Debug output for the next iteration (R9)

Where a root cause could not be pinned from the existing logs, the diagnosis was made observable
rather than guessed:

- Codex post-run diagnostics moved to `src/codex.run-diagnostics.lib.mjs`, which makes the
  "is this a real warning?" decision a unit-testable function instead of an inline `if`. A failed
  codex run legitimately writes no `--output-last-message` file and emits no `turn.completed` usage;
  both used to be logged as `WARNING`, so one upstream failure produced two extra warnings pointing
  at nothing.
- The Formal AI runtime logs, at info level, the endpoint, protocol, config mechanism and the exact
  set of environment variables it injects — the `🧠 Formal AI:` lines visible throughout
  [`data/runs/e2e-final-summary.log`](data/runs/e2e-final-summary.log). That is what makes §5's
  per-tool table checkable at a glance.
- **The Formal AI wrapper version is now recorded** (`src/formal-ai.lib.mjs`,
  `src/solve.validation.lib.mjs`). Dispatch validation already read the native CLI's `--version`
  but never the wrapper's, so none of the four round-2 logs names the build that produced them —
  which is the single reason §3.1's mechanism could not be pinned down and had to be recorded as a
  negative result. The version is now logged on the success path and on the failure path, since the
  failure path is the one whose log gets attached to the pull request. The lookup is diagnostics and
  never a gate: a wrapper that cannot answer `--version` still dispatches, and the field is simply
  reported as `unknown`.

---

## 5. Making `--model formal-ai` actually work for every tool (R3, R4)

### 5.1 The design decision

`formal-ai with <tool>` cannot be fixed from Hive Mind. What _can_ be done is to stop using it as an
argv wrapper and use Formal AI the way any other model provider is used: as an HTTP endpoint.

`src/formal-ai-runtime.lib.mjs` does this:

1. Start `formal-ai serve --agent-mode` with the repository clone as its `cwd`.
2. Run `HOME=<isolated> formal-ai with --global --no-start-server --base-url <url> <tool>` once, to
   let Formal AI itself materialise the per-client configuration it wants.
3. Translate that configuration into environment variables (or a config path) for the tool.
4. Invoke the **native** CLI, unchanged, with those variables.

`--dry-run` and `--only-prepare-command` never start a server and never write config.

### 5.2 Per-tool configuration channel

Captured live against formal-ai 0.317.0 —
[`data/runs/e2e-final-summary.log`](data/runs/e2e-final-summary.log):

| Tool     | Protocol  | Config channel                                                  | Environment injected                                                                                                                                         |
| -------- | --------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| claude   | anthropic | `.profile` shell env                                            | `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `FORMAL_AI_API_KEY`                                                                                            |
| agent    | openai    | `XDG_CONFIG_HOME`, seeded from `~/.config/link-assistant-agent` | `FORMAL_AI_API_KEY`, `XDG_CONFIG_HOME`                                                                                                                       |
| codex    | openai    | `CODEX_HOME`, seeded from `~/.codex`                            | `CODEX_HOME`, `FORMAL_AI_API_KEY`                                                                                                                            |
| qwen     | openai    | `.profile` shell env + `OPENAI_MODEL`                           | `FORMAL_AI_API_KEY`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`                                                                                     |
| gemini   | gemini    | `GEMINI_CLI_SYSTEM_SETTINGS_PATH`                               | `FORMAL_AI_API_KEY`, `GEMINI_API_KEY`, `GEMINI_CLI_SYSTEM_SETTINGS_PATH`, `GEMINI_CLI_TRUST_WORKSPACE`, `GEMINI_DEFAULT_AUTH_TYPE`, `GOOGLE_GEMINI_BASE_URL` |
| opencode | openai    | `XDG_CONFIG_HOME`, seeded from `~/.config/opencode`             | `FORMAL_AI_API_KEY`, `XDG_CONFIG_HOME`                                                                                                                       |

All six exit 0 against a live Formal AI server. Note the issue names five tools (claude, codex,
agent, gemini, qwen); opencode is included because it shares the runtime and would otherwise be the
one tool left on the old path.

### 5.3 Sub-problems that only appear headless

- **codex provider configuration.** Rather than depend on `-c` override ordering — the thing that
  demonstrably did not survive in §3.3 — the provider block is written into `CODEX_HOME`, seeded
  from the repository-scoped `CODEX_HOME` built by the capability preflight (issue #2074), so both
  features coexist and the configuration cannot be lost to argv resolution.
- **`sh -lc` and stale `.profile` exports.** codex and qwen run through a login shell, which sources
  the operator's `~/.profile` — which may still hold exports from an earlier
  `formal-ai with --global` run. The run's environment is re-exported inside the script so it wins.
- **gemini headless auth.** Gemini CLI resolves `security.auth.selectedType` from the settings
  hierarchy and aborts with `Invalid auth method selected.` when it is unset;
  `GEMINI_DEFAULT_AUTH_TYPE` is interactive-only. Hive Mind supplies the missing setting through
  `GEMINI_CLI_SYSTEM_SETTINGS_PATH`, so `HOME` — and with it the operator's git/gh/ssh
  configuration — stays untouched.
- **qwen headless auth.** `getAuthTypeFromEnv` in qwen-code 0.21.2 only returns the OpenAI auth type
  when `OPENAI_API_KEY`, `OPENAI_BASE_URL` **and** one of `OPENAI_MODEL` / `QWEN_MODEL` are all set.
  The `.profile` block `formal-ai with --global` writes contains only the first two, so every
  headless run aborted with _"No auth type is selected."_ `buildQwenAuthEnv` completes the triple,
  and only when the operator has not already set one.

### 5.4 What "works" means here — and what it does not

With the direct-endpoint runtime, all six CLIs reach Formal AI, stream tool calls, and exit 0. That
satisfies R3 and R4 on the Hive Mind side: the plumbing is no longer the thing that fails.

It does **not** yet produce a correct hello world, and the reason is now visible instead of hidden.
In every one of the six final runs, `hello.txt=MISSING`
([`data/runs/e2e-final-summary.log`](data/runs/e2e-final-summary.log)). §6 is what happens with
that.

---

## 6. Upstream defects, with reproductions (R2, R5)

These are defects in Formal AI 0.317.0 and, for one item, in codex-cli. Each has a stored
reproduction. The wrapper defects of §3 are the highest-severity group; the reasoning defects below
are what remains once the wrapper is bypassed.

All of them have been filed:

| Issue                                                                   | Defect                                                                                                                            | Reproduction                                                      | Here |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---- |
| [formal-ai#902](https://github.com/link-assistant/formal-ai/issues/902) | codex provider config is discarded by `-c` precedence; traffic goes to `api.openai.com`                                           | `data/runs/codex-order-{before,after,fixed}.*.log`                | §3.3 |
| [formal-ai#903](https://github.com/link-assistant/formal-ai/issues/903) | five argv-construction defects (double prefix, dropped `--verbose`, injected `--interactive`, codex `-p`/`exec`, retry flag loss) | `data/runs/wrapper-argv.log`                                      | §3.2 |
| [formal-ai#904](https://github.com/link-assistant/formal-ai/issues/904) | agent mode reduces a repository task to plan-and-`cat`; `goal` carries the caller's system prompt                                 | `data/runs/direct-agent.log`                                      | §3.2 |
| [formal-ai#905](https://github.com/link-assistant/formal-ai/issues/905) | success reported for a turn in which every tool call failed                                                                       | `data/runs/direct-qwen.log`                                       | §6.4 |
| [formal-ai#906](https://github.com/link-assistant/formal-ai/issues/906) | language router extracts a token by position; refuses on `language "the"` / `"missing"`                                           | `data/probes/formal-ai-0.317.0-language-extraction.md`            | §6.1 |
| [formal-ai#907](https://github.com/link-assistant/formal-ai/issues/907) | intent router answers the caller's framing, making gemini unusable                                                                | `data/probes/formal-ai-0.317.0-intent-hijack.log`                 | §6.5 |
| [formal-ai#908](https://github.com/link-assistant/formal-ai/issues/908) | verification verdict tracks output presence, not exit code                                                                        | `data/runs/e2e-qwen.log`, `direct-qwen.log`, `direct-gemini3.log` | §6.6 |
| [formal-ai#909](https://github.com/link-assistant/formal-ai/issues/909) | `--global` writes a headless config both gemini and qwen reject                                                                   | `data/probes/formal-ai-0.317.0-headless-config-gaps.log`          | §6.7 |

### 6.1 Formal AI answers "no synthesis route" unless the prompt names a language

`data/probes/formal-ai-0.317.0-language-extraction.md` records the model's own words for seven
prompts against the same server. The pattern is unambiguous:

| Prompt                                                                 | Result                                                            |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `Create a file named hello.txt … Then stop.`                           | `no synthesis route reaches task "hello_world" in language "the"` |
| `Create a file named hello.txt containing Hello World.`                | `… in language "missing"`                                         |
| `print hello world`                                                    | `… in language "missing"`                                         |
| `Write a hello world program in Python.`                               | ✅ correct program, with check/run commands and output            |
| `Create a file named hello.txt containing Hello World, in JavaScript.` | ✅ correct program                                                |

The router extracts a "language" token from the prompt by position rather than by meaning: in the
first prompt it picked the article **`the`** as the language name. When no candidate is found it
substitutes the literal string `missing` and then reports that it has no idiom for a language called
`missing`. This is the direct cause of R5 not being met: the model _can_ reason its way to a hello
world (rows 4–5 prove it), and refuses to when the language is implicit.

Suggested fix, in the issue to file: treat an unresolved language as "infer from context or ask",
not as a language named `missing`; and exclude stop-words from the language-candidate scan. A
workaround usable today is to append the target language to the prompt.

### 6.2 Formal AI takes the literal text after "containing" as the file content

`direct-gemini3.log` and `direct-qwen.log` both show the prompt
_"Create a file hello.txt containing exactly: Hello World"_ producing a `write_file` call whose
content is:

```text
exactly: Hello World
```

— [`data/runs/direct-gemini3.log`](data/runs/direct-gemini3.log)

The extractor slices the prompt after the keyword rather than parsing it. The word `exactly:` — an
instruction _about_ the content — became part of the content.

### 6.3 Formal AI absolutizes paths against a stale directory

In [`data/runs/direct-qwen.log`](data/runs/direct-qwen.log) the run's workspace is `…/ws-qwen`, but
every `file_path` Formal AI emits points at `…/ws2/` — a directory from an earlier probe. All three
tool calls therefore failed. The server is absolutizing tool paths against its own remembered cwd
instead of the client's, so any client whose cwd differs from the server's gets unusable paths.
Reproduction: start `formal-ai serve --agent-mode` in directory A, drive it from a client in
directory B, and observe the emitted `file_path`.

### 6.4 Formal AI reports success for a turn in which every tool call failed

Same log, same run. The three tool results were:

```text
is_error: true  File …/ws2/.formal-ai/general-change-plan.lino has not been read in this session
is_error: true  File …/ws2/hello.txt has not been read in this session
is_error: true  Command: cat hello.txt … Output: cat: hello.txt: No such file or directory … Exit Code: 1
```

and Formal AI's final message was:

> Completed the general change request for hello.txt and **verified it** with `cat hello.txt`.

This is the most serious of the reasoning defects, because it is a false claim of verification —
the opposite of the "nothing was guessed" guarantee the model states in §6.1's refusals. A model
that refuses to emit an underived program should equally refuse to report an unobserved success.

### 6.5 Formal AI answers the caller's framing instead of the request — gemini is unusable

This one is decisive for R3: on 0.317.0 the `gemini` CLI cannot drive Formal AI at all, and the
reason is a single sentence the CLI injects.

Every gemini turn is prefixed with a `<session_context>` block containing
`Today's date is <date> (formatted according to the user's locale).` In agent mode with tools
declared, Formal AI's intent router matches text anywhere in the request — including the caller's
framing — and treats that _declarative_ sentence as a question to answer. It calls
`run_shell_command("date")` and never acts on the request that follows.

[`repro-intent-hijack.sh`](../../../experiments/issue-2130/repro-intent-hijack.sh) holds the server,
protocol, tool declarations and request (`Write a hello world program in Python.`) constant and
varies only one line of caller context
([`formal-ai-0.317.0-intent-hijack.log`](data/probes/formal-ai-0.317.0-intent-hijack.log)):

| Caller context                                 | Formal AI's tool call         |
| ---------------------------------------------- | ----------------------------- |
| the real gemini `<session_context>`            | `run_shell_command("date")`   |
| the same block, only the date sentence removed | `write_file("main.py", …)` ✅ |
| `Today's date is Sunday, August 2, 2026.`      | `run_shell_command("date")`   |
| `The current time is 20:00.`                   | `run_shell_command("date")`   |
| `The date is Sunday.`                          | `write_file("main.py", …)` ✅ |
| `Today is Sunday, August 2, 2026.`             | `write_file("main.py", …)` ✅ |
| `date`                                         | `write_file("main.py", …)` ✅ |
| `My operating system is: linux`                | `write_file("main.py", …)` ✅ |
| (no context at all)                            | `write_file("main.py", …)` ✅ |

The trigger is phrase-level, not keyword-level: the bare word `date` does not fire it, and
`Today is …` does not either, but `Today's date is …` and `The current time is …` both do.

Five other hypotheses were tested first and **disproved** — the gemini protocol adapter, the session
preamble as such, system-prompt size (swept 0 → 73,438 prompt tokens), the mere presence of tool
declarations, and multi-part turns. Each has a script in `experiments/issue-2130/`
(`repro-gemini-protocol.sh`, `repro-preamble-routing.sh`, `repro-system-prompt-size.sh`,
`repro-toolcall-routing.sh`, `repro-multipart-parts.sh`). They are recorded in
[formal-ai#907](https://github.com/link-assistant/formal-ai/issues/907) to shrink the maintainer's
search space rather than discarded.

### 6.6 The verification verdict tracks output presence, not the exit code

§6.4 showed a failing command reported as success. The same predicate fires in the opposite
direction, and there it destroys correct work:

| Log                                                  | Verification command            | `Output:`               | `Exit Code:` | Verdict       |
| ---------------------------------------------------- | ------------------------------- | ----------------------- | ------------ | ------------- |
| [`direct-gemini3.log`](data/runs/direct-gemini3.log) | `cat hello.txt`                 | `exactly: Hello World`  | `0`          | success ✓     |
| [`direct-qwen.log`](data/runs/direct-qwen.log)       | `cat hello.txt`                 | `cat: … No such file …` | **`1`**      | **success** ✗ |
| [`e2e-qwen.log`](data/runs/e2e-qwen.log)             | `python3 -m py_compile main.py` | `(empty)`               | **`0`**      | **failure** ✗ |

Row 3 is a correct hello-world program thrown away because Formal AI chose `py_compile` as its own
verification step and then read that command's documented silence-on-success as a failure. The exit
code was available — Formal AI quoted the whole `Exit Code: 0` block back verbatim in its failure
message. Filed as [formal-ai#908](https://github.com/link-assistant/formal-ai/issues/908).

### 6.7 `formal-ai with <tool> --global` writes a config both gemini and qwen reject

[`repro-headless-config-gaps.sh`](../../../experiments/issue-2130/repro-headless-config-gaps.sh)
runs each CLI twice — with exactly what `--global` writes, and with that plus the one missing piece
([`formal-ai-0.317.0-headless-config-gaps.log`](data/probes/formal-ai-0.317.0-headless-config-gaps.log)):

| Tool     | What `--global` writes                                                    | Missing                                  | Without it                                                                           |
| -------- | ------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------ |
| `gemini` | `GEMINI_API_KEY`, `GEMINI_DEFAULT_AUTH_TYPE`, `GOOGLE_GEMINI_BASE_URL`, … | `security.auth.selectedType` in settings | `Invalid auth method selected.` — refuses to start                                   |
| `qwen`   | `OPENAI_API_KEY`, `OPENAI_BASE_URL`                                       | `OPENAI_MODEL`                           | `No auth type is selected. Please configure an auth type … in non-interactive mode.` |

Both CLIs read auth selection from a settings file, not from environment variables alone, so the
env-only setup can never be sufficient for them. Filed as
[formal-ai#909](https://github.com/link-assistant/formal-ai/issues/909). Hive Mind is not affected:
§5.2 takes the programmatic route and materialises both pieces in
[`src/formal-ai-runtime.lib.mjs`](../../../src/formal-ai-runtime.lib.mjs).

### 6.8 Negative result — no `link-assistant/agent` filing is warranted

R2 asks for reports to `link-assistant/agent` as well as `link-assistant/formal-ai`. After testing,
there is nothing to file there, and this section records why rather than leaving the requirement
looking unexamined.

The one candidate was the agent run that produced no work across six attempts (§2). §3.2.1 item 3
originally attributed that to the injected `--interactive` flag hanging on piped stdin.
[`repro-agent-interactive-stdin.mjs`](../../../experiments/issue-2130/repro-agent-interactive-stdin.mjs)
disproves it: agent 0.25.5 — the production version — exits 0 in 4 s with stdin closed, in both the
plain and the `--interactive` shape. The 5/5 restarts were Hive Mind's own
auto-restart-until-mergeable feature reacting to an empty result, and every remaining agent-side
symptom traces to Formal AI's argv construction, already filed as
[formal-ai#903](https://github.com/link-assistant/formal-ai/issues/903).

`agent` behaved correctly throughout. The correction was also posted to #903 so the severity there
is not overstated.

### 6.9 Other reproductions held for the upstream reports

Each of these has a stored reproduction against formal-ai 0.317.0.

- **codex provider configuration never reaches the session** (§3.3): `formal-ai with codex` supplies
  the provider block in a position codex-cli discards as soon as the caller adds any `-c` of its
  own, and the traffic then goes to `api.openai.com`. The bisection in §3.3.1 is the reproduction.
- **`codex exec` is given a `-p <prompt>` flag it does not have** (§3.2.1), and in the piped shape
  the `exec` subcommand is dropped entirely, so codex launches its interactive TUI.
- **The provider prefix is applied twice for `agent`** — `--model formalai/formal-ai` becomes
  `--model formalai/formalai/formal-ai` (§3.2.1).
- **`--verbose` is silently dropped for every tool**, and `--interactive` is injected for `agent`
  in a piped, headless invocation (§3.2.1).
- **Caller passthrough flags do not survive a retry** — `--dangerously-skip-permissions`,
  `--mcp-config`, `--strict-mcp-config` and `--disallowedTools` are all absent from attempt 2
  onwards (§3.1.1).
- **The recovery ladder describes the request as the caller's raw flag string** (§3.1.1), the same
  goal pollution as the `goal` field carrying the caller's entire system prompt (§3.2).
- The agent-mode reduction of a repository task to "write a plan file and `cat` it back" (§3.2).
- `write_stdin failed: Unknown process id 0` observed in the round-2 agent logs.
- The claude prompt loss seen in production (§3.1) is **not** reproducible on 0.317.0; the upstream
  ask there is a regression test over the forwarded argv, not a specific line to change.

---

## 7. Existing components and libraries considered (R8)

| Problem                                                   | Considered                                                                                                 | Decision                                                                                                                                                                                               |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Suppressing mirrored child-process output                 | command-stream's own `{ mirror, capture }` options; `execa`'s `stdio: 'pipe'`; Node `child_process`        | Used command-stream's options-call form. It is already the repo-wide execution layer; introducing a second one for probes would double the escaping rules and defeat `eslint-rules/no-direct-gh-exec`. |
| Keeping the "quiet" idiom composable with retries         | Wrapping at each call site vs. teaching the wrapper                                                        | Taught `wrapDollarWithGhRetry` to forward the options call. All 24 modules build `$` through it, so one change covers every site.                                                                      |
| Tolerating injected `$` doubles                           | Auto-allowlisting inside `wrapDollarWithGhRetry`; a type guard at every site                               | `quietProbe()` with a `WeakMap`, because `tests/github-rate-limit.test.mjs:355-410` passes plain arrow-function tags that are not option-callable.                                                     |
| Masking secrets before publication                        | `src/token-sanitization.lib.mjs` (already exists, issue #1745)                                             | Reused. §4.6 removes the one call whose output is unmaskable _by construction_ — the token-discovery call itself.                                                                                      |
| Driving a local OpenAI-compatible endpoint                | `formal-ai with`; LiteLLM-style proxy; direct env-var injection                                            | Direct env-var injection. Every CLI already supports `*_BASE_URL` + API key, so no proxy layer is needed and the native argv stays under Hive Mind's control.                                          |
| Isolating per-run config without touching operator `HOME` | `HOME=` override; `XDG_CONFIG_HOME`; tool-specific roots (`CODEX_HOME`, `GEMINI_CLI_SYSTEM_SETTINGS_PATH`) | Tool-specific roots wherever one exists, so the operator's git/gh/ssh configuration is never shadowed. `HOME` is overridden only for the throwaway config-materialisation step.                        |
| Terminal-state detection in watch loops                   | `src/github-terminal-state.lib.mjs` (issue #1931)                                                          | Reused unchanged; only its default command runner was made quiet.                                                                                                                                      |

---

## 8. Solution plan status

| Requirement | Plan                                                                                                        | Where                                                                                    |
| ----------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| R1          | Fix each false positive/negative/warning/error evidenced in the stored logs; add regression tests           | §4; `tests/test-issue-2130-log-noise.mjs`, `tests/test-issue-2130-formal-ai-runtime.mjs` |
| R2          | File upstream issues with the reproductions in §6 — formal-ai#902–#909; none warranted for `agent` (§6.8)   | §6                                                                                       |
| R3, R4      | Direct-endpoint runtime for all six CLIs                                                                    | §5; `src/formal-ai-runtime.lib.mjs`                                                      |
| R5          | Upstream — the language router (#906), the intent router (#907), the verification verdict (#905, #908)      | §6.1, §6.4, §6.5, §6.6                                                                   |
| R6, R7      | This folder and this file                                                                                   | [`data/`](data/)                                                                         |
| R8          | Component survey                                                                                            | §7                                                                                       |
| R9          | Codex run diagnostics extracted and unit-tested; Formal AI runtime logs endpoint/protocol/config/env        | §4.7                                                                                     |
| R10         | Quiet-probe idiom applied across all 20 affected modules, with a repo-wide static test guarding regressions | §4.6                                                                                     |
