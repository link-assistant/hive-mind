#!/usr/bin/env node

/**
 * Issue #2130: does `command-stream`'s `cwd` option keep `PWD` in sync?
 *
 * OpenCode-derived CLIs (`opencode`, `agent`) resolve the project root from
 * `process.env.PWD`, not from their own `process.cwd()`. If `PWD` is inherited
 * from the `solve` process, the tool works on the operator's shell directory
 * instead of the repository clone.
 *
 * Usage: node experiments/issue-2130/probe-pwd.mjs [cwd]
 */

import { ensureUseM } from '../../src/use-m-bootstrap.lib.mjs';

const use = await ensureUseM();
const { $ } = await use('command-stream');

const cwd = process.argv[2] || new URL('.', import.meta.url).pathname;
const script = 'console.log(`PWD=${process.env.PWD} cwd=${process.cwd()}`)';

console.log(`spawn cwd:  ${cwd}`);
console.log(`parent PWD: ${process.env.PWD}`);

const simple = await $({ cwd, mirror: false, env: { ...process.env } })`node -e ${script}`;
console.log(`simple:     ${simple.stdout.toString().trim()}`);

const piped = await $({ cwd, mirror: false, env: { ...process.env } })`echo x | node -e ${script}`;
console.log(`piped:      ${piped.stdout.toString().trim()}`);
