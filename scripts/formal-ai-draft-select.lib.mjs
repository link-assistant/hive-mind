/**
 * Admission of one Formal AI draft attempt: resolve what it runs, once (issue #3909).
 *
 * Every lookup is injected (`deps`), so the drift, mode and missing-artefact
 * cases are tested without the network. `scripts/formal-ai-draft-select.mjs`
 * wires them to `gh`; `scripts/formal-ai-draft.mjs` uses the same function
 * when a caller runs it directly with its own binary.
 *
 * @module formal-ai-draft-select
 */

import { ATTEMPT_MODES, ATTEMPT_OUTCOMES, AttemptIdentityError, BINARY_SOURCES, buildAttemptIdentity, FORMAL_AI_DEFAULT_BRANCH, FORMAL_AI_REPOSITORY, parseAttemptIdentity, parseAttemptMode, readCargoPackageVersion, releaseReceiptAsset, versionOf } from './formal-ai-draft-identity.lib.mjs';
import { resolveDraftImages } from './formal-ai-draft-image.lib.mjs';

const SHA1 = /^[0-9a-f]{40}$/i;

/**
 * @typedef {object} SelectDeps
 * @property {(ref: string) => Promise<string>} resolveCommit Formal AI ref to a full commit SHA
 * @property {(sha: string) => Promise<string|null>} readVersion the `rust/Cargo.toml` package version at a commit
 * @property {(version: string) => Promise<{tag: string, version: string, sourceSha: string|null}|null>} releaseForVersion the release `v<version>` and the source its receipt names, or null
 * @property {(tag: string|null) => Promise<{tag: string, version: string, sourceSha: string|null}|null>} release a named release, or the latest when `tag` is null
 * @property {(sha: string) => Promise<boolean>} onDefaultBranch whether a commit is reachable from the Formal AI default branch
 * @property {(path: string) => Promise<string>} hashFile
 * @property {(path: string) => Promise<string>} binaryVersion `<binary> --version` output
 */

/**
 * The Formal AI half of the selection.
 *
 * - live-current: the default-branch head *now*. A release is reused only when
 *   its receipt names that exact commit — a matching version is not enough —
 *   otherwise the commit is built. A ref is refused: pinning is a replay.
 * - published-release: a release (latest unless named) and the source its
 *   receipt names.
 * - historical-replay: a pinned ref, built or matched to its release; with no
 *   ref, the binary baked into the image, labelled as such. The pinned commit
 *   must be reachable from the default branch: a commit that only exists in a
 *   fork or an unmerged pull request is never built in this repository's
 *   context.
 * - a caller's binary (`workflow_call` artifact, or Formal AI's own workflow)
 *   is bound by its digest and, when given, its source commit.
 */
export async function selectFormalAi({ mode, ref, callerBinary = null, callerSourceSha = null, deps }) {
  const pinned = String(ref || '').trim() || null;
  if (callerBinary) {
    const callerBinarySha256 = await deps.hashFile(callerBinary);
    const version = versionOf(await deps.binaryVersion(callerBinary));
    const source = String(callerSourceSha || '').trim() || (pinned && SHA1.test(pinned) ? pinned : null);
    if (source && !SHA1.test(source)) throw new Error(`the caller's Formal AI source must be a full commit SHA, received ${JSON.stringify(source)}`);
    return { ref: pinned || 'caller', sourceSha: source ? source.toLowerCase() : null, version, binarySource: BINARY_SOURCES.caller, callerBinarySha256 };
  }
  if (mode === ATTEMPT_MODES.liveCurrent) {
    if (pinned && pinned !== FORMAL_AI_DEFAULT_BRANCH) throw new Error(`a ${ATTEMPT_MODES.liveCurrent} attempt always runs the Formal AI ${FORMAL_AI_DEFAULT_BRANCH} head; pin ${JSON.stringify(pinned)} as a ${ATTEMPT_MODES.historicalReplay} instead`);
    return await selectSource({ ref: FORMAL_AI_DEFAULT_BRANCH, deps });
  }
  if (mode === ATTEMPT_MODES.publishedRelease) {
    const release = await deps.release(pinned);
    if (!release) throw new AttemptIdentityError(ATTEMPT_OUTCOMES.deferred, `no Formal AI release ${pinned || '(latest)'} was found`);
    if (!release.sourceSha) throw new AttemptIdentityError(ATTEMPT_OUTCOMES.deferred, `Formal AI ${release.tag} publishes no native receipt naming its source, so it cannot be qualified`);
    return { ref: release.tag, sourceSha: release.sourceSha.toLowerCase(), version: release.version, binarySource: BINARY_SOURCES.release, release };
  }
  if (!pinned) return { ref: BINARY_SOURCES.imageBaked, sourceSha: null, version: null, binarySource: BINARY_SOURCES.imageBaked };
  return await selectSource({ ref: pinned, deps, requireDefaultBranch: true });
}

/** A ref resolved to a commit, its version, and how to obtain its binary. */
const selectSource = async ({ ref, deps, requireDefaultBranch = false }) => {
  const sourceSha = String(await deps.resolveCommit(ref)).toLowerCase();
  if (!SHA1.test(sourceSha)) throw new AttemptIdentityError(ATTEMPT_OUTCOMES.deferred, `could not resolve Formal AI ${ref} to a commit`);
  if (requireDefaultBranch && !(await deps.onDefaultBranch(sourceSha))) throw new AttemptIdentityError(ATTEMPT_OUTCOMES.mismatch, `Formal AI ${ref} (${sourceSha}) is not on ${FORMAL_AI_DEFAULT_BRANCH}; only merged history is replayed`, { ref, sourceSha });
  const version = await deps.readVersion(sourceSha);
  if (!version) throw new AttemptIdentityError(ATTEMPT_OUTCOMES.deferred, `could not read the Formal AI version at ${sourceSha}`);
  const candidate = await deps.releaseForVersion(version);
  // Formal AI can carry one version across several commits; only a receipt
  // naming this commit makes its release the same build.
  const release = candidate?.sourceSha && candidate.sourceSha.toLowerCase() === sourceSha ? candidate : null;
  return { ref, sourceSha, version, binarySource: release ? BINARY_SOURCES.release : BINARY_SOURCES.build, release, releaseCandidate: candidate && !release ? { tag: candidate.tag, sourceSha: candidate.sourceSha } : null };
};

/**
 * Select the whole attempt, or re-admit a recorded one.
 *
 * @param {object} params
 * @param {string} [params.mode]
 * @param {string} [params.ref] Formal AI ref (historical replay, or a release tag)
 * @param {string} [params.replayIdentity] a recorded identity to run again unchanged
 * @param {string} params.repository the issue's repository
 * @param {number} params.issue
 * @param {{repository: string, sourceSha: string, version: string, image: string}} params.hive
 * @param {string|null} [params.callerBinary]
 * @param {string|null} [params.callerSourceSha]
 * @param {object} [params.selected] when and where admission ran
 * @param {SelectDeps} params.deps
 */
export async function selectAttempt({ mode, ref, replayIdentity = null, repository, issue, hive, callerBinary = null, callerSourceSha = null, selected = {}, deps }) {
  if (String(replayIdentity || '').trim()) {
    const identity = parseAttemptIdentity(replayIdentity);
    if (identity.repository !== repository || Number(identity.issue) !== Number(issue)) throw new Error(`the recorded attempt ${identity.id} is for ${identity.repository}#${identity.issue}, not ${repository}#${issue}`);
    return identity;
  }
  const resolvedMode = parseAttemptMode(mode);
  const formalAi = await selectFormalAi({ mode: resolvedMode, ref, callerBinary, callerSourceSha, deps });
  const identity = buildAttemptIdentity({ mode: resolvedMode, repository, issue, formalAi: { repository: FORMAL_AI_REPOSITORY, ...formalAi }, hive, selected });
  if (formalAi.releaseCandidate) identity.formalAi.releaseCandidate = formalAi.releaseCandidate;
  return identity;
}

const isNotFound = error => /HTTP 404|Not Found/i.test(String(error?.stderr || error?.message || ''));

/**
 * {@link SelectDeps} backed by the GitHub API.
 *
 * @param {object} params
 * @param {(args: string[]) => Promise<string>} params.gh `gh` returning stdout
 * @param {(path: string) => Promise<string>} params.hashFile
 * @param {(path: string) => Promise<string>} params.binaryVersion
 * @param {string} [params.repository] the Formal AI repository
 * @returns {SelectDeps}
 */
export function createGitHubSelectDeps({ gh, hashFile, binaryVersion, repository = FORMAL_AI_REPOSITORY }) {
  const api = async (endpoint, extra = []) => gh(['api', endpoint, ...extra]);
  const receiptOf = async release => {
    const version = String(release.tag_name || '').replace(/^v/, '');
    const asset = (release.assets || []).find(item => item.name === releaseReceiptAsset(version));
    if (!asset) return { tag: release.tag_name, version, sourceSha: null };
    const receipt = JSON.parse(await api(`repos/${repository}/releases/assets/${asset.id}`, ['-H', 'Accept: application/octet-stream']));
    return { tag: release.tag_name, version, sourceSha: String(receipt?.identity?.source_commit || '').toLowerCase() || null, receiptDigest: asset.digest || null };
  };
  const releaseByEndpoint = async endpoint => {
    try {
      return await receiptOf(JSON.parse(await api(endpoint)));
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  };
  return {
    resolveCommit: async ref => (await api(`repos/${repository}/commits/${encodeURIComponent(ref)}`, ['--jq', '.sha'])).trim(),
    readVersion: async sha => readCargoPackageVersion(await api(`repos/${repository}/contents/rust/Cargo.toml?ref=${sha}`, ['-H', 'Accept: application/vnd.github.raw'])),
    releaseForVersion: version => releaseByEndpoint(`repos/${repository}/releases/tags/v${version}`),
    release: tag => releaseByEndpoint(tag ? `repos/${repository}/releases/tags/${encodeURIComponent(tag)}` : `repos/${repository}/releases/latest`),
    // `<sha>...<default>` is identical or ahead exactly when the default branch contains the commit.
    onDefaultBranch: async sha => ['identical', 'ahead'].includes((await api(`repos/${repository}/compare/${sha}...${FORMAL_AI_DEFAULT_BRANCH}`, ['--jq', '.status'])).trim()),
    hashFile,
    binaryVersion,
  };
}

/**
 * The Hive Mind half: the checked-out commit, its version, and the exact image
 * of that version (or an explicit override). Never `:latest`.
 *
 * @param {object} params
 * @param {string} params.root the Hive Mind checkout
 * @param {string} params.repository
 * @param {string} [params.imageOverride]
 * @param {(args: string[]) => Promise<string>} params.git `git -C root …` returning stdout
 * @param {(path: string) => string} params.readFile
 */
export async function readHiveSource({ root, repository, imageOverride, git, readFile }) {
  const sourceSha = (await git(['-C', root, 'rev-parse', 'HEAD'])).trim().toLowerCase();
  const { version } = JSON.parse(readFile(`${root}/package.json`));
  return { repository, sourceSha, version, image: resolveDraftImages({ override: imageOverride, version }).image };
}
