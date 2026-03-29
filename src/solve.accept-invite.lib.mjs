/**
 * Auto-accept GitHub invitation for a specific repository/organization.
 *
 * Unlike the /accept_invites Telegram command (which accepts ALL pending invitations),
 * this module only accepts the invitation for the specific repository or organization
 * that is being solved. This is safer and more targeted.
 *
 * @see https://docs.github.com/en/rest/collaborators/invitations
 * @see https://docs.github.com/en/rest/orgs/members
 * @see https://github.com/link-assistant/hive-mind/issues/1373
 */

import { promisify } from 'util';
import { exec as execCallback } from 'child_process';

const exec = promisify(execCallback);

/**
 * Accepts pending GitHub repository or organization invitation for a specific target.
 *
 * Checks for a pending repository invitation matching `owner/repo` and/or a pending
 * organization membership for `owner`. Accepts only the matching invitation(s).
 *
 * @param {string} owner - Repository owner (user or organization login)
 * @param {string} repo - Repository name
 * @param {Function} log - Logging function
 * @param {boolean} verbose - Whether verbose logging is enabled
 * @returns {Promise<{acceptedRepo: boolean, acceptedOrg: boolean}>} Result of acceptance attempts
 */
export async function autoAcceptInviteForRepo(owner, repo, log, verbose) {
  const result = { acceptedRepo: false, acceptedOrg: false };
  const fullName = `${owner}/${repo}`;

  await log(`🔍 --auto-accept-invite: Checking for pending invitation to ${fullName}...`);

  // Check for pending repository invitation
  try {
    const { stdout: repoInvJson } = await exec('gh api /user/repository_invitations 2>/dev/null || echo "[]"');
    const repoInvitations = JSON.parse(repoInvJson.trim() || '[]');
    verbose && (await log(`   Found ${repoInvitations.length} total pending repo invitation(s)`, { verbose: true }));

    const matchingInv = repoInvitations.find(inv => inv.repository?.full_name?.toLowerCase() === fullName.toLowerCase());

    if (matchingInv) {
      try {
        await exec(`gh api -X PATCH /user/repository_invitations/${matchingInv.id}`);
        await log(`✅ --auto-accept-invite: Accepted repository invitation for ${fullName}`);
        result.acceptedRepo = true;
      } catch (e) {
        await log(`⚠️  --auto-accept-invite: Failed to accept repository invitation for ${fullName}: ${e.message}`, { level: 'warning' });
      }
    } else {
      verbose && (await log(`   No pending repository invitation found for ${fullName}`, { verbose: true }));
    }
  } catch (e) {
    verbose && (await log(`   Could not fetch repository invitations: ${e.message}`, { verbose: true }));
  }

  // Check for pending organization membership
  try {
    const { stdout: orgMemJson } = await exec('gh api /user/memberships/orgs 2>/dev/null || echo "[]"');
    const orgMemberships = JSON.parse(orgMemJson.trim() || '[]');
    const pendingOrgs = orgMemberships.filter(m => m.state === 'pending');
    verbose && (await log(`   Found ${pendingOrgs.length} total pending org invitation(s)`, { verbose: true }));

    const matchingOrg = pendingOrgs.find(m => m.organization?.login?.toLowerCase() === owner.toLowerCase());

    if (matchingOrg) {
      const orgName = matchingOrg.organization.login;
      try {
        await exec(`gh api -X PATCH /user/memberships/orgs/${orgName} -f state=active`);
        await log(`✅ --auto-accept-invite: Accepted organization invitation for ${orgName}`);
        result.acceptedOrg = true;
      } catch (e) {
        await log(`⚠️  --auto-accept-invite: Failed to accept organization invitation for ${orgName}: ${e.message}`, { level: 'warning' });
      }
    } else {
      verbose && (await log(`   No pending organization invitation found for ${owner}`, { verbose: true }));
    }
  } catch (e) {
    verbose && (await log(`   Could not fetch organization memberships: ${e.message}`, { verbose: true }));
  }

  if (!result.acceptedRepo && !result.acceptedOrg) {
    await log(`ℹ️  --auto-accept-invite: No pending invitation found for ${fullName} or organization ${owner}`);
  }

  return result;
}
