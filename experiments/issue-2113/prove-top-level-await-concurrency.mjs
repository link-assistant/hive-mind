#!/usr/bin/env node

/**
 * Issue #2113 premise check: do sibling modules with a top-level `await` really
 * run their awaited work concurrently?
 *
 * The root cause of #2113 depends on this. If Node evaluated the three sibling
 * modules below strictly one after another, 31 modules opening with
 * `const { $ } = await use('command-stream')` could never produce simultaneous
 * `npm install -g` calls and there would be no race to fix.
 *
 * Each sibling awaits a 50 ms task that records how many tasks are in flight.
 *
 *   node experiments/issue-2113/prove-top-level-await-concurrency.mjs
 *
 * Expected: peak concurrency 3 — all three start before any finishes.
 */

import process from 'node:process';

import { state } from './top-level-await-concurrency/tracker.mjs';
import './top-level-await-concurrency/a.mjs';
import './top-level-await-concurrency/b.mjs';
import './top-level-await-concurrency/c.mjs';

process.stdout.write(`order: ${state.order.join(', ')}\n`);
process.stdout.write(`peak concurrency: ${state.peak} of 3 sibling modules\n`);
process.stdout.write(state.peak > 1 ? 'concurrent — the race in #2113 is possible\n' : 'serial — the race in #2113 would be impossible\n');
process.exit(state.peak > 1 ? 0 : 1);
