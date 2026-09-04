# F14 — What the new link checker found the first time it ran in CI

**Severity:** Medium · **Class:** False negatives (4 dead links) + false positives (13 unreachable-by-design)
**Status:** All 18 resolved. Fixed and mutation-checked in the commit that adds this file.

## Symptom

F9 added `.github/workflows/links.yml`. Its first run on this branch
([33883648104](https://github.com/link-assistant/hive-mind/actions/runs/33883648104)) went
red with **18 errors over 516 unique URLs**. A gate that has never run is not a gate, and
this is what it had been not-saying.

The 18 are not one problem. They are four, and telling them apart is the entire job — the
issue asks for false positives *and* false negatives, and this single run produced both.

## Classification

Each class was checked by hand before deciding anything, from this machine and against the
GitHub API, rather than inferred from the status code.

| Class | URLs | Evidence | Verdict |
| --- | --- | --- | --- |
| Repository renamed | `github.com/deep-assistant/hive-mind/issues/661` ×5 | `api.github.com/repos/deep-assistant/hive-mind` → **301** → `link-assistant/hive-mind`; issue 661 answers **200** under the new owner | **Real.** Rewrite the owner. |
| Login-gated by GitHub | `.../hive-mind/stargazers` ×4 | **404** signed-out — and equally 404 for the unrelated public repo `link-foundation/box`. A property of GitHub, not of this repository | **False positive.** Suppress. |
| Bot protection | `npmjs.com/...` ×4, `claude.ai/code` ×4 | **403** to a browser User-Agent as well as a bare one; `www.npmjs.com/package/...` 403 too, so it is not a wrong URL shape | **False positive.** Suppress. |
| Third-party repository gone | `github.com/40Think/AgogeDigitalTwin/issues/1` ×1 | **404** to every client | **Real, but not ours.** Suppress with the reason. |

## The one that matters

`deep-assistant/hive-mind` is *this repository under its former name*. Eleven URLs across
six files still pointed at it. The rename is exactly the kind of breakage a link checker
exists to catch, and it had been silently accumulating since the transfer.

Note the shape: the **API** answers `301 Moved Permanently`, so a naive check "does the
repo exist?" says yes, while the **HTML** URLs a reader would click answer 404. Two
plausible checks disagree, and only one of them matches what a reader experiences.

Five of the eleven were reported. The other six live under `docs/case-studies/`, which the
workflow excludes — so lychee would never have found them. They are fixed anyway, per the
issue's requirement to apply a fix everywhere it applies rather than only where it was
reported. The new assertion scans **every tracked Markdown file**, excluded or not.

## The suppression that suppressed nothing

`.lycheeignore` already carried this line:

```
https://www\.npmjs\.com
```

`README.md` links the **bare** host, `https://npmjs.com/@link-assistant/hive-mind`. The
pattern was present, looked deliberate, and matched nothing.

This is the pack's recurring mechanism one more time — *a control that looks like coverage
and checks nothing* — and it is worth noticing that it appeared **inside the fix for a
previous instance of it**. An unmatched ignore rule is indistinguishable from a missing
one until the checker runs, which is precisely why it survived: the checker had never run.

## Guards

Both added to `tests/doc-links-2198.test.mjs`, and both mutation-checked:

| Guard | Mutation | Result |
| --- | --- | --- |
| No tracked Markdown links to the former owner | Reintroduce one `deep-assistant` URL | fails, naming the file |
| Every URL we chose to suppress is *actually matched* by a pattern in `.lycheeignore` | Restore the `www`-only npmjs pattern | fails, naming the URL |
| | Delete the stargazers pattern | fails, naming the URL |

The second guard is the interesting one: it does not assert that a URL is *listed* in the
ignore file — listing is what already failed. It compiles each pattern and requires it to
match the URL it was written for.

## Why the dead third-party link is suppressed rather than removed

`data/case-studies/issue-683-pr-creation-failure.md` records which repository a failing run
was operating on. That URL is evidence, not a reference offered to the reader. Rewriting or
deleting it would falsify the incident record, so it is suppressed at URL level — not by
excluding the directory, which would also stop checking every other link in it. Per §14 of
`docs/CI-CD-BEST-PRACTICES.md`: scope the suppression, and write down why.
