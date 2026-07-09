/**
 * Classify npm publish failures and build actionable guidance.
 *
 * Why this exists (issue #2028, CI run 29035249489):
 *   `scripts/publish-to-npm.mjs` used to run `await $\`npm run changeset:publish\``
 *   and treat the *absence of a thrown error* as success. command-stream's `$`
 *   does NOT throw on a non-zero exit code (documented in
 *   docs/dependencies-research/command-stream-issues/issue-10-git-push-silent-failure.mjs),
 *   so a failed publish was reported as `published=true`. In run 29035249489 the
 *   underlying `npm publish --provenance` crashed with
 *   "Cannot find module 'sigstore'" (npm 12.0.0 regression, npm/cli#9722),
 *   `changeset publish` printed "packages failed to publish", yet the release job
 *   went green and the downstream Docker jobs waited 5 minutes for a version that
 *   was never published. This module gives the publish script reliable,
 *   content-based failure detection instead of relying on a throw that never
 *   happens.
 *
 * Ported and adapted from
 * link-foundation/js-ai-driven-development-pipeline-template (PR #77, PR #116).
 */

// Substrings that indicate a publish failure in the combined stdout/stderr of
// `npm run changeset:publish`. Matched case-insensitively. `changeset publish`
// swallows npm's non-zero exit for individual packages, so scanning the output
// is the most reliable failure signal.
export const FAILURE_PATTERNS = [
  'packages failed to publish',
  'error occurred while publishing',
  'npm error code e',
  'npm error 404',
  'npm error 401',
  'npm error 403',
  'access token expired',
  'eneedauth',
  // npm 12.0.0 provenance regression (npm/cli#9722): the publish crashes inside
  // libnpmpublish with `Cannot find module 'sigstore'` / MODULE_NOT_FOUND.
  'cannot find module',
  'module_not_found',
];

/**
 * Detect whether changeset/npm publish output indicates a failure.
 * @param {string} output - Combined stdout and stderr (and/or error message).
 * @returns {string|null} - The matched failure pattern, or null if none.
 */
export function detectPublishFailure(output) {
  const lowerOutput = String(output || '').toLowerCase();
  for (const pattern of FAILURE_PATTERNS) {
    if (lowerOutput.includes(pattern)) {
      return pattern;
    }
  }
  return null;
}

// Failures caused by authentication / registry configuration. Retrying these is
// pointless and only hides the real cause behind a generic
// "Failed to publish after N attempts" message.
export const NON_RETRYABLE_PATTERNS = ['npm error 404', 'npm error 401', 'npm error 403', 'e404', 'e401', 'e403', 'access token expired', 'eneedauth', 'you must be logged in', 'unable to authenticate'];

/**
 * Determine whether a detected failure is caused by authentication / registry
 * configuration (and therefore should not be retried).
 * @param {string} output - Combined stdout and stderr (and/or error message).
 * @returns {boolean}
 */
export function isNonRetryableFailure(output) {
  const lowerOutput = String(output || '').toLowerCase();
  return NON_RETRYABLE_PATTERNS.some(pattern => lowerOutput.includes(pattern));
}

/**
 * Build an actionable, human-readable explanation for an authentication /
 * registry-configuration publish failure (most commonly an E404 on the very
 * first publish of a brand-new package via OIDC trusted publishing).
 * @param {string} packageName - The package that failed to publish.
 * @returns {string}
 */
export function buildAuthFailureGuidance(packageName) {
  return [
    '',
    '=== NPM PUBLISH AUTHENTICATION / REGISTRY FAILURE ===',
    '',
    `Failed to publish ${packageName}. This is an authentication or registry`,
    'configuration error, not a transient one, so it was not retried.',
    '',
    'Most common cause: the FIRST publish of a brand-new package via npm OIDC',
    'trusted publishing returns "E404 Not Found - PUT". npm cannot bootstrap a',
    'new package with trusted publishing alone, because a trusted publisher can',
    'only be configured for a package that already exists on the registry.',
    '',
    'SOLUTION (choose one):',
    '  1. Bootstrap the first release with a classic automation token:',
    '     - Create a granular/automation token on npmjs.com with publish access.',
    '     - Add it as the repository secret NPM_TOKEN.',
    '     - The release workflow passes it as NODE_AUTH_TOKEN automatically, so',
    '       the next run will publish the initial version.',
    '  2. After the package exists, configure OIDC trusted publishing on',
    '     npmjs.com (Package settings -> Trusted publishing) so future releases',
    '     need no token at all. The NPM_TOKEN secret then becomes optional.',
    '',
    'See: https://docs.npmjs.com/trusted-publishers',
    '',
  ].join('\n');
}
