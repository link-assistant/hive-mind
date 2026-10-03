// Finite command-stream cancellation probe: no host stress and no GitHub writes.
import { $ } from 'command-stream';
import { setTimeout as sleep } from 'node:timers/promises';
const runner = $({ mirror: false })`sh -c 'echo started; sleep 5'`;
let child;
for await (const chunk of runner.stream()) {
  if (chunk.type === 'stdout' && String(chunk.data).includes('started')) {
    child = runner.child;
    runner.kill('SIGTERM');
  }
}
const observations = [];
for (const delay of [0, 50, 500]) {
  await sleep(delay);
  let exists = true;
  try {
    process.kill(child.pid, 0);
  } catch (error) {
    if (error.code === 'ESRCH') exists = false;
    else throw error;
  }
  observations.push({ delay, exists, activeHandle: process._getActiveHandles().includes(child), exitCode: child.exitCode, signalCode: child.signalCode, killed: child.killed });
}
console.log(JSON.stringify(observations));
