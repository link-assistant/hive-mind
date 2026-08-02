#!/usr/bin/env node
// Issue #2130: does `formal-ai with <tool>` forward stdin when the passthrough
// arguments contain a workspace-effect keyword (create/write/implement)?
import { spawn } from 'node:child_process';
const [tool, ...extra] = process.argv.slice(2);
const child = spawn('formal-ai', ['with', tool, ...extra], { stdio: ['pipe', 'pipe', 'pipe'] });
child.stdout.resume();
child.stderr.resume();
child.stdin.end('PROMPT-BODY-19-BYTES');
child.on('exit', code => console.log(`${tool} exit=${code} extra=${JSON.stringify(extra)}`));
