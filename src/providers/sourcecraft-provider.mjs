/**
 * sourcecraft-provider.mjs
 *
 * SourceCraft provider implementation using the SourceCraft REST API.
 *
 * API Documentation: https://api.sourcecraft.tech/sourcecraft.swagger.json
 * SourceCraft Docs: https://sourcecraft.dev/portal/docs/en/
 */

import { RepositoryProvider } from './provider.interface.mjs';

// Use command-stream for consistent behavior
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const { $ } = await use('command-stream');

import { log, cleanErrorMessage } from '../lib.mjs';

/**
 * SourceCraft API client
 */
class SourceCraftClient {
  constructor() {
    this.baseUrl = 'https://api.sourcecraft.tech';
    this.webBaseUrl = 'https://sourcecraft.dev';
    // API token should be configured in environment or config
    this.apiToken = process.env.SOURCECRAFT_API_TOKEN || null;
  }

  /**
   * Make an API request to SourceCraft
   */
  async request(endpoint, options = {}) {
    const {
      method = 'GET',
      body = null,
      headers = {}
    } = options;

    const url = `${this.baseUrl}${endpoint}`;

    const requestOptions = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...headers
      }
    };

    // Add authentication if token is available
    if (this.apiToken) {
      requestOptions.headers['Authorization'] = `Bearer ${this.apiToken}`;
    }

    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      requestOptions.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, requestOptions);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`SourceCraft API error (${response.status}): ${errorText}`);
      }

      // Handle empty responses
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await response.json();
      }

      return await response.text();

    } catch (error) {
      throw new Error(`SourceCraft API request failed: ${error.message}`);
    }
  }

  /**
   * Get repository information
   */
  async getRepository(orgSlug, repoSlug) {
    return await this.request(`/repos/${orgSlug}/${repoSlug}`);
  }

  /**
   * Get issue by slug
   */
  async getIssue(orgSlug, repoSlug, issueSlug) {
    return await this.request(`/repos/${orgSlug}/${repoSlug}/issues/${issueSlug}`);
  }

  /**
   * List issues for a repository
   */
  async listIssues(orgSlug, repoSlug, params = {}) {
    const queryParams = new URLSearchParams(params);
    return await this.request(`/repos/${orgSlug}/${repoSlug}/issues?${queryParams}`);
  }

  /**
   * Create an issue
   */
  async createIssue(orgSlug, repoSlug, data) {
    return await this.request(`/repos/${orgSlug}/${repoSlug}/issues`, {
      method: 'POST',
      body: data
    });
  }

  /**
   * Get pull request by slug
   */
  async getPullRequest(orgSlug, repoSlug, prSlug) {
    return await this.request(`/repos/${orgSlug}/${repoSlug}/pullrequests/${prSlug}`);
  }

  /**
   * List pull requests for a repository
   */
  async listPullRequests(orgSlug, repoSlug, params = {}) {
    const queryParams = new URLSearchParams(params);
    return await this.request(`/repos/${orgSlug}/${repoSlug}/pullrequests?${queryParams}`);
  }

  /**
   * Create a pull request
   */
  async createPullRequest(orgSlug, repoSlug, data) {
    return await this.request(`/repos/${orgSlug}/${repoSlug}/pullrequests`, {
      method: 'POST',
      body: data
    });
  }

  /**
   * Add comment to issue
   */
  async addIssueComment(orgSlug, repoSlug, issueSlug, comment) {
    return await this.request(`/repos/${orgSlug}/${repoSlug}/issues/${issueSlug}/comments`, {
      method: 'POST',
      body: { comment }
    });
  }

  /**
   * Add comment to PR
   */
  async addPRComment(orgSlug, repoSlug, prSlug, comment) {
    return await this.request(`/repos/${orgSlug}/${repoSlug}/pullrequests/${prSlug}/comments`, {
      method: 'POST',
      body: { comment }
    });
  }

  /**
   * Get comments for an issue
   */
  async getIssueComments(orgSlug, repoSlug, issueSlug) {
    return await this.request(`/repos/${orgSlug}/${repoSlug}/issues/${issueSlug}/comments`);
  }

  /**
   * Get comments for a PR
   */
  async getPRComments(orgSlug, repoSlug, prSlug) {
    return await this.request(`/repos/${orgSlug}/${repoSlug}/pullrequests/${prSlug}/comments`);
  }

  /**
   * Fork a repository
   */
  async forkRepository(orgSlug, repoSlug) {
    return await this.request(`/repos/${orgSlug}/${repoSlug}/fork`, {
      method: 'POST'
    });
  }
}

/**
 * SourceCraft implementation of RepositoryProvider interface
 */
export class SourceCraftProvider extends RepositoryProvider {
  constructor() {
    super();
    this.client = new SourceCraftClient();
  }

  getName() {
    return 'sourcecraft';
  }

  /**
   * Parse SourceCraft URL
   * Format: https://sourcecraft.dev/{org_slug}/{repo_slug}/issues/{issue_slug}
   */
  parseUrl(url) {
    if (!url || typeof url !== 'string') {
      return {
        valid: false,
        error: 'Invalid input: URL must be a non-empty string'
      };
    }

    // Normalize URL
    let normalizedUrl = url.trim().replace(/\/+$/, '');

    // Handle protocol normalization
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      if (normalizedUrl.startsWith('sourcecraft.dev/')) {
        normalizedUrl = 'https://' + normalizedUrl;
      } else if (!normalizedUrl.includes('sourcecraft.dev')) {
        return {
          valid: false,
          error: 'Not a SourceCraft URL'
        };
      } else {
        return {
          valid: false,
          error: 'Invalid SourceCraft URL format'
        };
      }
    }

    // Convert http to https
    if (normalizedUrl.startsWith('http://')) {
      normalizedUrl = normalizedUrl.replace(/^http:\/\//, 'https://');
    }

    // Parse the URL
    let urlObj;
    try {
      urlObj = new globalThis.URL(normalizedUrl);
    } catch (e) {
      return {
        valid: false,
        error: 'Invalid URL format'
      };
    }

    // Ensure it's a SourceCraft URL
    if (urlObj.hostname !== 'sourcecraft.dev' && urlObj.hostname !== 'www.sourcecraft.dev') {
      return {
        valid: false,
        error: 'Not a SourceCraft URL'
      };
    }

    // Parse the pathname: /{org_slug}/{repo_slug}/...
    const pathParts = urlObj.pathname.split('/').filter(p => p);

    const result = {
      valid: true,
      normalized: normalizedUrl,
      hostname: 'sourcecraft.dev',
      protocol: 'https',
      path: urlObj.pathname
    };

    // No path - just sourcecraft.dev
    if (pathParts.length === 0) {
      result.type = 'home';
      return result;
    }

    // Organization page: /{org_slug}
    if (pathParts.length === 1) {
      result.type = 'user'; // Using 'user' for org for consistency
      result.owner = pathParts[0];
      return result;
    }

    // Set owner (org) for all other cases
    result.owner = pathParts[0];

    // Repository page: /{org_slug}/{repo_slug}
    if (pathParts.length === 2) {
      result.type = 'repo';
      result.repo = pathParts[1];
      return result;
    }

    // Set repo for paths with 3+ parts
    result.repo = pathParts[1];

    // Handle specific SourceCraft paths
    const thirdPart = pathParts[2];

    switch (thirdPart) {
      case 'issues':
        if (pathParts.length === 3) {
          // /{org}/{repo}/issues - issues list
          result.type = 'issues_list';
        } else if (pathParts.length === 4) {
          // /{org}/{repo}/issues/{issue_slug} - specific issue
          result.type = 'issue';
          result.slug = pathParts[3];
          // SourceCraft uses slugs, not numbers
          // Try to extract number if slug contains it
          const numMatch = pathParts[3].match(/(\d+)/);
          if (numMatch) {
            result.number = parseInt(numMatch[1]);
          }
        } else {
          result.type = 'issues_page';
          result.subpath = pathParts.slice(3).join('/');
        }
        break;

      case 'pullrequests':
      case 'pull-requests':
        if (pathParts.length === 3) {
          // /{org}/{repo}/pullrequests - PR list
          result.type = 'pulls_list';
        } else if (pathParts.length === 4) {
          // /{org}/{repo}/pullrequests/{pr_slug} - specific PR
          result.type = 'pull';
          result.slug = pathParts[3];
          // Try to extract number if slug contains it
          const numMatch = pathParts[3].match(/(\d+)/);
          if (numMatch) {
            result.number = parseInt(numMatch[1]);
          }
        } else {
          result.type = 'pull_page';
          result.subpath = pathParts.slice(3).join('/');
        }
        break;

      default:
        // Unknown path structure but still valid SourceCraft URL
        result.type = 'other';
        result.subpath = pathParts.slice(2).join('/');
    }

    return result;
  }

  async checkRepositoryWritePermission(owner, repo, options = {}) {
    const { useFork = false } = options;

    // Skip check if fork mode is enabled
    if (useFork) {
      await log('✅ Repository access check: Skipped (fork mode enabled)', { verbose: true });
      return true;
    }

    try {
      await log('🔍 Checking SourceCraft repository write permissions...');

      // Check if we have authentication
      if (!this.client.apiToken) {
        await log('⚠️  Warning: No SourceCraft API token configured', { level: 'warning' });
        await log('   Set SOURCECRAFT_API_TOKEN environment variable', { level: 'warning' });
        return false;
      }

      // Get repository info to check permissions
      const repoData = await this.client.getRepository(owner, repo);

      // Check if user has write access (this depends on SourceCraft API response structure)
      // TODO: Verify actual field name in SourceCraft API
      if (repoData.permissions && (repoData.permissions.push || repoData.permissions.admin)) {
        await log('✅ SourceCraft repository write access: Confirmed');
        return true;
      }

      await log('❌ No write access to SourceCraft repository', { level: 'error' });
      await log('   You may need to use --fork option', { level: 'error' });
      return false;

    } catch (error) {
      await log(`⚠️  Warning: Error checking SourceCraft permissions: ${cleanErrorMessage(error)}`, { level: 'warning' });
      await log('   Continuing anyway - will fail later if permissions are insufficient', { level: 'warning' });
      return true;
    }
  }

  async getIssue(issueSlugOrNumber, owner, repo, fields = ['number', 'title']) {
    try {
      const issueData = await this.client.getIssue(owner, repo, issueSlugOrNumber.toString());

      // Map SourceCraft fields to standard format
      return {
        number: issueData.id || issueData.number,
        slug: issueData.slug,
        title: issueData.title,
        body: issueData.description,
        state: issueData.status,
        createdAt: issueData.createdAt,
        updatedAt: issueData.updatedAt
      };
    } catch (error) {
      throw new Error(`Failed to get SourceCraft issue: ${error.message}`);
    }
  }

  async getPullRequest(prSlugOrNumber, owner, repo, fields = ['number', 'title', 'headRefName']) {
    try {
      const prData = await this.client.getPullRequest(owner, repo, prSlugOrNumber.toString());

      // Map SourceCraft fields to standard format
      return {
        number: prData.id || prData.number,
        slug: prData.slug,
        title: prData.title,
        body: prData.description,
        state: prData.status,
        headRefName: prData.sourceBranch,
        baseRefName: prData.targetBranch,
        createdAt: prData.createdAt,
        updatedAt: prData.updatedAt
      };
    } catch (error) {
      throw new Error(`Failed to get SourceCraft PR: ${error.message}`);
    }
  }

  async createPullRequest(options) {
    const {
      owner,
      repo,
      head,
      base,
      title,
      body,
      draft = false
    } = options;

    try {
      const prData = await this.client.createPullRequest(owner, repo, {
        title,
        description: body,
        sourceBranch: head,
        targetBranch: base,
        isDraft: draft
      });

      return {
        url: `https://sourcecraft.dev/${owner}/${repo}/pullrequests/${prData.slug}`,
        number: prData.id || prData.number,
        slug: prData.slug
      };
    } catch (error) {
      throw new Error(`Failed to create SourceCraft PR: ${error.message}`);
    }
  }

  async addComment(targetType, targetNumber, owner, repo, body) {
    try {
      if (targetType === 'pr' || targetType === 'pull') {
        await this.client.addPRComment(owner, repo, targetNumber.toString(), body);
      } else {
        await this.client.addIssueComment(owner, repo, targetNumber.toString(), body);
      }

      return {
        success: true
      };
    } catch (error) {
      throw new Error(`Failed to add SourceCraft comment: ${error.message}`);
    }
  }

  async getComments(targetType, targetNumber, owner, repo, since = null) {
    try {
      let comments;

      if (targetType === 'pr' || targetType === 'pull') {
        comments = await this.client.getPRComments(owner, repo, targetNumber.toString());
      } else {
        comments = await this.client.getIssueComments(owner, repo, targetNumber.toString());
      }

      // Filter by date if since is provided
      if (since) {
        comments = comments.filter(comment => new Date(comment.createdAt) > since);
      }

      // Map to standard format
      return comments.map(comment => ({
        id: comment.id,
        body: comment.comment || comment.text,
        author: comment.author,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt
      }));
    } catch (error) {
      throw new Error(`Failed to get SourceCraft comments: ${error.message}`);
    }
  }

  async forkRepository(owner, repo) {
    try {
      const forkData = await this.client.forkRepository(owner, repo);

      return {
        owner: forkData.owner?.slug || forkData.owner,
        repo: forkData.slug || forkData.name,
        fullName: `${forkData.owner?.slug || forkData.owner}/${forkData.slug || forkData.name}`
      };
    } catch (error) {
      throw new Error(`Failed to fork SourceCraft repository: ${error.message}`);
    }
  }

  async getCloneUrl(owner, repo, options = {}) {
    const useSSH = options.useSSH || false;

    // SourceCraft clone URLs
    // TODO: Verify actual SourceCraft clone URL format
    if (useSSH) {
      return `git@sourcecraft.dev:${owner}/${repo}.git`;
    } else {
      return `https://sourcecraft.dev/${owner}/${repo}.git`;
    }
  }

  async detectRepositoryVisibility(owner, repo) {
    try {
      const repoData = await this.client.getRepository(owner, repo);

      const isPublic = repoData.visibility === 'public' || repoData.isPublic === true;

      return {
        isPublic,
        visibility: repoData.visibility || (isPublic ? 'public' : 'private')
      };
    } catch (error) {
      await log(`⚠️  Warning: Error detecting SourceCraft visibility: ${cleanErrorMessage(error)}`, { level: 'warning' });
      // Default to public (safer to keep temp directories on error)
      return { isPublic: true, visibility: null };
    }
  }

  async listIssues(owner, repo, options = {}) {
    const {
      state = 'open',
      labels = [],
      limit = 100
    } = options;

    try {
      const params = {
        status: state,
        limit
      };

      // Add label filter if provided
      if (labels.length > 0) {
        params.labels = labels.join(',');
      }

      const issues = await this.client.listIssues(owner, repo, params);

      // Map to standard format
      return issues.map(issue => ({
        url: `https://sourcecraft.dev/${owner}/${repo}/issues/${issue.slug}`,
        title: issue.title,
        number: issue.id || issue.number,
        slug: issue.slug,
        createdAt: issue.createdAt,
        labels: issue.labels || []
      }));
    } catch (error) {
      throw new Error(`Failed to list SourceCraft issues: ${error.message}`);
    }
  }

  async listPullRequests(owner, repo, options = {}) {
    const {
      state = 'open',
      limit = 100
    } = options;

    try {
      const params = {
        status: state,
        limit
      };

      const prs = await this.client.listPullRequests(owner, repo, params);

      // Map to standard format
      return prs.map(pr => ({
        url: `https://sourcecraft.dev/${owner}/${repo}/pullrequests/${pr.slug}`,
        title: pr.title,
        number: pr.id || pr.number,
        slug: pr.slug,
        createdAt: pr.createdAt,
        headRefName: pr.sourceBranch
      }));
    } catch (error) {
      throw new Error(`Failed to list SourceCraft PRs: ${error.message}`);
    }
  }

  async checkAuthentication() {
    try {
      if (!this.client.apiToken) {
        await log('❌ SourceCraft API token not configured', { level: 'error' });
        await log('   Set SOURCECRAFT_API_TOKEN environment variable', { level: 'error' });
        return false;
      }

      // Try to make a simple API call to verify authentication
      // TODO: Implement a proper auth check endpoint when available
      await log('✅ SourceCraft authentication: Token configured');
      await log('⚠️  Note: Token validation requires API call - skipping in quick check', { verbose: true });

      return true;
    } catch (error) {
      await log(`❌ SourceCraft authentication failed: ${cleanErrorMessage(error)}`, { level: 'error' });
      return false;
    }
  }
}

export default SourceCraftProvider;
