// Issue #2293: what failOnRepeatedCiFailure does against a fake `gh`/`git`.
import { failOnRepeatedCiFailure, getNoProgressFailure, resetNoProgressFailure } from '../../src/session-progress.lib.mjs';
const calls = [];
const $ = options => {
  const run = async (strings, ...values) => {
    const text = strings.reduce((out, part, i) => out + part + (i < values.length ? values[i] : ''), '');
    calls.push(text.replace(/\s+/g, ' ').slice(0, 160));
    if (/pr view .*isDraft|isDraft/.test(text)) return { code: 0, stdout: 'true', stderr: '' };
    if (/comments/.test(text) && /api/.test(text)) return { code: 0, stdout: '[]', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  return typeof options === 'object' && !Array.isArray(options) ? run : run(options, ...[].slice.call(arguments, 1));
};
const logs = [];
resetNoProgressFailure();
const stop = await failOnRepeatedCiFailure({ owner: 'o', repo: 'r', prNumber: 196, tempDir: '/nonexistent-2293', branchName: 'b', $, log: async line => logs.push(line), evidence: ['Failing check: Full Requirements Aggregate — https://x/run/1'], occurrences: 3, mode: 'auto-restart-until-mergeable', remainingIterations: 2 });
console.log(stop, getNoProgressFailure());
console.log(logs.join('\n'));
console.log(calls.join('\n'));
