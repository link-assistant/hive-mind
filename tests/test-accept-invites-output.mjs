#!/usr/bin/env node

/**
 * Unit tests for the improved /accept_invites command output
 * Tests the buildProgressMessage function for:
 * - Grouping by Repositories and Organizations
 * - Generating clickable links
 * - Progress indicators during processing
 * - Final summary messages
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1148
 */

/**
 * Escapes special characters in text for Telegram MarkdownV2 formatting
 * @param {string} text - The text to escape
 * @returns {string} The escaped text
 */
function escapeMarkdown(text) {
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

/**
 * Build progress message from current state
 * @param {Object} state - Current state object
 * @returns {string} Formatted message
 */
function buildProgressMessage(state) {
  const { acceptedRepos, acceptedOrgs, errors, totalRepos, totalOrgs, processedRepos, processedOrgs, isComplete } = state;

  const totalInvitations = totalRepos + totalOrgs;
  const processedTotal = processedRepos + processedOrgs;
  const acceptedTotal = acceptedRepos.length + acceptedOrgs.length;

  let message = isComplete ? '✅ *GitHub Invitations Processed*\n\n' : `🔄 *Processing GitHub Invitations* \\(${processedTotal}/${totalInvitations}\\)\n\n`;

  if (acceptedRepos.length > 0 || (!isComplete && totalRepos > 0)) {
    message += '*Repositories:*\n';
    for (const repoName of acceptedRepos) {
      const escapedName = escapeMarkdown(repoName);
      const escapedLink = escapeMarkdown(`https://github.com/${repoName}`);
      message += `  • 📦 [${escapedName}](${escapedLink})\n`;
    }
    if (!isComplete && processedRepos < totalRepos) {
      const remaining = totalRepos - processedRepos;
      message += `  • _\\.\\.\\. ${remaining} more pending_\n`;
    }
    message += '\n';
  }

  if (acceptedOrgs.length > 0 || (!isComplete && totalOrgs > 0)) {
    message += '*Organizations:*\n';
    for (const orgName of acceptedOrgs) {
      const escapedName = escapeMarkdown(orgName);
      const escapedLink = escapeMarkdown(`https://github.com/${orgName}`);
      message += `  • 🏢 [${escapedName}](${escapedLink})\n`;
    }
    if (!isComplete && processedOrgs < totalOrgs) {
      const remaining = totalOrgs - processedOrgs;
      message += `  • _\\.\\.\\. ${remaining} more pending_\n`;
    }
    message += '\n';
  }

  if (errors.length > 0) {
    message += '*Errors:*\n' + errors.map(e => `  • ${escapeMarkdown(e)}`).join('\n') + '\n\n';
  }

  if (isComplete) {
    if (acceptedTotal === 0 && errors.length === 0) {
      message += 'No pending invitations found\\.';
    } else if (acceptedTotal > 0 && errors.length === 0) {
      message += `\n🎉 Successfully accepted ${acceptedTotal} invitation\\(s\\)\\!`;
    } else if (acceptedTotal > 0 && errors.length > 0) {
      message += `\n⚠️ Accepted ${acceptedTotal} invitation\\(s\\), ${errors.length} error\\(s\\)\\.`;
    }
  }

  return message;
}

// Test cases
const testCases = [
  {
    name: 'No pending invitations',
    state: {
      acceptedRepos: [],
      acceptedOrgs: [],
      errors: [],
      totalRepos: 0,
      totalOrgs: 0,
      processedRepos: 0,
      processedOrgs: 0,
      isComplete: true,
    },
    expectedContains: ['No pending invitations found'],
    expectedNotContains: ['Repositories:', 'Organizations:'],
  },
  {
    name: 'Single repository accepted',
    state: {
      acceptedRepos: ['owner/repo'],
      acceptedOrgs: [],
      errors: [],
      totalRepos: 1,
      totalOrgs: 0,
      processedRepos: 1,
      processedOrgs: 0,
      isComplete: true,
    },
    expectedContains: ['Repositories:', 'owner/repo', 'https://github\\.com/owner/repo', 'Successfully accepted 1 invitation'],
    expectedNotContains: ['Organizations:', 'Repository:'],
  },
  {
    name: 'Multiple repositories accepted',
    state: {
      acceptedRepos: ['owner1/repo1', 'owner2/repo2', 'owner3/repo3'],
      acceptedOrgs: [],
      errors: [],
      totalRepos: 3,
      totalOrgs: 0,
      processedRepos: 3,
      processedOrgs: 0,
      isComplete: true,
    },
    expectedContains: ['Repositories:', 'owner1/repo1', 'owner2/repo2', 'owner3/repo3', 'Successfully accepted 3 invitation'],
    expectedNotContains: ['Organizations:', 'Repository:'],
  },
  {
    name: 'Repository with underscore in name',
    state: {
      acceptedRepos: ['user/my_cool_repo'],
      acceptedOrgs: [],
      errors: [],
      totalRepos: 1,
      totalOrgs: 0,
      processedRepos: 1,
      processedOrgs: 0,
      isComplete: true,
    },
    expectedContains: ['my\\_cool\\_repo', 'https://github\\.com/user/my\\_cool\\_repo'],
    expectedNotContains: [],
  },
  {
    name: 'Single organization accepted',
    state: {
      acceptedRepos: [],
      acceptedOrgs: ['my-org'],
      errors: [],
      totalRepos: 0,
      totalOrgs: 1,
      processedRepos: 0,
      processedOrgs: 1,
      isComplete: true,
    },
    expectedContains: ['Organizations:', 'my\\-org', 'https://github\\.com/my\\-org', 'Successfully accepted 1 invitation'],
    expectedNotContains: ['Repositories:', 'Organization:'],
  },
  {
    name: 'Mixed repositories and organizations',
    state: {
      acceptedRepos: ['owner1/repo1', 'owner2/repo2'],
      acceptedOrgs: ['org1', 'org2'],
      errors: [],
      totalRepos: 2,
      totalOrgs: 2,
      processedRepos: 2,
      processedOrgs: 2,
      isComplete: true,
    },
    expectedContains: ['Repositories:', 'Organizations:', 'owner1/repo1', 'org1', 'Successfully accepted 4 invitation'],
    expectedNotContains: ['Repository:', 'Organization:'],
  },
  {
    name: 'Progress during processing (repos)',
    state: {
      acceptedRepos: ['owner1/repo1'],
      acceptedOrgs: [],
      errors: [],
      totalRepos: 3,
      totalOrgs: 0,
      processedRepos: 1,
      processedOrgs: 0,
      isComplete: false,
    },
    expectedContains: ['Processing GitHub Invitations', '1/3', 'owner1/repo1', '2 more pending'],
    expectedNotContains: ['Successfully accepted'],
  },
  {
    name: 'Progress during processing (orgs)',
    state: {
      acceptedRepos: [],
      acceptedOrgs: ['org1'],
      errors: [],
      totalRepos: 0,
      totalOrgs: 2,
      processedRepos: 0,
      processedOrgs: 1,
      isComplete: false,
    },
    expectedContains: ['Processing GitHub Invitations', '1/2', 'org1', '1 more pending'],
    expectedNotContains: ['Successfully accepted'],
  },
  {
    name: 'With errors',
    state: {
      acceptedRepos: ['owner/good-repo'],
      acceptedOrgs: [],
      errors: ['📦 owner/bad-repo: Permission denied'],
      totalRepos: 2,
      totalOrgs: 0,
      processedRepos: 2,
      processedOrgs: 0,
      isComplete: true,
    },
    expectedContains: ['Errors:', 'Permission denied', 'Accepted 1 invitation', '1 error'],
    expectedNotContains: [],
  },
  {
    name: 'Clickable link format verification',
    state: {
      acceptedRepos: ['test/repo'],
      acceptedOrgs: [],
      errors: [],
      totalRepos: 1,
      totalOrgs: 0,
      processedRepos: 1,
      processedOrgs: 0,
      isComplete: true,
    },
    expectedContains: ['[test/repo](https://github\\.com/test/repo)'],
    expectedNotContains: [],
  },
];

console.log('🧪 Running /accept_invites output unit tests...\n');
console.log('='.repeat(80));
console.log('Test Suite: /accept_invites Output Formatting (Issue #1148)');
console.log('='.repeat(80));
console.log();

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
  const result = buildProgressMessage(testCase.state);
  let success = true;
  const failures = [];

  // Check expected contains
  for (const expected of testCase.expectedContains) {
    if (!result.includes(expected)) {
      success = false;
      failures.push(`Expected to contain: "${expected}"`);
    }
  }

  // Check expected not contains
  for (const notExpected of testCase.expectedNotContains) {
    if (result.includes(notExpected)) {
      success = false;
      failures.push(`Expected NOT to contain: "${notExpected}"`);
    }
  }

  if (success) {
    console.log(`✅ PASS: ${testCase.name}`);
    passed++;
  } else {
    console.log(`❌ FAIL: ${testCase.name}`);
    for (const failure of failures) {
      console.log(`   ${failure}`);
    }
    console.log(`   Output:\n${result}`);
    failed++;
  }
  console.log();
}

// Visual test - show sample outputs
console.log('='.repeat(80));
console.log('Visual Test: Sample Output Messages');
console.log('='.repeat(80));
console.log();

const sampleStates = [
  {
    name: 'In progress with repos',
    state: {
      acceptedRepos: ['suenot/trading-terms', 'VogelOygen/Test_Canaan'],
      acceptedOrgs: [],
      errors: [],
      totalRepos: 5,
      totalOrgs: 1,
      processedRepos: 2,
      processedOrgs: 0,
      isComplete: false,
    },
  },
  {
    name: 'Completed with mixed items',
    state: {
      acceptedRepos: ['suenot/trading-terms', 'VogelOygen/Test_Canaan', 'goplay1937/main'],
      acceptedOrgs: ['link-assistant', 'anthropic'],
      errors: [],
      totalRepos: 3,
      totalOrgs: 2,
      processedRepos: 3,
      processedOrgs: 2,
      isComplete: true,
    },
  },
];

for (const sample of sampleStates) {
  console.log(`📄 ${sample.name}:`);
  console.log('─'.repeat(60));
  console.log(buildProgressMessage(sample.state));
  console.log('─'.repeat(60));
  console.log();
}

// Print summary
console.log('='.repeat(80));
console.log('Test Summary');
console.log('='.repeat(80));
console.log(`Total tests:  ${testCases.length}`);
console.log(`Passed:       ${passed} ✅`);
console.log(`Failed:       ${failed} ${failed > 0 ? '❌' : ''}`);
console.log('='.repeat(80));
console.log();

if (failed === 0) {
  console.log('🎉 All tests passed!');
  console.log();
  console.log('📝 Issue #1148 requirements verified:');
  console.log('   ✅ Groups by "Repositories:" and "Organizations:" (no repeated "Repository:" word)');
  console.log('   ✅ Uses full clickable links in correct Telegram MarkdownV2 syntax');
  console.log('   ✅ Shows progress during processing with "X more pending" indicator');
  console.log('   ✅ Properly escapes special characters (underscore, hyphen, etc.)');
  console.log();
  process.exit(0);
} else {
  console.log(`❌ ${failed} test(s) failed!`);
  console.log();
  process.exit(1);
}
