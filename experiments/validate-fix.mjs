#!/usr/bin/env node

/**
 * Validation script to check if the fix is correctly implemented
 * Reads the solve.mjs file and checks for the sync logic
 */

import { readFileSync } from 'fs';

function validateFix() {
  console.log('🔍 Validating fork sync fix implementation...\n');

  try {
    const solveContent = readFileSync('/tmp/gh-issue-solver-1757998708083/solve.mjs', 'utf8');

    // Check for key components of the fix
    const checks = [
      {
        name: 'Sync default branch comment',
        pattern: /Sync the default branch with upstream to avoid merge conflicts/,
        description: 'Comment explaining the purpose of the sync',
      },
      {
        name: 'GitHub API call for default branch',
        pattern: /gh api repos\/\$\{owner\}\/\$\{repo\} --jq \.default_branch/,
        description: 'Get default branch from GitHub API',
      },
      {
        name: 'Git reset hard with upstream',
        pattern: /git reset --hard upstream\/\$\{upstreamDefaultBranch\}/,
        description: 'Reset local default branch to match upstream',
      },
      {
        name: 'Push to fork origin',
        pattern: /git push origin \$\{upstreamDefaultBranch\}/,
        description: 'Push updated default branch to fork',
      },
      {
        name: 'Current branch check',
        pattern: /git branch --show-current/,
        description: 'Check current branch before syncing',
      },
    ];

    let allPassed = true;

    checks.forEach(check => {
      if (check.pattern.test(solveContent)) {
        console.log(`✅ ${check.name}: Found`);
      } else {
        console.log(`❌ ${check.name}: Missing`);
        console.log(`   Expected: ${check.description}`);
        allPassed = false;
      }
    });

    console.log('\n📍 Fix Location Analysis:');

    // Find the location of the sync logic
    const syncStartIndex = solveContent.indexOf('Sync the default branch with upstream');
    if (syncStartIndex !== -1) {
      const beforeSync = solveContent.substring(0, syncStartIndex);
      const lineNumber = beforeSync.split('\n').length;
      console.log(`   Sync logic starts at approximately line ${lineNumber}`);

      // Check if it's in the right place (after upstream fetch)
      const fetchUpstreamIndex = solveContent.indexOf('Upstream fetched:', 'Successfully');
      if (fetchUpstreamIndex !== -1 && fetchUpstreamIndex < syncStartIndex) {
        console.log('✅ Sync logic is correctly placed after upstream fetch');
      } else {
        console.log('❌ Sync logic may not be in the optimal location');
      }
    }

    console.log(`\n🎯 Overall Result: ${allPassed ? 'PASS' : 'FAIL'}`);

    return allPassed;
  } catch (error) {
    console.error(`Error reading solve.mjs: ${error.message}`);
    return false;
  }
}

function main() {
  const isValid = validateFix();
  process.exit(isValid ? 0 : 1);
}

main();
