---
'@link-assistant/hive-mind': patch
---

Retry use-m global package loads on hosted-CI corrupt-install flakes (#1710)

Hosted GitHub Actions runners occasionally return a truncated or partially-installed
global package after `npm install -g`, surfacing as either
`Failed to import module from '...': SyntaxError: Unexpected end of input` or
`Failed to resolve the path to '<pkg>'` when use-m loads `getenv` /
`links-notation` from `src/config.lib.mjs` and `src/lino.lib.mjs`. Adds
`src/use-with-retry.lib.mjs`, a small wrapper around `use(...)` that
recognises both flake modes, removes the broken alias directory, and
re-fetches once. `config.lib.mjs` and `lino.lib.mjs` use it for their dynamic
loads. Covered by `tests/test-use-with-retry.mjs` (13 cases, including
both error shapes, retry exhaustion, and cleanup failure).
