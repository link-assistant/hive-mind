# Case study: location privacy across AI runners

Issue: [#4023](https://github.com/link-assistant/hive-mind/issues/4023).
Implementation: [PR #4024](https://github.com/link-assistant/hive-mind/pull/4024).
Research date: 2026-11-06 UTC.

## Requirements and evidence

The edited issue asks for private defaults across all tools, an option to share
location, collected repository evidence, online research, an exhaustive
requirement inventory, consideration of existing components, and implementation
of every requirement in this single PR. The captured issue has no comments or
required sub-issues. All PR conversation comments, inline comments, and reviews
were read; no additional feature requests were present.

| Requirement                                                               | Solution and execution plan                                                                                                                                                                       | Verification                                                                                  |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Default location privacy for Codex, Claude, and all other supported tools | Use one shared system policy in all six prompt builders; neutralize child timezone context; redact Codex's native search location hints                                                           | `tests/test-geolocation-policy.mjs`, six-builder coverage; native request capture below       |
| Preserve an option to share location                                      | Register default-false `--share-geolocation` for solve, task, and review; inherit the shared definition in hive; opt-in preserves timezone and native configuration                               | Parse, forwarding, relaunch, environment, and both-policy tests                               |
| Cover the full execution scope                                            | Apply policy to custom Claude/review and Codex execution prompts, agent-commander controllers, and task-splitting commands; apply neutral timezone to connection checks too                       | Adapter and task regression suites; mock native Codex experiment                              |
| Collect issue-related data in this repository                             | Preserve issue and every comment surface, sub-issue inventory, original CI state, upstream audit excerpts, and bounded experiment results under `data/`                                           | JSON evidence files and experiment logs                                                       |
| Deep case study with additional online facts                              | Audit native settings and upstream source; distinguish explicit location hints from IP inference; reproduce TOML merging and compare alternatives                                                 | Source inventory and root-cause analysis below                                                |
| Check existing components and propose solutions/plans per requirement     | Reuse prompt localization, shared CLI definitions, option replay, environment overlays, and agent-commander's existing raw options; compare native configuration, prompts, and proxy alternatives | Component and alternative analysis below; requirement table maps every plan to implementation |
| Complete work in one PR, including verification and release preparation   | Add a Changeset, focused regression tests, documentation, merge current main, and run existing current-head CI before marking PR ready                                                            | [Work plan](PLAN.md), PR checks and validation notes                                          |

## Findings and root cause

The repository supports six native runners: Claude, Codex, Agent, OpenCode,
Gemini, and Qwen, plus an optional agent-commander adapter and task planner.
There was no common location preference or instruction. Independent command
construction made a tool-specific prompt change insufficient, especially for
custom review prompts, planning subprocesses, and controller-based execution.
Every child inherited the host timezone, which can become model context even
without a deliberate location lookup.

Codex has a separate, non-prompt disclosure path. Its optional web-search
configuration accepts country, city, region, and timezone. Those values become
`user_location` in the Responses tool specification, before the model decides
whether to search. A privacy instruction cannot redact a request already sent.
The OpenAI [web-search guide](https://developers.openai.com/api/docs/guides/tools-web-search)
documents these location fields. The
[Codex configuration reference](https://developers.openai.com/codex/config-reference/)
documents the optional search configuration independently from the search mode.

The initial experiment used `tools.web_search.location={}`. Codex recursively
merges tables, so this retained every inherited location value. The preserved
`empty-table-regression.log` shows the failed assertion and synthetic location
still present in the request. Resetting `tools.web_search=false` did clear
location, but also cleared domain restrictions and context size. That would
change existing search behavior and was rejected.

The implementation instead sets all four location strings to empty values on
each private invocation. The wire capture verifies that no configured location
values survive and that domain restrictions, live search, and context size
remain unchanged. A real Codex request using the installed default model also
completed successfully with the redaction override; its retained evidence is
limited to the exit code and `OK` response. This validates request acceptance,
not search relevance, provider-side inference, or all future CLI versions.

## Online source audit

The audit is bounded to the sources and versions below. Absence of a named
setting is not evidence that an external service never infers location.

| Tool / component     | Primary source and finding                                                                                                                                                                                                                                                                                                                                                      | Chosen integration                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Codex 0.167.0        | [Config types](https://github.com/openai/codex/blob/09bd19a0deb54cce82439c23373b07b84d3e5d04/codex-rs/protocol/src/config_types.rs) define four optional strings and recursive location merging; [config TOML](https://github.com/openai/codex/blob/09bd19a0deb54cce82439c23373b07b84d3e5d04/codex-rs/config/src/config_toml.rs) accepts boolean or object search configuration | Explicit field redaction with `-c`, shared system policy, UTC                                       |
| Claude Code 2.1.316  | [Settings](https://code.claude.com/docs/en/settings) and [data usage](https://code.claude.com/docs/en/data-usage) do not document a dedicated geolocation-disable switch                                                                                                                                                                                                        | Shared system instruction, including custom review prompts, and UTC; no invented environment switch |
| Gemini CLI           | [Configuration reference](https://geminicli.com/docs/reference/configuration/) and audited [schema](https://github.com/google-gemini/gemini-cli/blob/62bab5b232c15b925d31e655ce844ab939c882b7/schemas/settings.schema.json) provide no dedicated geolocation setting                                                                                                            | Existing system-prompt mechanism and child environment                                              |
| Qwen Code            | Audited [settings schema](https://github.com/QwenLM/qwen-code/blob/11c83aa21efc2c103927bdb34e321f3382c61308/packages/cli/src/config/settingsSchema.ts) has no geolocation setting                                                                                                                                                                                               | Existing system-prompt mechanism and child environment                                              |
| OpenCode             | [Configuration documentation](https://opencode.ai/docs/config/) and audited [schema](https://github.com/anomalyco/opencode/blob/0f090704c746864c54091f6423fd22c1acd59a1d/packages/cli/src/config/schema.ts) provide no dedicated geolocation setting                                                                                                                            | Existing system-prompt mechanism and child environment                                              |
| Agent                | [Source repository](https://github.com/link-assistant/agent/tree/5ac9aa7f9da07754a66744aec5a5ff0d21eb5739) [configuration schema](https://github.com/link-assistant/agent/blob/5ac9aa7f9da07754a66744aec5a5ff0d21eb5739/js/src/config/config.ts) has no geolocation switch                                                                                                      | Existing system-prompt mechanism and child environment                                              |
| Browser tools        | [Playwright geolocation emulation](https://playwright.dev/docs/emulation#geolocation) requires explicit coordinates and permission configuration                                                                                                                                                                                                                                | Do not introduce coordinates or permissions; instruct delegates to preserve the preference          |
| Provider connections | [OpenAI privacy policy](https://openai.com/policies/privacy-policy/) describes location information inferred from IP addresses                                                                                                                                                                                                                                                  | Document network/provider limits; do not claim an IP-anonymity guarantee                            |

Source-search results and exact upstream revisions are retained in `data/`.
The Codex source excerpts show the concrete native request path rather than
assuming that a privacy prompt controls it. No location-discovery service,
actual user coordinates, credentials, or browser geolocation permission was
used for the local capture.

## Existing components and alternatives

The repository already has cross-tool policies for
[memory](../../../src/agent-memory-policy.lib.mjs) and
[auxiliary model calls](../../../src/auxiliary-model-calls-policy.lib.mjs).
Recent related implementations [#2227](https://github.com/link-assistant/hive-mind/pull/2227)
and [#2237](https://github.com/link-assistant/hive-mind/pull/2237) demonstrate
scoped configuration, separate opt-outs, and shared policy builders. The change
follows those patterns instead of introducing a parallel configuration system.

| Candidate                                              | Assessment and decision                                                                                                                                                                                        |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared prompts only                                    | Necessary for arbitrary browser, MCP, shell, and delegated actions, but insufficient for Codex's preassembled request hints; combine with native redaction                                                     |
| Native configuration only                              | Stronger for a known request field, but no uniform setting across the six clients; combine with the shared prompt and UTC                                                                                      |
| Empty TOML location table                              | Demonstrated ineffective because inherited fields merge back in; reject                                                                                                                                        |
| Boolean search-settings reset                          | Clears location but removes unrelated domain filters/context; reject                                                                                                                                           |
| Rewrite global tool configuration                      | Affects unrelated sessions and complicates opt-in; use per-run overlays instead                                                                                                                                |
| New geolocation/geocoding library                      | Discovers or encodes location rather than suppressing it; adds dependencies without addressing the request                                                                                                     |
| Universal network proxy / browser sandbox              | Can provide stronger enforcement, but requires provider authentication, TLS/transport integration, and plugin coverage; disproportionate for client defaults and cannot eliminate provider inference by itself |
| Existing localization, CLI replay, and agent-commander | Reuse all three; no new dependency, no new model calls during ordinary execution                                                                                                                               |

The private policy is translated for all four work locales. Location-bearing
task content remains valid input. Opt-in changes only this policy, timezone
overlay, and Codex location override; it does not turn off memory controls,
essential features, search modes, or browser tooling.

## Reproduction and validation

Focused automated regression checks:

```bash
node --test tests/test-geolocation-policy.mjs tests/test-agent-commander-option.mjs tests/test-task-split.mjs
node --test tests/provider-transient-recovery-3831.test.mjs
```

The first test suite checks all six real prompt builders, explicit opt-in,
all locales, forwarding, resume serialization, controller options, and planner
commands. The adapter and planning suites protect existing behavior. The existing mock
execution harness also checks private/opt-in prompts and child environments at
the actual execution boundary of all six native runners (12 additional cases).
Without the change, private instructions, UTC, and native location overrides
are absent. No source build or live model calls are needed for these tests.

Native request experiment (requires a locally installed Codex CLI):

```bash
node experiments/issue-4023/codex-location-probe.mjs
# Reproduce the original unredacted request (fails):
node experiments/issue-4023/codex-location-probe.mjs --without-fix
# Deliberately reproduce the ineffective empty-table approach (fails):
node experiments/issue-4023/codex-location-probe.mjs --empty-table
```

The script creates a temporary Codex home, configures synthetic location and
domain/context settings, and captures requests with a loopback mock server.
Each CLI subprocess has a 20-second test watchdog; the server and temporary
home are cleaned up. It compares baseline, private, and opt-in requests. All
request handling stays local. The passing capture proves redaction and
preservation of unrelated settings; the opt-in request retains the synthetic
native hints. The negative experiment provides a reproducing regression case.

The original head had four passing dispatched workflows and one older
approval-required Security run with no downloadable log. Final CI must be
checked against the implementation SHA; the original successes are not evidence
for this change. See the PR checks for current-head full-suite, lint, formatting,
security, link, and workflow validation.

The first implementation run, [42308272102](https://github.com/link-assistant/hive-mind/actions/runs/42308272102),
stopped before testing because the existing freshness gate found 21 stale
declarations/lock entries. The retained `dependency-freshness-before.log`
identifies the exact error and source-log lines 3951–3975. To satisfy the required
CI gate, the PR also refreshes Formal AI to 0.355.34, Agent to 0.27.1,
`lino-arguments` to 0.4.1, runtime `links-notation` to 0.31.3, and transitive
lockfile entries using npm's existing update mechanism. The freshness gate
remains enforced; this is release maintenance needed to validate the privacy
change, rather than an additional privacy mechanism.
The follow-up run found that `links-notation` 0.31.3 had been published after
the local inventory; the runtime pin and lock were refreshed together again.

## Scope and limits

These are client privacy defaults, not a guarantee that a network peer cannot
infer geography. The shared instruction depends on agent compliance and cannot
police arbitrary external code or override a provider's network observations.
UTC removes one hint, not every host locale or identifier. Redacted Codex search
fields contain empty strings rather than an omitted object. Future native
location fields or changed CLI schemas require updating the override and the
wire experiment. These limits are part of the user documentation, alongside the
explicit sharing option.
