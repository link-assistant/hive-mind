# Issue #2088 — requirement ledger

Every requirement stated in the issue body, in the issue comment, and in the
acceptance-criteria checklist — with its status and the evidence for it. Status
is **done**, **partial**, or **deferred**, with the reason stated rather than
implied.

## From "Required behavior"

| #   | Requirement                                                        | Status   | Evidence                                                                                                                               |
| --- | ------------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Create or refresh the repository-scoped `CODEX_HOME`               | **done** | `prepareScopedCodexHome` (pre-existing, #2074); config merge keeps operator runtime settings fresh and scoped plugin blocks persistent |
| B2  | Resolve the required skill provider from the trusted marketplace   | **done** | `resolveRequiredCapabilities` maps each required skill to its provider plugin from `plugin list --json --available`                    |
| B3  | Materialize or repair the payload in the scoped `plugins/cache`    | **done** | `repairScopedPluginPayloads` → `install` → `reinstall` → `copy-operator-payload`                                                       |
| B4  | Probe the exact scoped environment with `codex debug prompt-input` | **done** | `checkModelVisibleSkills` runs with `env: scopedEnv`, the same env `codex exec` gets                                                   |
| B5  | Confirm every required skill is in `<skills_instructions>`         | **done** | `parseModelVisibleSkills`; a `missing` verdict triggers one forced rebuild, then throws                                                |
| B6  | Start the solver only after verification succeeds                  | **done** | `runCodexCapabilityPreflight` is awaited at `src/codex.lib.mjs:748`, immediately before `executeCodexCommand`                          |
| B7  | On failure, stop before `codex exec` with an actionable diagnostic | **done** | The thrown error names the missing skills, the expected cache path, the scoped home, and every repair attempted                        |

## From "Requirements inferred heuristically may remain advisory"

**Done.** `detectRequiredCodexCapabilities` returns an `explicit` set containing
only _qualified_ references — `plugin@marketplace` in plugin context, or
`plugin:skill` after a requirement verb. An unrepairable explicit requirement
throws with `details.failClosed === true`; an unrepairable heuristic guess
(`$name`, `` `name` skill ``) still degrades, which preserves #2077's
false-positive protection. `HIVE_MIND_CODEX_CAPABILITY_ADVISORY=1` opts out of
fail-closed entirely; `HIVE_MIND_CODEX_CAPABILITY_STRICT=1` (from #2084) still
forces a hard failure for everything.

## From "alias normalization"

**Done.** `normalizePluginSelector` maps `@openai-curated-remote` →
`@openai-curated`, and satisfaction is decided by whether the requested skills
are model-visible, never by alias equality. Covered by
`tests/test-issue-2088-codex-plugin-cache-repair.mjs` §0.

## Acceptance criteria

| Criterion                                                                                     | Status       | Where                                                                                                                                                      |
| --------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Regression test for provider-present-but-cache-missing                                        | **done**     | `tests/test-issue-2088-codex-plugin-cache-repair.mjs` §1                                                                                                   |
| The preflight repairs it and materializes the payload                                         | **done**     | §1 asserts the payload and `repairs === ['install:superpowers@openai-curated']`                                                                            |
| `codex debug prompt-input` in the same scoped env exposes the skills                          | **done**     | The fixture CLI renders from the real cache; `experiments/issue-2088/reproduce-cache-repair.sh` proves it against the real CLI                             |
| `codex exec` never called before successful verification                                      | **done**     | §4 asserts no `exec` invocation on the failure path; the preflight precedes `executeCodexCommand`                                                          |
| Unrecoverable explicit requirement fails closed                                               | **done**     | §4; `Continuing with the operator Codex capabilities` is unreachable for explicit requirements                                                             |
| Heuristic false positives still degrade safely                                                | **done**     | §5, plus the unchanged #2077 and #2080 suites                                                                                                              |
| Idempotent and persistent across container restarts                                           | **done**     | §1b (second run performs no `add`/`remove` and returns the same scoped home); `~/.codex` is bind-mounted in isolation (`src/isolation-runner.lib.mjs:208`) |
| State stays scoped to one repository                                                          | **done**     | §6 asserts a second repository gets its own home and the operator home is untouched                                                                        |
| Works in direct execution and Docker isolation                                                | **done**     | Same code path; isolation mounts the operator `~/.codex`, so the scoped subtree comes with it                                                              |
| Tests cover stale/missing cache, repair, repair failure, alias, isolation, repeated execution | **done**     | §0–§6 of the new suite                                                                                                                                     |
| At least one end-to-end test with a real Codex CLI and rendered prompt                        | **done**     | `experiments/issue-2088/reproduce-cache-repair.sh`, captured in `raw/experiment-cache-repair.log` (14 skills → 0 → 14)                                     |
| A rerun of CEHR2005/GCS-TS#3 reaches `superpowers:using-superpowers`                          | **deferred** | Requires an operator rerun of the target task; the mechanism is proven locally but the definition of done can only be closed by that rerun                 |

## From the issue comment (konard)

> We must have similar mechanism for Claude if needed.

**Done, as a shared primitive rather than a new provisioning path** — R9.
Claude Code was verified to have the identical defect
(`experiments/issue-2088/reproduce-claude-cache-gap.sh`), so the inspection and
repair logic moved into `src/agent-plugin-cache.lib.mjs`, parameterized by a CLI
descriptor (`CODEX_PLUGIN_CLI` / `CLAUDE_PLUGIN_CLI`) and tested against both
(`tests/test-issue-2088-agent-plugin-cache.mjs`). A Claude _provisioning_ flow
is not added: Hive Mind installs no Claude plugins today (no `plugin install`
and no scoped `CLAUDE_CONFIG_DIR` anywhere under `src/`), Claude provisioning is
an explicit non-goal of this issue, and Claude Code exposes no `debug
prompt-input` equivalent, so the verification half could not be honest yet.

> Download all logs and data related to the issue into `./docs/case-studies/issue-2088`

**Done.** `data/` holds the issue, its comments, PR #2089 and the upstream
CEHR2005/GCS-TS #3/#4 payloads; `raw/` holds the failing run log and both
experiment logs.

> Deep case study: timeline, requirements, root causes, solution plans, search online, check existing components

**Done.** [`timeline.md`](timeline.md), this file, [`analysis.md`](analysis.md),
[`research.md`](research.md) — including the existing-component survey
(research §3) and the upstream issue survey (research §2).

> If there is not enough data to find the actual root cause, add debug output and verbose mode

**Not needed, and strengthened anyway.** The captured log was sufficient. The
preflight nonetheless now logs, under `--verbose`, the scoped payload inventory
per plugin, each repair attempted and why, and the resulting materialized skill
set — so the next divergence is diagnosable from the log alone.

> File issues in other repositories where relevant, with reproducible examples, workarounds and fix suggestions

**Done** — R8:

- [openai/codex#34321](https://github.com/openai/codex/issues/34321) — `plugin list` reports `installed, enabled` for a plugin whose payload is missing.
- [anthropics/claude-code#79384](https://github.com/anthropics/claude-code/issues/79384) — `plugin list --json` reports `enabled: true` with a non-existent `installPath`.

Each carries a copy-pasteable reproduction, the workaround Hive Mind uses, and
three concrete fix suggestions.

> Apply the requirements across the entire codebase (fix all occurrences)

**Done.** `grep` for other places that decide "is this capability available"
found only the Codex preflight; the Claude path has no plugin provisioning to
fix. The `plugin list`-as-proof pattern existed in exactly one function, and it
is the one this PR rewrote.
