// Reproduces: wrapDollarWithGhRetry around the *real* command-stream `$` does
// not retry a transient `gh` failure, because `$` resolves { code: 1 } instead
// of rejecting, and ghWithRateLimitRetry only retries on a rejection.
//
// A fake `gh` on PATH prints GitHub's 502 text, exits 1, and counts its calls.
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (typeof globalThis.use === 'undefined') globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
const { $: raw } = await use('command-stream@2.4.0');
const mod = process.argv[2] || '../src/github-rate-limit.lib.mjs';
const { wrapDollarWithGhRetry } = await import(mod);

const dir = mkdtempSync(join(tmpdir(), 'fake-gh-'));
const counter = join(dir, 'count');
writeFileSync(join(dir, 'gh'), `#!/bin/sh\necho x >> "${counter}"\necho 'HTTP 502: Bad Gateway (https://api.github.com/graphql)' >&2\nexit 1\n`);
chmodSync(join(dir, 'gh'), 0o755);
process.env.PATH = `${dir}:${process.env.PATH}`;

const $ = wrapDollarWithGhRetry(raw, { transientDelay: 10, log: m => console.log('  log:', m) });
const result = await $({ mirror: false })`gh api repos/o/r`.catch(e => ({ threw: e.message }));
const calls = existsSync(counter) ? readFileSync(counter, 'utf8').trim().split('\n').length : 0;
console.log(JSON.stringify({ code: result.code, threw: result.threw, ghInvocations: calls }));
