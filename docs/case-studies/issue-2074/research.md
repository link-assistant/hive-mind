# Online and component research

Research was performed on 2026-07-17 using primary sources and the installed CLI.

## Findings

1. The current Codex manual documents plugin provisioning before `codex exec`, including a fresh `CODEX_HOME` in CI. It also defines `CODEX_HOME` as the root for config, auth, state, and plugins. This supports a pre-execution scoped home rather than in-session installation. Source: [OpenAI Codex manual](https://developers.openai.com/codex/codex-manual.md).
2. The manual identifies `.agents/skills` as the repository/user Agent Skills discovery convention. Source: [OpenAI Codex manual](https://developers.openai.com/codex/codex-manual.md).
3. Superpowers' current README recommends the official Codex plugin marketplace and `/plugins`; its plugin manifest declares a skills-only plugin with `./skills`. Sources: [Superpowers README](https://github.com/obra/superpowers/blob/main/README.md), [plugin manifest](https://github.com/obra/superpowers/blob/main/.codex-plugin/plugin.json).
4. The older native Agent Skills installation material is deprecated in favor of the plugin. Hive Mind should therefore prefer Codex's catalog when a required provider exists, while still propagating operator-managed standard Agent Skills. Source: [Superpowers repository](https://github.com/obra/superpowers).
5. The Agent Skills specification standardizes `SKILL.md` directory structure and progressive discovery. Source: [Agent Skills specification](https://agentskills.io/specification).
6. The installed `codex-cli 0.144.4` exposes stable `plugin list --available --json` and `plugin add PLUGIN@MARKETPLACE --json` commands. Catalog inspection returned `superpowers@openai-curated`; the blocked environment tool used `superpowers@openai-curated-remote`. This is an interface alias mismatch, not evidence that the plugin is absent upstream.

## Upstream issue decision

No new upstream issue was opened against Superpowers or Codex. Their current documentation, manifest, and CLI behavior are internally consistent, and no minimal reproduction demonstrated an upstream defect. Opening a report would duplicate noise without an actionable upstream code change. The related GCS-TS task should instead receive the Hive Mind fix and rerun instructions because that is where the blocked workflow can be verified end to end.
