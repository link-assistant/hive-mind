# F9 — Documentation links were never checked; one had been broken for six months

**Severity:** Medium · **Class:** False negative (missing gate) + a live defect it hid
**Status:** Fixed in `d1832ad6`.

## The defect

`docs/FREE_MODELS.md` line 317 and the same line in all three translations
(`.hi.md`, `.ru.md`, `.zh.md`):

```markdown
[Case Study: Issue #1391](./case-studies/issue-1391/README.md)
```

`docs/case-studies/issue-1391/` **has never existed in any commit on any branch** —
confirmed with `git log --all -- docs/case-studies/issue-1391`, which returns nothing.

The link was added by `ff467191` (2026-03-04, "fix: update default agent model to
minimax-m2.5-free (Issue #1391)"). That commit updated the model and added the "Case
Study" entry, but never wrote the case study. The link was broken **on the day it landed**
and stayed broken for six months, in four files, because no job looked.

Fixed by pointing at the issue itself:
`[Issue #1391](https://github.com/link-assistant/hive-mind/issues/1391)`.

## The gap

No workflow, script or test read the repository's Markdown for link validity. Over 980 tracked
Markdown files, zero coverage.

## Fix — two complementary checks

**Offline half: `tests/doc-links-2198.test.mjs`.** Walks every tracked Markdown file,
extracts relative links, and fails if a target is missing. It needs no network, so it runs
in the ordinary test suite and cannot flake. It catches the common case — a link to a file
in this repository — immediately.

**Network half: `.github/workflows/links.yml`** (lychee, ported from the template), with a
Wayback Machine fallback via `scripts/check-web-archive.mjs`, `.lycheeignore` for hosts
that rate-limit or are examples by construction, and `--exclude-path` for four directory
trees.

## Two design points that are the whole finding

### `fail: false` plus an explicit `exit 1`

lychee is told **not** to fail, so the Wayback lookup can run on its output; a separate
step then fails the job. Omitting that second step turns every broken link into a silent
pass — precisely the false negative this file exists to prevent. The offline test
therefore asserts the presence of *both* `fail: false` and `exit 1` in the workflow.

### Code spans must be masked document-wide

`CHANGELOG.md` is full of Markdown *about* links inside code spans. Treating those as
targets is a false positive of exactly the class this issue is about. The masking cannot
be done line by line: a code span may wrap across a soft line break, and `CHANGELOG.md`
has one whose closing backtick sits on the next line — which produced a spurious
`CHANGELOG.md:2155 -> url` while this test was being written. Masking runs over the whole
document, replacing every masked character with a space so newlines survive and reported
line numbers stay accurate.

## Exclusions, and keeping the two checkers in step

Four prefixes are excluded from both the test and the lychee run:
`docs/case-studies/`, `dev/log/`, `experiments/issue-2102/corpus/`, `tests/fixtures/`.
Each holds documents copied verbatim from elsewhere or archived evidence, whose relative
links describe *their* source tree.

The test asserts the workflow carries an `--exclude-path` for every prefix in its own
list, so the two cannot drift apart.

## Rejected

An early `.lycheeignore` draft of mine excluded
`https://github.com/link-assistant/hive-mind/(issues|pull)/` on rate-limit grounds. That
was wrong twice over: lychee authenticates to GitHub with `GITHUB_TOKEN`, so the rate
limit does not bite, and the rule would have silenced exactly the class of finding this
issue targets. Removed.
