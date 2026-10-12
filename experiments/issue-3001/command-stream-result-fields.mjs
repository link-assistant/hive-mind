#!/usr/bin/env node
// Issue #3001: which fields does a resolved command-stream result carry?
// src/solve.results.lib.mjs checked `result.exitCode`, which is not one of them.
import { getCommandStreamDollar } from '../../src/start-command-cli.lib.mjs';

const $ = await getCommandStreamDollar();
for (const cmd of ['true', 'false']) {
  const r = await $({ mirror: false })`sh -c ${cmd}`;
  console.log(`${cmd}: keys=${Object.keys(r).join(',')} code=${r.code} exitCode=${r.exitCode}`);
}
