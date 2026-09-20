import assert from 'node:assert/strict';
import { matchGitNetworkCommand, wrapDollarWithGitRetry } from '../src/git-retry.lib.mjs';
import { describeTransientError, parseGitHubRequestId } from '../src/transient-errors.lib.mjs';

assert.equal(matchGitNetworkCommand('git push origin foo 2>&1'), 'push');
assert.equal(matchGitNetworkCommand('git -C /tmp/x fetch upstream'), 'fetch');
assert.equal(matchGitNetworkCommand('git commit -m x'), null);
assert.equal(matchGitNetworkCommand('git clone https://x'), null);
assert.equal(matchGitNetworkCommand('gh pr create'), null);

const d = describeTransientError({ message: 'GraphQL: Something went wrong while executing your query on 2026-08-21T19:28:14Z. Please include `811E:19A5B0:3A5AA9:37C97F:6A88A6CC` when reporting this issue.' });
assert.equal(d.transient, true);
assert.equal(d.category, 'github-server');
assert.equal(d.requestId, '811E:19A5B0:3A5AA9:37C97F:6A88A6CC');

// wrapper retries a transient git push then succeeds
let calls = 0;
const fakeDollar = (strings, ...values) => {
  if (strings && !Array.isArray(strings) && typeof strings === 'object') return fakeDollar;
  calls++;
  if (calls < 3) return Promise.resolve({ code: 128, stdout: '', stderr: 'fatal: unable to access https://github.com/: Recv failure: Connection reset by peer' });
  return Promise.resolve({ code: 0, stdout: 'ok', stderr: '' });
};
const $ = wrapDollarWithGitRetry(fakeDollar, { delay: 1 });
const res = await $({ cwd: '/tmp' })`git push origin main 2>&1`;
assert.equal(res.code, 0);
assert.equal(calls, 3);

// non-transient git failure is returned immediately
let calls2 = 0;
const fail = () => {
  calls2++;
  return Promise.resolve({ code: 1, stdout: '', stderr: '! [rejected] main -> main (non-fast-forward)' });
};
const $2 = wrapDollarWithGitRetry(fail, { delay: 1 });
const res2 = await $2`git push origin main`;
assert.equal(res2.code, 1);
assert.equal(calls2, 1);

// gh $ wrapper also handles git now
const { wrapDollarWithGhRetry } = await import('../src/github-rate-limit.lib.mjs');
let calls3 = 0;
const $3 = wrapDollarWithGhRetry(
  (s, ...v) => {
    calls3++;
    return Promise.resolve(calls3 < 2 ? { code: 128, stderr: 'RPC failed; curl 56 Recv failure: connection reset' } : { code: 0, stdout: 'ok' });
  },
  { delay: 1 }
);
const res3 = await $3`git fetch origin`;
assert.equal(res3.code, 0);
assert.equal(calls3, 2);

console.log('ALL SMOKE CHECKS PASSED');
