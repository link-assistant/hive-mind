import { execFile as execFileCallback, spawn } from 'node:child_process';
import { promisify } from 'node:util';

import { parseGitHubUrl } from './github-url-parser.lib.mjs';
import { ghWithRateLimitRetry } from './github-rate-limit.lib.mjs';

const execFile = promisify(execFileCallback);
const WRITE_PERMISSIONS = new Set(['ADMIN', 'MAINTAIN', 'WRITE', 'TRIAGE']);
const LABEL_PAGE_INFO = Symbol('labelPageInfo');

function runGhCommand(command, args, options = {}) {
  if (options.input === undefined) return execFile(command, args, options);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: options.env, cwd: options.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const maxBuffer = options.maxBuffer || 16 * 1024 * 1024;
    child.stdout.setEncoding(options.encoding || 'utf8');
    child.stderr.setEncoding(options.encoding || 'utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (stdout.length > maxBuffer) child.kill('SIGTERM');
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
      if (stderr.length > maxBuffer) child.kill('SIGTERM');
    });
    child.once('error', reject);
    child.once('close', code => {
      if (code === 0) resolve({ stdout, stderr });
      else {
        const error = Object.assign(new Error(`gh exited with code ${code}`), { code, stdout, stderr });
        reject(error);
      }
    });
    child.stdin.end(options.input);
  });
}

const REPOSITORY_QUERY = `query($owner:String!,$repo:String!){
  repository(owner:$owner,name:$repo){
    id nameWithOwner url description viewerPermission
    owner { __typename login }
  }
}`;

const LABELS_QUERY = `query($owner:String!,$repo:String!,$after:String){
  repository(owner:$owner,name:$repo){ labels(first:100,after:$after){
    nodes { id name description color }
    pageInfo { hasNextPage endCursor }
  } }
}`;

const ISSUE_TYPES_QUERY = `query($login:String!,$after:String){
  organization(login:$login){ issueTypes(first:100,after:$after){
    nodes { id name description isEnabled }
    pageInfo { hasNextPage endCursor }
  } }
}`;

const OPEN_ISSUES_QUERY = `query($owner:String!,$repo:String!,$after:String){
  repository(owner:$owner,name:$repo){ issues(first:100,after:$after,states:OPEN,orderBy:{field:CREATED_AT,direction:ASC}){
    nodes {
      id number title body url updatedAt
      issueType { id name description }
      labels(first:100){ nodes { id name description color } }
    }
    pageInfo { hasNextPage endCursor }
  } }
}`;

const ISSUE_QUERY = `query($owner:String!,$repo:String!,$number:Int!){
  repository(owner:$owner,name:$repo){ issue(number:$number){
    id number title body url updatedAt state
    issueType { id name description }
    labels(first:100){ nodes { id name description color } }
  } }
}`;

const ISSUE_LABELS_QUERY = `query($owner:String!,$repo:String!,$number:Int!,$after:String){
  repository(owner:$owner,name:$repo){ issue(number:$number){ updatedAt labels(first:100,after:$after){
    nodes { id name description color }
    pageInfo { hasNextPage endCursor }
  } } }
}`;

const COMMENTS_QUERY = `query($owner:String!,$repo:String!,$number:Int!,$after:String){
  repository(owner:$owner,name:$repo){ issue(number:$number){ comments(first:100,after:$after){
    nodes { id url body createdAt updatedAt author { login } }
    pageInfo { hasNextPage endCursor }
  } } }
}`;

const LINKED_PULLS_QUERY = `query($owner:String!,$repo:String!,$number:Int!,$after:String){
  repository(owner:$owner,name:$repo){ issue(number:$number){ timelineItems(first:100,after:$after,itemTypes:[CROSS_REFERENCED_EVENT]){
    nodes { ... on CrossReferencedEvent { source {
      __typename
      ... on PullRequest { id number title body url state mergedAt repository { nameWithOwner } }
    } } }
    pageInfo { hasNextPage endCursor }
  } } }
}`;

const UPDATE_LABELS = `mutation($id:ID!,$labelIds:[ID!]){ updateIssue(input:{id:$id,labelIds:$labelIds}){ issue { id updatedAt } } }`;
const UPDATE_TYPE = `mutation($id:ID!,$issueTypeId:ID!){ updateIssue(input:{id:$id,issueTypeId:$issueTypeId}){ issue { id updatedAt } } }`;
const UPDATE_TYPE_AND_LABELS = `mutation($id:ID!,$issueTypeId:ID!,$labelIds:[ID!]){ updateIssue(input:{id:$id,issueTypeId:$issueTypeId,labelIds:$labelIds}){ issue { id updatedAt } } }`;

function normalizeIssue(issue) {
  if (!issue) return null;
  const connection = issue.labels;
  const normalized = { ...issue, labels: connection?.nodes || connection || [] };
  Object.defineProperty(normalized, LABEL_PAGE_INFO, { value: connection?.pageInfo || null, writable: true });
  return normalized;
}

function parseRepositoryUrl(repositoryUrl) {
  const parsed = parseGitHubUrl(repositoryUrl);
  if (!parsed.valid || parsed.type !== 'repo' || !parsed.owner || !parsed.repo) throw new Error('A GitHub repository URL is required (for example, https://github.com/owner/repository)');
  return { owner: parsed.owner, repo: parsed.repo, fullName: `${parsed.owner}/${parsed.repo}`, url: `https://github.com/${parsed.owner}/${parsed.repo}` };
}

/** GitHub metadata-only adapter used by the organizer. */
export class OrganizationGitHubClient {
  constructor({ repositoryUrl, run = runGhCommand, log = console.warn } = {}) {
    this.repository = parseRepositoryUrl(repositoryUrl);
    this.run = run;
    this.log = log;
  }

  async runGraphql(query, variables = {}, label = 'organize GraphQL') {
    const args = ['api', 'graphql', '-f', `query=${query}`];
    for (const [key, value] of Object.entries(variables)) {
      if (value !== null && value !== undefined) args.push(typeof value === 'number' ? '-F' : '-f', `${key}=${value}`);
    }
    const result = await ghWithRateLimitRetry(() => this.run('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }), { label, log: this.log });
    const payload = JSON.parse(result.stdout);
    if (payload.errors?.length) throw new Error(payload.errors.map(error => error.message).join('; '));
    return payload.data;
  }

  async inspectRepository() {
    const { owner, repo } = this.repository;
    const data = await this.runGraphql(REPOSITORY_QUERY, { owner, repo }, `inspect ${owner}/${repo}`);
    const record = data.repository;
    if (!record) throw new Error(`Repository ${owner}/${repo} was not found or is not readable`);
    if (!WRITE_PERMISSIONS.has(record.viewerPermission)) throw new Error(`Authenticated GitHub user cannot update issue metadata in ${owner}/${repo} (permission: ${record.viewerPermission || 'none'})`);

    let readme = '';
    try {
      const result = await ghWithRateLimitRetry(() => this.run('gh', ['api', `repos/${owner}/${repo}/readme`, '-H', 'Accept: application/vnd.github.raw+json'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }), { label: `README ${owner}/${repo}`, log: this.log });
      readme = result.stdout;
    } catch (error) {
      if (!/404|not found/i.test(`${error?.stderr || ''} ${error?.message || ''}`)) throw error;
    }

    this.repository = {
      ...this.repository,
      id: record.id,
      description: record.description || '',
      readme,
      ownerType: record.owner.__typename,
      viewerPermission: record.viewerPermission,
    };
    return this.repository;
  }

  async fetchTaxonomy() {
    const labels = [];
    let after = null;
    do {
      const data = await this.runGraphql(LABELS_QUERY, { owner: this.repository.owner, repo: this.repository.repo, after }, `labels ${this.repository.fullName}`);
      const page = data.repository.labels;
      labels.push(...page.nodes);
      after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (after);

    const issueTypes = [];
    if (this.repository.ownerType === 'Organization') {
      after = null;
      do {
        const data = await this.runGraphql(ISSUE_TYPES_QUERY, { login: this.repository.owner, after }, `issue types ${this.repository.owner}`);
        const page = data.organization?.issueTypes;
        if (!page) break;
        issueTypes.push(...page.nodes.filter(type => type.isEnabled !== false));
        after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
      } while (after);
    }
    return { issueTypes, labels };
  }

  async fetchIssueComments(number) {
    const comments = [];
    let after = null;
    do {
      const data = await this.runGraphql(COMMENTS_QUERY, { owner: this.repository.owner, repo: this.repository.repo, number, after }, `comments ${this.repository.fullName}#${number}`);
      const page = data.repository.issue?.comments;
      if (!page) return comments;
      comments.push(...page.nodes.map(comment => ({ ...comment, author: comment.author?.login || null })));
      after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (after);
    return comments;
  }

  async fetchLinkedPullRequests(number) {
    const pulls = new Map();
    let after = null;
    do {
      const data = await this.runGraphql(LINKED_PULLS_QUERY, { owner: this.repository.owner, repo: this.repository.repo, number, after }, `linked pull requests ${this.repository.fullName}#${number}`);
      const page = data.repository.issue?.timelineItems;
      if (!page) return [...pulls.values()];
      for (const node of page.nodes) {
        const source = node?.source;
        if (source?.__typename === 'PullRequest') pulls.set(source.id, { ...source, repository: source.repository?.nameWithOwner || null });
      }
      after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (after);
    return [...pulls.values()];
  }

  async completeIssueLabels(issue) {
    let pageInfo = issue?.[LABEL_PAGE_INFO];
    while (pageInfo?.hasNextPage) {
      const data = await this.runGraphql(ISSUE_LABELS_QUERY, { owner: this.repository.owner, repo: this.repository.repo, number: issue.number, after: pageInfo.endCursor }, `issue labels ${this.repository.fullName}#${issue.number}`);
      const record = data.repository.issue;
      if (!record) return issue;
      issue.labels.push(...record.labels.nodes);
      issue.updatedAt = record.updatedAt || issue.updatedAt;
      pageInfo = record.labels.pageInfo;
    }
    return issue;
  }

  async fetchOpenIssues({ withContext = true } = {}) {
    const issues = [];
    let after = null;
    do {
      const data = await this.runGraphql(OPEN_ISSUES_QUERY, { owner: this.repository.owner, repo: this.repository.repo, after }, `open issues ${this.repository.fullName}`);
      const page = data.repository.issues;
      issues.push(...page.nodes.map(normalizeIssue));
      after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (after);

    const concurrency = 5;
    for (let offset = 0; offset < issues.length; offset += concurrency) {
      await Promise.all(issues.slice(offset, offset + concurrency).map(issue => this.completeIssueLabels(issue)));
    }

    if (!withContext) return issues;
    for (let offset = 0; offset < issues.length; offset += concurrency) {
      await Promise.all(
        issues.slice(offset, offset + concurrency).map(async issue => {
          [issue.comments, issue.linkedPullRequests] = await Promise.all([this.fetchIssueComments(issue.number), this.fetchLinkedPullRequests(issue.number)]);
        })
      );
    }
    return issues;
  }

  async fetchIssue(number) {
    const data = await this.runGraphql(ISSUE_QUERY, { owner: this.repository.owner, repo: this.repository.repo, number }, `refresh ${this.repository.fullName}#${number}`);
    const issue = normalizeIssue(data.repository.issue);
    if (issue?.state !== 'OPEN') return null;
    return this.completeIssueLabels(issue);
  }

  async updateIssue(_number, diff, currentIssue) {
    const currentLabelIds = new Set((currentIssue.labels || []).map(label => label.id));
    for (const label of diff.removeLabels) currentLabelIds.delete(label.id);
    for (const label of diff.addLabels) currentLabelIds.add(label.id);
    const labelsChanged = diff.addLabels.length > 0 || diff.removeLabels.length > 0;
    const variables = { id: currentIssue.id };
    let mutation;
    if (diff.type && labelsChanged) {
      mutation = UPDATE_TYPE_AND_LABELS;
      variables.issueTypeId = diff.type.id;
      variables.labelIds = [...currentLabelIds];
    } else if (diff.type) {
      mutation = UPDATE_TYPE;
      variables.issueTypeId = diff.type.id;
    } else if (labelsChanged) {
      mutation = UPDATE_LABELS;
      variables.labelIds = [...currentLabelIds];
    } else {
      return currentIssue;
    }

    // Arrays cannot be encoded reliably with repeated `gh -F` flags, so use
    // one JSON variables object over stdin through `gh api graphql`.
    const input = JSON.stringify({ query: mutation, variables });
    const result = await ghWithRateLimitRetry(() => this.run('gh', ['api', 'graphql', '--input', '-'], { input, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }), { label: `update ${this.repository.fullName}#${currentIssue.number}`, log: this.log });
    const payload = JSON.parse(result.stdout);
    if (payload.errors?.length) throw new Error(payload.errors.map(error => error.message).join('; '));
    return payload.data?.updateIssue?.issue || null;
  }
}

export function createOrganizationGitHubClient(options) {
  return new OrganizationGitHubClient(options);
}

export { parseRepositoryUrl as parseOrganizationRepositoryUrl };
