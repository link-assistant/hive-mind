/* global console, process */
for (const f of ['session-kill-diagnostics.lib.mjs', 'solve-progress.lib.mjs', 'solve.watch-progress.lib.mjs', 'log-upload.lib.mjs', 'github.lib.mjs', 'log-upload-failure.lib.mjs', 'session-monitor.lib.mjs', 'solve.auto-merge-stuck-ci.lib.mjs', 'solve.interrupt.lib.mjs', 'session-kill-recovery.lib.mjs', 'solve.auto-merge.lib.mjs']) {
  try {
    await import(`../src/${f}`);
    console.log('ok', f);
  } catch (e) {
    console.error('FAIL', f, e.message);
  }
}
process.exit(0);
