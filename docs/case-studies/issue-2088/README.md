# Issue #2088 — the preflight saw the gap and walked past it

Why the issue #2084 fix detected that the required `superpowers:*` skills were
invisible, logged it, and then started `codex exec` anyway — and what it takes to
repair the repository-scoped plugin cache instead.

## One-paragraph summary

#2084 taught the preflight to measure the right thing: it now asks
`codex debug prompt-input` which skills the model will actually receive. In the
failing run it got the correct answer — five skills, none of them
`superpowers:*` — and then had nowhere to go with it, because the repair step
had already decided its work was done. `codex plugin list` reported
`superpowers@openai-curated` as `installed, enabled`, so the provisioning loop
skipped `plugin add`; enablement (`config.toml`) and exposure (the materialized
payload under `plugins/cache/<marketplace>/<plugin>/<version>/skills`) are two
independent state machines that no Codex command reconciles. Detection without
repair degraded to "Continuing with the operator Codex capabilities", the
session started against a home whose payload was missing, and the target
repository's mandatory Superpowers workflow correctly refused to implement
anything. The fix makes the rendered prompt — not `plugin list` — the authority
on whether provisioning is finished, adds an escalating repair ladder behind it,
and fails closed when an explicitly required capability cannot be made visible.

## Contents

| File                                 | Purpose                                                                    |
| ------------------------------------ | -------------------------------------------------------------------------- |
| [`timeline.md`](timeline.md)         | The failing `solve v2.8.7` run, line by line, plus the #2074→#2088 lineage |
| [`analysis.md`](analysis.md)         | Root cause, the defective control flow, and the repair ladder              |
| [`requirements.md`](requirements.md) | Every requirement from the issue and comment, with its status              |
| [`research.md`](research.md)         | Upstream mechanics, related issues, and the existing-component survey      |
| `raw/`                               | The failing run log and both experiment transcripts                        |
| `data/`                              | Issue, comment, PR and upstream CEHR2005/GCS-TS payloads                   |

Reproductions:
[`experiments/issue-2088/reproduce-cache-repair.sh`](../../../experiments/issue-2088/reproduce-cache-repair.sh)
(real Codex CLI 0.144.6) and
[`experiments/issue-2088/reproduce-claude-cache-gap.sh`](../../../experiments/issue-2088/reproduce-claude-cache-gap.sh)
(real Claude Code CLI 2.1.215).

## The decisive evidence

From the failing run (`raw/solution-draft-log-pr-1784536731842.txt`), four lines
ten milliseconds apart:

```
08:36:11.407  Model-visible skills (5): imagegen, openai-docs, plugin-creator, skill-creator, skill-installer
08:36:11.411  Codex capability preflight skipped
08:36:11.415  Continuing with the operator Codex capabilities
08:36:11.420  codex exec …
```

The gap was measured, named, and ignored — and by the time the model ran its own
`codex plugin add` at 08:37:23 (exit 0, payload materialized), the
`<skills_instructions>` block had already been rendered without it.

The reproduction shows why `plugin list` could never have caught it:

```
skills/ removed →  codex plugin list:          superpowers@repro  installed, enabled
                   codex debug prompt-input:   0 superpowers skills
```

Installed, enabled, and invisible — simultaneously. Both upstream CLIs behave
this way, so both were reported: [openai/codex#34321](https://github.com/openai/codex/issues/34321)
and [anthropics/claude-code#79384](https://github.com/anthropics/claude-code/issues/79384).

## The fix

`src/codex-capability-preflight.lib.mjs` no longer treats `plugin list` as proof.
It inspects the scoped `plugins/cache` payload directly, repairs it through an
escalating ladder (`install` → `reinstall` → `copy-operator-payload`), re-probes
`codex debug prompt-input` in the exact environment `codex exec` will get, and
forces one rebuild if a required skill is still invisible. An explicitly
required capability that survives all of that throws before `codex exec`, with a
diagnostic naming the missing skills, the expected cache path and every repair
attempted; heuristically inferred requirements still degrade, preserving #2077's
false-positive protection.

The CLI-agnostic half lives in `src/agent-plugin-cache.lib.mjs` and is exercised
against both the Codex and Claude Code plugin verbs, because Claude Code has the
same defect — see [`requirements.md`](requirements.md) R9 for why that stops at a
shared primitive rather than a Claude provisioning path.
