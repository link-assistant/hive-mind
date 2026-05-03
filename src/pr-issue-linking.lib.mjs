#!/usr/bin/env node

/**
 * Helpers for preserving GitHub issue-closing links in pull request bodies.
 */

import { hasGitHubLinkingKeyword } from './github-linking.lib.mjs';

/**
 * Build the issue reference text to use in a GitHub closing keyword.
 *
 * @param {Object} options
 * @param {string|number} options.issueNumber
 * @param {string|null} [options.owner]
 * @param {string|null} [options.repo]
 * @param {boolean} [options.fork]
 * @returns {string}
 */
export function buildIssueReference({ issueNumber, owner = null, repo = null, fork = false } = {}) {
  if (!issueNumber) {
    return '';
  }

  if (fork && owner && repo) {
    return `${owner}/${repo}#${issueNumber}`;
  }

  return `#${issueNumber}`;
}

/**
 * Ensure a pull request body has a GitHub-recognized closing keyword for the issue.
 *
 * @param {string|null|undefined} prBody
 * @param {Object} options
 * @param {string|number} options.issueNumber
 * @param {string|null} [options.owner]
 * @param {string|null} [options.repo]
 * @param {boolean} [options.fork]
 * @returns {{body: string, updated: boolean, issueRef: string}}
 */
export function ensureIssueLinkInPullRequestBody(prBody, { issueNumber, owner = null, repo = null, fork = false } = {}) {
  const body = prBody ?? '';
  const issueRef = buildIssueReference({ issueNumber, owner, repo, fork });

  if (!issueNumber) {
    return { body, updated: false, issueRef };
  }

  const hasLinkingKeyword = hasGitHubLinkingKeyword(body, issueNumber, owner, repo);
  if (hasLinkingKeyword) {
    return { body, updated: false, issueRef };
  }

  const separator = body.length > 0 ? '\n\n' : '';
  return {
    body: `${body}${separator}Fixes ${issueRef}`,
    updated: true,
    issueRef,
  };
}

/**
 * Parse GraphQL closingIssuesReferences stdout into issue number strings.
 *
 * @param {string|Buffer|null|undefined} output
 * @returns {string[]}
 */
export function parseClosingIssueNumbers(output) {
  return String(output ?? '')
    .trim()
    .split('\n')
    .map(value => value.trim())
    .filter(Boolean);
}

/**
 * Check whether parsed closing issue numbers contain the requested issue number.
 *
 * @param {Array<string|number>} linkedIssues
 * @param {string|number} issueNumber
 * @returns {boolean}
 */
export function closingIssueNumbersContain(linkedIssues, issueNumber) {
  if (!issueNumber || !Array.isArray(linkedIssues)) {
    return false;
  }

  const expectedIssueNumber = String(issueNumber);
  return linkedIssues.map(value => String(value).trim()).includes(expectedIssueNumber);
}
