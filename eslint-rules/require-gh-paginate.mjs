/**
 * ESLint rule to require --paginate flag on gh api calls that return lists.
 *
 * GitHub API returns a maximum of 30 results per page by default.
 * Without --paginate, API calls that return lists will miss data beyond the first page.
 *
 * This rule detects gh api calls that target list-returning endpoints and reports
 * if they don't include the --paginate flag.
 */

// GitHub API endpoints that return lists and need --paginate.
// These patterns match normalized endpoint paths after template expressions,
// query strings, quotes, and leading slashes are stripped.
const LIST_ENDPOINT_PATTERNS = [
  // Issues and PRs
  /^repos\/[^/]+\/(?:[^/]+\/)?issues$/,
  /^repos\/[^/]+\/(?:[^/]+\/)?issues\/[^/]+\/comments$/,
  /^repos\/[^/]+\/(?:[^/]+\/)?issues\/[^/]+\/timeline$/,
  /^repos\/[^/]+\/(?:[^/]+\/)?pulls$/,
  /^repos\/[^/]+\/(?:[^/]+\/)?pulls\/[^/]+\/comments$/,
  /^repos\/[^/]+\/(?:[^/]+\/)?pulls\/[^/]+\/commits$/,
  /^repos\/[^/]+\/(?:[^/]+\/)?pulls\/[^/]+\/files$/,
  /^repos\/[^/]+\/(?:[^/]+\/)?pulls\/[^/]+\/reviews$/,

  // Commits and comparisons
  /^repos\/[^/]+\/(?:[^/]+\/)?commits$/,
  /^repos\/[^/]+\/(?:[^/]+\/)?commits\/[^/]+\/check-runs$/,
  /^repos\/[^/]+\/(?:[^/]+\/)?commits\/[^/]+\/pulls$/,
  /^repos\/[^/]+\/(?:[^/]+\/)?compare\/[^/]+$/,

  // Branches, forks, and repository contents listings
  /^repos\/[^/]+\/(?:[^/]+\/)?branches$/,
  /^repos\/[^/]+\/(?:[^/]+\/)?forks$/,
  /^repos\/[^/]+\/(?:[^/]+\/)?contents$/,
  /^repos\/[^/]+\/(?:[^/]+\/)?contents\/\.github\/workflows$/,

  // Repositories
  /^(?:orgs|users)\/[^/]+\/repos$/,

  // Workflows and workflow runs
  /^repos\/[^/]+\/(?:[^/]+\/)?actions\/workflows$/,
  /^repos\/[^/]+\/(?:[^/]+\/)?actions\/workflows\/[^/]+\/runs$/,
  /^repos\/[^/]+\/(?:[^/]+\/)?actions\/runs$/,
  /^repos\/[^/]+\/(?:[^/]+\/)?actions\/runs\/[^/]+\/jobs$/,

  // Releases and tags
  /^repos\/[^/]+\/(?:[^/]+\/)?releases$/,
  /^repos\/[^/]+\/(?:[^/]+\/)?releases\/[^/]+\/assets$/,
  /^repos\/[^/]+\/(?:[^/]+\/)?tags$/,

  // Contributors, collaborators, checks, notifications, and events
  /^repos\/[^/]+\/(?:[^/]+\/)?contributors$/,
  /^repos\/[^/]+\/(?:[^/]+\/)?collaborators$/,
  /^repos\/[^/]+\/(?:[^/]+\/)?check-runs\/[^/]+\/annotations$/,
  /^notifications$/,
  /^repos\/[^/]+\/(?:[^/]+\/)?events$/,

  // Authenticated user list endpoints
  /^user\/repository_invitations$/,
  /^user\/memberships\/orgs$/,

  // Search
  /^search\//,
];

const OPTION_VALUE_FLAGS = new Set(['--cache', '--field', '--header', '--hostname', '--input', '--jq', '--method', '--preview', '--raw-field', '-F', '-H', '-X', '-f', '-q']);

const COMMAND_SEPARATORS = new Set(['&&', '||', ';', '|']);

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const stripQuotes = value => value.replace(/^(['"])(.*)\1$/, '$2');

const normalizeTemplateExpressions = commandStr => commandStr.replace(/\$\{[^}]*\}/g, ':param');

const tokenizeCommand = commandStr => normalizeTemplateExpressions(commandStr).match(/"[^"]*"|'[^']*'|&&|\|\||[;|]|\S+/g) || [];

const normalizeEndpoint = endpoint => stripQuotes(endpoint).replace(/^\/+/, '').replace(/\?.*$/, '').replace(/`/g, '');

const isOptionValueFlag = token => OPTION_VALUE_FLAGS.has(token) || [...OPTION_VALUE_FLAGS].some(flag => token.startsWith(`${flag}=`));

const isWriteMethodFlag = token => token === '--method' || token === '-X' || token.startsWith('--method=') || token.startsWith('-X');

const extractInlineWriteMethod = token => {
  if (token.startsWith('--method=')) {
    return token.slice('--method='.length).toUpperCase();
  }

  if (token.startsWith('-X') && token.length > 2) {
    return token.slice(2).toUpperCase();
  }

  return null;
};

const isRedirection = token => /^\d?>/.test(token) || /^\d?</.test(token);

const isGhApiToken = (tokens, index) => stripQuotes(tokens[index]) === 'gh' && stripQuotes(tokens[index + 1] || '') === 'api';

/**
 * Extract gh api calls from a shell command string.
 */
function extractGhApiCalls(commandStr) {
  const tokens = tokenizeCommand(commandStr);
  const calls = [];

  for (let index = 0; index < tokens.length - 1; index++) {
    if (!isGhApiToken(tokens, index)) {
      continue;
    }

    const call = {
      endpoint: null,
      hasPaginate: false,
      isGraphQL: false,
      isWrite: false,
    };

    for (let tokenIndex = index + 2; tokenIndex < tokens.length; tokenIndex++) {
      const token = stripQuotes(tokens[tokenIndex]);

      if (COMMAND_SEPARATORS.has(token)) {
        break;
      }

      if (token === '--paginate') {
        call.hasPaginate = true;
        continue;
      }

      if (isWriteMethodFlag(token)) {
        const inlineMethod = extractInlineWriteMethod(token);
        const method = inlineMethod || stripQuotes(tokens[tokenIndex + 1] || '').toUpperCase();
        if (WRITE_METHODS.has(method)) {
          call.isWrite = true;
        }
      }

      if (token.startsWith('-')) {
        if (isOptionValueFlag(token) && !token.includes('=')) {
          tokenIndex++;
        }
        continue;
      }

      if (isRedirection(token)) {
        continue;
      }

      if (!call.endpoint) {
        call.endpoint = normalizeEndpoint(token);
        call.isGraphQL = call.endpoint === 'graphql';
      }
    }

    if (call.endpoint) {
      calls.push(call);
    }
  }

  return calls;
}

/**
 * Check if an endpoint returns a list.
 */
function endpointReturnsList(endpoint) {
  return LIST_ENDPOINT_PATTERNS.some(pattern => pattern.test(endpoint));
}

function reportMissingPaginate(context, node, call) {
  if (call.isGraphQL || call.isWrite || call.hasPaginate) {
    return;
  }

  if (endpointReturnsList(call.endpoint)) {
    context.report({
      node,
      messageId: 'missingPaginate',
      data: {
        endpoint: call.endpoint,
      },
    });
  }
}

function checkCommandString(context, node, commandStr) {
  for (const call of extractGhApiCalls(commandStr)) {
    reportMissingPaginate(context, node, call);
  }
}

// Exported for direct regression testing if RuleTester is not enough in future.
export const _testing = {
  endpointReturnsList,
  extractGhApiCalls,
  normalizeEndpoint,
  tokenizeCommand,
};

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require --paginate flag on gh api calls that return lists',
      category: 'Possible Errors',
      recommended: true,
    },
    messages: {
      missingPaginate: 'gh api call to "{{endpoint}}" returns a list and should include --paginate flag. ' + 'GitHub API returns max 30 results per page by default.',
    },
    schema: [],
  },

  create(context) {
    return {
      TemplateLiteral(node) {
        const quasis = node.quasis.map(q => q.value.raw).join('${...}');
        if (!quasis.includes('gh api') && !quasis.includes('gh\napi')) {
          return;
        }
        checkCommandString(context, node, quasis);
      },

      Literal(node) {
        if (typeof node.value !== 'string') {
          return;
        }

        const str = node.value;
        if (!str.includes('gh api')) {
          return;
        }
        checkCommandString(context, node, str);
      },
    };
  },
};
