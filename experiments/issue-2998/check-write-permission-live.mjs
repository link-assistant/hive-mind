// Live: what the CLI prints for a repository the account cannot see (404) and
// one it can only read. Usage: node experiments/issue-2998/check-write-permission-live.mjs [missingRepo] [readOnlyRepo]
const [missing = 'konard/hive-mind-2998-does-not-exist', readOnly = 'torvalds/linux'] = process.argv.slice(2);
const { checkRepositoryWritePermission } = await import('../../src/github.lib.mjs');
for (const full of [missing, readOnly]) {
  const [owner, repo] = full.split('/');
  console.log(`\n===== ${full} =====`);
  console.log('result:', await checkRepositoryWritePermission(owner, repo, { issueUrl: `https://github.com/${full}/issues/1`, autoAcceptInvite: false }));
}
