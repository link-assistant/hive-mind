// Issue #2900: an unreachable daemon makes `docker info --format` print the
// zero-value template ("false ") and exit 1 — it must not read as "disabled".
import { getCommandStreamDollar } from '../src/start-command-cli.lib.mjs';
const $ = await getCommandStreamDollar();
try {
  const r = await $({ mirror: false })`docker -H unix:///tmp/hive-mind-2900-nope.sock info --format ${'{{.LiveRestoreEnabled}} {{.ID}}'}`;
  console.log('no throw', { code: r.code, stdout: r.stdout?.toString(), stderr: r.stderr?.toString().slice(0, 80) });
} catch (e) {
  console.log('threw', e.message);
}
