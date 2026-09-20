# Issue #2084 — timeline

All timestamps are UTC, taken from the captured logs in `raw/`.

## Background

| Issue                                                            | Outcome                                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [#2074](https://github.com/link-assistant/hive-mind/issues/2074) | Introduced the Codex capability preflight and the repository-scoped `CODEX_HOME`           |
| [#2077](https://github.com/link-assistant/hive-mind/issues/2077) | `16:9` in issue prose was read as a skill name; preflight degraded to a warning            |
| [#2080](https://github.com/link-assistant/hive-mind/issues/2080) | `additionalproperties:false` false positive; plugin names verified against the CLI catalog |

Both #2077 and #2080 landed _after_ the `v2.8.3` tag. The failing run reports
`🚀 solve v2.8.3`, so it ran without them. This matters when reading the log:
the absence of some log lines reflects the older build rather than an anomalous
code path.

## The working run — CEHR2005/GCS-TS#2

Issue #1 of the target repository did not mandate Superpowers. The preflight
detected no capability requirements, took no action, and the run completed
normally. This is the "worked at PR#2" half of the question: it worked because
nothing was required, not because provisioning succeeded.

## The failing run — CEHR2005/GCS-TS#4

Source: `raw/solution-draft-log-pr-1784468775242.txt`.

| Time             | Event                                                                                                                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 13:44:12         | `solve v2.8.3` starts on CEHR2005/GCS-TS issue #3                                                                                                                                                              |
| 13:44:54         | Issue body fetched. It mandates `superpowers@openai-curated-remote` and six `superpowers:*` skills, and instructs the agent to stop rather than improvise                                                      |
| 13:45:00.591     | `🔌 Codex capability preflight: detected 0 plugin and 6 skill requirement(s)`                                                                                                                                  |
| 13:45:00.593–606 | All six skills logged as detected from the issue prose                                                                                                                                                         |
| 13:45:02.826     | `Codex capability state: /home/box/.codex/hive-mind/repositories/CEHR2005/GCS-TS`                                                                                                                              |
| 13:45:02.841     | `codex exec` begins                                                                                                                                                                                            |
| 13:45:18         | Model states it will run the mandated Superpowers workflow first                                                                                                                                               |
| 13:45:29         | Model reports `superpowers:using-superpowers` is **not exposed** in its capability list                                                                                                                        |
| 13:45:58         | Model stops cleanly: _"Locate `superpowers:using-superpowers` — capability unavailable"_, and `request_plugin_install` failed with `plugin_id must match one of the entries in the <recommended_plugins> list` |
| 13:46:05         | Working-session summary posted to PR#4; no files changed                                                                                                                                                       |

Note what is **not** in that window. There is no `✅ Provisioned …` line, and no
`✅ Required Agent Skills are already available …` line. The preflight resolved
a plugin, found it already installed in the scoped home, skipped installation,
re-listed, saw `installed, enabled`, and declared success — in 2.2 seconds.

## The operator rerun

Source: `raw/rerun-log-pr-1784480697926.txt`.

| Time         | Event                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------- |
| 16:56:56     | Same detection: `0 plugin and 6 skill requirement(s)`                                       |
| 16:57:00     | Same repository-scoped `CODEX_HOME`                                                         |
| 16:57:03.802 | `remote_installed_plugin_sync … installed_plugin_ids=[] failed_remote_plugin_ids=[]`        |
| 16:57:03.802 | `codex_core_skills::service: skills cache cleared (0 entries)`                              |
| 16:57:39     | Agent runs `codex plugin list`: `superpowers@openai-curated  installed, enabled  2f1a8948`  |
| 17:01:37     | A direct invocation probe: `skills cache cleared (1 entries)` — still no `superpowers:*`    |
| 17:04:00     | `codex features list`: `multi_agent  stable  true` — the feature flag was never the problem |
| 17:04:46     | Run ends, still blocked                                                                     |

The rerun is the crux. It shows the plugin reported as installed _and_ enabled,
the marketplace snapshot path resolving correctly through the scoped symlink,
`multi_agent` enabled — and zero skills reaching the model.

## Reading of `installed_plugin_ids=[]`

An early hypothesis treated this line as proof that the plugin loader found
nothing. It is not: the emitting module is
`codex_core_plugins::remote::remote_installed_plugin_sync`, which syncs
_remote_ (ChatGPT-backed) plugin bundles. An empty list there is expected for a
locally-snapshotted curated install and says nothing about local plugin
loading. The load-bearing line is `skills cache cleared (0 entries)`.
