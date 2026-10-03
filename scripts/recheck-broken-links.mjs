#!/usr/bin/env node

/**
 * Re-check links that lychee reported with a transient failure.
 *
 * A 429, a 5xx or a connection-level failure (ERROR / TIMEOUT) is the host
 * saying "not now", not "this link is broken". github.com in particular
 * answers bursts of blob-page requests from a shared runner IP with
 * `503 Service Unavailable` (issue #2423: 32 such "errors" turned the main
 * branch red while every URL was healthy). lychee's own --max-retries fires
 * within seconds, too soon for that throttle to lift, and never retries a
 * connect-phase failure (lycheeverse/lychee#2297).
 *
 * This script asks those URLs again, sequentially and with backoff, and for
 * github.com blob/tree pages falls back to the authenticated contents API. A 4xx
 * other than 429 is a definite answer and stays final, as does any error
 * that is not an http(s) URL (missing local file, ...).
 *
 * Environment variables:
 *   - LYCHEE_OUTPUT: lychee markdown report (default: lychee/out.md)
 *   - RECOVERED_OUTPUT: file receiving one recovered URL per line
 *   - RECHECK_DELAYS_MS: comma-separated backoff delays (default 5000,15000,30000)
 *   - RECHECK_VERBOSE: 'true' to log every attempt (off by default)
 *   - GITHUB_TOKEN: authenticates the GitHub contents API fallback
 *
 * GitHub Actions outputs:
 *   - all_recovered: 'true' when every reported error turned out healthy
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { extractErrorsSection } from './check-web-archive.mjs';

const verbose = process.env.RECHECK_VERBOSE === 'true';

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
  console.log(`${name}=${value}`);
}

/**
 * Whether a lychee status marker denotes a transient failure worth retrying.
 * @param {string} status - The bracketed marker, e.g. '503', 'ERROR'
 * @returns {boolean}
 */
export function isTransientStatus(status) {
  return status === '429' || /^5\d\d$/.test(status) || status === 'ERROR' || status === 'TIMEOUT';
}

/**
 * Parse the errors of a lychee markdown report.
 * @param {string} content - lychee markdown report
 * @returns {{transient: string[], final: string[]}} Unique http(s) URLs worth
 *   re-checking, and every other broken link (kept broken)
 */
export function classifyBrokenLinks(content) {
  const section = extractErrorsSection(content);
  const transient = new Set();
  const final = new Set();
  const entryPattern = /^\s*(?:\*|-)\s+\[(4\d\d|5\d\d|ERROR|TIMEOUT|UNKNOWN)\]\s+<?([^\s>|)]+)>?/gim;
  let match;
  while ((match = entryPattern.exec(section)) !== null) {
    const link = match[2].trim().replace(/[.,;!?]+$/, '');
    if (!link) continue;
    if (/^https?:\/\//i.test(link) && isTransientStatus(match[1].toUpperCase())) {
      transient.add(link);
    } else {
      final.add(link);
    }
  }
  // A URL that failed definitively anywhere stays broken.
  for (const link of final) transient.delete(link);
  return { transient: [...transient], final: [...final] };
}

const sleep = ms => new Promise(resolve => globalThis.setTimeout(resolve, ms));

/**
 * Request a URL, retrying transient answers with backoff.
 * @param {string} url
 * @param {number[]} delays - wait before each retry
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<{ok: boolean, status: string}>}
 */
export async function recheckUrl(url, delays, fetchImpl = fetch) {
  let status = 'ERROR';
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) await sleep(delays[attempt - 1]);
    try {
      const response = await fetchImpl(url, {
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; broken-link-recheck/1.0; GitHub Actions CI)' },
        signal: AbortSignal.timeout(30000),
      });
      status = String(response.status);
      if (verbose) console.log(`  attempt ${attempt + 1}: ${status}`);
      if (response.ok) return { ok: true, status };
      if (!isTransientStatus(status)) return { ok: false, status };
    } catch (error) {
      status = 'ERROR';
      if (verbose) console.log(`  attempt ${attempt + 1}: ${error.message}`);
    }
  }
  return { ok: false, status };
}

/**
 * Map a github.com blob/tree page to its REST contents endpoint. The API is
 * authoritative, authenticated with GITHUB_TOKEN and not subject to the
 * anonymous HTML-page throttle that produces the 503s. Refs containing '/'
 * cannot be split unambiguously and are left to the HTTP re-check.
 * @param {string} url
 * @returns {string|null}
 */
export function githubContentsApiUrl(url) {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:blob|tree)\/([^/#?]+)\/?([^#?]*)/.exec(url);
  if (!match) return null;
  const [, owner, repo, ref, filePath] = match;
  return `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${encodeURIComponent(ref)}`;
}

/**
 * Ask the GitHub REST API whether a blob/tree target exists.
 * @param {string} url
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<boolean>}
 */
export async function existsViaGithubApi(url, fetchImpl = fetch) {
  const apiUrl = githubContentsApiUrl(url);
  if (!apiUrl) return false;
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'broken-link-recheck/1.0' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  try {
    const response = await fetchImpl(apiUrl, { headers, signal: AbortSignal.timeout(30000) });
    if (verbose) console.log(`  GitHub API ${apiUrl}: ${response.status}`);
    return response.ok;
  } catch (error) {
    if (verbose) console.log(`  GitHub API ${apiUrl}: ${error.message}`);
    return false;
  }
}

async function main() {
  const lycheeOutput = process.env.LYCHEE_OUTPUT || 'lychee/out.md';
  const recoveredOutput = process.env.RECOVERED_OUTPUT || 'lychee/recovered.txt';
  const delays = (process.env.RECHECK_DELAYS_MS || '5000,15000,30000').split(',').map(Number);

  console.log('=== Re-check transient link failures ===\n');
  if (!existsSync(lycheeOutput)) {
    console.log(`No lychee output at ${lycheeOutput}; nothing to re-check.`);
    setOutput('all_recovered', 'false');
    return;
  }

  const { transient, final } = classifyBrokenLinks(readFileSync(lycheeOutput, 'utf-8'));
  console.log(`${transient.length} URL(s) with a transient failure, ${final.length} definite failure(s).\n`);

  const recovered = [];
  for (const url of transient) {
    console.log(`Re-checking: ${url}`);
    const result = await recheckUrl(url, delays);
    if (!result.ok && isTransientStatus(result.status) && (await existsViaGithubApi(url))) {
      result.ok = true;
      result.status = 'GitHub API 200';
    }
    console.log(result.ok ? `  ✓ recovered (${result.status})` : `  ✗ still failing (${result.status})`);
    if (result.ok) recovered.push(url);
  }

  writeFileSync(recoveredOutput, recovered.map(url => `${url}\n`).join(''));
  const allRecovered = final.length === 0 && recovered.length === transient.length;
  setOutput('all_recovered', allRecovered ? 'true' : 'false');
}

const isDirectExecution = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectExecution) {
  main().catch(error => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
}
