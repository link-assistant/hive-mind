/**
 * Clone failure classification and partial-clone cleanup for the solve command.
 *
 * Extracted from solve.repository.lib.mjs, which had grown past the 1350-line
 * warning threshold that scripts/check-file-line-limits.sh enforces (issue
 * #1593, surfaced again by issue #2198). These two helpers are pure decision
 * logic with no dependency on the repository-setup flow around them, so they
 * are the natural seam.
 *
 * Both names stay re-exported from solve.repository.lib.mjs so existing
 * importers - and tests/anonymous-clone-auth-2192.test.mjs,
 * tests/test-issue-1957-incomplete-clone.mjs - are unaffected.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { isENOSPC } from './lib.mjs';
import { reportError } from './sentry.lib.mjs';
// Issue #2192: GitHub throttles *anonymous* git downloads; the wording overlaps
// the permission, not-found and rate-limit cases, so it is checked before them.
import { isAnonymousDownloadLimit } from './git-auth-transport.lib.mjs';

// Classify git clone errors to determine if they are retryable
export const classifyCloneError = errorOutput => {
  const output = errorOutput.toLowerCase();
  // Issue #1211: ENOSPC (disk full) errors - NOT retryable, requires user action
  if (isENOSPC(errorOutput) || output.includes('no space left on device') || (output.includes('unable to write file') && output.includes('error')) || output.includes('errno -28')) {
    return { type: 'ENOSPC', retryable: false, description: 'No space left on device' };
  }

  // Transient server errors (5xx) - typically retryable
  if (output.includes('error: 500') || output.includes('internal server error') || output.includes('error: 502') || output.includes('error: 503') || output.includes('error: 504')) {
    return { type: 'TRANSIENT', retryable: true, description: 'GitHub server error' };
  }
  // Network-related errors - typically retryable
  // Issue #1957: git fetch-pack/sideband disconnects (e.g.
  // "fetch-pack: unexpected disconnect while reading sideband packet",
  // "early EOF", "the remote end hung up unexpectedly", "RPC failed",
  // "index-pack failed") leave an incomplete or missing clone but are transient.
  if (output.includes('connection refused') || output.includes('connection timed out') || output.includes('connection reset') || output.includes('unable to connect') || output.includes('network is unreachable') || output.includes('ssl error') || output.includes('unexpected disconnect') || output.includes('sideband') || output.includes('early eof') || output.includes('remote end hung up') || output.includes('rpc failed') || output.includes('fetch-pack') || output.includes('index-pack failed') || output.includes('transfer closed')) {
    return { type: 'NETWORK', retryable: true, description: 'Network connectivity issue (interrupted transfer)' };
  }

  // Issue #2192: GitHub refusing an *unauthenticated* download. Retryable, but
  // waiting is not the remedy — the clone has to be authenticated. Checked
  // before PERMISSION/NOT_FOUND/RATE_LIMIT because GitHub's wording ("limiting",
  // "retry later or authenticate") overlaps all three.
  if (isAnonymousDownloadLimit(errorOutput)) {
    return { type: 'ANONYMOUS_RATE_LIMIT', retryable: true, description: 'GitHub is limiting unauthenticated downloads (this clone was not authenticated)' };
  }

  // Authentication/permission errors - not retryable
  if (output.includes('error: 401') || output.includes('error: 403') || output.includes('authentication failed') || output.includes('permission denied')) {
    return { type: 'PERMISSION', retryable: false, description: 'Authentication or permission error' };
  }
  // Repository not found - not retryable
  if (output.includes('error: 404') || output.includes('not found') || output.includes('repository not found')) {
    return { type: 'NOT_FOUND', retryable: false, description: 'Repository not found' };
  }

  // Rate limiting - retryable with backoff
  if (output.includes('rate limit') || output.includes('too many requests') || output.includes('api rate limit exceeded')) {
    return { type: 'RATE_LIMIT', retryable: true, description: 'Rate limit exceeded' };
  }
  // Default to retryable for unknown errors
  return { type: 'UNKNOWN', retryable: true, description: 'Unknown error' };
};

// Issue #1957: remove leftovers from an interrupted clone so a retry can start clean.
// We empty the directory in place (rather than removing it) because the path was
// created up-front by setupTempDirectory and may be the configured working directory.
export const cleanPartialClone = async tempDir => {
  try {
    const entries = await fs.readdir(tempDir);
    for (const entry of entries) {
      await fs.rm(path.join(tempDir, entry), { recursive: true, force: true });
    }
  } catch (error) {
    // Directory may not exist yet, or be unreadable — non-fatal; the retry/clone
    // will surface any real problem with a clearer message.
    if (error?.code !== 'ENOENT') {
      reportError(error, { context: 'clean_partial_clone', tempDir, operation: 'empty_directory' });
    }
  }
};
