#!/usr/bin/env node
// Issue #2408: print the installed `$` version as Hive Mind's resume gate sees it.
import { getStartCommandVersion } from '../src/start-command-cli.lib.mjs';
import { startCommandResumeKeepsResourceLimits } from '../src/session-kill-resume.in-place.lib.mjs';

const version = await getStartCommandVersion({ verbose: true });
console.log(`version=${version} resumeKeepsResourceLimits=${startCommandResumeKeepsResourceLimits(version)}`);
process.exit(0);
