# Case study: issue #4063 — "Repository has uncommitted changes after clone"

- Issue: https://github.com/link-assistant/hive-mind/issues/4063
- Pull request: https://github.com/link-assistant/hive-mind/pull/4064
- Failed run: https://github.com/link-foundation/java-ai-driven-development-pipeline-template/issues/27#issuecomment-6877003277
- Upstream report: https://github.com/link-foundation/java-ai-driven-development-pipeline-template/issues/28

## Summary

`solve` cloned `link-foundation/java-ai-driven-development-pipeline-template`.
Right after the clone, `git status --porcelain` printed ` M mvnw.cmd`, and solve stopped with
`Repository has uncommitted changes after clone`. Nothing had touched the file.

The repository itself causes this. Its commit `960e795` (merged through PR #25) stores
`mvnw.cmd` with CRLF line endings. In the same commit it adds `.gitattributes` with
`/mvnw.cmd text eol=crlf`. The `text` attribute tells Git that the stored copy must use LF.
A CRLF blob marked `text` is therefore "not normalized", and Git reports it as modified
after every fresh checkout: the file bytes on disk equal the commit, but Git would store
them as different (LF) content.

Solve now checks whether each "modified" file holds exactly the committed bytes. If every
reported change is such a conversion artifact, solve turns off conversion for those paths in
the clone-local `.git/info/attributes`. Git then reports the clone as clean, and the run
continues. The working-tree bytes stay as committed, nothing extra goes into the pull
request, and the log tells the repository owner how to fix the repository.
Real changes still stop the run, as before.

## Requirements from the issue

| #   | Requirement                                                                                                              | Where it is handled                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Find the root cause of "uncommitted changes on clone".                                                                   | [Root cause](#root-cause), `raw/reproduction.log`, `experiments/issue-4063-dirty-clone-repro.sh`                                    |
| R2  | Find a proper way to handle such situations.                                                                             | `src/checkout-normalization.lib.mjs`, `src/solve.repo-setup.lib.mjs`, [Solution](#solution)                                         |
| R3  | Collect logs and data in `docs/case-studies/issue-4063`, reconstruct the timeline, list requirements, propose solutions. | This document and `raw/`                                                                                                            |
| R4  | Search online for more facts and check existing components and libraries.                                                | [Online research](#online-research-and-existing-components)                                                                         |
| R5  | If the data is not enough, add debug output and a verbose mode.                                                          | The new `--verbose` lines: per-path `git check-attr`, `git ls-files --eol`, git version, `core.autocrlf`/`core.eol`/`core.safecrlf` |
| R6  | Report issues to other affected repositories, with a reproduction, a workaround and a fix suggestion.                    | Upstream report linked above                                                                                                        |
| R7  | Apply the fix across the whole codebase.                                                                                 | [Codebase-wide review](#codebase-wide-review)                                                                                       |
| R8  | Do everything in one pull request.                                                                                       | PR #4064                                                                                                                            |

## Timeline (UTC)

| Time                    | Event                                                                                                                                                                                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-13 21:24:23     | PR #25 opens in the Java template ("update every dependency ecosystem").                                                                                                                                                                                       |
| 2026-11-13 22:03:32     | AI-authored commit `960e795` ("chore(deps): update toolchains and the complete Maven build tree") regenerates the Maven wrapper. `mvnw.cmd` is written with CRLF and committed that way. The same commit adds `.gitattributes` with `/mvnw.cmd text eol=crlf`. |
| 2026-11-13 22:34:56     | PR #25 is merged (`2cdfe14`). CI passes: the defect does not affect builds. It only shows in `git status` of a fresh checkout.                                                                                                                                 |
| 2026-11-14 ~11:52       | PR #26 is merged (`dd803a2`). It leaves `mvnw.cmd` and `.gitattributes` unchanged.                                                                                                                                                                             |
| 2026-11-14 12:04:56.679 | solve v2.39.10 starts for issue #27 (`--tool codex --auto-merge --update-all-dependencies`).                                                                                                                                                                   |
| 2026-11-14 12:05:22.485 | The clone succeeds.                                                                                                                                                                                                                                            |
| 2026-11-14 12:05:22.731 | `git status --porcelain` → ` M mvnw.cmd`.                                                                                                                                                                                                                      |
| 2026-11-14 12:05:22.733 | `Error: Repository has uncommitted changes after clone` (thrown at `solve.repo-setup.lib.mjs:285`).                                                                                                                                                            |
| 2026-11-14 12:05:23     | Failure handling: a development log is committed to the local `main`, which is not pushed. The "uncommitted" `mvnw.cmd` is saved as a recovery commit `211771cb`.                                                                                              |
| 2026-11-14 12:05:24     | The failure comment is posted on issue #27. Its generic "What you can do" section does not mention line endings.                                                                                                                                               |
| 2026-11-14 12:32:11     | Issue #4063 is opened.                                                                                                                                                                                                                                         |

Sources: `raw/solve-failure-comment.md` (the full solve log attached to the failure
comment), `raw/solve-failure-comment-meta.json`, `raw/target-pr-25.json`,
`raw/target-issue-27.json`, and `raw/reproduction.log`.

## Root cause

### 1. The repository stores a blob that does not match its own attributes

`raw/reproduction.log` comes from a fresh clone of `dd803a2` with git 2.43.0 and no
`core.autocrlf`/`core.eol` settings:

```
$ cat .gitattributes
/mvnw text eol=lf
/mvnw.cmd text eol=crlf
$ git ls-files --eol mvnw mvnw.cmd
i/lf    w/lf    attr/text eol=lf      	mvnw
i/crlf  w/crlf  attr/text eol=crlf    	mvnw.cmd       <- i/crlf: the index (commit) holds CRLF
$ git ls-files -s mvnw.cmd
100644 5761d948924c19571d27b465c519b2e2f9e30351 0	mvnw.cmd
$ git hash-object --no-filters mvnw.cmd   # raw bytes on disk
5761d948924c19571d27b465c519b2e2f9e30351     <- identical to the commit
$ git hash-object mvnw.cmd                # what `git add` would store
92450f93273470af42eeee491874afb2039b700a     <- LF-normalized: different
$ git diff --stat
 mvnw.cmd | 378 ++++++------  (189 insertions, 189 deletions: CR-only differences)
```

The [gitattributes documentation](https://git-scm.com/docs/gitattributes) defines the
rules:

- `text`: "Line endings are normalized to LF in the index every time the file is checked
  in". With `text` set, the only valid stored form is LF.
- `eol=crlf` changes only the _working tree_ line endings. The documentation also says that
  setting `eol` "automatically sets `text` if `text` was left unspecified". So `eol=crlf`
  alone would cause the same problem.
- `i/crlf` + `attr/text` is the "unnormalized" state. The documentation describes the fix
  (`git add --renormalize .`) for exactly this state.

`maven-wrapper-plugin` generates `mvnw.cmd` with CRLF, and `960e795` committed it as
generated. If `.gitattributes` had been committed first, or if `git add --renormalize`
had been run after adding it, the blob would have been stored with LF. Every checkout
would then write CRLF to disk, and nothing would show as modified.

### 2. Why only a fresh clone shows it (and why the author did not see it)

Git skips the content check while a file's cached stat data (size, mtime, inode) still
matches. The authoring session staged the CRLF file. Its index entry then matched the file
on disk, so `git status` stayed clean there.

A fresh clone writes the file and the index in the same second. The entry is
"racily clean", and Git sets the cached `st_size` to 0 (`raw/reproduction.log`:
`size: 0` in `git ls-files --debug`). See the
[racy-git documentation](https://git-scm.com/docs/racy-git): "cached st_size information
is truncated to zero". The next `git status` must compare content. It runs the clean
filter (CRLF → LF), gets a different blob, and reports ` M`. The result is
deterministic: every clone of the repository is dirty.

### 3. Why `text=auto` repositories are not affected

`text=auto` does not convert files that are already committed with CRLF: "If it is text
and the file was not already in Git with CRLF endings … otherwise no conversion is done"
(the "safer autocrlf" rule). Only an explicit `text`, or `eol=…` without `text`, creates
this state. That explains why it is rare. In the hive-mind logs, this is the first clone
that solve has rejected for this reason.

### 4. Why hive-mind failed

`verifyDefaultBranchAndStatus` (`src/solve.repo-setup.lib.mjs`) treated any
`git status --porcelain` output after the clone as fatal. It did not separate content Git
merely _thinks_ changed from content that really changed. A rejected clone could only be
fixed by the repository owner, and the failure comment did not say what to change.

### Scope check across related repositories

`raw/template-repositories-scan.txt` covers fresh clones of the 10 link-foundation
templates. Only the Java template has an unnormalized CRLF blob under a `text` attribute.

## Solution

### Detection (`classifyStatusEntries`)

1. `git status --porcelain=v1 -z --untracked-files=all` is parsed by `parsePorcelainZ`.
   It handles rename/copy source paths and keeps paths verbatim.
2. Only worktree-only modifications (` M`) of regular files (modes `100644`/`100755`)
   can be artifacts. Untracked, staged, deleted, symlink and submodule entries are always
   real changes.
3. For the candidates, `git hash-object --no-filters --stdin-paths` hashes the raw bytes
   on disk, all in one batch. The result is compared with the stage-0 blob from
   `git ls-files --stage -z`. **Equal hashes prove that the working tree holds exactly the
   committed bytes.** The difference exists only inside Git's conversion (eol, `ident`,
   `filter`, `working-tree-encoding`).

### Handling (`resolveCheckoutArtifacts`)

- Solve continues only when _every_ reported entry is an artifact. One real change keeps
  the old fatal path, and nothing is written.
- For each artifact path, `.git/info/attributes` (from `git rev-parse --git-path
info/attributes`) gets `/<path> -text -eol -ident -filter -working-tree-encoding`
  (anchored, escaped, and quoted when needed) under a
  `# hive-mind: … (issue #4063)` header. The documentation says this file "has the
  highest precedence", so it overrides the repository's `.gitattributes`. It lives in
  `.git`, so it is never committed.
  This is the same clone-local technique as issue #2119 (`.git/info/exclude` for
  AI-tool scratch directories).
- `git status` runs again. If anything is still reported, the attributes file is restored
  and the run fails as before.
- The steps are idempotent, so a resumed session does not duplicate lines.
- The log contains:
  - a warning that lists the files;
  - in `--verbose` mode, the git version, `core.autocrlf`/`core.eol`/`core.safecrlf`, and
    the `check-attr` and `ls-files --eol` details for each path;
  - the command the repository owner can run:
    `git add --renormalize . && git commit -m "Normalize line endings per .gitattributes"`.

What this gives the AI tool and the pull request:

- `git status`, `git diff` and `git add -A` all agree that the clone is clean. The tool
  starts from an accurate state and does not commit a 189-line whitespace rewrite into an
  unrelated PR.
- If the tool really edits `mvnw.cmd`, the edit is committed byte for byte, as in the
  regression test. It keeps CRLF, like the committed file, and the diff shows only the
  real change.

### Better failure output when real changes exist

The error now names the first path, for example
`Repository has uncommitted changes after clone ( M pom.xml)`. When artifacts and real
changes are mixed, the log separates them, so the failure comment points at the cause.

### Alternatives considered

| Option                                                    | Why it was not chosen                                                                                                                                                                                          |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git update-index --assume-unchanged` / `--skip-worktree` | It hides real edits by the AI tool too (`git add -A` would skip them), so changes could be lost silently.                                                                                                      |
| Run `git add --renormalize` and commit it in the solve PR | It mixes an unrelated 189-line change into every PR for that repository and changes the repository's content without the owner deciding. It is still the right _upstream_ fix, so it is reported to the owner. |
| `git config core.autocrlf` / `core.eol` in the clone      | These settings do not override an explicit `text eol=crlf` attribute, so they would not help.                                                                                                                  |
| `git checkout -- <file>` / `git reset --hard`             | Git writes the same bytes back, and the entry is racily clean again, so the status stays dirty.                                                                                                                |
| Ignore the dirty status (log a warning and continue)      | The tool would see a modified file and could commit the conversion, and real pre-existing changes would no longer be detected.                                                                                 |
| A CLI flag such as `--allow-dirty-clone`                  | The situation can be detected exactly (equal blob hashes), so asking the user to choose is unnecessary. Real changes stay fatal.                                                                               |

## Debug and verbose output (R5)

The original log showed only ` M mvnw.cmd`. With `--verbose`, solve now logs the data
needed to diagnose the problem without access to the clone, for example (from
`raw/after-fix-real-clone.log`):

```
[VERBOSE] 🔍 Clone status: 1 path(s) reported as changed; 1 of them hold exactly the committed bytes (git content conversion artifacts)
⚠️  The repository's committed content does not match its own .gitattributes for 1 file(s); …
   M mvnw.cmd
[VERBOSE]    git version 2.43.0; core.autocrlf=(unset), core.eol=(unset), core.safecrlf=(unset)
[VERBOSE]    • mvnw.cmd: attributes text eol=crlf; i/crlf w/crlf attr/text eol=crlf
   Handled locally: … .git/info/attributes (never committed) …
   Repository fix (for the repository owner): git add --renormalize . && git commit -m "Normalize line endings per .gitattributes"
```

## Online research and existing components

- [gitattributes(5)](https://git-scm.com/docs/gitattributes) describes the `text`, `eol`
  and `text=auto` semantics, the precedence of `$GIT_DIR/info/attributes`, and the
  `git add --renormalize .` procedure. All of these are quoted above.
- [Racy Git](https://git-scm.com/docs/racy-git) explains why the fresh clone always
  re-checks the content.
- Git mailing list threads by Torsten Bögershausen and brian m. carlson
  (lore.kernel.org) recommend `git ls-files --eol` to diagnose and
  `git add --renormalize .` to fix "files modified right after clone".
- [Stack Overflow 10907569](https://stackoverflow.com/questions/10907569) ("Git: changes
  to repository immediately after cloning") reports the same symptom with the same cause
  and fix.
- Other Maven projects commit `mvnw.cmd eol=crlf` in `.gitattributes`, for example
  `apache/camel-spring-boot`. The attribute itself is correct. The defect is only that the
  blob was not normalized when it was committed.
- Existing tools that keep a repository from getting into this state:
  - the `mixed-line-ending` hook of [pre-commit-hooks](https://github.com/pre-commit/pre-commit-hooks);
  - a CI guard, `git add --renormalize . && git diff --cached --exit-code`, which fails
    when any committed blob is not normalized.

  Both belong in the affected repository, so they are suggested in the upstream report.
  No Node library handles this in a consumer's clone. Git's own attributes mechanism is
  the right tool, and the fix uses it directly.

## Upstream report (R6)

The Java template issue (linked at the top) includes:

- the reproduction: a fresh clone shows ` M mvnw.cmd`, plus the `ls-files --eol` output;
- the cause: commit `960e795`;
- the fix: `git add --renormalize mvnw.cmd && git commit`;
- the suggested CI guard;
- the hive-mind workaround from this PR.

## Codebase-wide review (R7)

I checked every place where solve or hive-mind tests a fresh clone for cleanliness:

- `src/solve.repo-setup.lib.mjs` `verifyDefaultBranchAndStatus`: the only
  "after clone" check that throws. It now uses `resolveCheckoutArtifacts`.
- Later uncommitted-change checks (auto-commit, recovery commits, the
  "uncommitted changes" restart loop) run against the same clone. Once
  `.git/info/attributes` neutralizes the artifact there, they see the same clean state. So
  the false ` M mvnw.cmd` no longer triggers auto-commits or recovery commits. In the
  failed run, the recovery commit `211771cb` saved exactly this artifact.
- `src/solve.mjs` calls `verifyDefaultBranchAndStatus` right after
  `setupRepositoryAndClone`, whatever the mode: fresh clone, fork, continue mode, or
  `--working-directory`. Every mode therefore gets the same handling.

## Verification

- `node tests/test-checkout-normalization-4063.mjs` runs 8 tests. They cover:
  - an offline repository built like the Java template;
  - the artifact being neutralized while the bytes stay unchanged;
  - idempotence;
  - real edits being committed byte for byte;
  - real changes and untracked files still being fatal;
  - `* text` repositories and paths with spaces and glob characters;
  - `verifyDefaultBranchAndStatus` succeeding with only artifacts and rejecting when there
    are real changes.

  The test fails without the `solve.repo-setup.lib.mjs` change.

- `experiments/issue-4063-dirty-clone-repro.sh` is an offline shell reproduction
  (`raw/offline-reproduction.log`).
- `experiments/issue-4063-real-clone-check.mjs` was run against a real clone of `dd803a2`
  (`raw/after-fix-real-clone.log`): `clean: true`, `neutralized: ["mvnw.cmd"]`,
  status afterwards `[]`.
