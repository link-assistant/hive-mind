/**
 * ESLint rule to require --paginate flag on gh api calls that return lists.
 *
 * GitHub API returns a maximum of 30 results per page by default.
 * Without --paginate, API calls that return lists will miss data beyond the first page.
 *
 * This rule detects gh api calls that target list-returning endpoints and warns
 * if they don't include the --paginate flag.
 */

// GitHub API endpoints that return lists and need --paginate
// These patterns match the endpoint part of the URL
const LIST_ENDPOINTS = [
  // Issues and PRs
  /\/issues$/,
  /\/issues\/\d+\/comments$/,
  /\/issues\/\d+\/timeline$/,
  /\/pulls$/,
  /\/pulls\/\d+\/comments$/,
  /\/pulls\/\d+\/commits$/,
  /\/pulls\/\d+\/files$/,
  /\/pulls\/\d+\/reviews$/,
  // Commits
  /\/commits$/,
  /\/commits\/[^/]+\/check-runs$/,
  // Branches
  /\/branches$/,
  // Forks
  /\/forks$/,
  // Note: /contents/{path} is NOT included because it returns a single file
  // when path points to a file, and a list when pointing to a directory.
  // We cannot reliably detect which at static analysis time, so we skip it.
  // Developers should manually add --paginate when listing directory contents.
  // Repos
  /\/repos$/, // For orgs/users repos lists
  // Workflows
  /\/workflows$/,
  /\/workflows\/[^/]+\/runs$/,
  /\/runs$/,
  /\/runs\/\d+\/jobs$/,
  // Releases
  /\/releases$/,
  /\/releases\/\d+\/assets$/,
  // Tags
  /\/tags$/,
  // Contributors/Collaborators
  /\/contributors$/,
  /\/collaborators$/,
  // Notifications
  /\/notifications$/,
  // Search
  /^search\//,
  // Events
  /\/events$/,
];

// Patterns that indicate the command is NOT a list (single resource)
const SINGLE_RESOURCE_PATTERNS = [
  /\/issues\/\d+(?!\/)/, // Single issue
  /\/pulls\/\d+(?!\/)/, // Single PR
  /\/commits\/[a-f0-9]+(?!\/)/, // Single commit by SHA
  /\/branches\/[^/]+(?!\/)/, // Single branch
  /\/releases\/\d+(?!\/)/, // Single release
  /\/repos\/[^/]+\/[^/]+(?!\/)/, // Single repo
];

/**
 * Check if an endpoint returns a list
 */
function endpointReturnsList(endpoint) {
  // Clean the endpoint
  const cleanEndpoint = endpoint.replace(/^\$\{.*?\}\//, '').replace(/`/g, '');

  // Check if it's a single resource first
  for (const pattern of SINGLE_RESOURCE_PATTERNS) {
    if (pattern.test(cleanEndpoint)) {
      return false;
    }
  }

  // Check if it matches a list endpoint
  for (const pattern of LIST_ENDPOINTS) {
    if (pattern.test(cleanEndpoint)) {
      return true;
    }
  }

  return false;
}

/**
 * Extract the endpoint from a gh api command string
 */
function extractEndpoint(commandStr) {
  // Handle template literals - look for gh api followed by path
  // Common patterns:
  // `gh api repos/${owner}/${repo}/issues`
  // `gh api users/${owner} --jq .type`
  // `gh api search/issues --jq '.items'`

  const ghApiMatch = commandStr.match(/gh\s+api\s+([^\s`'"]+)/);
  if (ghApiMatch) {
    return ghApiMatch[1];
  }

  return null;
}

/**
 * Check if the command includes --paginate
 */
function hasPaginateFlag(commandStr) {
  return /--paginate/.test(commandStr);
}

/**
 * Check if this is a GraphQL query (doesn't need --paginate)
 */
function isGraphQLQuery(commandStr) {
  return /graphql/.test(commandStr);
}

/**
 * Check if this is a write operation (doesn't need --paginate)
 */
function isWriteOperation(commandStr) {
  return /--method\s+(POST|PUT|PATCH|DELETE)|-X\s+(POST|PUT|PATCH|DELETE)|--method=(POST|PUT|PATCH|DELETE)|-X(POST|PUT|PATCH|DELETE)/i.test(commandStr);
}

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
      // Check template literals (most common pattern in this codebase)
      TemplateLiteral(node) {
        // Build the full string from quasis
        const quasis = node.quasis.map(q => q.value.raw).join('${...}');

        // Skip if not a gh api command
        if (!quasis.includes('gh api') && !quasis.includes('gh\napi')) {
          return;
        }

        // Skip GraphQL queries
        if (isGraphQLQuery(quasis)) {
          return;
        }

        // Skip write operations
        if (isWriteOperation(quasis)) {
          return;
        }

        // Skip if already has --paginate
        if (hasPaginateFlag(quasis)) {
          return;
        }

        // Extract endpoint
        const endpoint = extractEndpoint(quasis);
        if (!endpoint) {
          return;
        }

        // Check if endpoint returns a list
        if (endpointReturnsList(endpoint)) {
          context.report({
            node,
            messageId: 'missingPaginate',
            data: {
              endpoint,
            },
          });
        }
      },

      // Also check regular string literals (for execAsync and similar)
      Literal(node) {
        if (typeof node.value !== 'string') {
          return;
        }

        const str = node.value;

        // Skip if not a gh api command
        if (!str.includes('gh api')) {
          return;
        }

        // Skip GraphQL queries
        if (isGraphQLQuery(str)) {
          return;
        }

        // Skip write operations
        if (isWriteOperation(str)) {
          return;
        }

        // Skip if already has --paginate
        if (hasPaginateFlag(str)) {
          return;
        }

        // Extract endpoint
        const endpoint = extractEndpoint(str);
        if (!endpoint) {
          return;
        }

        // Check if endpoint returns a list
        if (endpointReturnsList(endpoint)) {
          context.report({
            node,
            messageId: 'missingPaginate',
            data: {
              endpoint,
            },
          });
        }
      },
    };
  },
};
