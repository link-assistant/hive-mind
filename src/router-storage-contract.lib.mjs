/** Router sidecar storage admission. Backend audit completeness is checked separately. */
import { dockerText } from './docker-sidecar.lib.mjs';
import { ROUTER_DATA_MOUNT, ROUTER_DATA_VOLUME_NAME, ROUTER_SIDECAR_CONTAINER_NAME } from './router-isolation.lib.mjs';

const argumentError = () => new Error('Router extra resource arguments are invalid; only documented resource limits are supported.');
const SIZE = /^[1-9]\d{0,14}[bkmg]?$/iu;
const INTEGER = /^[1-9]\d{0,8}$/u;
const resources = new Map([
  ['--memory', SIZE],
  ['--memory-reservation', SIZE],
  ['--memory-swap', SIZE],
  ['--shm-size', SIZE],
  ['--pids-limit', INTEGER],
  ['--cpu-shares', INTEGER],
  ['--cpu-period', INTEGER],
  ['--cpu-quota', INTEGER],
  ['--cpus', /^(?:[1-9]\d{0,3}(?:\.\d{1,6})?|0\.\d{1,6})$/u],
  ['--cpuset-cpus', /^\d{1,5}(?:-\d{1,5})?(?:,\d{1,5}(?:-\d{1,5})?)*$/u],
]);

/** Keep resource tuning while preventing later Docker options from replacing authority. */
export function routerSidecarExtraArgs(env = {}) {
  const raw = String(env.HIVE_MIND_ROUTER_EXTRA_ARGS || '').trim();
  if (!raw) return [];
  const args = raw.split(/\s+/u);
  if (raw.length > 4096 || args.length > 64) throw argumentError();
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const [name, ...inline] = args[index].split('=');
    const pattern = resources.get(name);
    const value = inline.length ? inline[0] : args[++index];
    if (!pattern || seen.has(name) || inline.length > 1 || !pattern.test(value ?? '') || (name === '--cpus' && Number(value) <= 0)) throw argumentError();
    seen.add(name);
  }
  return args;
}

// Return only the configuration needed for this check. In particular, never
// print inspection results: the environment also contains the signing secret.
export const ROUTER_STORAGE_INSPECT_FORMAT = '{"env":{{json .Config.Env}},"mounts":{{json .Mounts}}}';

/** Check the actual new or reused sidecar before minting any task token. */
export async function verifyRouterSidecarStorage({ run, timeoutMs, containerName = ROUTER_SIDECAR_CONTAINER_NAME } = {}) {
  const refused = { valid: false, error: 'Router durable data/audit storage could not be verified; no task token was issued. Inspect the sidecar environment and its persistent volume.' };
  try {
    const raw = await dockerText(run, ['inspect', containerName, '--format', ROUTER_STORAGE_INSPECT_FORMAT], { timeoutMs });
    if (raw.length > 256 * 1024) return refused;
    const inspected = JSON.parse(raw);
    if (!Array.isArray(inspected.env) || inspected.env.length > 256 || !inspected.env.every(value => typeof value === 'string')) return refused;
    for (const [key, value] of [
      ['DATA_DIR', ROUTER_DATA_MOUNT],
      ['AUDIT_LOG', `${ROUTER_DATA_MOUNT}/audit.jsonl`],
    ]) {
      const declarations = inspected.env.filter(entry => entry.startsWith(`${key}=`));
      if (declarations.length !== 1 || declarations[0] !== `${key}=${value}`) return refused;
    }
    if (!Array.isArray(inspected.mounts) || inspected.mounts.length > 256) return refused;
    let canonical = 0;
    for (const mount of inspected.mounts) {
      const destination = mount?.Destination;
      if (typeof destination !== 'string' || !destination.startsWith('/') || (destination !== '/' && destination.endsWith('/')) || destination.includes('//') || destination.split('/').some(part => part === '.' || part === '..') || /[\0\r\n]/u.test(destination)) return refused;
      const overlaps = destination === '/' || destination === ROUTER_DATA_MOUNT || destination.startsWith(`${ROUTER_DATA_MOUNT}/`) || ROUTER_DATA_MOUNT.startsWith(`${destination}/`);
      if (!overlaps) continue;
      if (destination !== ROUTER_DATA_MOUNT || mount.Type !== 'volume' || mount.Name !== ROUTER_DATA_VOLUME_NAME || mount.RW !== true) return refused;
      canonical++;
    }
    return canonical === 1 ? { valid: true, error: null } : refused;
  } catch {
    // Native Docker errors may include environment values or input excerpts.
    return refused;
  }
}
