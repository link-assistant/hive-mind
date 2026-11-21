// Issue #2801: feed start-command's own CPU penalty state machine (start#189,
// js/src/lib/cpu-penalty.js) a task whose base limit of 4 CPUs was applied with
// `docker update` after launch (how Hive Mind applies --container-cpu), on a
// 6-CPU daemon. start-command only knows launch-time `--cpus`, so baseCpus is null.
// Usage: node experiments/issue-2801-start-command-penalty-base.cjs /path/to/start-command/src/lib/cpu-penalty.js
const { evaluate, initialState, DEFAULTS } = require(process.argv[2]);
const run = (label, baseCpus, cores) => {
  let state = initialState(baseCpus, 0);
  let action = null;
  for (let t = 30000; t <= 20 * 60000 && !action; t += 30000) {
    ({ state, action } = evaluate(state, { now: t, cores, daemonCpus: 6, maxGapMs: 90000 }, DEFAULTS));
    if (action) console.log(`${label}: ${action.kind} ${action.cpus} CPUs after ${t / 60000} min (avg ${action.average.toFixed(2)} of capacity ${action.capacity})`);
  }
  if (!action) console.log(`${label}: no penalty after 20 min at ${cores} cores (capacity ${state.capacity}, trigger needs ${((DEFAULTS.trigger / 100) * state.capacity).toFixed(2)})`);
};
run('base 4 passed as `$ --cpus 4`     ', 4, 4);
run('base 4 applied by `docker update`', null, 4);
