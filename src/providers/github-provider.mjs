/**
 * github-provider.mjs
 *
 * GitHub provider implementation that wraps existing GitHub functionality
 * from github.lib.mjs to conform to the RepositoryProvider interface.
 */

import { RepositoryProvider } from './provider.interface.mjs';

// Use command-stream for consistent $ behavior
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const { $ } = await use('command-stream');

// Import existing GitHub functions
import {
  parseGitHubUrl,
  normalizeGitHubUrl,
  checkRepositoryWritePermission,
  ghIssueView,
  ghPrView,
  detectRepositoryVisibility,
  checkGitHubPermissions
} from '../github.lib.mjs';

import { log } from '../lib.mjs';

/**
 * GitHub implementation of RepositoryProvider interface
 *
 * This wraps the existing GitHub CLI (`gh`) based functionality
 * to conform to the provider interface.
 */
export class GitHubProvider extends RepositoryProvider {
  constructor() {
    super();
  }

  getName() {
    return 'github';
  }

  parseUrl(url) {
    return parseGitHubUrl(url);
  }

  async checkRepositoryWritePermission(owner, repo, options = {}) {
    return await checkRepositoryWritePermission(owner, repo, options);
  }

  async getIssue(issueNumber, owner, repo, fields = ['number', 'title']) {
    const result = await ghIssueView({
      issueNumber,
      owner,
      repo,
      jsonFields: fields.join(',')
    });

    if (result.code !== 0 || !result.data) {
      throw new Error(`Failed to get issue #${issueNumber}: ${result.stderr || 'Unknown error'}`);
    }

    return result.data;
  }

  async getPullRequest(prNumber, owner, repo, fields = ['number', 'title', 'headRefName']) {
    const result = await ghPrView({
      prNumber,
      owner,
      repo,
      jsonFields: fields.join(',')
    });

    if (result.code !== 0 || !result.data) {
      throw new Error(`Failed to get PR #${prNumber}: ${result.stderr || 'Unknown error'}`);
    }

    return result.data;
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

    const draftFlag = draft ? '--draft' : '';
    const cmd = `gh pr create --repo ${owner}/${repo} --head ${head} --base ${base} --title "${title}" --body "${body}" ${draftFlag}`.trim();

    const result = await $(cmd);

    if (result.code !== 0) {
      throw new Error(`Failed to create PR: ${result.stderr?.toString() || 'Unknown error'}`);
    }

    // Extract PR URL from output
    const prUrl = result.stdout.toString().trim();

    // Extract PR number from URL
    const match = prUrl.match(/\/pull\/(\d+)/);
    const prNumber = match ? parseInt(match[1]) : null;

    return {
      url: prUrl,
      number: prNumber
    };
  }

  async addComment(targetType, targetNumber, owner, repo, body) {
    const ghCommand = targetType === 'pr' ? 'pr' : 'issue';

    // Write body to temp file to avoid shell escaping issues
    const fs = (await use('fs')).promises;
    const tempFile = `/tmp/comment-${targetType}-${Date.now()}.md`;
    await fs.writeFile(tempFile, body);

    try {
      const result = await $`gh ${ghCommand} comment ${targetNumber} --repo ${owner}/${repo} --body-file "${tempFile}"`;

      if (result.code !== 0) {
        throw new Error(`Failed to add comment: ${result.stderr?.toString() || 'Unknown error'}`);
      }

      return {
        success: true
      };
    } finally {
      await fs.unlink(tempFile).catch(() => {});
    }
  }

  async getComments(targetType, targetNumber, owner, repo, since = null) {
    const ghCommand = targetType === 'pr' ? 'pr' : 'issue';
    const result = await $`gh ${ghCommand} view ${targetNumber} --repo ${owner}/${repo} --json comments`;

    if (result.code !== 0) {
      throw new Error(`Failed to get comments: ${result.stderr?.toString() || 'Unknown error'}`);
    }

    const data = JSON.parse(result.stdout.toString());
    let comments = data.comments || [];

    // Filter by date if since is provided
    if (since) {
      comments = comments.filter(comment => new Date(comment.createdAt) > since);
    }

    return comments;
  }

  async forkRepository(owner, repo) {
    const result = await $`gh repo fork ${owner}/${repo} --clone=false`;

    if (result.code !== 0) {
      throw new Error(`Failed to fork repository: ${result.stderr?.toString() || 'Unknown error'}`);
    }

    // Extract forked repo info from output
    const output = result.stdout.toString();
    const match = output.match(/Created fork ([^/]+)\/([^\s]+)/);

    if (!match) {
      throw new Error('Failed to parse fork output');
    }

    return {
      owner: match[1],
      repo: match[2],
      fullName: `${match[1]}/${match[2]}`
    };
  }

  async getCloneUrl(owner, repo, options = {}) {
    const useSSH = options.useSSH || false;

    if (useSSH) {
      return `git@github.com:${owner}/${repo}.git`;
    } else {
      return `https://github.com/${owner}/${repo}.git`;
    }
  }

  async detectRepositoryVisibility(owner, repo) {
    return await detectRepositoryVisibility(owner, repo);
  }

  async listIssues(owner, repo, options = {}) {
    const {
      state = 'open',
      labels = [],
      limit = 100
    } = options;

    let cmd = `gh issue list --repo ${owner}/${repo} --state ${state} --limit ${limit} --json url,title,number,createdAt,labels`;

    if (labels.length > 0) {
      const labelArgs = labels.map(l => `--label "${l}"`).join(' ');
      cmd += ` ${labelArgs}`;
    }

    const result = await $(cmd);

    if (result.code !== 0) {
      throw new Error(`Failed to list issues: ${result.stderr?.toString() || 'Unknown error'}`);
    }

    return JSON.parse(result.stdout.toString() || '[]');
  }

  async listPullRequests(owner, repo, options = {}) {
    const {
      state = 'open',
      limit = 100
    } = options;

    const cmd = `gh pr list --repo ${owner}/${repo} --state ${state} --limit ${limit} --json url,title,number,createdAt,headRefName`;

    const result = await $(cmd);

    if (result.code !== 0) {
      throw new Error(`Failed to list PRs: ${result.stderr?.toString() || 'Unknown error'}`);
    }

    return JSON.parse(result.stdout.toString() || '[]');
  }

  async checkAuthentication() {
    return await checkGitHubPermissions();
  }
}

export default GitHubProvider;
