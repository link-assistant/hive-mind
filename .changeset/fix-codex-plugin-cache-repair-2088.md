---
'@link-assistant/hive-mind': patch
---

fix(codex): repair the repository-scoped plugin cache before `codex exec` (#2088)

The #2084 preflight measured the right thing — it asked `codex debug
prompt-input` which skills the model would receive — but had nowhere to go with
a negative answer: the provisioning step skipped `plugin add` whenever `codex
plugin list` reported the plugin `installed, enabled`, and enablement
(`config.toml`) is independent of exposure (the materialized payload under
`plugins/cache/<marketplace>/<plugin>/<version>/skills`). A scoped `CODEX_HOME`
that lost its payload therefore logged "Continuing with the operator Codex
capabilities" and started the session without the mandated skills.

The preflight now inspects the scoped payload directly, repairs it through an
escalating ladder (`install` → `reinstall` → `copy-operator-payload`), re-probes
the rendered prompt in the exact environment `codex exec` receives, and forces
one rebuild when a required skill is still invisible. An explicitly declared
plugin or `plugin:skill` requirement that cannot be made visible now fails
closed before `codex exec` with a diagnostic naming the missing skills, the
expected cache path and every repair attempted; heuristically inferred
requirements still degrade safely (#2077). The CLI-agnostic half lives in the
new `src/agent-plugin-cache.lib.mjs` and is covered against both the Codex and
Claude Code plugin verbs, since Claude Code has the same enabled-vs-materialized
split.
