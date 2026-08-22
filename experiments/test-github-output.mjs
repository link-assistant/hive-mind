#!/usr/bin/env node

/**
 * Test script to verify GITHUB_OUTPUT is working correctly
 * Run this locally to test: GITHUB_OUTPUT=/tmp/test-output node experiments/test-github-output.mjs
 */

import { appendFileSync, readFileSync } from 'fs';

const GITHUB_OUTPUT = process.env.GITHUB_OUTPUT;

console.log('GITHUB_OUTPUT environment variable:', GITHUB_OUTPUT || '(not set)');

function setOutput(key, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    const content = `${key}=${value}\n`;
    console.log(`Writing to GITHUB_OUTPUT: ${content.trim()}`);
    appendFileSync(outputFile, content);
    return true;
  } else {
    console.log('GITHUB_OUTPUT not set, skipping output');
    return false;
  }
}

// Simulate what publish-to-npm.mjs does
setOutput('published', 'true');
setOutput('published_version', '0.50.8');

// Try to read back what was written
if (GITHUB_OUTPUT) {
  try {
    const content = readFileSync(GITHUB_OUTPUT, 'utf8');
    console.log('GITHUB_OUTPUT file contents:');
    console.log(content);
  } catch (error) {
    console.log('Could not read GITHUB_OUTPUT file:', error.message);
  }
}

console.log('Test complete');
