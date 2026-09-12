# Issue #2239: links to images were broken

## Summary

On a fork pull request, the solver published three screenshot links that pointed
at the repository hosting the pull request instead of the repository holding the
branch. GitHub answered 404 for all three and the reviewer saw broken images.

The fork-aware prompt example added by issue #1561 was present and correct in
this session — the system prompt said `konard/frontend` — and the tool wrote
`Godmy/frontend` anyway. The instruction was never the missing piece; the
missing piece is that nothing ever checked what was published. This pull request
adds that check, and makes the fork-mode instruction say _why_ as well as _what_.

## Problem statement

[Godmy/frontend#2](https://github.com/Godmy/frontend/pull/2) embeds:

```html
<img src="https://github.com/Godmy/frontend/blob/issue-1-46ba053c/docs/screenshots/graph-force.png?raw=true" width="260" />
```

plus the same form for `graph-sankey.png` and `graph-network.png`.

The pull request is cross-repository:

| Field               | Value                                        |
| ------------------- | -------------------------------------------- |
| Base                | `Godmy/frontend` @ `main`                    |
| Head                | `konard/Godmy-frontend` @ `issue-1-46ba053c` |
| `isCrossRepository` | `true`                                       |

`issue-1-46ba053c` was pushed to the fork. It never existed in `Godmy/frontend`,
so every `github.com/Godmy/frontend/blob/issue-1-46ba053c/...` URL is a 404, and
a 404 in an `<img>` tag is a broken image.

Verified live against the API (`data/url-verification.txt`, regenerate with
`node experiments/issue-2239/verify-broken-links.mjs`):

```
docs/screenshots/graph-force.png
  Godmy/frontend         404  gh: No commit found for the ref issue-1-46ba053c (HTTP 404)
  konard/Godmy-frontend  200  5eace34a3d96
docs/screenshots/graph-sankey.png
  Godmy/frontend         404  gh: No commit found for the ref issue-1-46ba053c (HTTP 404)
  konard/Godmy-frontend  200  38003ec1894c
docs/screenshots/graph-network.png
  Godmy/frontend         404  gh: No commit found for the ref issue-1-46ba053c (HTTP 404)
  konard/Godmy-frontend  200  c4bd5ab7df82
```

3/3 broken as published; 3/3 present in the fork. The files were committed and
pushed correctly. Only the repository named in the URL is wrong.

(The solve log calls the fork `konard/frontend`. The repository has since been
renamed to `konard/Godmy-frontend`; GitHub still redirects the old name, which
is why both resolve.)

## Requirements, extracted

Every requirement stated in issue #2239, and where it is addressed.

| #   | Requirement                                                                                     | Status | Where                                                                                                   |
| --- | ----------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| R1  | Download all logs and data related to the issue into this repository                            | Done   | `docs/case-studies/issue-2239/data/`, see `MANIFEST.md`                                                 |
| R2  | Deep case study analysis compiled under `docs/case-studies/issue-2239`                          | Done   | this file                                                                                               |
| R3  | Reconstruct the timeline and sequence of events                                                 | Done   | [Timeline](#timeline)                                                                                   |
| R4  | List each and all requirements from the issue                                                   | Done   | this table                                                                                              |
| R5  | Find the root cause of each problem                                                             | Done   | [Root causes](#root-causes)                                                                             |
| R6  | Propose possible solutions and a solution plan for each requirement                             | Done   | [Solutions considered](#solutions-considered)                                                           |
| R7  | Check known existing components/libraries that solve a similar problem                          | Done   | [Existing components considered](#existing-components-considered)                                       |
| R8  | If there is not enough data for the root cause, add debug output and a verbose mode             | Done   | verbose tracing in `src/pr-image-link-repair.lib.mjs`, gated on `--verbose`; the root cause _was_ found |
| R9  | Report issues to other repositories where relevant, with reproductions, workarounds and fixes   | N/A    | [Other repositories](#other-repositories)                                                               |
| R10 | Apply the fix to the entire codebase — if the problem exists in several places, fix all of them | Done   | [Entire-codebase sweep](#entire-codebase-sweep)                                                         |
| R11 | Plan and execute everything in this single pull request                                         | Done   | link-assistant/hive-mind#2240                                                                           |

## Timeline

Reconstructed from the sanitized solve log attached to the issue
(`data/solve-log-excerpts.md` for the quoted lines; the full 33,477-line log is
linked from `MANIFEST.md`). All times UTC.

| Time         | Log line | Event                                                                                                                                                     |
| ------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 04:31:13.895 | 68       | `✅ Auto-fork: No write access detected, enabling fork mode`                                                                                              |
| 04:31:16.228 | 78       | `🍴 Detected fork PR from konard/frontend`                                                                                                                |
| 04:31:20.261 | 100      | `ℹ️ Fork exists: konard/frontend`                                                                                                                         |
| 04:31:30.150 | 169      | `✓ Pull request Godmy/frontend#2 is converted to "draft"`                                                                                                 |
| 04:31:39.125 | 374      | System prompt sent, containing the **correct** fork path: `https://github.com/konard/frontend/blob/issue-1-46ba053c/docs/screenshots/result.png?raw=true` |
| 04:39:27.145 | 18415    | Context compaction: the session is resumed from a summary                                                                                                 |
| 04:49:42.549 | 32606    | The tool writes `/tmp/pr-body.md` with three `<img src="https://github.com/Godmy/frontend/blob/issue-1-46ba053c/...">` tags                               |
| 04:49:42.549 | 32641    | `gh pr edit 2 --body-file /tmp/pr-body.md && gh pr ready 2`                                                                                               |
| 04:49:46.521 | 32692    | `✓ Pull request Godmy/frontend#2 is marked as "ready for review"` — published, with three broken images                                                   |

Four seconds elapsed between writing the wrong URLs and marking the pull request
ready for a human to read. Nothing in between inspected them.

## Root causes

### RC1 — nothing verifies a published link (primary)

The solver has no step that reads back what it published and checks whether the
links in it resolve. Screenshot URLs are produced by a language model from
instructions, and instructions are advisory: they shift the odds, they do not
constrain the output. Between the tool writing `/tmp/pr-body.md` and the pull
request being marked ready for review there was no check of any kind.

This is not a new observation. `docs/case-studies/issue-1561/case-study.md`
recorded exactly this fix as **Solution D — "Add URL Validation After Screenshot
Commit"** and it was never implemented; only Solution A (the fork-aware
template) shipped. #2239 is the same defect recurring in the gap Solution D was
meant to close.

### RC2 — the ambient context overwhelms a single instruction

The fork-aware example was correct and it appeared **twice** in the 33,477-line
log. The upstream path appeared **90 times**; the fork path, 16. The tool spent
the whole session reading `Godmy/frontend` issue text, running
`gh pr edit 2` against `Godmy/frontend`, and being told the pull request is
`https://github.com/Godmy/frontend/pull/2`. When it came to write an image URL,
`Godmy/frontend` was overwhelmingly the available answer.

### RC3 — context compaction drops the fork distinction

At 04:39:27 the session was compacted and resumed from a summary. In that
summary (`data/compaction-summary.txt`) `Godmy/frontend` appears **5 times** and
`konard/frontend` **once**, in a parenthetical. The summary carries the
instruction "committed to the branch and linked with `?raw=true`" — the rule
survived compaction, the fork-specific _repository_ did not. The pull request
body was written ten minutes after this point.

### RC4 — branch-based blob links are not permanent (latent)

Even a correctly-repointed `blob/<branch>/` link dies when the branch is deleted
after merge, which is the default on most repositories. The prompt calls these
"permanent links"; they are not. A commit SHA is. This did not cause #2239 — the
branch still exists — but it is the same class of defect one merge away.

## What was implemented

### `src/pr-image-link-repair.lib.mjs`

A deterministic post-session repair. After the tool finishes, it reads the pull
request description and the bot's own comments, extracts every repo-and-ref
qualified GitHub file link, and checks each one against
`repos/{owner}/{repo}/contents/{path}?ref={ref}`.

A link is rewritten only when all three hold:

- the link names a ref the pull request **owns** — its head ref or head SHA. A
  link at the base branch, or at anything belonging to an unrelated repository,
  is never a candidate, so a 404 elsewhere on the internet can never be
  "repaired" into this pull request's fork on the coincidence of a matching ref
  name and path;
- the link **as written** answers 404; and
- the same `path` at the same `ref` **is present** in the pull request's head
  repository (`head.repo.full_name`, read from the pull request itself — no
  dependence on `argv.fork` or the `forkedRepo` plumbing).

Anything else is left exactly as the author wrote it. A network error, a rate
limit or an unparseable ref yields "unknown", and unknown never triggers an
edit — a repair tool that guesses is worse than a broken image. Both
`github.com/.../blob|raw/...` and `raw.githubusercontent.com/...` forms are
handled, in Markdown `![](…)` and HTML `<img src="…">` alike; the failure that
prompted this issue used HTML.

Refs containing slashes (`release/2.0`) are split correctly by matching the
pull request's own head/base refs and head SHA before falling back to "first
segment". Existence answers are memoized, so three screenshots cost three
probes rather than nine.

It runs in `showSessionSummary` immediately **before** the issue #1745
sanitization sweep, so the sanitizer still has the last word on anything written
back to GitHub — and the repair's own PATCH payloads go through
`sanitizeForPublication` as well.

Per R8, `--verbose` traces every decision: each link examined, each rewrite, and
each skip with its reason (`foreign-ref`, `existence-unknown`,
`missing-in-head-repo`, `head-repo-unknown`).

### `src/screenshot-links.prompts.lib.mjs`

In fork mode the prompt now carries the reason, not only the example: which
repository holds the branch, that a branch file requested from the other one
answers 404 and renders broken, and a `gh api …/contents/…?ref=…` command to
check before finishing. It deliberately never spells out the upstream blob URL,
even as a counter-example — a counter-example is still a copyable string, which
is what the issue #1561 test asserts against.

## Entire-codebase sweep

Per R10, every place the defect can occur:

| Place                                                           | Action                                                                              |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `src/{claude,codex,agent,opencode,qwen,gemini}.prompts.lib.mjs` | All six prompt builders get the fork warning, via one shared module                 |
| `src/locales/{en,ru,hi,zh}.lino`                                | The parallel translated instruction set gets an equivalent line in all four locales |
| Pull request **description**                                    | Repaired                                                                            |
| Bot-authored pull request **comments**                          | Repaired — issue #1561's broken screenshot was in a comment, not a description      |
| Issue bodies and human-authored comments                        | Never touched, matching the boundary drawn by issue #1745                           |
| `raw.githubusercontent.com` links                               | Repaired, same as `github.com/blob`                                                 |

## Solutions considered

| Option                                                           | Verdict                                                                                                                            |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **A. Post-publication verification and repair**                  | **Implemented.** Deterministic, evidence-based, needs no cooperation from the model, and fixes pull requests already open.         |
| **B. Harden the fork-mode instruction**                          | **Implemented**, as a complement to A. On its own it is what already failed here: #1561 shipped an instruction and #2239 followed. |
| **C. Pin image links to a commit SHA instead of a branch**       | Not done here. Addresses RC4 rather than #2239, changes URLs the model is told to write, and is better proposed on its own.        |
| **D. Upload images to a hidden `refs/hive-mind-media/pr-N` ref** | Not done. `src/interactive-image-upload.lib.mjs` already does this for interactive uploads; extending it is a larger change.       |
| **E. Block `gh pr ready` until links resolve**                   | Rejected. Turns a cosmetic defect into a failed run, and cannot help the pull requests that are already broken.                    |

Option A also repairs historical damage: it is a plain function over a pull
request number, so it can be pointed at an existing broken pull request.

## Existing components considered

| Component                                       | Why not reused                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/post-finish-sanitization-sweep.lib.mjs`    | Wrong concern (secrets, not links), but the right **shape**: read-back, decide, PATCH in place, bot-authored content only. The new module follows its structure and its `quietProbe` / `$({ stdin })` conventions deliberately.                                                                                                     |
| `src/interactive-image-upload.lib.mjs`          | Solves permanence for _interactive_ uploads (`buildRawBlobUrl`, hidden media refs). It builds correct URLs; it does not check URLs someone else wrote. Its `buildRawBlobUrl` is the reference for option C.                                                                                                                         |
| `screenshotRepoPath` (issue #1561)              | Already in place and already correct in this session. Kept and extended, not replaced.                                                                                                                                                                                                                                              |
| Link checkers (`lychee`, `markdown-link-check`) | They answer "is this URL reachable", not "which repository should this have named". They cannot propose the repair, they add a binary dependency, and a 404 on a private repository is indistinguishable from a wrong path without authentication. The GitHub contents API answers both questions with credentials already at hand. |
| `gh api repos/{o}/{r}/contents/{p}?ref={r}`     | **Used.** Authoritative, authenticated, works on private repositories, and distinguishes "no such ref" from "no such file".                                                                                                                                                                                                         |

## Other repositories

R9 asks that problems belonging to other projects be reported there, with
reproductions and suggested fixes. This defect belongs entirely to
link-assistant/hive-mind: `Godmy/frontend` did nothing wrong, GitHub's 404 for a
ref that does not exist is correct behaviour, and no third-party library is
involved. There is nothing to report elsewhere. The log does record several
pre-existing problems in `Godmy/frontend` itself (the vitest 4 browser config,
the missing `packageManager` field, CI pointing at a non-existent
`packages/frontend` directory), but those were found and reported by that
session in its own pull request description, and they are not what #2239 is
about.

## Reproduction and tests

```bash
# Live reproduction against the real pull request (read-only, needs gh auth)
node experiments/issue-2239/verify-broken-links.mjs

# The repair itself against the real pull request, read-only (needs gh auth)
node experiments/issue-2239/dry-run-repair.mjs

# The regression test: the exact URLs from Godmy/frontend#2
node tests/test-pr-image-link-repair-2239.mjs
```

Run against `Godmy/frontend#2` as it stands today, the repair proposes exactly
the three rewrites and nothing else — output committed as
`data/dry-run-repair.txt`:

```
WOULD FIX  https://github.com/Godmy/frontend/blob/issue-1-46ba053c/docs/screenshots/graph-force.png?raw=true
       ->  https://github.com/konard/Godmy-frontend/blob/issue-1-46ba053c/docs/screenshots/graph-force.png?raw=true
```

The test drives the real code path with the published body, a scripted `gh`, and
an existence oracle matching the live repositories. It asserts the three links
are repointed at the fork, and — just as importantly — that a working link, an
unknown answer, a same-repo pull request and a file missing from both
repositories all leave the body untouched.

## What this does not do

- It does not make branch-based links permanent (RC4). A link repaired to the
  fork still breaks when the branch is deleted.
- It does not re-check images after a human edits the description; it runs once,
  when the session ends.
- It cannot repair a link whose file was never committed anywhere — that is an
  authoring mistake, and the repair reports it as `missing-in-head-repo` under
  `--verbose` rather than inventing a target.

## Sources

- Issue: [link-assistant/hive-mind#2239](https://github.com/link-assistant/hive-mind/issues/2239)
- The broken pull request: [Godmy/frontend#2](https://github.com/Godmy/frontend/pull/2)
- The sanitized solve log attached to the issue (33,477 lines) — excerpts in `data/`
- Prior case study of the same bug class: `docs/case-studies/issue-1561/case-study.md`
- Post-finish repair precedent: issue #1745, `src/post-finish-sanitization-sweep.lib.mjs`
- Permanent image URL precedent: issue #1843, `src/interactive-image-upload.lib.mjs`
- GitHub REST: [Get repository content](https://docs.github.com/en/rest/repos/contents#get-repository-content) — `404` when the ref or the path does not exist
