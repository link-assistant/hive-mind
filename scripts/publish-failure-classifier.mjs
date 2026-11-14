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

// The registry refuses the tarball because it is too large (issue #4050). npm
// answers the same bytes the same way every time, so a retry only spends
// another ~90 s uploading 250 MB before failing identically: runs 42805396999
// (2.40.0) and 43242624306 (2.40.1) each failed three times with
// `E413: 413 Payload Too Large - PUT https://registry.npmjs.org/...`.
export const PAYLOAD_TOO_LARGE_PATTERNS = ['e413', '413 payload too large', 'payload too large'];

// npm never finished processing a native Codex variant inside the release job's
// wait (issue #4055, F9). Republishing in the same job only repeats the ~30-minute
// wait, which the job timeout cannot hold three times; a rerun later can succeed.
export const VARIANT_NOT_INSTALLABLE_PATTERNS = ['are not installable after publication'];

/**
 * Whether a native Codex variant never became installable.
 * @param {string} output - Combined stdout and stderr (and/or error message).
 * @returns {boolean}
 */
export function isVariantNotInstallable(output) {
  const lowerOutput = String(output || '').toLowerCase();
  return VARIANT_NOT_INSTALLABLE_PATTERNS.some(pattern => lowerOutput.includes(pattern));
}

/**
 * Whether the registry rejected the tarball because of its size.
 * @param {string} output - Combined stdout and stderr (and/or error message).
 * @returns {boolean}
 */
export function isPayloadTooLarge(output) {
  const lowerOutput = String(output || '').toLowerCase();
  return PAYLOAD_TOO_LARGE_PATTERNS.some(pattern => lowerOutput.includes(pattern));
}

/**
 * Determine whether a detected failure is caused by authentication / registry
 * configuration (and therefore should not be retried).
 * @param {string} output - Combined stdout and stderr (and/or error message).
 * @returns {boolean}
 */
export function isNonRetryableFailure(output) {
  const lowerOutput = String(output || '').toLowerCase();
  return NON_RETRYABLE_PATTERNS.some(pattern => lowerOutput.includes(pattern)) || isPayloadTooLarge(lowerOutput) || isVariantNotInstallable(lowerOutput);
}

// npm's two wordings for "this exact version is already on the registry".
// Each captures the version so a conflict on another version never matches.
export const VERSION_CONFLICT_PATTERNS = [/cannot publish over the previously published versions?:\s*(\S+)/gi, /cannot publish over (?:the )?previously staged versions?:?\s*(\S+)/gi];

/**
 * Whether publish output says the version we are releasing already exists on the
 * registry (npm's EPUBLISHCONFLICT).
 *
 * This is not a failure: it means the release already landed — typically because
 * an earlier attempt in this same run published successfully and the registry had
 * not yet propagated it (issue #2082, finding F5). The caller must still verify
 * the version against the registry before treating it as success.
 *
 * The version is matched explicitly so a conflict reported for some *other*
 * package version is never mistaken for ours.
 *
 * npm also answers `E409 ... Cannot publish over previously staged version
 * "2.35.1"` while an accepted version is not yet visible on the public read
 * path (issue #2923; link-foundation/js-ai-driven-development-pipeline-template#158).
 * That is the same "already landed" situation, so it must verify, not retry: a
 * re-run during npm's propagation window would otherwise fail three times on a
 * permanent conflict for a release that succeeded.
 *
 * @param {string} output - Combined stdout and stderr (and/or error message).
 * @param {string} version - The version this run is publishing.
 * @returns {boolean}
 */
export function isVersionConflict(output, version) {
  if (!version) {
    return false;
  }
  const text = String(output || '');
  for (const pattern of VERSION_CONFLICT_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      // The messages end in punctuation: "...versions: 2.8.3." or "...version "0.20.1"."
      if (match[1].replace(/^"|[".,]+$/g, '') === version) {
        return true;
      }
    }
  }
  return false;
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

/**
 * Build an actionable explanation for an npm `E413 Payload Too Large` refusal.
 *
 * npm does not document the limit. It accepted @openai/codex@0.164.0-linux-x64
 * (165,142,849 bytes) and refused @link-assistant/hive-mind@2.40.1
 * (249,862,346 bytes), so `scripts/check-npm-tarball-size.mjs` keeps every
 * tarball this repository publishes below a 157 MiB budget.
 *
 * @param {string} packageName - The package that failed to publish.
 * @returns {string}
 */
export function buildPayloadTooLargeGuidance(packageName) {
  return ['', '=== NPM PUBLISH REJECTED: TARBALL TOO LARGE (E413) ===', '', `The registry refused ${packageName} with "413 Payload Too Large". The same`, 'tarball is refused the same way on every attempt, so it was not retried.', '', 'Find what grew:', '  npm pack --dry-run --json | node scripts/check-npm-tarball-size.mjs --stdin', '', 'SOLUTION: move large platform-specific payloads (native binaries) into', 'per-platform packages that the main package lists as optionalDependencies,', 'the way @openai/codex publishes its native builds (src/native-codex/PACKAGES.md).', 'Each tarball must stay below the budget in scripts/check-npm-tarball-size.mjs.', ''].join('\n');
}

/**
 * Build an explanation for a native Codex variant that npm did not finish
 * processing in time (issue #4055, F9).
 * @param {string} packageName - The package that was not published.
 * @returns {string}
 */
export function buildVariantNotInstallableGuidance(packageName) {
  return ['', '=== NATIVE CODEX VARIANT NOT INSTALLABLE ===', '', `npm accepted a native Codex variant but did not make it installable within the`, `wait, so ${packageName} was not published: it would pin an optional dependency`, 'that npm and Bun cannot resolve and silently skip.', '', 'SOLUTION: rerun the failed release job. Published variants are skipped and the', 'wait starts again; npm has always finished processing within minutes.', ''].join('\n');
}

/**
 * Pick the guidance that explains a non-retryable failure.
 * @param {string} output - Combined stdout and stderr (and/or error message).
 * @param {string} packageName - The package that failed to publish.
 * @returns {{title:string, guidance:string}}
 */
export function describeNonRetryableFailure(output, packageName) {
  if (isPayloadTooLarge(output)) {
    return { title: 'npm publish rejected: tarball too large (E413)', guidance: buildPayloadTooLargeGuidance(packageName) };
  }
  if (isVariantNotInstallable(output)) {
    return { title: 'native Codex variant not installable', guidance: buildVariantNotInstallableGuidance(packageName) };
  }
  return { title: 'npm publish rejected: authentication or registry configuration', guidance: buildAuthFailureGuidance(packageName) };
}
