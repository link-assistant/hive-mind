#!/usr/bin/env node

/**
 * Release naming conventions for JavaScript package releases.
 *
 * A root package.json means the JavaScript package is the whole repository.
 * A js/package.json means releases share the repository with other languages
 * and need a language namespace in GitHub Releases.
 */

import { getJsRoot } from './js-paths.mjs';

const DEFAULT_LANGUAGE = 'JavaScript';
const MULTI_LANGUAGE_TAG_PREFIX = 'js_v';
const SINGLE_LANGUAGE_TAG_PREFIX = 'v';

export function isMultiLanguage(options = {}) {
  return getJsRoot(options) !== '.';
}

export function getDefaultTagPrefix(options = {}) {
  return isMultiLanguage(options)
    ? MULTI_LANGUAGE_TAG_PREFIX
    : SINGLE_LANGUAGE_TAG_PREFIX;
}

export function getReleaseTagPrefix(options = {}) {
  if (options.tagPrefix !== undefined && options.tagPrefix !== null) {
    return String(options.tagPrefix);
  }

  return getDefaultTagPrefix(options);
}

export function normalizeReleaseVersion(releaseVersion) {
  const trimmedVersion = String(releaseVersion ?? '').trim();

  if (!trimmedVersion) {
    return '';
  }

  const semverTagMatch = trimmedVersion.match(
    /(?:^|[-_])v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/i
  );

  if (semverTagMatch) {
    return semverTagMatch[1];
  }

  return trimmedVersion
    .replace(/^[A-Za-z][A-Za-z0-9]*[-_]v?/i, '')
    .replace(/^v/i, '');
}

export function buildReleaseTag(releaseVersion, options = {}) {
  return `${getReleaseTagPrefix(options)}${normalizeReleaseVersion(
    releaseVersion
  )}`;
}

export function buildReleaseTitle(releaseVersion, options = {}) {
  const titleVersion = normalizeReleaseVersion(releaseVersion);
  const language = (options.language ?? DEFAULT_LANGUAGE).trim();
  const titleLanguage = language || DEFAULT_LANGUAGE;

  if (isMultiLanguage(options)) {
    return `[${titleLanguage}] ${titleVersion}`;
  }

  const packageName = (options.packageName ?? '').trim();
  const singleLanguageName = packageName || titleLanguage;

  return `${singleLanguageName} ${titleVersion}`;
}
