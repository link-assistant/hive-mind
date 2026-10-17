- 03d1372: `/fix --update-all-dependencies` and `/task --update-all-dependencies` now merge every open Dependabot pull request before creating the maintenance issue, without waiting for CI/CD (issue #3413). Pull requests are merged oldest first with the repository's preferred merge method, pinned to the reviewed head commit, and retried once with `--admin` when only branch rules block them. The generated issue starts with a section that lists each merged pull request and the checks that were not passing at merge time, and asks the solver to fix every error those merges introduced. It also lists the pull requests that could not be merged, so their updates are applied by hand. `--dry-run` only lists the pull requests, and `--no-merge-dependabot-prs` turns the step off.

Also refreshes the `@dotenvx/dotenvx` (2.38.0) and `links-notation` (0.27.0) runtime pins flagged by the dependency freshness gate.

**Related Pull Request:** #3414

---

[![npm version](https://img.shields.io/badge/npm-2.38.0-blue.svg)](https://www.npmjs.com/package/%40link-assistant%2Fhive-mind/v/2.38.0)