# Case study: Codex refused repository skills (issue #4057)

Issue: [#4057](https://github.com/link-assistant/hive-mind/issues/4057).
Implementation: [PR #4058](https://github.com/link-assistant/hive-mind/pull/4058).
Previous work: [#3785](https://github.com/link-assistant/hive-mind/issues/3785) / [PR #3786](https://github.com/link-assistant/hive-mind/pull/3786), [#2254](https://github.com/link-assistant/hive-mind/issues/2254).
Upstream report: [openai/codex#61373](https://github.com/openai/codex/issues/61373).
Research date: 2026-11-13 UTC. Evidence: [`evidence/`](evidence/). Requirement map: [`requirements.md`](requirements.md).

> **Privacy.** The failing run belongs to a private repository. The issue asks to "use only minimum
> required info". This study and the upstream report use synthetic names (`repo-agents-skill-N`,
> `repo-codex-skill`, `host-only-skill`) and keep only the _shape_ of the failure: directories and
> counts. No private repository, organization, user, branch, skill name or log content is copied here
> beyond the sanitized excerpt in [`evidence/failure-log-sanitized.md`](evidence/failure-log-sanitized.md).

## Summary

A `solve --tool codex` run stopped before Codex started:

```text
Codex exposed skill instructions outside the capability allowlist: Model-visible skill '<repo-skill-1>'
is not allowlisted for this run or resolves outside trusted repository-scoped paths:
/tmp/gh-issue-solver-<id>/.agents/skills/<repo-skill-1>/SKILL.md. ... (11 violations in total)
```

The 11 refused skills were all **repository** skills: ten under `.agents/skills` and one under
`.codex/skills`. These are exactly the skills the issue says must "work out of the box".

There were two parts to the cause:

1. **The host ran solve v2.39.14.** That version predates the #3785 fix, which admits repository
   skills by default. The fix was merged on 2026-11-09 and versioned as 2.40.0 and then 2.40.1, but
   **neither version reached npm**: the release job failed three times in a row (E413 tarball size,
   then a native arm64 probe). npm `latest` stayed at 2.39.14 until 2.40.2 was published at
   2026-11-13 22:14, after the failing run.
2. **Main still had two gaps.**
   - A skill Codex discovers outside the checkout made every run fail closed, with no way to recover
     except editing the host. Examples: `$HOME/.agents/skills`, `/etc/codex/skills`, or a symlink
     leaving the checkout.
   - A repository skill linked from `.agents/skills` into `.claude/skills` was refused. Hive Mind's
     own `handoff` and `playwright` skills use this layout.

PR #4058 closes both gaps and makes the default fully automatic:

- every repository skill is admitted;
- every host skill is switched off for the task only, with `[[skills.config]] enabled = false` in the
  per-task `CODEX_HOME`;
- the catalog is probed again after the switch-off, and the run still fails closed if Codex ignores
  the setting.

## Timeline (UTC)

| When             | Event                                                                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-09-14       | #2254: Hive Mind validates the `<skills_instructions>` catalog from `codex debug prompt-input` against an allowlist and fails closed on unknown entries.                                                                       |
| 2026-10-25       | #3785 opened ("per-task repository skills, MCP and plugins"); PR #3786 created.                                                                                                                                                |
| 2026-11-05 23:29 | `127c703f1` 2.39.14 is published to npm. Its validator admits a repository skill only when the issue names it, and never admits `.codex/skills`.                                                                               |
| 2026-11-09 07:27 | `2f6a80e38` (#3785) merges: repository skills from `.agents/skills` and `.codex/skills` are admitted by default, and system skills are off by default.                                                                         |
| 2026-11-10 11:11 | Release run 42805396999 versions 2.40.0; `changeset publish` fails with `E413 Payload Too Large` (#4050).                                                                                                                      |
| 2026-11-12 14:57 | Release run 43242624306 versions 2.40.1; publish fails with E413 again (#4050).                                                                                                                                                |
| 2026-11-13 00:10 | #4050's fix (PR #4051) merges; release run 43334992149 fails in `Verified native Codex package / Build and exercise linux-arm64` (a native SQLite probe), so nothing is published. Tracked with the other CI defects in #4055. |
| 2026-11-13 19:36 | Release run 43493862530 starts on `d1d18151d`.                                                                                                                                                                                 |
| 2026-11-13 19:57 | The failing run starts on **solve v2.39.14**. The idle updater moves codex 0.166.0 → 0.169.0.                                                                                                                                  |
| 2026-11-13 19:59 | Preflight: "Model-visible skills (15)": 4 system skills (allowed) + 10 `.agents/skills` + 1 `.codex/skills`. 11 violations; Codex is not started.                                                                              |
| 2026-11-13 20:06 | Issue #4057 opened.                                                                                                                                                                                                            |
| 2026-11-13 22:14 | Release run 43493862530 publishes **2.40.2** to npm, the first published version with the #3785 repository-skill fix (RC1).                                                                                                    |
| 2026-11-13       | PR #4058: host skills are disabled per task, `.agents/skills` → `.claude/skills` links are admitted, verbose provenance logs are added, and upstream openai/codex#61373 is filed.                                              |

## Requirements

See [`requirements.md`](requirements.md) for the full list, with implementation and verification evidence for each requirement.

## How Codex finds skills

From the Codex documentation ([Agent Skills](https://developers.openai.com/codex/skills), [Build skills](https://learn.chatgpt.com/docs/build-skills)) and source
(`codex-rs/ext/skills/src/host_roots.rs`, `codex-rs/config/src/skills_config.rs`, codex-cli 0.166.0):

| Scope      | Location                                                                               | Can a run turn it off?                                                    |
| ---------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Repository | `.agents/skills` from the cwd up to the repository root; project `.codex/skills`       | Per skill only (`[[skills.config]]`)                                      |
| User       | `$HOME/.agents/skills` (from `home_dir()`, **not** `CODEX_HOME`); `$CODEX_HOME/skills` | Per skill only. Pointing `HOME` elsewhere also changes git/gh/ssh lookups |
| System     | `$CODEX_HOME/skills/.system`                                                           | Yes: `[skills.bundled] enabled = false`                                   |
| Admin      | `/etc/codex/skills`                                                                    | Per skill only                                                            |

Facts that shaped the fix:

- **Symlinks are followed.** The catalog shows the _discovered_ path, for example
  `.agents/skills/x/SKILL.md`, even when the file lives in `.claude/skills/x`.
- **`[[skills.config]]`** entries select a skill by exactly one of `path` or `name`. Path selectors
  are canonicalized.
- **Rules are applied in order, and the last matching rule wins.** `skill_config_rules_from_stack`
  removes an existing rule with the same selector and appends the new one;
  `resolve_disabled_paths` applies rules from first to last.
- **Rules come only from the User layer** (`$CODEX_HOME/config.toml`) and session flags. A
  repository's `.codex/config.toml` cannot re-enable a skill.
- **No user or admin scope switch exists.** Only system skills have one (`[skills.bundled]`). This is
  the gap reported upstream.

## Root causes

### RC1. The fix for repository skills never reached the host (main cause of the failing run)

The failing run printed `solve v2.39.14`. The 2.39.14 validator (`127c703f1`) gives repository
provenance only to skills the issue requires. A checkout skill that no requirement names is refused.
`.codex/skills` was never a trusted root at all. A side-by-side run of the two validators on the same
synthetic catalog ([`compare-validator-versions.mjs`](../../../experiments/issue-4057/compare-validator-versions.mjs),
[output](evidence/compare-validator-versions.txt)) gives:

```text
127c703f1 allowed= none | violations= 3
current   allowed= a-one,a-two,c-one | violations= 0
```

`2f6a80e38` (#3785) already fixed this on main, but releases 2.40.0 and 2.40.1 failed to publish
(#4050: E413; then a native arm64 probe failure in run 43334992149, now tracked by #4055). At the
time of the failing run:

```text
$ npm view @link-assistant/hive-mind dist-tags
{ "latest": "2.39.14" }
```

So "planned in #3786 but not fixed" was accurate from the user's side: the code was merged, but the
user could not get it. Release run 43493862530 then published 2.40.2 (2026-11-13 22:14 UTC), the
first npm version with #3785. Hosts that upgrade to 2.40.2 get RC1 fixed. RC2 and RC3 need the release
that carries this PR's changeset.

### RC2. Host skills made every run fail closed (main gap)

The #2254 boundary correctly refuses skills from the host, but refusing one ended the run. Codex
always scans `$HOME/.agents/skills` and `/etc/codex/skills`, and the isolated per-task `CODEX_HOME`
cannot switch off those scopes (see the table above). A single skill installed on the host was
therefore enough to block every Codex task on that host until an operator found and deleted it.
The same applied to a checkout symlink pointing outside the checkout. That fails the "works out of
the box" requirement without making anything more secure: the safe action is to keep the skill away
from the model, not to stop the task.

### RC3. A repository skill linked into `.claude/skills` was refused (main gap)

To support both Claude and Codex, repositories (including this one, for `handoff` and `playwright`)
keep the canonical skill in `.claude/skills/<name>` and link `.agents/skills/<name>` →
`../../.claude/skills/<name>`. Codex shows the `.agents/skills` path. The validator canonicalized it
to `.claude/skills/...`, which is outside the trusted roots, so it refused the skill with origin
`checkout`.

### RC4. Too little data to tell repository, task and host skills apart

The failure message did not say _why_ a path was untrusted, and the log did not list the trusted
roots. Telling "a repository skill on an old version" apart from "a host skill" required reading the
source.

## Solution (PR #4058)

| Change                                                                                                                                                                                                                                                                                                                                        | File                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `skillOrigin()` classifies each refused skill as `checkout`, `task-codex-home` or `host`. The validator returns `rejected` entries (`name`, rendered `path`, `canonical`, `origin`) and `trustedRoots`.                                                                                                                                       | `src/codex-skill-catalog.lib.mjs`                                           |
| A skill is a repository skill when its canonical file is in a trusted root, **or** Codex showed it under the checkout's `.agents/skills` / `.codex/skills` and the canonical file is still inside the checkout (RC3).                                                                                                                         | `src/codex-skill-catalog.lib.mjs`                                           |
| `disableScopedCodexSkills()` writes `[[skills.config]] path = ... enabled = false` for the rendered and canonical paths into the **per-task** `config.toml`. It always places them as the last match, so an operator `enabled = true` by name or path cannot override them. It is idempotent, and the operator's own config is never touched. | `src/codex-repository-config.lib.mjs`                                       |
| The preflight disables refused skills, probes the catalog again and validates again. If Codex still shows a refused skill, the run fails closed with the #2254 boundary error, as before (RC2).                                                                                                                                               | `src/codex-capability-preflight.lib.mjs`                                    |
| Verbose output: `🧭 Trusted skill roots`, `⛔ Refused skill <name> (origin=..., path=..., rendered=...)`, `🚫 Disabled N skill(s) outside the task allowlist for this task only`. Each violation message ends with `(origin: ...)` (RC4).                                                                                                     | `src/codex-capability-preflight.lib.mjs`, `src/codex-skill-catalog.lib.mjs` |
| Release trigger: a patch changeset that tells hosts on 2.39.x to upgrade (RC1).                                                                                                                                                                                                                                                               | `.changeset/codex-repository-skills-4057.md`                                |

Why this does not leak anything to other tasks or the host:

- The per-task `CODEX_HOME` is rebuilt from the operator config on every preparation
  (`syncScopedConfig`), so disable entries never reach the operator config or other tasks.
- Nothing on the host is deleted or moved.
- System skills stay off by default (#3785).

### Rest of the codebase

- **Claude.** Claude Code loads `.claude/skills` natively. Hive Mind has no Claude-side catalog
  allowlist, so the same layout already worked (#3785).
- **Hive Mind's own skills.** `handoff` and `playwright` use the `.claude/skills` canonical layout with
  `.agents/skills` links. RC3 covers it now.
- **Other tools.** Agent, OpenCode and Qwen do not run the Codex catalog preflight.
- **Self-update.** Hive Mind has no self-update check (only `agentic-cli-updater` for the agent CLIs).
  The run updated codex but stayed on solve 2.39.14. This is noted as an operational recommendation;
  it is not changed here.

### Alternatives considered

| Option                                       | Why not                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Point `HOME` at an empty directory for Codex | It also changes git, gh, ssh, npm and credential-helper lookups that tasks rely on.         |
| Delete or rename host skills                 | It changes the host and affects other tasks and users, which the issue forbids.             |
| Allow every model-visible skill              | It undoes the #2254 boundary and leaks host instructions into tasks.                        |
| Disable by name                              | A name can also match a repository skill with the same name; path selectors are exact.      |
| Wait for upstream user/admin scope switches  | Not available yet (openai/codex#61373). The path-based workaround works with today's Codex. |

## Verification

- **Unit and integration tests.** [`tests/issue-4057-codex-repository-skills.test.mjs`](../../../tests/issue-4057-codex-repository-skills.test.mjs) has 6 tests:
  - the failing layout is fully admitted;
  - host and outside-symlink skills are refused with `origin: host`;
  - a `.agents` → `.claude` link is admitted while `docs/stray/SKILL.md` is refused;
  - per-task disables are written as the last match and idempotently;
  - the preflight disables a host skill and keeps all 11 repository skills, leaving the operator
    config and the host file untouched;
  - a Codex build that ignores the config still fails closed.
- **Real Codex (codex-cli 0.166.0 and 0.169.0, the version the failing host used; offline provider).**
  [`reproduce-repository-skill-catalog.mjs`](../../../experiments/issue-4057/reproduce-repository-skill-catalog.mjs)
  runs four scenarios, with the same results on both versions ([output](evidence/real-codex-preflight.txt)):
  - base layout: 11 allowed;
  - `--claude-canonical`: 12 allowed;
  - `--host-skill --outside-symlink --claude-canonical`: 2 disabled, then 12 allowed;
  - `--host-skill --operator-enable`: the host skill is still disabled.
- **Regression suites.** All related suites pass locally (1435 tests):
  - `codex-capability-preflight`
  - `issue-3785-*`
  - `test-issue-2254`
  - `test-issue-2088`, `test-issue-2080`, `test-issue-2102`, `test-issue-2084`, `test-issue-2094`, `test-issue-2077`

How to reproduce:

```bash
# Unit-level, no Codex needed
node --test tests/issue-4057-codex-repository-skills.test.mjs
# Old vs new validator on the failing shape
node experiments/issue-4057/compare-validator-versions.mjs
# Real Codex binary, offline
node experiments/issue-4057/reproduce-repository-skill-catalog.mjs "$(command -v codex)" --host-skill --outside-symlink --claude-canonical
```

## Upstream

[openai/codex#61373](https://github.com/openai/codex/issues/61373), "Allow disabling user and admin
skill discovery scopes (like `[skills.bundled]`) for isolated CODEX_HOME runs". It includes:

- a synthetic repro: [`upstream-skill-scope-repro.sh`](../../../experiments/issue-4057/upstream-skill-scope-repro.sh), [output](evidence/upstream-skill-scope-repro.txt);
- the two workarounds: disable by path, or an empty `HOME`;
- a suggested fix: scope switches next to `[skills.bundled]`, read in `roots_from_layer_stack`.

It links the related reports openai/codex#60419 and #14316. No private data is included.

## Existing components and research

- Codex skills documentation: <https://developers.openai.com/codex/skills> (discovery scopes, `[[skills.config]]`).
- Codex source, `codex-rs/config/src/skills_config.rs`: `SkillConfig`, `[skills.bundled]`, the order of `skill_config_rules_from_stack`, and the User/SessionFlags-only layer filter.
- Codex source, `codex-rs/ext/skills/src/host_roots.rs`: repository, user, system and admin roots; `home_dir()` for `$HOME/.agents/skills`.
- Agent Skills specification: <https://agentskills.io> (the `SKILL.md` format shared by Claude Code and Codex).
- The open agent skills tool `npx skills` (<https://github.com/vercel-labs/skills>) can keep one canonical copy and link it into tool-specific folders such as `.claude/skills`. That is the layout of the failing repository; RC3 covers the reverse direction.
- Related upstream issues: openai/codex#60419 ("Allow requirements.toml (or managed config) to disable individual skills", open) and openai/codex#14316 ("Allow disabling built-in skills via config.toml", closed, which led to `[skills.bundled]`).
- Hive Mind components reused: `syncScopedConfig` and the per-task `CODEX_HOME` (#3785), the catalog validator (#2254), and `smol-toml` for config edits.

## Remaining limits

- **Publication.** The #3785 part (RC1) is on npm as 2.40.2. The RC2/RC3 fixes reach users with the
  next release after this PR merges. Release pipeline defects (#4050, #4055) are outside this issue.
- **Codex that ignores the setting.** If a future Codex stops honouring `[[skills.config]]` for some
  scope, the run still fails closed, by design. The error names each skill's origin.
