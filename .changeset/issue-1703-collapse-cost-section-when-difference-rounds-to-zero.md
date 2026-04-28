---
"@link-assistant/hive-mind": patch
---

Hide the cost-estimation breakdown when the public and Anthropic numbers agree to within display precision (issue #1703)

Both the live `displayCostComparison` console output and the
`buildCostInfoString` markdown rendered into PR/issue comments previously
collapsed to the short `💰 Cost: $X.XXXXXX` form only when the two values
matched **exactly** at six decimal places. Real-world calls regularly produce
underlying values that differ by ~`1e-7` and round to **adjacent** displays
(e.g. `$11.219694` vs `$11.219693`); the rendered difference (`$-0.000000
(-0.00%)`) was therefore noise yet still printed three full lines. The guard
now triggers whenever `|public − anthropic|.toFixed(6) === '0.000000'`, which
preserves the existing behaviour at every meaningful (≥ `$0.000001`) delta and
adds short-form output for the boundary case from issue #1703. Regression
tests live in `tests/test-build-cost-info-string.mjs` and
`tests/test-display-cost-comparison.mjs`.
