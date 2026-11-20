import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const DOCKER_DAEMON_CHECK_TIMEOUT_MS = 5_000;

/** Ask the server through the same Docker CLI environment used for mounts. */
export async function checkDockerDaemonReachability(env) {
  try {
    await execute('docker', ['version', '--format', '{{.Server.Version}}'], { env, timeout: DOCKER_DAEMON_CHECK_TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 });
    return null;
  } catch (error) {
    if (error.code === 'ENOENT') return 'Docker CLI was not found. Install Docker in the bot environment or use the hive-mind-dind image with its entrypoint.';
    if (error.killed && error.signal === 'SIGKILL') return 'Docker daemon reachability check timed out. Check the configured Docker endpoint and make sure the daemon is running.';

    // Normalize known errors. Raw CLI output can include private endpoints,
    // certificate paths or credential-bearing URLs from Docker configuration.
    const diagnostic = error.stderr || '';
    const defaultSocket = /unix:\/\/\/var\/run\/docker\.sock(?:[\s"'.,;]|$)/u.test(diagnostic);
    if (/permission denied/iu.test(diagnostic)) {
      return `Permission denied while connecting to the Docker daemon${defaultSocket ? ' at unix:///var/run/docker.sock' : ''}. Grant the bot user access to the configured Docker endpoint.`;
    }
    if (/cannot connect to the docker daemon|failed to connect to the docker api|error during connect|connection refused/iu.test(diagnostic)) {
      if (defaultSocket) {
        return 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Start Docker and, for a plain bot container, mount the host socket (-v /var/run/docker.sock:/var/run/docker.sock) or use the hive-mind-dind image with its entrypoint.';
      }
      return 'Cannot connect to the configured Docker daemon. Check DOCKER_HOST and the selected Docker context, and make sure the daemon is running.';
    }
    return 'Docker daemon preflight failed. Run docker version as the bot user to diagnose the configured Docker endpoint.';
  }
}
