// Send exactly one synthetic 16 MiB part to GitHub with an intentionally
// incorrect expectedHeadOid. The expected validation error proves that GitHub
// accepted the payload through validation without writing the file.
import { Buffer } from 'node:buffer';
import { execFile, spawn } from 'node:child_process';
import { argv, env, stdout } from 'node:process';
import { promisify } from 'node:util';
import { BRANCH_LOG_MAX_PART_BYTES } from '../../src/log-upload-branch.lib.mjs';

const [repositoryNameWithOwner, branchName] = argv.slice(2);
if (!/^[\w.-]+\/[\w.-]+$/.test(repositoryNameWithOwner || '') || !branchName) {
  throw new Error('Usage: node experiments/issue-4046/verify-github-request-size.mjs OWNER/REPO BRANCH');
}
const expectedHeadOid = '0'.repeat(40);
const ref = branchName.split('/').map(encodeURIComponent).join('/');
const { stdout: head } = await promisify(execFile)('gh', ['api', `repos/${repositoryNameWithOwner}/git/ref/heads/${ref}`, '--jq', '.object.sha']);
if (!/^[a-f\d]{40}$/.test(head.trim()) || head.trim() === expectedHeadOid) throw new Error('Could not verify a different branch head');

const payload = JSON.stringify({
  query: 'mutation ($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid } } }',
  variables: {
    input: {
      branch: { repositoryNameWithOwner, branchName },
      expectedHeadOid,
      message: { headline: 'Verify stale log-attachment request' },
      fileChanges: { additions: [{ path: 'stale-upload-probe.log', contents: Buffer.alloc(BRANCH_LOG_MAX_PART_BYTES, 'x').toString('base64') }] },
    },
  },
});
const child = spawn('gh', ['api', 'graphql', '--input', '-', '--jq', '.data.createCommitOnBranch.commit.oid'], {
  env: { ...env, GOMEMLIMIT: '160MiB' },
  stdio: ['pipe', 'ignore', 'pipe'],
});
let stderr = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', text => {
  stderr = (stderr + text).slice(-2048);
});
const exitCode = await new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('close', resolve);
  child.stdin.on('error', reject);
  child.stdin.end(payload);
});
if (!exitCode || !/No commit exists with specified expectedHeadOid/i.test(stderr)) throw new Error(`Expected a head validation error. GitHub reported: ${stderr.trim()}`);
stdout.write(`${stderr.trim()}\n`);
