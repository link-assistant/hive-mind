/**
 * Success-path cleanup for the solve command: the workspace, orphaned agent
 * snapshot stores (#2186) and superseded docker images (#2187).
 *
 * Extracted from solve.repository.lib.mjs, which the docker-image reclamation
 * added in issue #2187 pushed back over the 1350-line warning threshold that
 * scripts/check-file-line-limits.sh enforces (#1593, #2198). These three
 * helpers run after the work is done and share nothing with the
 * repository-setup flow around them, so they are the natural seam.
 *
 * All three names stay re-exported from solve.repository.lib.mjs so existing
 * importers are unaffected.
 */

import fs from 'node:fs/promises';

import { log } from './lib.mjs';
import { reportError } from './sentry.lib.mjs';
import { reclaimAgentSnapshotStores } from './agent-snapshot-store.lib.mjs';
import { collectDockerImageReclaimPlan, formatDockerImageReclaimSummary, reclaimDockerImages, resolveDockerImageReclaimMode } from './docker-image-reclaim.lib.mjs';
import { formatBytes } from './cleanup.lib.mjs';

/**
 * Reclaim orphaned `@link-assistant/agent` snapshot stores (issue #2186).
 *
 * Deliberately *not* gated on `--auto-cleanup`: the stores this removes belong to
 * worktrees that no longer exist, so there is nothing left to restore them into
 * and keeping them has no debugging value. On a public repository auto-cleanup
 * defaults to off, and that must not also mean "leak ~5 GB/h of home-directory
 * state that no Hive Mind disk check can even see".
 *
 * Never fatal: this runs while solve is finalizing, after the work is done.
 */
export const cleanupAgentSnapshotStores = async () => {
  try {
    const { removed } = await reclaimAgentSnapshotStores({ log: async (message, options) => log(message, options) });
    if (removed.length > 0) await log(`🧹 Reclaimed ${removed.length} orphaned agent snapshot store(s)`);
  } catch (cleanupError) {
    reportError(cleanupError, {
      context: 'cleanup_agent_snapshot_stores',
      operation: 'reclaim_agent_snapshots',
    });
    await log(`⚠️  Could not reclaim orphaned agent snapshot stores: ${cleanupError.message}`, { level: 'warning' });
  }
};

/**
 * Reclaim superseded Docker images (issue #2187).
 *
 * Runs on the same success path that reclaims the workspace: `--auto-cleanup`
 * used to free the checkout while every rebuilt image stayed on disk, so the
 * host accumulated superseded konard/hive-mind tags until `docker system df`
 * reported tens of gigabytes reclaimable and the disk gate stopped taking work.
 *
 * The plan keeps the newest tag of every repository, `latest`, the resolved
 * isolation tag and anything a container references, so the host always keeps a
 * usable image. Never fatal: the task is already finished when this runs.
 */
export const cleanupSupersededDockerImages = async argv => {
  const mode = resolveDockerImageReclaimMode(argv);
  if (mode === 'none') return;

  try {
    const plan = await collectDockerImageReclaimPlan({ mode });
    // No docker, or nothing superseded — stay silent.
    if (!plan || plan.remove.length === 0) return;

    await log(`\n🧹 Reclaiming ${plan.remove.length} superseded docker image(s) (${formatBytes(plan.reclaimableBytes)})`);
    const result = await reclaimDockerImages({ plan, log: async message => await log(message) });
    for (const failure of result.failed) {
      await log(`   ⚠️  Kept ${formatDockerImageReclaimSummary(failure)}: ${failure.error}`, { level: 'warning' });
    }
    if (result.removed.length > 0) await log(`   ✅ Reclaimed ${formatBytes(result.reclaimedBytes)} of image storage`);
  } catch (cleanupError) {
    reportError(cleanupError, {
      context: 'cleanup_superseded_docker_images',
      operation: 'reclaim_docker_images',
    });
    await log(`⚠️  Could not reclaim superseded docker images: ${cleanupError.message}`, { level: 'warning' });
  }
};

// Cleanup temporary directory
export const cleanupTempDirectory = async (tempDir, argv, limitReached) => {
  // Determine if we should skip cleanup
  const shouldKeepDirectory = !argv.autoCleanup || argv.resume || limitReached || (argv.autoResumeOnLimitReset && global.limitResetTime);
  if (!shouldKeepDirectory) {
    try {
      process.stdout.write('\n🧹 Cleaning up...');
      await fs.rm(tempDir, { recursive: true, force: true });
      await log(' ✅');
    } catch (cleanupError) {
      reportError(cleanupError, {
        context: 'cleanup_temp_directory',
        tempDir,
        operation: 'remove_temp_dir',
      });
      await log(' ⚠️  (failed)');
    }
  } else if (argv.resume) {
    await log(`\n📁 Keeping directory for resumed session: ${tempDir}`);
  } else if (limitReached && argv.autoContinueLimit) {
    await log(`\n📁 Keeping directory for auto-continue: ${tempDir}`);
  } else if (limitReached) {
    await log(`\n📁 Keeping directory for future resume: ${tempDir}`);
  } else if (!argv.autoCleanup) {
    // Issue #2160: `--no-auto-cleanup` is only one of the two ways to get here. On a public
    // repository auto-cleanup defaults to off, and reporting a flag that was never passed made
    // the run log misleading — the disk kept filling with no hint of why.
    const reason = argv.autoCleanupSource === 'repository-visibility-default' ? 'auto-cleanup is off by default for public repositories' : '--no-auto-cleanup';
    await log(`\n📁 Keeping directory (${reason}): ${tempDir}`);
  }

  // Issue #2186: whatever was decided about the workspace above, agent state
  // whose worktree is already gone is reclaimed. The store belonging to
  // `tempDir` is untouched while `tempDir` still exists.
  await cleanupAgentSnapshotStores();

  // Issue #2187: images superseded by a rebuild are reclaimed on the same path.
  await cleanupSupersededDockerImages(argv);
};
