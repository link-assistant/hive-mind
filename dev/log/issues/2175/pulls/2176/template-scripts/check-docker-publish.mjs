#!/usr/bin/env node

/**
 * Validate optional Docker Hub publish configuration.
 *
 * Docker publishing is opt-in. Set DOCKERHUB_IMAGE to enable it, then provide:
 * - DOCKERHUB_USERNAME: Docker Hub account name
 * - DOCKERHUB_TOKEN: Docker Hub access token
 * - DOCKERFILE: Dockerfile path (optional, defaults to ./Dockerfile)
 * - DOCKER_CONTEXT: build context path (optional, defaults to .)
 */

import { appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_CONTEXT = '.';
const DEFAULT_DOCKERFILE = './Dockerfile';

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function hasExplicitTag(image) {
  const lastSegment = image.split('/').at(-1) ?? '';
  return lastSegment.includes(':');
}

function normalizeRelativePath(value, fallback) {
  return clean(value) || fallback;
}

function fileExists(cwd, filePath) {
  return existsSync(path.resolve(cwd, filePath));
}

function directoryExists(cwd, directoryPath) {
  return existsSync(path.resolve(cwd, directoryPath));
}

export function evaluateDockerPublishConfig({
  cwd = process.cwd(),
  env = process.env,
} = {}) {
  const image = clean(env.DOCKERHUB_IMAGE);
  const username = clean(env.DOCKERHUB_USERNAME);
  const token = clean(env.DOCKERHUB_TOKEN);
  const context = normalizeRelativePath(env.DOCKER_CONTEXT, DEFAULT_CONTEXT);
  const dockerfile = normalizeRelativePath(env.DOCKERFILE, DEFAULT_DOCKERFILE);
  const errors = [];

  if (!image) {
    return {
      context,
      dockerfile,
      enabled: false,
      errors,
      image,
      username,
    };
  }

  if (/\s/.test(image)) {
    errors.push('DOCKERHUB_IMAGE must not contain whitespace');
  }

  if (hasExplicitTag(image)) {
    errors.push(
      'DOCKERHUB_IMAGE must not include a tag; release tags are generated from npm'
    );
  }

  if (!username) {
    errors.push('DOCKERHUB_USERNAME is required when DOCKERHUB_IMAGE is set');
  }

  if (!token) {
    errors.push('DOCKERHUB_TOKEN is required when DOCKERHUB_IMAGE is set');
  }

  if (!directoryExists(cwd, context)) {
    errors.push(`Docker context does not exist: ${context}`);
  }

  if (!fileExists(cwd, dockerfile)) {
    errors.push(`Dockerfile does not exist: ${dockerfile}`);
  }

  return {
    context,
    dockerfile,
    enabled: errors.length === 0,
    errors,
    image,
    username,
  };
}

function setOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${name}=${value}\n`);
  }
  console.log(`Output: ${name}=${value}`);
}

function isCliEntryPoint() {
  return (
    typeof process !== 'undefined' &&
    process.argv?.[1] &&
    fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  );
}

export function main({ env = process.env, stderr = console.error } = {}) {
  const config = evaluateDockerPublishConfig({ env });

  setOutput('enabled', config.enabled ? 'true' : 'false');
  setOutput('context', config.context);
  setOutput('dockerfile', config.dockerfile);
  setOutput('image', config.image);

  if (!config.image) {
    console.log(
      'Docker Hub publishing is disabled: DOCKERHUB_IMAGE is not set'
    );
    return 0;
  }

  if (config.errors.length > 0) {
    for (const error of config.errors) {
      stderr(`::error::${error}`);
    }
    return 1;
  }

  console.log(`Docker Hub publishing is enabled for ${config.image}`);
  return 0;
}

if (isCliEntryPoint()) {
  process.exitCode = main();
}
