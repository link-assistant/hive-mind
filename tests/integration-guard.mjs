/**
 * Integration-test guard.
 *
 * Use at the top of any test that performs real (token-consuming, network-
 * heavy, or external-account-touching) work:
 *
 *   import { skipUnlessIntegration } from './integration-guard.mjs';
 *   skipUnlessIntegration(import.meta.url);
 *
 * The guard is a no-op when:
 *   - HIVE_MIND_RUN_INTEGRATION=1 is set in the environment, or
 *   - the test is invoked by the runner with `--suite integration` (which sets
 *     the same environment variable for child processes).
 *
 * Otherwise it prints a single skip line to stdout and exits with code 0,
 * leaving the rest of the file untouched. This prevents accidental token spend
 * in local and CI test runs without blocking opt-in execution.
 *
 * Tag the test file with the matching marker so the runner classifies it
 * correctly:
 *
 *   // @hive-mind-integration
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1758
 *
 * @hive-mind-test-skip
 */

/**
 * Returns true when integration tests are explicitly enabled.
 */
export function isIntegrationEnabled() {
  return process.env.HIVE_MIND_RUN_INTEGRATION === '1';
}

/**
 * Skips the calling test file unless integration mode is enabled.
 *
 * @param {string} [importMetaUrl] - Pass `import.meta.url` so the skip line
 *   includes the test file name. Optional but recommended.
 */
export function skipUnlessIntegration(importMetaUrl) {
  if (isIntegrationEnabled()) return;
  const label = importMetaUrl ? new URL(importMetaUrl).pathname.split('/').pop() : 'integration test';
  console.log(`⏭️  Skipping ${label} — set HIVE_MIND_RUN_INTEGRATION=1 (or use --suite integration) to enable.`);
  process.exit(0);
}
