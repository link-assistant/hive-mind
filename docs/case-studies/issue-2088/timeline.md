# Issue #2088 — timeline

All timestamps are UTC. Log lines are cited by line number in
`raw/solution-draft-log-pr-1784536731842.txt` (the run linked from the issue).

## Background — how the preflight arrived here

| Issue / PR                                                       | Outcome                                                                                               |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [#2074](https://github.com/link-assistant/hive-mind/issues/2074) | Introduced the Codex capability preflight and the repository-scoped `CODEX_HOME`                      |
| [#2077](https://github.com/link-assistant/hive-mind/issues/2077) | `16:9` read as a skill name; detection tightened, failures degraded to warnings to protect prose runs |
| [#2080](https://github.com/link-assistant/hive-mind/issues/2080) | `additionalproperties:false` false positive; plugin names verified against the CLI catalog            |
| [#2084](https://github.com/link-assistant/hive-mind/issues/2084) | Discovered that _enablement_ ≠ _exposure_; added a `codex debug prompt-input` visibility probe        |
| [#2086](https://github.com/link-assistant/hive-mind/pull/2086)   | Shipped that probe and **explicitly deferred** repairing `plugins/cache`                              |
| **#2088**                                                        | The deferred repair: detection without repair still burns a solver session                            |

Each step made the signal more honest. None of them made the state correct.
#2088 is the first to require an action rather than a better measurement.

## The failing run — CEHR2005/GCS-TS#3 → PR #4, `solve v2.8.7`

| Time              | Line   | Event                                                                                                                                                                                               |
| ----------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 08:35:09.147      | 6      | `🚀 solve v2.8.7` — this build already contains the #2086 visibility probe                                                                                                                          |
| 08:36:01.030      | 260    | `🔌 Codex capability preflight: detected 0 plugin and 6 skill requirement(s)`                                                                                                                       |
| 08:36:01.037–058  | 261–66 | All six `superpowers:*` skills detected, each with the issue line it came from (the #2077 evidence logging)                                                                                         |
| 08:36:01.951      | 267    | `✅ Verified superpowers@openai-curated in the Codex plugin catalog` — the provider resolved from the marketplace                                                                                   |
| 08:36:11.407      | 268    | `🔎 Model-visible skills (5): imagegen, openai-docs, plugin-creator, skill-creator, skill-installer` — **no `superpowers:*`**                                                                       |
| 08:36:11.411      | 269    | `⚠️ Codex capability preflight skipped: Codex reports the required plugins as installed, but the model cannot see: …` — the diagnostic is correct and complete                                      |
| 08:36:11.415      | 270    | `Continuing with the operator Codex capabilities. Set HIVE_MIND_CODEX_CAPABILITY_STRICT=1 to fail instead.` — **the defect**                                                                        |
| 08:36:11.420      | 272    | `🤖 Executing Codex` — the solver session starts in a state already known to be unable to satisfy the task                                                                                          |
| 08:36:15.497      | 443    | `codex_core_skills::service: skills cache cleared (0 entries)` inside the session                                                                                                                   |
| 08:37:20.743      | 1462   | The model runs `codex plugin list` itself: marketplace `openai-curated` resolves from `/home/box/.codex/.tmp/plugins`, every plugin listed as `not installed`                                       |
| 08:37:23.835      | 1546   | The model runs `codex plugin add superpowers@openai-curated --json` — **exit 0**, `installedPath: /home/box/.codex/plugins/cache/openai-curated/superpowers/2f1a8948`                               |
| 08:37:40–08:38:24 | 1683+  | The model tries `codex exec … '$using-superpowers …'` in sub-sessions; the skills still are not in _its own_ prompt, which was rendered before the install                                          |
| 08:38:38.643      | 1965   | Final answer: _"Blocked by the mandatory repository workflow before implementation … Installed local `superpowers@openai-curated` successfully, but it does not expose the required remote skill."_ |
| 08:38:45.851      | 2145   | Working-session summary attached to PR #4; **1 file modified, 1 line added** — no implementation                                                                                                    |

Elapsed from the honest diagnostic to the blocked stop: **2 minutes 27 seconds**
of paid model time spent confirming what the preflight already knew at
08:36:11.

## Two facts this run establishes that #2084 did not

1. **The degraded path runs against the operator home, not the scoped one.**
   Line 1462 shows the in-session `codex plugin list` reading
   `/home/box/.codex/.tmp/plugins` and reporting every plugin as
   `not installed`, while the preflight one minute earlier reported the plugin
   as installed. Those are two different `CODEX_HOME`s: the preflight inspected
   the repository-scoped home (where `config.toml` declared the plugin enabled
   from an earlier run) and then, on degrading, returned no `codexHome`, so the
   session launched against the operator home.

2. **Repair after `codex exec` starts is too late.** The model's own
   `plugin add` at 08:37:23 succeeded and materialized the payload, and the
   skills still never appeared. Codex renders `<skills_instructions>` when the
   session starts; a payload materialized afterwards does not retroactively
   enter the prompt. This is why the repair has to happen in the preflight and
   why acceptance criterion "`codex exec` is never called before successful
   verification" is not merely a policy preference.
