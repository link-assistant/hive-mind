---
'@link-assistant/hive-mind': patch
---

fix(bootstrap): fall back across CDNs/paths when fetching the use-m bundle

`use-m@8.14.0` relocated its eval bundle from `use.js` (package root) to
`src/use.js`, so the unversioned `https://unpkg.com/use-m/use.js` URL began
returning a `404 Not found` body that was then `eval()`'d, crashing every
command with `SyntaxError: Unexpected identifier 'found'`.

`loadUseMCode()` now tries a prioritized list of candidate URLs (unpkg root →
unpkg `src/` → jsdelivr root → jsdelivr `src/`), validating the HTTP status and
rejecting obvious error-page bodies so a single upstream/CDN hiccup no longer
breaks the whole CLI.
