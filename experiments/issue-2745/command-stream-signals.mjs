// Finite signal-only probe: each shell immediately kills itself; no stress or descendants.
import { ensureUseM } from '../../src/use-m-bootstrap.lib.mjs';
await ensureUseM();
const { $ } = await use('command-stream');

for (const command of ['kill -TERM $$', 'kill -KILL $$', 'exit 3']) {
  const runner = $({ mirror: false, capture: true, stdin: 'ignore' })`sh -c ${command}`;
  const exits = [];
  for await (const chunk of runner.stream()) if (chunk.type === 'exit') exits.push(chunk);
  const result = await runner;
  console.log(JSON.stringify({ command, exits, resultCode: result.code, runnerSignal: runner.child?.signalCode ?? null }));
}
