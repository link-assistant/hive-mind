// Issue #2072: verify the github-merge <-> github-merge-ci-wait import cycle resolves.
const m = await import('../src/github-merge.lib.mjs');
const w = await import('../src/github-merge-ci-wait.lib.mjs');
const q = await import('../src/telegram-merge-queue.lib.mjs');
console.log('named waitForCI:', typeof m.waitForCI);
console.log('named waitForBranchCI:', typeof m.waitForBranchCI);
console.log('default.waitForCI:', typeof m.default.waitForCI);
console.log('default.waitForBranchCI:', typeof m.default.waitForBranchCI);
console.log('wait module waitForCI:', typeof w.waitForCI);
console.log('MergeQueueProcessor:', typeof q.MergeQueueProcessor);
