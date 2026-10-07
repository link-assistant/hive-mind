#!/usr/bin/env node
// Stub solver for the issue #2615 end-to-end check: record the issue and finish.
import { appendFileSync } from 'node:fs';
appendFileSync(new URL('./started.txt', import.meta.url), `${new Date().toISOString()} ${process.argv[2]}\n`);
setTimeout(() => process.exit(0), 1500);
