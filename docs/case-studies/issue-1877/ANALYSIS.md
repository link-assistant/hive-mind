# Technical analysis — Issue #1877 (HANDOFF.md support)

## 1. What a "handoff file" is

A handoff file is a short, human- and machine-readable document that captures the
**working state of an in-progress task** so that a _different_ session (or a
_different_ agent/tool) can resume it without re-deriving everything. Across the
ecosystem it appears as `HANDOFF.md`, `handoff.md`, `handover.md`,
`.claude/handoffs/*.md`, etc. The recurring structure is:

- **Task / goal** — what is being solved.
- **Current state** — what is done and verified.
- **Decisions** — choices made and the rationale (so they are not re-litigated).
- **Next steps** — concrete, ordered actions for the next session.
- **Gotchas** — pitfalls, failing checks, constraints.
- **Critical files** — important paths and what each is for.

See [external/research-notes.md](./external/research-notes.md) for the surveyed
sources that this structure is distilled from.

## 2. Why Hive Mind needs a _branch-committed_ handoff (the key insight)

Most public guidance says handoff files are **disposable** and should live in the
OS temp directory, **not** committed. That advice assumes a single machine where
successive agent sessions share a filesystem. **Hive Mind does not work that way.**

In Hive Mind each working session:

1. is created in a **fresh ephemeral temp working directory** (or workspace), and
2. **clones the repository from the PR branch** anew, then
3. (often) **auto-cleans** the temp dir on completion.

Concretely, `solve` operates on `Your prepared working directory: <tempDir>` and
`--auto-cleanup` removes it afterwards. The only state that survives between
sessions — and the only state visible to a _different tool_ — is **what is
committed to the PR branch**. Tool-private session memory does not cross over:

- Claude Code keeps its own session/transcript (resumed with `--resume <id>`).
- Codex keeps its own rollout/session files.
- Neither tool can read the other's session, and neither survives temp-dir cleanup.

Therefore, to satisfy R4 ("continue each other's work in a single pull request"),
the handoff must be a **tracked file on the branch**: `HANDOFF.md` in the repo
root. This is the deliberate, Hive-Mind-specific divergence from the generic
"keep it in /tmp" convention, and it is documented in the skill itself.

## 3. Why a real Agent Skill (R3) instead of a bespoke prompt

The first draft of this feature injected the full HANDOFF.md procedure as a custom
sub-prompt into each tool's system prompt. The maintainer correctly challenged
that: _"Why do we add our own prompt, and don't use [a] skill? Is there no public
skill for that? Is it not supported by Codex and Claude?"_ The answer is that the
**Agent Skills open standard** (https://agentskills.io, created by Anthropic) is
now supported natively by **both** tools, so we should use it instead of inventing
a private prompt.

An Agent Skill is a folder containing a `SKILL.md` — YAML frontmatter (`name`,
`description`) plus a markdown instructions body — that the tool discovers and
loads on demand (progressive disclosure: discovery → activation → execution):

- **Claude Code** discovers project skills from `.claude/skills/<name>/SKILL.md`.
- **Codex** discovers project skills from `.agents/skills/<name>/SKILL.md`.

The exact same `SKILL.md` works for both, so "same skill, same way" is satisfied
by a single canonical file rather than two tool-specific prompts. The build/deploy
split mirrors the repo's existing deploy-around-execution precedent
(`agents-md-claude-support.lib.mjs`):

```
src/handoff.prompts.lib.mjs   # builds the canonical SKILL.md + a minimal nudge
  └─ src/handoff-skill.lib.mjs deploys that SKILL.md into:
       ├─ .claude/skills/handoff/SKILL.md   (Claude Code reads it natively)
       └─ .agents/skills/handoff/SKILL.md   (Codex reads it natively)
```

Both tools receive a **byte-identical** `SKILL.md` — a unit test pins it (the two
deployed files must equal each other and the canonical builder output).
Centralizing the source means future edits to the protocol can never drift between
tools.

**Why also keep a minimal nudge?** Skill auto-activation is triggered by the task
description matching the skill's `description`. The most important handoff behavior
— "read `HANDOFF.md` first at the very start of the session" — is a session-
lifecycle event, not something the task description mentions. A short pointer in
the system prompt (gated by `--use-handoff`) reliably fires that read-first
behavior; the full procedure still lives in the deployed `SKILL.md`.

**Why git-exclude the deployed skill?** The `SKILL.md` is tooling that hive-mind
re-deploys every session, not project state. Committing it would pollute the PR
and the "uncommitted changes" checks. `handoff-skill.lib.mjs` appends
`/.claude/skills/handoff/` and `/.agents/skills/handoff/` to `.git/info/exclude`
(idempotently) so git never sees the files. The continuity document itself
(`HANDOFF.md`) is still committed to the branch — that is the cross-tool memory.

## 4. Option design (R5)

`use-handoff` is a plain boolean in `SOLVE_OPTION_DEFINITIONS` with
`default: false` and an `[EXPERIMENTAL]` description. Two consequences come for
free from existing infrastructure:

- **Hive auto-forwarding.** `hive.mjs` iterates `SOLVE_OPTION_DEFINITIONS` and
  forwards each option to every `/solve` worker; default-`false` booleans are
  only forwarded when truthy. So `hive --use-handoff` reaches every worker with
  no extra code (verified by the test asserting membership in the definitions).
- **Strict parsing + suggestions.** Because the option is registered, yargs strict
  mode accepts it and `option-suggestions.lib.mjs` can suggest it on typos.

The flag is gated in two places that both no-op when it is off: the activation
nudge (`getHandoffSubPrompt` returns `''` when `argv.useHandoff` is falsy) and the
deployment (`deployHandoffSkill` writes nothing and creates no directories unless
`argv.useHandoff` is truthy). So when disabled there is **zero** change to
generated prompts, to the working directory, or to runtime behavior — important
for an experimental feature.

## 5. Tool-agnostic content (R2/R4)

The skill text intentionally avoids tool-specific verbs (no "use the Read tool",
no Codex-only commands). It tells the AI to describe state via **file paths,
function names, branch, and commit SHAs**, and to prefer **pointers** to existing
artifacts over duplicating them. This keeps the document actionable whether the
next session is Claude or Codex.

## 6. Safety

The skill explicitly forbids secrets/tokens/PII in `HANDOFF.md` because the file
is committed to the repository. This aligns with Hive Mind's existing output
sanitization posture and with the external guidance to redact credentials from
handoff documents.

## 7. Interactions with existing features

- **Auto-restart / auto-resume / watch loops** — these already restart sessions;
  a committed `HANDOFF.md` simply gives each restarted session a warm start. No
  loop logic changes were required.
- **`--auto-commit-uncommitted-changes` / auto-restart on uncommitted changes** —
  the skill instructs committing `HANDOFF.md` with related code, so it does not
  linger as an uncommitted artifact that could perturb those checks.
- **`--prompt-case-studies` / `--prompt-architecture-care`** — orthogonal
  documentation sub-prompts; `--use-handoff` composes with them cleanly.

## 8. Verification

`tests/handoff-prompt.test.mjs` (43 assertions) covers: the canonical `SKILL.md`
shape (valid Agent Skills frontmatter, body sections, custom file name); the
minimal nudge and its default-off / on gating for both Claude and Codex; identical
canonical text in both prompts; the deployment module writing byte-identical
`SKILL.md` into both native skill directories, git-excluding them (invisible to
`git status`) and being idempotent; option registration in `solve.config` and
`option-suggestions`; and membership in `SOLVE_OPTION_DEFINITIONS` (hive
forwarding). `npm run lint` and prettier are clean.
