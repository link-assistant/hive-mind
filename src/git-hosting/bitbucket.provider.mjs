#!/usr/bin/env node
/**
 * BitBucket Provider Implementation (Stub)
 *
 * This module provides a stub implementation of the GitHostingProvider interface
 * for BitBucket. It uses the BitBucket REST API (no official CLI tool available).
 *
 * Status: STUB - Basic structure in place, full implementation pending
 *
 * BitBucket API: https://developer.atlassian.com/cloud/bitbucket/rest/intro/
 *
 * Note: BitBucket does not have an official CLI tool like GitHub (gh) or GitLab (glab).
 * All operations must use the REST API directly.
 */

// Check if use is already defined (when imported from solve.mjs)
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

import { GitHostingProvider } from './provider.interface.mjs';

/**
 * BitBucket provider implementation
 *
 * CLI Tool: None (uses REST API)
 * API: BitBucket REST API v2.0
 */
export class BitBucketProvider extends GitHostingProvider {
  constructor(options = {}) {
    super(options);
    this._hostname = options.hostname || 'bitbucket.org';
    // BitBucket Cloud vs Server/Data Center
    this._isCloud = this._hostname === 'bitbucket.org';
    this._apiBaseUrl = this._isCloud
      ? 'https://api.bitbucket.org/2.0'
      : `https://${this._hostname}/rest/api/1.0`;
  }

  // ============================================================================
  // Provider Information
  // ============================================================================

  getProviderInfo() {
    return {
      name: 'bitbucket',
      displayName: 'BitBucket',
      hostname: this._hostname,
      hostnames: ['bitbucket.org', this._hostname],
      cliTool: null, // No official CLI
      cliAvailable: false,
      apiBaseUrl: this._apiBaseUrl
    };
  }

  isProviderUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const lowerUrl = url.toLowerCase();
    return lowerUrl.includes('bitbucket.org') || lowerUrl.includes(this._hostname);
  }

  // ============================================================================
  // URL Parsing
  // ============================================================================

  parseUrl(url) {
    if (!url || typeof url !== 'string') {
      return {
        valid: false,
        error: 'Invalid input: URL must be a non-empty string'
      };
    }

    let normalizedUrl = url.trim().replace(/\/+$/, '');

    // Handle protocol normalization
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      if (normalizedUrl.startsWith('bitbucket.org/') || normalizedUrl.startsWith(`${this._hostname}/`)) {
        normalizedUrl = 'https://' + normalizedUrl;
      } else if (!normalizedUrl.includes('bitbucket.org') && !normalizedUrl.includes(this._hostname)) {
        normalizedUrl = `https://${this._hostname}/` + normalizedUrl;
      } else {
        return {
          valid: false,
          error: 'Invalid BitBucket URL format'
        };
      }
    }

    // Convert http to https
    if (normalizedUrl.startsWith('http://')) {
      normalizedUrl = normalizedUrl.replace(/^http:\/\//, 'https://');
    }

    let urlObj;
    try {
      urlObj = new globalThis.URL(normalizedUrl);
    } catch {
      return {
        valid: false,
        error: 'Invalid URL format'
      };
    }

    // Check hostname
    if (urlObj.hostname !== 'bitbucket.org' && urlObj.hostname !== this._hostname) {
      return {
        valid: false,
        error: 'Not a BitBucket URL'
      };
    }

    const pathParts = urlObj.pathname.split('/').filter(p => p);

    const result = {
      valid: true,
      normalized: normalizedUrl,
      hostname: urlObj.hostname,
      protocol: 'https',
      path: urlObj.pathname
    };

    if (pathParts.length === 0) {
      result.type = 'home';
      return result;
    }

    // BitBucket Cloud uses /workspace/repo/issues/123 format
    // BitBucket Server uses /projects/PROJECT/repos/REPO/pull-requests/123

    if (pathParts.length === 1) {
      result.type = 'user';
      result.owner = pathParts[0];
      return result;
    }

    result.owner = pathParts[0];

    if (pathParts.length === 2) {
      result.type = 'repo';
      result.repo = pathParts[1];
      return result;
    }

    result.repo = pathParts[1];

    // Handle specific BitBucket paths
    if (pathParts[2] === 'issues') {
      if (pathParts[3] && /^\d+$/.test(pathParts[3])) {
        result.type = 'issue';
        result.number = parseInt(pathParts[3]);
      } else {
        result.type = 'issues_list';
      }
    } else if (pathParts[2] === 'pull-requests') {
      if (pathParts[3] && /^\d+$/.test(pathParts[3])) {
        result.type = 'pull';
        result.number = parseInt(pathParts[3]);
      } else {
        result.type = 'pulls_list';
      }
    } else if (pathParts[2] === 'src' || pathParts[2] === 'commits') {
      result.type = pathParts[2] === 'src' ? 'tree' : 'commits';
      if (pathParts[3]) {
        result.ref = pathParts[3];
      }
    } else {
      result.type = 'other';
      result.subpath = pathParts.slice(2).join('/');
    }

    return result;
  }

  buildUrl(options) {
    const { owner, repo, type, number } = options;
    let url = `https://${this._hostname}`;

    if (owner) {
      url += `/${owner}`;
    }

    if (repo) {
      url += `/${repo}`;
    }

    switch (type) {
      case 'issue':
        if (number) url += `/issues/${number}`;
        break;
      case 'pull':
        if (number) url += `/pull-requests/${number}`;
        break;
      case 'issues_list':
        url += '/issues';
        break;
      case 'pulls_list':
        url += '/pull-requests';
        break;
    }

    return url;
  }

  // ============================================================================
  // Authentication - STUB
  // ============================================================================

  async checkAuth() {
    await this.logVerbose('BitBucket checkAuth() - stub implementation');
    // BitBucket uses app passwords or OAuth tokens
    // Check if BITBUCKET_USERNAME and BITBUCKET_APP_PASSWORD are set
    const username = process.env.BITBUCKET_USERNAME;
    const appPassword = process.env.BITBUCKET_APP_PASSWORD;

    if (username && appPassword) {
      return {
        authenticated: true,
        username,
        scopes: [],
        error: null
      };
    }

    return {
      authenticated: false,
      username: null,
      scopes: [],
      error: 'BitBucket authentication not configured. Set BITBUCKET_USERNAME and BITBUCKET_APP_PASSWORD environment variables.'
    };
  }

  async checkWritePermission(_owner, _repo) {
    await this.logVerbose('BitBucket checkWritePermission() - stub implementation');
    return false;
  }

  async getCurrentUser() {
    await this.logVerbose('BitBucket getCurrentUser() - stub implementation');
    const username = process.env.BITBUCKET_USERNAME;
    return { login: username || null, name: null };
  }

  // ============================================================================
  // Issue Operations - STUB
  // ============================================================================

  async getIssue(options) {
    const { owner, repo, number } = options;
    await this.logVerbose(`BitBucket getIssue(${owner}/${repo}#${number}) - stub implementation`);

    // BitBucket Cloud API endpoint: GET /2.0/repositories/{workspace}/{repo_slug}/issues/{issue_id}
    try {
      const auth = this._getAuth();
      if (!auth) {
        return null;
      }

      // Note: This is a placeholder - actual implementation would use fetch
      return null;
    } catch {
      return null;
    }
  }

  async listIssues(_options) {
    await this.logVerbose('BitBucket listIssues() - stub implementation');
    return [];
  }

  async commentOnIssue(options) {
    const { owner, repo, number } = options;
    await this.logVerbose(`BitBucket commentOnIssue(${owner}/${repo}#${number}) - stub implementation`);

    return {
      success: false,
      url: null,
      error: 'BitBucket issue comments not implemented'
    };
  }

  // ============================================================================
  // Pull Request Operations - STUB
  // ============================================================================

  async getPullRequest(options) {
    const { owner, repo, number } = options;
    await this.logVerbose(`BitBucket getPullRequest(${owner}/${repo}!${number}) - stub implementation`);
    return null;
  }

  async createPullRequest(_options) {
    await this.logVerbose('BitBucket createPullRequest() - stub implementation');

    // BitBucket Cloud API: POST /2.0/repositories/{workspace}/{repo_slug}/pullrequests
    return {
      success: false,
      number: null,
      url: null,
      error: 'BitBucket pull request creation not implemented'
    };
  }

  async commentOnPullRequest(options) {
    const { owner, repo, number } = options;
    await this.logVerbose(`BitBucket commentOnPullRequest(${owner}/${repo}!${number}) - stub implementation`);

    return {
      success: false,
      url: null,
      error: 'BitBucket PR comments not implemented'
    };
  }

  async updatePullRequest(_options) {
    await this.logVerbose('BitBucket updatePullRequest() - stub implementation');
    return {
      success: false,
      error: 'Not implemented'
    };
  }

  async markPullRequestReady(_options) {
    await this.logVerbose('BitBucket markPullRequestReady() - stub implementation');
    // BitBucket doesn't have draft PRs in the same way
    return {
      success: false,
      error: 'BitBucket does not have draft pull requests'
    };
  }

  // ============================================================================
  // Repository Operations - STUB
  // ============================================================================

  async getRepository(_options) {
    await this.logVerbose('BitBucket getRepository() - stub implementation');
    return null;
  }

  async cloneRepository(options) {
    const { owner, repo, destination, branch, depth } = options;
    await this.logVerbose(`BitBucket cloneRepository(${owner}/${repo}) - stub implementation`);

    try {
      let cmd = `git clone https://${this._hostname}/${owner}/${repo}.git "${destination}"`;

      if (depth) {
        cmd += ` --depth ${depth}`;
      }

      if (branch) {
        cmd += ` --branch ${branch}`;
      }

      const result = await this.$(cmd);

      return {
        success: result.code === 0,
        error: result.code !== 0 ? (result.stderr?.toString() || 'Failed to clone') : null
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async forkRepository(_options) {
    await this.logVerbose('BitBucket forkRepository() - stub implementation');
    return {
      success: false,
      forkOwner: null,
      forkRepo: null,
      error: 'Not implemented'
    };
  }

  async isRepositoryArchived(_options) {
    await this.logVerbose('BitBucket isRepositoryArchived() - stub implementation');
    return false;
  }

  // ============================================================================
  // File Operations - STUB
  // ============================================================================

  async fileExistsInBranch(_options) {
    await this.logVerbose('BitBucket fileExistsInBranch() - stub implementation');
    return false;
  }

  // ============================================================================
  // Gist (Snippet) Operations - STUB
  // ============================================================================

  async createGist(_options) {
    await this.logVerbose('BitBucket createGist() - stub implementation (uses Snippets)');
    // BitBucket uses Snippets instead of Gists
    return {
      success: false,
      url: null,
      rawUrl: null,
      error: 'BitBucket Snippets support not implemented'
    };
  }

  // ============================================================================
  // Rate Limiting - STUB
  // ============================================================================

  isRateLimitError(error) {
    const errorMessage = (error.message || error.toString()).toLowerCase();
    return errorMessage.includes('rate limit') ||
           errorMessage.includes('429') ||
           errorMessage.includes('too many requests');
  }

  async getRateLimitStatus() {
    return { limit: 0, remaining: 0, resetTime: null };
  }

  // ============================================================================
  // CLI Tool Helpers
  // ============================================================================

  async isCliAvailable() {
    // BitBucket has no official CLI tool
    return false;
  }

  async executeCliCommand(_command, _options = {}) {
    return {
      code: 1,
      stdout: '',
      stderr: 'BitBucket has no CLI tool. Use REST API instead.',
      data: null,
      output: 'BitBucket has no CLI tool. Use REST API instead.'
    };
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Get authentication credentials for API calls
   * @returns {{username: string, password: string}|null}
   * @private
   */
  _getAuth() {
    const username = process.env.BITBUCKET_USERNAME;
    const appPassword = process.env.BITBUCKET_APP_PASSWORD;

    if (username && appPassword) {
      return { username, password: appPassword };
    }

    return null;
  }
}

// Factory function for easy instantiation
export function createBitBucketProvider(options = {}) {
  return new BitBucketProvider(options);
}

export default BitBucketProvider;
