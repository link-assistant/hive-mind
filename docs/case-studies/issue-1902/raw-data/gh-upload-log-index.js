#!/usr/bin/env bun

/**
 * gh-upload-log - Core library for uploading log files to GitHub
 *
 * This library provides functionality to upload log files to GitHub either as:
 * - Gists (for files <= 25MB that fit in a gist)
 * - Repositories (for larger files that need repository storage)
 */

import { createDefaultLogger, createENOSPCError, DEFAULT_PRIVATE_LOGS_REPOSITORY, DEFAULT_PUBLIC_LOGS_REPOSITORY, fileExists, formatFileSize, generateGistFileName, generateRepoName, getCommandStream, getFileSize, GITHUB_GIST_FILE_LIMIT, GITHUB_GIST_WEB_LIMIT, GITHUB_REPO_CHUNK_SIZE, isENOSPC, normalizeFileName, splitFileIntoChunks } from './common.js';
import { getSharedRepositoryName, shouldUseSharedRepositoryMode, uploadAsRepo } from './repository-upload.js';

export { createENOSPCError, DEFAULT_PRIVATE_LOGS_REPOSITORY, DEFAULT_PUBLIC_LOGS_REPOSITORY, fileExists, formatFileSize, generateGistFileName, generateRepoName, getFileSize, GITHUB_GIST_FILE_LIMIT, GITHUB_GIST_WEB_LIMIT, GITHUB_REPO_CHUNK_SIZE, isENOSPC, normalizeFileName, splitFileIntoChunks, uploadAsRepo };

/**
 * Determine the best upload strategy for a log file
 *
 * @param {string} filePath - Path to the log file
 * @returns {Object} Strategy object with type ('gist' or 'repo') and additional info
 */
export function determineUploadStrategy(filePath) {
  if (!fileExists(filePath)) {
    throw new Error(`File does not exist: ${filePath}`);
  }

  const fileSize = getFileSize(filePath);

  if (fileSize <= GITHUB_GIST_FILE_LIMIT) {
    return {
      type: 'gist',
      fileSize,
      needsSplit: false,
      reason: 'File fits within GitHub Gist API limit (25MB)',
    };
  }

  const numChunks = Math.ceil(fileSize / GITHUB_REPO_CHUNK_SIZE);
  const needsSplit = fileSize > GITHUB_REPO_CHUNK_SIZE;
  return {
    type: 'repo',
    fileSize,
    needsSplit,
    numChunks,
    chunkSize: GITHUB_REPO_CHUNK_SIZE,
    reason: needsSplit ? `File exceeds Gist limit, will be split into ${numChunks} chunks` : 'File exceeds Gist limit, will upload as repository',
  };
}

/**
 * Upload a file as a GitHub Gist
 *
 * @param {Object} options - Upload options
 * @param {string} options.filePath - Path to the file to upload
 * @param {boolean} options.isPublic - Whether the gist should be public (default: false)
 * @param {string} options.description - Description for the gist
 * @param {boolean} options.verbose - Enable verbose logging (default: false)
 * @param {Object} options.logger - Logging target (default: console)
 * @returns {Promise<Object>} Gist information including URL
 */
export async function uploadAsGist(options = {}) {
  const $ = await getCommandStream(options);
  const { filePath, isPublic = false, description, verbose = false, logger = console } = options;

  if (!filePath) {
    throw new Error('filePath is required in options');
  }

  const log = createDefaultLogger({ verbose, logger });
  const gistFileName = generateGistFileName(filePath);
  const desc = description || `Log file: ${filePath.split('/').pop()}`;

  log.debug(() => `Creating GitHub Gist for ${filePath}`);
  log.debug(() => `Gist file name: ${gistFileName}`);
  log.debug(() => `Description: ${desc}`);

  let result;
  if (isPublic) {
    result = await $`gh gist create ${filePath} --public --desc ${desc}`;
  } else {
    result = await $`gh gist create ${filePath} --desc ${desc}`;
  }

  const gistUrl = result.stdout.trim();
  if (!gistUrl || !gistUrl.startsWith('https://gist.github.com/') || gistUrl === 'https://gist.github.com/') {
    const errorMessage = result.stderr ? result.stderr.trim() : 'Unknown error';
    throw new Error(`Failed to create gist: ${errorMessage}`);
  }

  log.debug(() => `Gist created successfully: ${gistUrl}`);

  const gistId = gistUrl.split('/').pop();
  let rawUrl = null;
  let fileCount = 1;

  try {
    log.debug(() => 'Fetching gist details for raw URL...');
    const $silent = $({ mirror: false, capture: true });
    const gistDetails = await $silent`gh api gists/${gistId} --jq '.files | to_entries | map({filename: .key, raw_url: .value.raw_url})'`;
    const files = JSON.parse(gistDetails.stdout.trim());
    fileCount = files.length;

    if (fileCount === 1) {
      rawUrl = files[0].raw_url;
      log.debug(() => `Raw URL: ${rawUrl}`);
    } else {
      log.debug(() => `Gist has ${fileCount} files, skipping single-file raw URL`);
    }
  } catch (apiError) {
    log.debug(() => `Could not fetch gist details: ${apiError.message}`);
  }

  return {
    type: 'gist',
    url: gistUrl,
    rawUrl,
    fileName: gistFileName,
    fileCount,
    isPublic,
  };
}

/**
 * Main function to upload a log file to GitHub
 * Automatically determines the best strategy (gist vs repo)
 *
 * @param {Object} options - Upload options
 * @param {string} options.filePath - Path to the log file
 * @param {boolean} options.isPublic - Whether to make it public (default: false/private)
 * @param {boolean} options.auto - Automatically choose strategy (default: true)
 * @param {boolean} options.onlyGist - Upload only as gist (disables auto mode)
 * @param {boolean} options.onlyRepository - Upload only as repository (disables auto mode)
 * @param {boolean} options.useSharedRepository - Use shared log repositories for repository-mode uploads (default: true)
 * @param {boolean} options.dryMode - Dry run mode - don't actually upload
 * @param {string} options.description - Description for the upload
 * @param {boolean} options.verbose - Enable verbose logging (default: false)
 * @param {Object} options.logger - Logging target (default: console)
 * @returns {Promise<Object>} Upload result with URL and metadata
 */
export async function uploadLog(options = {}) {
  const { filePath, isPublic = false, auto = true, onlyGist = false, onlyRepository = false, useSharedRepository = true, dryMode = false, description, verbose = false, logger = console } = options;

  if (!filePath) {
    throw new Error('filePath is required in options');
  }

  if (!fileExists(filePath)) {
    throw new Error(`File does not exist: ${filePath}`);
  }

  const log = createDefaultLogger({ verbose, logger });
  const strategy = determineUploadStrategy(filePath);

  log.debug(() => `File size: ${formatFileSize(strategy.fileSize)}`);
  log.debug(() => `Strategy: ${strategy.reason}`);

  let uploadType = strategy.type;

  if (onlyGist) {
    uploadType = 'gist';
    log.debug(() => 'Mode: Only Gist (forced)');
  } else if (onlyRepository) {
    uploadType = 'repo';
    log.debug(() => 'Mode: Only Repository (forced)');
  } else if (auto !== false) {
    log.debug(() => 'Mode: Auto (automatic strategy selection)');
  }

  if (dryMode) {
    log.debug(() => `DRY MODE: Upload Type: ${uploadType}`);
    log.debug(() => `DRY MODE: Visibility: ${isPublic ? 'public' : 'private'}`);
    log.debug(() => `DRY MODE: Description: ${description || 'N/A'}`);

    const sharedRepositoryMode = uploadType === 'repo' && shouldUseSharedRepositoryMode(filePath, useSharedRepository);
    const repositoryName = uploadType !== 'repo' ? undefined : sharedRepositoryMode ? getSharedRepositoryName(isPublic) : generateRepoName(filePath);
    const repositoryPath = uploadType === 'repo' && sharedRepositoryMode ? generateRepoName(filePath) : undefined;

    return {
      type: uploadType,
      url: uploadType === 'gist' ? '[DRY MODE] Would create gist' : sharedRepositoryMode ? `[DRY MODE] Would upload to ${repositoryName}/${repositoryPath}` : '[DRY MODE] Would create repository',
      rawUrl: null,
      fileName: uploadType === 'gist' ? generateGistFileName(filePath) : undefined,
      repositoryName,
      repositoryPath,
      fileCount: 1,
      isPublic: isPublic || false,
      dryMode: true,
      deduplicated: false,
    };
  }

  if (uploadType === 'gist') {
    try {
      return await uploadAsGist(options);
    } catch (gistError) {
      if (isENOSPC(gistError)) {
        throw createENOSPCError('gist upload', gistError);
      }

      if (onlyGist) {
        throw gistError;
      }

      log.warn(() => `Gist upload failed: ${gistError.message}. Falling back to repository mode...`);

      return uploadAsRepo(options);
    }
  }

  try {
    return await uploadAsRepo(options);
  } catch (repoError) {
    if (isENOSPC(repoError)) {
      const fileSize = getFileSize(filePath);
      if (fileSize <= GITHUB_GIST_FILE_LIMIT) {
        const enhanced = createENOSPCError('repository upload', repoError);
        enhanced.message += ` Hint: This file (${formatFileSize(fileSize)}) fits in a gist. ` + 'Try --only-gist to upload without requiring temp disk space.';
        throw enhanced;
      }
      throw createENOSPCError('repository upload', repoError);
    }
    throw repoError;
  }
}

export default {
  uploadLog,
  uploadAsGist,
  uploadAsRepo,
  determineUploadStrategy,
  normalizeFileName,
  generateRepoName,
  generateGistFileName,
  fileExists,
  getFileSize,
  formatFileSize,
  splitFileIntoChunks,
  isENOSPC,
  createENOSPCError,
  GITHUB_GIST_FILE_LIMIT,
  GITHUB_GIST_WEB_LIMIT,
  GITHUB_REPO_CHUNK_SIZE,
  DEFAULT_PRIVATE_LOGS_REPOSITORY,
  DEFAULT_PUBLIC_LOGS_REPOSITORY,
};
