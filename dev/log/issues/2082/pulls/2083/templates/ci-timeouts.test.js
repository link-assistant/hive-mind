import { describe, it, expect } from 'test-anywhere';
import { readFileSync } from 'node:fs';

const releaseWorkflow = readWorkflow('.github/workflows/release.yml');
const linksWorkflow = readWorkflow('.github/workflows/links.yml');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

function readWorkflow(filePath) {
  return readFileSync(filePath, 'utf8').replaceAll('\r\n', '\n');
}

function normalizeNewlines(text) {
  return text.replaceAll('\r\n', '\n');
}

function listWorkflowJobs(workflow) {
  const normalizedWorkflow = normalizeNewlines(workflow);
  const jobsStart = normalizedWorkflow.indexOf('\njobs:\n');
  const jobsBody = jobsStart === -1 ? '' : normalizedWorkflow.slice(jobsStart);
  const matches = jobsBody.matchAll(/^[ ]{2}([a-zA-Z0-9_-]+):\s*$/gm);

  return Array.from(matches, match => match[1]);
}

function getJobBlock(workflow, jobName) {
  const lines = normalizeNewlines(workflow).split('\n');
  const jobHeader = `  ${jobName}:`;
  const start = lines.findIndex(line => line === jobHeader);

  if (start === -1) {
    return '';
  }

  const end = lines.findIndex((line, index) => index > start && /^[ ]{2}[a-zA-Z0-9_-]+:\s*$/.test(line));

  return lines.slice(start, end === -1 ? lines.length : end).join('\n');
}

function getTimeoutMinutes(workflow, jobName) {
  const block = getJobBlock(workflow, jobName);
  const timeout = block.match(/^[ ]{4}timeout-minutes:\s*(\d+)\s*$/m);

  return timeout ? Number(timeout[1]) : undefined;
}

describe('CI timeout policy', () => {
  it('sets timeout-minutes for every release workflow job', () => {
    const expectedTimeouts = {
      'detect-changes': 5,
      'test-compilation': 5,
      'check-file-line-limits': 5,
      'version-check': 5,
      'changeset-check': 10,
      lint: 10,
      test: 10,
      'validate-docs': 5,
      release: 30,
      'instant-release': 30,
      'docker-publish': 30,
      'changeset-pr': 10,
    };

    expect(listWorkflowJobs(releaseWorkflow).sort()).toEqual(Object.keys(expectedTimeouts).sort());

    for (const [jobName, timeout] of Object.entries(expectedTimeouts)) {
      expect(getTimeoutMinutes(releaseWorkflow, jobName)).toBe(timeout);
    }
  });

  it('sets timeout-minutes for every link workflow job', () => {
    expect(listWorkflowJobs(linksWorkflow)).toEqual(['link-checker']);
    expect(getTimeoutMinutes(linksWorkflow, 'link-checker')).toBe(10);
  });

  it('parses workflow files checked out with Windows line endings', () => {
    const crlfWorkflow = ['name: CRLF fixture', '', 'jobs:', '  first-job:', '    timeout-minutes: 5', '  second-job:', '    timeout-minutes: 10', ''].join('\r\n');

    expect(listWorkflowJobs(crlfWorkflow)).toEqual(['first-job', 'second-job']);
    expect(getTimeoutMinutes(crlfWorkflow, 'second-job')).toBe(10);
  });

  it('caps individual Node.js and Bun tests at 30 seconds', () => {
    expect(packageJson.scripts.test).toBe('node --test --test-timeout=30000 tests/*.test.js');
    expect(releaseWorkflow).toContain('run: bun test --timeout 30000');
  });
});
