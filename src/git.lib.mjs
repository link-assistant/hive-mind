#!/usr/bin/env node

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Git-related library functions for hive-mind project

// Helper function to check if we're in a git repository
export const isGitRepository = async (execFunc = execAsync) => {
  try {
    await execFunc('git rev-parse --git-dir', {
      encoding: 'utf8',
      env: process.env,
    });
    return true;
  } catch {
    return false;
  }
};

// Helper function to get git tag for current HEAD
export const getGitTag = async (execFunc = execAsync) => {
  try {
    const { stdout } = await execFunc('git describe --exact-match --tags HEAD', {
      encoding: 'utf8',
      env: process.env,
    });
    return stdout.trim();
  } catch {
    return null;
  }
};

// Helper function to get latest git tag
export const getLatestGitTag = async (execFunc = execAsync) => {
  try {
    const { stdout } = await execFunc('git describe --tags --abbrev=0', {
      encoding: 'utf8',
      env: process.env,
    });
    return stdout.trim().replace(/^v/, '');
  } catch {
    return null;
  }
};

// Helper function to get short commit SHA
export const getCommitSha = async (execFunc = execAsync) => {
  try {
    const { stdout } = await execFunc('git rev-parse --short HEAD', {
      encoding: 'utf8',
      env: process.env,
    });
    return stdout.trim();
  } catch {
    return null;
  }
};

// Helper function to get version string based on git state
export const getGitVersion = async (execFunc = execAsync, currentVersion) => {
  // First check if we're in a git repository
  if (!(await isGitRepository(execFunc))) {
    return currentVersion;
  }

  // Check if this is a release version (has a git tag)
  const gitTag = await getGitTag(execFunc);
  if (gitTag) {
    // It's a tagged release, use the version from package.json
    return currentVersion;
  }

  // Not a tagged release, get the latest tag and commit SHA
  const latestTag = await getLatestGitTag(execFunc);
  const commitSha = await getCommitSha(execFunc);

  if (latestTag && commitSha) {
    return `${latestTag}.${commitSha}`;
  }

  // Fallback to package.json version if git commands fail
  return currentVersion;
};

// Helper function for async git operations with zx
export const getGitVersionAsync = async ($, currentVersion) => {
  // First check if we're in a git repository to avoid "fatal: not a git repository" errors
  // Redirect stderr to /dev/null at shell level to prevent error messages from appearing
  try {
    const gitCheckResult = await $`git rev-parse --git-dir 2>/dev/null || true`;
    const output = gitCheckResult.stdout.toString().trim();
    if (!output || gitCheckResult.code !== 0) {
      // Not in a git repository, use package.json version
      return currentVersion;
    }
  } catch {
    // Not in a git repository, use package.json version
    return currentVersion;
  }

  // We're in a git repo, proceed with version detection
  // Check if this is a release version (has a git tag)
  // Redirect stderr to /dev/null at shell level to prevent error messages from appearing
  try {
    const gitTagResult = await $`git describe --exact-match --tags HEAD 2>/dev/null || true`;
    if (gitTagResult.code === 0 && gitTagResult.stdout.toString().trim()) {
      // It's a tagged release, use the version from package.json
      return currentVersion;
    }
  } catch {
    // Ignore error - will try next method
  }

  // Not a tagged release, get the latest tag and commit SHA
  // Redirect stderr to /dev/null at shell level to prevent error messages from appearing
  try {
    const latestTagResult = await $`git describe --tags --abbrev=0 2>/dev/null || true`;
    const commitShaResult = await $`git rev-parse --short HEAD 2>/dev/null || true`;

    const latestTag = latestTagResult.stdout.toString().trim().replace(/^v/, '');
    const commitSha = commitShaResult.stdout.toString().trim();

    if (latestTag && commitSha && latestTagResult.code === 0 && commitShaResult.code === 0) {
      return `${latestTag}.${commitSha}`;
    }
  } catch {
    // Ignore error - will use fallback
  }

  // Fallback to package.json version if git commands fail
  return currentVersion;
};

/**
 * Validates git user identity configuration
 * Returns an object with validation status and identity info
 *
 * Git commits require both user.name and user.email to be set.
 * This function checks both global (~/.gitconfig) and local (.git/config) configurations.
 *
 * See: https://git-scm.com/book/en/v2/Getting-Started-First-Time-Git-Setup
 * Related error: "fatal: empty ident name (for <>) not allowed"
 *
 * @param {function} execFunc - The exec function to use (for testing)
 * @returns {Promise<{isValid: boolean, name: string|null, email: string|null, scope: string|null, error: string|null}>}
 */
export const checkGitIdentity = async (execFunc = execAsync) => {
  const result = {
    isValid: false,
    name: null,
    email: null,
    scope: null, // 'global', 'local', or 'none'
    error: null,
  };

  try {
    // Check for user.name
    try {
      const { stdout: nameStdout } = await execFunc('git config user.name', {
        encoding: 'utf8',
        env: process.env,
      });
      result.name = nameStdout.trim() || null;
    } catch {
      // user.name not set
      result.name = null;
    }

    // Check for user.email
    try {
      const { stdout: emailStdout } = await execFunc('git config user.email', {
        encoding: 'utf8',
        env: process.env,
      });
      result.email = emailStdout.trim() || null;
    } catch {
      // user.email not set
      result.email = null;
    }

    // Determine scope (check if local config exists)
    if (result.name || result.email) {
      try {
        const { stdout: scopeStdout } = await execFunc('git config --show-origin user.name', {
          encoding: 'utf8',
          env: process.env,
        });
        // Output format: "file:/path/to/config\tvalue"
        if (scopeStdout.includes('.git/config')) {
          result.scope = 'local';
        } else if (scopeStdout.includes('.gitconfig') || scopeStdout.includes('/etc/gitconfig')) {
          result.scope = 'global';
        } else {
          result.scope = 'global';
        }
      } catch {
        result.scope = 'none';
      }
    } else {
      result.scope = 'none';
    }

    // Both name and email must be non-empty for valid git identity
    // Empty string is also invalid (git rejects it)
    result.isValid = !!(result.name && result.name.length > 0 && result.email && result.email.length > 0);

    if (!result.isValid) {
      const missing = [];
      if (!result.name || result.name.length === 0) missing.push('user.name');
      if (!result.email || result.email.length === 0) missing.push('user.email');
      result.error = `Git identity incomplete: missing ${missing.join(' and ')}`;
    }
  } catch (error) {
    result.error = `Failed to check git identity: ${error.message}`;
  }

  return result;
};

/**
 * Validates git user identity and returns detailed error message if invalid
 * Uses zx's $ for async execution
 *
 * @param {function} $ - The zx $ function
 * @param {object} options - Options object
 * @param {function} options.log - Log function for output
 * @returns {Promise<boolean>} - True if identity is valid, false otherwise
 */
export const validateGitIdentity = async ($, options = {}) => {
  const { log = console.log } = options;

  // Check user.name
  let userName = null;
  try {
    const nameResult = await $`git config user.name 2>/dev/null || true`;
    userName = nameResult.stdout.toString().trim() || null;
  } catch {
    userName = null;
  }

  // Check user.email
  let userEmail = null;
  try {
    const emailResult = await $`git config user.email 2>/dev/null || true`;
    userEmail = emailResult.stdout.toString().trim() || null;
  } catch {
    userEmail = null;
  }

  // Both must be set and non-empty
  const isValid = !!(userName && userName.length > 0 && userEmail && userEmail.length > 0);

  if (!isValid) {
    const missing = [];
    if (!userName || userName.length === 0) missing.push('user.name');
    if (!userEmail || userEmail.length === 0) missing.push('user.email');

    await log('');
    await log('❌ Git identity not configured', { level: 'error' });
    await log('');
    await log('   Git commits require both user.name and user.email to be set.');
    await log(`   Missing: ${missing.join(' and ')}`);
    await log('');
    await log('   Current configuration:');
    await log(`     user.name:  ${userName || '(not set)'}`);
    await log(`     user.email: ${userEmail || '(not set)'}`);
    await log('');
    await log('   🔧 How to fix:');
    await log('');
    await log('   Option 1: Use GitHub CLI to set identity from your account');
    await log('     gh-setup-git-identity');
    await log('');
    await log('   Option 2: Set identity manually');
    await log('     git config --global user.name "Your Name"');
    await log('     git config --global user.email "you@example.com"');
    await log('');
    await log('   Related error: "fatal: empty ident name (for <>) not allowed"');
    await log('');
    return false;
  }

  return true;
};

/**
 * Attempts to repair git identity using gh-setup-git-identity --repair
 * This function requires gh-setup-git-identity to be installed.
 *
 * @param {function} execFunc - The exec function to use (for testing)
 * @returns {Promise<{success: boolean, error: string|null}>}
 */
export const repairGitIdentity = async (execFunc = execAsync) => {
  const result = {
    success: false,
    error: null,
  };

  try {
    // First check if gh-setup-git-identity is installed
    try {
      await execFunc('which gh-setup-git-identity', {
        encoding: 'utf8',
      });
    } catch {
      result.error = 'gh-setup-git-identity is not installed. Please install it first or fix git identity manually.';
      return result;
    }

    // Run gh-setup-git-identity --repair
    const { stdout, stderr } = await execFunc('gh-setup-git-identity --repair', {
      encoding: 'utf8',
      env: process.env,
    });

    // Check if the repair was successful by validating git identity
    const identityCheck = await checkGitIdentity(execFunc);
    if (identityCheck.isValid) {
      result.success = true;
    } else {
      result.error = `Repair command completed but identity is still invalid: ${identityCheck.error}`;
    }
  } catch (error) {
    result.error = `Failed to repair git identity: ${error.message}`;
  }

  return result;
};

// Export all functions as default as well
export default {
  isGitRepository,
  getGitTag,
  getLatestGitTag,
  getCommitSha,
  getGitVersion,
  getGitVersionAsync,
  checkGitIdentity,
  validateGitIdentity,
  repairGitIdentity,
};
