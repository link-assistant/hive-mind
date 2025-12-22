#!/usr/bin/env node

/**
 * Script to upload source maps to Sentry for each release
 * This should be run in CI/CD after a new version is published
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// Read package.json to get version and name
const packageJson = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
const version = packageJson.version;
const projectName = 'hive-mind';
const orgName = 'deepassistant';

console.log(`📦 Uploading source maps for ${packageJson.name}@${version}`);

// Check if running in CI environment
const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';

// Get Sentry auth token from environment
const authToken = process.env.SENTRY_AUTH_TOKEN;

if (!authToken) {
  if (isCI) {
    console.error('❌ SENTRY_AUTH_TOKEN is required in CI environment');
    process.exit(1);
  } else {
    console.log('⚠️  SENTRY_AUTH_TOKEN not set, skipping source map upload');
    process.exit(0);
  }
}

try {
  // Check if Sentry CLI is installed
  try {
    execSync('npx @sentry/cli --version', { stdio: 'ignore' });
  } catch {
    console.log('📥 Installing @sentry/cli...');
    execSync('npm install -g @sentry/cli', { stdio: 'inherit' });
  }

  // Create a release in Sentry
  console.log(`🔄 Creating release ${version} in Sentry...`);
  execSync(`npx @sentry/cli releases new ${version} --org ${orgName} --project ${projectName}`, {
    stdio: 'inherit',
    env: { ...process.env, SENTRY_AUTH_TOKEN: authToken },
  });

  // Upload source maps for all .mjs files
  // Note: In Sentry CLI 3.x, `releases files` was removed.
  // Use `sourcemaps upload` instead (see: https://github.com/getsentry/sentry-cli/releases)
  console.log('📤 Uploading source maps...');

  // Upload source files from src directory
  if (existsSync(join(rootDir, 'src'))) {
    execSync(`npx @sentry/cli sourcemaps upload ./src --org ${orgName} --project ${projectName} --release ${version} --url-prefix '~/src'`, {
      stdio: 'inherit',
      cwd: rootDir,
      env: { ...process.env, SENTRY_AUTH_TOKEN: authToken },
    });
  }

  // Upload test files (useful for debugging test failures)
  if (existsSync(join(rootDir, 'tests'))) {
    execSync(`npx @sentry/cli sourcemaps upload ./tests --org ${orgName} --project ${projectName} --release ${version} --url-prefix '~/tests'`, {
      stdio: 'inherit',
      cwd: rootDir,
      env: { ...process.env, SENTRY_AUTH_TOKEN: authToken },
    });
  }

  // Finalize the release
  console.log('✅ Finalizing release...');
  execSync(`npx @sentry/cli releases finalize ${version} --org ${orgName} --project ${projectName}`, {
    stdio: 'inherit',
    env: { ...process.env, SENTRY_AUTH_TOKEN: authToken },
  });

  // Set release commits (if in Git repository)
  try {
    const gitCommit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    execSync(`npx @sentry/cli releases set-commits ${version} --auto --org ${orgName} --project ${projectName}`, {
      stdio: 'inherit',
      env: { ...process.env, SENTRY_AUTH_TOKEN: authToken },
    });
    console.log(`📝 Associated commits with release ${version}`);
  } catch (err) {
    console.log('⚠️  Could not associate commits (not a git repository or no commits)');
  }

  console.log(`✅ Successfully uploaded source maps for version ${version}`);
} catch (error) {
  console.error('❌ Failed to upload source maps:', error.message);
  if (isCI) {
    process.exit(1);
  }
}
