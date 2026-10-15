// Debug helper: why does the cross-repository check fail closed? (#3276)
import { checkIssueLinksBeforeMerge } from '../src/issue-link-verification.lib.mjs';
const json = value => ({ code: 0, stdout: JSON.stringify(value), stderr: '' });
const responses = {
  'repos/link-assistant/agent/pulls/326': { body: 'Fixes #322\nFixes #7\nFixes other/project#7', head: { sha: 'a'.repeat(40), ref: 'issue-322-x' }, base: { ref: 'main' } },
  'repos/link-assistant/agent/issues/322': { number: 322, body: '' },
  'repos/link-assistant/agent/issues/322/sub_issues': [[]],
};
const run = async args => (responses[args[1]] ? json(responses[args[1]]) : { code: 1, stderr: `unexpected ${args.join(' ')}` });
console.log(await checkIssueLinksBeforeMerge({ owner: 'link-assistant', repo: 'agent', prNumber: 326, issueNumber: 322, run, logger: async m => console.log('log:', m) }));
