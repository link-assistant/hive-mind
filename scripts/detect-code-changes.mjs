#!/usr/bin/env node

/**
 * Detect code changes for CI/CD pipeline
 *
 * This script detects what types of files have changed between two commits
 * and outputs the results for use in GitHub Actions workflow conditions.
 *
 * Key behavior:
 * - For PRs: compares PR head against base branch
 * - For pushes: compares HEAD against HEAD^
 * - Uses positive matching to detect code changes (only files matching known
 *   code extensions are considered code), so unknown file types like .gitkeep
 *   are naturally excluded without needing explicit exclusion rules (issue #1528)
 *
 * Files NOT considered code changes (don't require changesets):
 * - Any file not matching codePattern (e.g., .gitkeep, .txt, etc.)
 * - Markdown files (*.md) in any folder
 * - .changeset/ folder (changeset metadata)
 * - data/ folder (data files)
 * - docs/ folder (documentation)
 * - experiments/ folder (experimental scripts)
 *
 * Usage:
 *   node scripts/detect-code-changes.mjs
 *
 * Environment variables (set by GitHub Actions):
 *   - GITHUB_EVENT_NAME: 'pull_request' or 'push'
 *   - GITHUB_BASE_SHA: Base commit SHA for PR
 *   - GITHUB_HEAD_SHA: Head commit SHA for PR
 *
 * Outputs (written to GITHUB_OUTPUT):
 *   - mjs: 'true' if any .mjs files changed
 *   - package: 'true' if package.json changed
 *   - docs: 'true' if any .md files changed
 *   - workflow: 'true' if any .github/workflows/ files changed
 *   - docker: 'true' if Dockerfile, coolify/Dockerfile, or .dockerignore changed
 *   - code: 'true' if any code files changed (excludes docs, changesets, experiments, data)
 *   - helm: 'true' if any helm/ files changed
 */

import { execSync } from 'child_process';
import { appendFileSync } from 'fs';

/**
 * Execute a shell command and return trimmed output
 * @param {string} command - The command to execute
 * @returns {string} - The trimmed command output
 */
function exec(command) {
  try {
    return execSync(command, { encoding: 'utf-8' }).trim();
  } catch (error) {
    console.error(`Error executing command: ${command}`);
    console.error(error.message);
    return '';
  }
}

/**
 * Write output to GitHub Actions output file
 * @param {string} name - Output name
 * @param {string} value - Output value
 */
function setOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${name}=${value}\n`);
  }
  console.log(`${name}=${value}`);
}

/**
 * Get the list of changed files between two commits
 * @returns {string[]} Array of changed file paths
 */
function getChangedFiles() {
  const eventName = process.env.GITHUB_EVENT_NAME || 'local';

  if (eventName === 'pull_request') {
    const baseSha = process.env.GITHUB_BASE_SHA;
    const headSha = process.env.GITHUB_HEAD_SHA;

    if (baseSha && headSha) {
      console.log(`Comparing PR: ${baseSha}...${headSha}`);
      try {
        // Ensure we have the base commit
        try {
          execSync(`git cat-file -e ${baseSha}`, { stdio: 'ignore' });
        } catch {
          console.log('Base commit not available locally, attempting fetch...');
          execSync(`git fetch origin ${baseSha}`, { stdio: 'inherit' });
        }
        const output = exec(`git diff --name-only ${baseSha} ${headSha}`);
        return output ? output.split('\n').filter(Boolean) : [];
      } catch (error) {
        console.error(`Git diff failed: ${error.message}`);
      }
    }
  }

  // For push events or fallback
  console.log('Comparing HEAD^ to HEAD');
  try {
    const output = exec('git diff --name-only HEAD^ HEAD');
    return output ? output.split('\n').filter(Boolean) : [];
  } catch {
    // If HEAD^ doesn't exist (first commit), list all files in HEAD
    console.log('HEAD^ not available, listing all files in HEAD');
    const output = exec('git ls-tree --name-only -r HEAD');
    return output ? output.split('\n').filter(Boolean) : [];
  }
}

/**
 * Check if a file path matches any pattern
 * @param {string} filePath - The file path to check
 * @param {RegExp} pattern - The pattern to match
 * @returns {boolean} True if the file matches the pattern
 */
function matchesPattern(filePath, pattern) {
  return pattern.test(filePath);
}

/**
 * Check if a file should be excluded from code changes detection.
 *
 * This function handles known non-code directories and file types.
 * Files that don't match any exclusion rule here are further checked
 * against codePattern — only files matching that positive pattern
 * are reported as code changes. This means unknown file types (like
 * .gitkeep, .txt, etc.) are naturally excluded without needing
 * explicit exclusion rules. See issue #1528.
 *
 * @param {string} filePath - The file path to check
 * @returns {boolean} True if the file should be excluded
 */
function isExcludedFromCodeChanges(filePath) {
  // Exclude markdown files in any folder
  if (filePath.endsWith('.md')) {
    return true;
  }

  // Exclude specific folders from code changes
  const excludedFolders = ['.changeset/', 'data/', 'docs/', 'experiments/'];

  for (const folder of excludedFolders) {
    if (filePath.startsWith(folder)) {
      return true;
    }
  }

  return false;
}

/**
 * Main function to detect changes
 */
function detectChanges() {
  console.log('Detecting file changes for CI/CD...\n');

  const changedFiles = getChangedFiles();

  console.log('Changed files:');
  if (changedFiles.length === 0) {
    console.log('  (none)');
  } else {
    changedFiles.forEach(file => console.log(`  ${file}`));
  }
  console.log('');

  // Detect .mjs file changes
  const mjsChanged = changedFiles.some(file => file.endsWith('.mjs'));
  setOutput('mjs', mjsChanged ? 'true' : 'false');

  // Detect package.json changes
  const packageChanged = changedFiles.some(file => file === 'package.json');
  setOutput('package', packageChanged ? 'true' : 'false');

  // Detect documentation changes (any .md file)
  const docsChanged = changedFiles.some(file => file.endsWith('.md'));
  setOutput('docs', docsChanged ? 'true' : 'false');

  // Detect workflow changes
  const workflowChanged = changedFiles.some(file => file.startsWith('.github/workflows/'));
  setOutput('workflow', workflowChanged ? 'true' : 'false');

  // Detect docker-related changes
  // Note: ubuntu-24-server-install.sh was removed in issue #1394 - now using pinned konard/box base image
  const dockerPattern = /^(Dockerfile|coolify\/Dockerfile|\.dockerignore)$/;
  const dockerChanged = changedFiles.some(file => dockerPattern.test(file));
  setOutput('docker', dockerChanged ? 'true' : 'false');

  // Detect helm chart changes
  const helmChanged = changedFiles.some(file => file.startsWith('helm/'));
  setOutput('helm', helmChanged ? 'true' : 'false');

  // Detect code changes using positive matching (issue #1528):
  // 1. First exclude known non-code directories/types (docs, changesets, experiments, data, markdown)
  // 2. Then positively match against known code file patterns
  // This ensures unknown file types (like .gitkeep) are naturally excluded
  // without needing explicit exclusion rules for each one.
  const nonExcludedFiles = changedFiles.filter(file => !isExcludedFromCodeChanges(file));

  // Check if any code files changed (.mjs, .json, .yml, .yaml, workflow files)
  // Note: Docker files (Dockerfile etc.) are NOT included here — they are detected separately via
  // docker=true. The release job is configured to also trigger on docker-changed=true. (see issue #1423)
  const codePattern = /\.(mjs|json|yml|yaml)$|\.github\/workflows\//;
  const codeChangedFiles = nonExcludedFiles.filter(file => codePattern.test(file));

  console.log('\nFiles considered as code changes:');
  if (codeChangedFiles.length === 0) {
    console.log('  (none)');
  } else {
    codeChangedFiles.forEach(file => console.log(`  ${file}`));
  }

  // Log files that were changed but not considered code (for debugging)
  const nonCodeFiles = changedFiles.filter(file => !codeChangedFiles.includes(file));
  if (nonCodeFiles.length > 0) {
    console.log('\nFiles NOT considered as code changes:');
    nonCodeFiles.forEach(file => console.log(`  ${file}`));
  }
  console.log('');

  const codeChanged = codeChangedFiles.length > 0;
  setOutput('code', codeChanged ? 'true' : 'false');

  console.log('\nChange detection completed.');
}

// Export functions for testing (Issue #1528)
export { isExcludedFromCodeChanges, matchesPattern };

// Run the detection when executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  detectChanges();
}
