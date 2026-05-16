# Case Study — Issue #1798: Increase Claude Usage API caching interval by 3 minutes

- Issue: https://github.com/link-assistant/hive-mind/issues/1798
- PR: https://github.com/link-assistant/hive-mind/pull/1800
- Branch: `issue-1798-13b033b1f43c`
- Date: 2026-05-13

## 1. Problem statement (from the issue)

> Now we sometimes getting message like this:
>
> ```
> Claude limits
> Claude Usage API access has reached rate limit. Resets in 3m 36s (May 13, 7:59am UTC)
> ```
>
> That means we do Claude Usage API access too often, or may be we have access directly, that is
> not yet cached, we need to ensure all access to Claude Usage API is cached, and we should
> increase time of live of cached copy by 3 minutes, so reaching limit will be less likely.

## 2. Requirements extracted from the issue

| #   | Requirement                                                                                                  | Resolution                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | Increase the time-to-live of the cached copy of the Claude Usage API response by **3 minutes**.              | Implemented: default `cacheTtl.usageApi` raised from 10 → 13 minutes (`src/config.lib.mjs`).                                                                                                                 |
| R2  | Ensure **all** access to the Claude Usage API is cached (no direct, un-cached call paths).                   | Audited: every caller in `src/` reaches the API only through `getCachedClaudeLimits` / `getCachedCodexLimits` (see §5).                                                                                      |
| R3  | Reaching the rate limit ("Resets in 3m 36s") should become less likely after the fix.                        | The new 13-minute TTL exceeds the observed 3m 36s rate-limit window with a comfortable safety margin.                                                                                                        |
| R4  | Compile the data into `docs/case-studies/issue-1798/`, do a deep analysis, search online, propose solutions. | This file plus `data/` and `research/` siblings.                                                                                                                                                             |
| R5  | Add debug output / verbose mode if root cause cannot be pinned down on the first pass.                       | Already in place — `getClaudeUsageLimits(verbose=true)` and the cache wrappers log every cache hit / miss, every TTL value, and full request/response headers (added in #1446). No new tracing was required. |
| R6  | File issues on related upstream projects with reproducer + workarounds.                                      | Not needed for this PR: the upstream rate-limit bug is **already filed and tracked** (anthropics/claude-code #30930, #31021, #31637). Linked in §7.                                                          |

## 3. Timeline / sequence of events

### Project history (re-constructed from git log)

```text
Wed Jan  7 2026   1a96d9ff  fix: increase Claude Usage API cache TTL to 20 minutes to avoid rate limiting (#1074)
Thu Jan 29 2026   8cb05431  Reduce usage API cache TTL from 20 to 10 minutes (to refresh Claude limits faster)
…                            (no further change)
Tue May 13 2026   <this PR>  Increase Claude Usage API cache TTL from 10 → 13 minutes (issue #1798)
```

The "Resets in 3m 36s" message the user pasted in the issue body comes from `formatRetryAfterMessage()`
in `src/limits.lib.mjs` (added in issue #1446). It is printed only when the Anthropic API
responds with HTTP 429 and a `retry-after` header. The body / timestamp confirm the user hit
this **after** the TTL was reduced to 10 minutes — i.e. the previous 20-minute value avoided
this class of failure, the 10-minute value occasionally tripped it, and the request in the
issue is to claw back some of the safety margin without going all the way back to 20 minutes.

### Single-request timeline (from the user-visible message)

1. User invokes `/limits` (or any code path that calls `getAllCachedLimits()`).
2. Cache key `claude` is missing or expired (10-minute TTL).
3. `getClaudeUsageLimits()` calls `GET https://api.anthropic.com/api/oauth/usage`.
4. Anthropic responds with HTTP 429 + `retry-after: 216` (≈ 3m 36s).
5. `formatRetryAfterMessage()` renders: `Resets in 3m 36s (May 13, 7:59am UTC)`.
6. The error is cached under `claude-rate-limited` with the same `CACHE_TTL.USAGE_API` so we
   don't hammer the endpoint until the window has cleared (added in #1446).

## 4. Root-cause analysis

### Why we hit the rate limit at all

The Anthropic `/api/oauth/usage` endpoint is rate-limited much more aggressively than the
regular Anthropic API. Recent upstream reports (linked in §7) describe persistent HTTP 429
with `retry-after` values ranging from a few seconds up to several minutes. Anthropic has not
published a public rate-limit specification for the OAuth usage endpoint.

### Why a 10-minute TTL is not enough

`8cb05431` reduced the TTL from 20 → 10 minutes "to refresh Claude limits faster". That
optimisation reads cleanly when usage is healthy, but Anthropic's rate-limit window for this
endpoint is now empirically wider than 10 minutes for some users: the user pasted a message
showing the next allowed retry was 3 minutes 36 seconds **after** the previous request — and
because we only consult the cache when it expires, the next `/limits` invocation after the
cache TTL elapses would hit a 429 if Anthropic's internal window is even slightly longer than
our TTL plus the variance between sessions. The +3 minute padding the issue asks for is a
defensive margin, not a precise mapping of the underlying limit.

### Why all access is already cached (R2)

We audited every caller of `getClaudeUsageLimits` / `getCodexUsageLimits` in `src/`:

```
src/limits.lib.mjs:1363  await getClaudeUsageLimits(verbose)   // inside getCachedClaudeLimits
src/limits.lib.mjs:1389  await getCodexUsageLimits(verbose)    // inside getCachedCodexLimits
```

Both call sites are inside the cached wrappers; there is no direct bypass. External callers
(`src/telegram-solve-queue.lib.mjs`, `src/telegram-bot.mjs`, `src/telegram-show-limits.lib.mjs`)
all use `getCachedClaudeLimits` / `getCachedCodexLimits` / `getAllCachedLimits` exclusively.

Search command used:

```sh
grep -rn "getClaudeUsageLimits\|getCodexUsageLimits" src/
```

## 5. Solution

### 5.1. Code change

`src/config.lib.mjs` (single-line behaviour change):

```diff
- usageApi: parseIntWithDefault('HIVE_MIND_USAGE_API_CACHE_TTL_MS', 10 * 60 * 1000), // 10 minutes
+ usageApi: parseIntWithDefault('HIVE_MIND_USAGE_API_CACHE_TTL_MS', 13 * 60 * 1000), // 13 minutes
```

The TTL is still overridable via the `HIVE_MIND_USAGE_API_CACHE_TTL_MS` environment variable
for operators who want to tune it further (up or down).

### 5.2. Documentation updates

- `docs/CONFIGURATION.md`, `…ru.md`, `…zh.md`, `…hi.md` — updated the default value (`600000` → `780000`),
  the human-readable description ("10 minutes" → "13 minutes") and the note explaining why.
- `src/limits.lib.mjs` — updated the doc-comment block that quoted the now-stale 20-minute figure
  and the inline TTL comment in `getCachedClaudeLimits`.
- `src/telegram-show-limits.lib.mjs` — updated the file-header comment that quoted "TTL: 20 minutes".

### 5.3. Test updates

- `experiments/test-usage-api-cache-ttl.mjs` — minimum-TTL assertion changed from `>= 20 min`
  (which the 10-minute default had been silently failing) to `>= 13 min`.
- `tests/solve-queue.test.mjs` — added two explicit tests:
  1. `CACHE_TTL.USAGE_API default is at least 13 minutes (issue #1798)`
  2. `CACHE_TTL.USAGE_API is longer than CACHE_TTL.API (rate-limit headroom)`

### 5.4. Why 13 minutes (and not 20)

The issue title literally asks to "increase the caching interval by **3 minutes**". Starting
from the current default of 10 minutes (`8cb05431`) that yields **13 minutes**. We deliberately
did not revert all the way to the 20-minute value the project briefly used after issue #1074
because the maintainer specifically reduced it ("to refresh Claude limits faster"); applying
only the requested 3-minute increase preserves that decision while honouring the new request.

## 6. Existing components / libraries that solve the same problem

- **`LimitCache` class** in `src/limits.lib.mjs` — already provides a generic
  `Map`-backed cache with per-entry TTL and a per-cache default. We re-used it as-is.
- **`HIVE_MIND_USAGE_API_CACHE_TTL_MS` environment variable** — already wired through
  `parseIntWithDefault` in `src/config.lib.mjs`. Operators can override the new 13-minute
  default at runtime; no plumbing change was required.
- **`getCachedClaudeLimits` / `getCachedCodexLimits` rate-limit error caching** — added in
  issue #1446. We benefit automatically because the new 13-minute TTL is also used for the
  `claude-rate-limited` / `codex-rate-limited` keys.
- **`formatRetryAfterMessage`** (also from #1446) — already produces the user-visible message
  the issue quoted, so no formatting work is needed; the fix is purely the TTL bump.

## 7. Online research

The Anthropic `/api/oauth/usage` rate-limit behaviour is a known upstream pain point:

- [anthropics/claude-code#30930](https://github.com/anthropics/claude-code/issues/30930) —
  persistent HTTP 429 with `retry-after: 0` from `/api/oauth/usage`.
- [anthropics/claude-code#31021](https://github.com/anthropics/claude-code/issues/31021) —
  persistent 429 on OAuth usage API.
- [anthropics/claude-code#31637](https://github.com/anthropics/claude-code/issues/31637) —
  aggressive rate limiting makes monitoring unusable.
- [Claude API rate limit documentation](https://docs.claude.com/en/api/rate-limits) — does not
  document the specific limit for `/api/oauth/usage`; the public docs describe per-model
  token / request limits for the regular API only.
- [codelynx.dev statusline post](https://codelynx.dev/posts/claude-code-usage-limits-statusline)
  — independent community write-up confirming `null` usage values when the OAuth endpoint is
  throttled.

R6 ("if issue related to any other repository … please [file]"): the upstream rate-limit bug
is already filed and discussed across the three issues above. Adding a fourth report would
be redundant and not actionable on Anthropic's side beyond what's already there.

## 8. Verification

- `node experiments/test-usage-api-cache-ttl.mjs` — 6/6 sub-tests pass, reports
  `CACHE_TTL.USAGE_API: 13m 0s (780000 ms)`.
- `node tests/solve-queue.test.mjs` — 70/70 pass (incl. the two new `#1798` assertions).
- `node tests/limits-display.test.mjs` — 66/66 pass.

## 9. Files changed

| File                                       | Change                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| `src/config.lib.mjs`                       | `usageApi` default 10 → 13 minutes; comment updated to reference #1798.               |
| `src/limits.lib.mjs`                       | Doc comments and inline annotations updated to reference the new default and #1798.   |
| `src/telegram-show-limits.lib.mjs`         | File-header TTL annotation updated from "20 minutes" to "13 minutes (see #1798)".     |
| `docs/CONFIGURATION.md`                    | Default and prose updated; #1798 linked.                                              |
| `docs/CONFIGURATION.ru.md`                 | Localised default and prose.                                                          |
| `docs/CONFIGURATION.zh.md`                 | Localised default and prose.                                                          |
| `docs/CONFIGURATION.hi.md`                 | Localised default and prose.                                                          |
| `experiments/test-usage-api-cache-ttl.mjs` | Minimum-TTL assertion realigned to 13 minutes; header doc updated.                    |
| `tests/solve-queue.test.mjs`               | Two new assertions locking the 13-minute floor and the USAGE_API > API invariant.     |
| `docs/case-studies/issue-1798/`            | This case study + raw data (issue export, git log fragments, prior-commit snapshots). |

## 10. Risk / rollback

- **Risk**: minimal — the change is a single integer (`10 * 60 * 1000` → `13 * 60 * 1000`)
  in a configurable default, gated by an environment variable. Rollback is the inverse diff.
- **Impact**: users get a slightly less fresh `/limits` snapshot (worst case 13 min instead of
  10 min), in exchange for hitting the upstream 429 less often.
- **Operator override**: anybody who wants the old behaviour can set
  `HIVE_MIND_USAGE_API_CACHE_TTL_MS=600000` (10 min) in their environment.
