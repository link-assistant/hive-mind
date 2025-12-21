#!/usr/bin/env node

// Repository management module for solve command
// Extracted from solve.mjs to keep files under 1500 lines

// Use use-m to dynamically import modules for cross-runtime compatibility
// Check if use is already defined globally (when imported from solve.mjs)
// If not, fetch it (when running standalone)
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const use = globalThis.use;

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

const os = (await use('os')).default;
const path = (await use('path')).default;
const fs = (await use('fs')).promises;

// Import shared library functions
const lib = await import('./lib.mjs');
// Import Sentry integration
const sentryLib = await import('./sentry.lib.mjs');
const { reportError } = sentryLib;

const {
  log,
  formatAligned
} = lib;

// Import exit handler
import { safeExit } from './exit-handler.lib.mjs';

// Import GitHub utilities for permission checks
const githubLib = await import('./github.lib.mjs');
const { checkRepositoryWritePermission } = githubLib;

// Get the root repository of any repository
// Returns the source (root) repository if the repo is a fork, otherwise returns the repo itself
export const getRootRepository = async (owner, repo) => {
  try {
    const result = await $`gh api repos/${owner}/${repo} --jq '{fork: .fork, source: .source.full_name}'`;

    if (result.code !== 0) {
      return null;
    }

    const repoInfo = JSON.parse(result.stdout.toString().trim());

    if (repoInfo.fork && repoInfo.source) {
      return repoInfo.source;
    } else {
      return `${owner}/${repo}`;
    }
  } catch (error) {
    reportError(error, {
      context: 'get_root_repository',
      owner,
      repo,
      operation: 'determine_fork_root'
    });
    return null;
  }
};

// Check if current user has a fork of the given root repository
export const checkExistingForkOfRoot = async (rootRepo) => {
  try {
    const userResult = await $`gh api user --jq .login`;
    if (userResult.code !== 0) {
      return null;
    }
    const currentUser = userResult.stdout.toString().trim();

    const forksResult = await $`gh api repos/${rootRepo}/forks --paginate --jq '.[] | select(.owner.login == "${currentUser}") | .full_name'`;

    if (forksResult.code !== 0) {
      return null;
    }

    const forks = forksResult.stdout.toString().trim().split('\n').filter(f => f);

    if (forks.length > 0) {
      return forks[0];
    } else {
      return null;
    }
  } catch (error) {
    reportError(error, {
      context: 'check_existing_fork_of_root',
      rootRepo,
      operation: 'search_user_forks'
    });
    return null;
  }
};

// Create or find temporary directory for cloning the repository
export const setupTempDirectory = async (argv) => {
  let tempDir;
  let isResuming = argv.resume;

  if (isResuming) {
    // When resuming, try to find existing directory or create a new one
    const scriptDir = path.dirname(process.argv[1]);
    const sessionLogPattern = path.join(scriptDir, `${argv.resume}.log`);

    try {
      // Check if session log exists to verify session is valid
      await fs.access(sessionLogPattern);
      await log(`🔄 Resuming session ${argv.resume} (session log found)`);

      // For resumed sessions, create new temp directory since old one may be cleaned up
      tempDir = path.join(os.tmpdir(), `gh-issue-solver-resume-${argv.resume}-${Date.now()}`);
      await fs.mkdir(tempDir, { recursive: true });
      await log(`Creating new temporary directory for resumed session: ${tempDir}`);
    } catch (err) {
      reportError(err, {
        context: 'resume_session_lookup',
        sessionId: argv.resume,
        operation: 'find_session_log'
      });
      await log(`Warning: Session log for ${argv.resume} not found, but continuing with resume attempt`);
      tempDir = path.join(os.tmpdir(), `gh-issue-solver-resume-${argv.resume}-${Date.now()}`);
      await fs.mkdir(tempDir, { recursive: true });
      await log(`Creating temporary directory for resumed session: ${tempDir}`);
    }
  } else {
    tempDir = path.join(os.tmpdir(), `gh-issue-solver-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    await log(`\nCreating temporary directory: ${tempDir}`);
  }

  return { tempDir, isResuming };
};

// Try to initialize an empty repository by creating a simple README.md
// This makes the repository forkable
const tryInitializeEmptyRepository = async (owner, repo) => {
  try {
    await log(`${formatAligned('🔧', 'Auto-fix:', 'Attempting to initialize empty repository...')}`);

    // Check write access before attempting to create files
    await log(`${formatAligned('', '', 'Checking repository write access...')}`);
    const hasWriteAccess = await checkRepositoryWritePermission(owner, repo, { useFork: false });

    if (!hasWriteAccess) {
      await log(`${formatAligned('❌', 'No access:', 'You do not have write access to this repository')}`);
      await log(`${formatAligned('', '', 'Cannot initialize empty repository without write access')}`);
      return false;
    }

    await log(`${formatAligned('', '', 'Creating a simple README.md to make repository forkable')}`);

    // Create simple README content with just the repository name
    const readmeContent = `# ${repo}\n`;
    const base64Content = Buffer.from(readmeContent).toString('base64');

    // Try to create README.md using GitHub API
    const createResult = await $`gh api repos/${owner}/${repo}/contents/README.md --method PUT --silent \
      --field message="Initialize repository with README" \
      --field content="${base64Content}" 2>&1`;

    if (createResult.code === 0) {
      await log(`${formatAligned('✅', 'Success:', 'README.md created successfully')}`);
      await log(`${formatAligned('', '', 'Repository is now forkable, retrying fork creation...')}`);
      return true;
    } else {
      const errorOutput = createResult.stdout.toString() + createResult.stderr.toString();
      // Check if it's a permission error
      if (errorOutput.includes('403') || errorOutput.includes('Forbidden') ||
          errorOutput.includes('not have permission') || errorOutput.includes('Resource not accessible')) {
        await log(`${formatAligned('❌', 'No access:', 'You do not have write access to this repository')}`);
        return false;
      } else {
        await log(`${formatAligned('❌', 'Failed:', 'Could not create README.md')}`);
        await log(`   Error: ${errorOutput.split('\n')[0]}`);
        return false;
      }
    }
  } catch (error) {
    reportError(error, {
      context: 'initialize_empty_repository',
      owner,
      repo,
      operation: 'create_readme'
    });
    await log(`${formatAligned('❌', 'Error:', 'Failed to initialize repository')}`);
    return false;
  }
};

// Handle fork creation and repository setup
export const setupRepository = async (argv, owner, repo, forkOwner = null, issueUrl = null) => {
  let repoToClone = `${owner}/${repo}`;
  let forkedRepo = null;
  let upstreamRemote = null;

  // Priority 1: Check --fork flag first (user explicitly wants to use their own fork)
  // This takes precedence over forkOwner to avoid trying to access someone else's fork
  if (argv.fork) {
    await log(`\n${formatAligned('🍴', 'Fork mode:', 'ENABLED')}`);
    await log(`${formatAligned('', 'Checking fork status...', '')}\n`);

    // Get current user
    const userResult = await $`gh api user --jq .login`;
    if (userResult.code !== 0) {
      await log(`${formatAligned('❌', 'Error:', 'Failed to get current user')}`);
      await safeExit(1, 'Repository setup failed');
    }
    const currentUser = userResult.stdout.toString().trim();

    // Check for fork conflicts (Issue #344)
    // Detect if we're trying to fork a repository that shares the same root
    // as an existing fork we already have
    await log(`${formatAligned('🔍', 'Detecting fork conflicts...', '')}`);
    const rootRepo = await getRootRepository(owner, repo);

    if (rootRepo) {
      const existingFork = await checkExistingForkOfRoot(rootRepo);

      if (existingFork) {
        const existingForkOwner = existingFork.split('/')[0];

        if (existingForkOwner === currentUser) {
          const targetRepo = `${owner}/${repo}`;
          const targetIsRoot = (targetRepo === rootRepo);

          if (!targetIsRoot) {
            await log('');
            await log(`${formatAligned('❌', 'FORK CONFLICT DETECTED', '')}`, { level: 'error' });
            await log('');
            await log('  🔍 What happened:');
            await log(`     You are trying to fork ${targetRepo}`);
            await log(`     But you already have a fork of ${rootRepo}: ${existingFork}`);
            await log('     GitHub doesn\'t allow multiple forks of the same root repository');
            await log('');
            await log('  📦 Root repository analysis:');
            await log(`     • Target repository: ${targetRepo}`);
            await log(`     • Root repository: ${rootRepo}`);
            await log(`     • Your existing fork: ${existingFork}`);
            await log('');
            await log('  ⚠️  Why this is a problem:');
            await log('     GitHub treats forks hierarchically. When you fork a repository,');
            await log('     GitHub tracks the original source repository. If you try to fork');
            await log('     a different fork of the same source, GitHub will silently use your');
            await log('     existing fork instead, causing PRs to be created in the wrong place.');
            await log('');
            await log('  💡 How to fix:');
            await log(`     1. Delete your existing fork: gh repo delete ${existingFork}`);
            await log(`     2. Then run this command again to fork ${targetRepo}`);
            await log('');
            await log('  ℹ️  Alternative:');
            await log(`     If you want to work on ${targetRepo}, you can work directly`);
            await log('     on that repository without forking (if you have write access).');
            await log('');
            await safeExit(1, 'Repository setup failed due to fork conflict');
          }
        }
      }

      await log(`${formatAligned('✅', 'No fork conflict:', 'Safe to proceed')}`);
    } else {
      await log(`${formatAligned('⚠️', 'Warning:', 'Could not determine root repository')}`);
    }

    // Check if fork already exists
    // GitHub may create forks with different names to avoid conflicts
    // Try standard name first: currentUser/repo
    // If --prefix-fork-name-with-owner-name is enabled, prefer owner-repo format
    let existingForkName = null;
    const standardForkName = `${currentUser}/${repo}`;
    const prefixedForkName = `${currentUser}/${owner}-${repo}`;

    // Determine expected fork name based on --prefix-fork-name-with-owner-name option
    const expectedForkName = argv.prefixForkNameWithOwnerName ? prefixedForkName : standardForkName;
    const alternateForkName = argv.prefixForkNameWithOwnerName ? standardForkName : prefixedForkName;

    let forkCheckResult = await $`gh repo view ${expectedForkName} --json name 2>/dev/null`;
    if (forkCheckResult.code === 0) {
      existingForkName = expectedForkName;
    } else if (!argv.prefixForkNameWithOwnerName) {
      // Only check alternate name if NOT using --prefix-fork-name-with-owner-name
      // When the option is enabled, we ONLY want to use/create the prefixed fork
      // This prevents falling back to an existing standard fork which would cause
      // Compare API 404 errors since branches are in different fork repositories
      forkCheckResult = await $`gh repo view ${alternateForkName} --json name 2>/dev/null`;
      if (forkCheckResult.code === 0) {
        existingForkName = alternateForkName;
      }
    } else {
      // Check if alternate (standard) fork exists when prefix option is enabled
      // If it does, warn user since we won't be using it
      const standardForkCheck = await $`gh repo view ${alternateForkName} --json name 2>/dev/null`;
      if (standardForkCheck.code === 0) {
        await log(`${formatAligned('ℹ️', 'Note:', `Standard fork ${alternateForkName} exists but won't be used`)}`);
        await log(`   Creating prefixed fork ${expectedForkName} instead (--prefix-fork-name-with-owner-name enabled)`);
      }
    }

    if (existingForkName) {
      // Fork exists
      await log(`${formatAligned('✅', 'Fork exists:', existingForkName)}`);
      repoToClone = existingForkName;
      forkedRepo = existingForkName;
      upstreamRemote = `${owner}/${repo}`;
    } else {
      // Need to create fork with retry logic for concurrent scenarios
      await log(`${formatAligned('🔄', 'Creating fork...', '')}`);

      const maxForkRetries = 5;
      const baseDelay = 2000; // Start with 2 seconds
      let forkCreated = false;
      let forkExists = false;

      // Determine the expected fork name based on --prefix-fork-name-with-owner-name option
      const defaultForkName = argv.prefixForkNameWithOwnerName ? `${owner}-${repo}` : repo;
      let actualForkName = `${currentUser}/${defaultForkName}`;

      for (let attempt = 1; attempt <= maxForkRetries; attempt++) {
        // Try to create fork with optional custom name
        let forkResult;
        if (argv.prefixForkNameWithOwnerName) {
          // Use --fork-name flag to create fork with owner prefix
          forkResult = await $`gh repo fork ${owner}/${repo} --fork-name ${owner}-${repo} --clone=false 2>&1`;
        } else {
          // Standard fork creation (no custom name)
          forkResult = await $`gh repo fork ${owner}/${repo} --clone=false 2>&1`;
        }

        // Always capture output to parse actual fork name
        const forkOutput = (forkResult.stderr ? forkResult.stderr.toString() : '') +
                          (forkResult.stdout ? forkResult.stdout.toString() : '');

        // Parse actual fork name from output (e.g., "konard/netkeep80-jsonRVM already exists")
        // GitHub may create forks with modified names to avoid conflicts
        // Use regex that won't match domain names like "github.com/user" -> "com/user"
        const forkNameMatch = forkOutput.match(/(?:github\.com\/|^|\s)([a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+)/);
        if (forkNameMatch) {
          actualForkName = forkNameMatch[1];
        }

        if (forkResult.code === 0) {
          // Fork successfully created or already exists
          if (forkOutput.includes('already exists')) {
            await log(`${formatAligned('ℹ️', 'Fork exists:', actualForkName)}`);
            forkExists = true;
          } else {
            await log(`${formatAligned('✅', 'Fork created:', actualForkName)}`);
            forkCreated = true;
            forkExists = true;
          }
          break;
        } else {
          // Fork creation failed - check if it's because fork already exists
          if (forkOutput.includes('already exists') ||
              forkOutput.includes('Name already exists') ||
              forkOutput.includes('fork of') ||
              forkOutput.includes('HTTP 422')) {
            // Fork already exists (likely created by another concurrent worker)
            await log(`${formatAligned('ℹ️', 'Fork exists:', actualForkName)}`);
            forkExists = true;
            break;
          }

          // Check if it's an empty repository (HTTP 403) - try to auto-fix
          if (forkOutput.includes('HTTP 403') &&
              (forkOutput.includes('Empty repositories cannot be forked') ||
               forkOutput.includes('contains no Git content'))) {
            // Empty repository detected - try to initialize it
            await log('');
            await log(`${formatAligned('⚠️', 'EMPTY REPOSITORY', 'detected')}`, { level: 'warn' });
            await log(`${formatAligned('', '', `Repository ${owner}/${repo} contains no content`)}`);
            await log('');

            // Try to initialize the repository by creating a README.md
            const initialized = await tryInitializeEmptyRepository(owner, repo);

            if (initialized) {
              // Success! Repository is now initialized, retry fork creation
              await log('');
              await log(`${formatAligned('🔄', 'Retrying:', 'Fork creation after repository initialization...')}`);
              // Wait a moment for GitHub to process the new file
              await new Promise(resolve => setTimeout(resolve, 2000));
              // Continue to next iteration (retry fork creation)
              continue;
            } else {
              // Failed to initialize - provide helpful suggestions
              await log('');
              await log(`${formatAligned('❌', 'Cannot proceed:', 'Unable to initialize empty repository')}`, { level: 'error' });
              await log('');
              await log('  🔍 What happened:');
              await log(`     The repository ${owner}/${repo} is empty and cannot be forked.`);
              await log('     GitHub doesn\'t allow forking repositories with no content.');
              await log('     Auto-fix failed: You need write access to initialize the repository.');
              await log('');
              await log('  💡 How to fix:');
              await log('     Option 1: Ask repository owner to add initial content');
              await log('              Even a simple README.md file would make the repository forkable');
              await log('');
              await log('     Option 2: Work directly on the original repository (if you get write access)');
              await log(`              Run: solve ${issueUrl || '<issue-url>'} --no-fork`);
              await log('');

              // Try to create a comment on the issue asking the maintainer to initialize the repository
              if (issueUrl) {
                try {
                  // Extract issue number from URL (e.g., https://github.com/owner/repo/issues/123)
                  const issueMatch = issueUrl.match(/\/issues\/(\d+)/);
                  if (issueMatch) {
                    const issueNumber = issueMatch[1];
                    await log(`${formatAligned('💬', 'Creating comment:', 'Requesting maintainer to initialize repository...')}`);

                    const commentBody = `## ⚠️ Repository Initialization Required

Hello! I attempted to work on this issue, but encountered a problem:

**Issue**: The repository is empty and cannot be forked.
**Reason**: GitHub doesn't allow forking repositories with no content.

### 🔧 How to resolve:

**Option 1: Grant write access for me to initialize the repository**
You could grant write access to allow me to initialize the repository directly.

**Option 2: Initialize the repository yourself**
Please add initial content to the repository. Even a simple README.md (even if it is empty or contains just the title) file would make it possible to fork and work on this issue.

Once the repository contains at least one commit with any file, I'll be able to fork it and proceed with solving this issue.

Thank you!`;

                    const commentResult = await $`gh issue comment ${issueNumber} --repo ${owner}/${repo} --body ${commentBody}`;
                    if (commentResult.code === 0) {
                      await log(`${formatAligned('✅', 'Comment created:', `Posted to issue #${issueNumber}`)}`);
                    } else {
                      await log(`${formatAligned('⚠️', 'Note:', 'Could not post comment to issue (this is not critical)')}`);
                    }
                  }
                } catch {
                  // Silently ignore comment creation errors - not critical to the process
                  await log(`${formatAligned('⚠️', 'Note:', 'Could not post comment to issue (this is not critical)')}`);
                }
              }

              await safeExit(1, 'Repository setup failed - empty repository');
            }
          }

          // Check if fork was created by another worker even if error message doesn't explicitly say so
          await log(`${formatAligned('🔍', 'Checking:', 'If fork exists after failed creation attempt...')}`);
          const checkResult = await $`gh repo view ${actualForkName} --json name 2>/dev/null`;

          if (checkResult.code === 0) {
            // Fork exists now (created by another worker during our attempt)
            await log(`${formatAligned('✅', 'Fork found:', 'Created by another concurrent worker')}`);
            forkExists = true;
            break;
          }

          // Fork still doesn't exist and creation failed
          if (attempt < maxForkRetries) {
            const delay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff
            await log(`${formatAligned('⏳', 'Retry:', `Attempt ${attempt}/${maxForkRetries} failed, waiting ${delay/1000}s before retry...`)}`);
            await log(`   Error: ${forkOutput.split('\n')[0]}`); // Show first line of error
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            // All retries exhausted
            await log(`${formatAligned('❌', 'Error:', 'Failed to create fork after all retries')}`);
            await log(forkOutput);
            await safeExit(1, 'Repository setup failed');
          }
        }
      }

      // If fork exists (either created or already existed), verify it's accessible
      if (forkExists) {
        await log(`${formatAligned('🔍', 'Verifying fork:', 'Checking accessibility...')}`);

        // Verify fork with retries (GitHub may need time to propagate)
        const maxVerifyRetries = 5;
        let forkVerified = false;

        for (let attempt = 1; attempt <= maxVerifyRetries; attempt++) {
          const delay = baseDelay * Math.pow(2, attempt - 1);
          if (attempt > 1) {
            await log(`${formatAligned('⏳', 'Verifying fork:', `Attempt ${attempt}/${maxVerifyRetries} (waiting ${delay/1000}s)...`)}`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }

          const verifyResult = await $`gh repo view ${actualForkName} --json name 2>/dev/null`;
          if (verifyResult.code === 0) {
            forkVerified = true;
            await log(`${formatAligned('✅', 'Fork verified:', `${actualForkName} is accessible`)}`);
            break;
          }
        }

        if (!forkVerified) {
          await log(`${formatAligned('❌', 'Error:', 'Fork exists but not accessible after multiple retries')}`);
          await log(`${formatAligned('', 'Suggestion:', 'GitHub may be experiencing delays - try running the command again in a few minutes')}`);
          await safeExit(1, 'Repository setup failed');
        }

        // Wait a moment for fork to be fully ready
        if (forkCreated) {
          await log(`${formatAligned('⏳', 'Waiting:', 'For fork to be fully ready...')}`);
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }

      repoToClone = actualForkName;
      forkedRepo = actualForkName;
      upstreamRemote = `${owner}/${repo}`;
    }
  } else if (forkOwner) {
    // Priority 2: If forkOwner is provided (from auto-continue/PR mode) and --fork was not used,
    // try to use that fork directly (only works if it's accessible)
    await log(`\n${formatAligned('🍴', 'Fork mode:', 'DETECTED from PR')}`);
    await log(`${formatAligned('', 'Fork owner:', forkOwner)}`);

    // Determine fork name - try prefixed name first if option is enabled, otherwise try standard name
    const standardForkName = `${forkOwner}/${repo}`;
    const prefixedForkName = `${forkOwner}/${owner}-${repo}`;
    const expectedForkName = argv.prefixForkNameWithOwnerName ? prefixedForkName : standardForkName;
    const alternateForkName = argv.prefixForkNameWithOwnerName ? standardForkName : prefixedForkName;

    await log(`${formatAligned('✅', 'Using fork:', expectedForkName)}\n`);

    // Verify the fork exists and is accessible - try expected name first, then alternate
    await log(`${formatAligned('🔍', 'Verifying fork:', 'Checking accessibility...')}`);
    let forkCheckResult = await $`gh repo view ${expectedForkName} --json name 2>/dev/null`;
    let actualForkName = expectedForkName;

    if (forkCheckResult.code !== 0 && !argv.prefixForkNameWithOwnerName) {
      // Only try alternate name if NOT using --prefix-fork-name-with-owner-name
      // When the option is enabled, we should only use the prefixed fork name
      forkCheckResult = await $`gh repo view ${alternateForkName} --json name 2>/dev/null`;
      if (forkCheckResult.code === 0) {
        actualForkName = alternateForkName;
      }
    }

    if (forkCheckResult.code === 0) {
      await log(`${formatAligned('✅', 'Fork verified:', `${actualForkName} is accessible`)}`);
      repoToClone = actualForkName;
      forkedRepo = actualForkName;
      upstreamRemote = `${owner}/${repo}`;
    } else {
      await log(`${formatAligned('❌', 'Error:', 'Fork not accessible')}`);
      await log(`${formatAligned('', 'Fork:', expectedForkName)}`);
      await log(`${formatAligned('', 'Suggestion:', 'The PR may be from a fork you no longer have access to')}`);
      await log(`${formatAligned('', 'Hint:', 'Try running with --fork flag to use your own fork instead')}`);
      await safeExit(1, 'Repository setup failed');
    }
  }

  return { repoToClone, forkedRepo, upstreamRemote, prForkOwner: forkOwner };
};

// Clone repository and set up remotes
export const cloneRepository = async (repoToClone, tempDir, argv, owner, repo) => {
  // Clone the repository (or fork) using gh tool with authentication
  await log(`\n${formatAligned('📥', 'Cloning repository:', repoToClone)}`);

  // Use 2>&1 to capture all output and filter "Cloning into" message
  const cloneResult = await $`gh repo clone ${repoToClone} ${tempDir} 2>&1`;

  // Verify clone was successful
  if (cloneResult.code !== 0) {
    const errorOutput = (cloneResult.stderr || cloneResult.stdout || 'Unknown error').toString().trim();
    await log('');
    await log(`${formatAligned('❌', 'CLONE FAILED', '')}`, { level: 'error' });
    await log('');
    await log('  🔍 What happened:');
    await log(`     Failed to clone repository ${repoToClone}`);
    await log('');
    await log('  📦 Error details:');
    for (const line of errorOutput.split('\n')) {
      if (line.trim()) await log(`     ${line}`);
    }
    await log('');
    await log('  💡 Common causes:');
    await log('     • Repository doesn\'t exist or is private');
    await log('     • No GitHub authentication');
    await log('     • Network connectivity issues');
    if (argv.fork) {
      await log('     • Fork not ready yet (try again in a moment)');
    }
    await log('');
    await log('  🔧 How to fix:');
    await log('     1. Check authentication: gh auth status');
    await log('     2. Login if needed: gh auth login');
    await log(`     3. Verify access: gh repo view ${owner}/${repo}`);
    if (argv.fork) {
      await log(`     4. Check fork: gh repo view ${repoToClone}`);
    }
    await log('');
    await safeExit(1, 'Repository setup failed');
  }

  await log(`${formatAligned('✅', 'Cloned to:', tempDir)}`);

  // Verify and fix remote configuration
  const remoteCheckResult = await $({ cwd: tempDir })`git remote -v 2>&1`;
  if (!remoteCheckResult.stdout || !remoteCheckResult.stdout.toString().includes('origin')) {
    await log('   Setting up git remote...', { verbose: true });
    // Add origin remote manually
    await $({ cwd: tempDir })`git remote add origin https://github.com/${repoToClone}.git 2>&1`;
  }
};

// Set up upstream remote and sync fork
export const setupUpstreamAndSync = async (tempDir, forkedRepo, upstreamRemote, owner, repo, argv) => {
  if (!forkedRepo || !upstreamRemote) return;

  await log(`${formatAligned('🔗', 'Setting upstream:', upstreamRemote)}`);

  // Check if upstream remote already exists
  const checkUpstreamResult = await $({ cwd: tempDir })`git remote get-url upstream 2>/dev/null`;
  let upstreamExists = checkUpstreamResult.code === 0;

  if (upstreamExists) {
    await log(`${formatAligned('ℹ️', 'Upstream exists:', 'Using existing upstream remote')}`);
  } else {
    // Add upstream remote since it doesn't exist
    const upstreamResult = await $({ cwd: tempDir })`git remote add upstream https://github.com/${upstreamRemote}.git`;

    if (upstreamResult.code === 0) {
      await log(`${formatAligned('✅', 'Upstream set:', upstreamRemote)}`);
      upstreamExists = true;
    } else {
      await log(`${formatAligned('⚠️', 'Warning:', 'Failed to add upstream remote')}`);
      if (upstreamResult.stderr) {
        await log(`${formatAligned('', 'Error details:', upstreamResult.stderr.toString().trim())}`);
      }
    }
  }

  // Proceed with fork sync if upstream remote is available
  if (upstreamExists) {
    // Fetch upstream
    await log(`${formatAligned('🔄', 'Fetching upstream...', '')}`);
    const fetchResult = await $({ cwd: tempDir })`git fetch upstream`;
    if (fetchResult.code === 0) {
      await log(`${formatAligned('✅', 'Upstream fetched:', 'Successfully')}`);

      // Sync the default branch with upstream to avoid merge conflicts
      await log(`${formatAligned('🔄', 'Syncing default branch...', '')}`);

      // Get current branch so we can return to it after sync
      const currentBranchResult = await $({ cwd: tempDir })`git branch --show-current`;
      if (currentBranchResult.code === 0) {
        const currentBranch = currentBranchResult.stdout.toString().trim();

        // Get the default branch name from the original repository using GitHub API
        const repoInfoResult = await $`gh api repos/${owner}/${repo} --jq .default_branch`;
        if (repoInfoResult.code === 0) {
          const upstreamDefaultBranch = repoInfoResult.stdout.toString().trim();
          await log(`${formatAligned('ℹ️', 'Default branch:', upstreamDefaultBranch)}`);

          // Always sync the default branch, regardless of current branch
          // This ensures fork is up-to-date even if we're working on a different branch

          // Step 1: Switch to default branch if not already on it
          let syncSuccessful = true;
          if (currentBranch !== upstreamDefaultBranch) {
            await log(`${formatAligned('🔄', 'Switching to:', `${upstreamDefaultBranch} branch`)}`);
            const checkoutResult = await $({ cwd: tempDir })`git checkout ${upstreamDefaultBranch}`;
            if (checkoutResult.code !== 0) {
              await log(`${formatAligned('⚠️', 'Warning:', `Failed to checkout ${upstreamDefaultBranch}`)}`);
              syncSuccessful = false; // Cannot proceed with sync
            }
          }

          // Step 2: Sync default branch with upstream (only if checkout was successful)
          if (syncSuccessful) {
            const syncResult = await $({ cwd: tempDir })`git reset --hard upstream/${upstreamDefaultBranch}`;
            if (syncResult.code === 0) {
              await log(`${formatAligned('✅', 'Default branch synced:', `with upstream/${upstreamDefaultBranch}`)}`);

              // Step 3: Push the updated default branch to fork to keep it in sync
              await log(`${formatAligned('🔄', 'Pushing to fork:', `${upstreamDefaultBranch} branch`)}`);
              const pushResult = await $({ cwd: tempDir })`git push origin ${upstreamDefaultBranch}`;
              if (pushResult.code === 0) {
                await log(`${formatAligned('✅', 'Fork updated:', 'Default branch pushed to fork')}`);
              } else {
                // Check if it's a non-fast-forward error (fork has diverged from upstream)
                const errorMsg = pushResult.stderr ? pushResult.stderr.toString().trim() : '';
                const isNonFastForward = errorMsg.includes('non-fast-forward') ||
                                        errorMsg.includes('rejected') ||
                                        errorMsg.includes('tip of your current branch is behind');

                if (isNonFastForward) {
                  // Fork has diverged from upstream
                  await log('');
                  await log(`${formatAligned('⚠️', 'FORK DIVERGENCE DETECTED', '')}`, { level: 'warn' });
                  await log('');
                  await log('  🔍 What happened:');
                  await log(`     Your fork's ${upstreamDefaultBranch} branch has different commits than upstream`);
                  await log('     This typically occurs when upstream had a force push (e.g., git reset --hard)');
                  await log('');
                  await log('  📦 Current state:');
                  await log(`     • Fork: ${forkedRepo}`);
                  await log(`     • Upstream: ${owner}/${repo}`);
                  await log(`     • Branch: ${upstreamDefaultBranch}`);
                  await log('');

                  // Check if user has enabled automatic force push
                  if (argv.allowForkDivergenceResolutionUsingForcePushWithLease) {
                    await log('  🔄 Auto-resolution ENABLED (--allow-fork-divergence-resolution-using-force-push-with-lease):');
                    await log('     Attempting to force-push with --force-with-lease...');
                    await log('');

                    // Use --force-with-lease for safer force push
                    // This will only force push if the remote hasn't changed since our last fetch
                    await log(`${formatAligned('🔄', 'Force pushing:', 'Syncing fork with upstream (--force-with-lease)')}`);
                    const forcePushResult = await $({ cwd: tempDir })`git push --force-with-lease origin ${upstreamDefaultBranch}`;

                    if (forcePushResult.code === 0) {
                      await log(`${formatAligned('✅', 'Fork synced:', 'Successfully force-pushed to align with upstream')}`);
                      await log('');
                    } else {
                      // Force push also failed - this is a more serious issue
                      await log('');
                      await log(`${formatAligned('❌', 'FATAL ERROR:', 'Failed to sync fork with upstream')}`, { level: 'error' });
                      await log('');
                      await log('  🔍 What happened:');
                      await log(`     Fork branch ${upstreamDefaultBranch} has diverged from upstream`);
                      await log('     Both normal push and force-with-lease push failed');
                      await log('');
                      await log('  📦 Error details:');
                      const forceErrorMsg = forcePushResult.stderr ? forcePushResult.stderr.toString().trim() : '';
                      for (const line of forceErrorMsg.split('\n')) {
                        if (line.trim()) await log(`     ${line}`);
                      }
                      await log('');
                      await log('  💡 Possible causes:');
                      await log('     • Fork branch is protected (branch protection rules prevent force push)');
                      await log('     • Someone else pushed to fork after our fetch');
                      await log('     • Insufficient permissions to force push');
                      await log('');
                      await log('  🔧 Manual resolution:');
                      await log(`     1. Visit your fork: https://github.com/${forkedRepo}`);
                      await log('     2. Check branch protection settings');
                      await log('     3. Manually sync fork with upstream:');
                      await log('        git fetch upstream');
                      await log(`        git reset --hard upstream/${upstreamDefaultBranch}`);
                      await log(`        git push --force origin ${upstreamDefaultBranch}`);
                      await log('');
                      await safeExit(1, 'Repository setup failed - fork sync failed');
                    }
                  } else {
                    // Flag is not enabled - provide guidance
                    await log('  ⚠️  RISKS of force-pushing:');
                    await log('     • Overwrites fork history - any unique commits in your fork will be LOST');
                    await log('     • Other collaborators working on your fork may face conflicts');
                    await log('     • Cannot be undone - use with extreme caution');
                    await log('');
                    await log('  💡 Your options:');
                    await log('');
                    await log('     Option 1: Enable automatic force-push (DANGEROUS)');
                    await log('              Add --allow-fork-divergence-resolution-using-force-push-with-lease flag to your command');
                    await log('              This will automatically sync your fork with upstream using force-with-lease');
                    await log('');
                    await log('     Option 2: Manually resolve the divergence');
                    await log('              1. Decide if you need any commits unique to your fork');
                    await log('              2. If yes, cherry-pick them after syncing');
                    await log('              3. If no, manually force-push:');
                    await log('                 git fetch upstream');
                    await log(`                 git reset --hard upstream/${upstreamDefaultBranch}`);
                    await log(`                 git push --force origin ${upstreamDefaultBranch}`);
                    await log('');
                    await log('     Option 3: Work without syncing fork (NOT RECOMMENDED)');
                    await log('              Your fork will remain out-of-sync with upstream');
                    await log('              May cause merge conflicts in pull requests');
                    await log('');
                    await log('  🔧 To proceed with auto-resolution, restart with:');
                    await log(`     solve ${argv.url || argv['issue-url'] || argv._[0] || '<issue-url>'} --allow-fork-divergence-resolution-using-force-push-with-lease`);
                    await log('');
                    await safeExit(1, 'Repository setup halted - fork divergence requires user decision');
                  }
                } else {
                  // Some other push error (not divergence-related)
                  await log(`${formatAligned('❌', 'FATAL ERROR:', 'Failed to push updated default branch to fork')}`);
                  await log(`${formatAligned('', 'Push error:', errorMsg)}`);
                  await log(`${formatAligned('', 'Reason:', 'Fork must be updated or process must stop')}`);
                  await log(`${formatAligned('', 'Solution draft:', 'Fork sync is required for proper workflow')}`);
                  await log(`${formatAligned('', 'Next steps:', '1. Check GitHub permissions for the fork')}`);
                  await log(`${formatAligned('', '', '2. Ensure fork is not protected')}`);
                  await log(`${formatAligned('', '', '3. Try again after resolving fork issues')}`);
                  await safeExit(1, 'Repository setup failed');
                }
              }

              // Step 4: Return to the original branch if it was different
              if (currentBranch !== upstreamDefaultBranch) {
                await log(`${formatAligned('🔄', 'Returning to:', `${currentBranch} branch`)}`);
                const returnResult = await $({ cwd: tempDir })`git checkout ${currentBranch}`;
                if (returnResult.code === 0) {
                  await log(`${formatAligned('✅', 'Branch restored:', `Back on ${currentBranch}`)}`);
                } else {
                  await log(`${formatAligned('⚠️', 'Warning:', `Failed to return to ${currentBranch}`)}`);
                  // This is not fatal, continue with sync on default branch
                }
              }
            } else {
              await log(`${formatAligned('⚠️', 'Warning:', `Failed to sync ${upstreamDefaultBranch} with upstream`)}`);
              if (syncResult.stderr) {
                await log(`${formatAligned('', 'Sync error:', syncResult.stderr.toString().trim())}`);
              }
            }
          }
        } else {
          await log(`${formatAligned('⚠️', 'Warning:', 'Failed to get default branch name')}`);
        }
      } else {
        await log(`${formatAligned('⚠️', 'Warning:', 'Failed to get current branch')}`);
      }
    } else {
      await log(`${formatAligned('⚠️', 'Warning:', 'Failed to fetch upstream')}`);
      if (fetchResult.stderr) {
        await log(`${formatAligned('', 'Fetch error:', fetchResult.stderr.toString().trim())}`);
      }
    }
  }
};

// Set up pr-fork remote for continuing someone else's fork PR with --fork flag
export const setupPrForkRemote = async (tempDir, argv, prForkOwner, repo, isContinueMode, owner = null) => {
  // Only set up pr-fork remote if:
  // 1. --fork flag is used (user wants to use their own fork)
  // 2. prForkOwner is provided (continuing an existing PR from a fork)
  // 3. In continue mode (auto-continue or continuing existing PR)
  if (!argv.fork || !prForkOwner || !isContinueMode) {
    return null;
  }

  // Get current user to check if it's someone else's fork
  await log(`\n${formatAligned('🔍', 'Checking PR fork:', 'Determining if branch is in another fork...')}`);
  const userResult = await $`gh api user --jq .login`;
  if (userResult.code !== 0) {
    await log(`${formatAligned('⚠️', 'Warning:', 'Failed to get current user, cannot set up pr-fork remote')}`);
    return null;
  }

  const currentUser = userResult.stdout.toString().trim();

  // If PR is from current user's fork, no need for pr-fork remote
  if (prForkOwner === currentUser) {
    await log(`${formatAligned('ℹ️', 'PR fork owner:', 'Same as current user, using origin remote')}`);
    return null;
  }

  // This is someone else's fork - add it as pr-fork remote
  // Determine the fork repository name (might be prefixed if --prefix-fork-name-with-owner-name was used)
  // Try both standard and prefixed names
  let prForkRepoName = repo;
  if (owner && argv.prefixForkNameWithOwnerName) {
    // When prefix option is enabled, try prefixed name first
    prForkRepoName = `${owner}-${repo}`;
  }

  await log(`${formatAligned('🔗', 'Setting up pr-fork:', 'Branch exists in another user\'s fork')}`);
  await log(`${formatAligned('', 'PR fork owner:', prForkOwner)}`);
  await log(`${formatAligned('', 'Current user:', currentUser)}`);
  await log(`${formatAligned('', 'Action:', `Adding ${prForkOwner}/${prForkRepoName} as pr-fork remote`)}`);

  const addRemoteResult = await $({ cwd: tempDir })`git remote add pr-fork https://github.com/${prForkOwner}/${prForkRepoName}.git`;
  if (addRemoteResult.code !== 0) {
    await log(`${formatAligned('❌', 'Error:', 'Failed to add pr-fork remote')}`);
    if (addRemoteResult.stderr) {
      await log(`${formatAligned('', 'Details:', addRemoteResult.stderr.toString().trim())}`);
    }
    await log(`${formatAligned('', 'Suggestion:', 'The PR branch may not be accessible')}`);
    await log(`${formatAligned('', 'Workaround:', 'Remove --fork flag to continue work in the original fork')}`);
    return null;
  }

  await log(`${formatAligned('✅', 'Remote added:', 'pr-fork')}`);

  // Fetch from pr-fork to get the branch
  await log(`${formatAligned('📥', 'Fetching branches:', 'From pr-fork remote...')}`);
  const fetchPrForkResult = await $({ cwd: tempDir })`git fetch pr-fork`;
  if (fetchPrForkResult.code !== 0) {
    await log(`${formatAligned('❌', 'Error:', 'Failed to fetch from pr-fork')}`);
    if (fetchPrForkResult.stderr) {
      await log(`${formatAligned('', 'Details:', fetchPrForkResult.stderr.toString().trim())}`);
    }
    await log(`${formatAligned('', 'Suggestion:', 'Check if you have access to the fork')}`);
    return null;
  }

  await log(`${formatAligned('✅', 'Fetched:', 'pr-fork branches')}`);
  await log(`${formatAligned('ℹ️', 'Next step:', 'Will checkout branch from pr-fork remote')}`);
  return 'pr-fork';
};

// Checkout branch for continue mode (PR branch from remote)
export const checkoutPrBranch = async (tempDir, branchName, prForkRemote, prForkOwner) => {
  await log(`\n${formatAligned('🔄', 'Checking out PR branch:', branchName)}`);

  // Determine which remote to use for branch checkout
  const remoteName = prForkRemote || 'origin';

  // First fetch all branches from remote (if not already fetched from pr-fork)
  if (!prForkRemote) {
    await log(`${formatAligned('📥', 'Fetching branches:', 'From remote...')}`);
    const fetchResult = await $({ cwd: tempDir })`git fetch origin`;

    if (fetchResult.code !== 0) {
      await log('Warning: Failed to fetch branches from remote', { level: 'warning' });
    }
  } else {
    await log(`${formatAligned('ℹ️', 'Using pr-fork remote:', `Branch exists in ${prForkOwner}'s fork`)}`);
  }

  // Checkout the PR branch (it might exist locally or remotely)
  const localBranchResult = await $({ cwd: tempDir })`git show-ref --verify --quiet refs/heads/${branchName}`;

  let checkoutResult;
  if (localBranchResult.code === 0) {
    // Branch exists locally
    checkoutResult = await $({ cwd: tempDir })`git checkout ${branchName}`;
  } else {
    // Branch doesn't exist locally, try to checkout from remote
    checkoutResult = await $({ cwd: tempDir })`git checkout -b ${branchName} ${remoteName}/${branchName}`;
  }

  return checkoutResult;
};

// Cleanup temporary directory
export const cleanupTempDirectory = async (tempDir, argv, limitReached) => {
  // Determine if we should skip cleanup
  const shouldKeepDirectory = !argv.autoCleanup || argv.resume || limitReached || (argv.autoContinueOnLimitReset && global.limitResetTime);

  if (!shouldKeepDirectory) {
    try {
      process.stdout.write('\n🧹 Cleaning up...');
      await fs.rm(tempDir, { recursive: true, force: true });
      await log(' ✅');
    } catch (cleanupError) {
      reportError(cleanupError, {
        context: 'cleanup_temp_directory',
        tempDir,
        operation: 'remove_temp_dir'
      });
      await log(' ⚠️  (failed)');
    }
  } else if (argv.resume) {
    await log(`\n📁 Keeping directory for resumed session: ${tempDir}`);
  } else if (limitReached && argv.autoContinueLimit) {
    await log(`\n📁 Keeping directory for auto-continue: ${tempDir}`);
  } else if (limitReached) {
    await log(`\n📁 Keeping directory for future resume: ${tempDir}`);
  } else if (!argv.autoCleanup) {
    await log(`\n📁 Keeping directory (--no-auto-cleanup): ${tempDir}`);
  }
};
