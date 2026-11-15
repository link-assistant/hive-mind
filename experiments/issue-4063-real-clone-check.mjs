#!/usr/bin/env node
// Issue #4063: run the after-clone handling (the same call solve makes) against a real repository clone.
// Usage: node experiments/issue-4063-real-clone-check.mjs <clone-dir> [warn-ai|warn-user|warn-ai-and-user|ignore|fail]
import { execFileSync } from 'node:child_process';
import { handleUncommittedChangesAfterClone } from '../src/clone-status.lib.mjs';

const [cwd, mode] = process.argv.slice(2);
if (!cwd) throw new Error('usage: issue-4063-real-clone-check.mjs <clone-dir> [mode]');
const status = () => execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' });
const log = async (message, options = {}) => console.log(`${options.verbose ? '[VERBOSE] ' : ''}${message}`);
const statusOutput = status().trimEnd();
console.log(`git status --porcelain before: ${JSON.stringify(statusOutput)}`);
const result = await handleUncommittedChangesAfterClone({ cwd, argv: { uncommittedChangesAfterClone: mode }, log, statusOutput });
console.log(JSON.stringify({ mode: result.mode, neutralized: result.neutralized, changes: result.changes, remaining: result.remaining, statusAfter: status() }, null, 2));
console.log('----- AI user prompt lines -----');
console.log(result.promptLines.join('\n'));
