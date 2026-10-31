import { setTimeout as delay } from 'node:timers/promises';

/** Distinguish a missing/broken image client from a starting nested daemon.
 * Exec/daemon output can contain environment-dependent details; keep it private.
 */
export async function waitForPackagedDockerDaemon({ docker, name, variant, retryDelayMs = 500 }) {
  try {
    await docker(['exec', name, 'docker', '--version'], 5000);
  } catch {
    throw new Error(`${variant} image has no working Docker client; daemon verification cannot start.`);
  }
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      await docker(['exec', name, 'docker', 'info', '--format', '{{.ServerVersion}}'], 5000);
      return;
    } catch {
      await delay(retryDelayMs);
    }
  }
  throw new Error(`${variant} Docker client works but its daemon did not become ready.`);
}
