/**
 * Ask a container registry two questions over plain HTTP: what an *anonymous*
 * consumer can see, and whether a credential can actually write.
 *
 * Why this exists (issue #2221):
 *   `release.yml` first touches `DOCKERHUB_TOKEN` in a `docker/login-action`
 *   step that runs *after* npm has already published. An expired token is
 *   therefore discovered at the end of a run whose whole purpose was to
 *   produce a release — which is how link-foundation/box shipped 2.5.0 and
 *   2.6.0 with no images at all (link-foundation/box#117, run 33972074755).
 *
 * The obvious cheap probe does not work. Measured against both registries on
 * 2026-09-06 (transcript linked from issue #2221):
 *
 *   - ghcr.io answers HTTP 200 to a `pull,push` token request made with *any*
 *     credential, for any scope — the "token" it returns is the credential
 *     base64-encoded, so nothing was verified. The push then fails 403
 *     `permission_denied`.
 *   - docker.io answers HTTP 200 to an *anonymous* `pull,push` token request,
 *     quietly narrowing the `access` claim to `pull` (reproduced by
 *     experiments/issue-2221-registry-probe-live.mjs). Only a wrong credential
 *     is a 401 there.
 *
 * So only an attempted write proves write access. `probeRegistryWrite` opens a
 * blob upload session and immediately cancels it:
 *
 *   POST /v2/<repo>/blobs/uploads/  -> 202 Accepted + Location
 *   DELETE <Location>               -> session cancelled, nothing stored
 *
 * Nothing is published by that: an upload session with no bytes and no commit
 * creates no blob, no manifest, no tag and no package version.
 *
 * `probeAnonymousPull` deliberately sends *no* credentials. A check that
 * authenticates measures the publisher's view rather than the reader's, which
 * is how box's release notes came to claim "28 of 56 image references resolve"
 * for a release where the anonymous answer was 0 of 56.
 *
 * Both probes report `unknown` rather than guessing when the registry does not
 * answer (network error, 5xx, HTTP 429). A check that says "missing" when it
 * means "I could not look" trades one false claim for another.
 *
 * Uses only Node built-ins so it has no dependency on node_modules state — the
 * preflight job runs before `npm install`, which is the point of it.
 */

/** Per-request timeout, in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 20000;

/**
 * The media types a multi-arch release publishes. Without them a registry may
 * answer 404 for an index it would happily serve as an index, which would read
 * as "missing" — the exact false negative these probes exist to prevent.
 */
export const MANIFEST_ACCEPT = ['application/vnd.oci.image.index.v1+json', 'application/vnd.docker.distribution.manifest.list.v2+json', 'application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json'].join(', ');

/**
 * Token and API endpoints for the registries this repository publishes to.
 * Anything else returns null rather than a guess: a guessed endpoint that 404s
 * is indistinguishable from an image that is not there.
 * @param {string} registry
 * @returns {{token: string, api: string} | null}
 */
export function registryEndpoints(registry) {
  switch (registry) {
    case 'ghcr.io':
      return { token: 'https://ghcr.io/token?service=ghcr.io', api: 'https://ghcr.io' };
    case 'docker.io':
    case 'index.docker.io':
    case 'registry-1.docker.io':
      return { token: 'https://auth.docker.io/token?service=registry.docker.io', api: 'https://registry-1.docker.io' };
    default:
      return null;
  }
}

/**
 * Split an image reference into registry, repository and tag, applying the
 * same rules `docker pull` does: no registry means Docker Hub, and a
 * single-segment Docker Hub name lives in the `library/` namespace.
 * @param {string} reference
 * @returns {{registry: string, repository: string, tag: string}}
 */
export function parseImageReference(reference) {
  let rest = String(reference || '').trim();
  let tag = 'latest';

  const digestIndex = rest.indexOf('@');
  if (digestIndex !== -1) {
    tag = rest.slice(digestIndex + 1);
    rest = rest.slice(0, digestIndex);
  } else {
    const lastSegment = rest.slice(rest.lastIndexOf('/') + 1);
    const colonIndex = lastSegment.lastIndexOf(':');
    if (colonIndex !== -1) {
      tag = lastSegment.slice(colonIndex + 1);
      rest = rest.slice(0, rest.length - (lastSegment.length - colonIndex));
    }
  }

  let registry = 'docker.io';
  const slashIndex = rest.indexOf('/');
  if (slashIndex !== -1) {
    const head = rest.slice(0, slashIndex);
    if (head.includes('.') || head.includes(':') || head === 'localhost') {
      registry = head;
      rest = rest.slice(slashIndex + 1);
    }
  }

  const repository = registry === 'docker.io' && !rest.includes('/') ? `library/${rest}` : rest;
  return { registry, repository, tag };
}

/**
 * One HTTP request, normalised into a plain object. Never throws: a network
 * failure becomes status 0, which every caller maps to `unknown`.
 * @param {object} opts
 * @param {string} opts.url
 * @param {string} [opts.method]
 * @param {Record<string, string>} [opts.headers]
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{status: number, body: string, location: string, error: string}>}
 */
export async function request({ url, method = 'GET', headers = {}, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  try {
    const init = { method, headers };
    // AbortSignal.timeout is Node 18+; a fake fetch in a test simply ignores it.
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      init.signal = AbortSignal.timeout(timeoutMs);
    }
    const response = await fetchImpl(url, init);
    const body = typeof response.text === 'function' ? await response.text() : '';
    return {
      status: response.status,
      body: typeof body === 'string' ? body : '',
      location: response.headers?.get?.('location') || '',
      error: '',
    };
  } catch (error) {
    return { status: 0, body: '', location: '', error: error?.message || String(error) };
  }
}

/** Basic-auth header value for a credential pair. */
function basicAuth(username, secret) {
  return `Basic ${Buffer.from(`${username}:${secret}`).toString('base64')}`;
}

/** The `token` field of a registry token response, or ''. */
function readToken(body) {
  try {
    const parsed = JSON.parse(body);
    return parsed.token || parsed.access_token || '';
  } catch {
    return '';
  }
}

/** First 200 characters of a response body, on one line, for an annotation. */
function excerpt(body) {
  return String(body || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/**
 * Can the configured credential write to `registry/repository`?
 *
 * Opens a blob upload session and cancels it. Publishes nothing.
 *
 * @param {object} opts
 * @param {string} opts.registry
 * @param {string} opts.repository
 * @param {string} [opts.username]
 * @param {string} [opts.secret]
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{state: 'ok'|'missing-credentials'|'invalid-credentials'|'insufficient-scope'|'unknown', detail: string}>}
 */
export async function probeRegistryWrite({ registry, repository, username, secret, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (!username || !secret) {
    return { state: 'missing-credentials', detail: `no username/token is configured for ${registry}` };
  }

  const endpoints = registryEndpoints(registry);
  if (!endpoints) {
    return { state: 'unknown', detail: `unsupported registry '${registry}'; registry-probe.lib.mjs knows ghcr.io and docker.io` };
  }

  // Step 1 — exchange the credential for a push-scoped token. A rejected
  // credential is answered here, and only here, in the registry's own words
  // ("incorrect username or password", "personal access token is expired").
  const tokenResponse = await request({
    url: `${endpoints.token}&scope=repository:${repository}:pull,push`,
    headers: { Authorization: basicAuth(username, secret) },
    fetchImpl,
    timeoutMs,
  });

  if (tokenResponse.status === 401 || tokenResponse.status === 403) {
    return { state: 'invalid-credentials', detail: `${registry} rejected the credential (HTTP ${tokenResponse.status}): ${excerpt(tokenResponse.body)}` };
  }
  if (tokenResponse.status !== 200) {
    const reason = tokenResponse.error ? `: ${tokenResponse.error}` : '';
    return { state: 'unknown', detail: `${registry} token endpoint answered HTTP ${tokenResponse.status}${reason}` };
  }

  const token = readToken(tokenResponse.body);
  if (!token) {
    return { state: 'unknown', detail: `${registry} answered HTTP 200 with no token field` };
  }

  // Step 2 — ask for a write. Step 1 passing is not evidence of anything:
  // ghcr.io hands a "push"-scoped token to anyone who asks and docker.io
  // narrows the scope silently. This is the request that answers.
  const upload = await request({
    url: `${endpoints.api}/v2/${repository}/blobs/uploads/`,
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    fetchImpl,
    timeoutMs,
  });

  switch (upload.status) {
    case 200:
    case 201:
    case 202: {
      // Best effort: hand the session back rather than leaving it to expire.
      const location = upload.location.startsWith('/') ? `${endpoints.api}${upload.location}` : upload.location;
      if (location) {
        await request({ url: location, method: 'DELETE', headers: { Authorization: `Bearer ${token}` }, fetchImpl, timeoutMs });
      }
      return { state: 'ok', detail: `${registry}/${repository} accepted and released a blob upload session (HTTP ${upload.status})` };
    }
    case 401:
      return { state: 'invalid-credentials', detail: `${registry} rejected the push-scoped token for ${repository} (HTTP 401)` };
    case 403:
      return { state: 'insufficient-scope', detail: `${registry} authenticated the credential but denied write on ${repository} (HTTP 403): ${excerpt(upload.body)}` };
    default: {
      const reason = upload.error ? `: ${upload.error}` : '';
      return { state: 'unknown', detail: `${registry} answered HTTP ${upload.status}${reason} to a blob upload session on ${repository}` };
    }
  }
}

/**
 * What does an anonymous consumer get for this reference?
 *
 * Sends no credentials on purpose. Distinguishes four outcomes where
 * `docker manifest inspect` collapses them into "error":
 *
 *   published  the reference resolves for an anonymous consumer
 *   private    the registry knows the repository but will not serve it
 *   missing    the registry says the repository or tag does not exist
 *   unknown    the registry did not answer (network, 5xx, rate limit)
 *
 * @param {object} opts
 * @param {string} opts.reference
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{state: 'published'|'private'|'missing'|'unknown', detail: string, reference: string}>}
 */
export async function probeAnonymousPull({ reference, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const { registry, repository, tag } = parseImageReference(reference);
  const endpoints = registryEndpoints(registry);
  if (!endpoints) {
    return { state: 'unknown', detail: `unsupported registry '${registry}'; registry-probe.lib.mjs knows ghcr.io and docker.io`, reference };
  }

  // On GHCR this call alone answers the visibility question: a public package
  // hands an anonymous caller a token, a private one answers 401. Docker Hub
  // issues an anonymous token even for names that do not exist, so there the
  // state is settled by the manifest request below.
  const tokenResponse = await request({ url: `${endpoints.token}&scope=repository:${repository}:pull`, fetchImpl, timeoutMs });
  if (tokenResponse.status === 401 || tokenResponse.status === 403) {
    return { state: 'private', detail: `${registry} does not issue an anonymous pull token for ${repository} (HTTP ${tokenResponse.status})`, reference };
  }
  if (tokenResponse.status !== 200) {
    const reason = tokenResponse.error ? `: ${tokenResponse.error}` : '';
    return { state: 'unknown', detail: `${registry} token endpoint answered HTTP ${tokenResponse.status}${reason}`, reference };
  }

  const manifest = await request({
    url: `${endpoints.api}/v2/${repository}/manifests/${tag}`,
    headers: { Authorization: `Bearer ${readToken(tokenResponse.body)}`, Accept: MANIFEST_ACCEPT },
    fetchImpl,
    timeoutMs,
  });

  switch (manifest.status) {
    case 200:
      return { state: 'published', detail: `an anonymous GET of ${repository}:${tag} returned HTTP 200`, reference };
    case 404:
      return { state: 'missing', detail: `${registry} has no ${tag} tag for ${repository} (HTTP 404)`, reference };
    case 401:
    case 403:
      // Docker Hub answers 401 here for a repository that does not exist as
      // well as for one that is private, so this state means "not publicly
      // pullable" and says so rather than picking one of the two.
      return { state: 'private', detail: `${registry} refuses to serve ${repository}:${tag} anonymously (HTTP ${manifest.status}); on Docker Hub this is also the answer for a repository that does not exist`, reference };
    case 429:
      return { state: 'unknown', detail: `rate limited by ${registry} (HTTP 429); this is not evidence that the image is missing`, reference };
    default: {
      const reason = manifest.error ? `: ${manifest.error}` : '';
      return { state: 'unknown', detail: `${registry} answered HTTP ${manifest.status}${reason}`, reference };
    }
  }
}

/**
 * Can this runner mint the OIDC ID token that npm trusted publishing needs?
 *
 * The runner injects `ACTIONS_ID_TOKEN_REQUEST_URL` only when the job was
 * granted `id-token: write`, so a half-wired setup is reported as a missing
 * permission rather than as a token problem — which is the difference between
 * a one-line fix and an afternoon.
 *
 * @param {object} opts
 * @param {Record<string, string|undefined>} [opts.env]
 * @param {string} [opts.audience]
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{state: 'ok'|'missing-permission'|'invalid-credentials'|'unknown', detail: string}>}
 */
export async function probeOidcToken({ env = process.env, audience = 'npm:registry.npmjs.org', fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const url = env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !requestToken) {
    return {
      state: 'missing-permission',
      detail: 'ACTIONS_ID_TOKEN_REQUEST_URL is not set: this job was not granted `id-token: write`, so it cannot mint the OIDC token npm trusted publishing requires',
    };
  }

  const response = await request({
    url: `${url}&audience=${encodeURIComponent(audience)}`,
    headers: { Authorization: `Bearer ${requestToken}` },
    fetchImpl,
    timeoutMs,
  });

  if (response.status === 200) {
    // The value is a credential; only its presence is reported, never the token.
    return readToken(response.body) || /"value"\s*:/.test(response.body) ? { state: 'ok', detail: `the runner issued an OIDC ID token for audience ${audience}` } : { state: 'unknown', detail: 'the OIDC token endpoint answered HTTP 200 with no token in the body' };
  }
  if (response.status === 401 || response.status === 403) {
    return { state: 'invalid-credentials', detail: `the OIDC token endpoint rejected the request token (HTTP ${response.status})` };
  }
  const reason = response.error ? `: ${response.error}` : '';
  return { state: 'unknown', detail: `the OIDC token endpoint answered HTTP ${response.status}${reason}` };
}
