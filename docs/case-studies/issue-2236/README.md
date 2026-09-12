# Issue #2236: An autonomous run should pay for the task, not for the interface

## Summary

Every agentic CLI hive-mind drives has grown a set of _auxiliary_ model calls — a classifier that judges whether a command is safe, a small model that writes a session title, another that narrates progress, another that drafts follow-up prompts a human might want to click. All of them are made for a person watching a terminal. In a hive-mind task there is no such person: the container opens a pull request and is destroyed, and every one of those calls bills against the same rate limit and the same credit balance as the work.

This case study records what each tool ships today, which knob turns each auxiliary call off, how that knob was verified, and — more carefully than the rest — which knobs were deliberately **left on**, because the issue carves out one exception and an exception that is only an omission does not survive the next person who adds "one more thing to disable".

Companion to [issue #2178](../issue-2178/README.md), which did the same work for cross-task memory and the auto-mode classifier. This one covers everything else in the same family.

## Problem statement

From the issue, verbatim:

> Please review current status of all features like:
>
> - auto classifier (uses LLM to check if a command is safe to execute)
> - memory (uses LLM to read and write memories)
> - title generation (uses LLM to create a title for dialog)
> - recap
> - and so on… (please carefully investigate all of them)
>
> All these features must be disabled by default in all supported tools like claude, codex and so on. These tools are not applicable in autonomous workflow as we use in Hive Mind, and can waste additional AI tokens draining limits or AI credits/money.
>
> Exception of course would be auto summarization, as it essential to not get to context overload and continue to operate on long horizon tasks. So summary of dialog must be kept active.

Three separate costs, and they are not equally important:

1. **Tokens billed against the task's own limit.** Every auxiliary call shares the account, the rate limit and the credit balance with the work. A run that hits its limit half-way through a task loses the task, not just the title.
2. **Latency on the critical path.** OpenCode's `ensureTitle` and Gemini's next-speaker check both sit in the turn loop. The wall-clock cost is small per turn and is paid every turn.
3. **Nobody reads the output.** A session title is for a session list. A narration is for a spinner. A follow-up suggestion is for a person deciding what to type next. None of these artefacts is ever looked at in a disposable container.

And one thing that is emphatically _not_ a cost: **compaction**. Summarizing a dialog that has outgrown its context window is what makes a long-horizon task possible at all. Turning it off to save the summarizer's tokens would cost the whole task. The issue says this and the implementation treats it as a first-class requirement, not as a thing we happened not to touch.

## Requirements, extracted

The issue is prose; these are the obligations it creates. Each row links to where it is enforced.

| #   | Requirement                                                              | Status | Enforced by                                                                                                                                            |
| --- | ------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | Review the current status of the auto classifier in every supported tool | done   | [Auto classifier](#r1-the-auto-classifier) — resolved in #2178 for claude; re-verified here and extended to Codex and Qwen                             |
| R2  | Review the current status of memory in every supported tool              | done   | [Memory](#r2-memory-re-verified--and-a-regression-found) — a **live regression** was found in the Qwen wiring and fixed                                |
| R3  | Review the current status of title generation in every supported tool    | done   | [Title generation](#r3-title-generation)                                                                                                               |
| R4  | Review the current status of recap                                       | done   | [Recap and narration](#r4-recap-narration-suggestions-and-tool-use-summaries)                                                                          |
| R5  | "and so on… (please carefully investigate all of them)" — find the rest  | done   | [The full inventory](#the-full-inventory) — 33 Claude `querySource` labels enumerated, Codex's 135 feature flags listed, Qwen's settings schema dumped |
| R6  | All of them disabled **by default**, in **all** supported tools          | done   | `src/auxiliary-model-calls-policy.lib.mjs`; `isAuxiliaryModelCallsDisabled({})` is `true`                                                              |
| R7  | Auto summarization must stay **active** — the stated exception           | done   | [What stays on](#what-stays-on-and-why-that-is-tested) — eleven negative assertions in `tests/test-issue-2236-auxiliary-model-calls-policy.mjs`        |
| R8  | Where unsure, write a proposal rather than guessing                      | done   | [Proposals](#proposals-for-what-was-deliberately-left-alone)                                                                                           |
| R9  | Compile the collected data into `./docs/case-studies/issue-2236`         | done   | this file and `data/`                                                                                                                                  |
| R10 | Search online for additional facts, beyond what the binaries say         | done   | [Sources](#sources) — upstream docs and issue trackers, cited per knob                                                                                 |
| R11 | Check known existing components/libraries that solve a similar problem   | done   | [Existing components considered](#existing-components-considered)                                                                                      |

## How this was investigated

The knob names in this document come from the shipped artefacts, not from documentation — documentation for an undocumented environment variable does not exist, and documentation for a documented one is frequently a release behind. The procedure, reproducible via `experiments/issue-2236/`:

- **Claude Code** — the bundled JS was dumped to a single file and searched for `CLAUDE_CODE_*` names, for the `querySource` label passed at each call site, and for the `tengu_*` GrowthBook flags each gate falls through to.
- **Codex** — `codex features list` for the live state of all 135 flags (`data/codex-features-list.txt`), plus `strings` over the binary for the prompt fragments and the Rust source paths, which reveal which code paths are TUI-only.
- **Gemini CLI / Qwen Code** — the settings schema was extracted from the bundle as `category | key = default` triples (`data/qwen-settings-schema.txt`), and each candidate key was counted to prove it exists in _that_ build.
- **OpenCode** — `strings` over the Bun-compiled binary, then an end-to-end check: write an `opencode.json`, run `opencode agent list` under a throwaway `XDG_CONFIG_HOME`, and diff the agent list against the baseline.

Versions verified: **claude-code 2.1.269, codex-cli 0.153.4, gemini-cli 0.58.0, qwen-code 0.23.0, opencode 1.18.29, @link-assistant/agent 0.26.1.**

## The full inventory

### R1: the auto classifier

Claude Code's auto-mode classifier was disabled in #2178 via `permissions.disableAutoMode: "disable"`, which is checked before the provider and model gates and therefore holds everywhere. Re-verified present in 2.1.269. Nothing to change.

Two things that look like classifiers and are not model calls were checked and left alone:

- **Codex `guardian_approval`** (stable, on) — the approval path is already governed by `--dangerously-bypass-approvals-and-sandbox`.
- **Qwen `tools.autoMode.classifyAllShell`** — belongs to Qwen's auto mode, which hive-mind does not use (`--approval-mode yolo`). See [Proposals](#proposals-for-what-was-deliberately-left-alone).

One _is_ a model call and is now off: **`CLAUDE_CODE_CLASSIFIER_SUMMARY`**. Setting it to `'0'` selects the `"heuristic"` summary engine instead of the LLM one — the classifier still classifies, it just stops asking a model to describe what it classified.

### R2: memory, re-verified — and a regression found

The #2178 policy writes `experimental.autoMemory: false` into both `~/.gemini/settings.json` and `~/.qwen/settings.json`. Re-verifying it here against qwen-code 0.23.0 turned up something the original change could not have known:

> **`experimental.autoMemory` does not occur in the qwen-code 0.23.0 bundle at all.**

Every remaining occurrence of the substring `autoMemory` is inside an unrelated identifier — `enableManagedAutoMemory` (18 hits), the local `const autoMemoryDir = getAutoMemoryRoot(params.projectRoot)` in `resolveQwenMemoryPaths` (5 hits as `this.autoMemory`, 1 as `layers.autoMemory`). There is no `experimental?.autoMemory` read anywhere. Qwen renamed the feature after forking Gemini CLI, and hive-mind has been writing a setting Qwen stopped reading: **auto-memory was silently back on for every `--tool qwen` run.**

The replacements, both defaulting to `true`, are `memory.enableManagedAutoMemory` (background extraction of memories from conversations) and `memory.enableManagedAutoDream` (background consolidation/dedup of them) — confirmed against [Qwen's own settings reference](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/settings/) and [its memory-system design doc](https://github.com/QwenLM/qwen-code/blob/main/docs/design/auto-memory/memory-system.md). Both are now written, for `qwen` only, via `GEMINI_FAMILY_MEMORY_DISABLE_SETTINGS_BY_TOOL`.

The legacy `experimental.autoMemory: false` is deliberately **kept** alongside them. It is inert on 0.23.0 and correct on older pinned builds, and a setting that is merely ignored costs nothing; removing it would silently un-fix anyone still on an older Qwen.

This is the kind of rot the "verified how" column exists to catch, and it is the strongest argument in this document for re-reading the binaries rather than trusting a policy that passed its tests. The tests passed the whole time.

### R3: title generation

| Tool     | Ships                                                                                                                                                                                                                                | Now                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| OpenCode | A hidden `title` **agent**, a separate model call. `SessionPrompt.ensureTitle` fires on every fresh `opencode run`, because the session title is still the generated `"New session - <ISO>"` default and `isDefaultTitle` matches it | `agent: { title: { disable: true } }` in the per-task `opencode.json` |
| OpenCode | A hidden `summary` agent, likewise                                                                                                                                                                                                   | `agent: { summary: { disable: true } }`                               |
| Codex    | Title/recap/branch-summary calls exist, but every call site is under `tui/src/app/*.rs` — unreachable from `codex exec`, which is what hive-mind runs                                                                                | nothing to do; recorded so the next reader does not re-derive it      |
| `agent`  | `--generate-title` already defaults to `false`                                                                                                                                                                                       | nothing to do (`TOOLS_ALREADY_COMPLIANT`)                             |
| claude   | no equivalent found in 2.1.269                                                                                                                                                                                                       | —                                                                     |

OpenCode has no documented switch for this; the upstream tracker carries several open requests for one ([#14779](https://github.com/anomalyco/opencode/issues/14779), [#33140](https://github.com/anomalyco/opencode/issues/33140), [#6228](https://github.com/anomalyco/opencode/issues/6228)), and the usual advice is to point the title agent at a cheaper model rather than to remove the call. Disabling the agent outright was therefore verified end-to-end before being relied on:

```console
$ XDG_CONFIG_HOME=/tmp/oc-test opencode agent list      # baseline
build (primary)      compaction (primary)   explore (subagent)
general (subagent)   plan (primary)         summary (primary)    title (primary)

$ cat /tmp/oc-test/opencode/opencode.json
{"$schema":"https://opencode.ai/config.json","agent":{"title":{"disable":true},"summary":{"disable":true}}}

$ XDG_CONFIG_HOME=/tmp/oc-test opencode agent list      # exit 0, no ConfigInvalidError
build (primary)      compaction (primary)   explore (subagent)
general (subagent)   plan (primary)
```

`compaction` survives, which is the whole point. This mattered to check: OpenCode rejects unknown top-level config keys with `ConfigInvalidError`, so a wrong guess here would not have been a no-op — it would have broken every `--tool opencode` run.

### R4: recap, narration, suggestions and tool-use summaries

These are all Claude Code, and they share a mechanism worth stating precisely, because it is why the implementation pins them to `0` rather than leaving them unset.

Claude Code has three kinds of gate: process environment variables, `~/.claude/settings.json` keys, and remote GrowthBook flags (`tengu_*`). The environment variables are parsed with a Zod `stringbool` whose falsy set is `false|0|no|off|n|disabled`. For three of these five, **when the variable is undefined the code falls through to the remote flag** — so an unset variable is not "off", it is "whatever the rollout says today, from a server we do not control".

| Variable                               | What it pays for                                      | Fall-through when unset                                  |
| -------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------- |
| `CLAUDE_CODE_ENABLE_REMOTE_RECAP`      | the recap named in the issue                          | GrowthBook `tengu_harbor_moth`                           |
| `CLAUDE_CODE_ENABLE_NARRATION`         | spoken/printed narration of progress                  | `tengu_pewter_kite_ms`                                   |
| `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION` | drafts the next prompt a human might want             | `tengu_chomp_inflection`                                 |
| `CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES`  | a model-written label per tool use                    | —                                                        |
| `CLAUDE_CODE_CLASSIFIER_SUMMARY`       | LLM (vs. heuristic) summary engine for the classifier | `tengu_classifier_summary_llm_emit`, `tengu_cobalt_wren` |

All five are now pinned to `0` in `REQUIRED_CLAUDE_QUIET_ENV` and in the `ENV` block of `Dockerfile`, `coolify/Dockerfile` and `Dockerfile.dind`.

Two plausible-sounding variables were checked and **do not exist**, and are recorded here so nobody re-invents them:

- `DISABLE_NON_ESSENTIAL_MODEL_CALLS` — not in the bundle. There is no single master switch.
- `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` — exists, but gates _telemetry and update checks_, not model calls. Setting it would not have helped, and believing it did would have closed this issue without fixing anything.

### R5: everything else

**Claude Code.** Each internal model call passes a `querySource` label; enumerating them gives 33 distinct labels in 2.1.269, which is the closest thing to a complete list of auxiliary calls that exists. After removing the ones that are the task itself, the ones already handled by #2178, and the ones with no local gate, the five above are what remains and what is actionable.

**Codex.** All 135 flags are in `data/codex-features-list.txt`. On by default and not needed by an autonomous run: `goals` and `personality`. `personality` is not a separate call — it injects `personality.spec_instructions` into the system prompt of _every_ request, so it is a per-turn token cost on the main conversation. Already `false` on a stock install and left alone: `memories`, `external_agent_memory_import`, `artifact`, `chronicle`, `context_management`, `concurrent_reasoning_summaries`, `multi_agent_v2`, `recommended_plugins`, `secret_auth_storage`.

The override mechanism was verified rather than assumed:

```console
$ codex -c features.goals=false -c features.personality=false features list | grep -E '^(goals|personality|memories) '
goals          stable  false
personality    stable  false
memories       stable  false
```

**Gemini CLI.** `model.skipNextSpeakerCheck` — a whole extra model call at the end of each turn to decide whether the model should speak again; [upstream added the setting](https://github.com/google-gemini/gemini-cli/discussions/6666) to let people skip it. `tools.disableLLMCorrection` — a second model call to repair a malformed tool call; in hive-mind a malformed call is retried by the task itself. Key presence confirmed by count in the 0.58.0 bundle (21 and 27 occurrences respectively).

**Qwen Code.** `model.skipNextSpeakerCheck` (10 hits), `experimental.emitToolUseSummaries` (7 hits) — [Qwen's docs](https://qwenlm.github.io/qwen-code-docs/en/users/features/tool-use-summaries/) describe it as "a short, git-commit-subject-style label after each tool batch", enabled by default, requiring a configured fast model — and `ui.enableFollowupSuggestions` (4 hits). `tools.disableLLMCorrection` has **0** occurrences in qwen-code 0.23.0 and is therefore deliberately _not_ written for Qwen: writing a setting the CLI never reads is exactly how the `experimental.autoMemory` regression happened.

## What stays on, and why that is tested

The issue's exception, made explicit per tool:

| Tool     | Summarization mechanism                                                          | Guarded by                                                                                                             |
| -------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| claude   | auto-compaction                                                                  | `DISABLE_AUTO_COMPACT` and `DISABLE_COMPACT` must never appear in the quiet env, the quiet settings, or any Dockerfile |
| codex    | `remote_compaction_v2`, `compaction_image_budget`                                | must never appear in `buildCodexAuxiliaryDisableConfigArgs`                                                            |
| gemini   | `model.compressionThreshold`, `model.disableLoopDetection`                       | must never appear among the settings this policy writes                                                                |
| qwen     | `model.chatCompression`, `model.compactionModel`, `context.autoCompactThreshold` | same, plus a test that an operator's own `autoCompactThreshold: 0.7` survives the merge byte-for-byte                  |
| opencode | the `compaction` agent                                                           | must never appear in `buildOpencodeAuxiliaryAgentConfig`, and `src/opencode.lib.mjs` must not name it at all           |
| agent    | `--summarize-session` (already defaults true)                                    | untouched                                                                                                              |

Compaction is privileged inside Claude Code itself, which is a nice independent confirmation that it is not an "auxiliary" call in the sense this issue means: one gate in the bundle reduces, in full, to

```js
function Ute(e) {
  if (e === 'compact') return !0;
  return !1;
}
```

— a call whose source is `"compact"` is admitted where others are not.

`DISABLE_MICROCOMPACT` was searched for and has **0** occurrences in 2.1.269, so the never-set list is exactly the two variables above rather than three.

## What was implemented

One module, `src/auxiliary-model-calls-policy.lib.mjs`, owns every knob — the same shape as #2178's `agent-memory-policy.lib.mjs`, for the same reason: `solve`, `configure-claude` and the Dockerfile baseline must not be able to disagree about what "off" means.

| Tool     | Applied as                                                                                                                                                                                   | Where                                                                                                             |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| claude   | `CLAUDE_CODE_CLASSIFIER_SUMMARY=0`, `CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES=0`, `CLAUDE_CODE_ENABLE_NARRATION=0`, `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=0`, `CLAUDE_CODE_ENABLE_REMOTE_RECAP=0` | `src/claude-quiet-config.lib.mjs` (so `configure-claude` seeds them) and the `ENV` block of all three Dockerfiles |
| codex    | `-c features.goals=false -c features.personality=false`                                                                                                                                      | `src/codex.lib.mjs` (`codex exec`) and `src/agent-commander.lib.mjs` (`--use-agent-commander`)                    |
| gemini   | `model.skipNextSpeakerCheck: true`, `tools.disableLLMCorrection: true`                                                                                                                       | merged into `~/.gemini/settings.json` before launch                                                               |
| qwen     | `model.skipNextSpeakerCheck: true`, `experimental.emitToolUseSummaries: false`, `ui.enableFollowupSuggestions: false`                                                                        | merged into `~/.qwen/settings.json` before launch                                                                 |
| opencode | `agent: { title: { disable: true }, summary: { disable: true } }`                                                                                                                            | the per-task `opencode.json` hive-mind already writes                                                             |
| agent    | nothing to do                                                                                                                                                                                | recorded in `TOOLS_ALREADY_COMPLIANT`                                                                             |

Alongside it, `src/gemini-family-settings.lib.mjs` was extracted: the settings reader/merger that #2178 had inlined is now shared, so the memory policy and this one cannot develop different ideas of what "merge" means. The merge unions arrays and overwrites scalars, and skips `__proto__`/`constructor`/`prototype` with explicit comparisons — the barrier pattern CodeQL's `js/prototype-pollution-utility` rule recognises.

`--auxiliary-model-calls-disabled` defaults to `true`; `--no-auxiliary-model-calls-disabled` is the only way out, and taking it adds _no_ arguments and writes _no_ keys, rather than writing arguments set to `true`. As in #2178, the flag deliberately does not reach claude — those switches are `ENV` lines in an image and settings written by `configure-claude`, neither of which sees a `solve` argv — and the flag's own description says so rather than implying a control that is not there.

## Existing components considered

- **`src/agent-memory-policy.lib.mjs` (#2178)** — the pattern this follows, and the source of the extracted settings helper. Reusing its shape is why the flag semantics, the merge behaviour and the "recorded as already compliant" list are identical rather than merely similar.
- **`src/claude-quiet-config.lib.mjs` (#1642)** — already owned Claude's env/settings baseline and the `configure-claude` bin; the five new variables were added to it rather than to a second mechanism.
- **`codex features enable/disable`** — persists flags into `~/.codex/config.toml`. Rejected in favour of `-c` overrides: hive-mind should not mutate an operator's global Codex config to run one task, and a per-run override cannot leak into their interactive sessions.
- **Upstream OpenCode `small_model`** — the documented answer to expensive title generation is to route it to a cheap model. Rejected: cheaper is not free, and the artefact is still never read.
- **`@link-assistant/agent`'s run-options** — already the right defaults (`--generate-title` false, `--summarize-session` true). Nothing added; recorded so the next audit does not have to re-read them.

## Proposals for what was deliberately left alone

R8 asks for a proposal rather than a guess where the answer is not clear. These are the knobs that are on, are arguably auxiliary, and were **not** changed:

1. **Codex `skill_search` and `tool_suggest`.** Both make extra calls, but both plausibly improve the task's own output rather than decorating it. Proposal: measure before deciding — run a fixed set of issues with and without them and compare tokens and pass rate. Flipping them on suspicion risks making hive-mind worse to save a rounding error.
2. **Codex `multi_agent`.** Enabling agents is not the same as spawning them; `codex exec` does not appear to spawn any unprompted. Proposal: leave on, revisit if a run's token accounting ever shows sub-agent usage nobody asked for.
3. **Gemini `model.summarizeToolOutput`.** This is a model call, but it is a _context-management_ call — it shrinks oversized tool output so it fits. That is much closer to the compaction the issue protects than to a session title. Proposal: treat it as part of the summarization exception, i.e. leave on.
4. **Qwen `ui.enableCacheSharing` and `ui.enableUserFeedback`.** Neither is a model call; both are data leaving the container. Out of scope here, but a privacy question worth its own issue.
5. **Qwen `tools.autoMode.classifyAllShell`.** Only reachable in Qwen's auto mode, which `--approval-mode yolo` means we never enter. Proposal: leave alone; setting it would be policy against an unreachable code path, which is how stale configuration accumulates.

## What this does not do

- **It does not verify the _effect_, only the wiring.** The tests assert that the knobs are set and that the compaction knobs are not; they do not observe a live CLI making one fewer request. Confirming that would need a routed run per tool with request-level logging.
- **It cannot survive a rename.** The `experimental.autoMemory` regression documented above is proof: the knobs are right for the six versions named at the top of this file and for no version in particular after that. The counts in this document exist so the next audit can re-run them.
- **It does not touch remote rollouts it cannot see.** Pinning the five Claude variables to `0` closes the fall-through to GrowthBook for those five. A future auxiliary feature gated only by a `tengu_*` flag with no local override would be invisible to this policy until someone looks again.

## Timeline

| Date       | Event                                                                                                                                                                                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-11 | Issue #2236 filed: auxiliary model calls waste tokens in an autonomous run; summarization must be kept.                                                                                                                                                    |
| 2026-09-12 | Binaries inspected (claude-code 2.1.269, codex-cli 0.153.4, gemini-cli 0.58.0, qwen-code 0.23.0, opencode 1.18.29, agent 0.26.1). 33 Claude `querySource` labels enumerated; 135 Codex flags listed; Qwen settings schema dumped.                          |
| 2026-09-12 | `experimental.autoMemory` found absent from qwen-code 0.23.0 — #2178's Qwen memory wiring had become a silent no-op. Fixed with `memory.enableManagedAutoMemory` / `memory.enableManagedAutoDream`.                                                        |
| 2026-09-12 | OpenCode agent-disable verified end-to-end; Codex `-c features.*=false` verified via `codex features list`.                                                                                                                                                |
| 2026-09-12 | `src/auxiliary-model-calls-policy.lib.mjs` added as the single source of truth, `src/gemini-family-settings.lib.mjs` extracted, `--auxiliary-model-calls-disabled` added defaulting to true, five Claude variables pinned to `0` in all three Dockerfiles. |

## Sources

Upstream documentation and trackers consulted, in addition to the binaries:

- [Gemini CLI settings reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/settings.md) and [discussion #6666 — "Setting for skipping the next speaker check is live"](https://github.com/google-gemini/gemini-cli/discussions/6666)
- [Qwen Code configuration reference](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/settings/), [Qwen Code memory docs](https://qwenlm.github.io/qwen-code-docs/en/users/features/memory/), [auto-memory system design](https://github.com/QwenLM/qwen-code/blob/main/docs/design/auto-memory/memory-system.md), [tool-use summaries](https://qwenlm.github.io/qwen-code-docs/en/users/features/tool-use-summaries/), [issue #4374 — disabling auto-memory recall](https://github.com/QwenLM/qwen-code/issues/4374)
- [Codex config basics](https://developers.openai.com/codex/config-basic/) and [CLI reference](https://developers.openai.com/codex/cli/reference)
- [OpenCode agents documentation](https://opencode.ai/docs/agents/), and the open requests to disable title/summary generation: [#14779](https://github.com/anomalyco/opencode/issues/14779), [#33140](https://github.com/anomalyco/opencode/issues/33140), [#6228](https://github.com/anomalyco/opencode/issues/6228)
