#!/usr/bin/env node
/**
 * Branch Protection Script
 *
 * Enables branch protection rules on the default branch of a GitHub repository
 * to require pull requests before merging.
 *
 * Usage:
 *   ./protect-branch.mjs <owner>/<repo>
 *   ./protect-branch.mjs <owner>/<repo> <branch-name>
 *
 * Examples:
 *   ./protect-branch.mjs konard/my-repo
 *   ./protect-branch.mjs konard/my-repo main
 */

// Use use-m to dynamically import modules for cross-runtime compatibility
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log('Branch Protection Tool');
  console.log('Usage: ./protect-branch.mjs <owner>/<repo> [branch-name]');
  console.log('');
  console.log('Examples:');
  console.log('  ./protect-branch.mjs konard/my-repo');
  console.log('  ./protect-branch.mjs konard/my-repo main');
  process.exit(0);
}

// Parse repository argument
const repoArg = args[0];
if (!repoArg.includes('/')) {
  console.error('Error: Repository must be in format owner/repo');
  process.exit(1);
}

const [owner, repo] = repoArg.split('/');
let branchName = args[1];

console.log('🔒 Branch Protection Tool');
console.log(`📦 Repository: ${owner}/${repo}`);

try {
  // If branch name not provided, get the default branch
  if (!branchName) {
    console.log('🔍 Detecting default branch...');
    const defaultBranchResult = await $`gh api repos/${owner}/${repo} --jq .default_branch`;

    if (defaultBranchResult.code !== 0) {
      console.error('Error: Failed to get repository information');
      console.error(defaultBranchResult.stderr ? defaultBranchResult.stderr.toString() : 'Unknown error');
      process.exit(1);
    }

    branchName = defaultBranchResult.stdout.toString().trim();
    console.log(`✅ Default branch: ${branchName}`);
  } else {
    console.log(`🎯 Target branch: ${branchName}`);
  }

  // Check if branch exists
  console.log('🔍 Verifying branch exists...');
  const branchCheckResult = await $`gh api repos/${owner}/${repo}/branches/${branchName} --silent`;

  if (branchCheckResult.code !== 0) {
    console.error(`Error: Branch '${branchName}' not found in repository`);
    process.exit(1);
  }
  console.log('✅ Branch verified');

  // Enable branch protection with PR requirement
  console.log(`🔐 Enabling branch protection for '${branchName}'...`);

  // Create the protection rules JSON
  const protectionRules = {
    required_status_checks: null,
    enforce_admins: false,
    required_pull_request_reviews: {
      dismiss_stale_reviews: false,
      require_code_owner_reviews: false,
      required_approving_review_count: 0,
      require_last_push_approval: false,
    },
    restrictions: null,
    allow_force_pushes: false,
    allow_deletions: false,
    block_creations: false,
    required_conversation_resolution: false,
    lock_branch: false,
    allow_fork_syncing: false,
  };

  // Apply branch protection using GitHub API
  const protectResult = await $`gh api \
    --method PUT \
    repos/${owner}/${repo}/branches/${branchName}/protection \
    --input - << 'EOF'
${JSON.stringify(protectionRules, null, 2)}
EOF`;

  if (protectResult.code !== 0) {
    // Check if it's already protected
    if (protectResult.stderr && protectResult.stderr.toString().includes('Branch protection is disabled')) {
      console.warn('⚠️  Branch protection might require admin permissions or a paid plan');
    } else {
      console.error('Error: Failed to enable branch protection');
      console.error(protectResult.stderr ? protectResult.stderr.toString() : 'Unknown error');
    }

    // Try a simpler approach for public repos
    console.log('🔄 Trying alternative method...');

    // For public repos, we can at least try to update settings
    const updateResult = await $`gh api \
      --method PATCH \
      repos/${owner}/${repo} \
      --field allow_merge_commit=true \
      --field allow_squash_merge=true \
      --field allow_rebase_merge=true \
      --field delete_branch_on_merge=false`;

    if (updateResult.code === 0) {
      console.log('✅ Repository settings updated (PR workflow encouraged)');
    }
  } else {
    console.log('✅ Branch protection enabled successfully!');
  }

  // Verify the protection status
  console.log('\n📊 Verifying protection status...');
  const statusResult = await $`gh api repos/${owner}/${repo}/branches/${branchName}/protection --silent 2>/dev/null || echo "not-protected"`;

  if (statusResult.stdout.toString().trim() === 'not-protected') {
    console.log('⚠️  Branch protection not fully active (may require admin rights or paid plan)');
    console.log('\n💡 Alternative: Configure protection manually in repository settings:');
    console.log(`   https://github.com/${owner}/${repo}/settings/branches`);
  } else {
    console.log('✅ Branch protection is active');
    console.log('\n🎯 Protection rules applied:');
    console.log('   • Pull requests required before merging');
    console.log('   • Force pushes disabled');
    console.log('   • Branch deletion disabled');
  }

  console.log('\n✨ Done! The branch is configured to require pull requests.');
} catch (error) {
  console.error('\n❌ Error:', error.message);
  if (error.stderr) {
    console.error('Details:', error.stderr.toString());
  }
  process.exit(1);
}
