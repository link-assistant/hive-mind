# Case study — Issue #1825: "Failed to add .gitkeep"

- **Issue:** [link-assistant/hive-mind#1825](https://github.com/link-assistant/hive-mind/issues/1825) — _Failed to add .gitkeep_ (label: `bug`)
- **Reported by:** @konard, 2026-05-26
- **Pull request:** [#1826](https://github.com/link-assistant/hive-mind/pull/1826)
- **First observed on:** [rumaster/tg-games#3](https://github.com/rumaster/tg-games/issues/3) (two solver runs: Claude Sonnet 4.6 and OpenAI GPT‑5.5)
- **Affected version:** `solve` v1.72.6

> Raw evidence (issue JSON, upstream issue JSON, and the two full failure logs) is archived under [`logs/`](./logs).

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

The placeholder belongs to `solve` and is temporary, so the fix is to **detect
the gitignore case (`git check-ignore`) and force‑add it (`git add -f`)**. This
is exactly what the solver's own error hint already told users to do manually
(`git add -f .gitkeep`).

---

## 2. Timeline / sequence of events

Reconstructed from [`logs/comment-4548365659-konard.md`](./logs/comment-4548365659-konard.md)
(Claude Sonnet 4.6 run); the GPT‑5.5 run in
[`logs/comment-4548385976-konard.md`](./logs/comment-4548385976-konard.md) is
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

The exact stack frame (`solve.auto-pr.lib.mjs:175`) is the `throw new Error('Failed to add ${fileName}')` line.

---

## 3. Requirements extracted from the issue

The issue is a meta-task. Each explicit requirement and how it is addressed:

| #   | Requirement                                                                                                                              | Status                                                                                                                                                                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Download all logs/data about the issue into `./docs/case-studies/issue-1825/`.                                                           | ✅ [`logs/`](./logs)                                                                                                                                                              |
| R2  | Deep case-study analysis (incl. online research for additional facts).                                                                   | ✅ this document (§7 cites git docs/behavior).                                                                                                                                    |
| R3  | Reconstruct the timeline / sequence of events.                                                                                           | ✅ §2                                                                                                                                                                             |
| R4  | List each and all requirements from the issue.                                                                                           | ✅ this table                                                                                                                                                                     |
| R5  | Find the root cause of each problem.                                                                                                     | ✅ §4                                                                                                                                                                             |
| R6  | Propose solutions / solution plans, checking existing components/libraries.                                                              | ✅ §5, §7                                                                                                                                                                         |
| R7  | If data is insufficient for root cause, add debug output / verbose mode.                                                                 | ✅ §6 — data was already sufficient (`--verbose` log pinpointed the line); the fix adds verbose diagnostics for the force‑add path.                                               |
| R8  | If the issue is related to another repo where issues can be reported, report it (reproducible example, workaround, code fix suggestion). | ✅ §8 — the defect is in hive-mind, not in `rumaster/tg-games`; the third‑party repo only has a harmless config quirk (workaround documented), so no spurious bug is filed there. |
| R9  | Fully apply the fix across the entire codebase (fix every place the issue can occur).                                                    | ✅ §5 — both `git add` placeholder sites in `solve.auto-pr.lib.mjs` are fixed; the cleanup path operates on already-tracked files and is unaffected.                              |
| R10 | Plan and execute everything in the single PR #1826.                                                                                      | ✅                                                                                                                                                                                |

---

## 4. Root-cause analysis

### 4.1 The defect

`src/solve.auto-pr.lib.mjs` staged the placeholder with a plain add and treated
any non‑zero exit as fatal:

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
2. **"Nothing staged" fallback:** only reached when `git add` exits **0** but stages nothing (identical content). When `.gitkeep` is ignored, `git add` exits **1**, so the hard throw at line 175 fires _before_ this fallback.

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
creates a repo whose `.gitignore` contains `.gitkeep` and shows:

```
=== Step 1: plain `git add .gitkeep` (current code) ===
exit code: 1  → reproduces bug: YES (add failed)
=== Step 2: `git check-ignore .gitkeep` ===
exit code: 0 (0 means ignored)
=== Step 3: `git add -f .gitkeep` (the fix) ===
exit code: 0  → git status --short: A  .gitkeep  → fix works: YES (staged)
```

---

## 5. The fix (and full-codebase coverage)

A small, testable helper is added in
[`src/solve.auto-pr-placeholder.lib.mjs`](../../../src/solve.auto-pr-placeholder.lib.mjs):

```js
export async function addPlaceholderFileToGit({ $, tempDir, fileName, log, formatAligned, verbose }) {
  const addResult = await $({ cwd: tempDir, silent: true })`git add ${fileName}`;
  if (addResult.code === 0) return { code: 0, forced: false, ignored: false, stderr: '' };

  const checkIgnore = await $({ cwd: tempDir, silent: true })`git check-ignore ${fileName}`;
  if (checkIgnore.code !== 0) {
    // Not a gitignore failure — surface the original error unchanged.
    return { code: addResult.code, forced: false, ignored: false, stderr: addResult.stderr?.toString() ?? '' };
  }
  // It is ignored, and the placeholder is ours + temporary → force-add it.
  const forced = await $({ cwd: tempDir, silent: true })`git add -f ${fileName}`;
  return { code: forced.code, forced: true, ignored: true, stderr: forced.stderr?.toString() ?? '' };
}
```

Key safety properties:

- **Force-add only for the ignored case.** A non‑ignore failure (permissions,
  corrupt index, …) is returned unchanged so genuine errors are not masked.
- **The placeholder is ours and temporary.** It is created solely to seed the
  initial commit and is removed at task completion by `cleanupClaudeFile`
  (`git rm -f`, which works regardless of `.gitignore`). Force-adding it cannot
  leak unwanted files into the final PR.
- It is the same remedy the tool already printed as a manual hint.

**Every placeholder `git add` site is routed through the helper** (R9):

| Location                                                                     | Placeholder                                      | Fixed                                                                                      |
| ---------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `solve.auto-pr.lib.mjs` primary add (was line 170/throw 175)                 | `.gitkeep` **or** `CLAUDE.md`                    | ✅                                                                                         |
| `solve.auto-pr.lib.mjs` inner `CLAUDE.md → .gitkeep` fallback (was line 216) | `.gitkeep`                                       | ✅                                                                                         |
| `solve.results.lib.mjs:482` (cleanup conflict resolution)                    | restores a **tracked** file from a parent commit | N/A — `.gitignore` does not affect `git add` on already‑tracked paths, so no force needed. |

The helper lives in its own module to keep `solve.auto-pr.lib.mjs` under the
1500-line `max-lines` lint budget.

### Tests

[`tests/test-issue-1825-gitkeep-ignored.mjs`](../../../tests/test-issue-1825-gitkeep-ignored.mjs)
(node:test, `default` suite) covers:

1. Plain `git add .gitkeep` fails when ignored (guards the reproduction).
2. Helper force-adds `.gitkeep` when ignored (`forced=true, ignored=true`, staged).
3. Helper force-adds `CLAUDE.md` when ignored.
4. Helper handles a glob ignore (`.git*`) that matches `.gitkeep` indirectly.
5. Helper adds normally (`forced=false`) when the placeholder is **not** ignored.

---

## 6. Debug / verbose output (R7)

The existing `--verbose` log already contained enough to pinpoint the failure
(the staging step, the git stderr, and a stack trace to the exact line). To make
the new behaviour observable, the helper emits, when the placeholder is ignored:

```
ℹ️  .gitkeep is ignored:  Force-adding placeholder (git add -f)
```

and, under `--verbose`:

```
   .gitkeep matched a .gitignore rule; retrying with: git add -f .gitkeep
```

The probing `git add` runs silently (its stderr is captured and only
re-surfaced on a genuine failure), so the noisy git hint no longer leaks into
normal output.

---

## 7. Existing components / libraries considered (R6)

- **`git add -f` / `git check-ignore` (git itself).** The canonical mechanism.
  `git check-ignore` exits 0 when a path is ignored; `git add -f` overrides the
  ignore for a deliberate add. No third-party dependency is needed — git already
  solves this, and the tool was already recommending it in its own hint text.
- **`command-stream` `$`** (already used throughout `solve`). Returns
  `{ code, stdout, stderr }` and does **not** throw on non-zero exit, so the
  helper can branch on `.code` cleanly.
- **In-repo precedent.** `cleanupClaudeFile` (`solve.results.lib.mjs`) already
  uses `git rm -f` for the symmetric teardown of the same placeholder, so
  force-handling the placeholder is consistent with existing design.
- **Alternative rejected — appending a `.gitignore` negation (`!.gitkeep`).**
  This would modify the target repo's `.gitignore`, changing user-owned content
  and polluting the PR diff. Force-adding our own temporary file is strictly
  less invasive.

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
  `.gitkeep` from `.gitignore` (or add `!.gitkeep`). After PR #1826 this is no
  longer necessary — the solver force-adds its own placeholder.
- **The code fix** lives in this repository (§5) and is the authoritative remedy.

---

## 9. Files in this case study

| Path                                                                           | Contents                                           |
| ------------------------------------------------------------------------------ | -------------------------------------------------- |
| [`logs/hive-mind-issue-1825.json`](./logs/hive-mind-issue-1825.json)           | The hive-mind issue (title, body, labels, author). |
| [`logs/tg-games-issue-3.json`](./logs/tg-games-issue-3.json)                   | Upstream issue where the failure was observed.     |
| [`logs/tg-games-issue-3-comments.json`](./logs/tg-games-issue-3-comments.json) | Raw comments API payload.                          |
| [`logs/comment-4548365659-konard.md`](./logs/comment-4548365659-konard.md)     | Full failure log — Claude Sonnet 4.6 run.          |
| [`logs/comment-4548385976-konard.md`](./logs/comment-4548385976-konard.md)     | Full failure log — OpenAI GPT‑5.5 run.             |
