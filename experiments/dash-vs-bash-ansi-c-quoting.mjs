#!/usr/bin/env node

/**
 * experiments/dash-vs-bash-ansi-c-quoting.mjs
 *
 * Reproduces the root cause of `hive-screens --close` failing on Debian/Ubuntu
 * hosts. See issue #1654 and the case study at
 * `docs/case-studies/issue-1654/README.md`.
 *
 * Background:
 *   Node's `child_process.exec` runs commands via `/bin/sh -c "<command>"`.
 *   On Debian/Ubuntu `/bin/sh` is dash. The pre-fix hive-screens code
 *   assumed it was bash and used bash ANSI-C quoting `$'exit\n'`. Dash does
 *   NOT understand `$'…'`, so the literal 7-byte string `$exit\n` was sent
 *   to `screen -X stuff` instead of "exit\\n", which is why sessions were
 *   listed but never closed.
 *
 * Usage:
 *   node experiments/dash-vs-bash-ansi-c-quoting.mjs
 *
 * Expected output on a dash-based /bin/sh (the regression host):
 *   dash payload bytes: $ e x i t \n \n
 *   bash payload bytes: e x i t \n \n
 *
 * If the lines are identical, your /bin/sh is bash and the bug would never
 * reproduce — try again on a Debian/Ubuntu host.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const dumpWith = async shellBin => {
  // Mirror exactly what the pre-fix hive-screens code did: let the shell
  // unquote `$'exit\n'` before `echo` sees it, then print the bytes that
  // actually reached `echo` as argv.
  const { stdout } = await exec(shellBin, ['-c', "printf '%s' $'exit\\n' | od -c | head -1"]).catch(err => ({ stdout: err.stdout || '' }));
  return stdout.trim();
};

const dashBin = '/bin/dash';
const bashBin = '/bin/bash';

console.log('dash payload bytes:', await dumpWith(dashBin));
console.log('bash payload bytes:', await dumpWith(bashBin));
console.log();
console.log('A dash payload starting with `$` means the ANSI-C quoting was not');
console.log('recognized. That is the exact regression hive-screens #1654 hit.');
