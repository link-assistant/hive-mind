// Issue #2900: compare what command-stream versions report for a failing
// `docker info --format` (CI rejected nothing where the local run did).
// Usage: node experiments/issue-2900-command-stream-versions.mjs [versions...]
import { getCommandStreamDollar } from '../src/start-command-cli.lib.mjs';
await getCommandStreamDollar(); // installs globalThis.use (use-m)
const versions = process.argv.slice(2).length ? process.argv.slice(2) : ['1.6.2', '2.0.0'];
for (const version of versions) {
  const { $ } = await globalThis.use(`command-stream@${version}`);
  let report;
  try {
    const r = await $({ mirror: false })`docker -H unix:///tmp/hive-mind-2900-nope.sock info --format ${'{{.LiveRestoreEnabled}} {{.ID}}'}`;
    report = { code: r.code, exitCode: r.exitCode, stdout: r.stdout?.toString() };
  } catch (error) {
    report = { threw: error.message, code: error.code, exitCode: error.exitCode };
  }
  console.log(version, JSON.stringify(report));
}
