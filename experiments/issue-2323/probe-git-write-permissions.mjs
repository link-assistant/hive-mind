/** Read-only smart HTTP authorization probe; never sends a push or creates a ref. */
import { execFileSync } from 'node:child_process';
import { probeGitWriteAccess } from '../../src/github-write-permission.lib.mjs';

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
for (const repository of ['link-assistant/hive-mind', 'octocat/Hello-World']) {
  const [owner, repo] = repository.split('/');
  console.log(JSON.stringify({ repository, writeAccess: await probeGitWriteAccess({ owner, repo, token }) }));
}
