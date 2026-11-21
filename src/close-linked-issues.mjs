#!/usr/bin/env node

/**
 * `close-linked-issues` — close the issues merged pull requests intend to
 * close that are still open (issue #3356). See close-linked-issues.lib.mjs.
 */

import { runCloseLinkedIssues } from './close-linked-issues.lib.mjs';
import { setupStdioLogInterceptor } from './lib.mjs';

setupStdioLogInterceptor();

const exitCode = await runCloseLinkedIssues(process.argv.slice(2));
process.exit(exitCode);
