import { preflightDockerIsolation } from '../src/isolation-runner.lib.mjs';
// Simulate the bot's dind startup against THIS host's real docker daemon.
const result = await preflightDockerIsolation({
  env: { HIVE_MIND_IMAGE_VARIANT: 'dind' },
  verbose: true,
});
console.log('\n--- preflight result ---');
console.log(
  JSON.stringify(
    {
      image: result.image,
      isDind: result.isDind,
      socketMounted: result.socketMounted,
      imagePresent: result.imagePresent,
      storageDriver: result.storageDriver,
      storageDriverOk: result.storageDriverOk,
      diskAvailableGiB: Number(result.diskAvailableGiB?.toFixed?.(1)),
      ok: result.ok,
      warningCount: result.warnings.length,
    },
    null,
    2
  )
);
console.log('\n--- warnings ---');
result.warnings.forEach((w, i) => console.log(`[${i + 1}] ${w}\n`));
