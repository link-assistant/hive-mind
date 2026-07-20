# Issue #2088 — root cause analysis

## The one-sentence version

The preflight measured the right thing and then did nothing about it: a
repository-scoped `CODEX_HOME` can declare a plugin enabled and resolve its
marketplace while the payload under
`plugins/cache/<marketplace>/<plugin>/<version>/skills` is missing or gutted,
and the code treated "already installed" as "nothing to do".

## Two independent state machines

| Property       | Where it lives                                                    | What reports it                                      |
| -------------- | ----------------------------------------------------------------- | ---------------------------------------------------- |
| **Enablement** | `CODEX_HOME/config.toml` → `[plugins."id"] enabled = true`        | `codex plugin list` (`installed/enabled`)            |
| **Exposure**   | `CODEX_HOME/plugins/cache/<mkt>/<plugin>/<ver>/skills/*/SKILL.md` | `codex debug prompt-input` → `<skills_instructions>` |

Codex never reconciles the two. There is no `codex plugin doctor`, no
`--verify`, and `plugin list` does not stat the payload it points at.

`experiments/issue-2088/reproduce-cache-repair.sh` proves this against the real
CLI (0.144.6); `docs/case-studies/issue-2088/raw/experiment-cache-repair.log`
is the captured run:

```
healthy payload:            14 skills
payload deleted:             0 skills (config still says enabled)
after 'codex plugin add':   14 skills
stale payload:               0 skills   <-- while `plugin list` prints "installed, enabled"
operator payload copied in: 14 skills
```

The **stale payload** case is the production signature. A version directory that
survives without its `skills/` subtree keeps `plugin list --json` returning
`installed: true, enabled: true`, so any provisioning step gated on that answer
skips the one command that would fix it.

## The defective control flow

Before this PR, `provisionCodexCapabilities` did, in effect:

```js
const installed = new Set(catalog.installed.filter(p => p.installed && p.enabled).map(p => p.pluginId));
for (const plugin of required) {
  if (installed.has(plugin)) continue; // <-- unreachable repair
  await runCommand({ command, args: ['plugin', 'add', plugin], env: scopedEnv });
}
```

`installed.has(plugin)` is true for exactly the broken state #2088 describes.
The `continue` is therefore not an optimization; it is the bug. The #2086
visibility probe ran _after_ this loop, diagnosed the result correctly, and
then — because #2077 had made every capability failure advisory — logged
`Continuing with the operator Codex capabilities` and started `codex exec`.

## Why "advisory" was the right answer in #2077 and the wrong one here

#2077 was a false-positive problem: `16:9` in issue prose became a "required
skill", and hard-failing on it would have blocked unrelated tasks. The fix made
every capability failure a warning. That conflates two very different
detections:

- `superpowers@openai-curated-remote` in plugin context, or
  `superpowers:using-superpowers` after a requirement verb — a **qualified**
  reference that prose cannot produce by accident.
- `$name` or `` `name` skill `` in free text — a **guess**.

The fix classifies them. `detectRequiredCodexCapabilities` now returns an
`explicit` set; an unrepairable explicit requirement throws
(`details.failClosed === true`) and an unrepairable heuristic guess still
degrades. `HIVE_MIND_CODEX_CAPABILITY_ADVISORY=1` restores the old behaviour for
operators who prefer a degraded run to no run.

## The repair ladder

Repair escalates cheapest-first and stops at the first strategy that
materializes the payload; every attempt is recorded so a failure diagnostic can
say what was tried.

| Strategy                | Action                                                             | Handles                                         |
| ----------------------- | ------------------------------------------------------------------ | ----------------------------------------------- |
| `install`               | `codex plugin add <id> --json`                                     | Missing or stale payload, marketplace reachable |
| `reinstall`             | `plugin remove` + `rm -rf` the cache dir + `plugin add`            | Corrupt payload or a wedged config entry        |
| `copy-operator-payload` | Copy the operator home's materialized payload into the scoped home | Marketplace snapshot unreachable (offline)      |

After the ladder runs, the model-visible probe runs again. If the probe still
reports the skills missing, one forced rebuild is attempted (starting at
`reinstall`, since `install` is by definition a no-op on a payload that already
looks healthy) and the probe repeats. Only then does the preflight give up —
and giving up means throwing before `codex exec`, not warning past it.

## Why `superpowers@openai-curated-remote` never resolves

The target repository mandates `superpowers@openai-curated-remote`. That
marketplace does not exist in the Codex CLI; the curated snapshot is named
`openai-curated`. The model's own attempt to satisfy the requirement literally
failed with `plugin_id must match one of the entries in the
<recommended_plugins> list` (log line 1965). `normalizePluginSelector` maps the
`-remote` alias onto the real marketplace, and satisfaction is then judged by
whether the requested **skills** are model-visible — not by whether the alias
string matches.

## Does Claude Code have the same defect?

Yes — verified against the real CLI in
`experiments/issue-2088/reproduce-claude-cache-gap.sh`
(`raw/experiment-claude-cache-gap.log`):

```
FACT 1  install materializes <config>/plugins/cache/hive2088/demo/1.0.0/skills/demo-skill/SKILL.md
FACT 2  rm -rf of that version directory leaves
        `claude plugin list --json` reporting enabled=True with an installPath that no longer exists,
        and re-running the CLI does not self-heal it
FACT 3  `claude plugin install demo@hive2088` re-materializes the payload
```

Same layout, same split, same repair. What Claude Code lacks is the second half:
there is no `debug prompt-input` equivalent, so the model-visibility half of the
Codex preflight cannot be reproduced for Claude, and a scoped
`CLAUDE_CONFIG_DIR` is not authenticated in this environment.

Hive Mind does not install Claude plugins at all today (no `plugin install` and
no scoped `CLAUDE_CONFIG_DIR` anywhere under `src/`), and Claude provisioning is
an explicit non-goal of this issue. The decision taken — see
[`requirements.md`](requirements.md) R9 — is to extract the repair primitive
into `src/agent-plugin-cache.lib.mjs` with a CLI descriptor
(`CODEX_PLUGIN_CLI` / `CLAUDE_PLUGIN_CLI`), so the day Hive Mind provisions a
Claude plugin the repair already exists and is already tested, without adding an
unused provisioning path now.
