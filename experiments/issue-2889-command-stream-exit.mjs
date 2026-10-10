// Does command-stream's `$` throw on a non-zero exit? (issue #2889 helpers rely on the answer)
/* global console */
import { getCommandStreamDollar } from '../src/start-command-cli.lib.mjs';
const $ = await getCommandStreamDollar();
try {
  const r = await $({ mirror: false })`docker inspect -f ${'{{.State.Status}}'} no-such-container-2889`;
  console.log('no throw; code =', r.code, 'stderr =', r.stderr?.toString().trim());
} catch (e) {
  console.log('threw; code =', e.code, 'message =', e.message);
}
