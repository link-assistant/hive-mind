#!/usr/bin/env node

// Log upload module for hive-mind
// Uses gh-upload-log for uploading log files to GitHub

// Use use-m to dynamically import modules for cross-runtime compatibility
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const use = globalThis.use;

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

// Import shared library functions
const lib = await import('./lib.mjs');
const { log } = lib;

// Import Sentry integration
const sentryLib = await import('./sentry.lib.mjs');
const { reportError } = sentryLib;

/**
 * Upload a log file using gh-upload-log command
 * @param {Object} options - Upload options
 * @param {string} options.logFile - Path to the log file to upload
 * @param {boolean} options.isPublic - Whether to make the upload public
 * @param {string} options.description - Description for the upload
 * @param {boolean} [options.verbose=false] - Enable verbose logging
 * @returns {Promise<{success: boolean, url: string|null, rawUrl: string|null, type: 'gist'|'repository'|null, chunks: number}>}
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

    // Parse output to extract URL and type
    // Look for the URL line: 🔗 https://...
    const urlMatch = output.match(/🔗\s+(https:\/\/[^\s\n]+)/);
    if (urlMatch) {
      result.url = urlMatch[1].trim();

      // Validate URL - detect malformed URLs like https://github.com//repo (double slash)
      // This can happen when gh-upload-log fails to get GitHub username due to network issues
      // See: https://github.com/link-assistant/hive-mind/issues/1317
      if (result.url.includes('github.com//') || result.url.match(/github\.com\/[^/]*\/\//) || result.url.endsWith('/')) {
        await log(`  ⚠️  gh-upload-log returned malformed URL (possible network issue during upload): ${result.url}`);
        // Still return the URL so it can be logged, but mark as potentially invalid
        result.urlMalformed = true;
      }
    }

    // Determine type from output
    if (output.includes('Type: 📝 Gist') || result.url?.includes('gist.github.com')) {
      result.type = 'gist';
    } else if (output.includes('Type: 📦 Repository') || (result.url?.includes('github.com') && !result.url?.includes('gist'))) {
      result.type = 'repository';
    }

    // Extract chunk count if mentioned
    const chunkMatch = output.match(/split into (\d+) chunks/i);
    if (chunkMatch) {
      result.chunks = parseInt(chunkMatch[1], 10);
    }

    // Construct raw URL based on type and chunks
    if (result.url) {
      result.success = true;

      if (result.type === 'gist') {
        // For gist: get raw URL from gist API
        const gistId = result.url.split('/').pop();
        try {
          const gistDetailsResult = await $`gh api gists/${gistId} --jq '{owner: .owner.login, files: .files, history: .history}'`;
          if (gistDetailsResult.code === 0) {
            const gistDetails = JSON.parse(gistDetailsResult.stdout.toString());
            const gistOwner = gistDetails.owner;
            const commitSha = gistDetails.history?.[0]?.version;
            const fileNames = gistDetails.files ? Object.keys(gistDetails.files) : [];
            const fileName = fileNames.length > 0 ? fileNames[0] : 'log.txt';

            if (commitSha) {
              result.rawUrl = `https://gist.githubusercontent.com/${gistOwner}/${gistId}/raw/${commitSha}/${fileName}`;
            } else {
              result.rawUrl = `https://gist.githubusercontent.com/${gistOwner}/${gistId}/raw/${fileName}`;
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
        if (result.chunks === 1) {
          // For single chunk repository: construct raw URL to the file
          // Repository URL format: https://github.com/owner/repo
          // We need to find the actual file name in the repo
          try {
            const repoUrl = result.url;
            const repoPath = repoUrl.replace('https://github.com/', '');
            const contentsResult = await $`gh api repos/${repoPath}/contents --jq '.[].name'`;
            if (contentsResult.code === 0) {
              const files = contentsResult.stdout
                .toString()
                .trim()
                .split('\n')
                .filter(f => f && !f.startsWith('.'));
              if (files.length > 0) {
                const fileName = files[0];
                result.rawUrl = `${repoUrl}/raw/main/${fileName}`;
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
  uploadLogWithGhUploadLog,
};
