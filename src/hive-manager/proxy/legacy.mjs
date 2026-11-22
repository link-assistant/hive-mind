import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual, parseArgs, promisify } from 'node:util';
import { readBoundedFile } from '../lib/files.mjs';

const service = 'mtproxy-mss.service';
const unitPath = `/etc/systemd/system/${service}`;
const scriptPath = '/usr/local/sbin/mtproxy-mss.sh';
const unitText = `[Unit]
Description=Clamp TCP MSS for MTProto proxy traffic (Docker bridge PMTU)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=${scriptPath}
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
`;

function legacyMssScript(ports, mss) {
  return `#!/bin/sh
set -eu

add_rule() {
  iptables -t mangle -C "$@" 2>/dev/null || iptables -t mangle -A "$@"
}

for port in ${ports}; do
  add_rule FORWARD -p tcp --sport "$port" --tcp-flags SYN,RST SYN -j TCPMSS --set-mss ${mss}
  add_rule FORWARD -p tcp --dport "$port" --tcp-flags SYN,RST SYN -j TCPMSS --set-mss ${mss}
done
`;
}

const exec = promisify(execFile);
const localHost = {
  async run(program, args) {
    try {
      const { stdout } = await exec(program, args, { maxBuffer: 2 * 1024 * 1024 });
      return stdout.trim();
    } catch (error) {
      if (program === 'systemctl' && args[0] === 'show' && error.code === 1 && /^LoadState=not-found$/m.test(error.stdout ?? '')) {
        return error.stdout.trim();
      }
      throw new Error(`${program} ${args[0]} failed: ${error.stderr?.trim() || error.code}`, { cause: error });
    }
  },
  async read(path) {
    let stat;
    try {
      stat = await lstat(path);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
    if (!stat.isFile() || stat.uid !== 0 || stat.mode & 0o022) throw new Error(`Unsafe legacy MSS file: ${path}`);
    return (await readBoundedFile(path, 4096, 'legacy MSS file', { noFollow: true })).toString('utf8');
  },
  remove: unlink,
  async locked(action) {
    const root = join(process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || '/tmp', `hive-manager-${process.getuid()}`);
    await mkdir(root, { recursive: true, mode: 0o700 });
    const directory = await lstat(root);
    if (!directory.isDirectory() || directory.uid !== process.getuid() || directory.mode & 0o022) throw new Error('Unsafe manager lock directory.');
    const lock = await open(join(root, 'mtproxy'), constants.O_CREAT | constants.O_NOFOLLOW | constants.O_RDONLY, 0o600);
    try {
      // The child takes the lock on this open file description. It stays held
      // until the parent closes its copy of the descriptor.
      await new Promise((resolveLock, reject) => {
        const child = spawn('flock', ['-n', '3'], { stdio: ['ignore', 'ignore', 'ignore', lock.fd] });
        const fail = () => reject(new Error('Could not lock proxy changes. Check flock and concurrent manager operations.'));
        child.once('error', fail);
        child.once('exit', code => (code === 0 ? resolveLock() : fail()));
      });
      return await action();
    } finally {
      await lock.close();
    }
  },
};

function lines(value) {
  return value ? value.split('\n') : [];
}

function legacyName(name) {
  return /^mtproxy(?:-classic(?:-\d+)?(?:-old)?)?$/.test(name);
}

async function listContainers(host) {
  const format = '{{json .ID}}\t{{json .Names}}\t{{json .State}}\t{{json .Image}}\t{{json (.Label "io.github.link-assistant.hive-manager.proxy")}}';
  const output = await host.run('docker', ['container', 'ls', '--all', '--no-trunc', '--format', format]);
  return lines(output)
    .map(line => {
      const [id, name, state, image, owner, ...rest] = line.split('\t').map(field => JSON.parse(field));
      if (rest.length || !/^[a-f0-9]{64}$/.test(id) || ![name, state, image, owner].every(value => typeof value === 'string')) {
        throw new Error('Unexpected Docker container inventory.');
      }
      return { id: `sha256:${id}`, name, state, image, owner };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

async function observeMss(host) {
  const endpoint = process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT ? process.env.DOCKER_HOST : await host.run('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']);
  if (!endpoint.startsWith('unix://')) throw new Error('Inspect legacy MSS on the Docker host.');
  const properties = ['LoadState', 'UnitFileState', 'ActiveState', 'FragmentPath', 'DropInPaths', 'NeedDaemonReload'];
  const output = await host.run('systemctl', ['show', '--all', `--property=${properties.join(',')}`, service]);
  const systemd = Object.fromEntries(lines(output).map(entry => [entry.slice(0, entry.indexOf('=')), entry.slice(entry.indexOf('=') + 1)]));
  if (!properties.every(key => typeof systemd[key] === 'string') || !['loaded', 'not-found'].includes(systemd.LoadState)) {
    throw new Error('Could not observe the legacy MSS service state.');
  }
  const [unit, script] = await Promise.all([host.read(unitPath), host.read(scriptPath)]);
  if ((unit !== null && unit !== unitText) || systemd.NeedDaemonReload === 'yes' || systemd.DropInPaths || (systemd.FragmentPath && systemd.FragmentPath !== unitPath)) {
    throw new Error('The installed MSS unit differs from the legacy MTProxy unit.');
  }
  let ownedRules = [];
  if (script !== null) {
    const ports = /^for port in ([0-9 ]+); do$/m.exec(script)?.[1];
    const mss = / --set-mss (\d+)$/m.exec(script)?.[1];
    if (!ports || !mss || !ports.split(' ').every(port => /^[1-9]\d{0,4}$/.test(port) && Number(port) <= 65535) || Number(mss) < 536 || Number(mss) > 1460 || script !== legacyMssScript(ports, mss)) {
      throw new Error('The installed MSS script differs from the legacy MTProxy script.');
    }
    ownedRules = [...new Set(ports.split(' '))].flatMap(port => ['sport', 'dport'].map(direction => `-A FORWARD -p tcp -m tcp --${direction} ${port} --tcp-flags SYN,RST SYN -j TCPMSS --set-mss ${mss}`));
  }
  const rules = lines(await host.run('iptables', ['-w', '5', '-t', 'mangle', '-S', 'FORWARD']));
  const digest = content => (content === null ? null : `sha256:${createHash('sha256').update(content).digest('hex')}`);
  return {
    service: { ...systemd, unitSha256: digest(unit), scriptSha256: digest(script), rules: rules.filter(rule => ownedRules.includes(rule)) },
    rules,
    ownedRules,
  };
}

/**
 * Read the recognized legacy names and, optionally, the installed MSS hook.
 * The host adapter supplies run(program, args) and read(path).
 */
export async function inventoryLegacyProxy({ legacyMss = false } = {}, host = localHost) {
  const containers = (await listContainers(host)).filter(item => !item.owner && legacyName(item.name));
  return { containers, mss: legacyMss ? (await observeMss(host)).service : null };
}

async function observeCleanup(options, host) {
  const { action, names = [], legacyMss = false } = options;
  if (!['stop', 'remove'].includes(action)) throw new Error('Choose stop or remove for legacy proxy cleanup.');
  if ((!names.length && !legacyMss) || new Set(names).size !== names.length || names.some(name => !legacyName(name))) {
    throw new Error('Select distinct recognized legacy names and/or include the legacy MSS hook.');
  }
  const containers = await listContainers(host);
  const selected = containers.filter(item => names.includes(item.name) && !item.owner);
  if (selected.length !== names.length) throw new Error('A selected legacy container is missing or managed.');
  if (containers.some(item => names.includes(item.name.replace(/\.previous$/, '')) && item.name.endsWith('.previous'))) {
    throw new Error('Resolve the outstanding proxy rollout before cleaning up this legacy proxy.');
  }
  const mss = legacyMss ? await observeMss(host) : null;
  return {
    plan: { version: 1, action, containers: selected, mss: mss?.service ?? null },
    containers,
    mss,
  };
}

/** Preview the exact legacy identities, rule instances and service state that will be changed. */
export async function planLegacyProxyCleanup(options, host = localHost) {
  return (await observeCleanup(options, host)).plan;
}

async function applyMss(action, mss, host) {
  const { service: state } = mss;
  if (state.LoadState === 'loaded') {
    if (state.ActiveState !== 'inactive') await host.run('systemctl', ['stop', service]);
    if (state.UnitFileState !== 'disabled') await host.run('systemctl', ['disable', service]);
  }
  for (const rule of state.rules) {
    await host.run('iptables', ['-w', '5', '-t', 'mangle', '-D', ...rule.split(' ').slice(1)]);
  }
  if (action === 'remove') {
    if (state.scriptSha256) await host.remove(scriptPath);
    if (state.unitSha256) await host.remove(unitPath);
    if (state.unitSha256) await host.run('systemctl', ['daemon-reload']);
  }
}

function verifyMss(action, before, after) {
  const selectedRules = new Set(before.ownedRules);
  const sameUnrelated = isDeepStrictEqual(
    after.rules.filter(rule => !selectedRules.has(rule)),
    before.rules.filter(rule => !selectedRules.has(rule))
  );
  const { service: state } = after;
  const inactive = state.ActiveState === 'inactive' && ['disabled', ''].includes(state.UnitFileState);
  const files = action === 'remove' ? state.LoadState === 'not-found' && !state.unitSha256 && !state.scriptSha256 : state.unitSha256 === before.service.unitSha256 && state.scriptSha256 === before.service.scriptSha256;
  if (!sameUnrelated || after.rules.some(rule => selectedRules.has(rule)) || !inactive || !files) {
    throw new Error('Legacy MSS cleanup verification failed.');
  }
}

/**
 * Apply an explicitly reviewed plan under the host adapter's shared lock.
 * The adapter additionally supplies locked(callback) and remove(path).
 */
export async function applyLegacyProxyCleanup(reviewed, host = localHost) {
  if (reviewed?.version !== 1 || !Array.isArray(reviewed.containers)) throw new Error('Invalid legacy proxy cleanup plan.');
  const { action } = reviewed;
  return host.locked(async () => {
    const { plan, containers, mss } = await observeCleanup({ action, names: reviewed.containers.map(item => item?.name), legacyMss: reviewed.mss !== null }, host);
    if (!isDeepStrictEqual(plan, reviewed)) throw new Error('Legacy proxy observations changed. Generate and review a fresh cleanup plan.');
    const images = await host.run('docker', ['image', 'ls', '--all', '--quiet', '--no-trunc']);
    if (mss) await applyMss(action, mss, host);
    for (const container of plan.containers) {
      const id = container.id.slice('sha256:'.length);
      if (action === 'remove') await host.run('docker', ['container', 'rm', '--force', id]);
      else if (['running', 'paused', 'restarting'].includes(container.state)) {
        if (container.state === 'paused') await host.run('docker', ['container', 'unpause', id]);
        await host.run('docker', ['container', 'stop', id]);
      }
    }
    const after = await listContainers(host);
    const selected = new Set(plan.containers.map(item => item.name));
    const unrelated = items => items.filter(item => !selected.has(item.name));
    const expected = plan.containers.filter(() => action === 'stop').map(item => (['running', 'paused', 'restarting'].includes(item.state) ? { ...item, state: 'exited' } : item));
    if (
      !isDeepStrictEqual(unrelated(containers), unrelated(after)) ||
      !isDeepStrictEqual(
        after.filter(item => selected.has(item.name)),
        expected
      )
    ) {
      throw new Error('Docker cleanup verification failed. Inspect the selected and unrelated containers.');
    }
    if (!isDeepStrictEqual(lines(images).sort(), lines(await host.run('docker', ['image', 'ls', '--all', '--quiet', '--no-trunc'])).sort())) {
      throw new Error('Docker image inventory changed during legacy proxy cleanup.');
    }
    if (mss) verifyMss(action, mss, await observeMss(host));
    return { action, containers: plan.containers, mss: Boolean(mss), verified: true };
  });
}

async function readPlan(path) {
  const limit = 64 * 1024;
  if (path !== '-') return JSON.parse((await readBoundedFile(path, limit, 'legacy proxy cleanup plan')).toString('utf8'));
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > limit) throw new Error('Legacy proxy cleanup plan exceeds 64 KiB.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { select: { type: 'string', multiple: true }, 'legacy-mss': { type: 'boolean' }, adopt: { type: 'boolean' } },
  });
  const [command, input] = positionals;
  const { select: names, 'legacy-mss': legacyMss, adopt } = values;
  let result;
  if (command === 'inventory' && positionals.length === 1 && !names && !adopt) result = await inventoryLegacyProxy({ legacyMss });
  else if (command === 'cleanup-plan' && positionals.length === 2 && !adopt) result = await planLegacyProxyCleanup({ action: input, names, legacyMss });
  else if (command === 'cleanup' && positionals.length === 2 && adopt && !names && !legacyMss) result = await applyLegacyProxyCleanup(await readPlan(input));
  else throw new Error('Run hive-manager deploy proxy --help for legacy inventory and cleanup.');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`hive-manager: ${error.message}\n`);
    process.exitCode = 1;
  }
}
