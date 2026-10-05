# Model-aware reasoning effort selection

Issue: [#2526](https://github.com/link-assistant/hive-mind/issues/2526). Implementation: [PR #2527](https://github.com/link-assistant/hive-mind/pull/2527).

## Failure and root causes

The linked [failed task](https://github.com/leaderstat/hr-lzt-2026/pull/4#issuecomment-5997430732) selected GPT-6.1 Sol correctly but still passed `model_reasoning_effort=none`. The API rejected that setting with HTTP 400: this model accepts `low`, `medium`, `high`, `xhigh`, and `max` as API efforts. The failure occurred before any assistant turn completed. [Retained command, line 312](data/failure.log#L312), [rejection, line 738](data/failure.log#L738), and [final error, line 801](data/failure.log#L801) establish the chain without repeating an inference request.

Five implementation gaps contributed:

1. `resolveCodexReasoningEffort` translated the shared level/budget into one global effort ladder. `off`, an omitted level, and a zero budget all became `none`, irrespective of the selected model. Unsupported upper levels had the same problem.
2. Live model discovery admitted new IDs, but `normalizeCataloguePayload` discarded `supported_reasoning_levels` and `default_reasoning_level`. Knowing that a model exists was mistaken for knowing its valid effort settings.
3. The native connection check hard-coded `none`; organization planning maintained a second manual translation; the agent-commander adapter reused the global mapping. Fixing only normal native execution would leave these entry points broken.
4. CLI model picker metadata omits `none` even for models whose official API documentation supports it. Blindly replacing bundled knowledge with the picker list would regress supported disabled reasoning. The implementation reconciles this particular omission for exact, documented model IDs while preserving explicit gateway restrictions.
5. Claude's native implementation already accounts for adaptive-only models, but the commander adapter unconditionally exported an explicit token budget, and organization planning collapsed supported `xhigh` to `high`. These adapters now reuse the existing Claude model-aware configuration.

The log also contains credential-helper and optional integration diagnostics. Their timing and the structured API error show they did not cause this request failure. No evidence establishes that rejected requests were billed, so this investigation makes no billing claim.

## Timeline (UTC)

| Time on 2026-10-05       | Evidence and consequence                                                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 15:17:14.644             | The linked solve session starts; retained log header.                                                                                                                                             |
| 15:18:16.387             | The task selects the latest discovered GPT-6.1 Sol.                                                                                                                                               |
| 15:18:18.150             | Runtime resolves the exact model ID to `gpt-6.1-sol`.                                                                                                                                             |
| 15:18:18.181             | Codex launches with `model_reasoning_effort=none`; log line 312.                                                                                                                                  |
| 15:18:23.115             | The API returns HTTP 400 for unsupported `reasoning.effort`; line 738.                                                                                                                            |
| 15:18:23.656             | Hive Mind records the Codex error event; line 801.                                                                                                                                                |
| 15:18:30                 | The failed draft is reported on the linked PR.                                                                                                                                                    |
| 16:02:53                 | Issue #2526 is opened.                                                                                                                                                                            |
| 16:12:51                 | Prepared branch commit `424601c69f80806d3ff11336f296aab777a9346f` creates PR #2527.                                                                                                               |
| 16:13:39–40              | Security and Checks workflows finish `action_required`, with zero jobs and no downloadable logs.                                                                                                  |
| Subsequent investigation | Pure regression tests reproduce `none` instead of `low`, an invalid adaptive-only Claude budget, and missing cached gateway capabilities. All three are fixed and covered by default-suite tests. |
| 19:11:58                 | GitHub opens an Actions incident involving delayed hosted-runner assignment; retained status snapshot.                                                                                            |
| 19:14:43–55              | Separate implementation and dependency-maintenance commits are created and pushed to the prepared branch.                                                                                         |
| 19:15:16                 | Fresh Checks, Security and link-check workflows are created for implementation head `9ed9e5ef`.                                                                                                   |
| 19:25:40 / 19:26:30      | CI passes all 547 default-suite files and the one GitHub integration test file.                                                                                                                   |
| 19:30:19 / 19:34:05      | Audit and Docker jobs are cancelled without acquiring runners or executing steps; their annotations match the reported Actions incident.                                                          |
| 19:46:58 / 19:54:05      | Their first retries encounter the same zero-step runner acquisition failure; further retries wait for service recovery.                                                                           |

The previous solver failed on a missing local file named `e.g`. Its PR comment mentions a 414 KB log at `/home/box/solve-2026-10-05T16-12-16-661Z.log`, but that file is absent from this prepared environment and the gist upload had returned 403. The comment is retained; the unavailable log is not invented or replaced with a successful run.

## Requirements and implemented solutions

| Issue requirement                                                            | Implementation and verification                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fallback from unsupported `none` to `auto` or `low`                          | Preserve `none` when supported; prefer supported `auto` for disabled reasoning; otherwise choose the closest supported tier. GPT-6.1 Sol and GPT-6 Astra select `low`.                                                                                                                                                           |
| Fully support the latest models out of the box                               | Bundle exact efforts for every model in Codex CLI 0.160.0's catalogue; add GPT-6.1 Sol to the bundled model IDs. Preserve GPT-6 Sol/Luna, GPT-5.6 Sol/Terra/Luna and GPT-5.5's documented `none` support. Existing Claude capabilities remain the shared source of truth.                                                        |
| Dynamically load exact future capabilities                                   | Retain explicit effort arrays/defaults from CLI and compatible vendor/router listing shapes. Execution reads the installed binary through the existing one-hour, locked catalogue cache. Routed tasks can use cached gateway capabilities; cached models.dev data contributes only explicitly enumerated efforts.                |
| Choose the closest supported level for every unsupported level               | Order `none < minimal < low < medium < high < xhigh < max < ultra`; minimize ordinal distance, with ties choosing lower effort independently of provider array order. Tests exhaust all 255 nonempty subsets of this eight-level order for all eight requested levels.                                                           |
| Collect logs/data and perform a deep case study                              | This directory retains the linked gist, issue/PR comments, initial CI metadata, CLI capability snapshot, related PRs, code search and upstream reports. The case study records timeline, root causes, decisions, alternatives and evidence limits.                                                                               |
| Search online and evaluate existing components/libraries                     | Official OpenAI model documents, installed CLI metadata, recent Hive Mind catalogue PRs, router normalization code, models.dev and existing Claude configuration are compared below.                                                                                                                                             |
| Add tracing where evidence is insufficient                                   | Runtime logs the selected effort and source, fallback transition or missing metadata with `{ verbose: true }`. Native execution's existing settings display includes the effective value; additional diagnostics remain quiet by default.                                                                                        |
| Report related upstream problems with reproducer/workaround/code suggestions | Added [the upstream report](https://github.com/openai/codex/issues/44219#issuecomment-6000649081) to the existing capability-metadata issue instead of duplicating it; includes a token-free reproducer, captured HTTP failure, workaround and implementation/test suggestions.                                                  |
| Apply requirements throughout the codebase                                   | Native Codex new/resumed tasks, connection checks, commander execution and organization planning share effort resolution. Claude's commander/planning paths reuse `getClaudeEnv`. Other tool paths were traced: they do not synthesize a Codex `reasoning.effort` enum and their existing prompt/provider controls are retained. |
| Keep all work in this PR and prepare release                                 | One patch changeset; tests, implementation, reproducible experiment and case study in PR #2527. Package version remains release-workflow-managed.                                                                                                                                                                                |

## Capability sources and precedence

The runtime consumes a fresh exact model capability list first, in catalogue rank order. Gateway data participates only for routed tasks; a direct task must not inherit gateway restrictions. Then it uses verified bundled capabilities, followed by stale exact source data when a model has no bundled answer, and explicit metadata as a final source. A `reasoning: true` flag or a familiar model-name prefix does not establish a supported effort enum.

The CLI picker omits `none` for some older/current models. Only that CLI normalization adds documented `none` support for an exact known model. It does not add `none` to arbitrary future models or overwrite an explicit provider/router list. Fresh capability data can override the bundled table otherwise.

When reliable efforts are absent, the resolver returns `null` and callers omit Hive Mind's effort override, allowing the CLI/provider's configured default. This is an explicit limit: unknown future capability sets cannot be inferred from a name, and omitting an override cannot sanitize an operator's independently invalid CLI configuration. No completion endpoint is probed to discover capabilities.

`--thinking-budget` keeps its previous precedence and token thresholds. An unsupported mapped tier is resolved after translation. A delegation budget is attached only if the final effort really is `ultra`, including connection validation. Organization classification filters exact capabilities to its existing `xhigh` ceiling before selecting the nearest tier. Models with no planning-compatible tier receive a clear error, and the command builder rejects injected `max`/`ultra` settings. Final review reproduced and corrected this constraint violation and the missing connection rollout cap in the initial implementation; `data/planning-ceiling-{before,after}.log` and `data/connection-budget-{before,after}.log` preserve the evidence.

The runtime reads CLI metadata and previously cached router/models.dev metadata. It never starts Docker or contacts vendor APIs merely to select effort. `/models` remains the explicit discovery path for refreshing network sources. Hot loading can be disabled, known models work offline, failed reads preserve usable stale data, and a custom `codexPath` cannot use another binary's cached list.

## Current bundled capabilities

Collected with Codex CLI **0.160.0**. `ultra` is a CLI delegation mode, distinct from the API effort enum; it retains Hive Mind's bounded rollout-token configuration.

| Model                                 | Supported settings used by Hive Mind       |
| ------------------------------------- | ------------------------------------------ |
| GPT-6.1 Sol, GPT-6 Astra              | low, medium, high, xhigh, max, ultra       |
| GPT-6 Sol, GPT-5.6 Sol, GPT-5.6 Terra | none, low, medium, high, xhigh, max, ultra |
| GPT-6 Luna, GPT-5.6 Luna              | none, low, medium, high, xhigh, max        |
| GPT-5.5                               | none, low, medium, high, xhigh             |
| GPT Reserve, Codex Auto Review        | low, medium, high, xhigh, max              |

The snapshot has ten models and retains their effort descriptions, defaults, visibility and context metadata. Large model instructions (`model_messages` and `base_instructions`) were removed because they do not affect capabilities; the snapshot is consequently a documented reduction, not a byte-identical CLI stdout capture.

## Research and component comparison

- [GPT-6.1 Sol model documentation](https://developers.openai.com/api/docs/models/gpt-6.1-sol) and [latest-model migration guide](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6.1-sol): confirm the missing `none`/`minimal` settings and supported lower-effort alternative. This matches the actual HTTP failure.
- [GPT-6 Sol](https://developers.openai.com/api/docs/models/gpt-6-sol), [GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol), [GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra), [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna), and [GPT-5.5](https://developers.openai.com/api/docs/models/gpt-5.5): verify documented `none` support, which the CLI picker snapshot omits. The migration guide also identifies GPT-6 Luna's `none` support. These sources justify exact bundled supplements rather than a family-wide guess.
- [PR #2203](https://github.com/link-assistant/hive-mind/pull/2203): already provides token-free readers, locking, one-hour cache and stale-data retention. Reusing it avoids another discovery subsystem, network cache and Docker lifecycle.
- [PR #2291](https://github.com/link-assistant/hive-mind/pull/2291): already permits live model IDs and selects the latest Sol dynamically. The new code extends that identity discovery with capability information instead of removing dynamic defaults.
- [link-assistant/router](https://github.com/link-assistant/router/blob/main/src/model_routing_aggregate.rs): existing normalization recognizes `supported_reasoning_levels` and `default_reasoning_level`, associates provider provenance and retains cached data. The local reader now carries these fields through. Relevant source is retained under `data/`.
- [models.dev](https://models.dev/): useful existing metadata fallback, but a Boolean reasoning flag is insufficient for exact tier selection. Use an explicit effort array when present; do not derive one from context windows or pricing.
- Existing `config.lib.mjs`/`getClaudeEnv`: already handles model-specific effort, adaptive thinking and manual-budget restrictions. Commander and organization adapters reuse it rather than adding another Claude registry.
- Installed `agent-commander` 0.10.1: its tool-specific arguments/environment are existing integration points; passing the resolved Codex setting there preserves the execution adapter and its other options.
- [openai/codex#44219](https://github.com/openai/codex/issues/44219): documents the missing API-key effort metadata. [#45009](https://github.com/openai/codex/issues/45009) independently describes a default-model switch retaining unsupported `none`. The added report distinguishes picker choices, API capabilities and delegation mode and suggests validation before requests.

Alternatives considered: hard-code `off → low` for every model (would disable valid `none` choices); omit every effort (would discard supported explicit requests); probe inference to validate settings (billable and unnecessary); duplicate a capability registry in each adapter (would drift again); infer support from model family (unsafe for future releases); start a router for each resolution (slow and redundant). The implemented shared selector plus existing cache handles each problem with deterministic, free metadata reads.

## Reproduction and validation

The first pure test failed with actual `none`, expected `low`, before the resolver changed. Separate regressions failed on Claude's explicit zero budget and on a routed task selecting CLI `low` instead of gateway `auto`. Their original outputs are retained under `data/`.

Run without credentials, network or inference:

```sh
node tests/issue-2526-reasoning-effort.test.mjs
node tests/issue-2526-model-capabilities.test.mjs
node tests/issue-2526-native-codex.test.mjs
node experiments/issue-2526/reproduce.mjs
```

The tests cover explicit/default/off/minimal levels, budget precedence and zero/positive budgets, exact supported settings, prefixed model IDs, future IDs, `auto`, deterministic ties, every finite effort subset, malformed/absent metadata, fresh/stale/disabled loading, custom binaries, gateway/direct isolation, verbose-only tracing, CLI normalization and catalogue display, native new/resumed command construction, commander/planning argument construction, and adaptive-only Claude settings. All three are registered in the default suite. Native execution tests mock the process stream and use a temporary workspace; no inference is run.

The real-process cancellation fixture now answers `debug models` and uses a temporary state directory. Its prior executable accepted only task input, so the new metadata read blocked on stdin and exceeded the existing 10-second probe bound. The bound remains unchanged; `data/cancellation-before.log` and `cancellation-after.log` retain the failing and passing evidence.

Existing dynamic-discovery tests now use a future fixture `gpt-6.2-sol`, because GPT-6.1 Sol is bundled. The default-off test uses a model with verified `none` support instead of an unrelated Agent model ID passed into the Codex resolver. Supported behavior remains tested.

Test/check results and CI investigation are recorded in [validation.md](validation.md). Raw local output remains in ignored `ci-logs/`; compact evidence is retained alongside this study. No frontend or visual UI was changed, so screenshots are not applicable.

## Evidence inventory and limits

| Artifact                                                                                 | Origin / purpose                                                                                |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `data/issue.json`, `issue-comments.json`                                                 | Complete issue body and paginated conversation; no issue comments at initial investigation.     |
| `data/pr-{conversation-comments,review-comments,reviews}.json`                           | All three PR feedback types; reviews and inline comments were empty.                            |
| `data/linked-failure-comment.json`, `failure.log`                                        | Linked task report and authenticated gist `94d79ed3cb72343c2b9c9de5e24fadbc`.                   |
| `data/codex-models.json`                                                                 | Capability snapshot from the installed CLI, with large instructions omitted as described above. |
| `data/initial-ci-runs.json`, `ci-*.json`                                                 | Initial run SHA/timestamp/conclusion and jobs metadata.                                         |
| `data/related-pr-*.json`, `related-code-search.txt`, `router-model-routing-aggregate.rs` | Recent implementation history and shared-component research.                                    |
| `data/upstream-*.json`, `upstream-search.json`, `upstream-report-url.txt`                | Existing related upstream issues and the report added during this investigation.                |
| `data/ci-approved-*.json`, `ci-checks-37339179788-attempt-2.log`                         | Approved-run metadata and complete failed-check logs.                                           |
| `data/cancellation-{before,after}.log`, `dependency-freshness-after.log`                 | Bounded fixture regression and refreshed dependency validation.                                 |
| `data/local-validation.log`                                                              | Compact final local results; all 547 default-suite test files pass.                             |
| `data/ci-{audit,docker}-*.json`, `ci-*-attempt-1.json`                                   | Hosted-runner acquisition failures, annotations and preserved attempt metadata.                 |
| `data/ci-test-summaries.log`, `ci-implementation-*.json`                                 | Exact passing CI test summaries and completed implementation workflow metadata.                 |
| `data/*-before.log`, `reproduction-after.log`                                            | Failing local reproductions and fixed selector output.                                          |

The initial workflow runs were created after the prepared commit and reference its exact SHA. Both completed `action_required` in roughly one second, before creating any job/check run. `gh run view --log` returned `failed to get run log: log not found` for both. This is an Actions gate, not a failed assertion; no nonexistent compiler/test error is inferred. Actions accepted approval for both runs at 18:45 UTC. The second attempt then exposed five baseline stale dependency pins; Security passed. The exact errors and maintenance fix are recorded in the validation record. Fresh implementation runs are verified independently.
