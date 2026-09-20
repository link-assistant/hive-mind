#!/usr/bin/env node

/**
 * examples/hive-screens-close-regression.mjs
 *
 * Demonstrates the fix for issue #1654: `hive-screens --close` now spawns
 * `screen` directly with the newline embedded in an argv element, instead
 * of shelling out and relying on bash ANSI-C quoting.
 *
 * This example does not need a running GNU screen server — it injects a
 * fake `spawn` so you can see what arguments reach `screen` after the fix.
 *
 * Usage:
 *   node examples/hive-screens-close-regression.mjs
 */

import { closeScreenSession } from '../src/hive-screens.lib.mjs';

const calls = [];
const fakeSpawn = (cmd, args) => {
  calls.push({ cmd, args });
  const handlers = {};
  return {
    on(event, cb) {
      handlers[event] = cb;
      if (event === 'exit') setTimeout(() => cb(0), 0);
      return this;
    },
  };
};

await closeScreenSession('1619129.solve-demo', { spawn: fakeSpawn });

console.log('Command spawned:', calls[0].cmd);
console.log('Arguments      :', JSON.stringify(calls[0].args));
console.log();
console.log('Key point: the newline is a literal argv character, so no');
console.log('shell (bash/dash/zsh) gets a chance to mis-parse it.');
console.log();
console.log("Before the fix (broken on dash): screen -S 1619129.solve-demo -X stuff $'exit\\\\n'");
console.log('After  the fix (works on any sh):', ['screen', ...calls[0].args].join(' '));
