/**
 * provider.interface.mjs
 *
 * Defines the interface that all repository providers (GitHub, SourceCraft, etc.)
 * must implement to work with hive-mind.
 *
 * This abstraction layer allows hive-mind to work with multiple code repository
 * platforms without changing the core logic.
 */

/**
 * Base interface for repository providers
 *
 * Each provider must implement these methods to integrate with hive-mind
 */
export class RepositoryProvider {
  /**
   * Get the provider name (e.g., 'github', 'sourcecraft')
   * @returns {string} Provider name
   */
  getName() {
    throw new Error('Method getName() must be implemented by provider');
  }

  /**
   * Parse and validate a URL for this provider
   * @param {string} url - The URL to parse
   * @returns {Object} Parsed URL information with structure:
   *   {
   *     valid: boolean,
   *     normalized: string (normalized URL),
   *     type: string ('user', 'repo', 'issue', 'pull', etc.),
   *     owner: string (repository owner/org),
   *     repo: string (repository name),
   *     number: number (issue/PR number),
   *     error: string (error message if invalid)
   *   }
   */
  parseUrl(url) {
    throw new Error('Method parseUrl() must be implemented by provider');
  }

  /**
   * Check if the current user has write permissions to a repository
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {Object} options - Configuration options
   * @param {boolean} options.useFork - Whether fork mode is enabled
   * @param {string} options.issueUrl - Issue URL for error messages
   * @returns {Promise<boolean>} True if has write access or fork mode enabled
   */
  async checkRepositoryWritePermission(owner, repo, options = {}) {
    throw new Error('Method checkRepositoryWritePermission() must be implemented by provider');
  }

  /**
   * Get issue details
   * @param {number|string} issueNumber - Issue number or slug
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {string[]} fields - Fields to retrieve
   * @returns {Promise<Object>} Issue data
   */
  async getIssue(issueNumber, owner, repo, fields = ['number', 'title']) {
    throw new Error('Method getIssue() must be implemented by provider');
  }

  /**
   * Get pull request details
   * @param {number|string} prNumber - PR number or slug
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {string[]} fields - Fields to retrieve
   * @returns {Promise<Object>} PR data
   */
  async getPullRequest(prNumber, owner, repo, fields = ['number', 'title', 'headRefName']) {
    throw new Error('Method getPullRequest() must be implemented by provider');
  }

  /**
   * Create a pull request
   * @param {Object} options - PR creation options
   * @param {string} options.owner - Repository owner
   * @param {string} options.repo - Repository name
   * @param {string} options.head - Branch to merge from
   * @param {string} options.base - Branch to merge to
   * @param {string} options.title - PR title
   * @param {string} options.body - PR description
   * @param {boolean} options.draft - Whether to create as draft
   * @returns {Promise<Object>} Created PR data
   */
  async createPullRequest(options) {
    throw new Error('Method createPullRequest() must be implemented by provider');
  }

  /**
   * Add a comment to an issue or PR
   * @param {string} targetType - 'issue' or 'pr'
   * @param {number|string} targetNumber - Issue/PR number
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {string} body - Comment text
   * @returns {Promise<Object>} Comment data
   */
  async addComment(targetType, targetNumber, owner, repo, body) {
    throw new Error('Method addComment() must be implemented by provider');
  }

  /**
   * Get comments for an issue or PR
   * @param {string} targetType - 'issue' or 'pr'
   * @param {number|string} targetNumber - Issue/PR number
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {Date} since - Only get comments after this date
   * @returns {Promise<Array>} Array of comments
   */
  async getComments(targetType, targetNumber, owner, repo, since = null) {
    throw new Error('Method getComments() must be implemented by provider');
  }

  /**
   * Fork a repository
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @returns {Promise<Object>} Forked repository data
   */
  async forkRepository(owner, repo) {
    throw new Error('Method forkRepository() must be implemented by provider');
  }

  /**
   * Clone repository URL for git operations
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {Object} options - Clone options
   * @param {boolean} options.useSSH - Whether to use SSH URL
   * @returns {Promise<string>} Clone URL
   */
  async getCloneUrl(owner, repo, options = {}) {
    throw new Error('Method getCloneUrl() must be implemented by provider');
  }

  /**
   * Detect if repository is public or private
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @returns {Promise<{isPublic: boolean, visibility: string}>}
   */
  async detectRepositoryVisibility(owner, repo) {
    throw new Error('Method detectRepositoryVisibility() must be implemented by provider');
  }

  /**
   * Fetch all issues from a repository with filtering
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {Object} options - Filter options
   * @param {string} options.state - Issue state ('open', 'closed', 'all')
   * @param {string[]} options.labels - Labels to filter by
   * @param {number} options.limit - Maximum issues to fetch
   * @returns {Promise<Array>} Array of issues
   */
  async listIssues(owner, repo, options = {}) {
    throw new Error('Method listIssues() must be implemented by provider');
  }

  /**
   * Fetch all pull requests from a repository with filtering
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {Object} options - Filter options
   * @param {string} options.state - PR state ('open', 'closed', 'all')
   * @param {number} options.limit - Maximum PRs to fetch
   * @returns {Promise<Array>} Array of pull requests
   */
  async listPullRequests(owner, repo, options = {}) {
    throw new Error('Method listPullRequests() must be implemented by provider');
  }

  /**
   * Check authentication and permissions
   * @returns {Promise<boolean>} True if authenticated
   */
  async checkAuthentication() {
    throw new Error('Method checkAuthentication() must be implemented by provider');
  }
}

/**
 * Factory function to get the appropriate provider based on URL
 * @param {string} url - Repository or issue URL
 * @returns {RepositoryProvider} Provider instance
 */
export async function getProviderForUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('Invalid URL provided to getProviderForUrl');
  }

  // Normalize and detect provider
  const normalizedUrl = url.trim().toLowerCase();

  // Check for SourceCraft URLs
  if (normalizedUrl.includes('sourcecraft.dev') || normalizedUrl.includes('sourcecraft.tech')) {
    const { SourceCraftProvider } = await import('./sourcecraft-provider.mjs');
    return new SourceCraftProvider();
  }

  // Check for GitHub URLs (default)
  if (normalizedUrl.includes('github.com') || !normalizedUrl.includes('://')) {
    const { GitHubProvider } = await import('./github-provider.mjs');
    return new GitHubProvider();
  }

  throw new Error(`Unsupported repository provider for URL: ${url}`);
}

/**
 * Detect provider type from URL without instantiating
 * @param {string} url - Repository or issue URL
 * @returns {string} Provider name ('github', 'sourcecraft', etc.)
 */
export function detectProviderFromUrl(url) {
  if (!url || typeof url !== 'string') {
    return 'unknown';
  }

  const normalizedUrl = url.trim().toLowerCase();

  if (normalizedUrl.includes('sourcecraft.dev') || normalizedUrl.includes('sourcecraft.tech')) {
    return 'sourcecraft';
  }

  if (normalizedUrl.includes('github.com') || !normalizedUrl.includes('://')) {
    return 'github';
  }

  return 'unknown';
}
