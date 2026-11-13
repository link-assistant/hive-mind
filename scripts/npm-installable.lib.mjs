/**
 * Has a published version become installable yet? (issue #4055, F9)
 *
 * npm processes a large tarball asynchronously: `npm publish` of a 120 MB
 * native Codex variant answers "Your package is being processed and may take
 * a few minutes to become available", and the version stays unresolvable until
 * then. For 2.40.2 the linux-arm64 variant was uploaded at 22:09:06 and became
 * resolvable at 22:24:48, ten minutes after the main package. Docker Publish
 * (linux/arm64) waited for the main package only, installed it at 22:24:07, and
 * Bun dropped the still-unresolvable optional dependency without an error, so
 * install-native-codex.mjs refused and no 2.40.2 image was published.
 *
 * A version counts as installable when `npm view <spec> dist.tarball` names a
 * tarball and that tarball answers a HEAD request (issue #2404: the metadata can
 * be visible while the tarball still returns 404).
 */

/**
 * @param {string} spec `<name>@<version>`
 * @param {{runner: Function, fetcher?: Function, quiet?: boolean}} options
 * @returns {Promise<{installable: boolean, detail: string}>}
 */
export async function checkInstallable(spec, { runner, fetcher = globalThis.fetch, quiet = true }) {
  const view = await runner('npm', ['view', spec, 'dist.tarball'], { quiet });
  const tarball = String(view.stdout || '').trim();
  if (view.code !== 0 || !tarball) return { installable: false, detail: 'version metadata not visible' };
  try {
    const response = await fetcher(tarball, { method: 'HEAD' });
    return { installable: response.ok, detail: `tarball ${tarball} → HTTP ${response.status}` };
  } catch (error) {
    return { installable: false, detail: `tarball ${tarball} → ${error.message}` };
  }
}

/**
 * Polls until every spec is installable, with exponential backoff.
 *
 * @param {string[]} specs
 * @param {object} options
 * @param {Function} options.runner `(command, args, {quiet}) => Promise<{code, stdout}>`
 * @param {Function} [options.fetcher]
 * @param {(ms: number) => Promise<void>} options.sleeper
 * @param {number} [options.attempts]
 * @param {number} [options.delayMs]
 * @param {number} [options.maxDelayMs]
 * @param {boolean} [options.quiet] false shows the raw `npm view` output
 * @param {Console} [options.logger]
 * @returns {Promise<string[]>} the specs that never became installable (empty on success)
 */
export async function waitUntilInstallable(specs, { runner, fetcher = globalThis.fetch, sleeper, attempts = 30, delayMs = 10000, maxDelayMs = 30000, quiet = true, logger = console }) {
  let pending = [...specs];
  let delay = delayMs;
  let waitedMs = 0;
  for (let attempt = 1; pending.length; attempt++) {
    const still = [];
    for (const spec of pending) {
      const { installable, detail } = await checkInstallable(spec, { runner, fetcher, quiet });
      if (installable) logger.log(`${spec} is installable (${detail}; check ${attempt} of ${attempts}, after ~${waitedMs / 1000}s).`);
      else {
        still.push(spec);
        logger.log(`${spec} is not installable yet: ${detail} (check ${attempt} of ${attempts}, ~${waitedMs / 1000}s waited).`);
      }
    }
    pending = still;
    if (!pending.length || attempt >= attempts) break;
    await sleeper(delay);
    waitedMs += delay;
    delay = Math.min(delay * 2, maxDelayMs);
  }
  return pending;
}

/**
 * The variant versions a published package pins through `npm:<name>@<version>`
 * optional dependency aliases of its own name (the native Codex variants).
 *
 * @param {string} name
 * @param {Record<string, string>|null|undefined} optionalDependencies
 * @returns {string[]}
 */
export function pinnedVariantSpecs(name, optionalDependencies) {
  const prefix = `npm:${name}@`;
  return Object.values(optionalDependencies || {})
    .filter(range => typeof range === 'string' && range.startsWith(prefix) && /^[0-9A-Za-z.+-]+$/u.test(range.slice(prefix.length)))
    .map(range => range.slice('npm:'.length))
    .sort();
}
