// Issue #3552: does `$\`cmd\`.run({ capture: true })` reject on a non-zero exit, and
// does `$({ capture: true })\`cmd\`` behave the same? (scripts switch to the latter
// so their `$` can be wrapped with the GitHub retry loop.)
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const { $ } = await import(pathToFileURL(join(process.cwd(), 'node_modules/command-stream/src/$.mjs')).href);
for (const [name, run] of [
  ['.run({capture})', () => $`sh -c 'echo out; echo err >&2; exit 3'`.run({ capture: true, mirror: false })],
  ['$({capture})', () => $({ capture: true, mirror: false })`sh -c 'echo out; echo err >&2; exit 3'`],
]) {
  try {
    const r = await run();
    console.log(name, 'resolved', { code: r.code, stdout: r.stdout, stderr: r.stderr });
  } catch (e) {
    console.log(name, 'rejected', e.message);
  }
}
