#!/usr/bin/env node
// Experiment for issue #2082: does command-stream's `$` throw on a non-zero exit code?
// If it does NOT, every `await $\`...\`` in scripts/helm-release.mjs silently swallows
// failures, making the surrounding try/catch decorative -> green CI on a broken release.
import { ensureUseM } from '../src/use-m-bootstrap.lib.mjs';
const use = await ensureUseM();
const { $ } = await use('command-stream');

let threw = false;
let result;
try {
  result = await $`git checkout definitely-not-a-branch-2082`;
} catch (e) {
  threw = true;
  console.log('THREW:', e.message);
}
console.log('threw          =', threw);
console.log('result.code    =', result?.code);
console.log('VERDICT:', threw ? 'throws -> try/catch works' : 'DOES NOT THROW -> failures are silently ignored');
