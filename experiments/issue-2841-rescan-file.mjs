#!/usr/bin/env node
// Issue #2841: run the development-log publication rescan on arbitrary files.
// Usage: node experiments/issue-2841-rescan-file.mjs <file>...
import { findResidualCredentialBlock } from '../src/log-sanitize-stream.lib.mjs';
for (const file of process.argv.slice(2)) {
  console.log(file, JSON.stringify(await findResidualCredentialBlock(file)));
}
