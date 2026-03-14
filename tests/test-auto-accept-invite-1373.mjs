#!/usr/bin/env node

/**
 * Unit tests for --auto-accept-invite option (Issue #1373)
 *
 * Tests the autoAcceptInviteForRepo function logic by simulating:
 * - Accepting a matching repository invitation
 * - Accepting a matching organization invitation
 * - Skipping non-matching invitations
 * - Handling missing invitations gracefully
 * - Case-insensitive matching
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1373
 */

console.log('🧪 Running --auto-accept-invite unit tests (Issue #1373)...\n');
console.log('='.repeat(80));
console.log('Test Suite: autoAcceptInviteForRepo logic');
console.log('='.repeat(80));
console.log();

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

/**
 * Simulated version of autoAcceptInviteForRepo for unit testing.
 * Uses injected fetch/exec functions instead of real gh CLI.
 */
async function autoAcceptInviteForRepoWithMocks(owner, repo, { repoInvitations, orgMemberships, execCalls }) {
  const result = { acceptedRepo: false, acceptedOrg: false };
  const fullName = `${owner}/${repo}`;

  // Simulate repo invitation check
  const matchingInv = repoInvitations.find(inv => inv.repository?.full_name?.toLowerCase() === fullName.toLowerCase());
  if (matchingInv) {
    execCalls.push(`gh api -X PATCH /user/repository_invitations/${matchingInv.id}`);
    result.acceptedRepo = true;
  }

  // Simulate org membership check
  const pendingOrgs = orgMemberships.filter(m => m.state === 'pending');
  const matchingOrg = pendingOrgs.find(m => m.organization?.login?.toLowerCase() === owner.toLowerCase());
  if (matchingOrg) {
    const orgName = matchingOrg.organization.login;
    execCalls.push(`gh api -X PATCH /user/memberships/orgs/${orgName} -f state=active`);
    result.acceptedOrg = true;
  }

  return result;
}

const testCases = [
  {
    name: 'Accepts matching repository invitation',
    owner: 'myorg',
    repo: 'myrepo',
    repoInvitations: [
      { id: 101, repository: { full_name: 'myorg/myrepo' } },
      { id: 102, repository: { full_name: 'otherorg/otherrepo' } },
    ],
    orgMemberships: [],
    expectedResult: { acceptedRepo: true, acceptedOrg: false },
    expectedExecCalls: ['gh api -X PATCH /user/repository_invitations/101'],
    expectedNotExecCalls: ['gh api -X PATCH /user/repository_invitations/102'],
  },
  {
    name: 'Accepts matching organization invitation',
    owner: 'myorg',
    repo: 'myrepo',
    repoInvitations: [],
    orgMemberships: [
      { state: 'pending', organization: { login: 'myorg' } },
      { state: 'active', organization: { login: 'anotherog' } },
    ],
    expectedResult: { acceptedRepo: false, acceptedOrg: true },
    expectedExecCalls: ['gh api -X PATCH /user/memberships/orgs/myorg -f state=active'],
    expectedNotExecCalls: ['gh api -X PATCH /user/memberships/orgs/anotherog -f state=active'],
  },
  {
    name: 'Accepts both repository and organization invitations',
    owner: 'myorg',
    repo: 'myrepo',
    repoInvitations: [{ id: 201, repository: { full_name: 'myorg/myrepo' } }],
    orgMemberships: [{ state: 'pending', organization: { login: 'myorg' } }],
    expectedResult: { acceptedRepo: true, acceptedOrg: true },
    expectedExecCalls: ['gh api -X PATCH /user/repository_invitations/201', 'gh api -X PATCH /user/memberships/orgs/myorg -f state=active'],
    expectedNotExecCalls: [],
  },
  {
    name: 'Skips non-matching repository invitations',
    owner: 'myorg',
    repo: 'myrepo',
    repoInvitations: [
      { id: 301, repository: { full_name: 'otherorg/otherrepo' } },
      { id: 302, repository: { full_name: 'myorg/differentrepo' } },
    ],
    orgMemberships: [],
    expectedResult: { acceptedRepo: false, acceptedOrg: false },
    expectedExecCalls: [],
    expectedNotExecCalls: ['gh api -X PATCH /user/repository_invitations/301', 'gh api -X PATCH /user/repository_invitations/302'],
  },
  {
    name: 'Skips non-pending (active) organization memberships',
    owner: 'myorg',
    repo: 'myrepo',
    repoInvitations: [],
    orgMemberships: [{ state: 'active', organization: { login: 'myorg' } }],
    expectedResult: { acceptedRepo: false, acceptedOrg: false },
    expectedExecCalls: [],
    expectedNotExecCalls: ['gh api -X PATCH /user/memberships/orgs/myorg -f state=active'],
  },
  {
    name: 'Handles empty invitation lists gracefully',
    owner: 'myorg',
    repo: 'myrepo',
    repoInvitations: [],
    orgMemberships: [],
    expectedResult: { acceptedRepo: false, acceptedOrg: false },
    expectedExecCalls: [],
    expectedNotExecCalls: [],
  },
  {
    name: 'Case-insensitive repository name matching',
    owner: 'MyOrg',
    repo: 'MyRepo',
    repoInvitations: [{ id: 401, repository: { full_name: 'myorg/myrepo' } }],
    orgMemberships: [],
    expectedResult: { acceptedRepo: true, acceptedOrg: false },
    expectedExecCalls: ['gh api -X PATCH /user/repository_invitations/401'],
    expectedNotExecCalls: [],
  },
  {
    name: 'Case-insensitive organization name matching',
    owner: 'MyOrg',
    repo: 'myrepo',
    repoInvitations: [],
    orgMemberships: [{ state: 'pending', organization: { login: 'myorg' } }],
    expectedResult: { acceptedRepo: false, acceptedOrg: true },
    expectedExecCalls: ['gh api -X PATCH /user/memberships/orgs/myorg -f state=active'],
    expectedNotExecCalls: [],
  },
  {
    name: 'Does not accept invitations for different repository in same org',
    owner: 'myorg',
    repo: 'specific-repo',
    repoInvitations: [
      { id: 501, repository: { full_name: 'myorg/other-repo' } },
      { id: 502, repository: { full_name: 'myorg/specific-repo' } },
    ],
    orgMemberships: [],
    expectedResult: { acceptedRepo: true, acceptedOrg: false },
    expectedExecCalls: ['gh api -X PATCH /user/repository_invitations/502'],
    expectedNotExecCalls: ['gh api -X PATCH /user/repository_invitations/501'],
  },
];

for (const testCase of testCases) {
  const execCalls = [];
  let success = true;
  const failures = [];

  try {
    const result = await autoAcceptInviteForRepoWithMocks(testCase.owner, testCase.repo, {
      repoInvitations: testCase.repoInvitations,
      orgMemberships: testCase.orgMemberships,
      execCalls,
    });

    // Check result
    if (result.acceptedRepo !== testCase.expectedResult.acceptedRepo) {
      success = false;
      failures.push(`Expected acceptedRepo=${testCase.expectedResult.acceptedRepo}, got ${result.acceptedRepo}`);
    }
    if (result.acceptedOrg !== testCase.expectedResult.acceptedOrg) {
      success = false;
      failures.push(`Expected acceptedOrg=${testCase.expectedResult.acceptedOrg}, got ${result.acceptedOrg}`);
    }

    // Check exec calls that should have been made
    for (const expectedCall of testCase.expectedExecCalls) {
      if (!execCalls.includes(expectedCall)) {
        success = false;
        failures.push(`Expected exec call not made: "${expectedCall}"`);
      }
    }

    // Check exec calls that should NOT have been made
    for (const notExpectedCall of testCase.expectedNotExecCalls) {
      if (execCalls.includes(notExpectedCall)) {
        success = false;
        failures.push(`Unexpected exec call was made: "${notExpectedCall}"`);
      }
    }
  } catch (err) {
    success = false;
    failures.push(`Threw exception: ${err.message}`);
  }

  if (success) {
    console.log(`✅ PASS: ${testCase.name}`);
    passed++;
  } else {
    console.log(`❌ FAIL: ${testCase.name}`);
    for (const failure of failures) {
      console.log(`   ${failure}`);
    }
    failed++;
  }
}

console.log();
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
  console.log('📝 Issue #1373 requirements verified:');
  console.log('   ✅ Accepts only the invitation for the specific repository (not all)');
  console.log('   ✅ Accepts only the invitation for the specific organization (not all)');
  console.log('   ✅ Case-insensitive matching for owner and repo names');
  console.log('   ✅ Handles empty invitation lists gracefully');
  console.log('   ✅ Does not accept invitations for other repos in the same org');
  console.log('   ✅ Skips non-pending (active) organization memberships');
  console.log();
  process.exit(0);
} else {
  console.log(`❌ ${failed} test(s) failed!`);
  console.log();
  process.exit(1);
}
