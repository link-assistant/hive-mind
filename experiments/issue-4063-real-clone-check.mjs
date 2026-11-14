#!/usr/bin/env node
// Issue #4063: run the clone-status handling against a real repository clone.
// Usage: node experiments/issue-4063-real-clone-check.mjs <clone-dir>
import { resolveCheckoutArtifacts } from '../src/checkout-normalization.lib.mjs';
const cwd = process.argv[2];
if (!cwd) throw new Error('usage: issue-4063-real-clone-check.mjs <clone-dir>');
const log = async (message, options = {}) => console.log(`${options.verbose ? '[VERBOSE] ' : ''}${message}`);
const result = await resolveCheckoutArtifacts({ cwd, log });
console.log(JSON.stringify({ clean: result.clean, neutralized: result.neutralized, changes: result.changes }, null, 2));
