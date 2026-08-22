export const DEFAULT_NPM_REGISTRY_URL = 'https://registry.npmjs.org';

function getNpmRegistryFromEnv() {
  try {
    return process.env.NPM_CONFIG_REGISTRY || '';
  } catch {
    return '';
  }
}

/**
 * Normalize an npm registry URL so package metadata paths can be appended.
 * @param {string} registryUrl
 * @returns {string}
 */
export function normalizeRegistryUrl(
  registryUrl = getNpmRegistryFromEnv() || DEFAULT_NPM_REGISTRY_URL
) {
  return String(registryUrl || DEFAULT_NPM_REGISTRY_URL).replace(/\/+$/, '');
}

/**
 * Encode a package name for npm registry metadata URLs.
 * @param {string} packageName
 * @returns {string}
 */
export function encodePackageName(packageName) {
  if (typeof packageName !== 'string' || packageName.trim() === '') {
    throw new Error('Package name is required');
  }

  if (packageName.startsWith('@')) {
    const [scope, name] = packageName.split('/');
    if (!scope || !name) {
      throw new Error(`Invalid scoped package name: ${packageName}`);
    }
    return `${scope}%2F${encodeURIComponent(name)}`;
  }

  return encodeURIComponent(packageName);
}

/**
 * Build the npm registry package metadata URL.
 * @param {string} packageName
 * @param {string} registryUrl
 * @returns {string}
 */
export function buildPackageMetadataUrl(
  packageName,
  registryUrl = getNpmRegistryFromEnv() || DEFAULT_NPM_REGISTRY_URL
) {
  return `${normalizeRegistryUrl(registryUrl)}/${encodePackageName(packageName)}`;
}

/**
 * Check whether a package version exists in npm registry metadata.
 * HTTP 404 means the package has not been published yet and is not an error.
 * @param {string} packageName
 * @param {string} version
 * @param {object} options
 * @param {Function} [options.fetchFn]
 * @param {string} [options.registryUrl]
 * @returns {Promise<boolean>}
 */
export async function isPackageVersionPublished(
  packageName,
  version,
  {
    fetchFn = fetch,
    registryUrl = getNpmRegistryFromEnv() || DEFAULT_NPM_REGISTRY_URL,
  } = {}
) {
  if (typeof version !== 'string' || version.trim() === '') {
    throw new Error('Package version is required');
  }

  const metadataUrl = buildPackageMetadataUrl(packageName, registryUrl);
  const response = await fetchFn(metadataUrl, {
    headers: {
      accept: 'application/json',
    },
  });

  if (response.status === 404) {
    return false;
  }

  if (!response.ok) {
    throw new Error(
      `Failed to fetch npm package metadata for ${packageName}: ${response.status} ${response.statusText}`
    );
  }

  const metadata = await response.json();
  return Object.hasOwn(metadata?.versions || {}, version);
}
