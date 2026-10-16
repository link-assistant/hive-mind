// Issue #3282: trace one failing command-stream execution.
import { $ } from 'command-stream';
const r = await $({ mirror: false, stdin: '' })`node -e ${'process.stdout.write(JSON.stringify(process.argv.slice(1)))'} -- -p ${"it's"} --append-system-prompt ${"Use the 'file' command; a | b & c"}`;
console.log('STDOUT', r.stdout, 'STDERR', r.stderr);
