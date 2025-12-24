#!/usr/bin/env node

/**
 * Free up disk space for Docker builds
 *
 * This script removes large pre-installed packages from GitHub Actions runners
 * to free up disk space for multi-platform Docker builds. Multi-platform builds
 * (especially amd64 + arm64) require significant disk space, particularly when
 * building for arm64 via QEMU emulation.
 *
 * Usage:
 *   node scripts/free-disk-space.mjs
 */

import { execSync } from 'child_process';

/**
 * Execute a shell command and return the output
 * @param {string} command - The command to execute
 * @returns {string} - The command output
 */
function exec(command) {
  try {
    return execSync(command, { encoding: 'utf-8', stdio: 'inherit' });
  } catch (error) {
    console.error(`Error executing command: ${command}`);
    throw error;
  }
}

/**
 * Display disk space information
 * @param {string} label - Label for the disk space report
 */
function showDiskSpace(label) {
  console.log(`\n${label}:`);
  exec('df -h /');
}

/**
 * Main function to free up disk space
 */
function freeDiskSpace() {
  // Show disk space before cleanup
  showDiskSpace('Disk space before cleanup');

  console.log('\nRemoving unnecessary packages to free disk space...');

  // Remove large pre-installed packages that we don't need
  const packagesToRemove = ['/usr/share/dotnet', '/usr/local/lib/android', '/opt/ghc', '/opt/hostedtoolcache/CodeQL'];

  for (const packagePath of packagesToRemove) {
    try {
      console.log(`Removing ${packagePath}...`);
      exec(`sudo rm -rf ${packagePath}`);
    } catch (error) {
      console.warn(`Warning: Could not remove ${packagePath}`);
    }
  }

  // Prune unused Docker images
  try {
    console.log('Pruning unused Docker images...');
    exec('sudo docker image prune --all --force');
  } catch (error) {
    console.warn('Warning: Could not prune Docker images');
  }

  // Show disk space after cleanup
  showDiskSpace('Disk space after cleanup');

  console.log('\nDisk space cleanup completed successfully');
}

// Run the cleanup
freeDiskSpace();
