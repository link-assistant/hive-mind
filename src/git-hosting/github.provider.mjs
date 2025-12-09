#!/usr/bin/env node
/**
 * GitHub Provider Implementation
 *
 * This module implements the GitHostingProvider interface for GitHub,
 * using the GitHub CLI (gh) as the primary tool with API fallbacks.
 */

// Check if use is already defined (when imported from solve.mjs)
// If not, fetch it (when running standalone)
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

import { GitHostingProvider } from './provider.interface.mjs';

const fs = (await use('fs')).promises;

/**
 * GitHub provider implementation using gh CLI and REST/GraphQL APIs
 */
export class GitHubProvider extends GitHostingProvider {
  constructor(options = {}) {
    super(options);
    this._cliChecked = false;
    this._cliAvailable = null;
  }

  // ============================================================================
  // Provider Information
  // ============================================================================

  getProviderInfo() {
    return {
      name: 'github',
      displayName: 'GitHub',
      hostname: 'github.com',
      hostnames: ['github.com', 'www.github.com'],
      cliTool: 'gh',
      cliAvailable: this._cliAvailable,
      apiBaseUrl: 'https://api.github.com'
    };
  }

  isProviderUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const lowerUrl = url.toLowerCase();
    return lowerUrl.includes('github.com') ||
           lowerUrl.startsWith('github.com/') ||
           /^[a-z0-9_-]+\/[a-z0-9_.-]+$/i.test(url); // owner/repo format
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

    // Trim whitespace and remove trailing slashes
    let normalizedUrl = url.trim().replace(/\/+$/, '');

    // Check for invalid characters
    if (/\s/.test(normalizedUrl) || /^[!@#$%^&*()[\]{}|\\:;"'<>,?`~]/.test(normalizedUrl)) {
      return {
        valid: false,
        error: 'Invalid GitHub URL format'
      };
    }

    // Handle protocol normalization
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      if (normalizedUrl.startsWith('github.com/')) {
        normalizedUrl = 'https://' + normalizedUrl;
      } else if (!normalizedUrl.includes('github.com')) {
        // Assume shorthand format (owner, owner/repo, etc.)
        normalizedUrl = 'https://github.com/' + normalizedUrl;
      } else {
        return {
          valid: false,
          error: 'Invalid GitHub URL format'
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
    } catch {
      return {
        valid: false,
        error: 'Invalid URL format'
      };
    }

    // Ensure it's a GitHub URL
    if (urlObj.hostname !== 'github.com' && urlObj.hostname !== 'www.github.com') {
      return {
        valid: false,
        error: 'Not a GitHub URL'
      };
    }

    // Normalize hostname
    if (urlObj.hostname === 'www.github.com') {
      normalizedUrl = normalizedUrl.replace('www.github.com', 'github.com');
      urlObj = new globalThis.URL(normalizedUrl);
    }

    // Parse the pathname
    const pathParts = urlObj.pathname.split('/').filter(p => p);

    const result = {
      valid: true,
      normalized: normalizedUrl,
      hostname: 'github.com',
      protocol: 'https',
      path: urlObj.pathname
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
          result.type = 'issues_list';
        } else if (pathParts.length === 4 && /^\d+$/.test(pathParts[3])) {
          result.type = 'issue';
          result.number = parseInt(pathParts[3]);
        } else {
          result.type = 'issues_page';
          result.subpath = pathParts.slice(3).join('/');
        }
        break;

      case 'pull':
        if (pathParts.length === 4 && /^\d+$/.test(pathParts[3])) {
          result.type = 'pull';
          result.number = parseInt(pathParts[3]);
        } else {
          result.type = 'pull_page';
          result.subpath = pathParts.slice(3).join('/');
        }
        break;

      case 'pulls':
        result.type = 'pulls_list';
        if (pathParts.length > 3) {
          result.subpath = pathParts.slice(3).join('/');
        }
        break;

      case 'actions':
        result.type = 'actions';
        if (pathParts.length > 3) {
          result.subpath = pathParts.slice(3).join('/');
          if (pathParts[3] === 'runs' && pathParts[4] && /^\d+$/.test(pathParts[4])) {
            result.type = 'action_run';
            result.runId = parseInt(pathParts[4]);
          }
        }
        break;

      case 'tree':
      case 'blob':
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
        result.type = thirdPart === 'commit' ? 'commit' : 'commits';
        if (pathParts.length > 3) {
          result.ref = pathParts[3];
        }
        break;

      default:
        result.type = 'other';
        result.subpath = pathParts.slice(2).join('/');
    }

    return result;
  }

  buildUrl(options) {
    const { owner, repo, type, number } = options;
    let url = 'https://github.com';

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
        if (number) url += `/pull/${number}`;
        break;
      case 'issues_list':
        url += '/issues';
        break;
      case 'pulls_list':
        url += '/pulls';
        break;
    }

    return url;
  }

  // ============================================================================
  // Authentication
  // ============================================================================

  async checkAuth() {
    try {
      const result = await this.$`gh auth status 2>&1`;
      const output = result.stdout?.toString() + result.stderr?.toString() || '';

      if (result.code !== 0 || output.includes('not logged into any GitHub hosts')) {
        return {
          authenticated: false,
          username: null,
          scopes: [],
          error: 'Not authenticated. Run: gh auth login'
        };
      }

      // Parse scopes
      const scopeMatch = output.match(/Token scopes:\s*(.+)/);
      const scopes = scopeMatch
        ? (scopeMatch[1].match(/'([^']+)'/g)?.map(s => s.replace(/'/g, '')) || [])
        : [];

      // Get username
      let username = null;
      try {
        const userResult = await this.$`gh api user --jq .login`;
        if (userResult.code === 0) {
          username = userResult.stdout.toString().trim();
        }
      } catch {
        // Username lookup optional
      }

      return {
        authenticated: true,
        username,
        scopes,
        error: null
      };
    } catch (error) {
      return {
        authenticated: false,
        username: null,
        scopes: [],
        error: error.message
      };
    }
  }

  async checkWritePermission(owner, repo) {
    try {
      const result = await this.$`gh api repos/${owner}/${repo} --jq .permissions`;

      if (result.code !== 0) {
        return false;
      }

      const permissions = JSON.parse(result.stdout.toString().trim());
      return permissions.push === true || permissions.admin === true || permissions.maintain === true;
    } catch {
      return false;
    }
  }

  async getCurrentUser() {
    try {
      const result = await this.$`gh api user --jq '{login: .login, name: .name}'`;

      if (result.code === 0) {
        return JSON.parse(result.stdout.toString().trim());
      }

      return { login: null, name: null };
    } catch {
      return { login: null, name: null };
    }
  }

  // ============================================================================
  // Issue Operations
  // ============================================================================

  async getIssue(options) {
    const { owner, repo, number } = options;

    try {
      const fields = 'number,title,body,state,url,author,labels,assignees,createdAt,updatedAt';
      const result = await this.$`gh issue view ${number} --repo ${owner}/${repo} --json ${fields}`;

      if (result.code !== 0) {
        return null;
      }

      const data = JSON.parse(result.stdout.toString());
      return {
        number: data.number,
        title: data.title,
        body: data.body || '',
        state: data.state?.toLowerCase() || 'open',
        url: data.url,
        author: data.author?.login || '',
        labels: data.labels?.map(l => l.name) || [],
        assignees: data.assignees?.map(a => a.login) || [],
        createdAt: data.createdAt,
        updatedAt: data.updatedAt
      };
    } catch {
      return null;
    }
  }

  async listIssues(options) {
    const { owner, repo, state = 'open', labels = [], limit = 100 } = options;

    try {
      let cmd = `gh issue list --repo ${owner}/${repo} --state ${state} --limit ${limit} --json number,title,url,state,labels,author,createdAt`;

      if (labels.length > 0) {
        cmd += ` --label "${labels.join(',')}"`;
      }

      const result = await this.$(cmd);

      if (result.code !== 0) {
        return [];
      }

      const data = JSON.parse(result.stdout.toString() || '[]');
      return data.map(issue => ({
        number: issue.number,
        title: issue.title,
        body: '',
        state: issue.state?.toLowerCase() || state,
        url: issue.url,
        author: issue.author?.login || '',
        labels: issue.labels?.map(l => l.name) || [],
        assignees: [],
        createdAt: issue.createdAt,
        updatedAt: null
      }));
    } catch {
      return [];
    }
  }

  async commentOnIssue(options) {
    const { owner, repo, number, body } = options;

    try {
      // Write body to temp file to avoid shell escaping issues
      const tempFile = `/tmp/issue-comment-${Date.now()}.md`;
      await fs.writeFile(tempFile, body);

      const result = await this.$`gh issue comment ${number} --repo ${owner}/${repo} --body-file "${tempFile}"`;

      await fs.unlink(tempFile).catch(() => {});

      if (result.code === 0) {
        return {
          success: true,
          url: null, // gh doesn't return comment URL
          error: null
        };
      }

      return {
        success: false,
        url: null,
        error: result.stderr?.toString() || 'Unknown error'
      };
    } catch (error) {
      return {
        success: false,
        url: null,
        error: error.message
      };
    }
  }

  // ============================================================================
  // Pull Request Operations
  // ============================================================================

  async getPullRequest(options) {
    const { owner, repo, number } = options;

    try {
      const fields = 'number,title,body,state,url,author,headRefName,baseRefName,isDraft,mergeable,mergeStateStatus,headRepositoryOwner';
      const result = await this.$`gh pr view ${number} --repo ${owner}/${repo} --json ${fields}`;

      if (result.code !== 0) {
        return null;
      }

      const data = JSON.parse(result.stdout.toString());
      return {
        number: data.number,
        title: data.title,
        body: data.body || '',
        state: data.state?.toLowerCase() || 'open',
        url: data.url,
        author: data.author?.login || '',
        headRefName: data.headRefName,
        baseRefName: data.baseRefName,
        isDraft: data.isDraft || false,
        mergeable: data.mergeable === 'MERGEABLE',
        mergeStateStatus: data.mergeStateStatus,
        headRepositoryOwner: data.headRepositoryOwner
      };
    } catch {
      return null;
    }
  }

  async createPullRequest(options) {
    const { owner, repo, title, body, head, base, draft = false } = options;

    try {
      // Write body to temp file
      const tempFile = `/tmp/pr-body-${Date.now()}.md`;
      await fs.writeFile(tempFile, body);

      let cmd = `gh pr create --repo ${owner}/${repo} --title "${title.replace(/"/g, '\\"')}" --body-file "${tempFile}" --head ${head} --base ${base}`;

      if (draft) {
        cmd += ' --draft';
      }

      const result = await this.$(cmd);

      await fs.unlink(tempFile).catch(() => {});

      if (result.code === 0) {
        const prUrl = result.stdout.toString().trim();
        const prNumber = parseInt(prUrl.split('/').pop());

        return {
          success: true,
          number: prNumber,
          url: prUrl,
          error: null
        };
      }

      return {
        success: false,
        number: null,
        url: null,
        error: result.stderr?.toString() || 'Failed to create PR'
      };
    } catch (error) {
      return {
        success: false,
        number: null,
        url: null,
        error: error.message
      };
    }
  }

  async commentOnPullRequest(options) {
    const { owner, repo, number, body } = options;

    try {
      // Write body to temp file
      const tempFile = `/tmp/pr-comment-${Date.now()}.md`;
      await fs.writeFile(tempFile, body);

      const result = await this.$`gh pr comment ${number} --repo ${owner}/${repo} --body-file "${tempFile}"`;

      await fs.unlink(tempFile).catch(() => {});

      if (result.code === 0) {
        return {
          success: true,
          url: null,
          error: null
        };
      }

      return {
        success: false,
        url: null,
        error: result.stderr?.toString() || 'Unknown error'
      };
    } catch (error) {
      return {
        success: false,
        url: null,
        error: error.message
      };
    }
  }

  async updatePullRequest(options) {
    const { owner, repo, number, title, body, state } = options;

    try {
      let cmd = `gh pr edit ${number} --repo ${owner}/${repo}`;

      if (title) {
        cmd += ` --title "${title.replace(/"/g, '\\"')}"`;
      }

      if (body !== undefined) {
        const tempFile = `/tmp/pr-edit-body-${Date.now()}.md`;
        await fs.writeFile(tempFile, body);
        cmd += ` --body-file "${tempFile}"`;
      }

      const result = await this.$(cmd);

      // Handle state change separately
      if (state === 'closed' && result.code === 0) {
        await this.$`gh pr close ${number} --repo ${owner}/${repo}`;
      } else if (state === 'open' && result.code === 0) {
        await this.$`gh pr reopen ${number} --repo ${owner}/${repo}`;
      }

      return {
        success: result.code === 0,
        error: result.code !== 0 ? (result.stderr?.toString() || 'Failed to update PR') : null
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async markPullRequestReady(options) {
    const { owner, repo, number } = options;

    try {
      const result = await this.$`gh pr ready ${number} --repo ${owner}/${repo}`;

      return {
        success: result.code === 0,
        error: result.code !== 0 ? (result.stderr?.toString() || 'Failed to mark PR as ready') : null
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // ============================================================================
  // Repository Operations
  // ============================================================================

  async getRepository(options) {
    const { owner, repo } = options;

    try {
      const result = await this.$`gh api repos/${owner}/${repo}`;

      if (result.code !== 0) {
        return null;
      }

      const data = JSON.parse(result.stdout.toString());
      return {
        name: data.name,
        owner: data.owner?.login || owner,
        fullName: data.full_name,
        defaultBranch: data.default_branch,
        isPrivate: data.private,
        isArchived: data.archived,
        isFork: data.fork,
        permissions: data.permissions || {},
        cloneUrl: data.clone_url,
        sshUrl: data.ssh_url
      };
    } catch {
      return null;
    }
  }

  async cloneRepository(options) {
    const { owner, repo, destination, branch, depth } = options;

    try {
      let cmd = `gh repo clone ${owner}/${repo} "${destination}"`;

      if (depth) {
        cmd += ` -- --depth ${depth}`;
      }

      const result = await this.$(cmd);

      if (result.code !== 0) {
        return {
          success: false,
          error: result.stderr?.toString() || 'Failed to clone repository'
        };
      }

      // Checkout specific branch if requested
      if (branch) {
        const checkoutResult = await this.$`git -C "${destination}" checkout ${branch}`;
        if (checkoutResult.code !== 0) {
          return {
            success: false,
            error: `Cloned but failed to checkout branch ${branch}`
          };
        }
      }

      return {
        success: true,
        error: null
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async forkRepository(options) {
    const { owner, repo, name } = options;

    try {
      let cmd = `gh repo fork ${owner}/${repo} --clone=false`;

      if (name) {
        cmd += ` --fork-name ${name}`;
      }

      const result = await this.$(cmd);

      if (result.code !== 0) {
        return {
          success: false,
          forkOwner: null,
          forkRepo: null,
          error: result.stderr?.toString() || 'Failed to fork repository'
        };
      }

      // Get current user for fork owner
      const user = await this.getCurrentUser();

      return {
        success: true,
        forkOwner: user.login,
        forkRepo: name || repo,
        error: null
      };
    } catch (error) {
      return {
        success: false,
        forkOwner: null,
        forkRepo: null,
        error: error.message
      };
    }
  }

  async isRepositoryArchived(options) {
    const { owner, repo } = options;

    try {
      const result = await this.$`gh api repos/${owner}/${repo} --jq .archived`;

      if (result.code === 0) {
        return result.stdout.toString().trim() === 'true';
      }

      return false;
    } catch {
      return false;
    }
  }

  // ============================================================================
  // File Operations
  // ============================================================================

  async fileExistsInBranch(options) {
    const { owner, repo, path: filePath, branch } = options;

    try {
      const result = await this.$`gh api repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`;
      return result.code === 0;
    } catch {
      return false;
    }
  }

  // ============================================================================
  // Gist Operations
  // ============================================================================

  async createGist(options) {
    const { content, filename, description = '', public: isPublic = false } = options;

    try {
      // Write content to temp file
      const tempFile = `/tmp/gist-content-${Date.now()}.txt`;
      await fs.writeFile(tempFile, content);

      let cmd = `gh gist create "${tempFile}"`;

      if (isPublic) {
        cmd += ' --public';
      }

      if (description) {
        cmd += ` --desc "${description.replace(/"/g, '\\"')}"`;
      }

      cmd += ` --filename "${filename}"`;

      const result = await this.$(cmd);

      await fs.unlink(tempFile).catch(() => {});

      if (result.code === 0) {
        const gistUrl = result.stdout.toString().trim();
        const gistId = gistUrl.split('/').pop();

        // Get raw URL
        let rawUrl = gistUrl;
        try {
          const gistDetails = await this.$`gh api gists/${gistId} --jq '{owner: .owner.login, files: .files, history: .history}'`;
          if (gistDetails.code === 0) {
            const details = JSON.parse(gistDetails.stdout.toString());
            const commitSha = details.history?.[0]?.version;
            const fileNames = Object.keys(details.files || {});
            const actualFilename = fileNames[0] || filename;

            if (commitSha) {
              rawUrl = `https://gist.githubusercontent.com/${details.owner}/${gistId}/raw/${commitSha}/${actualFilename}`;
            }
          }
        } catch {
          // Use page URL as fallback
        }

        return {
          success: true,
          url: gistUrl,
          rawUrl,
          error: null
        };
      }

      return {
        success: false,
        url: null,
        rawUrl: null,
        error: result.stderr?.toString() || 'Failed to create gist'
      };
    } catch (error) {
      return {
        success: false,
        url: null,
        rawUrl: null,
        error: error.message
      };
    }
  }

  // ============================================================================
  // Rate Limiting
  // ============================================================================

  isRateLimitError(error) {
    const errorMessage = (error.message || error.toString()).toLowerCase();
    const rateLimitPatterns = [
      'rate limit',
      'secondary rate limit',
      'exceeded.*limit',
      'too many requests',
      'abuse detection',
      'wait a few minutes',
      'http 403.*rate',
      'api rate limit exceeded'
    ];

    return rateLimitPatterns.some(pattern => {
      return new RegExp(pattern).test(errorMessage);
    });
  }

  async getRateLimitStatus() {
    try {
      const result = await this.$`gh api rate_limit`;

      if (result.code === 0) {
        const data = JSON.parse(result.stdout.toString());
        const core = data.resources?.core || {};

        return {
          limit: core.limit || 0,
          remaining: core.remaining || 0,
          resetTime: core.reset ? new Date(core.reset * 1000) : null
        };
      }

      return { limit: 0, remaining: 0, resetTime: null };
    } catch {
      return { limit: 0, remaining: 0, resetTime: null };
    }
  }

  // ============================================================================
  // CLI Tool Helpers
  // ============================================================================

  async isCliAvailable() {
    if (this._cliChecked) {
      return this._cliAvailable;
    }

    try {
      const result = await this.$`gh --version`;
      this._cliAvailable = result.code === 0;
    } catch {
      this._cliAvailable = false;
    }

    this._cliChecked = true;
    return this._cliAvailable;
  }

  async executeCliCommand(command, _options = {}) {
    try {
      const result = await this.$(command);

      return {
        code: result.code || 0,
        stdout: result.stdout?.toString() || '',
        stderr: result.stderr?.toString() || '',
        data: null,
        output: (result.stdout?.toString() || '') + (result.stderr?.toString() || '')
      };
    } catch (error) {
      return {
        code: error.code || 1,
        stdout: error.stdout?.toString() || '',
        stderr: error.stderr?.toString() || error.message || '',
        data: null,
        output: (error.stdout?.toString() || '') + (error.stderr?.toString() || error.message || '')
      };
    }
  }
}

// Factory function for easy instantiation
export function createGitHubProvider(options = {}) {
  return new GitHubProvider(options);
}

export default GitHubProvider;
