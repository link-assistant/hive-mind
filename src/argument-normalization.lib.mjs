const TYPOGRAPHIC_LONG_OPTION_DASHES = /[\u2013\u2014]/g;

const GITHUB_ISSUE_OR_PR_WITH_JOINED_OPTION = new RegExp(['^(', '(?:https?://)?', '(?:www\\.)?', '(?:github\\.com/)?', '[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/(?:issues|pull)/\\d+', ')', '(--[A-Za-z][A-Za-z0-9-]*(?:=.*)?)', '$'].join(''));

export const normalizeTypographicOptionDashes = value => {
  if (typeof value !== 'string') return value;
  return value.replace(TYPOGRAPHIC_LONG_OPTION_DASHES, '--');
};

export const splitJoinedGitHubLongOptionArg = value => {
  const normalized = normalizeTypographicOptionDashes(value);
  if (typeof normalized !== 'string') return [normalized];

  const match = normalized.match(GITHUB_ISSUE_OR_PR_WITH_JOINED_OPTION);
  if (!match) return [normalized];

  return [match[1], match[2]];
};

export const normalizeCliArgs = args => {
  if (!Array.isArray(args)) return [];
  return args.flatMap(splitJoinedGitHubLongOptionArg);
};
