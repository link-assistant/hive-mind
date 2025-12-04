/**
 * Auto PR creation functionality for solve.mjs
 * Handles automatic creation of draft pull requests with initial commits
 */

export async function handleAutoPrCreation({
  argv,
  tempDir,
  branchName,
  issueNumber,
  owner,
  repo,
  defaultBranch,
  forkedRepo,
  isContinueMode,
  prNumber,
  log,
  formatAligned,
  $,
  reportError,
  path,
  fs
}) {
  // Skip auto-PR creation if:
  // 1. Auto-PR creation is disabled AND we're not in continue mode with no PR
  // 2. Continue mode is active AND we already have a PR
  if (!argv.autoPullRequestCreation && !(isContinueMode && !prNumber)) {
    return null;
  }

  if (isContinueMode && prNumber) {
    // Continue mode with existing PR - skip PR creation
    return null;
  }

  await log(`\n${formatAligned('🚀', 'Auto PR creation:', 'ENABLED')}`);
  await log('     Creating:               Initial commit and draft PR...');
  await log('');

  let prUrl = null;
  let localPrNumber = null;
  let claudeCommitHash = null;

  // Extract issue URL at the top level so it's available in error handlers
  // Use argv['issue-url'] (named positional) with fallback to argv._[0] (raw positional)
  // This handles both yargs command mode (argv['issue-url']) and direct positional mode (argv._[0])
  const issueUrl = argv['issue-url'] || argv._[0];

  try {
    // Create CLAUDE.md file with the task details
    await log(formatAligned('📝', 'Creating:', 'CLAUDE.md with task details'));

    // Check if CLAUDE.md already exists and read its content
    const claudeMdPath = path.join(tempDir, 'CLAUDE.md');
    let existingContent = null;
    let fileExisted = false;
    try {
      existingContent = await fs.readFile(claudeMdPath, 'utf8');
      fileExisted = true;
    } catch (err) {
      // File doesn't exist, which is fine
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }

    // Build task info section

    // Verbose logging to help debug issue URL parsing issues (issue #651)
    if (argv.verbose) {
      await log(`   Issue URL from argv['issue-url']: ${argv['issue-url'] || 'undefined'}`, { verbose: true });
      await log(`   Issue URL from argv._[0]: ${argv._[0] || 'undefined'}`, { verbose: true });
      await log(`   Final issue URL: ${issueUrl}`, { verbose: true });
    }

    // Add timestamp to ensure unique content on each run when appending
    // This is critical for --auto-continue mode when reusing an existing branch
    // Without this, appending the same task info produces no git changes,
    // leading to "No commits between branches" error during PR creation
    const timestamp = new Date().toISOString();
    const taskInfo = `Issue to solve: ${issueUrl}
Your prepared branch: ${branchName}
Your prepared working directory: ${tempDir}${argv.fork && forkedRepo ? `
Your forked repository: ${forkedRepo}
Original repository (upstream): ${owner}/${repo}` : ''}

Proceed.`;

    // If CLAUDE.md already exists, append the task info with separator and timestamp
    // Otherwise, create new file with just the task info (no timestamp needed for new files)
    let finalContent;
    if (fileExisted && existingContent) {
      await log('   CLAUDE.md already exists, appending task info...', { verbose: true });
      // Remove any trailing whitespace and add separator
      const trimmedExisting = existingContent.trimEnd();
      // Add timestamp to ensure uniqueness when appending
      finalContent = `${trimmedExisting}\n\n---\n\n${taskInfo}\n\nRun timestamp: ${timestamp}`;
    } else {
      finalContent = taskInfo;
    }

    await fs.writeFile(claudeMdPath, finalContent);
    await log(formatAligned('✅', 'File created:', 'CLAUDE.md'));

    // Add and commit the file
    await log(formatAligned('📦', 'Adding file:', 'To git staging'));

    // Use explicit cwd option for better reliability
    const addResult = await $({ cwd: tempDir })`git add CLAUDE.md`;

    if (addResult.code !== 0) {
      await log('❌ Failed to add CLAUDE.md', { level: 'error' });
      await log(`   Error: ${addResult.stderr ? addResult.stderr.toString() : 'Unknown error'}`, { level: 'error' });
      throw new Error('Failed to add CLAUDE.md');
    }

    // Verify the file was actually staged
    let statusResult = await $({ cwd: tempDir })`git status --short`;
    let gitStatus = statusResult.stdout ? statusResult.stdout.toString().trim() : '';

    if (argv.verbose) {
      await log(`   Git status after add: ${gitStatus || 'empty'}`);
    }

    // Track which file we're using for the commit
    let commitFileName = 'CLAUDE.md';

    // Check if anything was actually staged
    if (!gitStatus || gitStatus.length === 0) {
      await log('');
      await log(formatAligned('⚠️', 'CLAUDE.md not staged:', 'Checking if file is ignored'), { level: 'warning' });

      // Check if CLAUDE.md is in .gitignore
      const checkIgnoreResult = await $({ cwd: tempDir })`git check-ignore CLAUDE.md`;
      const isIgnored = checkIgnoreResult.code === 0;

      if (isIgnored) {
        await log(formatAligned('ℹ️', 'CLAUDE.md is ignored:', 'Using .gitkeep fallback'));
        await log('');
        await log('  📝 Fallback strategy:');
        await log('     CLAUDE.md is in .gitignore, using .gitkeep instead.');
        await log('     This allows auto-PR creation to proceed without modifying .gitignore.');
        await log('');

        // Create a .gitkeep file as fallback
        const gitkeepPath = path.join(tempDir, '.gitkeep');
        const gitkeepContent = `# Auto-generated file for PR creation
# Issue: ${issueUrl}
# Branch: ${branchName}
# This file was created because CLAUDE.md is in .gitignore
# It will be removed when the task is complete`;

        await fs.writeFile(gitkeepPath, gitkeepContent);
        await log(formatAligned('✅', 'Created:', '.gitkeep file'));

        // Try to add .gitkeep
        const gitkeepAddResult = await $({ cwd: tempDir })`git add .gitkeep`;

        if (gitkeepAddResult.code !== 0) {
          await log('❌ Failed to add .gitkeep', { level: 'error' });
          await log(`   Error: ${gitkeepAddResult.stderr ? gitkeepAddResult.stderr.toString() : 'Unknown error'}`, { level: 'error' });
          throw new Error('Failed to add .gitkeep');
        }

        // Verify .gitkeep was staged
        statusResult = await $({ cwd: tempDir })`git status --short`;
        gitStatus = statusResult.stdout ? statusResult.stdout.toString().trim() : '';

        if (!gitStatus || gitStatus.length === 0) {
          await log('');
          await log(formatAligned('❌', 'GIT ADD FAILED:', 'Neither CLAUDE.md nor .gitkeep could be staged'), { level: 'error' });
          await log('');
          await log('  🔍 What happened:');
          await log('     Both CLAUDE.md and .gitkeep failed to stage.');
          await log('');
          await log('  🔧 Troubleshooting steps:');
          await log(`     1. Check git status: cd "${tempDir}" && git status`);
          await log(`     2. Check .gitignore: cat "${tempDir}/.gitignore"`);
          await log(`     3. Try force add: cd "${tempDir}" && git add -f .gitkeep`);
          await log('');
          throw new Error('Git add staged nothing - both files failed');
        }

        commitFileName = '.gitkeep';
        await log(formatAligned('✅', 'File staged:', '.gitkeep'));
      } else {
        await log('');
        await log(formatAligned('❌', 'GIT ADD FAILED:', 'Nothing was staged'), { level: 'error' });
        await log('');
        await log('  🔍 What happened:');
        await log('     CLAUDE.md was created but git did not stage any changes.');
        await log('');
        await log('  💡 Possible causes:');
        await log('     • CLAUDE.md already exists with identical content');
        await log('     • File system sync issue');
        await log('');
        await log('  🔧 Troubleshooting steps:');
        await log(`     1. Check file exists: ls -la "${tempDir}/CLAUDE.md"`);
        await log(`     2. Check git status: cd "${tempDir}" && git status`);
        await log(`     3. Force add: cd "${tempDir}" && git add -f CLAUDE.md`);
        await log('');
        await log('  📂 Debug information:');
        await log(`     Working directory: ${tempDir}`);
        await log(`     Branch: ${branchName}`);
        if (existingContent) {
          await log('     Note: CLAUDE.md already existed (attempted to update with timestamp)');
        }
        await log('');
        throw new Error('Git add staged nothing - CLAUDE.md may be unchanged');
      }
    }

    await log(formatAligned('📝', 'Creating commit:', `With ${commitFileName} file`));
    const commitMessage = commitFileName === 'CLAUDE.md'
      ? `Initial commit with task details for issue #${issueNumber}

Adding CLAUDE.md with task information for AI processing.
This file will be removed when the task is complete.

Issue: ${issueUrl}`
      : `Initial commit with task details for issue #${issueNumber}

Adding .gitkeep for PR creation (CLAUDE.md is in .gitignore).
This file will be removed when the task is complete.

Issue: ${issueUrl}`;

    // Use explicit cwd option for better reliability
    const commitResult = await $({ cwd: tempDir })`git commit -m ${commitMessage}`;

    if (commitResult.code !== 0) {
      const commitStderr = commitResult.stderr ? commitResult.stderr.toString() : '';
      const commitStdout = commitResult.stdout ? commitResult.stdout.toString() : '';

      await log('');
      await log(formatAligned('❌', 'COMMIT FAILED:', 'Could not create initial commit'), { level: 'error' });
      await log('');
      await log('  🔍 What happened:');
      await log('     Git commit command failed after staging CLAUDE.md.');
      await log('');

      // Check for specific error patterns
      if (commitStdout.includes('nothing to commit') || commitStdout.includes('working tree clean')) {
        await log('  💡 Root cause:');
        await log('     Git reports "nothing to commit, working tree clean".');
        await log('     This means no changes were staged, despite running git add.');
        await log('');
        await log('  🔎 Why this happens:');
        await log('     • CLAUDE.md already exists with identical content');
        await log('     • File content did not actually change');
        await log('     • Previous run may have left CLAUDE.md in the repository');
        await log('');
        await log('  🔧 How to fix:');
        await log('     Option 1: Remove CLAUDE.md and try again');
        await log(`       cd "${tempDir}" && git rm CLAUDE.md && git commit -m "Remove CLAUDE.md"`);
        await log('');
        await log('     Option 2: Skip auto-PR creation');
        await log('       Run solve.mjs without --auto-pull-request-creation flag');
        await log('');
      } else {
        await log('  📦 Error output:');
        if (commitStderr) await log(`     stderr: ${commitStderr}`);
        if (commitStdout) await log(`     stdout: ${commitStdout}`);
        await log('');
      }

      await log('  📂 Debug information:');
      await log(`     Working directory: ${tempDir}`);
      await log(`     Branch: ${branchName}`);
      await log(`     Git status: ${gitStatus || '(empty)'}`);
      await log('');

      throw new Error('Failed to create initial commit');
    } else {
      await log(formatAligned('✅', 'Commit created:', `Successfully with ${commitFileName}`));
      if (argv.verbose) {
        await log(`   Commit output: ${commitResult.stdout.toString().trim()}`, { verbose: true });
      }

      // Get the commit hash of the CLAUDE.md commit we just created
      const commitHashResult = await $({ cwd: tempDir })`git log --format=%H -1 2>&1`;
      if (commitHashResult.code === 0) {
        claudeCommitHash = commitHashResult.stdout.toString().trim();
        await log(`   Commit hash: ${claudeCommitHash.substring(0, 7)}...`, { verbose: true });
      }

      // Verify commit was created before pushing
      const verifyCommitResult = await $({ cwd: tempDir })`git log --format="%h %s" -1 2>&1`;
      if (verifyCommitResult.code === 0) {
        const latestCommit = verifyCommitResult.stdout ? verifyCommitResult.stdout.toString().trim() : '';
        if (argv.verbose) {
          await log(`   Latest commit: ${latestCommit || '(empty - this is a problem!)'}`);

          // Show git status
          const statusResult = await $({ cwd: tempDir })`git status --short 2>&1`;
          await log(`   Git status: ${statusResult.stdout ? statusResult.stdout.toString().trim() || 'clean' : 'clean'}`);

          // Show remote info
          const remoteResult = await $({ cwd: tempDir })`git remote -v 2>&1`;
          const remoteOutput = remoteResult.stdout ? remoteResult.stdout.toString().trim() : 'none';
          await log(`   Remotes: ${remoteOutput ? remoteOutput.split('\n')[0] : 'none configured'}`);

          // Show branch info
          const branchResult = await $({ cwd: tempDir })`git branch -vv 2>&1`;
          await log(`   Branch info: ${branchResult.stdout ? branchResult.stdout.toString().trim() : 'none'}`);
        }
      }

      // Push the branch
      await log(formatAligned('📤', 'Pushing branch:', 'To remote repository...'));

      // Always use regular push - never force push, rebase, or reset
      // History must be preserved at all times
      if (argv.verbose) {
        await log(`   Push command: git push -u origin ${branchName}`);
      }

      const pushResult = await $({ cwd: tempDir })`git push -u origin ${branchName} 2>&1`;

      if (argv.verbose) {
        await log(`   Push exit code: ${pushResult.code}`);
        if (pushResult.stdout) {
          await log(`   Push output: ${pushResult.stdout.toString().trim()}`);
        }
        if (pushResult.stderr) {
          await log(`   Push stderr: ${pushResult.stderr.toString().trim()}`);
        }
      }

      if (pushResult.code !== 0) {
        const errorOutput = pushResult.stderr ? pushResult.stderr.toString() : pushResult.stdout ? pushResult.stdout.toString() : 'Unknown error';

        // Check for archived repository error
        if (errorOutput.includes('archived') && errorOutput.includes('read-only')) {
          await log(`\n${formatAligned('❌', 'REPOSITORY ARCHIVED:', 'Cannot push to archived repository')}`, { level: 'error' });
          await log('');
          await log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          await log('');
          await log(`  📦 Repository ${owner}/${repo} has been archived`);
          await log('');
          await log('  Archived repositories are read-only and cannot accept new commits.');
          await log('');
          await log('  📋 WHAT THIS MEANS:');
          await log('');
          await log('  This repository has been archived by its owner, which means:');
          await log('    • No new commits can be pushed');
          await log('    • No new pull requests can be created');
          await log('    • The repository is in read-only mode');
          await log('    • Issues cannot be worked on');
          await log('');
          await log('  🔧 POSSIBLE ACTIONS:');
          await log('');
          await log('  Option 1: Contact the repository owner');
          await log('  ──────────────────────────────────────');
          await log('  Ask the owner to unarchive the repository at:');
          await log(`    https://github.com/${owner}/${repo}/settings`);
          await log('');
          await log('  Option 2: Close the issue');
          await log('  ──────────────────────────────────────');
          await log('  If the repository is intentionally archived, close the issue:');
          await log(`    gh issue close ${issueNumber} --repo ${owner}/${repo} \\`);
          await log('      --comment "Closing as repository is archived"');
          await log('');
          await log('  Option 3: Fork and work independently');
          await log('  ──────────────────────────────────────');
          await log('  You can fork the archived repository and make changes there,');
          await log('  but note that you cannot create a PR back to the archived repo.');
          await log('');
          await log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          await log('');
          throw new Error('Repository is archived and read-only');
        }

        // Check for permission denied error
        if (errorOutput.includes('Permission to') && errorOutput.includes('denied')) {
          // Check if user already has a fork
          let userHasFork = false;
          let currentUser = null;
          // Determine fork name based on --prefix-fork-name-with-owner-name option
          const forkRepoName = argv.prefixForkNameWithOwnerName ? `${owner}-${repo}` : repo;
          try {
            const userResult = await $`gh api user --jq .login`;
            if (userResult.code === 0) {
              currentUser = userResult.stdout.toString().trim();
              const userForkName = `${currentUser}/${forkRepoName}`;
              const forkCheckResult = await $`gh repo view ${userForkName} --json parent 2>/dev/null`;
              if (forkCheckResult.code === 0) {
                const forkData = JSON.parse(forkCheckResult.stdout.toString());
                if (forkData.parent && forkData.parent.owner && forkData.parent.owner.login === owner) {
                  userHasFork = true;
                }
              }
            }
          } catch (e) {
            reportError(e, {
              context: 'fork_check',
              owner,
              repo,
              operation: 'check_user_fork'
            });
            // Ignore error - fork check is optional
          }

          await log(`\n${formatAligned('❌', 'PERMISSION DENIED:', 'Cannot push to repository')}`, { level: 'error' });
          await log('');
          await log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          await log('');
          await log(`  🔒 You don't have write access to ${owner}/${repo}`);
          await log('');
          await log('  This typically happens when:');
          await log('    • You\'re not a collaborator on the repository');
          await log('    • The repository belongs to another user/organization');
          await log('');
          await log('  📋 HOW TO FIX THIS:');
          await log('');
          await log('  ┌──────────────────────────────────────────────────────────┐');
          await log('  │  RECOMMENDED: Use the --fork option                     │');
          await log('  └──────────────────────────────────────────────────────────┘');
          await log('');
          await log('  Run the command again with --fork:');
          await log('');
          await log(`    ./solve.mjs "${issueUrl}" --fork`);
          await log('');
          await log('  This will automatically:');
          if (userHasFork) {
            await log(`    ✓ Use your existing fork (${currentUser}/${forkRepoName})`);
            await log('    ✓ Sync your fork with the latest changes');
          } else {
            await log('    ✓ Fork the repository to your account');
          }
          await log('    ✓ Push changes to your fork');
          await log('    ✓ Create a PR from your fork to the original repo');
          await log('    ✓ Handle all the remote setup automatically');
          await log('');
          await log('  ─────────────────────────────────────────────────────────');
          await log('');
          await log('  Alternative options:');
          await log('');
          await log('  Option 2: Request collaborator access');
          await log(`  ${'-'.repeat(40)}`);
          await log('  Ask the repository owner to add you as a collaborator:');
          await log(`    → Go to: https://github.com/${owner}/${repo}/settings/access`);
          await log('');
          await log('  Option 3: Manual fork and clone');
          await log(`  ${'-'.repeat(40)}`);
          await log(`  1. Fork the repo: https://github.com/${owner}/${repo}/fork`);
          await log('  2. Clone your fork and work there');
          await log('  3. Create a PR from your fork');
          await log('');
          await log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          await log('');
          await log('💡 Tip: The --fork option automates the entire fork workflow!');
          if (userHasFork) {
            await log(`   Note: We detected you already have a fork at ${currentUser}/${forkRepoName}`);
          }
          await log('');
          throw new Error('Permission denied - need fork or collaborator access');
        } else if (errorOutput.includes('non-fast-forward') || errorOutput.includes('rejected') || errorOutput.includes('! [rejected]')) {
          // Push rejected due to conflicts or diverged history
          await log('');
          await log(formatAligned('❌', 'PUSH REJECTED:', 'Branch has diverged from remote'), { level: 'error' });
          await log('');
          await log('  🔍 What happened:');
          await log('     The remote branch has changes that conflict with your local changes.');
          await log('     This typically means someone else has pushed to this branch.');
          await log('');
          await log('  💡 Why we cannot fix this automatically:');
          await log('     • We never use force push to preserve history');
          await log('     • We never use rebase or reset to avoid altering git history');
          await log('     • Manual conflict resolution is required');
          await log('');
          await log('  🔧 How to fix:');
          await log('     1. Clone the repository and checkout the branch:');
          await log(`        git clone https://github.com/${owner}/${repo}.git`);
          await log(`        cd ${repo}`);
          await log(`        git checkout ${branchName}`);
          await log('');
          await log('     2. Pull and merge the remote changes:');
          await log(`        git pull origin ${branchName}`);
          await log('');
          await log('     3. Resolve any conflicts manually, then:');
          await log(`        git push origin ${branchName}`);
          await log('');
          await log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          await log('');
          throw new Error('Push rejected - branch has diverged, manual resolution required');
        } else {
          // Other push errors
          await log(`${formatAligned('❌', 'Failed to push:', 'See error below')}`, { level: 'error' });
          await log(`   Error: ${errorOutput}`, { level: 'error' });
          throw new Error('Failed to push branch');
        }
      } else {
        await log(`${formatAligned('✅', 'Branch pushed:', 'Successfully to remote')}`);
        if (argv.verbose) {
          await log(`   Push output: ${pushResult.stdout.toString().trim()}`, { verbose: true });
        }

        // CRITICAL: Wait for GitHub to process the push before creating PR
        // This prevents "No commits between branches" error
        await log('   Waiting for GitHub to sync...');

        // Use exponential backoff to wait for GitHub's compare API to see the commits
        // This is essential because GitHub has multiple backend systems:
        // - Git receive: Accepts push immediately
        // - Branch API: Returns quickly from cache
        // - Compare/PR API: May take longer to index commits
        let compareReady = false;
        let compareAttempts = 0;
        const maxCompareAttempts = 5;
        const targetBranchForCompare = argv.baseBranch || defaultBranch;

        while (!compareReady && compareAttempts < maxCompareAttempts) {
          compareAttempts++;
          const waitTime = Math.min(2000 * compareAttempts, 10000); // 2s, 4s, 6s, 8s, 10s

          if (compareAttempts > 1) {
            await log(`   Retry ${compareAttempts}/${maxCompareAttempts}: Waiting ${waitTime}ms for GitHub to index commits...`);
          }

          await new Promise(resolve => setTimeout(resolve, waitTime));

          // Check if GitHub's compare API can see commits between base and head
          // This is the SAME API that gh pr create uses internally, so if this works,
          // PR creation should work too
          // For fork mode, we need to use forkUser:branchName format for the head
          let headRef;
          if (argv.fork && forkedRepo) {
            const forkUser = forkedRepo.split('/')[0];
            headRef = `${forkUser}:${branchName}`;
          } else {
            headRef = branchName;
          }
          const compareResult = await $({ silent: true })`gh api repos/${owner}/${repo}/compare/${targetBranchForCompare}...${headRef} --jq '.ahead_by' 2>&1`;

          if (compareResult.code === 0) {
            const aheadBy = parseInt(compareResult.stdout.toString().trim(), 10);
            if (argv.verbose) {
              await log(`   Compare API check: ${aheadBy} commit(s) ahead of ${targetBranchForCompare}`);
            }

            if (aheadBy > 0) {
              compareReady = true;
              await log(`   GitHub compare API ready: ${aheadBy} commit(s) found`);
            } else {
              await log(`   ⚠️ GitHub compare API shows 0 commits ahead (attempt ${compareAttempts}/${maxCompareAttempts})`, { level: 'warning' });
            }
          } else {
            if (argv.verbose) {
              await log(`   Compare API error (attempt ${compareAttempts}/${maxCompareAttempts}): ${compareResult.stdout || compareResult.stderr || 'unknown'}`, { verbose: true });
            }
          }
        }

        if (!compareReady) {
          await log('');
          await log(formatAligned('❌', 'GITHUB SYNC TIMEOUT:', 'Compare API not ready after retries'), { level: 'error' });
          await log('');
          await log('  🔍 What happened:');
          await log(`     After ${maxCompareAttempts} attempts, GitHub's compare API still shows no commits`);
          await log(`     between ${targetBranchForCompare} and ${branchName}.`);
          await log('');
          await log('  💡 This usually means:');
          await log('     • GitHub\'s backend systems haven\'t finished indexing the push');
          await log('     • There\'s a temporary issue with GitHub\'s API');
          await log('     • The commits may not have been pushed correctly');
          await log('');
          await log('  🔧 How to fix:');
          await log('     1. Wait a minute and try creating the PR manually:');
          // For fork mode, use the correct head reference format
          if (argv.fork && forkedRepo) {
            const forkUser = forkedRepo.split('/')[0];
            await log(`        gh pr create --draft --repo ${owner}/${repo} --base ${targetBranchForCompare} --head ${forkUser}:${branchName}`);
          } else {
            await log(`        gh pr create --draft --repo ${owner}/${repo} --base ${targetBranchForCompare} --head ${branchName}`);
          }
          await log('     2. Check if the branch exists on GitHub:');
          // Show the correct repository where the branch was pushed
          const branchRepo = (argv.fork && forkedRepo) ? forkedRepo : `${owner}/${repo}`;
          await log(`        https://github.com/${branchRepo}/tree/${branchName}`);
          await log('     3. Check the commit is on GitHub:');
          // Use the correct head reference for the compare API check
          if (argv.fork && forkedRepo) {
            const forkUser = forkedRepo.split('/')[0];
            await log(`        gh api repos/${owner}/${repo}/compare/${targetBranchForCompare}...${forkUser}:${branchName}`);
          } else {
            await log(`        gh api repos/${owner}/${repo}/compare/${targetBranchForCompare}...${branchName}`);
          }
          await log('');
          throw new Error('GitHub compare API not ready - cannot create PR safely');
        }

        // Verify the push actually worked by checking GitHub API
        // When using fork mode, check the fork repository; otherwise check the original repository
        const repoToCheck = (argv.fork && forkedRepo) ? forkedRepo : `${owner}/${repo}`;
        const branchCheckResult = await $({ silent: true })`gh api repos/${repoToCheck}/branches/${branchName} --jq .name 2>&1`;
        if (branchCheckResult.code === 0 && branchCheckResult.stdout.toString().trim() === branchName) {
          await log(`   Branch verified on GitHub: ${branchName}`);

          // Get the commit SHA from GitHub
          const shaCheckResult = await $({ silent: true })`gh api repos/${repoToCheck}/branches/${branchName} --jq .commit.sha 2>&1`;
          if (shaCheckResult.code === 0) {
            const remoteSha = shaCheckResult.stdout.toString().trim();
            await log(`   Remote commit SHA: ${remoteSha.substring(0, 7)}...`);
          }
        } else {
          await log('   Warning: Branch not found on GitHub!');
          await log('   This will cause PR creation to fail.');

          if (argv.verbose) {
            await log(`   Branch check result: ${branchCheckResult.stdout || branchCheckResult.stderr || 'empty'}`);

            // Show all branches on GitHub
            const allBranchesResult = await $({ silent: true })`gh api repos/${repoToCheck}/branches --jq '.[].name' 2>&1`;
            if (allBranchesResult.code === 0) {
              await log(`   All GitHub branches: ${allBranchesResult.stdout.toString().split('\n').slice(0, 5).join(', ')}...`);
            }
          }

          // Try one more push with explicit ref (without force)
          await log('   Attempting explicit push...');
          const explicitPushCmd = `git push origin HEAD:refs/heads/${branchName}`;
          if (argv.verbose) {
            await log(`   Command: ${explicitPushCmd}`);
          }
          const explicitPushResult = await $`cd ${tempDir} && ${explicitPushCmd} 2>&1`;
          if (explicitPushResult.code === 0) {
            await log('   Explicit push completed');
            if (argv.verbose && explicitPushResult.stdout) {
              await log(`   Output: ${explicitPushResult.stdout.toString().trim()}`);
            }
            // Wait a bit more for GitHub to process
            await new Promise(resolve => setTimeout(resolve, 3000));
          } else {
            await log('   ERROR: Cannot push to GitHub!');
            await log(`   Error: ${explicitPushResult.stderr || explicitPushResult.stdout || 'Unknown'}`);
            await log('   Force push is not allowed to preserve history');
          }
        }

        // Get issue title for PR title
        await log(formatAligned('📋', 'Getting issue:', 'Title from GitHub...'), { verbose: true });
        const issueTitleResult = await $({ silent: true })`gh api repos/${owner}/${repo}/issues/${issueNumber} --jq .title 2>&1`;
        let issueTitle = `Fix issue #${issueNumber}`;
        if (issueTitleResult.code === 0) {
          issueTitle = issueTitleResult.stdout.toString().trim();
          await log(`   Issue title: "${issueTitle}"`, { verbose: true });
        } else {
          await log('   Warning: Could not get issue title, using default', { verbose: true });
        }

        // Get current GitHub user to set as assignee (but validate it's a collaborator)
        await log(formatAligned('👤', 'Getting user:', 'Current GitHub account...'), { verbose: true });
        const currentUserResult = await $({ silent: true })`gh api user --jq .login 2>&1`;
        let currentUser = null;
        let canAssign = false;

        if (currentUserResult.code === 0) {
          currentUser = currentUserResult.stdout.toString().trim();
          await log(`   Current user: ${currentUser}`, { verbose: true });

          // Check if user has push access (is a collaborator or owner)
          // IMPORTANT: We need to completely suppress the JSON error output
          // Using execSync to have full control over stderr
          try {
            const { execSync } = await import('child_process');
            // This will throw if user doesn't have access, but won't print anything
            execSync(`gh api repos/${owner}/${repo}/collaborators/${currentUser} 2>/dev/null`,
                      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
            canAssign = true;
            await log('   User has collaborator access', { verbose: true });
          } catch (e) {
            reportError(e, {
              context: 'collaborator_check',
              owner,
              repo,
              currentUser,
              operation: 'check_collaborator_access'
            });
            // User doesn't have permission, but that's okay - we just won't assign
            canAssign = false;
            await log('   User is not a collaborator (will skip assignment)', { verbose: true });
          }

          // Set permCheckResult for backward compatibility
          const permCheckResult = { code: canAssign ? 0 : 1 };
          if (permCheckResult.code === 0) {
            canAssign = true;
            await log('   User has collaborator access', { verbose: true });
          } else {
            // User doesn't have permission, but that's okay - we just won't assign
            await log('   User is not a collaborator (will skip assignment)', { verbose: true });
          }
        } else {
          await log('   Warning: Could not get current user', { verbose: true });
        }

        // Fetch latest state of target branch to ensure accurate comparison
        const targetBranch = argv.baseBranch || defaultBranch;
        await log(formatAligned('🔄', 'Fetching:', `Latest ${targetBranch} branch...`));
        const fetchBaseResult = await $({ cwd: tempDir, silent: true })`git fetch origin ${targetBranch}:refs/remotes/origin/${targetBranch} 2>&1`;

        if (fetchBaseResult.code !== 0) {
          await log(`⚠️ Warning: Could not fetch latest ${targetBranch}`, { level: 'warning' });
          if (argv.verbose) {
            await log(`   Fetch output: ${fetchBaseResult.stdout || fetchBaseResult.stderr || 'none'}`, { verbose: true });
          }
        } else {
          await log(formatAligned('✅', 'Base updated:', `Fetched latest ${targetBranch}`));
        }

        // Verify there are commits between base and head before attempting PR creation
        await log(formatAligned('🔍', 'Checking:', 'Commits between branches...'));
        const commitCheckResult = await $({ cwd: tempDir, silent: true })`git rev-list --count origin/${targetBranch}..HEAD 2>&1`;

        if (commitCheckResult.code === 0) {
          const commitCount = parseInt(commitCheckResult.stdout.toString().trim(), 10);
          if (argv.verbose) {
            await log(`   Commits ahead of origin/${targetBranch}: ${commitCount}`, { verbose: true });
          }

          if (commitCount === 0) {
            // Check if the branch was already merged
            const mergedCheckResult = await $({ cwd: tempDir, silent: true })`git branch -r --merged origin/${targetBranch} | grep -q "origin/${branchName}" 2>&1`;
            const wasAlreadyMerged = mergedCheckResult.code === 0;

            // No commits to create PR - branch is up to date with base or behind it
            await log('');
            await log(formatAligned('❌', 'NO COMMITS TO CREATE PR', ''), { level: 'error' });
            await log('');
            await log('  🔍 What happened:');
            await log(`     The branch ${branchName} has no new commits compared to ${targetBranch}.`);

            if (wasAlreadyMerged) {
              await log(`     ✅ This branch was already merged into ${targetBranch}.`);
              await log('');
              await log('  📋 Branch Status: ALREADY MERGED');
              await log('');
              await log('  💡 This means:');
              await log('     • The work on this branch has been completed and integrated');
              await log('     • A new branch should be created for any additional work');
              await log('     • The issue may already be resolved');
            } else {
              await log(`     This means all commits in this branch are already in ${targetBranch}.`);
            }

            await log('');
            await log('  💡 Possible causes:');
            if (wasAlreadyMerged) {
              await log('     • ✅ The branch was already merged (confirmed)');
            } else {
              await log('     • The branch was already merged');
            }
            await log('     • The branch is outdated and needs to be rebased');
            await log(`     • Local ${targetBranch} is outdated (though we just fetched it)`);
            await log('');
            await log('  🔧 How to fix:');
            await log('');

            if (wasAlreadyMerged) {
              await log('     Option 1: Check the merged PR and close the issue');
              await log(`        gh pr list --repo ${owner}/${repo} --head ${branchName} --state merged`);
              await log('        If the issue is resolved, close it. Otherwise, create a new branch.');
            } else {
              await log('     Option 1: Check if branch was already merged');
              await log(`        gh pr list --repo ${owner}/${repo} --head ${branchName} --state merged`);
              await log('        If merged, you may want to close the related issue or create a new branch');
            }

            await log('');
            await log('     Option 2: Verify branch state');
            await log(`        cd ${tempDir}`);
            await log(`        git log ${targetBranch}..${branchName} --oneline`);
            await log(`        git log origin/${targetBranch}..${branchName} --oneline`);
            await log('');
            await log('     Option 3: Create new commits on this branch');
            await log('        The branch exists but has no new work to contribute');
            await log('');

            if (wasAlreadyMerged) {
              throw new Error('Branch was already merged into base - cannot create PR');
            } else {
              throw new Error('No commits between base and head - cannot create PR');
            }
          } else {
            await log(formatAligned('✅', 'Commits found:', `${commitCount} commit(s) ahead`));
          }
        } else {
          await log('⚠️ Warning: Could not verify commit count', { level: 'warning' });
          if (argv.verbose) {
            await log(`   Check output: ${commitCheckResult.stdout || commitCheckResult.stderr || 'none'}`, { verbose: true });
          }
        }

        // Create draft pull request
        await log(formatAligned('🔀', 'Creating PR:', 'Draft pull request...'));
        if (argv.baseBranch) {
          await log(formatAligned('🎯', 'Target branch:', `${targetBranch} (custom)`));
        } else {
          await log(formatAligned('🎯', 'Target branch:', `${targetBranch} (default)`));
        }

        // Use full repository reference for cross-repo PRs (forks)
        const issueRef = argv.fork ? `${owner}/${repo}#${issueNumber}` : `#${issueNumber}`;

        const prBody = `## 🤖 AI-Powered Solution Draft

This pull request is being automatically generated to solve issue ${issueRef}.

### 📋 Issue Reference
Fixes ${issueRef}

### 🚧 Status
**Work in Progress** - The AI assistant is currently analyzing and implementing the solution draft.

### 📝 Implementation Details
_Details will be added as the solution draft is developed..._

---
*This PR was created automatically by the AI issue solver*`;

        if (argv.verbose) {
          await log(`   PR Title: [WIP] ${issueTitle}`, { verbose: true });
          await log(`   Base branch: ${defaultBranch}`, { verbose: true });
          await log(`   Head branch: ${branchName}`, { verbose: true });
          if (currentUser) {
            await log(`   Assignee: ${currentUser}`, { verbose: true });
          }
          await log(`   PR Body:
${prBody}`, { verbose: true });
        }

        // Use execSync for gh pr create to avoid command-stream output issues
        // Similar to how create-test-repo.mjs handles it
        try {
          const { execSync } = await import('child_process');

          // Write PR body to temp file to avoid shell escaping issues
          const prBodyFile = `/tmp/pr-body-${Date.now()}.md`;
          await fs.writeFile(prBodyFile, prBody);

          // Write PR title to temp file to avoid shell escaping issues with quotes/apostrophes
          // This solves the issue where titles containing apostrophes (e.g., "don't") would cause
          // "Unterminated quoted string" errors
          const prTitle = `[WIP] ${issueTitle}`;
          const prTitleFile = `/tmp/pr-title-${Date.now()}.txt`;
          await fs.writeFile(prTitleFile, prTitle);

          // Build command with optional assignee and handle forks
          // Note: targetBranch is already defined above
          // IMPORTANT: Use --title-file instead of --title to avoid shell parsing issues with special characters
          let command;
          if (argv.fork && forkedRepo) {
            // For forks, specify the full head reference
            const forkUser = forkedRepo.split('/')[0];
            command = `cd "${tempDir}" && gh pr create --draft --title "$(cat '${prTitleFile}')" --body-file "${prBodyFile}" --base ${targetBranch} --head ${forkUser}:${branchName} --repo ${owner}/${repo}`;
          } else {
            command = `cd "${tempDir}" && gh pr create --draft --title "$(cat '${prTitleFile}')" --body-file "${prBodyFile}" --base ${targetBranch} --head ${branchName}`;
          }
          // Only add assignee if user has permissions
          if (currentUser && canAssign) {
            command += ` --assignee ${currentUser}`;
          }

          if (argv.verbose) {
            await log(`   Command: ${command}`, { verbose: true });
          }

          let output;
          let assigneeFailed = false;

          // Try to create PR with assignee first (if specified)
          try {
            output = execSync(command, { encoding: 'utf8', cwd: tempDir });
          } catch (firstError) {
            // Check if the error is specifically about assignee validation
            const errorMsg = firstError.message || '';
            if ((errorMsg.includes('could not assign user') || errorMsg.includes('not found')) && currentUser && canAssign) {
              // Assignee validation failed - retry without assignee
              assigneeFailed = true;
              await log('');
              await log(formatAligned('⚠️', 'Warning:', `User assignment failed for '${currentUser}'`), { level: 'warning' });
              await log('     Retrying PR creation without assignee...');

              // Rebuild command without --assignee flag
              if (argv.fork && forkedRepo) {
                const forkUser = forkedRepo.split('/')[0];
                command = `cd "${tempDir}" && gh pr create --draft --title "$(cat '${prTitleFile}')" --body-file "${prBodyFile}" --base ${targetBranch} --head ${forkUser}:${branchName} --repo ${owner}/${repo}`;
              } else {
                command = `cd "${tempDir}" && gh pr create --draft --title "$(cat '${prTitleFile}')" --body-file "${prBodyFile}" --base ${targetBranch} --head ${branchName}`;
              }

              if (argv.verbose) {
                await log(`   Retry command (without assignee): ${command}`, { verbose: true });
              }

              // Retry without assignee - if this fails, let the error propagate to outer catch
              output = execSync(command, { encoding: 'utf8', cwd: tempDir });
            } else {
              // Not an assignee error, re-throw the original error
              throw firstError;
            }
          }

          // Clean up temp files
          await fs.unlink(prBodyFile).catch((unlinkError) => {
            reportError(unlinkError, {
              context: 'pr_body_file_cleanup',
              prBodyFile,
              operation: 'delete_temp_file'
            });
          });
          await fs.unlink(prTitleFile).catch((unlinkError) => {
            reportError(unlinkError, {
              context: 'pr_title_file_cleanup',
              prTitleFile,
              operation: 'delete_temp_file'
            });
          });

          // Extract PR URL from output - gh pr create outputs the URL to stdout
          prUrl = output.trim();

          if (!prUrl) {
            await log('⚠️ Warning: PR created but no URL returned', { level: 'warning' });
            await log(`   Output: ${output}`, { verbose: true });

            // Try to get the PR URL using gh pr list
            await log('   Attempting to find PR using gh pr list...', { verbose: true });
            const prListResult = await $`cd ${tempDir} && gh pr list --head ${branchName} --json url --jq '.[0].url'`;
            if (prListResult.code === 0 && prListResult.stdout.toString().trim()) {
              prUrl = prListResult.stdout.toString().trim();
              await log(`   Found PR URL: ${prUrl}`, { verbose: true });
            }
          }

          // Extract PR number from URL
          if (prUrl) {
            const prMatch = prUrl.match(/\/pull\/(\d+)/);
            if (prMatch) {
              localPrNumber = prMatch[1];

              // CRITICAL: Verify the PR was actually created by querying GitHub API
              // This is essential because gh pr create can return a URL but PR creation might have failed
              await log(formatAligned('🔍', 'Verifying:', 'PR creation...'), { verbose: true });
              const verifyResult = await $({ silent: true })`gh pr view ${localPrNumber} --repo ${owner}/${repo} --json number,url,state 2>&1`;

              if (verifyResult.code === 0) {
                try {
                  const prData = JSON.parse(verifyResult.stdout.toString().trim());
                  if (prData.number && prData.url) {
                    await log(formatAligned('✅', 'Verification:', 'PR exists on GitHub'), { verbose: true });
                    // Update prUrl and localPrNumber from verified data
                    prUrl = prData.url;
                    localPrNumber = String(prData.number);
                  } else {
                    throw new Error('PR data incomplete');
                  }
                } catch {
                  await log('❌ PR verification failed: Could not parse PR data', { level: 'error' });
                  throw new Error('PR creation verification failed - invalid response');
                }
              } else {
                // PR does not exist - gh pr create must have failed silently
                await log('');
                await log(formatAligned('❌', 'FATAL ERROR:', 'PR creation failed'), { level: 'error' });
                await log('');
                await log('  🔍 What happened:');
                await log('     The gh pr create command returned a URL, but the PR does not exist on GitHub.');
                await log('');
                await log('  🔧 How to fix:');
                await log('     1. Check if PR exists manually:');
                await log(`        gh pr list --repo ${owner}/${repo} --head ${branchName}`);
                await log('     2. Try creating PR manually:');
                await log(`        cd ${tempDir}`);
                await log(`        gh pr create --draft --title "Fix issue #${issueNumber}" --body "Fixes #${issueNumber}"`);
                await log('     3. Check GitHub authentication:');
                await log('        gh auth status');
                await log('');
                throw new Error('PR creation failed - PR does not exist on GitHub');
              }
              // Store PR info globally for error handlers
              global.createdPR = { number: localPrNumber, url: prUrl };
              await log(formatAligned('✅', 'PR created:', `#${localPrNumber}`));
              await log(formatAligned('📍', 'PR URL:', prUrl));
              if (assigneeFailed) {
                // Show detailed information about why assignee failed and how to fix it
                await log('');
                await log(formatAligned('⚠️', 'Assignee Note:', 'PR created without assignee'));
                await log('');
                await log(`  The PR was created successfully, but user '${currentUser}' could not be assigned.`);
                await log('');
                await log('  📋 Why this happened:');
                await log(`     • User '${currentUser}' may not have collaborator access to ${owner}/${repo}`);
                await log('     • GitHub requires users to be repository collaborators to be assigned');
                await log('     • The GitHub CLI enforces strict assignee validation');
                await log('');
                await log('  🔧 How to fix:');
                await log('');
                await log('     Option 1: Assign manually in the PR page');
                await log('     ─────────────────────────────────────────');
                await log(`     1. Visit the PR: ${prUrl}`);
                await log('     2. Click "Assignees" in the right sidebar');
                await log('     3. Add yourself to the PR');
                await log('');
                await log('     Option 2: Request collaborator access');
                await log('     ─────────────────────────────────────────');
                await log('     Ask the repository owner to add you as a collaborator:');
                await log(`       → Go to: https://github.com/${owner}/${repo}/settings/access`);
                await log(`       → Add user: ${currentUser}`);
                await log('');
                await log('  ℹ️  Note: This does not affect the PR itself - it was created successfully.');
                await log('');
              } else if (currentUser && canAssign) {
                await log(formatAligned('👤', 'Assigned to:', currentUser));
              } else if (currentUser && !canAssign) {
                await log(formatAligned('ℹ️', 'Note:', 'Could not assign (no permission)'));
              }

              // CLAUDE.md will be removed after Claude command completes

              // Link the issue to the PR in GitHub's Development section using GraphQL API
              await log(formatAligned('🔗', 'Linking:', `Issue #${issueNumber} to PR #${localPrNumber}...`));
              try {
                // First, get the node IDs for both the issue and the PR
                const issueNodeResult = await $`gh api graphql -f query='query { repository(owner: "${owner}", name: "${repo}") { issue(number: ${issueNumber}) { id } } }' --jq .data.repository.issue.id`;

                if (issueNodeResult.code !== 0) {
                  throw new Error(`Failed to get issue node ID: ${issueNodeResult.stderr}`);
                }

                const issueNodeId = issueNodeResult.stdout.toString().trim();
                await log(`   Issue node ID: ${issueNodeId}`, { verbose: true });

                const prNodeResult = await $`gh api graphql -f query='query { repository(owner: "${owner}", name: "${repo}") { pullRequest(number: ${localPrNumber}) { id } } }' --jq .data.repository.pullRequest.id`;

                if (prNodeResult.code !== 0) {
                  throw new Error(`Failed to get PR node ID: ${prNodeResult.stderr}`);
                }

                const prNodeId = prNodeResult.stdout.toString().trim();
                await log(`   PR node ID: ${prNodeId}`, { verbose: true });

                // Now link them using the GraphQL mutation
                // GitHub automatically creates the link when we use "Fixes #" or "Fixes owner/repo#"
                // The Development section link is created automatically by GitHub when:
                // 1. The PR body contains "Fixes #N", "Closes #N", or "Resolves #N"
                // 2. For cross-repo (fork) PRs, we need "Fixes owner/repo#N"

                // Let's verify the link was created
                const linkCheckResult = await $`gh api graphql -f query='query { repository(owner: "${owner}", name: "${repo}") { pullRequest(number: ${localPrNumber}) { closingIssuesReferences(first: 10) { nodes { number } } } } }' --jq '.data.repository.pullRequest.closingIssuesReferences.nodes[].number'`;

                if (linkCheckResult.code === 0) {
                  const linkedIssues = linkCheckResult.stdout.toString().trim().split('\n').filter(n => n);
                  if (linkedIssues.includes(issueNumber)) {
                    await log(formatAligned('✅', 'Link verified:', `Issue #${issueNumber} → PR #${localPrNumber}`));
                  } else {
                    // This is a problem - the link wasn't created
                    await log('');
                    await log(formatAligned('⚠️', 'ISSUE LINK MISSING:', 'PR not linked to issue'), { level: 'warning' });
                    await log('');

                    if (argv.fork) {
                      await log('   The PR was created from a fork but wasn\'t linked to the issue.', { level: 'warning' });
                      await log(`   Expected: "Fixes ${owner}/${repo}#${issueNumber}" in PR body`, { level: 'warning' });
                      await log('');
                      await log('   To fix manually:', { level: 'warning' });
                      await log(`   1. Edit the PR description at: ${prUrl}`, { level: 'warning' });
                      await log(`   2. Add this line: Fixes ${owner}/${repo}#${issueNumber}`, { level: 'warning' });
                    } else {
                      await log(`   The PR wasn't linked to issue #${issueNumber}`, { level: 'warning' });
                      await log(`   Expected: "Fixes #${issueNumber}" in PR body`, { level: 'warning' });
                      await log('');
                      await log('   To fix manually:', { level: 'warning' });
                      await log(`   1. Edit the PR description at: ${prUrl}`, { level: 'warning' });
                      await log(`   2. Ensure it contains: Fixes #${issueNumber}`, { level: 'warning' });
                    }
                    await log('');
                  }
                } else {
                  // Could not verify but show what should have been used
                  const expectedRef = argv.fork ? `${owner}/${repo}#${issueNumber}` : `#${issueNumber}`;
                  await log('⚠️ Could not verify issue link (API error)', { level: 'warning' });
                  await log(`   PR body should contain: "Fixes ${expectedRef}"`, { level: 'warning' });
                  await log(`   Please verify manually at: ${prUrl}`, { level: 'warning' });
                }
              } catch (linkError) {
                reportError(linkError, {
                  context: 'pr_issue_link_verification',
                  prUrl,
                  issueNumber,
                  operation: 'verify_issue_link'
                });
                const expectedRef = argv.fork ? `${owner}/${repo}#${issueNumber}` : `#${issueNumber}`;
                await log(`⚠️ Could not verify issue linking: ${linkError.message}`, { level: 'warning' });
                await log(`   PR body should contain: "Fixes ${expectedRef}"`, { level: 'warning' });
                await log(`   Please check manually at: ${prUrl}`, { level: 'warning' });
              }
            } else {
              await log(formatAligned('✅', 'PR created:', 'Successfully'));
              await log(formatAligned('📍', 'PR URL:', prUrl));
            }

            // CLAUDE.md will be removed after Claude command completes
          } else {
            await log('⚠️ Draft pull request created but URL could not be determined', { level: 'warning' });
          }
        } catch (prCreateError) {
          reportError(prCreateError, {
            context: 'pr_creation',
            issueNumber,
            branchName,
            operation: 'create_pull_request'
          });
          const errorMsg = prCreateError.message || '';

          // Clean up the error message - extract the meaningful part
          let cleanError = errorMsg;
          if (errorMsg.includes('pull request create failed:')) {
            cleanError = errorMsg.split('pull request create failed:')[1].trim();
          } else if (errorMsg.includes('Command failed:')) {
            // Extract just the error part, not the full command
            const lines = errorMsg.split('\n');
            cleanError = lines[lines.length - 1] || errorMsg;
          }

          // Check for specific error types
          // Note: Assignee errors are now handled by automatic retry in the try block above
          // This catch block only handles other types of PR creation failures
          if (errorMsg.includes('No commits between') || errorMsg.includes('Head sha can\'t be blank')) {
            // Empty PR error
            await log('');
            await log(formatAligned('❌', 'PR CREATION FAILED', ''), { level: 'error' });
            await log('');
            await log('  🔍 What happened:');
            await log('     Cannot create PR - no commits between branches.');
            await log('');
            await log('  📦 Error details:');
            for (const line of cleanError.split('\n')) {
              if (line.trim()) await log(`     ${line.trim()}`);
            }
            await log('');
            await log('  💡 Possible causes:');
            await log('     • The branch wasn\'t pushed properly');
            await log('     • The commit wasn\'t created');
            await log('     • GitHub sync issue');
            await log('');
            await log('  🔧 How to fix:');
            await log('     1. Verify commit exists:');
            await log(`        cd ${tempDir} && git log --format="%h %s" -5`);
            await log('     2. Push again with tracking:');
            await log(`        cd ${tempDir} && git push -u origin ${branchName}`);
            await log('     3. Create PR manually:');
            await log(`        cd ${tempDir} && gh pr create --draft`);
            await log('');
            await log(`  📂 Working directory: ${tempDir}`);
            await log(`  🌿 Current branch: ${branchName}`);
            await log('');
            throw new Error('PR creation failed - no commits between branches');
          } else {
            // Generic PR creation error
            await log('');
            await log(formatAligned('❌', 'PR CREATION FAILED', ''), { level: 'error' });
            await log('');
            await log('  🔍 What happened:');
            await log('     Failed to create pull request.');
            await log('');
            await log('  📦 Error details:');
            for (const line of cleanError.split('\n')) {
              if (line.trim()) await log(`     ${line.trim()}`);
            }
            await log('');
            await log('  🔧 How to fix:');
            await log('     1. Try creating PR manually:');
            await log(`        cd ${tempDir} && gh pr create --draft`);
            await log('     2. Check branch status:');
            await log(`        cd ${tempDir} && git status`);
            await log('     3. Verify GitHub authentication:');
            await log('        gh auth status');
            await log('');
            throw new Error('PR creation failed');
          }
        }
      }
    }
  } catch (prError) {
    reportError(prError, {
      context: 'auto_pr_creation',
      issueNumber,
      operation: 'handle_auto_pr'
    });

    // CRITICAL: PR creation failure should stop the entire process
    // We cannot continue without a PR when auto-PR creation is enabled
    await log('');
    await log(formatAligned('❌', 'FATAL ERROR:', 'PR creation failed'), { level: 'error' });
    await log('');
    await log('  🔍 What this means:');
    await log('     The solve command cannot continue without a pull request.');
    await log('     Auto-PR creation is enabled but failed to create the PR.');
    await log('');
    await log('  📦 Error details:');
    await log(`     ${prError.message}`);
    await log('');
    await log('  🔧 How to fix:');
    await log('');
    await log('  Option 1: Retry without auto-PR creation');
    await log(`     ./solve.mjs "${issueUrl}" --no-auto-pull-request-creation`);
    await log('     (Claude will create the PR during the session)');
    await log('');
    await log('  Option 2: Create PR manually first');
    await log(`     cd ${tempDir}`);
    await log(`     gh pr create --draft --title "Fix issue #${issueNumber}" --body "Fixes #${issueNumber}"`);
    await log(`     Then use: ./solve.mjs "${issueUrl}" --continue`);
    await log('');
    await log('  Option 3: Debug the issue');
    await log(`     cd ${tempDir}`);
    await log('     git status');
    await log('     git log --oneline -5');
    await log('     gh pr create --draft  # Try manually to see detailed error');
    await log('');

    // Re-throw the error to stop execution
    throw new Error(`PR creation failed: ${prError.message}`);
  }

  return { prUrl, prNumber: localPrNumber, claudeCommitHash };
}