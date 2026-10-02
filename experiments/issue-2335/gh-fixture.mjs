#!/usr/bin/env node
/** Finite fake gh executable for testing the actual merge boundary. */
import { appendFileSync, readFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.ISSUE_2335_GH_CALLS, `${JSON.stringify(args)}\n`);
const responses = JSON.parse(readFileSync(process.env.ISSUE_2335_GH_FIXTURE, 'utf8'));
if (args[0] === 'pr' && args[1] === 'merge') {
  console.log('fixture merge');
} else if (args[0] === 'api' && Object.hasOwn(responses, args[1])) {
  console.log(JSON.stringify(responses[args[1]]));
} else {
  console.error(`Unexpected fixture gh command: ${args.join(' ')}`);
  process.exitCode = 1;
}
