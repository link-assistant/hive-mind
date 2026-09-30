/**
 * User repository permissions are not installation-token permissions. GitHub
 * can return all five user roles as false even when an installation token has
 * contents:write (including the built-in Actions token). Return unknown and let
 * GitHub enforce that token's grants on the actual write, rather than trying a
 * user fork. Installation tokens have the documented ghs_ prefix, including
 * GitHub's newer stateless format; never log the token itself.
 */
export function repositoryWriteAccess(permissions, token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '') {
  if (token.startsWith('ghs_') || !permissions || typeof permissions !== 'object') return null;
  if (permissions.push === true || permissions.admin === true || permissions.maintain === true) return true;
  return ['push', 'admin', 'maintain'].some(role => permissions[role] === false) ? false : null;
}
