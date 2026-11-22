import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { wrapDollarWithGhRetry } from './github-rate-limit.lib.mjs';
import { forEachSanitizedLogBlock } from './log-sanitize-stream.lib.mjs';
import { describeCredentialSanitizationFailure } from './token-sanitization.lib.mjs';

// Bound both the Git blob and the base64 request well below GitHub's file limit.
export const BRANCH_LOG_MAX_PART_BYTES = 16 * 1024 * 1024;

const validOid = value => /^[a-f\d]{40}$/i.test(value || '');
const validRepository = value => /^[\w.-]+\/[\w.-]+$/.test(value || '');
const encodePath = value => value.split('/').map(encodeURIComponent).join('/');
const output = result => result.stdout?.toString().trim() || '';
const json = result => (result.code === 0 ? JSON.parse(output(result)) : null);
const quiet = { mirror: false, capture: true };

const CREATE_COMMIT = `mutation ($input: CreateCommitOnBranchInput!) {
  createCommitOnBranch(input: $input) { commit { oid } }
}`;

async function resolvePullRequestHead({ command, repository, targetNumber, checkout }) {
  const pr = json(await command`gh api repos/${repository}/pulls/${targetNumber} --jq '{head, base: {ref: .base.ref, visibility: .base.repo.visibility}}'`);
  const head = pr?.head;
  const headRepository = head?.repo?.full_name;
  const branch = head?.ref;
  if (!validRepository(headRepository) || !validOid(head?.sha) || !branch || [pr.base?.ref, head.repo.default_branch, 'main', 'master'].includes(branch)) {
    throw new Error('Could not verify a safe pull request head');
  }
  if (repository.toLowerCase() !== headRepository.toLowerCase() && (!pr.base?.visibility || head.repo.visibility !== pr.base.visibility)) {
    throw new Error('The pull request head repository does not match the target visibility');
  }
  if (checkout) {
    const local = await checkout`git branch --show-current`;
    if (local.code !== 0 || output(local) !== branch) throw new Error('Checkout does not match the pull request head');
    const origin = await checkout`git remote get-url --push origin`;
    const remoteRepository = output(origin).match(/^(?:https:\/\/(?:[^/@]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+\/[^/]+?)(?:\.git)?$/)?.[1];
    if (origin.code !== 0 || remoteRepository?.toLowerCase() !== headRepository.toLowerCase()) throw new Error('Origin does not match the pull request head repository');
  }
  const issue = branch.match(/^issue-(\d+)-/)?.[1] || 'unknown';
  return { repository: headRepository, branch, oid: head.sha, directory: `dev/log/issues/${issue}/pulls/${targetNumber}` };
}

async function resolveIssueBranch({ command, api, repository, targetNumber, publicationId }) {
  const issue = json(await command`gh api repos/${repository}/issues/${targetNumber} --jq '{number, isPullRequest: has("pull_request")}'`);
  if (String(issue?.number) !== targetNumber || issue.isPullRequest) throw new Error('Could not verify the issue');
  const info = await command`gh api repos/${repository} --jq .default_branch`;
  const defaultBranch = output(info);
  if (info.code !== 0 || !defaultBranch) throw new Error('Could not find the issue repository default branch');
  const base = await command`gh api repos/${repository}/git/ref/heads/${encodePath(defaultBranch)} --jq .object.sha`;
  const oid = output(base);
  if (base.code !== 0 || !validOid(oid)) throw new Error('Could not read an existing commit to start the issue log branch');
  const branch = `hive-mind/logs/issue-${targetNumber}/${publicationId}`;
  return {
    repository,
    branch,
    oid,
    directory: `dev/log/issues/${targetNumber}`,
    create: async () => {
      const ref = `refs/heads/${branch}`;
      const endpoint = `repos/${repository}/git/refs`;
      const created = await api({ ref, sha: oid })`gh api ${endpoint} -X POST --input - --jq .ref`;
      if (created.code === 0 && output(created) === ref) return;
      // The branch can exist if GitHub received the request but its response was lost.
      const current = await command`gh api repos/${repository}/git/ref/heads/${encodePath(branch)} --jq .object.sha`;
      if (current.code !== 0 || output(current) !== oid) throw new Error('Could not create the issue log branch');
    },
  };
}

const partName = number => `solve.log.part-${String(number).padStart(9, '0')}.txt`;
const fileLink = (repository, oid, file, view = 'blob') => `https://github.com/${repository}/${view}/${oid}/${encodePath(file)}`;

async function streamLogParts({ logFile, needsSanitization, partSizeBytes, publishPart }) {
  const buffer = Buffer.allocUnsafe(partSizeBytes);
  let length = 0;
  let count = 0;
  const consume = async chunk => {
    let offset = 0;
    while (offset < chunk.length) {
      if (length === buffer.length) {
        let end = length;
        // The next byte tells us whether we filled the buffer inside a code point.
        if ((chunk[offset] & 0xc0) === 0x80) {
          do end--;
          while (end > length - 4 && (buffer[end] & 0xc0) === 0x80);
          if (end === length - 4) throw new Error('Invalid UTF-8 in the sanitized log');
        }
        await publishPart(partName(++count), buffer.subarray(0, end));
        buffer.copyWithin(0, end, length);
        length -= end;
      }
      const bytes = Math.min(chunk.length - offset, buffer.length - length);
      chunk.copy(buffer, length, offset, offset + bytes);
      length += bytes;
      offset += bytes;
    }
  };

  if (needsSanitization) {
    await forEachSanitizedLogBlock(logFile, text => consume(Buffer.from(text, 'utf8')));
  } else {
    for await (const chunk of createReadStream(logFile)) await consume(chunk);
  }
  await publishPart(count ? partName(count + 1) : 'solve.log', buffer.subarray(0, length));
}

/** Publish one bounded, sanitized blob at a time without a checkout or a second disk copy. */
export async function publishLogToBranch({ logFile, needsSanitization = false, repositoryPath, owner, repo, targetNumber, targetType, $, log, partSizeBytes = BRANCH_LOG_MAX_PART_BYTES }) {
  const parts = [];
  let destination;
  try {
    if (!['pr', 'issue'].includes(targetType) || !/^[1-9]\d*$/.test(String(targetNumber))) throw new Error('Invalid branch log target');
    if (!Number.isInteger(partSizeBytes) || partSizeBytes < 4 || partSizeBytes > BRANCH_LOG_MAX_PART_BYTES) throw new Error('Invalid branch log part size');
    const repository = `${owner}/${repo}`;
    if (!validRepository(repository)) throw new Error('Invalid log repository');
    const safeDollar = wrapDollarWithGhRetry($);
    const command = safeDollar(quiet);
    const api = body => safeDollar({ ...quiet, stdin: JSON.stringify(body) });
    const publicationId = randomUUID();
    const target = { command, api, repository, targetNumber: String(targetNumber), publicationId };
    const head = targetType === 'issue' ? await resolveIssueBranch(target) : await resolvePullRequestHead({ ...target, checkout: repositoryPath && safeDollar({ ...quiet, cwd: repositoryPath }) });
    const branch = { repositoryNameWithOwner: head.repository, branchName: head.branch };
    const directory = `${head.directory}/attachments/${publicationId}`;
    destination = { repository: head.repository, branch: head.branch };
    let oid = head.oid;
    await log?.(`  🧾 Publishing the sanitized log to ${head.repository} branch ${head.branch}`);

    const commit = async (name, bytes) => {
      const file = `${directory}/${name}`;
      const previous = oid;
      const input = {
        branch,
        expectedHeadOid: previous,
        message: { headline: `Attach session log ${name}` },
        fileChanges: { additions: [{ path: file, contents: bytes.toString('base64') }] },
      };
      const response = await api({ query: CREATE_COMMIT, variables: { input } })`gh api graphql --input - --jq .data.createCommitOnBranch.commit.oid`;
      if (response.code === 0 && validOid(output(response))) {
        oid = output(response);
      } else {
        // A lost reply is safe to retry: expectedHeadOid keeps the same request
        // from changing the branch twice. Verify the exact blob before counting it.
        const current = await command`gh api repos/${head.repository}/git/ref/heads/${encodePath(head.branch)} --jq .object.sha`;
        const actual = output(current);
        if (current.code !== 0 || !validOid(actual) || actual === previous) throw new Error(`GitHub did not commit ${name}`);
        const path = `repos/${head.repository}/contents/${encodePath(file)}?ref=${actual}`;
        const stored = await command`gh api ${path} --jq .sha`;
        const hash = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
        if (stored.code !== 0 || output(stored) !== hash) throw new Error(`Could not verify ${name} after the log branch moved`);
        oid = actual;
      }
      return file;
    };

    const publishPart = async (name, bytes) => {
      if (parts.length === 0) await head.create?.();
      const file = await commit(name, bytes);
      const url = fileLink(head.repository, oid, file);
      destination.url = `https://github.com/${head.repository}/tree/${oid}/${encodePath(directory)}`;
      parts.push({ name, bytes: bytes.length, url, rawUrl: fileLink(head.repository, oid, file, 'raw'), type: 'repository' });
      await log?.(`  📎 Published ${name} (${bytes.length} bytes)`, { verbose: true });
    };
    await streamLogParts({ logFile, needsSanitization, partSizeBytes, publishPart });

    let indexUrl;
    if (parts.length > 1) {
      const links = parts.map(part => `- [${part.name}](${part.name}) (${part.bytes} bytes)`).join('\n');
      const index = `# Session log\n\nDownload the parts below and concatenate them in order to recover the full sanitized log.\n\n\`\`\`sh\ncat solve.log.part-*.txt > solve.log\n\`\`\`\n\n${links}\n`;
      const file = await commit('README.md', Buffer.from(index, 'utf8'));
      indexUrl = fileLink(head.repository, oid, file);
    }
    const url = indexUrl || parts[0].url;
    return { success: true, type: 'repository', url, rawUrl: indexUrl || parts[0].rawUrl, indexUrl, destination, chunks: parts.length, parts };
  } catch (error) {
    return { success: false, failureReason: describeCredentialSanitizationFailure(error), destination, publishedParts: parts };
  }
}

export const publishLogToPullRequestBranch = ({ prNumber, ...options }) => publishLogToBranch({ ...options, targetNumber: prNumber, targetType: 'pr' });
