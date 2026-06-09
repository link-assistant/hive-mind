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

## 3. Why one shared "skill" (R3) instead of two prompts

The repo already has a clean precedent: `architecture-care.prompts.lib.mjs` is a
single sub-prompt module imported by both `claude.prompts.lib.mjs` and
`codex.prompts.lib.mjs` and appended to each system prompt
(`...${getArchitectureCareSubPrompt(argv)}...`). We mirror that pattern exactly:

```
src/handoff.prompts.lib.mjs        # buildHandoffSubPrompt / getHandoffSubPrompt
  ├─ imported by claude.prompts.lib.mjs → appended to Claude system prompt
  └─ imported by codex.prompts.lib.mjs  → appended to Codex system prompt
```

Both tools receive **byte-identical** text — that is what "same skill, same way"
means operationally, and a unit test pins it (`buildHandoffSubPrompt()` substring
must appear in both system prompts). Centralizing also means future edits to the
protocol can never drift between tools.

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

The flag is gated purely in the prompt builders (`getHandoffSubPrompt` returns
`''` when `argv.useHandoff` is falsy), so when disabled there is **zero** change
to generated prompts or runtime behavior — important for an experimental feature.

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

`tests/handoff-prompt.test.mjs` (24 assertions) covers: module return values and
custom file name; default-off and on gating for both Claude and Codex; identical
canonical text in both; option registration in `solve.config` and
`option-suggestions`; and membership in `SOLVE_OPTION_DEFINITIONS` (hive
forwarding). `npm run lint` and prettier are clean.
