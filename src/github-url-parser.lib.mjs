import { reportError } from './sentry.lib.mjs';

/**
 * Universal GitHub URL parser that handles various formats
 * @param {string} url - The GitHub URL to parse
 * @returns {Object} Parsed URL information including:
 *   - valid: boolean indicating if the URL is valid
 *   - normalized: the normalized URL (https://github.com/...), query/fragment kept
 *   - canonical: the URL the bot actually interprets (no query string, no #fragment)
 *   - type: 'user', 'repo', 'issue', 'pull', 'gist', 'actions', etc.
 *   - owner: repository owner/organization
 *   - repo: repository name (if applicable)
 *   - number: issue/PR number (if applicable)
 *   - path: additional path components
 *   - error: error message if invalid
 */
export function parseGitHubUrl(url) {
  if (!url || typeof url !== 'string') {
    return {
      valid: false,
      error: 'Invalid input: URL must be a non-empty string',
    };
  }
  // Trim whitespace and remove trailing slashes
  let normalizedUrl = url.trim().replace(/\/+$/, '');
  // Check if this looks like a valid GitHub-related input Reject clearly invalid inputs (spaces in the URL, special chars at the start, etc.)
  if (/\s/.test(normalizedUrl) || /^[!@#$%^&*()[\]{}|\\:;"'<>,?`~]/.test(normalizedUrl)) {
    return {
      valid: false,
      error: 'Invalid GitHub URL format',
    };
  }
  // Handle protocol normalization
  if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
    // Check if it starts with github.com
    if (normalizedUrl.startsWith('github.com/')) {
      normalizedUrl = 'https://' + normalizedUrl;
    } else if (!normalizedUrl.includes('github.com')) {
      // Assume it's a shorthand format (owner, owner/repo, owner/repo/issues/123, etc.)
      normalizedUrl = 'https://github.com/' + normalizedUrl;
    } else {
      // Has github.com somewhere but not at the start - likely malformed
      return {
        valid: false,
        error: 'Invalid GitHub URL format',
      };
    }
  }
  // Convert http to https
  if (normalizedUrl.startsWith('http://')) {
    normalizedUrl = normalizedUrl.replace(/^http:\/\//, 'https://');
  }
  // Check for backslashes in the URL path (excluding query params and hash) According to RFC 3986, backslash is not a valid character in URL paths
  const urlBeforeQueryAndHash = normalizedUrl.split('?')[0].split('#')[0];
  if (urlBeforeQueryAndHash.includes('\\')) {
    // Generate suggested URL by replacing backslashes with forward slashes
    const suggestedUrl = urlBeforeQueryAndHash.replace(/\\/g, '/');
    const urlAfterPath = normalizedUrl.substring(urlBeforeQueryAndHash.length);
    return {
      valid: false,
      error: 'Invalid character in URL: backslash (\\) is not allowed in URL paths',
      suggestion: suggestedUrl + urlAfterPath,
    };
  }
  // Parse the URL
  let urlObj;
  try {
    urlObj = new globalThis.URL(normalizedUrl);
  } catch (e) {
    if (global.verboseMode) {
      reportError(e, {
        context: 'github.lib.mjs - URL parsing',
        level: 'debug',
        url: normalizedUrl,
      });
    }
    return {
      valid: false,
      error: 'Invalid URL format',
    };
  }
  // Ensure it's a GitHub URL
  if (urlObj.hostname !== 'github.com' && urlObj.hostname !== 'www.github.com') {
    return {
      valid: false,
      error: 'Not a GitHub URL',
    };
  }
  // Normalize hostname
  if (urlObj.hostname === 'www.github.com') {
    normalizedUrl = normalizedUrl.replace('www.github.com', 'github.com');
    urlObj = new globalThis.URL(normalizedUrl);
  }
  // Parse the pathname
  const pathParts = urlObj.pathname.split('/').filter(p => p);
  // Handle different GitHub URL patterns
  const result = {
    valid: true,
    normalized: normalizedUrl,
    // Issue #2166: `normalized` keeps whatever query string or fragment the user
    // pasted (`…/pull/18#issuecomment-5370631063`), but nothing downstream reads
    // it — the bot resolves the target from owner/repo/number alone. Echoing the
    // fragment back therefore claims an interpretation that never happened, so
    // `canonical` is the URL the bot actually acted on and is what gets shown,
    // queued and matched against.
    canonical: `https://github.com${urlObj.pathname.replace(/\/+$/, '')}`,
    hostname: 'github.com',
    protocol: 'https',
    path: urlObj.pathname,
  };
  // No path - just github.com
  if (pathParts.length === 0) {
    result.type = 'home';
    return result;
  }
  // User/Organization page: /owner
  if (pathParts.length === 1) {
    result.type = 'user';
    result.owner = pathParts[0];
    return result;
  }
  // Set owner for all other cases
  result.owner = pathParts[0];
  // Repository page: /owner/repo
  if (pathParts.length === 2) {
    result.type = 'repo';
    result.repo = pathParts[1];
    return result;
  }
  // Set repo for paths with 3+ parts
  result.repo = pathParts[1];
  // Handle specific GitHub paths
  const thirdPart = pathParts[2];
  switch (thirdPart) {
    case 'issues':
      if (pathParts.length === 3) {
        // /owner/repo/issues - issues list
        result.type = 'issues_list';
      } else if (pathParts.length === 4 && /^\d+$/.test(pathParts[3])) {
        // /owner/repo/issues/123 - specific issue
        result.type = 'issue';
        result.number = parseInt(pathParts[3]);
      } else {
        result.type = 'issues_page';
        result.subpath = pathParts.slice(3).join('/');
      }
      break;
    case 'pull':
      if (pathParts.length === 4 && /^\d+$/.test(pathParts[3])) {
        // /owner/repo/pull/456 - specific PR
        result.type = 'pull';
        result.number = parseInt(pathParts[3]);
      } else {
        result.type = 'pull_page';
        result.subpath = pathParts.slice(3).join('/');
      }
      break;
    case 'pulls':
      // /owner/repo/pulls - PR list
      result.type = 'pulls_list';
      if (pathParts.length > 3) {
        result.subpath = pathParts.slice(3).join('/');
      }
      break;
    case 'actions':
      // /owner/repo/actions - GitHub Actions
      result.type = 'actions';
      if (pathParts.length > 3) {
        result.subpath = pathParts.slice(3).join('/');
        if (pathParts[3] === 'runs' && pathParts[4] && /^\d+$/.test(pathParts[4])) {
          result.type = 'action_run';
          result.runId = parseInt(pathParts[4]);
        }
      }
      break;
    case 'releases':
      // /owner/repo/releases
      result.type = 'releases';
      if (pathParts.length > 3) {
        result.subpath = pathParts.slice(3).join('/');
        if (pathParts[3] === 'tag' && pathParts[4]) {
          result.type = 'release';
          result.tag = pathParts[4];
        }
      }
      break;
    case 'tree':
    case 'blob':
      // /owner/repo/tree/branch or /owner/repo/blob/branch/file
      result.type = thirdPart === 'tree' ? 'tree' : 'file';
      if (pathParts.length > 3) {
        result.branch = pathParts[3];
        if (pathParts.length > 4) {
          result.filepath = pathParts.slice(4).join('/');
        }
      }
      break;
    case 'commit':
    case 'commits':
      // /owner/repo/commit/sha or /owner/repo/commits/branch
      result.type = thirdPart === 'commit' ? 'commit' : 'commits';
      if (pathParts.length > 3) {
        result.ref = pathParts[3]; // Could be SHA or branch
      }
      break;
    case 'compare':
      // /owner/repo/compare/base...head
      result.type = 'compare';
      if (pathParts.length > 3) {
        result.comparison = pathParts[3];
      }
      break;
    case 'wiki':
      // /owner/repo/wiki
      result.type = 'wiki';
      if (pathParts.length > 3) {
        result.subpath = pathParts.slice(3).join('/');
      }
      break;
    case 'settings':
      // /owner/repo/settings
      result.type = 'settings';
      if (pathParts.length > 3) {
        result.subpath = pathParts.slice(3).join('/');
      }
      break;
    case 'projects':
      // /owner/repo/projects or /owner/repo/projects/1
      result.type = 'projects';
      if (pathParts.length > 3 && /^\d+$/.test(pathParts[3])) {
        result.type = 'project';
        result.projectNumber = parseInt(pathParts[3]);
      }
      break;
    default:
      // Unknown path structure but still valid GitHub URL
      result.type = 'other';
      result.subpath = pathParts.slice(2).join('/');
  }
  return result;
}
/**
 * Normalize a GitHub URL to standard https://github.com format
 * This is a convenience function that uses parseGitHubUrl
 * @param {string} url - The URL to normalize
 * @returns {string|null} The normalized URL or null if invalid
 */
export function normalizeGitHubUrl(url) {
  const parsed = parseGitHubUrl(url);
  return parsed.valid ? parsed.normalized : null;
}

/**
 * Reduce a GitHub URL to the part the tooling actually interprets: no query
 * string, no `#issuecomment-…` fragment, no trailing slash.
 *
 * Used wherever a URL is echoed back to a user, stored as a queue key, or
 * compared against another URL, so that a link copied from a comment and the
 * same link copied from the address bar name one and the same task (issue #2166).
 *
 * @param {string} url
 * @returns {string} The canonical URL, or the trimmed input when it cannot be parsed.
 */
export function canonicalizeGitHubUrl(url) {
  if (!url || typeof url !== 'string') return url;
  const parsed = parseGitHubUrl(url);
  return parsed.valid && parsed.canonical ? parsed.canonical : url.trim();
}

/** Build the canonical web URL for a pull request already identified by GitHub. */
export function buildGitHubPullRequestUrl({ owner, repo, number } = {}) {
  if (!owner || !repo || !Number.isInteger(Number(number)) || Number(number) <= 0) {
    throw new TypeError('A GitHub pull request URL requires owner, repo, and a positive integer number');
  }
  return `https://github.com/${owner}/${repo}/pull/${Number(number)}`;
}
/**
 * Check if a URL is a valid GitHub URL of a specific type
 * @param {string} url - The URL to check
 * @param {string|Array} types - The type(s) to check for ('issue', 'pull', 'repo', etc.)
 * @returns {boolean} True if the URL matches the specified type(s)
 */
export function isGitHubUrlType(url, types) {
  const parsed = parseGitHubUrl(url);
  if (!parsed.valid) return false;
  const typeArray = Array.isArray(types) ? types : [types];
  return typeArray.includes(parsed.type);
}
