#!/usr/bin/env node
/**
 * Script to automatically accept GitHub repository and organization invitations
 *
 * Requirements:
 *   - Node.js 18+
 *   - Environment variable: GITHUB_TOKEN with 'repo:invite' and 'admin:org' scopes
 *
 * Usage:
 *   node accept-invitations.mjs                    # Accept all invitations
 *   node accept-invitations.mjs --dry-run          # Preview without accepting
 *   node accept-invitations.mjs --repos-only       # Only accept repo invitations
 *   node accept-invitations.mjs --orgs-only        # Only accept org invitations
 *   node accept-invitations.mjs --allow user1,user2 # Only accept from these users
 *   node accept-invitations.mjs --deny user1,user2  # Deny invitations from these users
 */

const GITHUB_API_BASE = 'https://api.github.com';

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const reposOnly = args.includes('--repos-only');
const orgsOnly = args.includes('--orgs-only');

let allowList = [];
let denyList = [];

const allowIndex = args.indexOf('--allow');
if (allowIndex !== -1 && args[allowIndex + 1]) {
  allowList = args[allowIndex + 1].split(',').map((u) => u.trim().toLowerCase());
}

const denyIndex = args.indexOf('--deny');
if (denyIndex !== -1 && args[denyIndex + 1]) {
  denyList = args[denyIndex + 1].split(',').map((u) => u.trim().toLowerCase());
}

const token = process.env.GITHUB_TOKEN;

if (!token) {
  console.error('Error: GITHUB_TOKEN environment variable is required');
  console.error('');
  console.error(
    'Create a Personal Access Token at: https://github.com/settings/tokens'
  );
  console.error('Required scopes: repo:invite, admin:org');
  process.exit(1);
}

const headers = {
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': '2022-11-28',
};

async function fetchJSON(url, options = {}) {
  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API Error ${response.status}: ${error}`);
  }
  // Handle 204 No Content
  if (response.status === 204) {
    return null;
  }
  return response.json();
}

async function listRepoInvitations() {
  console.log('Fetching repository invitations...');
  const invitations = await fetchJSON(
    `${GITHUB_API_BASE}/user/repository_invitations`
  );
  console.log(`Found ${invitations.length} pending repository invitation(s)`);
  return invitations;
}

async function acceptRepoInvitation(invitationId) {
  return fetchJSON(
    `${GITHUB_API_BASE}/user/repository_invitations/${invitationId}`,
    { method: 'PATCH' }
  );
}

async function listOrgMemberships() {
  console.log('Fetching organization memberships...');
  const memberships = await fetchJSON(
    `${GITHUB_API_BASE}/user/memberships/orgs`
  );
  const pending = memberships.filter((m) => m.state === 'pending');
  console.log(`Found ${pending.length} pending organization invitation(s)`);
  return pending;
}

async function acceptOrgInvitation(orgName) {
  return fetchJSON(`${GITHUB_API_BASE}/user/memberships/orgs/${orgName}`, {
    method: 'PATCH',
    body: JSON.stringify({ state: 'active' }),
  });
}

function shouldAccept(inviter) {
  const inviterLower = inviter.toLowerCase();

  // Check deny list first
  if (denyList.includes(inviterLower)) {
    return { accept: false, reason: 'user in deny list' };
  }

  // If allow list is specified, only accept from those users
  if (allowList.length > 0 && !allowList.includes(inviterLower)) {
    return { accept: false, reason: 'user not in allow list' };
  }

  return { accept: true };
}

async function processRepoInvitations() {
  const invitations = await listRepoInvitations();

  if (invitations.length === 0) {
    console.log('No pending repository invitations.');
    return;
  }

  console.log('');
  console.log('Repository Invitations:');
  for (const inv of invitations) {
    const repoName = inv.repository.full_name;
    const inviter = inv.inviter.login;
    const expired = inv.expired;

    const decision = shouldAccept(inviter);

    console.log(
      `  - ${repoName} (from: ${inviter}, expired: ${expired})${!decision.accept ? ` [SKIP: ${decision.reason}]` : ''}`
    );

    if (!decision.accept) continue;

    if (!dryRun) {
      try {
        await acceptRepoInvitation(inv.id);
        console.log(`    -> Accepted!`);
      } catch (error) {
        console.log(`    -> Failed: ${error.message}`);
      }
    }
  }
}

async function processOrgInvitations() {
  const pending = await listOrgMemberships();

  if (pending.length === 0) {
    console.log('No pending organization invitations.');
    return;
  }

  console.log('');
  console.log('Organization Invitations:');
  for (const membership of pending) {
    const orgName = membership.organization.login;
    const role = membership.role;

    console.log(`  - ${orgName} (role: ${role})`);

    if (!dryRun) {
      try {
        await acceptOrgInvitation(orgName);
        console.log(`    -> Accepted!`);
      } catch (error) {
        console.log(`    -> Failed: ${error.message}`);
      }
    }
  }
}

async function main() {
  console.log('=== GitHub Invitation Acceptor ===');
  console.log('');

  if (dryRun) {
    console.log('DRY RUN MODE - No invitations will be accepted');
    console.log('');
  }

  if (allowList.length > 0) {
    console.log(`Allow list: ${allowList.join(', ')}`);
  }
  if (denyList.length > 0) {
    console.log(`Deny list: ${denyList.join(', ')}`);
  }
  if (allowList.length > 0 || denyList.length > 0) {
    console.log('');
  }

  try {
    if (!orgsOnly) {
      await processRepoInvitations();
    }

    console.log('');

    if (!reposOnly) {
      await processOrgInvitations();
    }

    console.log('');
    console.log('Done!');
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
