# Check Links: GitHub `/blob/` pages answering 503 in CI (#2408)

## What failed

The Broken Link Checker failed on `main` (runs 36983833811, 37005554914) and on
several branches (this one: 37030208844, 37030549856, 37032356542, 37035727369, 37036093607) on 2026-10-02. Every error was `[503] Service Unavailable` from
github.com. Runs on the same day passed on other runners.

Excluding `node_modules`, lychee checks exactly seven `github.com/.../blob/...`
URLs in this repository. In every failing run, every failure was one of these
blob URLs, and most runs failed on all seven (some on three to six). One run
on `main` also had two transient 504s on `/issues` pages. The one `/tree/` URL and the other ~95 github.com URLs passed. The
first blob request was answered with 503 about 0.4 s into the run, so the 503
is not caused by a burst of requests. The 503 also outlasted
`--max-retries 3`, so throttling or more retries would not fix it. The same
URLs answer 200 from outside GitHub Actions, both through lychee 0.24.2 (the
version the action installs) and through curl.

## Fix

`.github/workflows/links.yml` remaps blob URLs to raw.githubusercontent.com:

```
--remap 'https://github\.com/([^/]+)/([^/]+)/blob/(.+) https://raw.githubusercontent.com/$1/$2/$3'
```

The raw URL takes the same owner, repo, ref and path, and it answers 404 for a
missing file, branch or commit. So a broken blob link is still reported, and
the report names the original URL in its `Remaps:` detail.

## Reproduce

```sh
# lychee v0.24.2 from https://github.com/lycheeverse/lychee/releases
lychee --no-progress --verbose --max-retries 1 \
  --remap 'https://github\.com/([^/]+)/([^/]+)/blob/(.+) https://raw.githubusercontent.com/$1/$2/$3' \
  experiments/issue-2408-link-check-503/probe.txt
```

- `probe.txt` has five real blob links and two missing ones. It is not `.md`,
  so the CI link check does not see the deliberately broken links.
- `remap-run.log` shows the five real links passing and the missing file and
  missing branch each failing with 404.
- `full-run-with-remap.log` is the whole repository, checked with the
  workflow's exact args through `eval` (the way lychee-action runs them). It
  had 0 errors.
- `tests/doc-links-2198.test.mjs` asserts that the remap exists and keeps
  owner, repo, ref and path.
