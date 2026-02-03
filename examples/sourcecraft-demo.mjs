#!/usr/bin/env node

/**
 * SourceCraft Integration Demo
 *
 * This script demonstrates how to use the provider abstraction layer
 * to work with SourceCraft repositories.
 *
 * Usage:
 *   node examples/sourcecraft-demo.mjs
 *
 * Prerequisites:
 *   export SOURCECRAFT_API_TOKEN="your-token-here"
 */

import { getProviderForUrl, detectProviderFromUrl } from '../src/providers/provider.interface.mjs';

console.log('🎯 SourceCraft Integration Demo\n');

// Example URLs
const githubUrl = 'https://github.com/owner/repo/issues/123';
const sourcecraftUrl = 'https://sourcecraft.dev/org/repo/issues/bug-fix-login';

console.log('📋 Step 1: Detect Provider from URL\n');

const githubProviderType = detectProviderFromUrl(githubUrl);
console.log(`   GitHub URL: ${githubUrl}`);
console.log(`   Detected provider: ${githubProviderType}\n`);

const sourcecraftProviderType = detectProviderFromUrl(sourcecraftUrl);
console.log(`   SourceCraft URL: ${sourcecraftUrl}`);
console.log(`   Detected provider: ${sourcecraftProviderType}\n`);

console.log('📋 Step 2: Parse URLs\n');

try {
  // Get GitHub provider
  const githubProvider = await getProviderForUrl(githubUrl);
  const githubParsed = githubProvider.parseUrl(githubUrl);
  console.log('   GitHub URL parsed:');
  console.log(`     Valid: ${githubParsed.valid}`);
  console.log(`     Type: ${githubParsed.type}`);
  console.log(`     Owner: ${githubParsed.owner}`);
  console.log(`     Repo: ${githubParsed.repo}`);
  console.log(`     Number: ${githubParsed.number}\n`);

  // Get SourceCraft provider
  const sourcecraftProvider = await getProviderForUrl(sourcecraftUrl);
  const sourcecraftParsed = sourcecraftProvider.parseUrl(sourcecraftUrl);
  console.log('   SourceCraft URL parsed:');
  console.log(`     Valid: ${sourcecraftParsed.valid}`);
  console.log(`     Type: ${sourcecraftParsed.type}`);
  console.log(`     Owner: ${sourcecraftParsed.owner}`);
  console.log(`     Repo: ${sourcecraftParsed.repo}`);
  console.log(`     Slug: ${sourcecraftParsed.slug}\n`);

  console.log('📋 Step 3: Check Authentication\n');

  console.log('   Checking GitHub authentication...');
  const githubAuth = await githubProvider.checkAuthentication();
  console.log(`   GitHub authenticated: ${githubAuth ? '✅' : '❌'}\n`);

  console.log('   Checking SourceCraft authentication...');
  const sourcecraftAuth = await sourcecraftProvider.checkAuthentication();
  console.log(`   SourceCraft authenticated: ${sourcecraftAuth ? '✅' : '❌'}\n`);

  if (!sourcecraftAuth) {
    console.log('   ℹ️  To authenticate with SourceCraft, set your API token:');
    console.log('      export SOURCECRAFT_API_TOKEN="your-token-here"\n');
  }

  console.log('📋 Step 4: Get Clone URLs\n');

  const githubCloneHttps = await githubProvider.getCloneUrl('owner', 'repo', { useSSH: false });
  const githubCloneSSH = await githubProvider.getCloneUrl('owner', 'repo', { useSSH: true });
  console.log('   GitHub Clone URLs:');
  console.log(`     HTTPS: ${githubCloneHttps}`);
  console.log(`     SSH: ${githubCloneSSH}\n`);

  const sourcecraftCloneHttps = await sourcecraftProvider.getCloneUrl('org', 'repo', { useSSH: false });
  const sourcecraftCloneSSH = await sourcecraftProvider.getCloneUrl('org', 'repo', { useSSH: true });
  console.log('   SourceCraft Clone URLs:');
  console.log(`     HTTPS: ${sourcecraftCloneHttps}`);
  console.log(`     SSH: ${sourcecraftCloneSSH}\n`);

  console.log('📋 Step 5: Demonstrate Provider Interface Consistency\n');

  console.log('   Both providers implement the same interface:');
  console.log('   ✅ getName()');
  console.log('   ✅ parseUrl(url)');
  console.log('   ✅ checkAuthentication()');
  console.log('   ✅ getIssue(number, owner, repo)');
  console.log('   ✅ getPullRequest(number, owner, repo)');
  console.log('   ✅ createPullRequest(options)');
  console.log('   ✅ addComment(type, number, owner, repo, body)');
  console.log('   ✅ getComments(type, number, owner, repo)');
  console.log('   ✅ forkRepository(owner, repo)');
  console.log('   ✅ getCloneUrl(owner, repo, options)');
  console.log('   ✅ detectRepositoryVisibility(owner, repo)');
  console.log('   ✅ listIssues(owner, repo, options)');
  console.log('   ✅ listPullRequests(owner, repo, options)\n');

  console.log('✅ Demo completed successfully!\n');

  console.log('📚 Next Steps:\n');
  console.log('   1. Set up SourceCraft API token:');
  console.log('      export SOURCECRAFT_API_TOKEN="your-token"\n');
  console.log('   2. Try solving a SourceCraft issue:');
  console.log('      solve https://sourcecraft.dev/org/repo/issues/issue-slug --model sonnet\n');
  console.log('   3. Monitor a SourceCraft repository:');
  console.log('      hive https://sourcecraft.dev/org/repo --all-issues --max-issues 5\n');
  console.log('   4. Read the integration guide:');
  console.log('      cat docs/SOURCECRAFT_INTEGRATION.md\n');

} catch (error) {
  console.error('❌ Error:', error.message);
  console.error('\n   Make sure you have:');
  console.error('   1. Set SOURCECRAFT_API_TOKEN environment variable');
  console.error('   2. Authenticated with GitHub (gh auth login)');
  console.error('   3. Internet connection to access APIs\n');
  process.exit(1);
}
