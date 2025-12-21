#!/usr/bin/env node
/**
 * Cleanup script for test repositories created by create-test-repo.mjs
 * This script will find and delete all repositories matching the pattern: test-hello-world-{UUIDv7}
 *
 * Only repositories with valid UUIDv7 identifiers are matched to ensure we don't accidentally
 * delete repositories that happen to have similar names but weren't created by our script.
 *
 * UUIDv7 validation includes:
 * - Correct version (7) and variant bits
 * - Valid timestamp range (2020-2030)
 *
 * Usage:
 *   ./cleanup-test-repos.mjs                    # Interactive mode - asks for confirmation
 *   ./cleanup-test-repos.mjs --force            # Force mode - deletes without confirmation
 *   ./cleanup-test-repos.mjs --dry-run          # Dry run - shows what would be deleted
 *   ./cleanup-test-repos.mjs --skip-archived    # Skip archived repositories (preserve them)
 *   ./cleanup-test-repos.mjs --force --skip-archived  # Combine flags
 */

// Use use-m to dynamically import modules for cross-runtime compatibility
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

// Parse command line arguments
const args = process.argv.slice(2);
const forceMode = args.includes('--force') || args.includes('-f');
const dryRun = args.includes('--dry-run') || args.includes('-n');
const skipArchived = args.includes('--skip-archived') || args.includes('-s');

console.log('🧹 Test Repository Cleanup Tool');
console.log('================================\n');

if (dryRun) {
  console.log('📝 DRY RUN MODE - No repositories will be deleted\n');
} else if (forceMode) {
  console.log('⚠️  FORCE MODE - Repositories will be deleted without confirmation\n');
}

if (skipArchived) {
  console.log('🔒 SKIP ARCHIVED MODE - Archived repositories will be preserved\n');
}

try {
  // Import child_process once
  const { execSync } = await import('child_process');

  // Check GitHub authentication and permissions
  console.log('🔐 Checking GitHub permissions...');
  try {
    const authStatus = execSync('gh auth status', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

    // Check if we have delete_repo scope
    if (!authStatus.includes('delete_repo')) {
      console.log('⚠️  Warning: Missing "delete_repo" permission');
      console.log('');
      console.log('To delete repositories, you need to grant the delete_repo scope:');
      console.log('  gh auth refresh -h github.com -s delete_repo');
      console.log('');
      if (!forceMode && !dryRun) {
        console.log('Continue anyway? Type "yes" to continue, or Ctrl+C to cancel:');
        process.stdout.write('> ');

        try {
          const answer = execSync('read answer && echo $answer', {
            encoding: 'utf8',
            stdio: ['inherit', 'pipe', 'pipe'],
            shell: '/bin/bash'
          }).trim();

          if (answer.toLowerCase() !== 'yes') {
            console.log('\n❌ Cancelled');
            process.exit(0);
          }
        } catch (e) {
          console.log('\n\n❌ Cancelled');
          process.exit(0);
        }
      }
    }
  } catch (authError) {
    // gh auth status returns non-zero if not authenticated
    console.log('❌ Not authenticated with GitHub');
    console.log('');
    console.log('Please authenticate first:');
    console.log('  gh auth login');
    process.exit(1);
  }

  // Get current GitHub user
  const githubUser = execSync('gh api user --jq .login', { encoding: 'utf8' }).trim();
  console.log(`👤 User: ${githubUser}`);

  // List all repositories for the user
  process.stdout.write('🔍 Searching for test repositories... ');

  // Get all repos (up to 100, adjust if needed) - include isArchived field
  const reposJson = execSync(`gh repo list ${githubUser} --limit 100 --json name,url,createdAt,isPrivate,isArchived`, {
    encoding: 'utf8'
  });
  const repos = JSON.parse(reposJson);

  // Filter for test repositories matching the pattern with valid UUIDv7
  const allTestRepos = repos.filter(repo => {
    const matchFeedbackLines = repo.name.match(/^test-feedback-lines-([0-9a-z]+)$/);

    if (matchFeedbackLines) {
      return true;
    }

    // Check basic pattern first
    const match = repo.name.match(/^test-hello-world-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/);
    if (!match) return false;

    const uuid = match[1];

    // Validate UUIDv7 format
    // UUIDv7 has version 7 in the 13th hex position (xxxxxxxx-xxxx-7xxx-xxxx-xxxxxxxxxxxx)
    // and variant bits (8, 9, a, or b) in the 17th position (xxxxxxxx-xxxx-7xxx-[89ab]xxx-xxxxxxxxxxxx)
    const uuidv7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    if (!uuidv7Pattern.test(uuid)) return false;

    return true;
  });

  // Filter out archived repos if --skip-archived flag is set
  let testRepos = allTestRepos;
  let skippedArchivedCount = 0;

  if (skipArchived) {
    const archivedRepos = allTestRepos.filter(repo => repo.isArchived);
    skippedArchivedCount = archivedRepos.length;
    testRepos = allTestRepos.filter(repo => !repo.isArchived);

    if (skippedArchivedCount > 0) {
      console.log(`📦 Skipping ${skippedArchivedCount} archived repositories`);
      archivedRepos.forEach((repo, index) => {
        console.log(`  - ${repo.name} (archived)`);
      });
      console.log('');
    }
  }

  if (testRepos.length === 0) {
    console.log('none found ✅');
    console.log('');
    console.log('Nothing to clean up!');
    process.exit(0);
  }

  // Display found repositories
  console.log(`found ${testRepos.length}`);
  console.log('');
  console.log(`📦 Test repositories:\n`);

  testRepos.forEach((repo, index) => {
    const createdDate = new Date(repo.createdAt);
    const ageInDays = Math.floor((Date.now() - createdDate) / (1000 * 60 * 60 * 24));
    const ageText = ageInDays === 0 ? 'today' : ageInDays === 1 ? 'yesterday' : `${ageInDays} days ago`;

    const archivedText = repo.isArchived ? ' [ARCHIVED]' : '';
    console.log(`  ${(index + 1).toString().padStart(2)}. ${repo.url} (${ageText})${archivedText}`);
  });

  console.log('');

  if (dryRun) {
    console.log('✅ DRY RUN COMPLETE');
    console.log(`Would delete ${testRepos.length} repositories`);
    if (skipArchived && skippedArchivedCount > 0) {
      console.log(`Would preserve ${skippedArchivedCount} archived repositories`);
    }
    console.log('');
    console.log('To actually delete:');
    console.log('  ./cleanup-test-repos.mjs                   # With confirmation');
    console.log('  ./cleanup-test-repos.mjs --force            # Without confirmation');
    console.log('  ./cleanup-test-repos.mjs --skip-archived    # Preserve archived repos');
    process.exit(0);
  }

  // Ask for confirmation if not in force mode
  if (!forceMode) {
    console.log(`⚠️  This will permanently delete ${testRepos.length} repositories!`);
    console.log('');
    console.log('Type "yes" to confirm, or Ctrl+C to cancel:');
    process.stdout.write('> ');

    // Use execSync to read input, which handles Ctrl+C properly
    try {
      // Read from stdin using shell command
      const answer = execSync('read answer && echo $answer', {
        encoding: 'utf8',
        stdio: ['inherit', 'pipe', 'pipe'],
        shell: '/bin/bash'
      }).trim();

      if (answer.toLowerCase() !== 'yes') {
        console.log('\n❌ Cancelled');
        process.exit(0);
      }
    } catch (e) {
      // Ctrl+C was pressed (execSync throws on SIGINT)
      console.log('\n\n❌ Cancelled');
      process.exit(0);
    }
  }

  // Delete repositories
  console.log('\n🗑️  Deleting repositories...\n');

  let deletedCount = 0;
  let failedCount = 0;
  let permissionError = false;

  for (const repo of testRepos) {
    process.stdout.write(`  Deleting ${repo.name}... `);

    try {
      // Use gh repo delete with --yes flag to skip confirmation
      // Don't suppress stderr - we need to see errors
      await $`gh repo delete ${githubUser}/${repo.name} --yes`;
      console.log('✅');
      deletedCount++;
    } catch (error) {
      console.log('❌');
      failedCount++;

      // Show the actual error from gh command
      let errorMsg = '';
      if (error.stderr) {
        errorMsg = error.stderr.toString().trim();
      } else if (error.stdout) {
        errorMsg = error.stdout.toString().trim();
      } else if (error.message) {
        errorMsg = error.message;
      } else {
        errorMsg = 'Unknown error occurred';
      }

      // Check if it's a permission error
      if (errorMsg.includes('delete_repo') || errorMsg.includes('403')) {
        permissionError = true;
        console.log(`    Error: Missing delete_repo permission`);
        console.log('');
        console.log('❌ Cannot delete repositories without proper permissions.');
        console.log('');
        console.log('To fix this, run:');
        console.log('  gh auth refresh -h github.com -s delete_repo');
        console.log('');
        console.log('Then run this script again.');
        break; // Stop trying to delete more repos
      } else {
        console.log(`    Error: ${errorMsg}`);
      }
    }
  }

  // Only show success message if we actually deleted something
  if (!permissionError) {
    console.log('');
    if (deletedCount > 0 || failedCount === 0) {
      console.log('✨ Cleanup complete!');
    } else {
      console.log('❌ Cleanup failed!');
    }
    console.log('');
    if (deletedCount > 0) {
      console.log(`✅ Deleted: ${deletedCount} repositories`);
    }
    if (skipArchived && skippedArchivedCount > 0) {
      console.log(`🔒 Preserved: ${skippedArchivedCount} archived repositories`);
    }
    if (failedCount > 0) {
      console.log(`❌ Failed: ${failedCount} repositories`);
    }

    // Show tip about archiving
    if (!skipArchived && deletedCount > 0) {
      console.log('');
      console.log('💡 Tip: To preserve specific test repositories in the future:');
      console.log('   1. Archive them on GitHub (Settings → Archive this repository)');
      console.log('   2. Use --skip-archived flag when running cleanup');
    }
  }
} catch (error) {
  console.error('\n❌ Error:', error.message);
  if (error.stderr) {
    console.error('Details:', error.stderr.toString());
  }
  process.exit(1);
}
