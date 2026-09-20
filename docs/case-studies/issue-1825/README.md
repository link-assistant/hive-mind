# Case study — Issue #1825: "Failed to add .gitkeep"

- **Issue:** [link-assistant/hive-mind#1825](https://github.com/link-assistant/hive-mind/issues/1825) — _Failed to add .gitkeep_ (label: `bug`)
- **Reported by:** @konard, 2026-05-26
- **Pull requests:**
  - [#1826](https://github.com/link-assistant/hive-mind/pull/1826) — _initial fix_ (merged 2026-05-27): force-added the placeholder when it was gitignored.
  - [#1830](https://github.com/link-assistant/hive-mind/pull/1830) — _this follow-up_: stop forcing by default; instead explain the root cause and offer two opt-in flags.
- **First observed on:** [rumaster/tg-games#3](https://github.com/rumaster/tg-games/issues/3) (two solver runs: Claude Sonnet 4.6 and OpenAI GPT‑5.5)
- **Affected version:** `solve` v1.72.6 (fixed across v1.73.x)

> Raw evidence (issue JSON, upstream issue JSON, the two full failure logs, and
> the follow-up comment) is archived under [`raw/`](./raw).

---

## 1. Executive summary

When `solve` opens its initial draft PR, it seeds the branch with a throwaway
placeholder file (default `.gitkeep`, or `CLAUDE.md`), commits it, pushes, and
opens the PR. The placeholder is removed again when the task completes.

If the **target repository's `.gitignore` matches the placeholder** (here
`rumaster/tg-games` ignores `.gitkeep`), the staging step `git add .gitkeep`
exits non‑zero with _"The following paths are ignored by one of your .gitignore
files"_. The code treated any non‑zero `git add` as fatal and threw
`Failed to add .gitkeep`, which bubbled up to `❌ FATAL ERROR: PR creation
failed` and aborted the whole session before the agent could do any work.

PR #1826 first fixed this by **force-adding** the placeholder (`git add -f`).
The maintainer then asked (issue comment, archived in
[`raw/comment-4553865398-konard-followup.md`](./raw/comment-4553865398-konard-followup.md))
to **not silently force through** the user's `.gitignore`. This follow-up
(PR #1830) changes the default to: **explain the root cause clearly and stop**,
and adds two **opt-in** flags for users who want the tool to resolve it:

| Behaviour                           | Result                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------- |
| **default** (no flag)               | Print a friendly root-cause explanation + resolution options, then stop. Nothing is forced. |
| `--remove-git-keep-from-git-ignore` | Remove the literal `.gitkeep` entry from `.gitignore` first, then commit normally.          |
| `--force-git-keep-commit`           | Commit the placeholder anyway with `git add -f`, ignoring the `.gitignore` rule.            |

The explanation is **environment-agnostic**: it shows both `solve <url> …` and
`/solve <url> …` invocations and never assumes a specific runtime.

---

## 2. Timeline / sequence of events

Reconstructed from [`raw/comment-4548365659-konard.md`](./raw/comment-4548365659-konard.md)
(Claude Sonnet 4.6 run); the GPT‑5.5 run in
[`raw/comment-4548385976-konard.md`](./raw/comment-4548385976-konard.md) is
identical in the failing step.

| Time (UTC) | Event                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 20:10:55   | `solve v1.72.6` starts on `https://github.com/rumaster/tg-games/issues/3` (`--tool claude --verbose --language ru`).                                    |
| 20:11:02   | Write access to public repo `rumaster/tg-games` confirmed → works directly on the repo (no fork).                                                       |
| 20:11:05   | Clones repo, creates branch `issue-3-12527c46fb0f` from `main`.                                                                                         |
| 20:11:06   | `🚀 Auto PR creation: ENABLED`. Mode resolved to **`.gitkeep`** (`--claude-file=false, --gitkeep-file=true, --auto-gitkeep-file=true`).                 |
| 20:11:06   | `✅ File created: .gitkeep`, then `📦 Adding file: To git staging`.                                                                                     |
| 20:11:06   | `git add .gitkeep` → **STDERR**: _"The following paths are ignored by one of your .gitignore files: .gitkeep … Use -f if you really want to add them."_ |
| 20:11:06   | `❌ Failed to add .gitkeep` → `❌ FATAL ERROR: PR creation failed`.                                                                                     |
| 20:11:06   | Stack trace: `handleAutoPrCreation (…/src/solve.auto-pr.lib.mjs:175:13)` → `solve.mjs:559`. Session ends with no work done.                             |

The exact stack frame (`solve.auto-pr.lib.mjs:175`) was the
`throw new Error('Failed to add ${fileName}')` line as it existed in v1.72.6.

---

## 3. Requirements extracted from the issue

The issue is a meta-task with a follow-up comment. Each explicit requirement and
how it is addressed:

| #   | Requirement                                                                                                                                                                            | Status                                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Download all logs/data about the issue into `./docs/case-studies/issue-1825/`.                                                                                                         | ✅ [`raw/`](./raw)                                                                                                                                                   |
| R2  | Deep case-study analysis (incl. online research for additional facts).                                                                                                                 | ✅ this document (§7 cites git docs/behavior).                                                                                                                       |
| R3  | Reconstruct the timeline / sequence of events.                                                                                                                                         | ✅ §2                                                                                                                                                                |
| R4  | List each and all requirements from the issue.                                                                                                                                         | ✅ this table                                                                                                                                                        |
| R5  | Find the root cause of each problem.                                                                                                                                                   | ✅ §4                                                                                                                                                                |
| R6  | Propose solutions / solution plans, checking existing components/libraries.                                                                                                            | ✅ §5, §7                                                                                                                                                            |
| R7  | If data is insufficient for root cause, add debug output / verbose mode.                                                                                                               | ✅ §6 — data was already sufficient; the fix adds verbose diagnostics for the new paths.                                                                             |
| R8  | If the issue is related to another repo where issues can be reported, report it.                                                                                                       | ✅ §8 — the defect is in hive-mind, not in `rumaster/tg-games`; no spurious bug is filed there.                                                                      |
| R9  | Fully apply the fix across the entire codebase (every place the issue can occur).                                                                                                      | ✅ §5 — both `git add` placeholder sites in `solve.auto-pr.lib.mjs` route through the shared helper; the cleanup path operates on tracked files and is unaffected.   |
| R10 | **(follow-up)** Do not force through `.gitignore` by default — explain the root cause to the user instead.                                                                             | ✅ §5 — default `action: 'blocked'` + friendly explanation, run stops cleanly.                                                                                       |
| R11 | **(follow-up)** Add `--force-git-keep-commit` (off by default) and `--remove-git-keep-from-git-ignore`, usable with both `solve` and `/solve`, message environment-agnostic.           | ✅ §5 — both options registered in `SOLVE_OPTION_DEFINITIONS` (auto-passthrough to `/solve`); message shows both invocations.                                        |
| R12 | **(follow-up)** Verify the claim that `--auto-init-repository` created a `.gitignore` containing `.gitkeep`; if a `.gitignore` must be created, use a GitHub default template or none. | ✅ §4.5 — verified the solver **never** creates a `.gitignore`; `--auto-init-repository` only creates `README.md`. No code change needed; the premise does not hold. |
| R13 | **(follow-up)** Redo the analysis deeply and execute everything in this single PR.                                                                                                     | ✅ this document was fully rewritten; all changes are in PR #1830.                                                                                                   |

---

## 4. Root-cause analysis

### 4.1 The surface defect

`src/solve.auto-pr.lib.mjs` staged the placeholder with a plain add and treated
any non‑zero exit as fatal (v1.72.6):

```js
const addResult = await $({ cwd: tempDir })`git add ${fileName}`;
if (addResult.code !== 0) {
  await log(`❌ Failed to add ${fileName}`, { level: 'error' });
  // …
  throw new Error(`Failed to add ${fileName}`); // ← solve.auto-pr.lib.mjs:175
}
```

`git add <path>` exits **1** when `<path>` is matched by `.gitignore` (and not
already tracked), printing the _"paths are ignored … Use -f"_ hint. So a target
repo that gitignores `.gitkeep` makes this throw.

### 4.2 Why the existing fallbacks did not catch it

`solve.auto-pr.lib.mjs` already had ignore-handling, but only for `CLAUDE.md`:

1. **Pre-check (CLAUDE.md → .gitkeep):** `if (useClaudeFile && useAutoGitkeepFile)` runs `git check-ignore CLAUDE.md` and switches to `.gitkeep`. It never checks whether **`.gitkeep` itself** is ignored.
2. **"Nothing staged" fallback:** only reached when `git add` exits **0** but stages nothing (identical content). When `.gitkeep` is ignored, `git add` exits **1**, so the hard throw fired _before_ this fallback.

Since v1.72.x the **default placeholder is `.gitkeep`** (see
`docs/case-studies/issue-804-gitkeep-vs-claude-file/`), so the unprotected path
became the common path — any target repo that ignores `.gitkeep` now fails.

### 4.3 Trigger condition (confirmed)

`rumaster/tg-games`'s root `.gitignore` (fetched via the GitHub API) ends with:

```
node_modules/
dist/
*.log
.env
.env.local
coverage/
.DS_Store
.gitkeep        ← matches the placeholder
```

### 4.4 Reproduction

[`experiments/issue-1825-reproduce-gitkeep-ignored.mjs`](../../../experiments/issue-1825-reproduce-gitkeep-ignored.mjs)
creates a repo whose `.gitignore` contains `.gitkeep` and exercises every branch:

```
=== Step 1: plain `git add .gitkeep` (the original bug) ===
exit code: 1  → reproduces bug: YES (add failed)
=== Step 2: default behaviour (no flags) ===
action: blocked | code: 1 | ignored: true  → blocked (no force): YES
=== Step 3: --force-git-keep-commit ===
action: forced  | code: 0  → force works: YES (staged)
=== Step 4: --remove-git-keep-from-git-ignore ===
action: removed-from-gitignore | code: 0  → remove works: YES (staged)
```

### 4.5 The deeper root cause the maintainer asked about (`--auto-init-repository`)

The follow-up comment hypothesised that the offending `.gitignore` was created
by `solve` itself when `--auto-init-repository` was used:

> _"the actual root cause … was solve command itself, when --auto-init-repository
> was used, repository was initialized with .gitignore, that contained .gitkeep"_

**This was investigated and does not hold.** The auto-init path
(`tryInitializeEmptyRepository` in `src/solve.repository.lib.mjs:288`, called
from `src/solve.repo-setup.lib.mjs:77`) creates **only** a `README.md`:

```js
let readmeContent = `# ${repo}\n`;
if (description) readmeContent += `\n${description}\n`;
const base64Content = Buffer.from(readmeContent).toString('base64');
await $`gh api repos/${owner}/${repo}/contents/README.md --method PUT --silent \
  --field message="Initialize repository with README" \
  --field content="${base64Content}"`;
```

There is **no `.gitignore` creation anywhere in the solver's repo-init or
repo-setup code** (verified with a repository-wide search). The `.gitignore`
that ignores `.gitkeep` in `rumaster/tg-games` was authored by the **AI agent
while scaffolding that Telegram-games project** (a conventional Node `.gitignore`
to which a `.gitkeep` line was added), not by `--auto-init-repository`.

Consequence for R12: because the solver never creates a `.gitignore`, there is
nothing to switch to a "GitHub default template" — the safest behaviour the
comment asked for (no `.gitignore`, or a standard template) is already what the
solver does (`README.md` only). No code change is required here; the finding is
documented so the misattribution does not resurface.

---

## 5. The fix (and full-codebase coverage)

### 5.1 New opt-in options

`src/solve.config.lib.mjs` registers two boolean options (both `default: false`)
in `SOLVE_OPTION_DEFINITIONS`, which auto-propagates them to the hive `/solve`
passthrough:

```js
'force-git-keep-commit': {
  type: 'boolean',
  description: 'If the auto-PR placeholder (.gitkeep) is listed in .gitignore, commit it anyway with `git add -f` instead of stopping (issue #1825). Off by default.',
  default: false,
},
'remove-git-keep-from-git-ignore': {
  type: 'boolean',
  description: 'If the auto-PR placeholder (.gitkeep) is listed in .gitignore, remove that entry from .gitignore first, then commit normally (issue #1825). Off by default.',
  default: false,
},
```

### 5.2 The staging helper

The logic lives in its own small, testable module,
[`src/solve.auto-pr-placeholder.lib.mjs`](../../../src/solve.auto-pr-placeholder.lib.mjs)
(kept separate so `solve.auto-pr.lib.mjs` stays under the 1500-line `max-lines`
budget). `addPlaceholderFileToGit` always tries a plain `git add` first, and only
branches when the add fails **because the file is gitignored** (`git check-ignore`
exits 0):

| Condition                                                         | `action`                 | `code` | Effect                                                |
| ----------------------------------------------------------------- | ------------------------ | ------ | ----------------------------------------------------- |
| plain add succeeds                                                | `added`                  | 0      | normal case                                           |
| add fails, **not** gitignored                                     | `failed`                 | ≠0     | genuine error surfaced unchanged (not masked)         |
| gitignored, no flag (**default**)                                 | `blocked`                | ≠0     | caller explains + stops; nothing forced               |
| gitignored, `--remove-git-keep-from-git-ignore` (literal entry)   | `removed-from-gitignore` | 0      | strips the literal line, stages `.gitignore`, re-adds |
| gitignored, `--remove-git-keep-from-git-ignore` (glob / external) | `remove-failed`          | ≠0     | refuses to over-edit; caller explains + stops         |
| gitignored, `--force-git-keep-commit`                             | `forced`                 | 0      | `git add -f`                                          |

`removePlaceholderFromGitignore` only removes an **exact** entry (`.gitkeep`,
`/.gitkeep`, `.gitkeep/`, `/.gitkeep/`) from `.gitignore` files **inside the
working tree**; it walks the ignore chain (`git check-ignore -v`) and refuses
glob rules (e.g. `.git*`) and external sources (global excludes) so it never
un-ignores unrelated files or mangles user config.

### 5.3 The friendly explanation (default)

`stagePlaceholderFileOrExplain` wraps the helper; when the result is `blocked`
or `remove-failed` it calls `reportIgnoredPlaceholderAndThrow`, which prints:

```
🛑 Cannot add placeholder: .gitkeep is listed in .gitignore

  🔍 Root cause:
     The repository's .gitignore matches the temporary placeholder file ".gitkeep".
     The placeholder is created only to seed the initial draft pull request and is
     removed automatically when the task completes — but git refuses to add an ignored
     file, so the initial commit cannot be created.

  💡 How to resolve (pick one):
     1. Remove ".gitkeep" from .gitignore in the repository, then re-run.
     2. Let the tool remove it for you before committing:
          solve <issue-url> --remove-git-keep-from-git-ignore
          /solve <issue-url> --remove-git-keep-from-git-ignore
     3. Commit the placeholder anyway, ignoring the .gitignore rule:
          solve <issue-url> --force-git-keep-commit
          /solve <issue-url> --force-git-keep-commit
```

The thrown error carries `hiveMindUserFacingLogged = true`, which suppresses the
generic `❌ FATAL ERROR: PR creation failed` stack-trace block so the run ends
cleanly with just the explanation above.

### 5.4 Full-codebase coverage (R9)

**Every placeholder `git add` site is routed through the helper:**

| Location                                                      | Placeholder                                      | Fixed                                                                                       |
| ------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `solve.auto-pr.lib.mjs` primary add                           | `.gitkeep` **or** `CLAUDE.md`                    | ✅ `stagePlaceholderFileOrExplain`                                                          |
| `solve.auto-pr.lib.mjs` inner `CLAUDE.md → .gitkeep` fallback | `.gitkeep`                                       | ✅ `stagePlaceholderFileOrExplain`                                                          |
| `solve.results.lib.mjs` (cleanup conflict resolution)         | restores a **tracked** file from a parent commit | N/A — `.gitignore` does not affect `git add` on already‑tracked paths, so no change needed. |

### 5.5 Tests

[`tests/test-issue-1825-gitkeep-ignored.mjs`](../../../tests/test-issue-1825-gitkeep-ignored.mjs)
(node:test, `default` suite) covers each branch:

1. Plain `git add .gitkeep` fails when ignored (guards the reproduction).
2. **Default** → `action: 'blocked'`, non-zero, nothing staged.
3. `--force-git-keep-commit` → `action: 'forced'` for `.gitkeep` and `CLAUDE.md`.
4. `--remove-git-keep-from-git-ignore` (literal entry) → `action: 'removed-from-gitignore'`; other entries preserved; `.gitignore` staged.
5. `--remove-git-keep-from-git-ignore` (glob `.git*`) → `action: 'remove-failed'`; nothing staged.
6. Not ignored → `action: 'added'`.
7. `removePlaceholderFromGitignore` removes the literal entry and stages `.gitignore`.
8. `stagePlaceholderFileOrExplain` throws a user-facing error mentioning `.gitignore`, both flags, and both `solve` / `/solve` invocations.
9. `stagePlaceholderFileOrExplain` returns normally when the placeholder is not ignored.

---

## 6. Debug / verbose output (R7)

The existing `--verbose` log already pinpointed the failure (the staging step,
the git stderr, and a stack trace to the exact line). The probing `git add` now
runs **silently** (its stderr is captured and only re-surfaced on a genuine,
non-ignore failure), so the noisy git hint no longer leaks into normal output.
The new behaviours are observable:

- When the placeholder is ignored and a flag is set, an `ℹ️` line names the
  chosen path (force-add, or remove-from-.gitignore).
- Under `--verbose`, the helper logs the exact retried command (`git add -f …`)
  or which `.gitignore` files were edited.

---

## 7. Existing components / libraries considered (R6)

- **`git add -f` / `git check-ignore` / `git check-ignore -v` (git itself).** The
  canonical mechanism. `git check-ignore` exits 0 when a path is ignored;
  `-v` reports `<source>:<linenum>:<pattern>` so the remove path can locate the
  exact line to delete. No third-party dependency is needed.
- **`command-stream` `$`** (already used throughout `solve`). Returns
  `{ code, stdout, stderr }` and does **not** throw on non-zero exit, so the
  helper can branch on `.code` cleanly.
- **In-repo precedent.** `cleanupClaudeFile` (`solve.results.lib.mjs`) already
  uses `git rm -f` for the symmetric teardown of the same placeholder.
- **Alternative rejected — silently force-adding by default (PR #1826's first
  approach).** The maintainer asked not to override the user's `.gitignore`
  without consent; forcing is now strictly opt-in (`--force-git-keep-commit`).
- **Alternative rejected — appending a `.gitignore` negation (`!.gitkeep`).**
  This modifies user-owned content more than necessary; removing the exact
  offending line (opt-in) or stopping with an explanation (default) is cleaner.

---

## 8. Relationship to the upstream repository (R8)

The failure surfaced while solving `rumaster/tg-games#3`, but the **defect is in
hive-mind**, not in that repository. Ignoring `.gitkeep` is unusual (it defeats
the conventional "keep an empty directory" purpose of the file) but is a valid,
harmless choice for a repo owner, and after this fix hive-mind handles it
gracefully. Therefore:

- **No bug is filed against `rumaster/tg-games`** — there is no genuine defect in
  their code, and filing a non-issue on a third party's tracker would be noise.
- **Workaround for any affected target repo (documented, not required):** remove
  `.gitkeep` from `.gitignore` (or run `solve … --remove-git-keep-from-git-ignore`).
- **The code fix** lives in this repository (§5) and is the authoritative remedy.

---

## 9. Files in this case study

| Path                                                                                       | Contents                                             |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| [`raw/hive-mind-issue-1825.json`](./raw/hive-mind-issue-1825.json)                         | The hive-mind issue (title, body, labels, author).   |
| [`raw/tg-games-issue-3.json`](./raw/tg-games-issue-3.json)                                 | Upstream issue where the failure was observed.       |
| [`raw/tg-games-issue-3-comments.json`](./raw/tg-games-issue-3-comments.json)               | Raw comments API payload.                            |
| [`raw/comment-4548365659-konard.md`](./raw/comment-4548365659-konard.md)                   | Full failure log — Claude Sonnet 4.6 run.            |
| [`raw/comment-4548385976-konard.md`](./raw/comment-4548385976-konard.md)                   | Full failure log — OpenAI GPT‑5.5 run.               |
| [`raw/comment-4553865398-konard-followup.md`](./raw/comment-4553865398-konard-followup.md) | The maintainer's follow-up comment driving PR #1830. |
