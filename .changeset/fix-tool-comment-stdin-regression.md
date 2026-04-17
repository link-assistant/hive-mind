---
'@link-assistant/hive-mind': patch
---

fix(solve): post tool-generated PR comments again after v1.53.1 regression

`postTrackedComment()` in `src/tool-comments.lib.mjs` (added in #1626) was
passing the comment body to `gh api --input -` via `$({ input: payload })`,
but command-stream's option is `stdin`, not `input`. The misnamed key was
silently ignored, so `gh` read from the parent's stdin, sent an empty POST
body, and GitHub's edge returned `HTTP 400 "Whoa there!"`. Every tool-posted
comment — `AI Work Session Started`, log-upload link, `Ready to merge`,
`Auto-merged`, billing-limit notice, usage-limit notice — failed from this
one call path starting with v1.53.1.

Fix: use the documented `stdin` option so the JSON payload actually reaches
the child's stdin. The regression test pins the option name so a future
rename can't silently recur.

Fixes #1631.
