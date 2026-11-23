## Summary

The test `lookbehinds stay linear in the JavaScriptCore interpreter (#128) > grows about fourfold, not sixteenfold, for a four times longer tab run` (`tests/sanitizer-issue-128-evidence.test.js`, around line 347) failed on `main` at b8787227d, so the pipeline did not release. That release would ship the #177 fix; npm `latest` is still 0.22.3.

- Run: https://github.com/link-foundation/sensitive-data-sanitizer/actions/runs/43406123201
- Job: `Test runtimes (macos-26-intel, bun, 3/6)` (job 131821226566)

```
error: Expected 7.208836240399472 to be less than 7
      at <anonymous> (tests/sanitizer-issue-128-evidence.test.js:356:23)
(fail) lookbehinds stay linear in the JavaScriptCore interpreter (#128) > grows about fourfold, not sixteenfold, for a four times longer tab run [5972.82ms]
```

All other jobs passed, including the 60 000-tab tests in the same file on the same runner.

## Why it is flaky

The test divides two single wall-clock samples, `time(prefix + 16000 tabs) / time(prefix + 4000 tabs)`, and requires the ratio to be below 7. That is one sample per size with no warm-up. The comment above the test gives the expected values: 3–4× after the rewrite and 11–13× before it.

The shared macOS Intel runners are the slowest and noisiest in the matrix. A pause during the long run, or a short run that happens to be fast, is enough to push the ratio from about 4 to over 7. The upper bound sits between the two expected values and has room for only about 1.8× of noise.

## Reproduction

The failure is timing-dependent and I have not reproduced it locally. The evidence is the CI log above: one job measured 7.21 while the same code passed in all other matrix jobs. To check it, rerun `bun test tests/sanitizer-issue-128-evidence.test.js` many times on a loaded macOS Intel machine, or under parallel CPU load, and record the ratios.

## Workaround

Rerun the failed job: `gh run rerun 43406123201 --failed --repo link-foundation/sensitive-data-sanitizer`. Consumers can keep local exemptions until a release ships. link-assistant/hive-mind does this for #177 and #181.

## Suggested fix

Make the measurement robust rather than raising the bound blindly:

1. Warm up once, then take the **median** of 5 samples per size and divide the medians.
2. Compare against the midpoint between linear (4×) and quadratic (16×) growth, which is 8×. Or use a 4 000 → 32 000 run (8× longer: about 8× linear vs about 64× quadratic) with a bound of 20×, which separates the two cases by a much wider margin.
3. Optionally, retry a measurement once before failing, as the sibling test does by comparing against a baseline.

```js
const median = (values) => values.sort((a, b) => a - b)[values.length >> 1];
const sample = (text) => { time(text); return median(Array.from({ length: 5 }, () => time(text))); };
ratios[prefix] = sample(prefix + '\\t'.repeat(32000) + 'x') / sample(prefix + '\\t'.repeat(4000) + 'x');
// expect(ratio).toBeLessThan(20)  // about 8× when linear, about 64× when quadratic
```

Found while working on link-assistant/hive-mind#4055, which is waiting for the #177 fix to be released.
