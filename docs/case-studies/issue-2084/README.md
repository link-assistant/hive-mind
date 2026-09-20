# Issue #2084 — `Locate superpowers:using-superpowers — capability unavailable.`

Why the issue #2074 capability preflight succeeded for
[CEHR2005/GCS-TS#2](https://github.com/CEHR2005/GCS-TS/pull/2) and failed for
[CEHR2005/GCS-TS#4](https://github.com/CEHR2005/GCS-TS/pull/4).

## One-paragraph summary

The preflight verified the wrong thing. It confirmed that
`superpowers@openai-curated` was _enabled_ in the repository-scoped
`CODEX_HOME` and then allowed the run to proceed. Codex only renders a plugin's
Agent Skills into the model prompt while the plugin _payload_ is materialized
under `CODEX_HOME/plugins/cache/<marketplace>/<plugin>/<version>/skills`.
Enablement and exposure are independent, so the run started with the model
seeing zero `superpowers:*` skills, and the target repository's own mandatory
Superpowers preflight correctly refused to implement anything. Every layer
behaved as designed; the only defect is that Hive Mind's success signal did not
measure what the model receives.

## Contents

| File                                 | Purpose                                                       |
| ------------------------------------ | ------------------------------------------------------------- |
| [`timeline.md`](timeline.md)         | Reconstructed sequence of events across both runs             |
| [`analysis.md`](analysis.md)         | Root cause, with the evidence for and against each hypothesis |
| [`requirements.md`](requirements.md) | Each requirement from the issue, its status, and the plan     |
| [`research.md`](research.md)         | Verified upstream mechanics of Codex plugins and skills       |
| `raw/`                               | The two captured run logs                                     |
| `data/`                              | Issue and comment payloads from CEHR2005/GCS-TS #1–#4         |

The reproduction that establishes the mechanism is
[`experiments/issue-2084/reproduce-skill-exposure.sh`](../../../experiments/issue-2084/reproduce-skill-exposure.sh).

## The decisive evidence

From the operator rerun (`raw/rerun-log-pr-1784480697926.txt`, line 1176),
`codex plugin list` inside the repository-scoped home:

```
superpowers@openai-curated   installed, enabled  2f1a8948  …/.tmp/plugins/plugins/superpowers
```

From the same run, what the model actually received:

```
codex_core_skills::service: skills cache cleared (0 entries)
```

Installed, enabled, and invisible — simultaneously.

The reproduction closes the loop in both directions:

```
with cache:    14 superpowers skills exposed
without cache: 0 superpowers skills exposed, plugin reported 'not installed'
```

## The fix

`src/codex-capability-preflight.lib.mjs` now verifies requirements against the
`<skills_instructions>` block that Codex renders into the prompt, read via
`codex debug prompt-input`. If a required skill is not in that block the
preflight reports it — naming the skill, listing what _was_ visible, and
pointing at `plugins/cache` — instead of reporting success.

The check is advisory when the probe cannot run (a Codex build without
`debug prompt-input`, or a sandbox that blocks it), so it can only ever add
signal, never fail a run that previously succeeded.

Regression coverage: `tests/test-issue-2084-codex-skill-visibility.mjs`.
