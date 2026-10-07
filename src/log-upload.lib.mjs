#!/usr/bin/env node
import { ensureUseM } from './use-m-bootstrap.lib.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describeCredentialSanitizationFailure, sanitizeForPublication } from './token-sanitization.lib.mjs';
import { sanitizeLogFileToFileBounded } from './log-sanitize-worker.lib.mjs';

// Log upload module for hive-mind
// Uses gh-upload-log for uploading log files to GitHub

// Use use-m to dynamically import modules for cross-runtime compatibility
if (typeof globalThis.use === 'undefined') {
  await ensureUseM();
}
const use = globalThis.use;

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');
const $silent = $({ mirror: false, capture: true });

// Import shared library functions
const lib = await import('./lib.mjs');
const { log } = lib;

// Import Sentry integration
const sentryLib = await import('./sentry.lib.mjs');
const { reportError } = sentryLib;

const summarizeCommandOutput = value => {
  const text = value?.toString()?.trim() || '';
  if (!text) return '';
  return text.length > 500 ? `${text.slice(0, 500)}... [truncated ${text.length - 500} chars]` : text;
};

export const buildGhUploadLogArgs = ({ logFile, isPublic, description, verbose = false }) => {
  if (!logFile) {
    throw new Error('logFile is required for gh-upload-log');
  }

  const args = [logFile, isPublic ? '--public' : '--private'];

  if (description) {
    args.push('--description', description);
  }
  if (verbose) {
    args.push('--verbose');
  }

  return args;
};

const quoteShellArg = value => {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=@+-]+$/u.test(text)) return text;
  return `"${text.replace(/(["\\$`])/gu, '\\$1')}"`;
};

const formatGhUploadLogCommand = args => `gh-upload-log ${args.map(quoteShellArg).join(' ')}`;

const runGhUploadLogCommand = async args => {
  const { spawn } = await use('child_process');

  return new Promise(resolve => {
    const child = spawn('gh-upload-log', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const settle = value => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    child.stdout?.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('error', error => {
      const errorText = stderr ? `${stderr}\n${error.message}` : error.message;
      settle({ code: error.code === 'ENOENT' ? 127 : 1, stdout, stderr: errorText });
    });
    child.on('close', code => {
      settle({ code: code ?? 1, stdout, stderr });
    });
  });
};

export const parseGhUploadLogOutput = outputValue => {
  const output = outputValue?.toString?.() || '';
  const parsed = {
    url: null,
    rawUrl: null,
    type: null,
    chunks: 1,
    repositoryName: null,
    repositoryPath: null,
  };

  const urlMatch = output.match(/(?:^|\n)🔗\s+(https:\/\/[^\s\n]+)/u);
  if (urlMatch) {
    parsed.url = urlMatch[1].trim();
  }

  const rawUrlMatch = output.match(/(?:^|\n)📄\s+(https:\/\/[^\s\n]+)/u);
  if (rawUrlMatch) {
    parsed.rawUrl = rawUrlMatch[1].trim();
  }

  if (output.includes('Type: 📝 Gist') || parsed.url?.includes('gist.github.com')) {
    parsed.type = 'gist';
  } else if (output.includes('Type: 📦 Repository') || (parsed.url?.includes('github.com') && !parsed.url?.includes('gist'))) {
    parsed.type = 'repository';
  }

  const fileCountMatch = output.match(/File count:\s*(\d+)/i);
  const chunkMatch = output.match(/split into (\d+) chunks/i);
  if (fileCountMatch) {
    parsed.chunks = parseInt(fileCountMatch[1], 10);
  } else if (chunkMatch) {
    parsed.chunks = parseInt(chunkMatch[1], 10);
  }

  const repositoryMatch = output.match(/Repository:\s*([^\s\n]+)/i);
  if (repositoryMatch) {
    parsed.repositoryName = repositoryMatch[1].trim();
  }

  const pathMatch = output.match(/Path:\s*([^\s\n]+)/i);
  if (pathMatch) {
    parsed.repositoryPath = pathMatch[1].trim();
  }

  return parsed;
};

/**
 * Fill in `success` and the raw/download URL of a parsed gh-upload-log result.
 * @param {Object} result - Output of {@link parseGhUploadLogOutput}; mutated in place.
 * @param {boolean} verbose
 */
const resolveUploadUrls = async (result, verbose) => {
  // Construct raw URL based on type and chunks
  if (result.url) {
    result.success = true;

    if (result.type === 'gist') {
      // For gist: get raw URL from gist API
      const gistId = result.url.split('/').pop();
      try {
        if (verbose) {
          await log(`  🔍 Fetching gist metadata for raw URL resolution (gistId=${gistId})`, { verbose: true });
        }
        const gistDetailsResult = await $silent`gh api gists/${gistId} --jq '{owner: .owner.login, history: .history, fileNames: (.files | keys)}'`;
        if (verbose) {
          await log(`  📥 Gist metadata fetch completed (code=${gistDetailsResult.code ?? 'unknown'})`, { verbose: true });
        }
        if (gistDetailsResult.code === 0) {
          const gistDetails = JSON.parse(gistDetailsResult.stdout.toString());
          const gistOwner = gistDetails.owner;
          const commitSha = gistDetails.history?.[0]?.version;
          const fileNames = Array.isArray(gistDetails.fileNames) ? gistDetails.fileNames : [];
          const fileName = fileNames.length > 0 ? fileNames[0] : 'log.txt';

          if (commitSha) {
            result.rawUrl = `https://gist.githubusercontent.com/${gistOwner}/${gistId}/raw/${commitSha}/${fileName}`;
          } else {
            result.rawUrl = `https://gist.githubusercontent.com/${gistOwner}/${gistId}/raw/${fileName}`;
          }
          if (verbose) {
            await log(`  🧩 Gist metadata resolved owner=${gistOwner}, commitSha=${commitSha || 'latest'}, fileName=${fileName}`, { verbose: true });
          }
        } else if (verbose) {
          const stderrSummary = summarizeCommandOutput(gistDetailsResult.stderr);
          const stdoutSummary = summarizeCommandOutput(gistDetailsResult.stdout);
          if (stderrSummary) {
            await log(`  ⚠️  Gist metadata stderr: ${stderrSummary}`, { verbose: true });
          }
          if (stdoutSummary) {
            await log(`  ⚠️  Gist metadata stdout: ${stdoutSummary}`, { verbose: true });
          }
        }
      } catch (apiError) {
        if (verbose) {
          await log(`  ⚠️  Could not get gist raw URL: ${apiError.message}`, { verbose: true });
        }
        // Use page URL as fallback
        result.rawUrl = result.url;
      }
    } else if (result.type === 'repository') {
      if (result.rawUrl) {
        // gh-upload-log v0.8+ prints the exact raw/download URL. Prefer it
        // over reconstructing paths, especially for shared repositories.
      } else if (result.chunks === 1) {
        // For single chunk repository: construct raw URL to the file
        // Repository URL format: https://github.com/owner/repo
        // We need to find the actual file name in the repo
        try {
          const repoUrl = result.url;
          const repoMatch = repoUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)(?:\/tree\/([^/]+)\/(.+))?$/);
          const [, repoOwner, repoName, branchName = 'main', treePath = null] = repoMatch || [];
          const repoPath = repoOwner && repoName ? `${repoOwner}/${repoName}` : repoUrl.replace('https://github.com/', '');
          const apiPath = treePath ? `repos/${repoPath}/contents/${treePath}?ref=${branchName}` : `repos/${repoPath}/contents`;
          if (verbose) {
            await log(`  🔍 Fetching repository contents for raw URL resolution (repoPath=${repoPath})`, { verbose: true });
          }
          const contentsResult = await $silent`gh api ${apiPath} --paginate --jq '.[].name'`;
          if (verbose) {
            await log(`  📥 Repository contents fetch completed (code=${contentsResult.code ?? 'unknown'})`, { verbose: true });
          }
          if (contentsResult.code === 0) {
            const files = contentsResult.stdout
              .toString()
              .trim()
              .split('\n')
              .filter(f => f && !f.startsWith('.'));
            if (files.length > 0) {
              const fileName = files[0];
              const rawPath = treePath ? `${treePath}/${fileName}` : fileName;
              const baseRepoUrl = repoOwner && repoName ? `https://github.com/${repoOwner}/${repoName}` : repoUrl;
              result.rawUrl = `${baseRepoUrl}/raw/${branchName}/${rawPath}`;
              if (verbose) {
                await log(`  🧩 Repository contents resolved fileName=${fileName}`, { verbose: true });
              }
            }
          } else if (verbose) {
            const stderrSummary = summarizeCommandOutput(contentsResult.stderr);
            const stdoutSummary = summarizeCommandOutput(contentsResult.stdout);
            if (stderrSummary) {
              await log(`  ⚠️  Repository contents stderr: ${stderrSummary}`, { verbose: true });
            }
            if (stdoutSummary) {
              await log(`  ⚠️  Repository contents stdout: ${stdoutSummary}`, { verbose: true });
            }
          }
        } catch (apiError) {
          if (verbose) {
            await log(`  ⚠️  Could not get repo file raw URL: ${apiError.message}`, { verbose: true });
          }
          // For single chunk, try common pattern
          result.rawUrl = result.url;
        }
      } else {
        // For multiple chunks: link to repository itself (not raw)
        result.rawUrl = result.url;
      }
    }
  }
};

// Issue #2301: a 165 MB log died on a single `git push` that GitHub answered
// with "RPC failed; HTTP 408", and nothing at all was posted on the pull
// request. One try was all the log ever got. The whole upload is now retried
// with backoff, and when it still fails the complete log is re-sent as smaller
// parts, each with its own retries, because a smaller push is what gets past
// the timeout. Every part is uploaded, so the published log stays complete
// (issue #1678: a truncated log is never presented instead).
export const LOG_UPLOAD_RETRY_DELAYS_MS = Object.freeze([30_000, 120_000]);
export const LOG_UPLOAD_PART_RETRY_DELAYS_MS = Object.freeze([15_000, 60_000]);
export const LOG_UPLOAD_PART_SIZE_BYTES = 25 * 1024 * 1024;

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const formatDelay = ms => (ms >= 60_000 && ms % 60_000 === 0 ? `${ms / 60_000}m` : `${Math.round(ms / 1000)}s`);

// Installation tokens cannot create Gists. Retrying or splitting the log cannot
// grant this permission. Do not classify rate-limit 403s as permanent failures.
export const isPermanentUploadFailure = output => /Resource not accessible by (?:integration|personal access token)|Bad credentials|requires authentication/i.test(String(output));

/**
 * Pick the lines of a failed gh-upload-log run that explain the failure, e.g.
 * "error: RPC failed; HTTP 408 curl 22 ...", without its option dump and stack.
 * @param {string} output - Combined stdout and stderr of gh-upload-log.
 * @returns {string} At most 1500 characters; empty when there is no output.
 */
export const summarizeUploadFailure = output => {
  const lines = String(output || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return '';
  const explanatory = [...new Set(lines.filter(line => /\b(error|fatal|failed|denied|timed? ?out|HTTP \d{3})\b/i.test(line) && !/^at\s/.test(line)))];
  const picked = (explanatory.length > 0 ? explanatory : lines).slice(-6).join('\n');
  return picked.length > 1500 ? `…${picked.slice(-1500)}` : picked;
};

/**
 * Split a log into parts of about `partSizeBytes` each, cutting only after a
 * newline so no line (and no multi-byte character) is broken across parts.
 * @returns {Promise<string[]>} Part paths in order.
 */
export const splitLogIntoLineAlignedParts = async ({ sourcePath, directory, baseName = 'session-log', partSizeBytes = LOG_UPLOAD_PART_SIZE_BYTES }) => {
  const { createReadStream } = await import('node:fs');
  const parts = [];
  let handle = null;
  let written = 0;
  const write = async buffer => {
    if (!handle) {
      const partPath = path.join(directory, `${baseName}.part-${parts.length + 1}.log`);
      parts.push(partPath);
      handle = await fs.open(partPath, 'w', 0o600);
      written = 0;
    }
    await handle.write(buffer);
    written += buffer.length;
  };
  try {
    for await (const chunk of createReadStream(sourcePath, { highWaterMark: 1024 * 1024 })) {
      let offset = 0;
      while (offset < chunk.length) {
        if (!handle || written < partSizeBytes) {
          const room = handle ? partSizeBytes - written : partSizeBytes;
          const end = Math.min(chunk.length, offset + room);
          await write(chunk.subarray(offset, end));
          offset = end;
          continue;
        }
        const newline = chunk.indexOf(10, offset);
        if (newline === -1) {
          await write(chunk.subarray(offset));
          offset = chunk.length;
        } else {
          await write(chunk.subarray(offset, newline + 1));
          offset = newline + 1;
          await handle.close();
          handle = null;
        }
      }
    }
  } finally {
    await handle?.close();
  }
  // Name the parts "N-of-M" once M is known, so every uploaded file says where it belongs.
  const named = [];
  for (const [index, partPath] of parts.entries()) {
    const finalPath = path.join(directory, `${baseName}.part-${index + 1}-of-${parts.length}.log`);
    await fs.rename(partPath, finalPath);
    named.push(finalPath);
  }
  return named;
};

/**
 * Run gh-upload-log until it reports a URL, waiting `delaysMs[i]` before retry i+1.
 * @returns {Promise<{ok: boolean, parsed: Object|null, output: string, attempts: number}>}
 */
const runUploadWithRetries = async ({ commandArgs, runUpload, sleep, delaysMs, label, verbose }) => {
  const maxAttempts = delaysMs.length + 1;
  let output = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (verbose) {
      await log(`  📤 Running: ${formatGhUploadLogCommand(commandArgs)}`, { verbose: true });
    }
    const uploadResult = await runUpload(commandArgs);
    output = (uploadResult.stdout?.toString() || '') + (uploadResult.stderr?.toString() || '');
    if (uploadResult.code === 0) {
      const parsed = parseGhUploadLogOutput(output);
      if (parsed.url) return { ok: true, parsed, output, attempts: attempt };
      await log(`  ❌ gh-upload-log exited 0 but printed no log URL (${label}, attempt ${attempt}/${maxAttempts}): ${output}`);
    } else {
      await log(`  ❌ gh-upload-log failed (${label}, attempt ${attempt}/${maxAttempts}): ${output}`);
    }
    // 127: gh-upload-log is not installed; waiting will not change that.
    const permanent = uploadResult.code === 127 || isPermanentUploadFailure(output);
    if (permanent || attempt === maxAttempts) {
      return { ok: false, parsed: null, output, attempts: attempt, permanent };
    }
    const delayMs = delaysMs[attempt - 1];
    await log(`  🔁 Retrying the ${label} upload in ${formatDelay(delayMs)} (attempt ${attempt + 1}/${maxAttempts})...`);
    await sleep(delayMs);
  }
  return { ok: false, parsed: null, output, attempts: maxAttempts };
};

/**
 * Upload a log file using gh-upload-log command
 * @param {Object} options - Upload options
 * @param {string} options.logFile - Path to the log file to upload
 * @param {boolean} options.isPublic - Whether to make the upload public
 * @param {string} options.description - Description for the upload
 * @param {boolean} [options.verbose=false] - Enable verbose logging
 * @returns {Promise<{success: boolean, url: string|null, rawUrl: string|null, type: 'gist'|'repository'|null, chunks: number, repositoryName?: string|null, repositoryPath?: string|null, parts?: Object[], attempts?: number, failureReason?: string}>}
 *   `parts` is set when the log was published as several parts (issue #2301); `failureReason` when it was not published.
 */
export const uploadLogWithGhUploadLog = async ({ logFile, isPublic, description, verbose = false, runUpload = runGhUploadLogCommand, sleep = defaultSleep, retryDelaysMs = LOG_UPLOAD_RETRY_DELAYS_MS, partRetryDelaysMs = LOG_UPLOAD_PART_RETRY_DELAYS_MS, partSizeBytes = LOG_UPLOAD_PART_SIZE_BYTES, publishToBranch = null }) => {
  const result = { success: false, url: null, rawUrl: null, type: null, chunks: 1 };
  let privateTempDirectory = null;

  try {
    const sanitizedDescription = description ? await sanitizeForPublication(description) : description;
    privateTempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-mind-log-upload-'));
    await fs.chmod(privateTempDirectory, 0o700);
    const privateLogFile = path.join(privateTempDirectory, 'sanitized.log');
    const fallback = async () => {
      if (publishToBranch) {
        const publication = await publishToBranch(privateLogFile);
        if (publication?.success && publication.url) {
          Object.assign(result, publication);
          delete result.failureReason;
        } else if (publication?.failureReason) {
          await log(`  ⚠️  Branch log publication failed: ${publication.failureReason}`);
        }
      }
      return result;
    };
    // Issue #2189: this used to be readFile → sanitizeForPublication → writeFile,
    // i.e. three full-size copies of the log in the heap at once. A 134 MB
    // transcript reliably killed the run with "Reached heap limit". The streaming
    // sanitizer holds one block (1 MiB) at a time, so cost no longer scales with
    // log size. This is now the ONLY place `--attach-logs` sanitizes the log.
    // Large logs additionally run in a heap-capped worker, so a residual blow-up
    // costs one thread and one failed upload instead of the whole session.
    const sanitizeStats = await sanitizeLogFileToFileBounded({
      sourcePath: logFile,
      destPath: privateLogFile,
      onWorkerFallback: ({ error }) => log(`  ⚠️  Sanitize worker unavailable (${error?.message || error}); sanitizing in-process`, { verbose: true }),
    });
    if (verbose) {
      await log(`  🧼 Streamed sanitize: ${sanitizeStats.sourceSize} bytes in ${sanitizeStats.blocks} block(s)${sanitizeStats.forcedReleases > 0 ? `, ${sanitizeStats.forcedReleases} forced release(s)` : ''}${sanitizeStats.worker ? ' (bounded worker)' : ''}`, { verbose: true });
    }

    const commandArgs = buildGhUploadLogArgs({
      logFile: privateLogFile,
      isPublic,
      description: sanitizedDescription,
      verbose,
    });

    const whole = await runUploadWithRetries({ commandArgs, runUpload, sleep, delaysMs: retryDelaysMs, label: 'log', verbose });
    result.attempts = whole.attempts;
    if (whole.ok) {
      Object.assign(result, whole.parsed);
      await resolveUploadUrls(result, verbose);
    } else {
      result.failureReason = summarizeUploadFailure(whole.output);
      const { size } = await fs.stat(privateLogFile);
      if (whole.permanent || size <= partSizeBytes) {
        return await fallback();
      }
      const partPaths = await splitLogIntoLineAlignedParts({ sourcePath: privateLogFile, directory: privateTempDirectory, partSizeBytes });
      // Retain the sanitized whole file only when the branch fallback needs it.
      if (!publishToBranch) await fs.rm(privateLogFile, { force: true });
      await log(`  🔁 Uploading the complete log as ${partPaths.length} parts of about ${partSizeBytes >= 1024 * 1024 ? `${Math.round(partSizeBytes / 1024 / 1024)} MB` : `${Math.round(partSizeBytes / 1024)} KB`} each...`);
      const parts = [];
      for (const [index, partPath] of partPaths.entries()) {
        const partLabel = `part ${index + 1} of ${partPaths.length}`;
        const partArgs = buildGhUploadLogArgs({ logFile: partPath, isPublic, description: sanitizedDescription ? `${sanitizedDescription} (${partLabel})` : partLabel, verbose });
        const partUpload = await runUploadWithRetries({ commandArgs: partArgs, runUpload, sleep, delaysMs: partRetryDelaysMs, label: `log ${partLabel}`, verbose });
        result.attempts += partUpload.attempts;
        if (!partUpload.ok) {
          result.failureReason = summarizeUploadFailure(partUpload.output);
          await log(`  ❌ Uploading the log as parts stopped at ${partLabel}`);
          return await fallback();
        }
        const part = { success: false, ...partUpload.parsed };
        await resolveUploadUrls(part, verbose);
        parts.push(part);
      }
      delete result.failureReason;
      Object.assign(result, { success: true, url: parts[0].url, rawUrl: parts[0].rawUrl, type: parts[0].type, chunks: parts.length, parts });
      await log(`  ✅ Complete log uploaded as ${parts.length} parts`);
    }

    if (verbose) {
      await log(`  ✅ Upload successful: ${result.url}`, { verbose: true });
      await log(`  📊 Type: ${result.type}, Chunks: ${result.chunks}`, { verbose: true });
      if (result.rawUrl !== result.url) {
        await log(`  🔗 Raw URL: ${result.rawUrl}`, { verbose: true });
      }
    }

    return result;
  } catch (error) {
    reportError(error, {
      context: 'upload_log_with_gh_upload_log',
      logFile,
      operation: 'gh_upload_log_command',
    });
    // Issue #2397: name the sanitizer stage/rule that blocked publication.
    const errorDescription = describeCredentialSanitizationFailure(error);
    await log(`  ❌ Error running gh-upload-log: ${errorDescription}`);
    result.failureReason = result.failureReason || errorDescription;
    return result;
  } finally {
    if (privateTempDirectory) {
      await fs.rm(privateTempDirectory, { recursive: true, force: true }).catch(() => {});
    }
  }
};

// Export all functions as default object too
export default {
  parseGhUploadLogOutput,
  buildGhUploadLogArgs,
  summarizeUploadFailure,
  splitLogIntoLineAlignedParts,
  uploadLogWithGhUploadLog,
};
