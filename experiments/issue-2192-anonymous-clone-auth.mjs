#!/usr/bin/env node
/**
 * Issue #2192 — evidence that a git credential helper does NOT authenticate a
 * public clone, and that `http.<host>.extraheader` does.
 *
 * Background: a solve run died with `Reason: Repository setup failed` after
 * three clone attempts, each answered by GitHub with
 *
 *   fatal: remote error: GitHub is temporarily limiting some unauthenticated
 *   downloads to protect the stability of the platform. Please retry later or
 *   authenticate.
 *
 * ...even though `gh` was authenticated and `gh auth setup-git` had installed
 * `credential.https://github.com.helper = !gh auth git-credential`.
 *
 * git only consults a credential helper *after* the server answers 401.
 * github.com answers 200 for a public repository, so the clone is performed
 * anonymously and counted against GitHub's anonymous-download budget.
 *
 * This script clones a small public repository twice with `GIT_TRACE_CURL=1`
 * and counts the `Authorization` headers actually sent:
 *
 *   1. baseline (credential helper only)          -> expect 0
 *   2. with GIT_CONFIG_* extraheader injected     -> expect > 0
 *
 * Run:  node experiments/issue-2192-anonymous-clone-auth.mjs [owner/repo]
 * Requires: git >= 2.31 and a GitHub token (GH_TOKEN or `gh auth token`).
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildGitAuthConfigEnv, resolveGitHubToken } from '../src/git-auth-transport.lib.mjs';

const run = promisify(execFile);
const repo = process.argv[2] || 'link-assistant/hive-mind';

// Count `Authorization:` request headers in a GIT_TRACE_CURL log. Only the
// header *names* are examined; values are never printed.
const countAuthorizationHeaders = trace => (trace.match(/Send header: Authorization:/gi) || []).length;

const cloneWith = async (label, extraEnv) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'issue-2192-'));
  const target = path.join(dir, 'clone');
  const traceFile = path.join(dir, 'trace.log');
  try {
    await run('git', ['clone', '--depth', '1', `https://github.com/${repo}.git`, target], {
      env: { ...process.env, GIT_TRACE_CURL_NO_DATA: '1', GIT_TRACE_CURL: traceFile, ...extraEnv },
      maxBuffer: 64 * 1024 * 1024,
    });
    const trace = await readFile(traceFile, 'utf8').catch(() => '');
    console.log(`${label}: Authorization headers sent = ${countAuthorizationHeaders(trace)}`);
  } catch (error) {
    console.log(`${label}: clone failed - ${(error.stderr || error.message || '').toString().split('\n')[0]}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const { token, source } = await resolveGitHubToken({});
if (!token) {
  console.error('No GitHub token available (set GH_TOKEN or run `gh auth login`) - cannot run the authenticated half.');
  process.exit(1);
}
console.log(`Repository: ${repo}`);
console.log(`Token source: ${source}\n`);

await cloneWith('1. credential helper only (baseline)', {});
await cloneWith('2. GIT_CONFIG_* extraheader (the fix)', buildGitAuthConfigEnv({ token, env: process.env }));
