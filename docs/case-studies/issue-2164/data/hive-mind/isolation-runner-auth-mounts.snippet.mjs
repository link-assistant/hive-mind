  const explicit = String(env.DIND_HOST_DOCKER_SOCK || '').trim();
  return explicit || DEFAULT_HOST_DOCKER_SOCK;
}
/**
 * Build host auth mounts for a Docker-isolated task.
 *
 * GitHub auth is mounted for every task because solve/hive/task need gh. Git
 * identity (`~/.gitconfig` and the XDG `~/.config/git` directory) is mounted for
 * every task too: it is tool-agnostic and `solve` aborts early with "Git
 * identity not configured" when `user.name`/`user.email` are absent, so a child
 * container that authenticates with gh but inherits no git identity still cannot
 * commit. See issue #1939. Tool credentials are deliberately scoped: Codex
 * sessions do not receive Claude files and Claude sessions do not receive Codex
 * files.
 */
export function getDockerIsolationAuthMounts({ tool = 'claude', env = process.env, homeDir = os.homedir(), existsSync = fs.existsSync } = {}) {
  const mounts = [];
  const normalizedTool = normalizeTool(tool);
  maybeAddMount(mounts, env.GH_CONFIG_DIR || path.join(homeDir, '.config', 'gh'), path.join(DOCKER_CONTAINER_HOME, '.config', 'gh'), existsSync);
  // Git identity (tool-agnostic, required for commits). Honor the same env vars git itself reads for an alternate global config location (GIT_CONFIG_GLOBAL) and the XDG base dir, falling back to the conventional `~/.gitconfig` and `~/.config/git`. Missing host paths are skipped, so a container image that already bakes a git identity is left untouched. See issue #1939.
  maybeAddMount(mounts, env.GIT_CONFIG_GLOBAL || path.join(homeDir, '.gitconfig'), path.join(DOCKER_CONTAINER_HOME, '.gitconfig'), existsSync);
  maybeAddMount(mounts, env.XDG_CONFIG_HOME ? path.join(env.XDG_CONFIG_HOME, 'git') : path.join(homeDir, '.config', 'git'), path.join(DOCKER_CONTAINER_HOME, '.config', 'git'), existsSync);
  if (normalizedTool === 'codex') {
    maybeAddMount(mounts, path.join(homeDir, '.codex'), path.join(DOCKER_CONTAINER_HOME, '.codex'), existsSync);
    // Issue #2074: Codex also discovers persistent user Agent Skills from ~/.agents/skills. Propagate that standard location alongside .codex so direct and Docker-isolated solver sessions expose the same capabilities.
    maybeAddMount(mounts, path.join(homeDir, '.agents'), path.join(DOCKER_CONTAINER_HOME, '.agents'), existsSync);
  } else if (normalizedTool === 'claude') {
    maybeAddMount(mounts, path.join(homeDir, '.claude'), path.join(DOCKER_CONTAINER_HOME, '.claude'), existsSync);
    maybeAddMount(mounts, path.join(homeDir, '.claude.json'), path.join(DOCKER_CONTAINER_HOME, '.claude.json'), existsSync);
  }
  return mounts;
}
/**
 * Resolve the image-variant marker recorded inside the isolated container.
 * A `hive-mind-dind` image is always the dind variant; otherwise fall back to
 * the parent's `HIVE_MIND_IMAGE_VARIANT` (or `regular`).
 */
function resolveImageVariant(image, env = process.env) {
  return image.includes('hive-mind-dind') ? 'dind' : env.HIVE_MIND_IMAGE_VARIANT || 'regular';
}
/**
 * Resolve an outer Compose HTTP service before handing its origin to a nested
 * Docker daemon. The nested daemon has its own DNS namespace, but it can route
 * to the outer service's address through the parent container.
 *
 * HTTPS names are deliberately preserved for certificate verification.
 */
export async function resolveFormalAiIsolationEnv(env = process.env, { lookup = lookupHost } = {}) {
  const baseUrl = env.HIVE_MIND_FORMAL_AI_BASE_URL;
  if (!baseUrl) return env;
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return env;
  }
  if (parsed.protocol !== 'http:' || parsed.hostname !== FORMAL_AI_COMPOSE_HOSTNAME) {
    return env;
  }
  try {
    const addresses = await lookup(parsed.hostname, { all: true, verbatim: true });
    const selected = addresses.find(candidate => candidate.family === 4) || addresses[0];
    if (!selected?.address) return env;
    const host = selected.family === 6 ? `[${selected.address}]` : selected.address;
    return {
      ...env,
      HIVE_MIND_FORMAL_AI_BASE_URL: `${parsed.protocol}//${host}${parsed.port ? `:${parsed.port}` : ''}`,
    };
  } catch {
    // Keep the hostname for deployments whose nested DNS can resolve it.
    return env;
  }
}
/**
 * Build the `$` (start-command) arguments that launch a Docker-isolated task
 * using start-command's NATIVE Docker backend (`$ --isolated docker`).
 *
 * Issue #1914: earlier versions wrapped a hand-rolled `docker run` inside a
 * `screen` session (`$ --isolated screen -- docker run …`). That was *screen*
 * isolation merely shelling out to Docker — not Docker isolation. We now hand
 * the container lifecycle to start-command itself and only contribute the
 * pieces Hive Mind must control: which image to run, privileged mode for the
 * dind variant, the environment markers, and the credential mounts scoped to
 * the selected tool.
 *
 * start-command's Docker backend reuses a locally present image and only pulls
 * when it is missing (`docker run` with Docker's default "missing" pull
 * policy), so a host image seeded into the nested daemon via box passthrough is
 * reused instead of re-downloaded — no `--pull` plumbing required (issue #1879).
 */
export function buildDockerIsolationStartArgs(command, args = [], options = {}) {
  const { sessionId, tool = 'claude', env = process.env, homeDir = os.homedir(), existsSync = fs.existsSync } = options;
  const image = getDockerIsolationImage({ env });
  const startArgs = ['--isolated', 'docker', '--image', image];
  if (shouldRunPrivilegedDockerIsolation(image, env)) {
    startArgs.push('--privileged');
  }
  // Force the inner shell so start-command does not probe the image to detect one (see DOCKER_ISOLATION_SHELL).
  startArgs.push('--shell', DOCKER_ISOLATION_SHELL);
  // The image already sets HOME=/home/box and WORKDIR /home/box; pass HOME explicitly anyway so the credential mounts under /home/box resolve even if a future image forgets to. start-command has no --workdir flag, so the working directory comes from the image's WORKDIR.
  startArgs.push('-e', `HOME=${DOCKER_CONTAINER_HOME}`, '-e', `HIVE_MIND_PARENT_SESSION_ID=${sessionId || ''}`, '-e', `HIVE_MIND_IMAGE_VARIANT=${resolveImageVariant(image, env)}`);
  // A persistent Formal AI server normally runs beside the Telegram/root container. Docker-isolated `/solve` jobs must receive the same endpoint; otherwise the wrapper starts a per-job server and loses shared memory.
  if (env.HIVE_MIND_FORMAL_AI_BASE_URL) {
    startArgs.push('-e', `HIVE_MIND_FORMAL_AI_BASE_URL=${env.HIVE_MIND_FORMAL_AI_BASE_URL}`);
  }
  for (const mount of getDockerIsolationAuthMounts({ tool, env, homeDir, existsSync })) {
    startArgs.push('--volume', `${mount.source}:${mount.target}`);
  }
  const taskCommand = buildShellCommand(command, args);
  startArgs.push('--detached', '--session', sessionId, '--', buildDockerStartGatedCommand(taskCommand, sessionId));
  return startArgs;
}
export function buildStartCommandArgs(command, args = [], options = {}) {
  const { backend, sessionId } = options;
  if (backend === 'docker') {
    return buildDockerIsolationStartArgs(command, args, { ...options, sessionId });
  }
  return ['--isolated', backend, '--detached', '--session', sessionId, '--', buildShellCommand(command, args)];
}
async function runStartCommand(binPath, startCommandArgs) {
  return await new Promise(resolve => {
    const child = spawn(binPath, startCommandArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', data => {
      stdout += data.toString();
    });
    child.stderr.on('data', data => {
