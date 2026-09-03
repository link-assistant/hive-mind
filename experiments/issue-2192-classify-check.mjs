#!/usr/bin/env node
// Issue #2192: quick smoke check that the anonymous-download-limit message is
// classified as its own retryable category instead of "Unknown error".
import { classifyCloneError } from '../src/solve.repository.lib.mjs';
import { describeTransientError } from '../src/transient-errors.lib.mjs';

const message = 'fatal: remote error: GitHub is temporarily limiting some unauthenticated downloads to protect the stability of the platform. Please retry later or authenticate.';
console.log(classifyCloneError(message));
console.log(describeTransientError(new Error(message)));
console.log(classifyCloneError('fatal: repository not found'));
console.log(classifyCloneError('remote: error: 503'));
