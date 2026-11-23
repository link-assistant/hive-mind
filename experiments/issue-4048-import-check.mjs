const m = await import('../src/github-merge-repo-actions.lib.mjs');
console.log(Object.keys(m));
const g = await import('../src/github-merge.lib.mjs');
console.log(typeof g.cancelWorkflowRun, typeof g.default.cancelWorkflowRun);
