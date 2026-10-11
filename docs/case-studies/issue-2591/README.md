# Case study: aliases for the latest version of every model family (issue #2591)

- Issue: https://github.com/link-assistant/hive-mind/issues/2591
- Pull request: https://github.com/link-assistant/hive-mind/pull/2592
- Date: 2026-10-07 (reported) – 2026-10-10 (fixed)
- Tool versions checked locally: claude-code 2.1.296, codex-cli 0.161.0, gemini-cli 0.63.0, qwen-code 0.25.0, @link-assistant/agent 0.26.11, opencode-ai 1.18.35

Files in this folder:

- [`images/issue-screenshot.png`](./images/issue-screenshot.png): the Telegram exchange from the issue, where `/codex … --model astra` was rejected.
- [`data/codex/codex-0.161.0-debug-models.json`](./data/codex/codex-0.161.0-debug-models.json): `codex debug models` output, the catalogue the Codex CLI itself offers.
- [`data/claude/claude-code-2.1.296-baked-catalog.txt`](./data/claude/claude-code-2.1.296-baked-catalog.txt): the model table compiled into Claude Code 2.1.296.
- [`data/cli-model-catalogues/`](./data/cli-model-catalogues/): where Gemini CLI, Qwen Code, agent and OpenCode get their model lists, and which of Hive Mind's mappings were stale.
- [`data/reproduction/before-fix-listings.txt`](./data/reproduction/before-fix-listings.txt) and [`after-fix-listings.txt`](./data/reproduction/after-fix-listings.txt): what Hive Mind listed and resolved for every tool, generated with [`experiments/issue-2591-print-model-listings.mjs`](../../../experiments/issue-2591-print-model-listings.mjs). The after-fix file includes a `--live` run with `HIVE_MIND_MODEL_DEBUG=1`.
- [`logs/`](./logs/): the logs of the three earlier, failed sessions on this issue (section 3).

## 1. Problem

`/codex <issue> --think high --model astra` was rejected with `Unrecognized model: "astra"` / `Did you mean: "terra"?`, followed by a 62-entry "Available models for codex" list ([screenshot](./images/issue-screenshot.png)). Three things were wrong:

1. **No alias for the newest family.** `gpt-6-astra` was accepted, but `astra` was not. `sol` resolved to `gpt-5.6-sol` although `gpt-6.1-sol` was in the catalogue.
2. **Aliases were hand-maintained.** Every new model family needed a code change.
3. **The "available models" lists were not real.** They contained models that the CLIs no longer offer (`gpt-5.4-nano`, `gpt-5.2-codex`, `o3-mini`, `gpt4`, `haiku-3`, `qwen3-coder-flash`, `grok-code`, …), plus every `openai/` and `openai.` spelling of each one.

## 2. Requirements from the issue

| #   | Requirement                                                                                     | Status | Where it is handled                                                                                                                                                                                                                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | `astra` → newest `gpt-*-astra` ("or whatever the latest will be at the moment")                 | Done   | `deriveCodexFamilyAliases` in [`src/models/aliases.mjs`](../../../src/models/aliases.mjs): `astra → gpt-6-astra`, `sol → gpt-6.1-sol`, `luna → gpt-6-luna`, `terra → gpt-5.6-terra`, `daybreak-blue/red → gpt-daybreak-*-latest`                                                                                          |
| R2  | New aliases appear from new model names without code changes                                    | Done   | Aliases are derived from model IDs in both the bundled catalogue and the live one (`codex debug models`, the model catalogue router). `resolveLiveFamilyAlias` in [`src/models/index.mjs`](../../../src/models/index.mjs) resolves `nova` once Codex offers `gpt-7-nova`; `opus-6` reaches Claude Code as `claude-opus-6` |
| R3  | Fully support all available models                                                              | Done   | Every model in the six CLI catalogues (`data/`) is accepted: the Claude 5.x families including `mythos`, Gemini 3.x and the CLI's own `auto`/`pro`/`flash`/`flash-lite` aliases, Qwen 3.5–3.8 plus `coder-model`, the current OpenCode Zen free models and the newest Claude/Gemini IDs for agent/opencode                |
| R4  | "Available models" shows what the harnesses actually offer, no obsolete models                  | Done   | `getAvailableModelNames` / `listCodexModelNames` list only current models; obsolete IDs stay accepted for pinned configurations but are hidden (section 5)                                                                                                                                                                |
| R5  | Collect logs and data into `docs/case-studies/issue-2591`, deep analysis, online research       | Done   | This folder                                                                                                                                                                                                                                                                                                               |
| R6  | Timeline, requirements, root causes, solution plans, existing components/libraries              | Done   | Sections 3–7                                                                                                                                                                                                                                                                                                              |
| R7  | Add debug/verbose output where data was missing                                                 | Done   | `HIVE_MIND_MODEL_DEBUG=1` / `--verbose` (section 6)                                                                                                                                                                                                                                                                       |
| R8  | Report issues to other repositories, with reproduction, workaround and suggested fix            | Done   | link-assistant/agent#328 (section 8)                                                                                                                                                                                                                                                                                      |
| R9  | Fix the problem everywhere in the codebase                                                      | Done   | All six tools; help text (`buildModelOptionDescription`), fallbacks, pricing tiers, reasoning support, the opencode default, README/CONFIGURATION/FEATURES/UBUNTU-SERVER/FREE_MODELS docs in all four languages                                                                                                           |
| R10 | PR comment: "recover from [the session-2 log] and double check we do exactly every requirement" | Done   | Work in that log was recovered and continued. This table is the check                                                                                                                                                                                                                                                     |

## 3. Timeline

All times are UTC.

| Time             | Event                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-07 07:06 | Issue #2591 opened with the screenshot: `--model astra` rejected for `/codex`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 07:14 – 07:18    | **Session 1** (draft PR #2592 created) fails at once: `AGENT execution failed … Error: File not found: /tmp/gh-issue-solver-1791357262243/e.g`. The Formal AI draft read the "e.g." in a prompt as a file path, a Hive Mind bug fixed separately in PR #2626 (issue #2625). No issue work was done.                                                                                                                                                                                                                                                                                                                                                                              |
| 09:09 – 09:42    | **Session 2** (Claude) gathers the Codex/Claude catalogues and starts the alias derivation. At 09:32 and again at 09:38 it starts the full `npm test` in the background ([`logs/session-2-oom-failure-…`](./logs/session-2-oom-failure-2026-10-07T09-42.log), lines 24983 and 35594). The container's cgroup limit is 2.9 GB. At 09:41 the Claude CLI is OOM-killed (`exit code 137`, line 41893; the surviving process was `pid 40721: npm test`, line 41915). Uncommitted work was preserved on `recovery/issue-2591-1b69dfe657e2`.                                                                                                                                            |
| 09:54            | The intermediate session-2 log is uploaded ([`logs/session-2-intermediate-…`](./logs/session-2-intermediate-2026-10-07T09-54.log)), and the session is restarted after the OOM notice.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 21:22            | konard: "We need to fully deliver the requirements, do all the fixes and so on."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 21:23            | **Session 3** (solve v2.34.0) ends after three turns. The account's five-hour window was at 99 % when the session started and was `rejected` (100 %, overage disabled, reset 22:20) by the third turn ([`logs/session-3-failure-…`](./logs/session-3-failure-2026-10-07T21-23.log), lines 1046 and 1520). The last tool call ran `file` to check the screenshot, but `file` is not installed in the task image (`/bin/bash: line 1: file: command not found`, line 1714). Solve reported this as `Final tool result failed: Exit code 127`, which hid the real cause, the usage limit. Fixed on main by feca4bcf ("preserve terminal provider errors and usage-limit recovery"). |
| 2026-10-09 06:15 | konard asks to recover from the session-2 log and double-check every requirement.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-10-10 07:30 | **Session 4** (this PR): recovers the session-2 work, re-collects every CLI's catalogue, finishes all six tools, and reports agent#328. The full `npm test` is not run in the container: tests run one at a time with `--max-old-space-size=512`.                                                                                                                                                                                                                                                                                                                                                                                                                                |

## 4. Root causes

### 4.1 Codex: aliases advanced only as a complete sol/terra/luna trio

Issue #2043 introduced `getLatestCodexGenerationAliases` (base commit `db2259e9`, `src/models/catalog.mjs:203`):

```js
const latestCompleteGeneration = [...generations.entries()].filter(([, aliases]) => ['sol', 'terra', 'luna'].every(alias => aliases[alias])).sort(([left], [right]) => right.localeCompare(left, undefined, { numeric: true }))[0];
```

That rule has two problems:

- **Only a complete trio counts.** GPT-6 shipped Sol, Luna and Astra but no Terra, so generation 6 was never "complete" and `sol`/`luna` stayed on 5.6.
- **The family list is fixed.** `astra` is not one of the three hard-coded names, so it could never become an alias. The same applied to `daybreak-blue` and `daybreak-red`, whose models are named `gpt-*-latest`.

### 4.2 Lists were the whole alias map, not the harness catalogue

`getAvailableModelNames` printed every key of the tool's mapping table, and the Codex table generated `openai/` and `openai.` variants for every key. That is how the screenshot shows 62 entries for 11 models Codex actually offers. Nothing compared those tables against what the installed CLI offers.

### 4.3 Other tools' tables had gone stale

| Tool     | Stale before the fix                                                                                                                                                                                                                                                          | Evidence                                                                                       |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| claude   | No `mythos` or `best` aliases and no dotted `opus-5.5` spelling. The list included Claude 3.x models that Claude Code no longer has.                                                                                                                                          | [`claude-code-2.1.296-baked-catalog.txt`](./data/claude/claude-code-2.1.296-baked-catalog.txt) |
| gemini   | `flash`/`pro`/`flash-lite` were pinned to Gemini **2.5**. Gemini CLI 0.63.0 resolves its own rolling aliases to Gemini 3.x.                                                                                                                                                   | [`gemini-0.63.0.txt`](./data/cli-model-catalogues/gemini-0.63.0.txt)                           |
| qwen     | No Qwen 3.7/3.8 models, no `max`/`plus`/`flash` aliases, and the OAuth `coder-model` was rejected.                                                                                                                                                                            | [`qwen-0.25.0.txt`](./data/cli-model-catalogues/qwen-0.25.0.txt)                               |
| agent    | `sonnet → anthropic/claude-3-5-sonnet`, `haiku → anthropic/claude-3-5-haiku`, `opus → anthropic/claude-3-opus` and `gemini-3-pro → google/gemini-3-pro` are all absent from models.dev. Several listed free models (`minimax-m2.5-free`, `kimi-k2.5-free`, …) are deprecated. | [`agent-0.26.11.txt`](./data/cli-model-catalogues/agent-0.26.11.txt)                           |
| opencode | The **default** model was `grok-code`, which models.dev marks deprecated. OpenCode deletes deprecated models from its catalogue, so a run without `--model` asked for a model OpenCode no longer serves.                                                                      | [`opencode-1.18.35.txt`](./data/cli-model-catalogues/opencode-1.18.35.txt)                     |

### 4.4 No trace of how a `--model` value was resolved

The logs show the rejection but not which catalogue was consulted or what it contained. Reconstructing the issue needed the screenshot and a manual `codex debug models` run.

## 5. Solution

### 5.1 Per-family alias derivation ([`src/models/aliases.mjs`](../../../src/models/aliases.mjs))

These are pure functions with no imports, applied to any list of model IDs:

- `deriveCodexFamilyAliases`:
  - Each `gpt-<version>-<family>` makes `<family>` resolve to the newest version of that family, independently of the others.
  - Each `gpt-<name>-latest` gives the alias `<name>`.
  - Tier suffixes (`mini`, `nano`, `codex`, `chat`, `preview`, `pro`) are not families, so `mini` never becomes an alias.
- `deriveClaudeFamilyAliases`:
  - Each undated `claude-<family>-<version>` gives `<family>-<version>`, `<family>-<dotted>` and `claude-<family>-<dotted>`.
  - `<family>` resolves to the newest version (`mythos → claude-mythos-5-1`).
- `deriveQwenFamilyAliases`: `qwen<version>-<family>` gives `<family>` and `qwen-<family>` (`max → qwen3.8-max`).
- `expandClaudeVersionShorthand`: `opus-6` / `opus-6.1` → `claude-opus-6` / `claude-opus-6-1` for a known family, so a Claude version released after this build is still passed through correctly.

### 5.2 Live catalogues, no code change for new models

`validateRuntimeModelName` runs the same derivation over the live catalogue: the installed Codex CLI's `codex debug models`, plus the model catalogue router when it is enabled.

- A family that is new, or newer than the bundled data, is resolved and recorded with `registerRuntimeModelAlias`.
- Every later synchronous mapping in the process (CLI argument, PR comments, fallbacks) then agrees with validation.
- A bundled pin that the installed Codex no longer offers produces a warning listing what it does offer.

### 5.3 Listings are the harness catalogues

| Tool     | Listed before | Listed after | What is listed now                                                                                                                                                                              |
| -------- | ------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| claude   | 40            | 24           | Aliases plus the families and versions in Claude Code 2.1.296. The `claude-*` spellings and Claude 3.x are still accepted, but not listed.                                                      |
| codex    | 62            | 13           | Derived aliases plus the visible `codex debug models` entries. Hidden models (`gpt-daybreak-*-latest`, `codex-auto-review`) and the `openai/`/`openai.` spellings are accepted, but not listed. |
| gemini   | 19            | 21           | Gemini CLI's rolling aliases (passed through so the CLI picks the version), plus Gemini 3.x and Gemma 4.                                                                                        |
| qwen     | 9             | 20           | `coder-model`, the derived `max`/`plus`/`flash` aliases and the Qwen 3.5–3.8 models.                                                                                                            |
| agent    | 21            | 21           | Current OpenCode Zen free models, plus `opus`/`sonnet`/`haiku`/`fable` → `anthropic/<newest>` and `gemini-pro` → `google/gemini-3.1-pro-preview`. Deprecated free models are hidden.            |
| opencode | 10            | 15           | Default `big-pickle` and the current Zen free models, plus the newest Claude and Gemini. `gpt4` and `grok*` are accepted for pinned configs, but not listed.                                    |

The `astra` command from the screenshot now resolves to `gpt-6-astra`, and `sol` to `gpt-6.1-sol`. See [`after-fix-listings.txt`](./data/reproduction/after-fix-listings.txt).

### 5.4 The opencode default

The default is now `big-pickle`, which is OpenCode's own default when no provider key is configured and which the live Zen catalogue still serves.

- `grok-code` and friends still map to `opencode/grok-code` for anyone who pins them.
- Changing the default with `--model` works as before.

## 6. Tracing

Tracing is off by default. Set `HIVE_MIND_MODEL_DEBUG=1`, or pass `--verbose`, to print one stderr line per resolution decision:

```
[model-resolution] codex debug models {"models":["gpt-6-astra","gpt-6.1-sol",…],"hidden":["gpt-daybreak-blue-latest",…]}
[model-resolution] bundled {"tool":"codex","model":"astra","mappedModel":"gpt-6-astra"}
[model-resolution] live alias {"tool":"codex","model":"nova","mappedModel":"gpt-7-nova","bundled":null}
[model-resolution] unrecognized {"tool":"codex","model":"…","liveModels":[…]}
```

With these lines, a future "unrecognized model" report shows both the catalogue the decision was made against and the alias it followed.

## 7. Existing components and libraries considered

| Source                                                                                                                  | Used for                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `codex debug models` (codex-cli ≥ 0.161)                                                                                | The authoritative Codex catalogue, including `visibility: hide`. It is already read by `getInstalledCodexModels` and now feeds alias derivation and the listing.                                                                                                         |
| [models.dev `api.json`](https://models.dev/api.json)                                                                    | The catalogue agent and OpenCode build from, with a `status: deprecated` flag per model. It was used to find the stale agent/opencode mappings. OpenCode drops deprecated models, so Hive Mind hides them.                                                               |
| [OpenCode Zen `/v1/models`](https://opencode.ai/zen/v1/models)                                                          | The free models Zen actually serves (87 models on 2026-10-10). It is the source of the free-model lists and the `big-pickle` default.                                                                                                                                    |
| `opencode models`                                                                                                       | It cross-checks the models.dev cache that OpenCode 1.18.35 actually uses.                                                                                                                                                                                                |
| Gemini CLI `auto`/`pro`/`flash`/`flash-lite` aliases                                                                    | The CLI already resolves "latest" itself, so Hive Mind passes these through instead of pinning them.                                                                                                                                                                     |
| Hive Mind's model catalogue router ([`src/model-catalogue.lib.mjs`](../../../src/model-catalogue.lib.mjs), issue #2202) | It merges bundled, CLI and router catalogues. Its live IDs now pass through the same derivation.                                                                                                                                                                         |
| LiteLLM `model_prices_and_context_window.json`, OpenRouter `/api/v1/models`                                             | Not used. They describe provider APIs, not what a given CLI version accepts, and they contain no family/alias notion. Each vendor's own naming scheme (`gpt-<v>-<family>`, `claude-<family>-<v>`, `qwen<v>-<family>`) is regular enough to derive aliases from directly. |

## 8. Upstream reports

- [link-assistant/agent#328](https://github.com/link-assistant/agent/issues/328): agent's `DEFAULT_MODEL` `opencode/minimax-m2.5-free` is deprecated on models.dev and not served by Zen. The report includes a reproduction, the workaround (`--model opencode/big-pickle`) and a suggested fix.
- [link-assistant/agent#327](https://github.com/link-assistant/agent/issues/327), which already existed: `opencode/nemotron-3-super-free` is no longer served by Zen. Hive Mind routes `nemotron-3-super-free` to `kilo/` (issue #2625), so the alias still works.

The Codex, Claude Code, Gemini CLI and Qwen Code catalogues were consistent with what those CLIs accept, so nothing was reported there. Hive Mind's tables were the stale side.

## 9. Remaining limits

- **Free models change weekly.** The bundled free lists are a 2026-10-10 snapshot. Validation still accepts any ID the live catalogue reports, but the listing only changes with a release.
- **Kilo IDs are unverified.** Agent hard-codes its Kilo provider, and the upstream IDs are absent from models.dev's `kilo` entry ([`agent-0.26.11.txt`](./data/cli-model-catalogues/agent-0.26.11.txt)). They were left unchanged.
- **Live derivation only covers codex and claude.** Gemini and Qwen have no non-interactive catalogue command, so their aliases come from the bundled data. Gemini needs none, because its own CLI resolves the rolling aliases.
- **The `file` binary is missing from the task image.** That is what produced session 3's exit code 127. Feca4bcf fixed the misleading error on main; the image itself was not changed here.

## 10. Tests and evidence

- [`tests/test-issue-2591-latest-model-aliases.mjs`](../../../tests/test-issue-2591-latest-model-aliases.mjs) has 21 cases:
  - `astra`, `sol` and the other per-family aliases, including families from a hypothetical `gpt-7-nova` catalogue;
  - the Claude, Qwen and Gemini aliases;
  - the listings no longer containing obsolete models;
  - runtime alias registration;
  - tracing;
  - the opencode default.
- Updated expectations in `test-issue-882-fixes`, `test-claude-think-prompt-gating`, `model-info.test` and `test-agent-model-validation`.
- Reproduce: `node experiments/issue-2591-print-model-listings.mjs` (bundled) or `HIVE_MIND_MODEL_DEBUG=1 node experiments/issue-2591-print-model-listings.mjs --live` (installed CLIs).
