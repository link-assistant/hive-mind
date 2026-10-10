#!/usr/bin/env node
// Probe the live-restore preflight against the real local Docker daemon(s).
// Usage: node experiments/issue-2900-live-restore-probe.mjs [--verbose]
import { checkDockerLiveRestore, preflightDockerIsolation } from '../src/isolation-runner.lib.mjs';

const verbose = process.argv.includes('--verbose');
console.log('default daemon:', await checkDockerLiveRestore(verbose));
const result = await preflightDockerIsolation({ verbose });
console.log(JSON.stringify({ liveRestore: result.liveRestore, liveRestoreOk: result.liveRestoreOk, warnings: result.warnings.length }, null, 2));
