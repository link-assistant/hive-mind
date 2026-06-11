#!/usr/bin/env bun

import fs from 'node:fs';
import path from 'node:path';
import { createDefaultLogger, createENOSPCError, DEFAULT_PRIVATE_LOGS_REPOSITORY, DEFAULT_PUBLIC_LOGS_REPOSITORY, ensureCommandSucceeded, extractGitHubRepoUrl, generateCollisionRepoName, generateRepoName, getCommandExitCode, getCommandStream, getFileSize, GITHUB_GIST_FILE_LIMIT, GITHUB_REPO_CHUNK_SIZE, isENOSPC, isRepositoryNameConflict, normalizeFileName, splitFileIntoChunks } from './common.js';

const REPOSITORY_METADATA_QUERY = '{"defaultBranch": .default_branch, "visibility": .visibility}';
const REPOSITORY_FOLDER_CONTENTS_QUERY = 'map({name: .name, download_url: .download_url})';

function isGitHubNotFoundError(errorText = '') {
  const normalized = errorText.toLowerCase();
  return normalized.includes('not found') || normalized.includes('http 404');
}

function isMissingRemoteRefError(errorText = '') {
  const normalized = errorText.toLowerCase();
  return normalized.includes("couldn't find remote ref") || normalized.includes('could not find remote branch');
}

export function shouldUseSharedRepositoryMode(filePath, useSharedRepository = true) {
  return useSharedRepository && getFileSize(filePath) > GITHUB_GIST_FILE_LIMIT;
}

export function getSharedRepositoryName(isPublic = false) {
  return isPublic ? DEFAULT_PUBLIC_LOGS_REPOSITORY : DEFAULT_PRIVATE_LOGS_REPOSITORY;
}

function buildGitHubRepositoryUrl(githubUser, repositoryName) {
  return `https://github.com/${githubUser}/${repositoryName}`;
}

function buildGitHubRepositoryTreeUrl(githubUser, repositoryName, branchName, repositoryPath) {
  return `${buildGitHubRepositoryUrl(githubUser, repositoryName)}/tree/${branchName}/${repositoryPath}`;
}

function listUploadedFiles(directoryPath) {
  return fs
    .readdirSync(directoryPath)
    .filter(file => !file.startsWith('.'))
    .sort();
}

async function getGitHubUsername($) {
  const whoamiResult = ensureCommandSucceeded(await $`gh api user --jq .login`, 'fetch authenticated GitHub username');

  return whoamiResult.stdout.trim();
}

async function getRepositoryMetadata($, githubUser, repositoryName) {
  const $silent = $({ mirror: false, capture: true });
  const result = await $silent`gh api repos/${githubUser}/${repositoryName} --jq ${REPOSITORY_METADATA_QUERY}`;

  if (getCommandExitCode(result) !== 0) {
    if (isGitHubNotFoundError(result.stderr || result.stdout)) {
      return null;
    }
    ensureCommandSucceeded(result, `read metadata for GitHub repo ${repositoryName}`);
  }

  return JSON.parse(result.stdout.trim());
}

async function getRepositoryFolderContents($, githubUser, repositoryName, repositoryPath) {
  const $silent = $({ mirror: false, capture: true });
  const result = await $silent`gh api repos/${githubUser}/${repositoryName}/contents/${repositoryPath} --jq ${REPOSITORY_FOLDER_CONTENTS_QUERY}`;

  if (getCommandExitCode(result) !== 0) {
    if (isGitHubNotFoundError(result.stderr || result.stdout)) {
      return null;
    }
    ensureCommandSucceeded(result, `read contents of ${repositoryName}/${repositoryPath}`);
  }

  const contents = result.stdout.trim();
  return contents ? JSON.parse(contents) : [];
}

async function ensureSharedRepositoryExists($, githubUser, repositoryName, isPublic, log) {
  const expectedVisibility = isPublic ? 'public' : 'private';
  const existingMetadata = await getRepositoryMetadata($, githubUser, repositoryName);

  if (existingMetadata) {
    if (existingMetadata.visibility !== expectedVisibility) {
      throw new Error(`Shared repository ${repositoryName} exists with visibility ${existingMetadata.visibility}, expected ${expectedVisibility}`);
    }

    return {
      defaultBranch: existingMetadata.defaultBranch || 'main',
      visibility: existingMetadata.visibility,
      url: buildGitHubRepositoryUrl(githubUser, repositoryName),
    };
  }

  const visibilityFlag = isPublic ? '--public' : '--private';
  log.debug(() => `→ Creating shared ${expectedVisibility} GitHub repo: ${repositoryName}`);
  const createResult = await $`gh repo create ${repositoryName} ${visibilityFlag}`;

  if (getCommandExitCode(createResult) !== 0 && isRepositoryNameConflict(createResult.stderr)) {
    const racedMetadata = await getRepositoryMetadata($, githubUser, repositoryName);
    if (racedMetadata) {
      if (racedMetadata.visibility !== expectedVisibility) {
        throw new Error(`Shared repository ${repositoryName} exists with visibility ${racedMetadata.visibility}, expected ${expectedVisibility}`);
      }

      return {
        defaultBranch: racedMetadata.defaultBranch || 'main',
        visibility: racedMetadata.visibility,
        url: buildGitHubRepositoryUrl(githubUser, repositoryName),
      };
    }
  }

  ensureCommandSucceeded(createResult, `create ${expectedVisibility} GitHub repo ${repositoryName}`);

  return {
    defaultBranch: 'main',
    visibility: expectedVisibility,
    url: extractGitHubRepoUrl(createResult.stdout) || buildGitHubRepositoryUrl(githubUser, repositoryName),
  };
}

async function stageRepositoryFiles(filePath, outputDir, log) {
  const normalized = normalizeFileName(filePath);
  const stagedFilePath = path.join(outputDir, normalized);

  fs.mkdirSync(outputDir, { recursive: true });
  log.debug(() => `→ Copying file into ${outputDir}...`);
  fs.copyFileSync(filePath, stagedFilePath);

  const fileSize = getFileSize(filePath);
  if (fileSize > GITHUB_REPO_CHUNK_SIZE) {
    log.debug(() => '→ Splitting file into 100MB chunks...');
    log.debug(() => `File size: ${fileSize} bytes, chunk size: ${GITHUB_REPO_CHUNK_SIZE} bytes`);
    await splitFileIntoChunks(stagedFilePath, outputDir, GITHUB_REPO_CHUNK_SIZE);
    log.debug(() => '→ Removing original large file...');
    fs.unlinkSync(stagedFilePath);
  }

  return listUploadedFiles(outputDir);
}

function buildSharedRepositoryResult({ githubUser, repositoryName, defaultBranch, repositoryPath, contents, isPublic, workDir, deduplicated = false }) {
  const fileCount = contents.length;
  const rawUrl = fileCount === 1 ? contents[0]?.download_url || null : null;

  return {
    type: 'repo',
    url: buildGitHubRepositoryTreeUrl(githubUser, repositoryName, defaultBranch, repositoryPath),
    rawUrl,
    repositoryName,
    repositoryPath,
    fileCount,
    isPublic,
    workDir,
    deduplicated,
  };
}

async function uploadAsDedicatedRepo(options = {}) {
  const $ = await getCommandStream(options);
  const { filePath, isPublic = false, verbose = false, logger = console } = options;

  if (!filePath) {
    throw new Error('filePath is required in options');
  }

  const log = createDefaultLogger({ verbose, logger });
  const baseRepositoryName = generateRepoName(filePath);
  const workDir = `/tmp/${baseRepositoryName}-${Date.now()}`;

  try {
    log.debug(() => `→ Creating work directory: ${workDir}`);
    fs.mkdirSync(workDir, { recursive: true });
    await stageRepositoryFiles(filePath, workDir, log);

    log.debug(() => '→ Initializing git repository...');
    ensureCommandSucceeded(await $`cd ${workDir} && git init`, 'initialize temporary git repository');
    ensureCommandSucceeded(await $`cd ${workDir} && git branch -m main`, 'rename temporary git branch to main');

    log.debug(() => '→ Adding and committing files...');
    ensureCommandSucceeded(await $`cd ${workDir} && git add .`, 'stage repository upload files');
    ensureCommandSucceeded(await $`cd ${workDir} && git commit -m "Add log file"`, 'commit repository upload files');

    log.debug(() => 'Getting GitHub user information...');
    const githubUser = await getGitHubUsername($);
    log.debug(() => `GitHub user: ${githubUser}`);

    let repositoryName = baseRepositoryName;
    const visibility = isPublic ? '--public' : '--private';
    let repoCreateResult;

    log.debug(() => `→ Creating ${isPublic ? 'public' : 'private'} GitHub repo: ${repositoryName}`);
    repoCreateResult = await $`cd ${workDir} && gh repo create ${repositoryName} ${visibility} --source=. --push`;

    if (getCommandExitCode(repoCreateResult) !== 0 && isRepositoryNameConflict(repoCreateResult.stderr)) {
      repositoryName = generateCollisionRepoName(repositoryName);
      log.warn(() => `Repository ${baseRepositoryName} already exists; retrying with ${repositoryName}`);
      repoCreateResult = await $`cd ${workDir} && gh repo create ${repositoryName} ${visibility} --source=. --push`;
    }

    ensureCommandSucceeded(repoCreateResult, `create ${isPublic ? 'public' : 'private'} GitHub repo ${repositoryName}`);

    const repoUrl = extractGitHubRepoUrl(repoCreateResult.stdout) || buildGitHubRepositoryUrl(githubUser, repositoryName);

    log.debug(() => `Repository created successfully: ${repoUrl}`);

    const uploadedFiles = listUploadedFiles(workDir);
    const fileCount = uploadedFiles.length;
    let rawUrl = null;

    if (fileCount === 1) {
      const singleFileName = uploadedFiles[0];
      try {
        log.debug(() => `Fetching raw URL for single file: ${singleFileName}`);
        const $silent = $({ mirror: false, capture: true });
        const contentResult = await $silent`gh api repos/${githubUser}/${repositoryName}/contents/${singleFileName} --jq '.download_url'`;
        rawUrl = contentResult.stdout.trim();

        if (rawUrl) {
          log.debug(() => `Raw URL: ${rawUrl}`);
          if (!isPublic && rawUrl.includes('?token=')) {
            log.debug(() => 'Note: Raw URL token expires in ~10 minutes for private repositories');
          }
        }
      } catch (apiError) {
        log.debug(() => `Could not fetch raw URL: ${apiError.message}`);
      }
    } else {
      log.debug(() => `Repository has ${fileCount} files, skipping single-file raw URL`);
    }

    return {
      type: 'repo',
      url: repoUrl,
      rawUrl,
      repositoryName,
      fileCount,
      isPublic,
      workDir,
      deduplicated: false,
    };
  } catch (error) {
    log.error(() => `Error uploading as repository: ${error.message}`);
    if (fs.existsSync(workDir)) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
    if (isENOSPC(error)) {
      throw createENOSPCError('repository upload (requires temp disk space)', error);
    }
    throw error;
  }
}

async function uploadAsSharedRepo(options = {}) {
  const $ = await getCommandStream(options);
  const { filePath, isPublic = false, verbose = false, logger = console } = options;

  if (!filePath) {
    throw new Error('filePath is required in options');
  }

  const log = createDefaultLogger({ verbose, logger });
  const repositoryName = getSharedRepositoryName(isPublic);
  const repositoryPath = generateRepoName(filePath);
  const workDir = `/tmp/${repositoryPath}-${Date.now()}`;

  try {
    const githubUser = await getGitHubUsername($);
    log.debug(() => `GitHub user: ${githubUser}`);

    const sharedRepository = await ensureSharedRepositoryExists($, githubUser, repositoryName, isPublic, log);
    const defaultBranch = sharedRepository.defaultBranch || 'main';

    const existingContents = await getRepositoryFolderContents($, githubUser, repositoryName, repositoryPath);

    if (existingContents !== null) {
      log.debug(() => `Log ${repositoryPath} already exists in ${repositoryName}; skipping duplicate upload`);

      return buildSharedRepositoryResult({
        githubUser,
        repositoryName,
        defaultBranch,
        repositoryPath,
        contents: existingContents,
        isPublic,
        workDir: null,
        deduplicated: true,
      });
    }

    log.debug(() => `→ Creating work directory: ${workDir}`);
    fs.mkdirSync(workDir, { recursive: true });

    log.debug(() => '→ Initializing git repository...');
    ensureCommandSucceeded(await $`cd ${workDir} && git init`, 'initialize temporary git repository');
    ensureCommandSucceeded(await $`cd ${workDir} && git branch -m ${defaultBranch}`, `rename temporary git branch to ${defaultBranch}`);
    ensureCommandSucceeded(await $`cd ${workDir} && git remote add origin https://github.com/${githubUser}/${repositoryName}.git`, `add remote for shared GitHub repo ${repositoryName}`);
    ensureCommandSucceeded(await $`cd ${workDir} && git sparse-checkout init --no-cone`, 'initialize sparse checkout for shared log repository');
    ensureCommandSucceeded(await $`cd ${workDir} && git sparse-checkout add ${repositoryPath}`, `prepare sparse checkout path ${repositoryPath}`);

    const fetchResult = await $`cd ${workDir} && git fetch --depth 1 --filter=blob:none origin ${defaultBranch}`;
    if (getCommandExitCode(fetchResult) === 0) {
      ensureCommandSucceeded(await $`cd ${workDir} && git checkout -B ${defaultBranch} FETCH_HEAD`, `check out ${defaultBranch} from shared GitHub repo ${repositoryName}`);
    } else if (isMissingRemoteRefError(fetchResult.stderr || fetchResult.stdout)) {
      log.debug(() => `Shared repository ${repositoryName} does not have ${defaultBranch} yet; continuing with a fresh branch`);
    } else {
      ensureCommandSucceeded(fetchResult, `fetch ${defaultBranch} from shared GitHub repo ${repositoryName}`);
    }

    const outputDir = path.join(workDir, repositoryPath);
    await stageRepositoryFiles(filePath, outputDir, log);

    log.debug(() => '→ Adding and committing files...');
    ensureCommandSucceeded(await $`cd ${workDir} && git add .`, 'stage shared repository upload files');
    ensureCommandSucceeded(await $`cd ${workDir} && git commit -m "Add log file"`, 'commit shared repository upload files');
    ensureCommandSucceeded(await $`cd ${workDir} && git push -u origin ${defaultBranch}`, `push shared repository upload to ${repositoryName}`);

    const uploadedContents =
      (await getRepositoryFolderContents($, githubUser, repositoryName, repositoryPath)) ||
      listUploadedFiles(outputDir).map(name => ({
        name,
        download_url: null,
      }));

    return buildSharedRepositoryResult({
      githubUser,
      repositoryName,
      defaultBranch,
      repositoryPath,
      contents: uploadedContents,
      isPublic,
      workDir,
      deduplicated: false,
    });
  } catch (error) {
    log.error(() => `Error uploading as shared repository: ${error.message}`);
    if (fs.existsSync(workDir)) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
    if (isENOSPC(error)) {
      throw createENOSPCError('repository upload (requires temp disk space)', error);
    }
    throw error;
  }
}

/**
 * Upload a file as a GitHub repository (with splitting if needed)
 *
 * Large files use the shared visibility repositories (`private-logs` or
 * `public-logs`) by default. The legacy dedicated-repository mode remains
 * available through the `useSharedRepository` option.
 *
 * @param {Object} options - Upload options
 * @param {string} options.filePath - Path to the file to upload
 * @param {boolean} options.useSharedRepository - Use shared log repositories for large files (default: true)
 * @returns {Promise<Object>} Repository information including URL
 */
export function uploadAsRepo(options = {}) {
  const { filePath, useSharedRepository = true } = options;

  if (!filePath) {
    throw new Error('filePath is required in options');
  }

  if (shouldUseSharedRepositoryMode(filePath, useSharedRepository)) {
    return uploadAsSharedRepo(options);
  }

  return uploadAsDedicatedRepo(options);
}
