# Issue #2088 — research

Everything below is either read from source, observed locally against Codex CLI
0.144.6 and the Claude Code CLI, or cited to a public issue. Inference is marked
as such.

## 1. The two commands that matter

| Command                                    | Answers                                              | Does **not** answer     |
| ------------------------------------------ | ---------------------------------------------------- | ----------------------- |
| `codex plugin list [--json] [--available]` | Is the plugin declared and enabled?                  | Is its payload on disk? |
| `codex debug prompt-input "<text>"`        | What `<skills_instructions>` will the model receive? | Why a skill is missing  |

There is no `codex plugin doctor`, `verify`, or `--repair`. `plugin add` is the
only command that materializes a payload, and it is idempotent — re-running it
on a healthy install is a cheap no-op (measured at 0.25 s in the failing run's
own log, line 1541).

## 2. Upstream issues in the same neighbourhood

None of these is the defect #2088 hits, but together they show that
cache-vs-config divergence is a recurring class in the Codex plugin system:

| Issue                                                              | Divergence                                                                           |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| [openai/codex#31365](https://github.com/openai/codex/issues/31365) | Cache present, config entry lost after an app upgrade (**the mirror image of ours**) |
| [openai/codex#21138](https://github.com/openai/codex/issues/21138) | Cache stale because refresh compares only the version string                         |
| [openai/codex#29103](https://github.com/openai/codex/issues/29103) | Marketplace source not persisted, so plugins disappear after restart                 |
| [openai/codex#30993](https://github.com/openai/codex/issues/30993) | `$skill` resolves a stale cached skill from a plugin that is not installed           |
| [openai/codex#28277](https://github.com/openai/codex/issues/28277) | Marketplace cache rebuilds incompletely, hiding plugins                              |

Searched on 2026-07-20 via `gh search issues --repo openai/codex "plugins/cache"`
and web search; no open issue reports `plugin list` claiming _installed_ for an
absent payload. That gap is filed as part of this work — see
[`requirements.md`](requirements.md) R8.

The practical consequence for Hive Mind: because divergence has several distinct
upstream causes, a fix that special-cases one of them is fragile. Repairing on
the observable end state — "the model cannot see the skill" — covers all of them
including ones not yet reported.

## 3. Existing components considered

The issue asks whether an existing component or library already solves this.
Surveyed, with the reason each was not adopted:

| Candidate                                                     | Why not                                                                                                                                                                          |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codex plugin` itself                                         | No verify/repair verb; `plugin list` is the very signal that misreports. Using it is the bug.                                                                                    |
| Package-manager style lockfile (`npm ci`)                     | Would require Codex to expose a content hash per plugin payload. It does not; `version` is a snapshot sha that stays stable across a gutted cache.                               |
| Content-hash of `plugins/cache`                               | Detects drift but not sufficiency — the question is not "did the payload change" but "does the model see the skill". The rendered prompt answers that directly.                  |
| A `codex plugin add` retry wrapper (`p-retry`, `async-retry`) | Retrying the same failing command does not help when the payload is stale-but-present and `add` is skipped, or when the marketplace is unreachable. The escalating ladder does.  |
| Nix / OCI image baking the payload                            | Would make provisioning immutable, but plugin requirements are discovered per issue at runtime, and the issue's non-goals forbid hardcoding a Superpowers-specific path.         |
| Hive Mind's own `isolation-runner.lib.mjs`                    | Reused, not replaced: it already mounts `~/.codex` into the container (`src/isolation-runner.lib.mjs:208`), so the repaired scoped home persists into Docker isolation for free. |

The conclusion is that the repair primitive is small enough (inspect → escalate →
re-probe) that a dependency would cost more than it saves; what it needed was to
stop being Codex-shaped, which is why it now lives in
`src/agent-plugin-cache.lib.mjs` with a CLI descriptor.

## 4. Claude Code: same layout, same split

Verified locally (`experiments/issue-2088/reproduce-claude-cache-gap.sh`,
output in `raw/experiment-claude-cache-gap.log`):

```
<CLAUDE_CONFIG_DIR>/plugins/cache/<marketplace>/<plugin>/<version>/skills/<skill>/SKILL.md
```

After `rm -rf` of the version directory:

```
id=demo@hive2088 enabled=True installPath=<path that no longer exists>
```

Re-running the CLI does not self-heal it; `claude plugin install demo@hive2088`
does. So the Codex repair ladder transfers verbatim; only the install/remove
verbs differ (`install`/`uninstall` vs `add`/`remove`).

What does **not** transfer is verification. Claude Code has no `debug
prompt-input`, so there is no supported way to ask "which skills will the model
receive". Inference, not verified: a scoped `CLAUDE_CONFIG_DIR` probe would also
need an authenticated session (the local attempt returned
`Not logged in · Please run /login`).

## 5. Skill roots that `CODEX_HOME` does not relocate

Carried forward from issue #2084's research and still true: Codex reads
`$HOME/.agents/skills` in addition to `$CODEX_HOME/skills`. Repository-scoped
state therefore isolates _plugin_ state but not operator-installed user skills.
This is why `resolveRequiredCapabilities` treats a requirement already satisfied
by a standard skill directory as needing no plugin at all — and why that path
still runs the visibility probe before returning.
