#!/usr/bin/env node

/**
 * Issue: GitHub search queries with labels containing spaces fail due to multiple escaping layers
 *
 * Minimal reproduction showing that command-stream incorrectly escapes GitHub search queries
 * with labels that contain spaces, resulting in invalid search queries.
 *
 * Pattern: try { reproduction } catch { workaround }
 */

console.log('🐛 Issue #12: GitHub search query escaping with labels containing spaces\n');

// Use use-m to dynamically import modules for cross-runtime compatibility
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

// Direct imports with top-level await
import { execSync } from 'child_process';

/**
 * Setup test parameters (no try-catch, should fail on error)
 */
async function setup() {
  console.log('📦 Setting up test parameters...');

  const owner = 'microsoft';
  const repo = 'vscode';
  const labelWithSpaces = 'help wanted';
  const searchQuery = `repo:${owner}/${repo} is:issue is:open label:"${labelWithSpaces}"`;

  console.log(`   Repository: ${owner}/${repo}`);
  console.log(`   Label: "${labelWithSpaces}"`);
  console.log(`   Query: ${searchQuery}`);
  console.log('✅ Setup complete\n');

  return { owner, repo, labelWithSpaces, searchQuery };
}

/**
 * Main test - ONE try-catch block for reproduction and workaround
 */
async function runTest() {
  // SETUP (no try-catch)
  const { owner, repo, labelWithSpaces, searchQuery } = await setup();

  console.log('='.repeat(60));

  try {
    // TRY: Reproduce the issue - GitHub search with label containing spaces
    console.log('REPRODUCING ISSUE\n');
    console.log('1️⃣  Using command-stream $ for GitHub search:');

    // This should fail with escaping issues
    const result = await $`gh search issues "${searchQuery}" --limit 1 --json url,title 2>&1`;

    // Check if it failed as expected
    if (result.code !== 0 && result.stderr?.toString().includes('Invalid search query')) {
      const errorOutput = result.stderr.toString();
      const actualQuery = errorOutput.match(/"([^"]+)" type:issue/)?.[1] || 'unknown';

      // Throw error to trigger workaround in catch block
      const error = new Error('GitHub search query escaping failed');
      error.expectedQuery = searchQuery;
      error.actualQuery = actualQuery;
      error.fullError = errorOutput.split('\n')[0];
      throw error;
    }

    // If we get here, the issue may be fixed
    const issues = JSON.parse(result.stdout.toString() || '[]');
    console.log(`✅ Command worked (issue may be fixed). Found ${issues.length} issue(s)`);
  } catch (error) {
    // CATCH: Apply workaround
    console.log('❌ ISSUE CONFIRMED: command-stream escaping failed');

    if (error.actualQuery) {
      console.log(`   Expected query: ${error.expectedQuery}`);
      console.log(`   Actual query sent: ${error.actualQuery}`);
      console.log(`   Error: ${error.fullError}`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('APPLYING WORKAROUND\n');

    // WORKAROUND: Use execSync with proper quoting
    console.log('2️⃣  Using execSync workaround:');

    const command = `gh search issues 'repo:${owner}/${repo} is:issue is:open label:"${labelWithSpaces}"' --limit 1 --json url,title`;
    console.log(`   Command: ${command}`);

    const output = execSync(command, { encoding: 'utf8' });
    const issues = JSON.parse(output || '[]');

    if (issues.length > 0) {
      console.log(`\n✅ WORKAROUND SUCCESSFUL!`);
      console.log(`   Found ${issues.length} issue(s)`);
      console.log(`   Example: ${issues[0].title}`);
    } else {
      console.log(`\n⚠️  No issues found (repository may not have issues with this label)`);
    }
  }

  // SUMMARY
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY\n');
  console.log('❌ ISSUE: command-stream multiply escapes quotes in GitHub search queries');
  console.log('   • Quotes within labels get escaped multiple times');
  console.log('   • Results in invalid search queries like:');
  console.log('     repo:\\"owner/repo is:issue label:\\\\\\"help wanted\\\\\\" type:issue');
  console.log('\n✅ WORKAROUND:');
  console.log('   Use execSync with single quotes around entire query:');
  console.log('   execSync(`gh search issues \'${query}\' --json url`, {encoding: "utf8"})');
}

// Run the test
await runTest();
