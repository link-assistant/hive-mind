#!/usr/bin/env node
// Offline solver: records that genuine work started; no GitHub mutations or AI calls.
console.log('FIXTURE_SOLVER_STARTED', process.argv[2]);
process.exit(process.env.HIVE_FIXTURE_SCENARIO === 'worker-error' ? 1 : 0);
