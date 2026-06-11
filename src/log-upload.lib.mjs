#!/usr/bin/env node
import { ensureUseM } from './use-m-bootstrap.lib.mjs';

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
 * Upload a log file using gh-upload-log command
 * @param {Object} options - Upload options
 * @param {string} options.logFile - Path to the log file to upload
 * @param {boolean} options.isPublic - Whether to make the upload public
 * @param {string} options.description - Description for the upload
 * @param {boolean} [options.verbose=false] - Enable verbose logging
 * @returns {Promise<{success: boolean, url: string|null, rawUrl: string|null, type: 'gist'|'repository'|null, chunks: number, repositoryName?: string|null, repositoryPath?: string|null}>}
 */
export const uploadLogWithGhUploadLog = async ({ logFile, isPublic, description, verbose = false }) => {
  const result = { success: false, url: null, rawUrl: null, type: null, chunks: 1 };

  try {
    // Build command flags
    // IMPORTANT: When using command-stream's $ template tag, each ${} interpolation is treated
    // as a single argument. DO NOT use commandArgs.join(' ') as it will make all flags part
    // of the first positional argument, causing "File does not exist" errors.
    // See case study: docs/case-studies/issue-1096/README.md
    const publicFlag = isPublic ? '--public' : '--private';

    if (verbose) {
      const descDisplay = description ? ` --description "${description}"` : '';
      await log(`  📤 Running: gh-upload-log "${logFile}" ${publicFlag}${descDisplay} --verbose`, { verbose: true });
    }

    // Execute command with separate interpolations for each argument
    // Each ${} is properly passed as a separate argument to the shell
    let uploadResult;
    if (description && verbose) {
      uploadResult = await $`gh-upload-log ${logFile} ${publicFlag} --description ${description} --verbose`;
    } else if (description) {
      uploadResult = await $`gh-upload-log ${logFile} ${publicFlag} --description ${description}`;
    } else if (verbose) {
      uploadResult = await $`gh-upload-log ${logFile} ${publicFlag} --verbose`;
    } else {
      uploadResult = await $`gh-upload-log ${logFile} ${publicFlag}`;
    }
    const output = (uploadResult.stdout?.toString() || '') + (uploadResult.stderr?.toString() || '');

    if (uploadResult.code !== 0) {
      await log(`  ❌ gh-upload-log failed: ${output}`);
      return result;
    }

    Object.assign(result, parseGhUploadLogOutput(output));

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
    await log(`  ❌ Error running gh-upload-log: ${error.message}`);
    return result;
  }
};

// Export all functions as default object too
export default {
  parseGhUploadLogOutput,
  uploadLogWithGhUploadLog,
};
