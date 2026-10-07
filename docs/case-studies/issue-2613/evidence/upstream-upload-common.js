#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import makeLog from 'log-lazy';

/**
 * Check if an error is an ENOSPC (no space left on device) error
 *
 * @param {Error} error - The error to check
 * @returns {boolean} True if the error is ENOSPC
 */
export function isENOSPC(error) {
  if (!error) {
    return false;
  }
  if (error.code === 'ENOSPC') {
    return true;
  }
  if (error.message && error.message.includes('ENOSPC')) {
    return true;
  }
  if (
    error.message &&
    error.message.toLowerCase().includes('no space left on device')
  ) {
    return true;
  }
  if (error.stderr && error.stderr.includes('ENOSPC')) {
    return true;
  }
  if (
    error.stderr &&
    error.stderr.toLowerCase().includes('no space left on device')
  ) {
    return true;
  }
  return false;
}

/**
 * Create a structured ENOSPC error with actionable information
 *
 * @param {string} operation - Description of the operation that failed
 * @param {Error} originalError - The original error
 * @returns {Error} Enhanced error with ENOSPC metadata
 */
export function createENOSPCError(operation, originalError) {
  const error = new Error(
    `No space left on device during ${operation}. ` +
      `Suggestion: Free disk space and retry. ` +
      `Check large files in ~/.claude/debug, /tmp, or system logs.`
  );
  error.code = 'ENOSPC';
  error.operation = operation;
  error.originalError = originalError;
  return error;
}

/**
 * Create a logger instance
 * This can be customized by users when using the library
 *
 * @param {Object} options - Logger options
 * @returns {Object} Logger instance
 */
export function createDefaultLogger(options = {}) {
  const { verbose = false, logger = console } = options;

  return makeLog({
    level: verbose ? 'development' : 'info',
    log: {
      fatal: logger.error || logger.log,
      error: logger.error || logger.log,
      warn: logger.warn || logger.log,
      info: logger.log,
      debug: logger.debug || logger.log,
      verbose: logger.log,
      trace: logger.log,
      silly: logger.log,
    },
  });
}

/**
 * Load the command-stream tag or a test override
 *
 * @param {Object} [options={}] - Optional command runner overrides
 * @returns {Promise<Function>} command-stream template tag function
 */
export async function getCommandStream(options = {}) {
  if (typeof options.commandStreamFactory === 'function') {
    return options.commandStreamFactory();
  }

  const { $ } = await import('command-stream');
  return $;
}

/**
 * Get the exit code from a command-stream result
 *
 * @param {Object} result - command-stream result object
 * @returns {number} Exit code (0 when unavailable)
 */
export function getCommandExitCode(result) {
  if (typeof result?.code === 'number') {
    return result.code;
  }
  if (typeof result?.child?.exitCode === 'number') {
    return result.child.exitCode;
  }
  return 0;
}

/**
 * Throw when a command-stream result indicates a failed command
 *
 * @param {Object} result - command-stream result object
 * @param {string} operation - Human-readable operation description
 * @returns {Object} The original result when successful
 */
export function ensureCommandSucceeded(result, operation) {
  const exitCode = getCommandExitCode(result);

  if (exitCode === 0) {
    return result;
  }

  const stderr = result?.stderr?.trim();
  const stdout = result?.stdout?.trim();
  const detail = stderr || stdout || `Command exited with code ${exitCode}`;
  const error = new Error(`Failed to ${operation}: ${detail}`);

  error.code = exitCode;
  error.stdout = result?.stdout || '';
  error.stderr = result?.stderr || '';
  error.commandResult = result;

  throw error;
}

/**
 * Extract a GitHub repository URL from command output
 *
 * @param {string} output - Command stdout
 * @returns {string|null} Repository URL if found
 */
export function extractGitHubRepoUrl(output = '') {
  return (
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+$/.test(line)) ||
    null
  );
}

/**
 * Check whether repository creation failed because the generated name already exists
 *
 * @param {string} errorText - stderr or error message from gh repo create
 * @returns {boolean} True when the repo name is already taken on the current account
 */
export function isRepositoryNameConflict(errorText = '') {
  const normalized = errorText.toLowerCase();
  return (
    normalized.includes('name already exists on this account') ||
    normalized.includes('already exists')
  );
}

/**
 * Generate a collision-safe repository name by appending a timestamp suffix
 *
 * @param {string} repositoryName - Base repository name
 * @param {number} [timestamp=Date.now()] - Timestamp or numeric suffix
 * @returns {string} Unique repository name candidate
 */
export function generateCollisionRepoName(
  repositoryName,
  timestamp = Date.now()
) {
  return `${repositoryName}-${timestamp}`;
}

/**
 * Constants for GitHub limits
 *
 * Note: GitHub documents a 100MB limit for gist files. Measurements taken for
 * issue #38 (see docs/case-studies/issue-38) show that the API does accept
 * files well above 25MB - 26MB, 31MB, 40MB, 60MB, 75MB, 90MB, 100MB and 102MB
 * uploads all succeeded and the raw URL served byte-identical content - but the
 * failure rate grows with size: the same payload can answer HTTP 502/504 once
 * and succeed on the next attempt, and everything at/above ~104MB failed.
 *
 * The default threshold therefore stays at the reliable 25MB web-interface
 * limit, and callers who prefer gists for bigger files can raise it with the
 * `gistFileLimit` option (CLI: `--gist-limit`, env: GH_UPLOAD_LOG_GIST_LIMIT).
 *
 * See: https://github.com/orgs/community/discussions/147837
 */
export const GITHUB_GIST_FILE_LIMIT = 25 * 1024 * 1024;
export const GITHUB_GIST_WEB_LIMIT = 25 * 1024 * 1024;
export const GITHUB_GIST_DOCUMENTED_FILE_LIMIT = 100 * 1024 * 1024;
export const GITHUB_REPO_CHUNK_SIZE = 100 * 1024 * 1024;
export const DEFAULT_PRIVATE_LOGS_REPOSITORY = 'private-logs';
export const DEFAULT_PUBLIC_LOGS_REPOSITORY = 'public-logs';
export const LOG_TEXT_EXTENSION = '.log.txt';

/**
 * GitHub rejects repository names longer than 100 characters, and git limits a
 * single path component to 255 bytes. Absolute paths are used to build both
 * names, so deep paths have to be shortened deterministically.
 */
export const MAX_REPOSITORY_NAME_LENGTH = 100;
export const MAX_UPLOADED_FILE_NAME_LENGTH = 200;
export const MAX_LOG_FOLDER_SEGMENT_LENGTH = 200;

/**
 * Length of the content hash used as the version folder of an uploaded log
 *
 * 16 hex characters of SHA-256 (64 bits) keep folder names readable while the
 * chance of two different logs colliding stays negligible for a personal log
 * archive.
 */
export const LOG_CONTENT_HASH_LENGTH = 16;

/**
 * Folder used when a log file lives directly in the filesystem root
 */
export const ROOT_LOG_FOLDER_SEGMENT = 'root';

/**
 * Shorten a generated name deterministically when it exceeds a limit
 *
 * Keeps the most specific (trailing) part of the name and prefixes it with a
 * short hash of the full name, so the result stays unique and stable for the
 * same input path (which keeps shared-repository deduplication working).
 *
 * @param {string} name - Name to shorten
 * @param {number} maxLength - Maximum allowed length
 * @returns {string} Name guaranteed to be at most maxLength characters
 */
export function shortenGeneratedName(name, maxLength) {
  if (name.length <= maxLength) {
    return name;
  }

  const hash = createHash('sha1').update(name).digest('hex').slice(0, 8);
  const keptLength = Math.max(maxLength - hash.length - 1, 0);
  return `${hash}-${name.slice(name.length - keptLength)}`.slice(0, maxLength);
}

/**
 * Resolve a user-supplied log file path into an absolute path
 *
 * Accepts every path form a shell user can type: relative (`app.log`,
 * `./app.log`, `../logs/app.log`), home-relative (`~/app.log`, quoted so the
 * shell does not expand it), and absolute paths. Resolving early guarantees
 * that later file operations keep working even when the working directory
 * changes during the upload, and that generated names are identical no matter
 * how the same file was addressed.
 *
 * @param {string} filePath - Raw file path from CLI arguments or library options
 * @returns {string} Absolute file path
 */
export function resolveLogFilePath(filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    throw new Error('filePath is required in options');
  }

  const home = os.homedir();
  let expanded = filePath;

  if (filePath === '~') {
    expanded = home;
  } else if (filePath.startsWith('~/') || filePath.startsWith('~\\')) {
    expanded = path.join(home, filePath.slice(2));
  }

  return path.resolve(expanded);
}

/**
 * Create a temporary working directory path inside the OS temp directory
 *
 * @param {string} prefix - Directory name prefix
 * @param {number} [timestamp=Date.now()] - Unique suffix
 * @returns {string} Absolute path to the temporary working directory
 */
export function createWorkDirPath(prefix, timestamp = Date.now()) {
  return path.join(os.tmpdir(), `${prefix}-${timestamp}`);
}

/**
 * Normalize a file path to create a valid GitHub name
 * Replaces all '/' with '-' and removes leading slashes
 *
 * @param {string} filePath - The file path to normalize
 * @returns {string} Normalized name suitable for GitHub
 */
export function normalizeFileName(filePath) {
  return filePath
    .replace(/^([A-Za-z]):/, '$1')
    .replace(/^[\\/]+/, '')
    .replace(/[\\/]/g, '-');
}

/**
 * Ensure uploaded log files use a browser-friendly text extension
 *
 * @param {string} fileName - Normalized file name
 * @returns {string} File name ending in .log.txt
 */
export function ensureLogTextExtension(fileName) {
  if (fileName.endsWith(LOG_TEXT_EXTENSION)) {
    return fileName;
  }

  if (fileName.endsWith('.log')) {
    return `${fileName}.txt`;
  }

  return `${fileName}${LOG_TEXT_EXTENSION}`;
}

/**
 * Generate the user-facing uploaded log file name from a file path
 *
 * @param {string} filePath - The file path
 * @returns {string} Normalized file name ending in .log.txt
 */
export function generateUploadedLogFileName(filePath) {
  const fileName = ensureLogTextExtension(normalizeFileName(filePath));

  if (fileName.length <= MAX_UPLOADED_FILE_NAME_LENGTH) {
    return fileName;
  }

  const baseName = fileName.slice(0, -LOG_TEXT_EXTENSION.length);
  const shortened = shortenGeneratedName(
    baseName,
    MAX_UPLOADED_FILE_NAME_LENGTH - LOG_TEXT_EXTENSION.length
  );
  return `${shortened}${LOG_TEXT_EXTENSION}`;
}

/**
 * Generate a repository name from a file path
 * Adds 'log-' prefix and removes extension
 *
 * @param {string} filePath - The file path
 * @returns {string} Repository name
 */
export function generateRepoName(filePath) {
  const normalized = normalizeFileName(filePath);
  const baseName = path.basename(normalized, '.log');
  return `log-${shortenGeneratedName(baseName, MAX_REPOSITORY_NAME_LENGTH - 'log-'.length)}`;
}

/**
 * Generate a gist file name from a file path
 * Uses the full normalized path as the file name
 *
 * @param {string} filePath - The file path
 * @returns {string} Gist file name
 */
export function generateGistFileName(filePath) {
  return generateUploadedLogFileName(filePath);
}

/**
 * Generate the file name a log is stored under inside a repository folder
 *
 * Repository uploads already encode the directory in the folder path
 * (`home-box/<hash>/`), so the file itself only needs its own base name. Using
 * the full normalized path here would repeat the directory in every file name
 * (`home-box/<hash>/home-box-app.log.txt`), which is what issue #38 asks to
 * stop doing.
 *
 * @param {string} filePath - The file path
 * @returns {string} File name ending in .log.txt
 */
export function generateStoredLogFileName(filePath) {
  return generateUploadedLogFileName(path.basename(filePath));
}

/**
 * Generate the folder segment that represents the directory of a log file
 *
 * `/home/box/app.log` becomes `home-box`. Files that live in the filesystem
 * root (or in a path without a directory part) use `root` so the generated
 * repository path always has two components.
 *
 * @param {string} filePath - Absolute path of the log file
 * @returns {string} Normalized directory segment
 */
export function generateLogDirectorySegment(filePath) {
  const directory = path.dirname(filePath);
  const normalized = normalizeFileName(directory)
    .replace(/^\.+$/, '')
    .replace(/^-+|-+$/g, '');

  if (!normalized) {
    return ROOT_LOG_FOLDER_SEGMENT;
  }

  return shortenGeneratedName(normalized, MAX_LOG_FOLDER_SEGMENT_LENGTH);
}

/**
 * Compute the content hash used as the version folder of an uploaded log
 *
 * The file is streamed so that multi-gigabyte logs are hashed without being
 * loaded into memory.
 *
 * @param {string} filePath - Absolute path of the log file
 * @param {number} [length=LOG_CONTENT_HASH_LENGTH] - Hex characters to keep
 * @returns {Promise<string>} Truncated lowercase SHA-256 hex digest
 */
export function generateFileContentHash(
  filePath,
  length = LOG_CONTENT_HASH_LENGTH
) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex').slice(0, length)));
  });
}

/**
 * Build the repository folder a log version is stored in
 *
 * The layout is `<normalized-directory>/<content-hash>`, so re-uploading a file
 * whose content changed creates a new folder instead of silently keeping the
 * previous version (issue #38), while re-uploading identical content resolves
 * to the folder that already holds it.
 *
 * @param {string} filePath - Absolute path of the log file
 * @param {string} contentHash - Content hash from generateFileContentHash
 * @returns {string} Repository-relative folder path
 */
export function buildLogRepositoryPath(filePath, contentHash) {
  return `${generateLogDirectorySegment(filePath)}/${contentHash}`;
}

/**
 * Build the chunk file name prefix used when a log is split into parts
 *
 * @param {string} storedFileName - File name returned by generateStoredLogFileName
 * @returns {string} Chunk prefix, e.g. `app.part-`
 */
export function buildChunkFileNamePrefix(storedFileName) {
  return `${storedFileName.slice(0, -LOG_TEXT_EXTENSION.length)}.part-`;
}

/**
 * Check whether a repository folder entry belongs to the given stored log
 *
 * Matches both single-file uploads and the `.part-NN.log.txt` chunks produced
 * for logs larger than the repository chunk size.
 *
 * @param {string} entryName - File name inside the repository folder
 * @param {string} storedFileName - Expected stored file name
 * @returns {boolean} True when the entry is the log or one of its chunks
 */
export function isStoredLogFileName(entryName, storedFileName) {
  if (entryName === storedFileName) {
    return true;
  }

  return entryName.startsWith(buildChunkFileNamePrefix(storedFileName));
}

/**
 * Check if a file exists
 *
 * @param {string} filePath - Path to check
 * @returns {boolean} True if file exists
 */
export function fileExists(filePath) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * Get file size in bytes
 *
 * @param {string} filePath - Path to file
 * @returns {number} File size in bytes
 */
export function getFileSize(filePath) {
  return fs.statSync(filePath).size;
}

/**
 * Format file size in human-readable format
 *
 * @param {number} bytes - File size in bytes
 * @returns {string} Human-readable file size (e.g., "1.5 KB", "2.3 MB")
 */
export function formatFileSize(bytes) {
  if (bytes === 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const base = 1024;
  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(base)),
    units.length - 1
  );
  const size = bytes / Math.pow(base, unitIndex);

  if (unitIndex === 0) {
    return `${size} ${units[unitIndex]}`;
  }
  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * Parse a human-readable size into bytes
 *
 * Accepts plain numbers (interpreted as megabytes, the unit users think in for
 * this tool) and explicit units: `40MB`, `1.5 GB`, `500KB`, `1048576B`.
 *
 * @param {string|number} value - Size to parse
 * @returns {number|null} Size in bytes, or null when the value is unparseable
 */
export function parseFileSize(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value * 1024 * 1024);
  }

  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  const match = value
    .trim()
    .toLowerCase()
    .match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|k|m|g)?$/);

  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  const multipliers = {
    b: 1,
    k: 1024,
    kb: 1024,
    m: 1024 * 1024,
    mb: 1024 * 1024,
    g: 1024 * 1024 * 1024,
    gb: 1024 * 1024 * 1024,
  };

  return Math.round(amount * multipliers[match[2] || 'mb']);
}

/** Validate a repository chunk limit in bytes (large enough for any UTF-8 character). */
export function resolveChunkSize(chunkSize = GITHUB_REPO_CHUNK_SIZE) {
  if (
    !Number.isSafeInteger(chunkSize) ||
    chunkSize < 4 ||
    chunkSize > GITHUB_REPO_CHUNK_SIZE
  ) {
    throw new Error('chunkSize must be an integer between 4 bytes and 100MB');
  }
  return chunkSize;
}

/**
 * Split at the last complete line within the byte limit. Oversized lines are
 * split between UTF-8 characters. Memory is bounded by one chunk plus 4 bytes.
 * The source bytes, including CRLF and a missing final newline, are preserved.
 */
export async function splitFileIntoChunks(
  inputPath,
  outputDir,
  chunkSize = GITHUB_REPO_CHUNK_SIZE
) {
  resolveChunkSize(chunkSize);
  const inputFileName = inputPath.split(/[\\/]/).pop();
  const prefix = buildChunkFileNamePrefix(
    ensureLogTextExtension(normalizeFileName(inputFileName))
  );
  fs.mkdirSync(outputDir, { recursive: true });
  const fileSize = getFileSize(inputPath);
  const buffer = Buffer.allocUnsafe(Math.min(fileSize, chunkSize + 4));
  const files = [];
  const descriptor = await fs.promises.open(inputPath, 'r');
  let offset = 0;
  try {
    while (offset < fileSize) {
      const requested = Math.min(buffer.length, fileSize - offset);
      let read = 0;
      while (read < requested) {
        const { bytesRead: count } = await descriptor.read(
          buffer,
          read,
          requested - read,
          offset + read
        );
        if (count === 0) {
          throw new Error('Log file changed while splitting');
        }
        read += count;
      }
      let length = read;
      if (read > chunkSize) {
        const newline = buffer.subarray(0, chunkSize).lastIndexOf(10);
        length = newline >= 0 ? newline + 1 : chunkSize;
        if (newline < 0) {
          while (length > 0 && (buffer[length] & 0xc0) === 0x80) {
            length -= 1;
          }
          // Invalid UTF-8 input still needs byte-preserving forward progress.
          if (length === 0) {
            length = chunkSize;
          }
        }
      }
      const file = path.join(
        outputDir,
        `${prefix}${String(files.length).padStart(2, '0')}${LOG_TEXT_EXTENSION}`
      );
      await fs.promises.writeFile(file, buffer.subarray(0, length));
      files.push(file);
      offset += length;
    }
  } finally {
    await descriptor.close();
  }
  // Widen all suffixes together so lexical ordering works beyond 100 parts.
  const width = Math.max(2, String(files.length - 1).length);
  return files.map((file, index) => {
    const finalPath = path.join(
      outputDir,
      `${prefix}${String(index).padStart(width, '0')}${LOG_TEXT_EXTENSION}`
    );
    if (file !== finalPath) {
      fs.renameSync(file, finalPath);
    }
    return finalPath;
  });
}
