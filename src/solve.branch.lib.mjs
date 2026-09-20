/**
 * Branch creation and checkout functionality for solve.mjs
 * Handles creating new branches or checking out existing PR branches
 */

/**
 * Regular expressions for branch name validation
 * Supports both legacy (8-char) and new (12-char) formats
 */
const branchNameRegex = {
  // Legacy format: issue-{number}-{8-hex-chars}
  legacy: /^issue-(\d+)-([a-f0-9]{8})$/,
  // New format: issue-{number}-{12-hex-chars}
  new: /^issue-(\d+)-([a-f0-9]{12})$/,
  // Combined pattern for both formats
  any: /^issue-(\d+)-([a-f0-9]{8}|[a-f0-9]{12})$/,
  // Pattern for prefix matching: issue-{number}-
  prefix: issueNumber => new RegExp(`^issue-${issueNumber}-([a-f0-9]{8}|[a-f0-9]{12})$`),
};

/**
 * Validates if a branch name matches the expected pattern for issue branches
 * @param {string} branchName - The branch name to validate
 * @param {number|string} [issueNumber] - Optional issue number to validate against
 * @returns {boolean} True if branch name is valid
 */
export function isValidIssueBranchName(branchName, issueNumber = null) {
  if (!branchName || typeof branchName !== 'string') {
    return false;
  }

  if (issueNumber !== null) {
    // Validate against specific issue number
    const regex = branchNameRegex.prefix(issueNumber);
    return regex.test(branchName);
  }

  // Validate against any issue branch pattern
  return branchNameRegex.any.test(branchName);
}

/**
 * Extracts issue number and random ID from a branch name
 * @param {string} branchName - The branch name to parse
 * @returns {{issueNumber: string, randomId: string} | null} Parsed components or null if invalid
 */
export function parseIssueBranchName(branchName) {
  if (!branchName || typeof branchName !== 'string') {
    return null;
  }

  const match = branchName.match(branchNameRegex.any);
  if (!match) {
    return null;
  }

  return {
    issueNumber: match[1],
    randomId: match[2],
  };
}

/**
 * Creates the branch name prefix for a given issue number
 * @param {number|string} issueNumber - The issue number
 * @returns {string} The branch name prefix (e.g., "issue-123-")
 */
export function getIssueBranchPrefix(issueNumber) {
  return `issue-${issueNumber}-`;
}

/**
 * Checks if a branch name matches the expected pattern for a specific issue
 * @param {string} branchName - The branch name to check
 * @param {number|string} issueNumber - The issue number
 * @returns {boolean} True if branch matches the issue pattern
 */
export function matchesIssuePattern(branchName, issueNumber) {
  return isValidIssueBranchName(branchName, issueNumber);
}

/**
 * Detects if a branch name uses the legacy (8-char) or new (12-char) format
 * @param {string} branchName - The branch name to check
 * @returns {'legacy' | 'new' | null} The format type or null if invalid
 */
export function detectBranchFormat(branchName) {
  if (!branchName || typeof branchName !== 'string') {
    return null;
  }

  if (branchNameRegex.new.test(branchName)) {
    return 'new';
  }

  if (branchNameRegex.legacy.test(branchName)) {
    return 'legacy';
  }

  return null;
}

/**
 * Validates a branch name for use as --base-branch.
 * Rejects URLs, invalid git ref characters, and enforces safe naming conventions.
 * Based on git-check-ref-format rules: https://git-scm.com/docs/git-check-ref-format
 *
 * @param {string} branchName - The branch name to validate
 * @returns {{ valid: boolean, reason?: string }} Validation result
 */
export function validateBranchName(branchName) {
  if (!branchName || typeof branchName !== 'string') {
    return { valid: false, reason: 'Branch name must be a non-empty string' };
  }

  const trimmed = branchName.trim();
  if (trimmed !== branchName) {
    return { valid: false, reason: 'Branch name must not have leading or trailing whitespace' };
  }

  // Reject URLs (the primary use case from issue #1482)
  if (/^https?:\/\//i.test(branchName) || /^git@/i.test(branchName) || /^ssh:\/\//i.test(branchName)) {
    return { valid: false, reason: `"${branchName}" looks like a URL, not a branch name. Use just the branch name (e.g. "main", "develop")` };
  }

  // Reject if it contains :// anywhere (catches other protocol-like URLs)
  if (branchName.includes('://')) {
    return { valid: false, reason: `"${branchName}" contains "://" which is not valid in a branch name` };
  }

  // Git ref format rules:
  // Cannot contain ASCII control characters (bytes < 0x20) or DEL (0x7F)
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(branchName)) {
    return { valid: false, reason: 'Branch name must not contain control characters' };
  }

  // Cannot contain space, ~, ^, :, ?, *, [, or backslash
  if (/[ ~^:?*[\]\\]/.test(branchName)) {
    return { valid: false, reason: 'Branch name contains invalid characters (spaces, ~, ^, :, ?, *, [, ] or \\ are not allowed)' };
  }

  // Cannot contain ..
  if (branchName.includes('..')) {
    return { valid: false, reason: 'Branch name must not contain ".."' };
  }

  // Cannot start with . or -
  if (branchName.startsWith('.') || branchName.startsWith('-')) {
    return { valid: false, reason: 'Branch name must not start with "." or "-"' };
  }

  // Cannot end with . or .lock
  if (branchName.endsWith('.') || branchName.endsWith('.lock')) {
    return { valid: false, reason: 'Branch name must not end with "." or ".lock"' };
  }

  // Cannot contain @{
  if (branchName.includes('@{')) {
    return { valid: false, reason: 'Branch name must not contain "@{"' };
  }

  // Cannot be exactly @
  if (branchName === '@') {
    return { valid: false, reason: 'Branch name must not be "@"' };
  }

  // Component-level checks: no component can start with . or end with .lock
  const components = branchName.split('/');
  for (const component of components) {
    if (component === '') {
      return { valid: false, reason: 'Branch name must not contain consecutive slashes or start/end with "/"' };
    }
    if (component.startsWith('.')) {
      return { valid: false, reason: `Branch name component "${component}" must not start with "."` };
    }
    if (component.endsWith('.lock')) {
      return { valid: false, reason: `Branch name component "${component}" must not end with ".lock"` };
    }
  }

  // Reasonable length limit
  if (branchName.length > 255) {
    return { valid: false, reason: 'Branch name must not exceed 255 characters' };
  }

  return { valid: true };
}

// Issue #1482: Validate --base-branch/--target-branch values in an args array
// Used by telegram-bot.mjs for early validation before spawning processes
export function validateBranchInArgs(args) {
  const branchFlags = ['--base-branch', '-b', '--target-branch', '-tb'];
  for (let i = 0; i < args.length; i++) {
    for (const flag of branchFlags) {
      if (args[i] === flag && i + 1 < args.length) {
        const v = validateBranchName(args[i + 1]);
        if (!v.valid) return `Invalid ${flag} value: ${v.reason}`;
      } else if (args[i].startsWith(flag + '=')) {
        const v = validateBranchName(args[i].substring(flag.length + 1));
        if (!v.valid) return `Invalid ${flag} value: ${v.reason}`;
      }
    }
  }
  return null;
}

function isMissingOriginBaseRefError(errorOutput, baseBranch) {
  return errorOutput.includes(`origin/${baseBranch}`) && (errorOutput.includes('is not a commit') || errorOutput.includes('not a valid object name') || errorOutput.includes('unknown revision'));
}

async function hasUpstreamRemote(tempDir, $) {
  const result = await $({ cwd: tempDir })`git remote get-url upstream 2>/dev/null`;
  return result.code === 0;
}

async function originHasBaseBranch(tempDir, baseBranch, $) {
  const result = await $({ cwd: tempDir })`git show-ref --verify --quiet refs/remotes/origin/${baseBranch}`;
  return result.code === 0;
}

/**
 * Ensure the requested base branch exists on the fork (origin) by syncing it from upstream.
 * Returns true if origin/<baseBranch> exists at the end of the call (was already there or was synced).
 * Returns false if syncing was attempted and failed (caller should propagate the original error).
 *
 * Design note (issue #1772 follow-up): when working in fork mode against a public upstream, the user
 * expects their fork to mirror the upstream branch they want to base work on. Before relying on
 * git's create-from-origin path, we proactively copy the upstream branch into the fork so that the
 * branch creation, the later PR comparison, and any ahead/behind checks all see a consistent state.
 */
async function ensureBaseBranchInFork({ baseBranch, tempDir, log, formatAligned, $, reason = 'proactive' }) {
  if (!(await hasUpstreamRemote(tempDir, $))) {
    return false;
  }

  if (reason === 'proactive') {
    await log(`${formatAligned('🔄', 'Syncing base branch:', `ensuring origin/${baseBranch} matches upstream`)}`);
  } else {
    await log(`${formatAligned('🔄', 'Base branch not in fork:', `checking upstream/${baseBranch}`)}`);
  }

  const fetchResult = await $({ cwd: tempDir })`git fetch upstream`;
  if (fetchResult.code !== 0) {
    await log(`${formatAligned('⚠️', 'Warning:', 'Failed to fetch upstream base branch')}`, { level: 'warning' });
    return false;
  }

  const upstreamRefResult = await $({ cwd: tempDir })`git show-ref --verify --quiet refs/remotes/upstream/${baseBranch}`;
  if (upstreamRefResult.code !== 0) {
    await log(`${formatAligned('⚠️', 'Warning:', `Base branch not found in upstream/${baseBranch}`)}`, { level: 'warning' });
    return false;
  }

  await log(`${formatAligned('✅', 'Base branch found:', `upstream/${baseBranch}`)}`);
  const checkoutBaseResult = await $({ cwd: tempDir })`git checkout -B ${baseBranch} upstream/${baseBranch}`;
  if (checkoutBaseResult.code !== 0) {
    await log(`${formatAligned('⚠️', 'Warning:', `Failed to prepare local ${baseBranch}`)}`, { level: 'warning' });
    return false;
  }

  await log(`${formatAligned('🔄', 'Pushing to fork:', `${baseBranch} branch`)}`);
  const pushBaseResult = await $({ cwd: tempDir })`git push origin ${baseBranch} 2>&1`;
  if (pushBaseResult.code !== 0) {
    const pushError = (pushBaseResult.stderr || pushBaseResult.stdout || 'Unknown error').toString().trim();
    await log(`${formatAligned('⚠️', 'Warning:', `Failed to push ${baseBranch} to fork`)}`, { level: 'warning' });
    if (pushError) await log(`${formatAligned('', 'Push error:', pushError)}`, { level: 'warning' });
    return false;
  }

  await log(`${formatAligned('✅', 'Fork updated:', `Custom base branch ${baseBranch} pushed to fork`)}`);
  return true;
}

async function proactivelySyncBaseBranchToFork({ baseBranch, defaultBranch, tempDir, log, formatAligned, $ }) {
  // Default branch is already synced by setupUpstreamAndSync; skip to avoid redundant work.
  if (baseBranch === defaultBranch) {
    return;
  }

  if (!(await hasUpstreamRemote(tempDir, $))) {
    return;
  }

  if (await originHasBaseBranch(tempDir, baseBranch, $)) {
    return;
  }

  await ensureBaseBranchInFork({ baseBranch, tempDir, log, formatAligned, $, reason: 'proactive' });
}

async function retryBranchCreationFromUpstreamBase({ checkoutResult, branchName, baseBranch, tempDir, log, formatAligned, $ }) {
  const errorOutput = `${checkoutResult.stderr || ''}${checkoutResult.stdout || ''}`;
  if (!isMissingOriginBaseRefError(errorOutput, baseBranch)) {
    return checkoutResult;
  }

  const synced = await ensureBaseBranchInFork({ baseBranch, tempDir, log, formatAligned, $, reason: 'reactive' });
  if (!synced) {
    return checkoutResult;
  }

  await log(`${formatAligned('🌿', 'Retrying branch:', `${branchName} from ${baseBranch}`)}`);
  return await $({ cwd: tempDir })`git checkout -b ${branchName} ${baseBranch}`;
}

export async function createOrCheckoutBranch({ isContinueMode, prBranch, issueNumber, tempDir, defaultBranch, argv, log, formatAligned, $, crypto, owner, repo, prNumber }) {
  // Create a branch for the issue or checkout existing PR branch
  let branchName;
  let checkoutResult;
  // Tracked across the create path so the error handler can report the real
  // root cause when branch creation fails from a missing base branch (issue #1959).
  let baseBranchForError = null;
  let branchSourceForError = null;

  if (isContinueMode && prBranch) {
    // Continue mode: checkout existing PR branch
    branchName = prBranch;
    const repository = await import('./solve.repository.lib.mjs');
    const { checkoutPrBranch } = repository;
    // Pass prNumber to enable PR refs fallback (refs/pull/{number}/head) when fork checkout fails
    checkoutResult = await checkoutPrBranch(tempDir, branchName, null, null, prNumber);
  } else {
    // Traditional mode: create new branch for issue
    const randomHex = crypto.randomBytes(6).toString('hex');
    branchName = `issue-${issueNumber}-${randomHex}`;

    // Use user-specified base branch if provided, otherwise use repository default
    const baseBranch = argv.baseBranch || defaultBranch;
    const branchSource = argv.baseBranch ? 'custom' : 'default';
    baseBranchForError = baseBranch;
    branchSourceForError = branchSource;

    // Defense-in-depth: validate base branch name even if already validated at CLI parsing (issue #1482)
    const baseBranchValidation = validateBranchName(baseBranch);
    if (!baseBranchValidation.valid) {
      throw new Error(`Invalid base branch "${baseBranch}": ${baseBranchValidation.reason}`);
    }

    await log(`\n${formatAligned('🌿', 'Creating branch:', `${branchName} from ${baseBranch} (${branchSource})`)}`);

    // Issue #1772: when a custom base branch is requested in fork mode, proactively copy it from
    // upstream to the fork before branch creation. The fork's `gh repo fork` snapshot may pre-date
    // upstream's custom branches, so we cannot assume origin already has the requested base.
    if (argv.baseBranch) {
      await proactivelySyncBaseBranchToFork({
        baseBranch,
        defaultBranch,
        tempDir,
        log,
        formatAligned,
        $,
      });
    }

    // IMPORTANT: Don't use 2>&1 here as it can interfere with exit codes
    // Git checkout -b outputs to stderr but that's normal
    // Create branch from the specified base branch (origin/baseBranch)
    checkoutResult = await $({ cwd: tempDir })`git checkout -b ${branchName} origin/${baseBranch}`;
    checkoutResult = await retryBranchCreationFromUpstreamBase({
      checkoutResult,
      branchName,
      baseBranch,
      tempDir,
      log,
      formatAligned,
      $,
    });
  }

  if (checkoutResult.code !== 0) {
    const errorOutput = (checkoutResult.stderr || checkoutResult.stdout || 'Unknown error').toString().trim();
    await log('');

    if (isContinueMode) {
      const branchErrors = await import('./solve.branch-errors.lib.mjs');
      const { handleBranchCheckoutError } = branchErrors;
      await handleBranchCheckoutError({
        branchName,
        prNumber,
        errorOutput,
        issueUrl: argv['issue-url'] || argv._[0],
        owner,
        repo,
        tempDir,
        argv,
        formatAligned,
        log,
        $,
      });
    } else {
      const branchErrors = await import('./solve.branch-errors.lib.mjs');
      const { handleBranchCreationError } = branchErrors;
      await handleBranchCreationError({
        branchName,
        errorOutput,
        tempDir,
        owner,
        repo,
        baseBranch: baseBranchForError,
        branchSource: branchSourceForError,
        formatAligned,
        log,
      });
    }

    await log('');
    await log(`  📂 Working directory: ${tempDir}`);
    throw new Error('Branch operation failed');
  }

  // CRITICAL: Verify the branch was checked out and we switched to it
  await log(`${formatAligned('🔍', 'Verifying:', isContinueMode ? 'Branch checkout...' : 'Branch creation...')}`);
  const verifyResult = await $({ cwd: tempDir })`git branch --show-current`;

  if (verifyResult.code !== 0 || !verifyResult.stdout) {
    await log('');
    await log(`${formatAligned('❌', 'BRANCH VERIFICATION FAILED', '')}`, { level: 'error' });
    await log('');
    await log('  🔍 What happened:');
    await log(`     Unable to verify branch after ${isContinueMode ? 'checkout' : 'creation'} attempt.`);
    await log('');
    await log('  🔧 Debug commands to try:');
    await log(`     cd ${tempDir} && git branch -a`);
    await log(`     cd ${tempDir} && git status`);
    await log('');
    throw new Error('Branch verification failed');
  }

  const actualBranch = verifyResult.stdout.toString().trim();
  if (actualBranch !== branchName) {
    // Branch wasn't actually created/checked out or we didn't switch to it
    const branchErrors = await import('./solve.branch-errors.lib.mjs');
    const { handleBranchVerificationError } = branchErrors;
    await handleBranchVerificationError({
      isContinueMode,
      branchName,
      actualBranch,
      prNumber,
      owner,
      repo,
      tempDir,
      formatAligned,
      log,
      $,
    });
    throw new Error('Branch verification mismatch');
  }

  if (isContinueMode) {
    await log(`${formatAligned('✅', 'Branch checked out:', branchName)}`);
    await log(`${formatAligned('✅', 'Current branch:', actualBranch)}`);
    if (argv.verbose) {
      await log('   Branch operation: Checkout existing PR branch', { verbose: true });
      await log(`   Branch verification: ${actualBranch === branchName ? 'Matches expected' : 'MISMATCH!'}`, {
        verbose: true,
      });
    }
  } else {
    await log(`${formatAligned('✅', 'Branch created:', branchName)}`);
    await log(`${formatAligned('✅', 'Current branch:', actualBranch)}`);
    if (argv.verbose) {
      await log('   Branch operation: Create new branch', { verbose: true });
      await log(`   Branch verification: ${actualBranch === branchName ? 'Matches expected' : 'MISMATCH!'}`, {
        verbose: true,
      });
    }
  }

  return branchName;
}
