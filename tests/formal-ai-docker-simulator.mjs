/**
 * An in-memory Docker daemon good enough to drive the Formal AI sidecar
 * lifecycle and its updater (issue #2146).
 *
 * The lifecycle modules take a `run(command, args, options)` seam, so the whole
 * of `docker` can be replaced by this object. It models the state the lifecycle
 * actually depends on — container existence and liveness, per-network
 * addresses, the `--internal` flag, the memory volume and the local image
 * digests — and fails the same way the real CLI does (non-zero exit with the
 * message on stderr) so the modules' `try`/`catch` branches are exercised
 * rather than mocked away.
 *
 * Issue #2305 added the image store: tags, registry digests, sizes, `docker
 * rmi` (which refuses images a container still uses), `docker system df`, the
 * registry-only `docker buildx imagetools inspect`, and the anonymous volumes
 * an image `VOLUME` leaks when nothing is mounted over it.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2146
 * @see https://github.com/link-assistant/hive-mind/issues/2305
 * @hive-mind-test-skip
 */

const DEFAULT_HEALTH = { version: '0.339.1', memory: { compatible: true, schema_version: 2, migration_required: false, migration_state: 'current' } };

const fail = (message, stdout = '') => {
  const error = new Error(message);
  error.stderr = message;
  error.stdout = stdout;
  throw error;
};

const flagValue = (args, flag) => {
  const index = args.indexOf(flag);
  return index < 0 ? null : args[index + 1];
};

/** Flags of `docker run` that consume the argument after them. */
const VALUE_FLAGS = new Set(['--name', '--label', '-l', '--network', '--network-alias', '--restart', '--env', '-e', '--volume', '-v', '--entrypoint', '--user', '-u', '--workdir', '-w', '--publish', '-p', '--tmpfs', '--mount']);

const FORMAL_AI_REPOSITORY = 'ghcr.io/link-assistant/formal-ai';

/** `repo:tag` → `repo` (a registry port is not a tag). */
const repositoryOf = reference => {
  const colon = reference.lastIndexOf(':');
  return colon > reference.lastIndexOf('/') ? reference.slice(0, colon) : reference;
};

/** The registry manifest digest of a build — distinct from its local image ID, as in real Docker. */
export const manifestDigestOf = imageId => `sha256:manifest-${String(imageId).replace(/^sha256:/, '')}`;

/**
 * The image reference in a `docker run` argv: the first positional argument.
 *
 * Issue #2154 made this worth parsing properly. The sidecar may now boot from
 * the local Hive Mind image (`konard/hive-mind-dind:…`, which bakes `formal-ai`)
 * when the published `ghcr.io/…` image cannot be pulled, so a simulator that
 * recognised only `ghcr.io/` references would have declared the very fallback
 * under test to be "no image at all".
 */
const imageOf = args => {
  for (let index = args[0] === 'run' ? 1 : 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith('-')) {
      if (VALUE_FLAGS.has(arg)) index += 1;
      continue;
    }
    return arg;
  }
  return null;
};

/**
 * @param {object} [options]
 * @param {object} [options.images] - Local image reference → content digest.
 * @param {object} [options.pull] - Image reference → digest a `docker pull` installs.
 * @param {object|Function} [options.health] - `/health` payload, or a function of `(reference, digest)` of the running image.
 * @param {object} [options.memory] - `formal-ai memory <subcommand>` → JSON payload.
 * @param {string} [options.memorySha256] - What `sha256sum` reports for a file in the volume.
 * @param {object|null} [options.registry] - Reference → image ID the registry serves. When set, `docker buildx imagetools inspect` answers from it and `docker pull` installs it; when null the command is unsupported, as on a host without buildx.
 * @param {object} [options.sizes] - Image ID → bytes (default 24 GB each).
 * @param {string[]} [options.imageVolumes] - `VOLUME` paths of every image; each one not mounted over becomes an anonymous volume.
 * @returns {object} `{ run, calls, containers, networks, volumes, images, createContainer, ... }`
 */
export const createDockerSimulator = ({ images = {}, pull = {}, health = DEFAULT_HEALTH, memory = {}, memorySha256 = null, pullError = null, registry = null, sizes = {}, imageVolumes = [] } = {}) => {
  const simulator = {
    calls: [],
    containers: new Map(),
    networks: new Map(),
    volumes: new Set(),
    images: new Map(Object.entries(images)),
    // Content addresses the daemon holds, tagged or not. Retagging a reference
    // leaves the previous image on the host as a dangling one, still runnable
    // by its ID — which is exactly what issue #2207's fix depends on.
    digests: new Set(Object.values(images)),
    memory,
    memorySha256,
    health,
    nextOctet: 2,
    // Image ID → the `repo@sha256:…` references it was pulled under.
    repoDigests: new Map(),
    sizes: new Map(Object.entries(sizes)),
    nextAnonymousVolume: 1,
  };
  for (const [reference, digest] of Object.entries(images)) if (repositoryOf(reference) === FORMAL_AI_REPOSITORY) simulator.repoDigests.set(digest, new Set([`${FORMAL_AI_REPOSITORY}@${manifestDigestOf(digest)}`]));

  simulator.tagsOf = id => [...simulator.images.entries()].filter(([, digest]) => digest === id).map(([reference]) => reference);
  simulator.sizeOf = id => simulator.sizes.get(id) ?? 24_000_000_000;
  simulator.anonymousVolumes = () => [...simulator.volumes].filter(name => name.startsWith('anonymous-'));

  /** Pretend a task container was created by start-command. */
  simulator.createContainer = (name, { image = 'ghcr.io/link-assistant/isolation:latest', running = true } = {}) => {
    simulator.containers.set(name, { image, imageDigest: simulator.images.get(image) ?? 'sha256:task', running, networks: new Map() });
    return simulator.containers.get(name);
  };

  simulator.ran = pattern => simulator.calls.some(call => (typeof pattern === 'string' ? call.includes(pattern) : pattern.test(call)));

  /**
   * Resolve a reference the way the daemon does: a tag, or a content address.
   *
   * Real Docker accepts an image ID (`sha256:…`, what `docker image inspect
   * --format {{.Id}}` prints) everywhere a tag is accepted, and that is the
   * whole mechanism issue #2207's fix relies on — booting the *accepted*
   * revision cannot be diverted by a tag that moved afterwards. A simulator that
   * only knew tags would have reported the accepted image as absent.
   */
  simulator.resolveImage = reference => {
    if (simulator.images.has(reference)) return simulator.images.get(reference);
    if (simulator.digests.has(reference)) return reference;
    for (const [id, references] of simulator.repoDigests.entries()) if (references.has(reference) && simulator.digests.has(id)) return id;
    return null;
  };

  /** Move a tag to a different build, the way a registry push does. */
  simulator.retag = (reference, digest) => {
    simulator.images.set(reference, digest);
    simulator.digests.add(digest);
  };

  /** The tag that currently points at a content address, for `/health` lookups. */
  const referenceOf = image => {
    if (simulator.images.has(image)) return image;
    for (const [reference, digest] of simulator.images.entries()) if (digest === image) return reference;
    return image;
  };

  const attach = (networkName, containerName) => {
    const network = simulator.networks.get(networkName);
    if (!network) fail(`Error response from daemon: network ${networkName} not found`);
    const container = simulator.containers.get(containerName);
    if (!container) fail(`Error response from daemon: No such container: ${containerName}`);
    if (container.networks.has(networkName)) fail(`Error response from daemon: endpoint with name ${containerName} already exists in network ${networkName}`);
    const address = `172.28.0.${simulator.nextOctet}`;
    simulator.nextOctet += 1;
    container.networks.set(networkName, address);
    network.containers.add(containerName);
    return address;
  };

  const inspectContainer = args => {
    const container = simulator.containers.get(args[1]);
    if (!container) fail(`Error: No such object: ${args[1]}`);
    const format = args[3] ?? '';
    if (format.includes('NetworkSettings.Networks')) return container.networks.get(format.match(/"([^"]+)"/)?.[1] ?? '') ?? '';
    return `${container.running}|${container.image}|${container.imageDigest}`;
  };

  const handleNetwork = args => {
    const [, subcommand] = args;
    if (subcommand === 'inspect') {
      const network = simulator.networks.get(args[2]);
      if (!network) fail(`Error: No such network: ${args[2]}`);
      return `${network.internal}|${network.containers.size}`;
    }
    if (subcommand === 'create') {
      const name = args[args.length - 1];
      if (simulator.networks.has(name)) fail(`Error response from daemon: network with name ${name} already exists`);
      simulator.networks.set(name, { internal: args.includes('--internal'), containers: new Set() });
      return name;
    }
    if (subcommand === 'rm') {
      const network = simulator.networks.get(args[2]);
      if (!network) fail(`Error: No such network: ${args[2]}`);
      // Real Docker refuses only while an attached container is running.
      if ([...network.containers].some(name => simulator.containers.get(name)?.running)) fail(`Error response from daemon: network ${args[2]} has active endpoints`);
      simulator.networks.delete(args[2]);
      return args[2];
    }
    if (subcommand === 'connect') return attach(args[2], args[3]) && '';
    return fail(`unsupported: docker ${args.join(' ')}`);
  };

  const handleVolume = args => {
    const [, subcommand] = args;
    const name = args[args.length - 1];
    if (subcommand === 'inspect') {
      if (!simulator.volumes.has(name)) fail(`Error: No such volume: ${name}`);
      return `[{"Name":"${name}"}]`;
    }
    if (subcommand === 'create') {
      simulator.volumes.add(name);
      return name;
    }
    if (subcommand === 'rm') {
      simulator.volumes.delete(name);
      return name;
    }
    return fail(`unsupported: docker ${args.join(' ')}`);
  };

  /** `docker run --rm …`: the throwaway containers the updater uses on the memory volume. */
  const handleEphemeralRun = args => {
    const entrypoint = flagValue(args, '--entrypoint');
    if (entrypoint === 'chown' || entrypoint === 'sh') return '';
    if (entrypoint === 'sha256sum') {
      if (!simulator.memorySha256) fail('sha256sum: no such file or directory');
      return `${simulator.memorySha256}  ${args[args.length - 1]}`;
    }
    const subcommand = args[args.indexOf('memory') + 1];
    const payload = simulator.memory[subcommand];
    if (!payload) fail(`formal-ai memory ${subcommand}: refused`);
    const resolved = typeof payload === 'function' ? payload(imageOf(args)) : payload;
    // The published image's entrypoint prints a banner before the payload.
    const stdout = typeof payload === 'function' ? JSON.stringify(resolved) : `formal-ai container entrypoint\n${JSON.stringify(resolved)}`;
    // Upstream prints the refusal on stdout and *then* exits nonzero
    // (`src/cli_memory.rs`): an incompatible status for `upgrade-status`, an
    // `{error: {code, message}}` object for `migrate`.
    if (resolved.compatible === false) fail('persisted-memory preflight refused an incompatible file', stdout);
    if (resolved.error) fail('persisted-memory migration refused to modify the file', stdout);
    return stdout;
  };

  const handleRun = args => {
    if (args.includes('--rm')) return handleEphemeralRun(args);
    const name = flagValue(args, '--name');
    if (simulator.containers.has(name)) fail(`Error response from daemon: Conflict. The container name "/${name}" is already in use`);
    const image = imageOf(args);
    const digest = simulator.resolveImage(image);
    if (!digest) fail(`Unable to find image '${image}' locally`);
    // An image `VOLUME` nothing is mounted over gets a fresh anonymous volume.
    const mounted = new Set();
    args.forEach((arg, index) => {
      if (arg === '--tmpfs') mounted.add(args[index + 1].split(':')[0]);
      if (arg === '--volume' || arg === '-v') mounted.add(args[index + 1].split(':')[1]);
    });
    const anonymousVolumes = imageVolumes.filter(path => !mounted.has(path)).map(() => `anonymous-${simulator.nextAnonymousVolume++}`);
    for (const volume of anonymousVolumes) simulator.volumes.add(volume);
    // `{{.Config.Image}}` echoes the reference the container was created from,
    // so a container booted by digest reports the digest.
    simulator.containers.set(name, { image, imageDigest: digest, running: true, networks: new Map(), labels: args.flatMap((arg, index) => (arg === '--label' ? [args[index + 1]] : [])), anonymousVolumes });
    const network = flagValue(args, '--network');
    if (network) attach(network, name);
    return `${name}-id`;
  };

  /** `docker image ls --quiet [repository] [--filter label=…]`. */
  const listImages = args => {
    const positional = args.slice(2).filter((arg, index, rest) => !arg.startsWith('-') && rest[index - 1] !== '--filter');
    const label = flagValue(args, '--filter');
    const isFormalAi = id => simulator.tagsOf(id).some(tag => repositoryOf(tag) === FORMAL_AI_REPOSITORY) || [...(simulator.repoDigests.get(id) ?? [])].some(reference => reference.startsWith(`${FORMAL_AI_REPOSITORY}@`));
    return [...simulator.digests]
      .filter(id => {
        // Every Formal AI build carries the release's source label.
        if (label) return isFormalAi(id);
        if (positional.length === 0) return true;
        return simulator.tagsOf(id).some(tag => repositoryOf(tag) === positional[0]) || [...(simulator.repoDigests.get(id) ?? [])].some(reference => reference.startsWith(`${positional[0]}@`));
      })
      .join('\n');
  };

  /** `docker rmi <tag|id>` without `--force`, refusing the way the daemon does. */
  const removeImage = target => {
    const id = simulator.resolveImage(target);
    if (!id) fail(`Error response from daemon: No such image: ${target}`);
    const inUse = [...simulator.containers.entries()].find(([, container]) => container.imageDigest === id);
    const isTag = simulator.images.has(target);
    const lastReference = !isTag || simulator.tagsOf(id).length === 1;
    if (lastReference && inUse) fail(`Error response from daemon: conflict: unable to remove repository reference "${target}" (must force) - container ${inUse[0]} is using its referenced image ${id}`);
    if (!isTag && simulator.tagsOf(id).length > 0) fail(`Error response from daemon: conflict: unable to delete ${id} (must be forced) - image is referenced in multiple repositories`);
    if (isTag) simulator.images.delete(target);
    if (simulator.tagsOf(id).length === 0) {
      simulator.digests.delete(id);
      simulator.repoDigests.delete(id);
      return `Untagged: ${target}\nDeleted: ${id}`;
    }
    return `Untagged: ${target}`;
  };

  const run = async (command, args) => {
    if (command !== 'docker') fail(`the Formal AI lifecycle must only shell out to docker, got '${command}'`);
    simulator.calls.push(args.join(' '));

    if (args[0] === 'inspect') return { stdout: inspectContainer(args) };
    if (args[0] === 'image' && args[1] === 'inspect') {
      const reference = args.slice(2).find((arg, index, rest) => !arg.startsWith('-') && rest[index - 1] !== '--format');
      const digest = simulator.resolveImage(reference);
      if (!digest) fail(`Error: No such image: ${reference}`);
      const format = flagValue(args, '--format') ?? '';
      if (format.includes('RepoTags')) return { stdout: `${digest}|${JSON.stringify(simulator.tagsOf(digest))}|${JSON.stringify([...(simulator.repoDigests.get(digest) ?? [])])}|${simulator.sizeOf(digest)}` };
      return { stdout: digest };
    }
    if (args[0] === 'image' && args[1] === 'ls') return { stdout: listImages(args) };
    if (args[0] === 'rmi') return { stdout: removeImage(args[args.length - 1]) };
    if (args[0] === 'system' && args[1] === 'df') return { stdout: `Images|${[...simulator.digests].reduce((sum, id) => sum + simulator.sizeOf(id), 0)}B\nContainers|0B` };
    if (args[0] === 'ps') {
      const label = flagValue(args, '--filter')?.replace(/^label=/, '');
      return {
        stdout: [...simulator.containers.entries()]
          .filter(([, container]) => (args.includes('--all') || container.running) && (!label || container.labels?.includes(label)))
          .map(([name]) => name)
          .join('\n'),
      };
    }
    if (args[0] === 'buildx' && args[1] === 'imagetools') {
      if (!registry) fail(`docker: 'buildx' is not a docker command.`);
      const id = registry[args[3]];
      if (!id) fail(`ERROR: ${args[3]}: not found`);
      return { stdout: JSON.stringify({ mediaType: 'application/vnd.oci.image.index.v1+json', digest: manifestDigestOf(id), size: 1234 }) };
    }
    if (args[0] === 'pull') {
      if (pullError) fail(pullError);
      const image = args[args.length - 1];
      const at = image.indexOf('@');
      if (at >= 0) {
        // A pull by registry digest installs that exact build and no tag.
        const id = Object.values(registry ?? {}).find(candidate => manifestDigestOf(candidate) === image.slice(at + 1));
        if (!id) fail(`Error response from daemon: manifest for ${image} not found`);
        simulator.digests.add(id);
        simulator.repoDigests.set(id, new Set([...(simulator.repoDigests.get(id) ?? []), image]));
        return { stdout: image };
      }
      const target = pull[image] ?? registry?.[image];
      if (registry && !target) fail(`Error response from daemon: manifest for ${image} not found: manifest unknown`);
      if (target) {
        simulator.retag(image, target);
        simulator.repoDigests.set(target, new Set([...(simulator.repoDigests.get(target) ?? []), `${repositoryOf(image)}@${manifestDigestOf(target)}`]));
      }
      return { stdout: simulator.images.get(image) ?? '' };
    }
    if (args[0] === 'network') return { stdout: handleNetwork(args) };
    if (args[0] === 'volume') return { stdout: handleVolume(args) };
    if (args[0] === 'run') return { stdout: handleRun(args) };
    if (args[0] === 'exec') {
      const container = simulator.containers.get(args[1]);
      if (!container?.running) fail(`Error response from daemon: container ${args[1]} is not running`);
      const payload = typeof simulator.health === 'function' ? simulator.health(referenceOf(container.image), container.imageDigest) : simulator.health;
      if (!payload) fail('curl: (7) Failed to connect');
      return { stdout: JSON.stringify(payload) };
    }
    if (args[0] === 'stop') {
      const container = simulator.containers.get(args[1]);
      if (!container) fail(`Error response from daemon: No such container: ${args[1]}`);
      container.running = false;
      return { stdout: args[1] };
    }
    if (args[0] === 'rm') {
      const name = args[args.length - 1];
      const container = simulator.containers.get(name);
      if (!container) fail(`Error response from daemon: No such container: ${name}`);
      for (const network of container.networks.keys()) simulator.networks.get(network)?.containers.delete(name);
      if (args.includes('--volumes')) for (const volume of container.anonymousVolumes ?? []) simulator.volumes.delete(volume);
      simulator.containers.delete(name);
      return { stdout: name };
    }
    return fail(`unsupported: docker ${args.join(' ')}`);
  };

  simulator.run = run;
  return simulator;
};

export default { createDockerSimulator };
