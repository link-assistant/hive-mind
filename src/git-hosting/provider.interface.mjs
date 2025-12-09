#!/usr/bin/env node
/**
 * Git Hosting Provider Interface
 *
 * This module defines the abstract interface that all git hosting providers
 * (GitHub, GitLab, BitBucket) must implement to work with hive-mind.
 *
 * The interface abstracts away provider-specific CLI tools and APIs,
 * allowing the codebase to work with any supported provider.
 */

/**
 * @typedef {Object} ProviderInfo
 * @property {string} name - Provider name (e.g., 'github', 'gitlab', 'bitbucket')
 * @property {string} displayName - Human-readable name (e.g., 'GitHub', 'GitLab')
 * @property {string} hostname - Primary hostname (e.g., 'github.com')
 * @property {string[]} hostnames - All supported hostnames
 * @property {string} cliTool - CLI tool name if available (e.g., 'gh', 'glab')
 * @property {boolean} cliAvailable - Whether CLI tool is installed and available
 * @property {string|null} apiBaseUrl - Base URL for REST API
 */

/**
 * @typedef {Object} ParsedUrl
 * @property {boolean} valid - Whether the URL is valid
 * @property {string} normalized - Normalized URL
 * @property {string} type - URL type ('issue', 'pull', 'repo', 'user', etc.)
 * @property {string} owner - Repository owner/organization
 * @property {string} [repo] - Repository name (if applicable)
 * @property {number} [number] - Issue/PR number (if applicable)
 * @property {string} [path] - Additional path components
 * @property {string} [error] - Error message if invalid
 */

/**
 * @typedef {Object} AuthStatus
 * @property {boolean} authenticated - Whether user is authenticated
 * @property {string|null} username - Authenticated username
 * @property {string[]} scopes - Available OAuth scopes
 * @property {string|null} error - Error message if not authenticated
 */

/**
 * @typedef {Object} IssueInfo
 * @property {number} number - Issue number
 * @property {string} title - Issue title
 * @property {string} body - Issue body/description
 * @property {string} state - Issue state ('open', 'closed')
 * @property {string} url - Full URL to the issue
 * @property {string} author - Issue author username
 * @property {string[]} labels - Array of label names
 * @property {string[]} assignees - Array of assignee usernames
 * @property {Object} [repository] - Repository info
 * @property {string} createdAt - ISO timestamp
 * @property {string} updatedAt - ISO timestamp
 */

/**
 * @typedef {Object} PullRequestInfo
 * @property {number} number - PR number
 * @property {string} title - PR title
 * @property {string} body - PR body/description
 * @property {string} state - PR state ('open', 'closed', 'merged')
 * @property {string} url - Full URL to the PR
 * @property {string} author - PR author username
 * @property {string} headRefName - Source branch name
 * @property {string} baseRefName - Target branch name
 * @property {boolean} isDraft - Whether PR is a draft
 * @property {boolean} mergeable - Whether PR can be merged
 * @property {string} mergeStateStatus - Merge state status
 * @property {Object} headRepositoryOwner - Owner of head repository
 */

/**
 * @typedef {Object} RepositoryInfo
 * @property {string} name - Repository name
 * @property {string} owner - Repository owner
 * @property {string} fullName - Full repository name (owner/name)
 * @property {string} defaultBranch - Default branch name
 * @property {boolean} isPrivate - Whether repository is private
 * @property {boolean} isArchived - Whether repository is archived
 * @property {boolean} isFork - Whether repository is a fork
 * @property {Object} permissions - User permissions on repository
 * @property {string} cloneUrl - HTTPS clone URL
 * @property {string} sshUrl - SSH clone URL
 */

/**
 * @typedef {Object} CommentResult
 * @property {boolean} success - Whether comment was posted
 * @property {string|null} url - URL to the comment
 * @property {string|null} error - Error message if failed
 */

/**
 * @typedef {Object} CommandResult
 * @property {number} code - Exit code
 * @property {string} stdout - Standard output
 * @property {string} stderr - Standard error
 * @property {Object|null} data - Parsed data (if applicable)
 * @property {string} output - Combined stdout + stderr
 */

/**
 * Abstract base class for Git Hosting Provider implementations.
 * All provider implementations must extend this class and implement its methods.
 *
 * @abstract
 */
export class GitHostingProvider {
  /**
   * Create a new provider instance
   * @param {Object} options - Configuration options
   * @param {Function} options.log - Logging function
   * @param {Function} options.$ - Command execution function (command-stream)
   * @param {boolean} [options.verbose=false] - Enable verbose logging
   */
  constructor(options = {}) {
    if (new.target === GitHostingProvider) {
      throw new Error('GitHostingProvider is an abstract class and cannot be instantiated directly');
    }
    this.log = options.log || console.log;
    this.$ = options.$;
    this.verbose = options.verbose || false;
  }

  // ============================================================================
  // Provider Information
  // ============================================================================

  /**
   * Get provider information
   * @returns {ProviderInfo} Provider information
   * @abstract
   */
  getProviderInfo() {
    throw new Error('Method getProviderInfo() must be implemented');
  }

  /**
   * Check if a URL belongs to this provider
   * @param {string} url - URL to check
   * @returns {boolean} True if URL belongs to this provider
   * @abstract
   */
  isProviderUrl(_url) {
    throw new Error('Method isProviderUrl() must be implemented');
  }

  // ============================================================================
  // URL Parsing
  // ============================================================================

  /**
   * Parse a provider URL into components
   * @param {string} url - URL to parse
   * @returns {ParsedUrl} Parsed URL information
   * @abstract
   */
  parseUrl(_url) {
    throw new Error('Method parseUrl() must be implemented');
  }

  /**
   * Normalize a URL to standard format
   * @param {string} url - URL to normalize
   * @returns {string|null} Normalized URL or null if invalid
   */
  normalizeUrl(url) {
    const parsed = this.parseUrl(url);
    return parsed.valid ? parsed.normalized : null;
  }

  /**
   * Build a URL for a specific resource
   * @param {Object} options - URL options
   * @param {string} options.owner - Repository owner
   * @param {string} [options.repo] - Repository name
   * @param {string} [options.type] - Resource type ('issue', 'pull', 'repo')
   * @param {number} [options.number] - Issue/PR number
   * @returns {string} Built URL
   * @abstract
   */
  buildUrl(_options) {
    throw new Error('Method buildUrl() must be implemented');
  }

  // ============================================================================
  // Authentication
  // ============================================================================

  /**
   * Check authentication status
   * @returns {Promise<AuthStatus>} Authentication status
   * @abstract
   */
  async checkAuth() {
    throw new Error('Method checkAuth() must be implemented');
  }

  /**
   * Check if user has write access to a repository
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @returns {Promise<boolean>} True if user has write access
   * @abstract
   */
  async checkWritePermission(_owner, _repo) {
    throw new Error('Method checkWritePermission() must be implemented');
  }

  /**
   * Get current authenticated user info
   * @returns {Promise<{login: string, name: string|null}>} User info
   * @abstract
   */
  async getCurrentUser() {
    throw new Error('Method getCurrentUser() must be implemented');
  }

  // ============================================================================
  // Issue Operations
  // ============================================================================

  /**
   * Get issue details
   * @param {Object} options - Options
   * @param {string} options.owner - Repository owner
   * @param {string} options.repo - Repository name
   * @param {number} options.number - Issue number
   * @returns {Promise<IssueInfo|null>} Issue info or null if not found
   * @abstract
   */
  async getIssue(_options) {
    throw new Error('Method getIssue() must be implemented');
  }

  /**
   * List issues in a repository
   * @param {Object} options - Options
   * @param {string} options.owner - Repository owner
   * @param {string} options.repo - Repository name
   * @param {string} [options.state='open'] - Issue state filter
   * @param {string[]} [options.labels] - Label filter
   * @param {number} [options.limit=100] - Maximum issues to return
   * @returns {Promise<IssueInfo[]>} Array of issues
   * @abstract
   */
  async listIssues(_options) {
    throw new Error('Method listIssues() must be implemented');
  }

  /**
   * Add a comment to an issue
   * @param {Object} options - Options
   * @param {string} options.owner - Repository owner
   * @param {string} options.repo - Repository name
   * @param {number} options.number - Issue number
   * @param {string} options.body - Comment body
   * @returns {Promise<CommentResult>} Comment result
   * @abstract
   */
  async commentOnIssue(_options) {
    throw new Error('Method commentOnIssue() must be implemented');
  }

  // ============================================================================
  // Pull Request Operations
  // ============================================================================

  /**
   * Get pull request details
   * @param {Object} options - Options
   * @param {string} options.owner - Repository owner
   * @param {string} options.repo - Repository name
   * @param {number} options.number - PR number
   * @returns {Promise<PullRequestInfo|null>} PR info or null if not found
   * @abstract
   */
  async getPullRequest(_options) {
    throw new Error('Method getPullRequest() must be implemented');
  }

  /**
   * Create a pull request
   * @param {Object} options - Options
   * @param {string} options.owner - Repository owner
   * @param {string} options.repo - Repository name
   * @param {string} options.title - PR title
   * @param {string} options.body - PR body/description
   * @param {string} options.head - Source branch
   * @param {string} options.base - Target branch
   * @param {boolean} [options.draft=false] - Create as draft
   * @returns {Promise<{success: boolean, number: number|null, url: string|null, error: string|null}>}
   * @abstract
   */
  async createPullRequest(_options) {
    throw new Error('Method createPullRequest() must be implemented');
  }

  /**
   * Add a comment to a pull request
   * @param {Object} options - Options
   * @param {string} options.owner - Repository owner
   * @param {string} options.repo - Repository name
   * @param {number} options.number - PR number
   * @param {string} options.body - Comment body
   * @returns {Promise<CommentResult>} Comment result
   * @abstract
   */
  async commentOnPullRequest(_options) {
    throw new Error('Method commentOnPullRequest() must be implemented');
  }

  /**
   * Update pull request (title, body, state)
   * @param {Object} options - Options
   * @param {string} options.owner - Repository owner
   * @param {string} options.repo - Repository name
   * @param {number} options.number - PR number
   * @param {string} [options.title] - New title
   * @param {string} [options.body] - New body
   * @param {string} [options.state] - New state ('open', 'closed')
   * @returns {Promise<{success: boolean, error: string|null}>}
   * @abstract
   */
  async updatePullRequest(_options) {
    throw new Error('Method updatePullRequest() must be implemented');
  }

  /**
   * Mark a PR as ready for review (remove draft status)
   * @param {Object} options - Options
   * @param {string} options.owner - Repository owner
   * @param {string} options.repo - Repository name
   * @param {number} options.number - PR number
   * @returns {Promise<{success: boolean, error: string|null}>}
   * @abstract
   */
  async markPullRequestReady(_options) {
    throw new Error('Method markPullRequestReady() must be implemented');
  }

  // ============================================================================
  // Repository Operations
  // ============================================================================

  /**
   * Get repository information
   * @param {Object} options - Options
   * @param {string} options.owner - Repository owner
   * @param {string} options.repo - Repository name
   * @returns {Promise<RepositoryInfo|null>} Repository info or null if not found
   * @abstract
   */
  async getRepository(_options) {
    throw new Error('Method getRepository() must be implemented');
  }

  /**
   * Clone a repository
   * @param {Object} options - Options
   * @param {string} options.owner - Repository owner
   * @param {string} options.repo - Repository name
   * @param {string} options.destination - Local destination path
   * @param {string} [options.branch] - Branch to checkout
   * @param {number} [options.depth] - Shallow clone depth
   * @returns {Promise<{success: boolean, error: string|null}>}
   * @abstract
   */
  async cloneRepository(_options) {
    throw new Error('Method cloneRepository() must be implemented');
  }

  /**
   * Fork a repository
   * @param {Object} options - Options
   * @param {string} options.owner - Repository owner
   * @param {string} options.repo - Repository name
   * @param {string} [options.name] - New fork name
   * @returns {Promise<{success: boolean, forkOwner: string|null, forkRepo: string|null, error: string|null}>}
   * @abstract
   */
  async forkRepository(_options) {
    throw new Error('Method forkRepository() must be implemented');
  }

  /**
   * Check if a repository is archived
   * @param {Object} options - Options
   * @param {string} options.owner - Repository owner
   * @param {string} options.repo - Repository name
   * @returns {Promise<boolean>} True if archived
   * @abstract
   */
  async isRepositoryArchived(_options) {
    throw new Error('Method isRepositoryArchived() must be implemented');
  }

  // ============================================================================
  // File Operations
  // ============================================================================

  /**
   * Check if a file exists in a branch
   * @param {Object} options - Options
   * @param {string} options.owner - Repository owner
   * @param {string} options.repo - Repository name
   * @param {string} options.path - File path
   * @param {string} options.branch - Branch name
   * @returns {Promise<boolean>} True if file exists
   * @abstract
   */
  async fileExistsInBranch(_options) {
    throw new Error('Method fileExistsInBranch() must be implemented');
  }

  // ============================================================================
  // Gist/Snippet Operations (optional)
  // ============================================================================

  /**
   * Create a gist/snippet for large content
   * @param {Object} options - Options
   * @param {string} options.content - Content to upload
   * @param {string} options.filename - Filename
   * @param {string} [options.description] - Description
   * @param {boolean} [options.public=false] - Whether gist is public
   * @returns {Promise<{success: boolean, url: string|null, rawUrl: string|null, error: string|null}>}
   * @abstract
   */
  async createGist(_options) {
    throw new Error('Method createGist() must be implemented');
  }

  // ============================================================================
  // Rate Limiting
  // ============================================================================

  /**
   * Check if an error indicates rate limiting
   * @param {Error|string} error - Error to check
   * @returns {boolean} True if rate limit error
   * @abstract
   */
  isRateLimitError(_error) {
    throw new Error('Method isRateLimitError() must be implemented');
  }

  /**
   * Get rate limit status
   * @returns {Promise<{limit: number, remaining: number, resetTime: Date|null}>}
   * @abstract
   */
  async getRateLimitStatus() {
    throw new Error('Method getRateLimitStatus() must be implemented');
  }

  // ============================================================================
  // CLI Tool Helpers
  // ============================================================================

  /**
   * Check if CLI tool is available
   * @returns {Promise<boolean>} True if CLI tool is installed and configured
   * @abstract
   */
  async isCliAvailable() {
    throw new Error('Method isCliAvailable() must be implemented');
  }

  /**
   * Execute a provider CLI command
   * @param {string} command - Command to execute
   * @param {Object} [options] - Execution options
   * @returns {Promise<CommandResult>} Command result
   * @abstract
   */
  async executeCliCommand(_command, _options = {}) {
    throw new Error('Method executeCliCommand() must be implemented');
  }

  // ============================================================================
  // Utility Methods (default implementations)
  // ============================================================================

  /**
   * Log a message if verbose mode is enabled
   * @param {string} message - Message to log
   * @param {Object} [options] - Log options
   */
  async logVerbose(message, options = {}) {
    if (this.verbose) {
      await this.log(message, { ...options, verbose: true });
    }
  }
}

export default GitHostingProvider;
