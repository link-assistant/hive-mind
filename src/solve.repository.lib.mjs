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

const { log, formatAligned } = lib;

// Import exit handler
import { safeExit } from './exit-handler.lib.mjs';

// Import GitHub utilities for permission checks
const githubLib = await import('./github.lib.mjs');
const { checkRepositoryWritePermission } = githubLib;

// Get the root repository of any repository
// Returns the source (root) repository if the repo is a fork, otherwise returns the repo itself
// Returns null if repository is not accessible (404 or other errors)
export const getRootRepository = async (owner, repo) => {
  try {
    const result = await $`gh api repos/${owner}/${repo} --jq '{fork: .fork, source: .source.full_name}' 2>&1`;

    if (result.code !== 0) {
      // Check if it's a 404 error - repository doesn't exist or no permissions
      const errorOutput = (result.stderr || result.stdout || '').toString();
      if (errorOutput.includes('HTTP 404') || errorOutput.includes('Not Found')) {
        // Repository not accessible - this will be handled by fork creation logic
        // Return null to indicate we couldn't determine root repo
        return null;
      }
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
      operation: 'determine_fork_root',
    });
    return null;
  }
};

// Check if current user has a fork of the given root repository
export const checkExistingForkOfRoot = async rootRepo => {
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

    const forks = forksResult.stdout
      .toString()
      .trim()
      .split('\n')
      .filter(f => f);

    if (forks.length > 0) {
      return forks[0];
    } else {
      return null;
    }
  } catch (error) {
    reportError(error, {
      context: 'check_existing_fork_of_root',
      rootRepo,
      operation: 'search_user_forks',
    });
    return null;
  }
};

/**
 * Validate that a fork's parent matches the expected upstream repository.
 * This prevents issues where a fork was created from an intermediate fork (fork of a fork)
 * instead of directly from the intended upstream repository.
 *
 * @param {string} forkRepo - The fork repository to validate (e.g., "user/repo")
 * @param {string} expectedUpstream - The expected upstream repository (e.g., "owner/repo")
 * @returns {Promise<{isValid: boolean, isFork: boolean, parent: string|null, source: string|null, error: string|null}>}
 */
export const validateForkParent = async (forkRepo, expectedUpstream) => {
  try {
    const forkInfoResult = await $`gh api repos/${forkRepo} --jq '{fork: .fork, parent: .parent.full_name, source: .source.full_name}'`;

    if (forkInfoResult.code !== 0) {
      return {
        isValid: false,
        isFork: false,
        parent: null,
        source: null,
        error: `Failed to get fork info for ${forkRepo}`,
      };
    }

    const forkInfo = JSON.parse(forkInfoResult.stdout.toString().trim());
    const isFork = forkInfo.fork === true;
    const parent = forkInfo.parent || null;
    const source = forkInfo.source || null;

    // If not a fork at all, it's invalid for our purposes
    if (!isFork) {
      return {
        isValid: false,
        isFork: false,
        parent: null,
        source: null,
        error: `Repository ${forkRepo} is not a GitHub fork`,
      };
    }

    // The fork's PARENT (immediate upstream) should match expectedUpstream
    // The SOURCE (ultimate root) is also acceptable as it indicates the fork
    // is part of the correct hierarchy, just at a different level
    const parentMatches = parent === expectedUpstream;
    const sourceMatches = source === expectedUpstream;

    // Ideal case: parent matches directly (fork was made from expected upstream)
    if (parentMatches) {
      return {
        isValid: true,
        isFork: true,
        parent,
        source,
        error: null,
      };
    }

    // Special case: source matches but parent doesn't
    // This means the fork was made from an intermediate fork
    // For issue #967, this is the problematic case we want to catch
    if (sourceMatches && !parentMatches) {
      return {
        isValid: false,
        isFork: true,
        parent,
        source,
        error: `Fork ${forkRepo} was created from ${parent} (intermediate fork), not directly from ${expectedUpstream}. ` + `This can cause pull requests to include unexpected commits from the intermediate fork.`,
      };
    }

    // Neither parent nor source matches - completely different repository tree
    return {
      isValid: false,
      isFork: true,
      parent,
      source,
      error: `Fork ${forkRepo} is from a different repository tree (parent: ${parent}, source: ${source}) and cannot be used with ${expectedUpstream}`,
    };
  } catch (error) {
    reportError(error, {
      context: 'validate_fork_parent',
      forkRepo,
      expectedUpstream,
      operation: 'check_fork_hierarchy',
    });
    return {
      isValid: false,
      isFork: false,
      parent: null,
      source: null,
      error: `Error validating fork parent: ${error.message}`,
    };
  }
};

/**
 * Build workspace directory name according to the specification:
 * /tmp/hive-mind-solve-gh-{owner}/{repo}-issue-{issueNumber}-workspace-{timestamp}
 *
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number|string} issueNumber - Issue number
 * @param {number} timestamp - Unix timestamp
 * @returns {string} The workspace directory path
 */
export const buildWorkspacePath = (owner, repo, issueNumber, timestamp) => {
  // Format: /tmp/hive-mind-solve-gh-{owner}/{repo}-issue-{issueNumber}-workspace-{timestamp}
  const baseDir = path.join(os.tmpdir(), `hive-mind-solve-gh-${owner}`);
  const workspaceDir = path.join(baseDir, `${repo}-issue-${issueNumber}-workspace-${timestamp}`);
  return workspaceDir;
};

// Create or find temporary directory for cloning the repository
// When --enable-workspaces is used, creates:
//   {workspace}/repository - for the cloned repo
//   {workspace}/tmp - for temp files, logs, downloads
// When --working-directory is used, uses the specified directory (creates if needed)
export const setupTempDirectory = async (argv, workspaceInfo = null) => {
  let tempDir;
  let workspaceTmpDir = null;
  let isResuming = argv.resume;
  // needsClone indicates if the repository needs to be cloned into the directory
  // This is true when: new directory is created, or existing directory is empty
  let needsClone = true;

  // Check if workspace mode should be enabled (works with all tools)
  const useWorkspaces = argv.enableWorkspaces;

  // Priority 1: --working-directory option takes precedence over all other directory selection
  // This is essential for --resume to work correctly with Claude Code sessions,
  // because Claude Code stores sessions by working directory path, not session ID alone
  if (argv.workingDirectory) {
    tempDir = path.resolve(argv.workingDirectory);

    // Check if directory exists
    try {
      const stat = await fs.stat(tempDir);
      if (stat.isDirectory()) {
        // Directory exists - check if it contains a git repository
        try {
          await fs.access(path.join(tempDir, '.git'));
          // Git repository exists - no need to clone
          needsClone = false;
          await log(`\n${formatAligned('📂', 'Working directory:', tempDir)}`);
          await log(formatAligned('', 'Status:', 'Using existing repository', 2));
          if (isResuming) {
            await log(formatAligned('', 'Session:', `Resuming ${argv.resume}`, 2));
          }
        } catch {
          // No .git directory - directory is empty or doesn't have a repo, will clone
          await log(`\n${formatAligned('📂', 'Working directory:', tempDir)}`);
          await log(formatAligned('', 'Status:', 'Directory exists but no repository - will clone', 2));
        }
      }
    } catch {
      // Directory doesn't exist - create it
      await fs.mkdir(tempDir, { recursive: true });
      await log(`\n${formatAligned('📂', 'Working directory:', tempDir)}`);
      await log(formatAligned('', 'Status:', 'Created new directory - will clone repository', 2));
    }

    return { tempDir, workspaceTmpDir, isResuming, needsClone };
  }

  if (isResuming) {
    // When resuming without --working-directory, create a new temp directory
    // WARNING: This will NOT work correctly with Claude Code because the session
    // is stored in a path-specific location. Use --working-directory for proper resume.
    const scriptDir = path.dirname(process.argv[1]);
    const sessionLogPattern = path.join(scriptDir, `${argv.resume}.log`);

    try {
      // Check if session log exists to verify session is valid
      await fs.access(sessionLogPattern);
      await log(`🔄 Resuming session ${argv.resume} (session log found)`);

      // For resumed sessions, create new temp directory since old one may be cleaned up
      tempDir = path.join(os.tmpdir(), `gh-issue-solver-resume-${argv.resume}-${Date.now()}`);
      await fs.mkdir(tempDir, { recursive: true });
      await log(`⚠️  Creating new temporary directory for resumed session: ${tempDir}`);
      await log(`   Note: Claude Code sessions are tied to working directory paths.`);
      await log(`   If session resume fails, use --working-directory to specify the original directory.`);
    } catch (err) {
      reportError(err, {
        context: 'resume_session_lookup',
        sessionId: argv.resume,
        operation: 'find_session_log',
      });
      await log(`Warning: Session log for ${argv.resume} not found, but continuing with resume attempt`);
      tempDir = path.join(os.tmpdir(), `gh-issue-solver-resume-${argv.resume}-${Date.now()}`);
      await fs.mkdir(tempDir, { recursive: true });
      await log(`Creating temporary directory for resumed session: ${tempDir}`);
    }
  } else if (useWorkspaces && workspaceInfo) {
    // Workspace mode: create structured workspace with repository/ and tmp/ subdirectories
    const { owner, repo, issueNumber } = workspaceInfo;
    const timestamp = Date.now();
    const workspaceDir = buildWorkspacePath(owner, repo, issueNumber, timestamp);

    // Create the workspace structure:
    // {workspace}/repository - where the repo will be cloned
    // {workspace}/tmp - for temp files, logs, command outputs
    const repoDir = path.join(workspaceDir, 'repository');
    workspaceTmpDir = path.join(workspaceDir, 'tmp');

    await fs.mkdir(repoDir, { recursive: true });
    await fs.mkdir(workspaceTmpDir, { recursive: true });

    tempDir = repoDir;

    await log(`\n${formatAligned('📂', 'Workspace mode:', 'ENABLED')}`);
    await log(formatAligned('', 'Workspace root:', workspaceDir, 2));
    await log(formatAligned('', 'Repository dir:', repoDir, 2));
    await log(formatAligned('', 'Temp dir:', workspaceTmpDir, 2));
  } else {
    tempDir = path.join(os.tmpdir(), `gh-issue-solver-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    await log(`\nCreating temporary directory: ${tempDir}`);
  }

  return { tempDir, workspaceTmpDir, isResuming, needsClone };
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

    // Get repository description to include in README
    const repoInfoResult = await $`gh api repos/${owner}/${repo} --jq '{description: .description}'`;
    let description = '';
    if (repoInfoResult.code === 0) {
      try {
        const repoInfo = JSON.parse(repoInfoResult.stdout.toString().trim());
        description = repoInfo.description || '';
      } catch {
        // If parsing fails, continue with empty description
      }
    }

    // Create README content with repository name and description (if available)
    let readmeContent = `# ${repo}\n`;
    if (description) {
      readmeContent += `\n${description}\n`;
    }
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
      if (errorOutput.includes('403') || errorOutput.includes('Forbidden') || errorOutput.includes('not have permission') || errorOutput.includes('Resource not accessible')) {
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
      operation: 'create_readme',
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
          const targetIsRoot = targetRepo === rootRepo;

          if (!targetIsRoot) {
            await log('');
            await log(`${formatAligned('❌', 'FORK CONFLICT DETECTED', '')}`, { level: 'error' });
            await log('');
            await log('  🔍 What happened:');
            await log(`     You are trying to fork ${targetRepo}`);
            await log(`     But you already have a fork of ${rootRepo}: ${existingFork}`);
            await log("     GitHub doesn't allow multiple forks of the same root repository");
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
      // Fork exists - validate that its parent matches the expected upstream
      await log(`${formatAligned('✅', 'Fork exists:', existingForkName)}`);
      await log(`${formatAligned('🔍', 'Validating fork parent...', '')}`);

      const forkValidation = await validateForkParent(existingForkName, `${owner}/${repo}`);

      if (!forkValidation.isValid) {
        // Fork parent mismatch detected - this prevents issue #967
        await log('');
        await log(`${formatAligned('❌', 'FORK PARENT MISMATCH DETECTED', '')}`, { level: 'error' });
        await log('');
        await log('  🔍 What happened:');
        if (!forkValidation.isFork) {
          await log(`     The repository ${existingForkName} is NOT a GitHub fork.`);
          await log('     It may have been created by cloning and pushing instead of forking.');
        } else {
          await log(`     Your fork ${existingForkName} was created from an intermediate fork,`);
          await log(`     not directly from the target repository ${owner}/${repo}.`);
        }
        await log('');
        await log('  📦 Fork relationship:');
        await log(`     • Your fork: ${existingForkName}`);
        await log(`     • Fork parent: ${forkValidation.parent || 'N/A (not a fork)'}`);
        await log(`     • Fork source (root): ${forkValidation.source || 'N/A'}`);
        await log(`     • Expected parent: ${owner}/${repo}`);
        await log('');
        await log('  ⚠️  Why this is a problem:');
        await log('     When a fork is created from an intermediate fork (a "fork of a fork"),');
        await log('     any commits that exist in the intermediate fork but not in the target');
        await log('     repository will be included in your pull requests. This can result in');
        await log('     pull requests with hundreds or thousands of unexpected commits.');
        await log('');
        await log('  📖 Case study: See issue #967');
        await log('     A fork created from veb86/zcadvelecAI (which had 1,678 extra commits)');
        await log('     instead of zamtmn/zcad resulted in a PR with 1,681 commits');
        await log('     instead of the expected 3 commits.');
        await log('');
        await log('  💡 How to fix:');
        await log('');
        await log('     Option 1: Delete the problematic fork and create a fresh one');
        await log(`        gh repo delete ${existingForkName}`);
        await log(`        Then run this command again to create a proper fork of ${owner}/${repo}`);
        await log('');
        await log('     Option 2: Use --prefix-fork-name-with-owner-name to create a new fork');
        await log(`        This creates a fork named ${currentUser}/${owner}-${repo} instead`);
        await log(`        ./solve.mjs "${issueUrl || `https://github.com/${owner}/${repo}/issues/<number>`}" --prefix-fork-name-with-owner-name --fork`);
        await log('');
        await log('     Option 3: Work directly on the repository (if you have write access)');
        await log(`        ./solve.mjs "${issueUrl || `https://github.com/${owner}/${repo}/issues/<number>`}" --no-fork`);
        await log('');

        await safeExit(1, 'Fork parent mismatch - fork was created from intermediate fork');
      }

      await log(`${formatAligned('✅', 'Fork parent validated:', `${forkValidation.parent}`)}`);
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
        const forkOutput = (forkResult.stderr ? forkResult.stderr.toString() : '') + (forkResult.stdout ? forkResult.stdout.toString() : '');

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
          if (forkOutput.includes('already exists') || forkOutput.includes('Name already exists') || forkOutput.includes('fork of') || forkOutput.includes('HTTP 422')) {
            // Fork already exists (likely created by another concurrent worker)
            await log(`${formatAligned('ℹ️', 'Fork exists:', actualForkName)}`);
            forkExists = true;
            break;
          }

          // Check if it's a 404 error (repository doesn't exist or insufficient permissions)
          if (forkOutput.includes('HTTP 404') || forkOutput.includes('Not Found')) {
            // 404 error - do NOT retry, this is not a transient error
            await log('');
            await log(`${formatAligned('❌', 'REPOSITORY NOT ACCESSIBLE', '')}`, { level: 'error' });
            await log('');
            await log('  🔍 What happened:');
            await log(`     Failed to access repository: ${owner}/${repo}`);
            await log('     GitHub returned HTTP 404 (Not Found)');
            await log('');
            await log('  💡 Common causes:');
            await log("     1. Repository doesn't exist or was deleted");
            await log("     2. Repository is private and you don't have access");
            await log('     3. Insufficient permissions to view the repository');
            await log('     4. Your GitHub token may lack required scopes');
            await log('');
            await log('  🔧 How to resolve:');
            await log('     Step 1: Verify the repository exists');
            await log(`            Visit: https://github.com/${owner}/${repo}`);
            await log('');
            await log('     Step 2: Check your GitHub permissions');
            await log('            • Are you logged in with the correct account?');
            await log('            • Do you have access to this repository?');
            await log(`            • Run: gh repo view ${owner}/${repo}`);
            await log('');
            await log('     Step 3: Verify authentication');
            await log('            • Check auth status: gh auth status');
            await log('            • Login if needed: gh auth login');
            await log('            • Ensure "repo" scope is granted');
            await log('');
            await log('     Step 4: Request access');
            await log('            • If repository is private, ask owner for access');
            await log('            • Check if you need to be added as a collaborator');
            await log('');
            await safeExit(1, 'Repository setup failed - repository not accessible (HTTP 404)');
          }

          // Check if it's an empty repository (HTTP 403) - try to auto-fix
          if (forkOutput.includes('HTTP 403') && (forkOutput.includes('Empty repositories cannot be forked') || forkOutput.includes('contains no Git content'))) {
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
              await log(`${formatAligned('❌', 'Cannot proceed:', 'Unable to initialize empty repository')}`, {
                level: 'error',
              });
              await log('');
              await log('  🔍 What happened:');
              await log(`     The repository ${owner}/${repo} is empty and cannot be forked.`);
              await log("     GitHub doesn't allow forking repositories with no content.");
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
            await log(`${formatAligned('⏳', 'Retry:', `Attempt ${attempt}/${maxForkRetries} failed, waiting ${delay / 1000}s before retry...`)}`);
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
            await log(`${formatAligned('⏳', 'Verifying fork:', `Attempt ${attempt}/${maxVerifyRetries} (waiting ${delay / 1000}s)...`)}`);
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

      // Validate fork parent before using it (prevents issue #967)
      await log(`${formatAligned('🔍', 'Validating fork parent...', '')}`);
      const forkValidation = await validateForkParent(actualForkName, `${owner}/${repo}`);

      if (!forkValidation.isValid) {
        // Fork parent mismatch detected
        await log('');
        await log(`${formatAligned('⚠️', 'FORK PARENT MISMATCH WARNING', '')}`, { level: 'warning' });
        await log('');
        await log('  🔍 Issue detected:');
        if (!forkValidation.isFork) {
          await log(`     The repository ${actualForkName} is NOT a GitHub fork.`);
        } else {
          await log(`     The fork ${actualForkName} was created from ${forkValidation.parent},`);
          await log(`     not directly from the target repository ${owner}/${repo}.`);
        }
        await log('');
        await log('  📦 Fork relationship:');
        await log(`     • Fork: ${actualForkName}`);
        await log(`     • Fork parent: ${forkValidation.parent || 'N/A'}`);
        await log(`     • Fork source (root): ${forkValidation.source || 'N/A'}`);
        await log(`     • Expected parent: ${owner}/${repo}`);
        await log('');
        await log('  ⚠️  This may cause pull requests to include unexpected commits.');
        await log('     Consider using --fork to create your own fork instead.');
        await log('');
        // Note: We don't exit here since this is someone else's fork and we're just using it
        // The user should be aware but can proceed (they didn't create this fork)
      } else {
        await log(`${formatAligned('✅', 'Fork parent validated:', `${forkValidation.parent}`)}`);
      }

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

// Classify git clone errors to determine if they are retryable
export const classifyCloneError = errorOutput => {
  const output = errorOutput.toLowerCase();

  // Transient server errors (5xx) - typically retryable
  if (output.includes('error: 500') || output.includes('internal server error') || output.includes('error: 502') || output.includes('error: 503') || output.includes('error: 504')) {
    return { type: 'TRANSIENT', retryable: true, description: 'GitHub server error' };
  }

  // Network-related errors - typically retryable
  if (output.includes('connection refused') || output.includes('connection timed out') || output.includes('connection reset') || output.includes('unable to connect') || output.includes('network is unreachable') || output.includes('ssl error')) {
    return { type: 'NETWORK', retryable: true, description: 'Network connectivity issue' };
  }

  // Authentication/permission errors - not retryable
  if (output.includes('error: 401') || output.includes('error: 403') || output.includes('authentication failed') || output.includes('permission denied')) {
    return { type: 'PERMISSION', retryable: false, description: 'Authentication or permission error' };
  }

  // Repository not found - not retryable
  if (output.includes('error: 404') || output.includes('not found') || output.includes('repository not found')) {
    return { type: 'NOT_FOUND', retryable: false, description: 'Repository not found' };
  }

  // Rate limiting - retryable with backoff
  if (output.includes('rate limit') || output.includes('too many requests') || output.includes('api rate limit exceeded')) {
    return { type: 'RATE_LIMIT', retryable: true, description: 'Rate limit exceeded' };
  }

  // Default to retryable for unknown errors
  return { type: 'UNKNOWN', retryable: true, description: 'Unknown error' };
};

// Clone repository and set up remotes with retry mechanism
export const cloneRepository = async (repoToClone, tempDir, argv, owner, repo) => {
  const maxRetries = 3;
  const baseDelay = 2000; // Start with 2 seconds

  await log(`\n${formatAligned('📥', 'Cloning repository:', repoToClone)}`);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (attempt > 1) {
      await log(`${formatAligned('⏳', 'Clone attempt:', `${attempt}/${maxRetries} (with retry logic)`)}`);
    }

    // Use 2>&1 to capture all output and filter "Cloning into" message
    const cloneResult = await $`gh repo clone ${repoToClone} ${tempDir} 2>&1`;

    // Verify clone was successful
    if (cloneResult.code === 0) {
      await log(`${formatAligned('✅', 'Cloned to:', tempDir)}`);

      // Verify and fix remote configuration
      const remoteCheckResult = await $({ cwd: tempDir })`git remote -v 2>&1`;
      if (!remoteCheckResult.stdout || !remoteCheckResult.stdout.toString().includes('origin')) {
        await log('   Setting up git remote...', { verbose: true });
        // Add origin remote manually
        await $({ cwd: tempDir })`git remote add origin https://github.com/${repoToClone}.git 2>&1`;
      }
      return; // Success - exit function
    }

    // Clone failed - analyze error and determine if retry is appropriate
    const errorOutput = (cloneResult.stderr || cloneResult.stdout || 'Unknown error').toString().trim();

    const errorClassification = classifyCloneError(errorOutput);

    if (!errorClassification.retryable || attempt === maxRetries) {
      // Non-retryable error or max retries reached - fail with detailed error
      await log('');
      await log(`${formatAligned('❌', 'CLONE FAILED', '')}`, { level: 'error' });
      await log('');
      await log('  🔍 What happened:');
      await log(`     Failed to clone repository ${repoToClone}`);

      if (!errorClassification.retryable) {
        await log(`     Error type: ${errorClassification.description} (not retryable)`);
      } else {
        await log(`     Error type: ${errorClassification.description} (max retries exceeded)`);
      }
      await log('');
      await log('  📦 Error details:');
      for (const line of errorOutput.split('\n')) {
        if (line.trim()) await log(`     ${line}`);
      }
      await log('');
      await log('  💡 Common causes:');
      await log("     • Repository doesn't exist or is private");
      await log('     • No GitHub authentication');
      await log('     • Network connectivity issues');
      if (errorClassification.type === 'TRANSIENT') {
        await log('     • GitHub server issues (temporary)');
      }
      if (errorClassification.type === 'RATE_LIMIT') {
        await log('     • API rate limiting exceeded');
      }
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
      if (errorClassification.type === 'TRANSIENT') {
        await log('     5. Wait a few minutes and retry (GitHub server issue)');
        await log('     6. Check GitHub status: https://www.githubstatus.com');
      }
      if (errorClassification.type === 'RATE_LIMIT') {
        await log('     5. Wait for rate limit to reset (check your quota)');
        await log('     6. Use --token flag with different token if available');
      }
      await log('');
      await safeExit(1, 'Repository setup failed');
    }

    // Retryable error and we have attempts left
    const delay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff
    await log(`${formatAligned('⚠️', 'Clone failed:', errorClassification.description)}`);
    await log(`${formatAligned('⏳', 'Retrying:', `Waiting ${delay / 1000}s before attempt ${attempt + 1}/${maxRetries}...`)}`);

    if (errorClassification.type === 'RATE_LIMIT') {
      await log('     💡 Tip: Rate limiting detected - using longer delay');
    }

    await new Promise(resolve => setTimeout(resolve, delay));
  }

  // This should never be reached due to the loop logic above
  await log(`${formatAligned('❌', 'UNEXPECTED ERROR:', 'Clone logic failed')}`);
  await safeExit(1, 'Repository setup failed');
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
                const isNonFastForward = errorMsg.includes('non-fast-forward') || errorMsg.includes('rejected') || errorMsg.includes('tip of your current branch is behind');

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
                    const forcePushResult = await $({
                      cwd: tempDir,
                    })`git push --force-with-lease origin ${upstreamDefaultBranch}`;

                    if (forcePushResult.code === 0) {
                      await log(`${formatAligned('✅', 'Fork synced:', 'Successfully force-pushed to align with upstream')}`);
                      await log('');
                    } else {
                      // Force push also failed - this is a more serious issue
                      await log('');
                      await log(`${formatAligned('❌', 'FATAL ERROR:', 'Failed to sync fork with upstream')}`, {
                        level: 'error',
                      });
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
                    await log('  💡 Your options:');
                    await log('');
                    await log('     Option 1: Delete your fork and recreate it (SIMPLEST)');
                    await log(`              gh repo delete ${forkedRepo}`);
                    await log('              Then run the solve command again - the fork will be recreated automatically');
                    await log('              ⚠️  Only use this if your fork has no unique commits you need to preserve');
                    await log('');
                    await log('     Option 2: Enable automatic force-push (DANGEROUS)');
                    await log('              Add --allow-fork-divergence-resolution-using-force-push-with-lease flag to your command');
                    await log('              This will automatically sync your fork with upstream using force-with-lease');
                    await log('              ⚠️  Overwrites fork history - any unique commits will be LOST');
                    await log('');
                    await log('     Option 3: Manually resolve the divergence');
                    await log('              1. Decide if you need any commits unique to your fork');
                    await log('              2. If yes, cherry-pick them after syncing');
                    await log('              3. If no, manually force-push:');
                    await log('                 git fetch upstream');
                    await log(`                 git reset --hard upstream/${upstreamDefaultBranch}`);
                    await log(`                 git push --force origin ${upstreamDefaultBranch}`);
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
  // IMPORTANT: The fork owner's repository name is independent of our naming preferences
  // We need to discover the actual fork name, not assume it matches our convention
  // This fixes issue #1217 where incorrect fork name was used

  await log(`${formatAligned('🔗', 'Setting up pr-fork:', "Branch exists in another user's fork")}`);
  await log(`${formatAligned('', 'PR fork owner:', prForkOwner)}`);
  await log(`${formatAligned('', 'Current user:', currentUser)}`);

  // Discover the actual fork repository name by querying GitHub API
  // The fork could have any name (standard, prefixed, or custom renamed)
  let prForkRepoName = null;

  // Strategy 1: Query the upstream repo's forks to find this user's fork
  if (owner) {
    await log(`${formatAligned('🔍', 'Discovering fork name:', `Searching ${owner}/${repo}/forks for ${prForkOwner}'s fork...`)}`);
    const forksResult = await $`gh api repos/${owner}/${repo}/forks --paginate --jq '.[] | select(.owner.login == "${prForkOwner}") | .name'`;
    if (forksResult.code === 0 && forksResult.stdout) {
      const forkName = forksResult.stdout.toString().trim().split('\n')[0]; // Take first match
      if (forkName) {
        prForkRepoName = forkName;
        await log(`${formatAligned('✅', 'Found fork:', `${prForkOwner}/${prForkRepoName}`)}`);
      }
    }
  }

  // Strategy 2: If not found in forks list, try common naming patterns
  if (!prForkRepoName) {
    const possibleNames = [
      repo, // Standard name: "eo2js"
      owner ? `${owner}-${repo}` : null, // Prefixed name: "objectionary-eo2js"
    ].filter(Boolean);

    await log(`${formatAligned('🔍', 'Trying common names:', possibleNames.join(', '))}`);

    for (const candidateName of possibleNames) {
      const checkResult = await $`gh repo view ${prForkOwner}/${candidateName} --json name 2>/dev/null`;
      if (checkResult.code === 0) {
        prForkRepoName = candidateName;
        await log(`${formatAligned('✅', 'Found fork:', `${prForkOwner}/${prForkRepoName}`)}`);
        break;
      }
    }
  }

  // If still not found, we cannot proceed
  if (!prForkRepoName) {
    await log(`${formatAligned('❌', 'Error:', `Could not find ${prForkOwner}'s fork of ${owner}/${repo}`)}`);
    await log(`${formatAligned('', 'Checked:', `${prForkOwner}/${repo} and ${prForkOwner}/${owner}-${repo}`)}`);
    await log(`${formatAligned('', 'Suggestion:', 'The fork may have been deleted or renamed')}`);
    await log(`${formatAligned('', 'Workaround:', 'Remove --fork flag to continue work in the original fork')}`);
    return null;
  }

  await log(`${formatAligned('', 'Action:', `Adding ${prForkOwner}/${prForkRepoName} as pr-fork remote`)}`);

  const addRemoteResult = await $({
    cwd: tempDir,
  })`git remote add pr-fork https://github.com/${prForkOwner}/${prForkRepoName}.git`;
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
// prNumber is optional - when provided, enables PR refs fallback (refs/pull/{number}/head)
export const checkoutPrBranch = async (tempDir, branchName, prForkRemote, prForkOwner, prNumber = null) => {
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

    // If checkout from origin failed, try upstream remote as fallback
    // This handles the case where we're in fork mode but the PR branch exists in upstream
    // (e.g., a bot created PR in the upstream repo, not a fork PR)
    if (checkoutResult.code !== 0 && remoteName === 'origin') {
      await log(`${formatAligned('🔄', 'Branch not in origin:', 'Checking upstream remote...')}`);

      // Check if upstream remote exists
      const upstreamCheckResult = await $({ cwd: tempDir })`git remote get-url upstream 2>/dev/null`;
      if (upstreamCheckResult.code === 0) {
        // Fetch from upstream to ensure we have the latest branches
        await log(`${formatAligned('📥', 'Fetching from upstream:', 'Looking for PR branch...')}`);
        const fetchUpstreamResult = await $({ cwd: tempDir })`git fetch upstream`;

        if (fetchUpstreamResult.code === 0) {
          // Check if branch exists in upstream
          const upstreamBranchCheckResult = await $({ cwd: tempDir })`git show-ref --verify --quiet refs/remotes/upstream/${branchName}`;

          if (upstreamBranchCheckResult.code === 0) {
            await log(`${formatAligned('✅', 'Found branch in upstream:', `upstream/${branchName}`)}`);
            // Try to checkout from upstream instead
            checkoutResult = await $({ cwd: tempDir })`git checkout -b ${branchName} upstream/${branchName}`;

            if (checkoutResult.code === 0) {
              await log(`${formatAligned('ℹ️', 'Note:', 'PR branch was in upstream repository, not your fork')}`);
              await log(`${formatAligned('', '', 'This can happen when a bot creates a PR directly in the main repository')}`);
            }
          } else {
            await log(`${formatAligned('⚠️', 'Branch not found:', `Not in origin or upstream remotes`)}`, { level: 'warning' });
          }
        } else {
          await log(`${formatAligned('⚠️', 'Warning:', 'Failed to fetch from upstream')}`, { level: 'warning' });
        }
      }
    }

    // FALLBACK: If all remote checks failed and we have a PR number,
    // use GitHub's special PR refs (refs/pull/{number}/head)
    // This works regardless of fork naming conventions and doesn't require fork access
    // See: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/checking-out-pull-requests-locally
    if (checkoutResult.code !== 0 && prNumber) {
      await log(`${formatAligned('🔄', 'Trying PR refs fallback:', `Fetching refs/pull/${prNumber}/head...`)}`);

      // Fetch the PR head using GitHub's special refs
      const prRefFetchResult = await $({ cwd: tempDir })`git fetch origin pull/${prNumber}/head:${branchName}`;

      if (prRefFetchResult.code === 0) {
        await log(`${formatAligned('✅', 'Fetched PR ref:', `refs/pull/${prNumber}/head`)}`);
        checkoutResult = await $({ cwd: tempDir })`git checkout ${branchName}`;

        if (checkoutResult.code === 0) {
          await log(`${formatAligned('ℹ️', 'Note:', 'Checked out using GitHub PR refs (fork access not required)')}`);
          await log(`${formatAligned('', '', 'This is a read-only checkout - you may need to push to a different branch')}`);
        }
      } else {
        await log(`${formatAligned('⚠️', 'PR refs fallback failed:', 'Could not fetch PR head')}`);
        if (prRefFetchResult.stderr) {
          await log(`${formatAligned('', 'Details:', prRefFetchResult.stderr.toString().trim())}`);
        }
      }
    }
  }

  return checkoutResult;
};

// Cleanup temporary directory
export const cleanupTempDirectory = async (tempDir, argv, limitReached) => {
  // Determine if we should skip cleanup
  const shouldKeepDirectory = !argv.autoCleanup || argv.resume || limitReached || (argv.autoResumeOnLimitReset && global.limitResetTime);

  if (!shouldKeepDirectory) {
    try {
      process.stdout.write('\n🧹 Cleaning up...');
      await fs.rm(tempDir, { recursive: true, force: true });
      await log(' ✅');
    } catch (cleanupError) {
      reportError(cleanupError, {
        context: 'cleanup_temp_directory',
        tempDir,
        operation: 'remove_temp_dir',
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
