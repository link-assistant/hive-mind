# Issue #2084 — root cause analysis

## The defect

`provisionCodexCapabilities` verified capability by re-reading
`codex plugin list --json` and checking that each required plugin appeared with
`installed: true, enabled: true`. That is a statement about _enablement_. The
requirement it was standing in for is _exposure_: whether the model receives
`superpowers:using-superpowers` in its prompt.

Those two properties are independent, and the failing run is precisely the case
where they diverge.

## How Codex actually exposes skills

Verified against `openai/codex` source and reproduced locally
(`experiments/issue-2084/reproduce-skill-exposure.sh`).

Skills are not a tool. Codex renders a catalog into a `<skills_instructions>`
block in the prompt, listing each skill as
`- <name>: <description> (file: <path>)`. There are two roots that matter here:

| Root                                                                                | Exposed as        | Follows `CODEX_HOME`?      |
| ----------------------------------------------------------------------------------- | ----------------- | -------------------------- |
| `$CODEX_HOME/skills/<name>/SKILL.md`                                                | `<name>` (bare)   | yes (deprecated upstream)  |
| `$CODEX_HOME/plugins/cache/<marketplace>/<plugin>/<version>/skills/<name>/SKILL.md` | `<plugin>:<name>` | yes                        |
| `$HOME/.agents/skills/<name>/SKILL.md`                                              | `<name>` (bare)   | **no** — joined to `$HOME` |

A plugin's skills are read from the materialized payload under
`plugins/cache`, not from the marketplace snapshot and not from `config.toml`.

## Reproduction

```
==> FACT 1: skills exposed while the plugin cache is present
superpowers:using-superpowers
… 14 total

==> FACT 2: remove plugins/cache, leave config.toml untouched
--- config.toml still declares the plugin as enabled:
[plugins."superpowers@issue2084"]
enabled = true
--- codex plugin list now reports:
superpowers@issue2084  not installed
```

So the _payload_ is what makes skills visible, and in a clean local marketplace
`codex plugin list` tracks the payload faithfully.

## What made the failing run different

In the failing run `codex plugin list` reported
`installed, enabled  2f1a8948`. Two details separate it from the clean case:

1. **The version is `2f1a8948`, not `5.1.3`.** The curated plugin manifest
   (`openai/plugins`, `plugins/superpowers/.codex-plugin/plugin.json`) declares
   `"version": "5.1.3"`. A short hex string in that column indicates the entry
   was resolved through the curated-snapshot sync rather than from a manifest
   version.
2. **The `PATH` column points at `.tmp/plugins/plugins/superpowers`** — the
   marketplace snapshot — rather than at a `plugins/cache/…` directory.

The plugin content itself is not at fault: the curated `superpowers` plugin
ships all fourteen skills, declares `"skills": "./skills/"`, and includes every
one of the six the issue mandated. Installing that exact plugin payload locally
exposes all fourteen (`experiments/issue-2084/reproduce-skill-exposure.sh`).

So the scoped `CODEX_HOME` held a plugin registration that satisfied
`codex plugin list` while the skill loader found nothing to read. Hive Mind's
`prepareScopedCodexHome` materializes `config.toml`, `auth.json`,
`installation_id`, a symlink to `.tmp/plugins` and a copy of `.tmp/plugins.sha`
— it never syncs `plugins/cache`. Whether the scoped cache was absent or stale,
the verification could not tell the difference, because it never looked.

## Why the model's own escape hatch could not work

The model tried `request_plugin_install` and got:

```
plugin_id must match one of the entries in the <recommended_plugins> list
```

That tool validates against a server-supplied allowlist fetched from
`/ps/plugins/suggested`, behind a ChatGPT-auth check. In a solver container the
list is empty, so the call fails for _any_ `plugin_id`. It is not configurable
client-side. The model did the right thing and stopped.

## Contributing factor: detection asymmetry

The preflight logged `detected 0 plugin and 6 skill requirement(s)` even though
the issue names `superpowers@openai-curated-remote` explicitly. The plugin was
recovered indirectly, by mapping the six namespaced skills back to a providing
plugin. That worked here, but it means an issue naming only a plugin — with no
namespaced skill — yields a weaker signal than the prose warrants. Worth
revisiting; not the cause of this failure.

## Hypotheses considered and rejected

| Hypothesis                                                            | Verdict                                                                                                                      |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `CODEX_HOME` redirection silently failed                              | **Rejected.** The rerun shows scoped paths for the snapshot, rollouts and the skills watcher                                 |
| `installed_plugin_ids=[]` proves the loader found no plugins          | **Rejected.** That line is the _remote_ bundle sync; empty is expected for a local curated install                           |
| `multi_agent` was disabled                                            | **Rejected.** `codex features list` shows `multi_agent stable true`. It gates `spawn_agent`/`wait_agent`, not skill exposure |
| The curated `superpowers` plugin ships no skills                      | **Rejected.** It ships 14, and declares `"skills": "./skills/"`                                                              |
| A different `plugin_id` would have made `request_plugin_install` work | **Rejected.** The allowlist is empty and server-supplied                                                                     |
| `sh -lc` clobbered `CODEX_HOME`                                       | **Rejected.** The scoped path appears in Codex's own runtime logs                                                            |

## The fix

Verify against the catalog the model receives. `codex debug prompt-input`
prints the rendered prompt; parsing its `<skills_instructions>` block gives the
exact set of skill names the model can see. The preflight now compares the
detected requirements against that set.

When the requirement is not met, the error names the missing skill, lists what
_was_ visible, and points at `plugins/cache` — so the next occurrence is
diagnosable from the log alone rather than requiring a live rerun.

The probe is advisory: if `codex debug prompt-input` is unavailable or
unparseable, the preflight logs a verbose note and falls back to the previous
behaviour. A stronger check must not become a new failure mode.

## What this does not fix

The preflight now _detects_ the condition rather than passing through it. It
does not yet _repair_ it by materializing the plugin payload into the scoped
`plugins/cache` itself. Detection is the correct first step: the failing run's
real cost was that it consumed a full solver run and produced a confusing
"capability unavailable" report instead of an actionable one. Repair needs a
decision about which source of truth to install from, and should be driven by a
log from the new diagnostics rather than by inference.
