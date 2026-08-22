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
 * @see https://github.com/link-assistant/hive-mind/issues/2146
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
const VALUE_FLAGS = new Set(['--name', '--label', '-l', '--network', '--network-alias', '--restart', '--env', '-e', '--volume', '-v', '--entrypoint', '--user', '-u', '--workdir', '-w', '--publish', '-p']);

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
 * @param {object|Function} [options.health] - `/health` payload, or a function of the running image.
 * @param {object} [options.memory] - `formal-ai memory <subcommand>` → JSON payload.
 * @param {string} [options.memorySha256] - What `sha256sum` reports for a file in the volume.
 * @returns {object} `{ run, calls, containers, networks, volumes, images, createContainer, ... }`
 */
export const createDockerSimulator = ({ images = {}, pull = {}, health = DEFAULT_HEALTH, memory = {}, memorySha256 = null, pullError = null } = {}) => {
  const simulator = {
    calls: [],
    containers: new Map(),
    networks: new Map(),
    volumes: new Set(),
    images: new Map(Object.entries(images)),
    memory,
    memorySha256,
    health,
    nextOctet: 2,
  };

  /** Pretend a task container was created by start-command. */
  simulator.createContainer = (name, { image = 'ghcr.io/link-assistant/isolation:latest', running = true } = {}) => {
    simulator.containers.set(name, { image, imageDigest: simulator.images.get(image) ?? 'sha256:task', running, networks: new Map() });
    return simulator.containers.get(name);
  };

  simulator.ran = pattern => simulator.calls.some(call => (typeof pattern === 'string' ? call.includes(pattern) : pattern.test(call)));

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
    if (!simulator.images.has(image)) fail(`Unable to find image '${image}' locally`);
    simulator.containers.set(name, { image, imageDigest: simulator.images.get(image), running: true, networks: new Map() });
    const network = flagValue(args, '--network');
    if (network) attach(network, name);
    return `${name}-id`;
  };

  const run = async (command, args) => {
    if (command !== 'docker') fail(`the Formal AI lifecycle must only shell out to docker, got '${command}'`);
    simulator.calls.push(args.join(' '));

    if (args[0] === 'inspect') return { stdout: inspectContainer(args) };
    if (args[0] === 'image' && args[1] === 'inspect') {
      const digest = simulator.images.get(args[2]);
      if (!digest) fail(`Error: No such image: ${args[2]}`);
      return { stdout: digest };
    }
    if (args[0] === 'pull') {
      if (pullError) fail(pullError);
      const image = args[args.length - 1];
      if (pull[image]) simulator.images.set(image, pull[image]);
      return { stdout: simulator.images.get(image) ?? '' };
    }
    if (args[0] === 'network') return { stdout: handleNetwork(args) };
    if (args[0] === 'volume') return { stdout: handleVolume(args) };
    if (args[0] === 'run') return { stdout: handleRun(args) };
    if (args[0] === 'exec') {
      const container = simulator.containers.get(args[1]);
      if (!container?.running) fail(`Error response from daemon: container ${args[1]} is not running`);
      const payload = typeof simulator.health === 'function' ? simulator.health(container.image) : simulator.health;
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
      simulator.containers.delete(name);
      return { stdout: name };
    }
    return fail(`unsupported: docker ${args.join(' ')}`);
  };

  simulator.run = run;
  return simulator;
};

export default { createDockerSimulator };
