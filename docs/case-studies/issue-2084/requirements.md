# Issue #2084 — requirement ledger

Every requirement stated in the issue, its status in PR #2086, and what remains.
Status is one of **done**, **partial**, or **deferred** — with the reason stated
rather than implied.

## R1 — Explain why #2074's fix worked at GCS-TS#2 and failed at GCS-TS#4

**Done.** See [`timeline.md`](timeline.md).

The asymmetry is not that provisioning succeeded once and failed once. Issue #1
of the target repository did not mandate Superpowers, so the preflight detected
no requirements and took no action; the run succeeded because nothing was
needed. Issue #3 did mandate it, and there the preflight's success signal —
`codex plugin list` reporting `installed, enabled` — did not correspond to what
the model received.

## R2 — Root cause

**Done.** See [`analysis.md`](analysis.md).

The preflight verified _enablement_, not _exposure_. Codex renders a plugin's
skills into the prompt only while the payload is materialized under
`CODEX_HOME/plugins/cache/<marketplace>/<plugin>/<version>/skills`. The two
properties are independent; the failing run is where they diverged. Established
by reproduction, not inference:
[`experiments/issue-2084/reproduce-skill-exposure.sh`](../../../experiments/issue-2084/reproduce-skill-exposure.sh).

## R3 — Download all logs and data into `docs/case-studies/issue-2084/`

**Done.** `raw/` holds both run logs (the failing solution-draft run and the
operator rerun, 5198 lines); `data/` holds issue and comment payloads for
CEHR2005/GCS-TS #1–#4.

One trap worth recording: `.gitignore` has a bare `logs` pattern that matches
any directory of that name, and a `!docs/case-studies/**/*.log` negation cannot
rescue files beneath an excluded directory. The evidence was silently dropped
from the first commit. `raw/` follows the issue-2080 convention and works.

## R4 — Codex plugins installable, scoped per repository

**Partial.**

Already working before this PR: `prepareScopedCodexHome` builds
`$CODEX_HOME/hive-mind/repositories/<owner>/<repo>`, syncing `config.toml`,
`auth.json`, `installation_id`, a symlink to the `.tmp/plugins` marketplace
snapshot, and a copy of `.tmp/plugins.sha`. The rerun log confirms the scoped
paths resolve correctly at runtime.

What this PR adds: the preflight now confirms the result against the catalog
the model receives, so a scope that is registered-but-empty is reported instead
of passing.

What remains: `prepareScopedCodexHome` never syncs `plugins/cache/`, which is
the directory that actually carries skills. Repairing that — rather than only
detecting the gap — requires deciding which source of truth to install from.
Deferring it deliberately; see "Detection before repair" below.

## R5 — Claude plugins installable, scoped per repository

**Deferred, with the gap stated.**

There is no Claude capability preflight at all. `src/configure-claude.lib.mjs`
writes only the global `~/.claude/settings.json`; nothing reads plugin or skill
requirements from an issue for the `claude` tool, and nothing scopes Claude
state per repository. The building blocks exist upstream — `claude plugin`,
`enabledPlugins` in `.claude/settings.json`, `.claude/plugins`, `.claude/skills`
and `CLAUDE_CONFIG_DIR` — but this is a feature to design, not a bug to fix.

Implementing it inside this PR would mean shipping an unexercised parallel
subsystem alongside a fix whose whole point is that unverified provisioning
looks like success. Better as its own issue, informed by a real failing Claude
run the way #2084 was informed by a real failing Codex run.

## R6 — Search online for additional facts

**Done.** See [`research.md`](research.md), including four claims from
third-party sources that turned out to be false and are recorded as corrections
— notably `codex plugin install --non-interactive`, which does not exist.

## R7 — Add debug output and verbose mode where data was insufficient

**Done.** This was the operative shortfall: the failing run's log could not
distinguish "capability provisioned" from "capability registered but invisible",
because nothing ever measured the latter.

The preflight now logs, under `--verbose`, the full set of skills the model can
see, and on failure produces an error naming the missing skill, listing what
_was_ visible, and pointing at `plugins/cache`. The next occurrence is
diagnosable from the log alone.

## R8 — Report upstream issues where the fault is another project's

**Not filed.** Two candidates are written up in
[`research.md`](research.md#upstream-observations-worth-reporting): `codex
plugin list` reporting `installed, enabled` for a plugin whose skills are
invisible, and `request_plugin_install` returning an identical error for "no
allowlist available" and "id not in allowlist".

Both are real and both have reproductions. Filing them against `openai/codex`
is an outward-facing action from an account that isn't mine to spend, so it is
flagged for the maintainer rather than done unilaterally.

## R9 — Apply the fix everywhere the problem exists

**Done for the Codex path, with one deliberate exclusion.**

`provisionCodexCapabilities` has two success paths — "already available from
standard skill directories" and "provisioned into the scoped home". Both now
verify visibility; fixing only the second would have left the first able to
report success for skills the model cannot see.

Excluded: the health check at `src/codex.lib.mjs:619` runs
`getCodexExecEnv(verbose)` without the scoped environment. That is intentional
— it validates connectivity and auth against the operator home and runs before
the preflight exists. Changing it without evidence would be scope creep, so it
is named here rather than silently touched.

## Detection before repair

The fix detects the condition rather than repairing it, and that is a choice
worth defending explicitly.

The failing run's actual cost was not that a skill was missing. It was that a
full solver run was consumed and produced a confusing "capability unavailable"
report, with a green preflight upstream of it. Detection converts that into an
actionable failure immediately. Repair — materializing the payload into the
scoped `plugins/cache` — needs a decision about the source of truth, and should
be driven by a log from the new diagnostics rather than by my inference about
what the failing environment contained.

The probe is advisory by design: if `codex debug prompt-input` is unavailable or
unparseable, the preflight logs a verbose note and falls back to the previous
behaviour. A stronger check must not become a new failure mode.
