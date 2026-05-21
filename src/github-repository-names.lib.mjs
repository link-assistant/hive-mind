const OWNER_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const REPOSITORY_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const FULL_NAME_IN_TEXT_PATTERN = /(?:^|\s)([A-Za-z0-9_-]+\/[A-Za-z0-9._-]+)(?=$|\s|[),.;:])/;

function trimOutputToken(token) {
  return token.replace(/^[<([{'"`]+/, '').replace(/[>\])}'"`.,;]+$/, '');
}

function stripGitSuffix(repositoryName) {
  return repositoryName.endsWith('.git') ? repositoryName.slice(0, -4) : repositoryName;
}

function normalizeRepositoryFullName(owner, repositoryName) {
  if (!owner || !repositoryName) return null;
  if (!OWNER_NAME_PATTERN.test(owner)) return null;
  if (!REPOSITORY_NAME_PATTERN.test(repositoryName)) return null;
  return `${owner}/${repositoryName}`;
}

function parseGitHubRepositoryUrlToken(token) {
  const cleaned = trimOutputToken(token);
  let pathName = null;

  if (cleaned.startsWith('git@github.com:')) {
    pathName = cleaned.slice('git@github.com:'.length);
  } else if (cleaned.startsWith('github.com/')) {
    pathName = cleaned.slice('github.com/'.length);
  } else {
    try {
      const parsed = new URL(cleaned);
      if (parsed.hostname !== 'github.com') return null;
      pathName = parsed.pathname.replace(/^\/+/, '');
    } catch {
      return null;
    }
  }

  const [owner, repositoryName] = pathName.split('/');
  return normalizeRepositoryFullName(owner, stripGitSuffix(repositoryName || ''));
}

/**
 * Parse the repository full name returned by `gh repo fork`.
 *
 * GitHub repository names can contain dots, notably GitHub Pages names like
 * `parking.github.io`. The previous inline regex only accepted letters,
 * digits, underscores, and dashes, so it truncated dotted fork names and
 * verified the wrong repository.
 *
 * @param {string} output
 * @returns {string|null}
 */
export function parseForkFullNameFromGhOutput(output) {
  const text = String(output || '');

  for (const token of text.match(/\S+/g) || []) {
    const parsed = parseGitHubRepositoryUrlToken(token);
    if (parsed) return parsed;
  }

  const fullNameMatch = text.match(FULL_NAME_IN_TEXT_PATTERN);
  return fullNameMatch ? fullNameMatch[1] : null;
}
