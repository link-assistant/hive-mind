# Cache call-graph audit (R2)

We verified that every call site that talks to the Anthropic OAuth Usage API
(`GET https://api.anthropic.com/api/oauth/usage`) flows through the cached
wrapper `getCachedClaudeLimits`. Analogous wiring exists for Codex.

## Raw API entry points

`src/limits.lib.mjs` declares two raw fetch functions:

- `getClaudeUsageLimits(verbose, credentialsPath)` — line 635
- `getCodexUsageLimits(verbose, authPath, baseUrl)` — line 781

## Caller audit

```
$ grep -rn "getClaudeUsageLimits\|getCodexUsageLimits" src/
src/limits.lib.mjs:635:export async function getClaudeUsageLimits(verbose = false, credentialsPath = DEFAULT_CREDENTIALS_PATH) {
src/limits.lib.mjs:781:export async function getCodexUsageLimits(verbose = false, authPath = DEFAULT_CODEX_AUTH_PATH, baseUrl = null) {
src/limits.lib.mjs:988: * @param {Object|null} usage - The usage object from getClaudeUsageLimits, or null if unavailable
src/limits.lib.mjs:1181: * @param {Object|null} codexLimits - Result object from getCodexUsageLimits, or null
src/limits.lib.mjs:1363:  const result = await getClaudeUsageLimits(verbose);   // inside getCachedClaudeLimits
src/limits.lib.mjs:1389:  const result = await getCodexUsageLimits(verbose);    // inside getCachedCodexLimits
src/limits.lib.mjs:1454:  getClaudeUsageLimits,                                    // module default export
src/limits.lib.mjs:1455:  getCodexUsageLimits,                                    // module default export
```

The only call sites that invoke the raw functions are inside
`getCachedClaudeLimits` (line 1363) and `getCachedCodexLimits` (line 1389).
The default export (lines 1454-1455) is _exported_ for tests but not invoked
elsewhere in `src/`.

```
$ grep -rn "getCachedClaudeLimits\|getCachedCodexLimits\|getAllCachedLimits" src/
src/telegram-solve-queue.lib.mjs   getCachedClaudeLimits, getCachedCodexLimits  (queue throttling)
src/telegram-show-limits.lib.mjs   getCachedClaudeLimits, getCachedCodexLimits  (/show-limits flag)
src/telegram-bot.mjs               getAllCachedLimits                           (/limits command)
src/limits.lib.mjs                 (defines and re-exports)
```

All external callers go through the cached wrappers — no direct call to
`getClaudeUsageLimits` exists outside `limits.lib.mjs`. R2 is satisfied without
any code change; the failure mode the issue describes is therefore purely the
TTL being shorter than the upstream rate-limit window, not a bypass.
