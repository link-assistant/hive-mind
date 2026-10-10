import { calculateLevenshteinDistance } from './option-suggestions.lib.mjs';
import { formatInputLocation } from './input-diagnostics.lib.mjs';

const PATH_NAMES = ['issues', 'pull', 'pulls', 'actions', 'blob', 'tree', 'commit', 'compare', 'wiki', 'settings', 'projects'];

/** Diagnose syntax only; owner/repository spelling needs a GitHub lookup. */
export function addGitHubUrlInputLocation(result, input) {
  if (typeof input !== 'string' || !input) return result;
  let location;
  const host = input.match(/^(?:https?:\/\/)?(?:www\.)?([^/:?#\s]+)(?=\/)/i);
  if (!result.valid && host && /^https?:\/\//i.test(input) && !['github.com', 'www.github.com'].includes(host[1].toLowerCase())) {
    const part = host[1];
    const start = input.indexOf(part);
    location = { part, start, end: start + part.length, label: 'URL host' };
    if (part.length <= 12 && calculateLevenshteinDistance(part.toLowerCase(), 'github.com') <= 2) {
      result.suggestion = input.slice(0, start) + 'github.com' + input.slice(start + part.length);
    }
  } else if (['other', 'issues_page', 'pull_page'].includes(result.type)) {
    const path = (result.path || '').split('/').filter(Boolean);
    const extraPath = result.type !== 'other' && /^\d+$/.test(path[3] || '') && path.length > 4;
    const part = result.type === 'other' ? path[2] : extraPath ? path.slice(4).join('/') : path[3];
    if (part) {
      // Search after the owner and repository: the same word can occur there too.
      const prefix = `${path[0]}/${path[1]}/${result.type === 'other' ? '' : `${path[2]}/`}${extraPath ? `${path[3]}/` : ''}`;
      const start = input.indexOf(prefix) + prefix.length;
      if (start >= prefix.length && input.slice(start, start + part.length) === part) {
        location = { part, start, end: start + part.length, label: result.type === 'other' ? 'URL path segment' : extraPath ? 'extra URL path after the issue or pull request number' : 'issue or pull request number' };
        if (result.type === 'other' && part.length <= 12) {
          const candidates = PATH_NAMES.map(name => ({ name, distance: calculateLevenshteinDistance(part.toLowerCase(), name) }))
            .filter(candidate => candidate.distance <= 2)
            .sort((a, b) => a.distance - b.distance);
          if (candidates.length && (candidates.length === 1 || candidates[0].distance < candidates[1].distance)) {
            result.suggestion = input.slice(0, start) + candidates[0].name + input.slice(start + part.length);
          }
        }
      }
    } else {
      location = { part: '', start: input.length, end: input.length, label: 'an issue or pull request number' };
    }
  }
  if (!result.valid || location) {
    result.inputLocation = location || { part: input, start: 0, end: input.length, label: 'URL' };
    result.inputHint = formatInputLocation(input, result.inputLocation);
  }
  return result;
}
