#!/usr/bin/env node
// Finite, memory-bounded native process group; no provider or credentials.
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const child = spawn(process.execPath, ['--max-old-space-size=32', '-e', 'setTimeout(() => {}, 8000)'], { stdio: 'ignore' });
const pidFile = process.env.ROUTER_LIFETIME_PID_FILE;
// The watchers use filename existence to detect readiness.
fs.writeFileSync(`${pidFile}.tmp`, JSON.stringify({ parent: process.pid, child: child.pid }));
fs.renameSync(`${pidFile}.tmp`, pidFile);
process.stdin.resume();
setTimeout(() => {
  child.kill('SIGKILL');
  process.exit(0);
}, 8000);
