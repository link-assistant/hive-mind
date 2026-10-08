/** Read-only public registry verification; unknown publishers fail explicitly. */
async function defaultFetchJson(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'hive-mind-ci-cd-verifier' }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Registry returned HTTP ${response.status} for ${url}`);
  return response.json();
}

function tomlSection(text, section) {
  return text.match(new RegExp(`^\\[${section.replaceAll('.', '\\.')}\\]\\s*\\n([\\s\\S]*?)(?=^\\[|$(?![\\s\\S]))`, 'm'))?.[1] || '';
}

function tomlValue(text, key) {
  return text.match(new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']`, 'm'))?.[1];
}

export function detectRegistryPackages(kinds, files) {
  const packages = [];
  for (const [path, text] of files) {
    if (kinds.includes('npm') && /(^|\/)package\.json$/.test(path)) {
      const pkg = JSON.parse(text);
      if (pkg.private) continue;
      packages.push({ kind: 'npm', name: pkg.name, version: pkg.version, path, registry: pkg.publishConfig?.registry || 'https://registry.npmjs.org' });
    }
    for (const [kind, filename, section] of [
      ['pypi', 'pyproject.toml', 'project'],
      ['crates', 'Cargo.toml', 'package'],
    ]) {
      if (!kinds.includes(kind) || !path.endsWith(filename)) continue;
      const contents = tomlSection(text, section) || (kind === 'pypi' ? tomlSection(text, 'tool.poetry') : '');
      if (kind === 'crates' && /^\s*publish\s*=\s*(false|\[\s*\])/m.test(contents)) continue;
      if (contents) packages.push({ kind, name: tomlValue(contents, 'name'), version: tomlValue(contents, 'version'), path });
    }
  }
  return packages;
}

export async function verifyPackagePublications({ kinds, files, since, fetchJson = defaultFetchJson }) {
  const outputs = [];
  let packages;
  try {
    packages = detectRegistryPackages(kinds, files);
  } catch (error) {
    return [{ kind: 'package', verified: false, detail: `Cannot read package metadata: ${error.message}` }];
  }
  for (const kind of kinds.filter(value => ['npm', 'pypi', 'crates', 'other-package'].includes(value))) {
    if (!packages.some(pkg => pkg.kind === kind)) outputs.push({ kind, verified: false, detail: `${kind}: cannot determine package name and version; inspect the publishing configuration.` });
  }
  for (const pkg of packages) {
    const { kind, name, version } = pkg;
    let verified = false;
    let detail = `${kind}: ${name || pkg.path}@${version || 'unknown'} was not published after the merge.`;
    try {
      if (!name || !version) throw new Error(`Cannot determine a static package name/version in ${pkg.path}.`);
      const encodedName = encodeURIComponent(name);
      let publishedAt;
      if (kind === 'npm') {
        // Credentials/private registries require their own verification; never
        // send the GitHub token to a registry or silently assume success.
        if (pkg.registry.replace(/\/$/, '') !== 'https://registry.npmjs.org') throw new Error(`Unsupported registry ${pkg.registry}; publication requires verification.`);
        const metadata = await fetchJson(`https://registry.npmjs.org/${encodedName}`);
        publishedAt = metadata.versions?.[version] && metadata.time?.[version];
      } else if (kind === 'pypi') {
        const metadata = await fetchJson(`https://pypi.org/pypi/${encodedName}/${encodeURIComponent(version)}/json`);
        publishedAt = metadata.info?.version === version && !metadata.info?.yanked && metadata.urls?.find(file => !file.yanked && Date.parse(file.upload_time_iso_8601) >= Date.parse(since))?.upload_time_iso_8601;
      } else if (kind === 'crates') {
        const metadata = await fetchJson(`https://crates.io/api/v1/crates/${encodedName}/${encodeURIComponent(version)}`);
        publishedAt = metadata.version?.num === version && !metadata.version?.yanked && metadata.version?.created_at;
      }
      verified = Boolean(publishedAt) && Date.parse(publishedAt) >= Date.parse(since);
      if (verified) detail = `${kind}: ${name}@${version}, published ${publishedAt}.`;
    } catch (error) {
      detail = `${detail} ${error.message}`;
    }
    outputs.push({ kind, verified, detail });
  }
  return outputs;
}
