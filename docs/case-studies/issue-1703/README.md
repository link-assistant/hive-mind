# Case Study: Issue #1703 — Cost section shows meaningless `$-0.000000` difference

## Summary

When the public-pricing estimate and the Anthropic-calculated cost happen to
round to **adjacent** six-decimal values (for example `$11.219694` vs
`$11.219693`), the cost section in both the live terminal output
(`displayCostComparison`) and the GitHub PR comment (`buildCostInfoString`)
would still print the full three-line breakdown:

```
💰 Cost estimation:
   Public pricing estimate: $11.219694
   Calculated by Anthropic: $11.219693
   Difference:              $-0.000000 (-0.00%)
```

That last line carries **no meaningful information** — the two values agree to
within display precision and the difference, after rounding, is literally zero.
Issue #1703 asks for the short single-line form (`Cost: $X.XXXXXX`) in this
case, identical to what Issue #1557 already shipped for _exactly_ matching
costs.

## Reproducible Example

Underlying decimal values that differ by ~`1e-7` produce two different
`toFixed(6)` strings yet a `$0.000000` rounded difference:

```js
import Decimal from 'decimal.js-light';

const publicCost = new Decimal('11.21969355'); // → "11.219694" at toFixed(6)
const anthropicCost = new Decimal('11.21969345'); // → "11.219693" at toFixed(6)

publicCost.toFixed(6) === anthropicCost.toFixed(6); // false  ← old guard misses
anthropicCost.minus(publicCost).abs().toFixed(6); // "0.000000"  ← new guard
```

The original log that triggered this issue is preserved at
`raw-data/solution-draft-log-pr-1777377011084.txt` (lines around the
`💰 Cost estimation` block).

## Timeline / Sequence of Events

1. **2025 — Issue #871**: First call to add a public-pricing estimate next to
   Anthropic's authoritative cost number. Established the two-line "Public" /
   "Calculated by Anthropic" / "Difference" format.
2. **2026-04 — Issue #1557 / commit `06e8af8b`** (`feat: simplified cost
display when public and Anthropic costs match`): introduced the early-return
   short form `### 💰 Cost: **$X.XXXXXX**` whenever
   `publicDec.toFixed(6) === anthropicDec.toFixed(6)`.
3. **2026-04-28 — Issue #1703** (this case): the sister observation that the
   short form _also_ applies whenever the **difference** rounds to zero at six
   decimals, even if the two values themselves do not. Source comment:
   <https://github.com/comerc/monitor43/pull/2#issuecomment-4334940598>.
   Source log gist:
   <https://gist.githubusercontent.com/konard/bc3b62b6d5c02f5683517edb59674e4d/raw/033cd9dbe00e87d396bbabd20eaf7d41b13bc808/solution-draft-log-pr-1777377011084.txt>.

## Requirements (extracted from the issue)

| #   | Requirement                                                                                                       | Source                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1   | When the difference is small (rounds to `$0.000000`), show short `Cost: $X.XXXXXX` instead of the full breakdown. | "We should have been shown short `Cost: $11.219694` in such case the difference is small." |
| 2   | The detailed `Difference: $-0.000000 (-0.00%)` line is noise and should be hidden when negligible.                | "Also the difference is too small to show detailed section about the cost."                |
| 3   | Double check for any other potential cost calculation issues in the same code path.                               | "Double check for any potential cost calculation issues."                                  |
| 4   | Apply the same treatment to **both** the live terminal output and the markdown comment.                           | The example log is from terminal output; #1557 modified both surfaces in lockstep.         |
| 5   | Compile related logs/data into `./docs/case-studies/issue-1703` for later analysis.                               | "Make sure we compile that data to ./docs/case-studies/issue-{id} folder."                 |

## Root Cause

`src/github-cost-info.lib.mjs:33` and `src/claude.budget-stats.lib.mjs:132`
both used the same too-strict guard:

```js
publicDec.toFixed(6) === anthropicDec.toFixed(6);
```

This compares the **rounded display strings** of the two values. Two values
that differ by `5e-7..1e-6` can round to **adjacent** six-decimal strings
(`11.219693` vs `11.219694`) while their actual difference rounds to
`0.000000`. The guard therefore misses the very case it most needs to catch:
the cost calculations agree, but the rounded displays happened to land on
opposite sides of the rounding boundary.

There is no broader cost-calculation bug — the underlying Decimal arithmetic is
correct. The issue is purely a presentation / display-precision threshold.

## Fix

Replace the equality-of-rounded-display check with a check that the **rounded
absolute difference** is below the displayed precision. When it is, fall
through to the existing short-form output and use the Anthropic value (the
authoritative number we already preferred in the short form):

```diff
- if (publicDec && anthropicDec && publicDec.toFixed(6) === anthropicDec.toFixed(6))
-   return `\n\n### 💰 Cost: **$${anthropicDec.toFixed(6)}**`;
+ if (publicDec && anthropicDec && anthropicDec.minus(publicDec).abs().toFixed(6) === '0.000000')
+   return `\n\n### 💰 Cost: **$${anthropicDec.toFixed(6)}**`;
```

The exact same diff is applied to `displayCostComparison` so terminal output
and GitHub markdown stay in lockstep (this is the same dual-surface invariant
that Issue #1557 introduced).

### Why the new threshold is correct

- The full breakdown only ever displays values to six decimal places.
- If `|public − anthropic|` rounds to `$0.000000`, every individual line in the
  full breakdown — including the `Difference` line — would be the same value
  the short form already prints. Showing them adds zero information.
- The earliest point the breakdown adds information is at a true `$0.000001`
  difference, where `abs.toFixed(6)` becomes `'0.000001'`. The new guard
  preserves that boundary exactly (covered by the
  `still shows full format when difference is exactly $0.000001` regression
  test).

## Affected Files

| File                                     | Function                | Role                                                            |
| ---------------------------------------- | ----------------------- | --------------------------------------------------------------- |
| `src/github-cost-info.lib.mjs`           | `buildCostInfoString`   | Markdown rendered into PR / issue comments.                     |
| `src/claude.budget-stats.lib.mjs`        | `displayCostComparison` | Live terminal output during a solve session.                    |
| `tests/test-build-cost-info-string.mjs`  | unit tests              | Three new cases covering Issue #1703 + the boundary regression. |
| `tests/test-display-cost-comparison.mjs` | unit tests (new file)   | Mirror coverage for the terminal renderer.                      |

## Verification

```sh
node tests/test-build-cost-info-string.mjs   # 55 / 55 PASSED (was 52 / 52)
node tests/test-display-cost-comparison.mjs  # 4  / 4  PASSED (new file)
```

Both pre-existing Issue #1557 tests (`shows simplified format when public and
Anthropic costs match exactly` and `shows full format when costs differ
slightly`) continue to pass without modification.

## Existing Components Reused

- **`decimal.js-light`** — already a dependency; provides `Decimal#minus`,
  `Decimal#abs`, and `Decimal#toFixed(n)`. No new library needed.
- **Existing short-form template** introduced by Issue #1557 — reused as-is for
  Issue #1703, so the visual output is identical to what users already expect.

## Related Issues

- #871 — original "Public pricing estimate" feature
- #1015 — empty-when-unknown handling for the cost section
- #1250 — OpenCode Zen / base-model pricing
- #1557 — first introduction of the simplified format when costs match exactly
- #1600 — Decimal-precision rendering for cost display
- #1703 — _this case study_
