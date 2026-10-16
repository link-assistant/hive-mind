#!/usr/bin/env node
/* global process */
/**
 * A `gh` executable over the fake GitHub in fake-github.mjs (issue #3357), for
 * code that spawns `gh` itself (mergePullRequest). The state lives in the JSON
 * file FAKE_GH_STATE; every call is appended to its `log`. A lock directory
 * serializes concurrent calls.
 */
import { mkdirSync, readFileSync, rmdirSync, writeFileSync } from 'node:fs';
import { createFakeGitHub } from './fake-github.mjs';

const path = process.env.FAKE_GH_STATE;
const lock = `${path}.lock`;
const pause = new Int32Array(new SharedArrayBuffer(4));
for (let attempt = 0; ; attempt++) {
  try {
    mkdirSync(lock);
    break;
  } catch (error) {
    if (error.code !== 'EEXIST' || attempt > 2000) throw error;
    Atomics.wait(pause, 0, 0, 5);
  }
}
let result;
try {
  const state = JSON.parse(readFileSync(path, 'utf8'));
  state.log ||= [];
  state.log.push(process.argv.slice(2));
  result = await createFakeGitHub(state).run(process.argv.slice(2));
  writeFileSync(path, JSON.stringify(state));
} finally {
  rmdirSync(lock);
}
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
process.exitCode = result.code ?? 0;
