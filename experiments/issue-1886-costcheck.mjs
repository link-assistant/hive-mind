import { calculateModelCost } from '../src/claude.cost.lib.mjs';
import { seedCumulativeAnthropicCost, addAnthropicRunCost, getCumulativeAnthropicCost, resetCumulativeAnthropicCost } from '../src/anthropic-cost-accumulator.lib.mjs';

// Fable 5 pricing per million
const fable = { cost: { input: 10, cache_write: 12.5, cache_read: 1, output: 50 } };

// result-event modelUsage (per-process, run2 only) from gist
const resultScope = { inputTokens: 31490, cacheCreationTokens: 341700, cacheReadTokens: 13211220, outputTokens: 137297 };
// full session JSONL totals from gist Token Usage Summary
const fullScope = { inputTokens: 45265, cacheCreationTokens: 791087, cacheReadTokens: 16444028, outputTokens: 185995 };

const resultCost = calculateModelCost(resultScope, fable);
const fullCost = calculateModelCost(fullScope, fable);
console.log('result-event scope cost (should ~= 24.662220):', resultCost.toFixed(6));
console.log('full-session scope cost (should ~= 36.085016):', fullCost.toFixed(6));
console.log('reported difference -31.66% reproduced:', (((resultCost - fullCost) / fullCost) * 100).toFixed(2) + '%');

// Now simulate accumulation across the limit-reset resume.
// run1 hit the usage limit → ended as is_error → NO success result event. Its
// cost is captured from the non-success terminal result (the `successCost ??
// nonSuccessResultCost` fallback added for issue #1886) and folded on the
// failure path, then carried into run2 via --previous-anthropic-cost.
const run1Cost = fullCost - resultCost; // run1's cost, reported on its non-success result
resetCumulativeAnthropicCost();
seedCumulativeAnthropicCost(0);
const successCostRun1 = null; // limit hit → no success cost
const run1Folded = addAnthropicRunCost(successCostRun1 ?? run1Cost); // fallback used
console.log('run1 folded from non-success fallback (should ~= 11.42):', run1Folded.toFixed(6));

// run2 resumed, seeded with run1 carried forward via --previous-anthropic-cost:
resetCumulativeAnthropicCost();
seedCumulativeAnthropicCost(run1Folded);
const cumulative = addAnthropicRunCost(resultCost); // run2's own success cost
console.log('cumulative anthropic after resume:', cumulative.toFixed(6), '-> matches full estimate:', cumulative.toFixed(6) === fullCost.toFixed(6));
