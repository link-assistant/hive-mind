#!/usr/bin/env node
/**
 * Issue #2160: does command-stream's `$` template interpolate an Array into separate,
 * individually quoted argv entries? The auto-cleanup path in src/lib.mjs needs to know
 * before it can pass an explicit list of paths to `sudo rm -rf` instead of the previous
 * `sudo rm -rf /tmp/* /var/tmp/*` glob.
 *
 * `printf [%s]` is used instead of `echo` on purpose: it makes argv boundaries visible, and
 * unlike `echo` it is a real binary rather than a command-stream builtin, so it shows what an
 * external command such as `rm` actually receives.
 *
 * Observed with command-stream (2026-08-17, Node v20.20.2):
 *
 *     one path containing a space  -> [/tmp/a b]            (stays a single argument)
 *     array of two paths           -> [/tmp/x y][/tmp/z]    (two separate arguments)
 *     path containing a quote      -> [/tmp/q'x]            (passed through verbatim)
 *
 * Conclusion: `$`sudo rm -rf ${paths}`` is safe — each element becomes its own argv entry and
 * no word splitting happens inside an element.
 */
import { ensureUseM } from '../src/use-m-bootstrap.lib.mjs';
await ensureUseM();
const { $ } = await use('command-stream');

const show = async (label, result) => console.log(`${label.padEnd(30)} -> ${((result.stdout ?? '').toString() || '(no output)').trim()}`);

await show('one path with a space', await $`printf [%s] ${'/tmp/a b'}`);
await show('array of two paths', await $`printf [%s] ${['/tmp/x y', '/tmp/z']}`);
await show('path with a single quote', await $`printf [%s] ${"/tmp/q'x"}`);
