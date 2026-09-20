# External Research for Issue #2019

## GitHub repository fork metadata

Source: https://docs.github.com/en/rest/repos/repos#get-a-repository

GitHub's repository API only includes `parent` and `source` objects when the
repository is a fork. This supports treating `fork: false`, `parent: null`, and
`source: null` for `konard/Payel-git-ol-Octra` as authoritative evidence that it
is not a GitHub fork of `Payel-git-ol/Octra`.

## GitHub compare API network boundary

Source: https://docs.github.com/en/rest/commits/commits#compare-two-commits

GitHub documents compare support for refs or SHAs in the same repository, or in
different repositories within the same repository network, including fork
branches. The endpoint documents `404 Resource not found` as a possible response.
That matches the observed `404` when Hive Mind tried to compare a non-fork
repository against the upstream repository network.

## GitHub compare UI boundary

Source:
https://docs.github.com/en/pull-requests/committing-changes-to-your-project/viewing-and-comparing-commits/comparing-commits

GitHub's commit comparison documentation describes comparing commits in a
repository or its forks. This is the same boundary the REST compare endpoint
enforces for cross-repository comparisons.

## Fork naming support

Source: https://github.blog/changelog/2022-04-12-you-can-now-name-your-fork-when-creating-it/

GitHub added custom fork names in 2022. Hive Mind's prefixed fork naming flow is
therefore conceptually supported by GitHub, but the existing repository must
still be a real fork in GitHub metadata.

## Related GitHub CLI issue

Source: https://github.com/cli/cli/issues/6329

The GitHub CLI has a public issue reporting that `gh repo fork --fork-name` could
rename an existing repository instead of creating a new fork in some conditions.
This is a plausible historical source of non-fork repositories with fork-like
names, but issue #2019 did not prove that this specific Octra repository was
created by that bug.

## Existing components considered

- GitHub compare API: useful as a quick same-network default-branch signal, but
  insufficient for non-fork replacement repositories because it can return 404
  before answering the data-loss question.
- Git native commands: `git fetch --filter=blob:none` plus
  `git rev-list --not --remotes=...` directly answers whether replacement branch
  commits are reachable from upstream refs without downloading full blobs.
- `simple-git` and `isomorphic-git`: possible Node wrappers, but not needed here
  because Hive Mind already executes Git commands through `command-stream`.
