#!/usr/bin/env node

/**
 * gh-setup-git-identity
 *
 * Sets up git user.name and user.email from the authenticated GitHub CLI account.
 * This script uses the `gh` CLI to fetch the authenticated user's name and email,
 * then configures git globally with these values.
 *
 * Usage:
 *   gh-setup-git-identity [options]
 *
 * Options:
 *   --local     Set identity for current repository only (instead of global)
 *   --dry-run   Show what would be configured without making changes
 *   --verbose   Show detailed output
 *   --help      Show this help message
 *
 * Prerequisites:
 *   - GitHub CLI (gh) must be installed and authenticated
 *   - Git must be installed
 *
 * Why this is needed:
 *   Git commits require both user.name and user.email to be configured.
 *   Without these settings, git will fail with:
 *   "fatal: empty ident name (for <>) not allowed"
 *
 * See: https://github.com/link-assistant/hive-mind/issues/1131
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const VERSION = '1.0.0';

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  local: args.includes('--local'),
  dryRun: args.includes('--dry-run'),
  verbose: args.includes('--verbose') || args.includes('-v'),
  help: args.includes('--help') || args.includes('-h'),
  version: args.includes('--version') || args.includes('-V'),
};

// Show help
if (options.help) {
  console.log(`
gh-setup-git-identity v${VERSION}

Sets up git user.name and user.email from your GitHub CLI account.

Usage:
  gh-setup-git-identity [options]

Options:
  --local     Set identity for current repository only (instead of global)
  --dry-run   Show what would be configured without making changes
  --verbose   Show detailed output
  --version   Show version number
  --help      Show this help message

Examples:
  gh-setup-git-identity              # Set git identity globally
  gh-setup-git-identity --local      # Set git identity for current repo only
  gh-setup-git-identity --dry-run    # Preview without making changes

Prerequisites:
  - GitHub CLI (gh) must be installed and authenticated
  - Git must be installed

Why this is needed:
  Git commits require both user.name and user.email to be configured.
  Without these settings, git will fail with:
  "fatal: empty ident name (for <>) not allowed"
`);
  process.exit(0);
}

// Show version
if (options.version) {
  console.log(`gh-setup-git-identity v${VERSION}`);
  process.exit(0);
}

const log = message => {
  if (options.verbose) {
    console.log(`  [DEBUG] ${message}`);
  }
};

const main = async () => {
  console.log('');
  console.log('Setting up git identity from GitHub CLI...');
  console.log('');

  // Step 1: Check if gh is installed and authenticated
  log('Checking GitHub CLI authentication...');
  try {
    const { stdout: authStatus } = await execAsync('gh auth status 2>&1', { encoding: 'utf8' });
    log(`Auth status: ${authStatus.trim().split('\n')[0]}`);

    if (!authStatus.includes('Logged in')) {
      console.error('  Error: GitHub CLI is not authenticated.');
      console.error('');
      console.error('  Please authenticate first:');
      console.error('    gh auth login');
      console.error('');
      process.exit(1);
    }
  } catch {
    console.error('  Error: GitHub CLI (gh) is not installed or not in PATH.');
    console.error('');
    console.error('  Please install GitHub CLI:');
    console.error('    https://cli.github.com/');
    console.error('');
    process.exit(1);
  }

  // Step 2: Get user info from GitHub API
  log('Fetching user info from GitHub API...');
  let userName = null;
  let userEmail = null;

  try {
    const { stdout: userJson } = await execAsync('gh api user --jq ".name"', { encoding: 'utf8' });
    userName = userJson.trim();
    log(`GitHub name: ${userName}`);

    // If name is empty, try login as fallback
    if (!userName || userName === 'null') {
      const { stdout: loginJson } = await execAsync('gh api user --jq ".login"', { encoding: 'utf8' });
      userName = loginJson.trim();
      log(`Using login as name: ${userName}`);
    }
  } catch (error) {
    log(`Error fetching name: ${error.message}`);
  }

  // Get email - try primary email first, then public email
  try {
    // Try to get primary verified email
    const { stdout: emailsJson } = await execAsync('gh api user/emails --jq ".[] | select(.primary==true) | .email"', {
      encoding: 'utf8',
    });
    userEmail = emailsJson.trim();
    log(`Primary email: ${userEmail}`);

    // If no primary email, get public email
    if (!userEmail || userEmail === 'null') {
      const { stdout: publicEmail } = await execAsync('gh api user --jq ".email"', { encoding: 'utf8' });
      userEmail = publicEmail.trim();
      log(`Public email: ${userEmail}`);
    }

    // If still no email, use noreply email
    if (!userEmail || userEmail === 'null') {
      const { stdout: loginJson } = await execAsync('gh api user --jq ".login"', { encoding: 'utf8' });
      const { stdout: idJson } = await execAsync('gh api user --jq ".id"', { encoding: 'utf8' });
      const login = loginJson.trim();
      const id = idJson.trim();
      userEmail = `${id}+${login}@users.noreply.github.com`;
      log(`Using noreply email: ${userEmail}`);
    }
  } catch (error) {
    log(`Error fetching email: ${error.message}`);
    // Try noreply as last resort
    try {
      const { stdout: loginJson } = await execAsync('gh api user --jq ".login"', { encoding: 'utf8' });
      const { stdout: idJson } = await execAsync('gh api user --jq ".id"', { encoding: 'utf8' });
      const login = loginJson.trim();
      const id = idJson.trim();
      userEmail = `${id}+${login}@users.noreply.github.com`;
      log(`Fallback noreply email: ${userEmail}`);
    } catch {
      console.error('  Error: Could not determine email from GitHub account.');
      process.exit(1);
    }
  }

  // Validate we have both
  if (!userName || userName === 'null') {
    console.error('  Error: Could not determine name from GitHub account.');
    console.error('');
    console.error('  Please set your name in GitHub settings:');
    console.error('    https://github.com/settings/profile');
    console.error('');
    process.exit(1);
  }

  if (!userEmail || userEmail === 'null') {
    console.error('  Error: Could not determine email from GitHub account.');
    console.error('');
    console.error('  Please configure your email in GitHub settings:');
    console.error('    https://github.com/settings/emails');
    console.error('');
    process.exit(1);
  }

  // Step 3: Configure git
  const scope = options.local ? '--local' : '--global';
  const scopeDescription = options.local ? 'current repository' : 'global';

  console.log('  GitHub user information:');
  console.log(`    Name:  ${userName}`);
  console.log(`    Email: ${userEmail}`);
  console.log('');
  console.log(`  Setting git identity (${scopeDescription}):`);

  if (options.dryRun) {
    console.log('');
    console.log('  [DRY-RUN] Would execute:');
    console.log(`    git config ${scope} user.name "${userName}"`);
    console.log(`    git config ${scope} user.email "${userEmail}"`);
    console.log('');
    console.log('  Run without --dry-run to apply changes.');
    console.log('');
    process.exit(0);
  }

  try {
    await execAsync(`git config ${scope} user.name "${userName}"`, { encoding: 'utf8' });
    console.log(`    git config ${scope} user.name "${userName}"   [OK]`);

    await execAsync(`git config ${scope} user.email "${userEmail}"`, { encoding: 'utf8' });
    console.log(`    git config ${scope} user.email "${userEmail}"   [OK]`);

    console.log('');
    console.log('  Git identity configured successfully.');
    console.log('');

    // Verify the configuration
    if (options.verbose) {
      console.log('  Verification:');
      const { stdout: verifyName } = await execAsync('git config user.name', { encoding: 'utf8' });
      const { stdout: verifyEmail } = await execAsync('git config user.email', { encoding: 'utf8' });
      console.log(`    user.name:  ${verifyName.trim()}`);
      console.log(`    user.email: ${verifyEmail.trim()}`);
      console.log('');
    }
  } catch (error) {
    console.error('');
    console.error(`  Error: Failed to configure git: ${error.message}`);
    console.error('');
    process.exit(1);
  }
};

main().catch(error => {
  console.error(`  Unexpected error: ${error.message}`);
  process.exit(1);
});
