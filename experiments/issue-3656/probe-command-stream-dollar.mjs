import { ensureUseM } from '../../src/use-m-bootstrap.lib.mjs';
const use = await ensureUseM();
const { $ } = await use('command-stream');
const a = $({ cwd: '/tmp', mirror: false, capture: true });
console.log(typeof a, a?.constructor?.name);
const b = $({ cwd: '/tmp' });
console.log(typeof b, b?.constructor?.name);
