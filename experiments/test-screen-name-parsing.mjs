#!/usr/bin/env node
// Experiment to understand parse-github-url behavior and test the fix

// Load use-m dynamically from unpkg
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

// Dynamically load parse-github-url using use-m
const parseGitHubUrlModule = await use('parse-github-url@1.0.3');
const parseGitHubUrlLib = parseGitHubUrlModule.default || parseGitHubUrlModule;

console.log('='.repeat(60));
console.log('Testing parse-github-url library behavior');
console.log('='.repeat(60));

const testUrls = ['https://github.com/veb86/zcadvelecAI/issues/19', 'https://github.com/veb86/zcadvelecAI/pull/25', 'https://github.com/veb86/zcadvelecAI'];

for (const url of testUrls) {
  console.log(`\nURL: ${url}`);
  const parsed = parseGitHubUrlLib(url);
  console.log(`  branch: "${parsed.branch}"`);
  console.log(`  filepath: "${parsed.filepath}"`);
  console.log(`  owner: "${parsed.owner}"`);
  console.log(`  name: "${parsed.name}"`);
}

console.log('\n' + '='.repeat(60));
console.log('Testing current (BUGGY) parseGitHubUrl logic');
console.log('='.repeat(60));

function parseGitHubUrlBuggy(url) {
  const parsed = parseGitHubUrlLib(url);

  if (!parsed || !parsed.owner || !parsed.name) {
    return { valid: false };
  }

  const result = {
    valid: true,
    owner: parsed.owner,
    repo: parsed.name,
    type: 'unknown',
    number: null,
  };

  // BUG: This checks filepath which is "19", not "issues/19"
  if (parsed.filepath) {
    const pathParts = parsed.filepath.split('/');

    if (pathParts[0] === 'issues' && /^\d+$/.test(pathParts[1])) {
      result.type = 'issue';
      result.number = parseInt(pathParts[1], 10);
    } else if (pathParts[0] === 'pull' && /^\d+$/.test(pathParts[1])) {
      result.type = 'pr';
      result.number = parseInt(pathParts[1], 10);
    }
  }

  return result;
}

for (const url of testUrls) {
  console.log(`\nURL: ${url}`);
  const result = parseGitHubUrlBuggy(url);
  console.log(`  type: ${result.type}, number: ${result.number}`);
}

console.log('\n' + '='.repeat(60));
console.log('Testing FIXED parseGitHubUrl logic');
console.log('='.repeat(60));

function parseGitHubUrlFixed(url) {
  const parsed = parseGitHubUrlLib(url);

  if (!parsed || !parsed.owner || !parsed.name) {
    return { valid: false };
  }

  const result = {
    valid: true,
    owner: parsed.owner,
    repo: parsed.name,
    type: 'unknown',
    number: null,
  };

  // FIX: Check the branch property for "issues" or "pull"
  if (parsed.branch === 'issues' && parsed.filepath && /^\d+$/.test(parsed.filepath)) {
    result.type = 'issue';
    result.number = parseInt(parsed.filepath, 10);
  } else if (parsed.branch === 'pull' && parsed.filepath && /^\d+$/.test(parsed.filepath)) {
    result.type = 'pr';
    result.number = parseInt(parsed.filepath, 10);
  } else if (parsed.owner && parsed.name && !parsed.branch) {
    result.type = 'repo';
  }

  return result;
}

for (const url of testUrls) {
  console.log(`\nURL: ${url}`);
  const result = parseGitHubUrlFixed(url);
  console.log(`  type: ${result.type}, number: ${result.number}`);
}

console.log('\n' + '='.repeat(60));
console.log('Testing screen name generation');
console.log('='.repeat(60));

function generateScreenName(command, githubUrl) {
  const parsed = parseGitHubUrlFixed(githubUrl);

  if (!parsed.valid) {
    return `${command}-invalid`;
  }

  const parts = [command];

  if (parsed.owner) {
    parts.push(parsed.owner);
  }

  if (parsed.repo) {
    parts.push(parsed.repo);
  }

  if (parsed.number) {
    parts.push(parsed.number);
  }

  return parts.join('-');
}

console.log('\nCommand: solve');
console.log('URL: https://github.com/veb86/zcadvelecAI/issues/19');
console.log('Expected: solve-veb86-zcadvelecAI-19');
console.log('Got:      ' + generateScreenName('solve', 'https://github.com/veb86/zcadvelecAI/issues/19'));

console.log('\nCommand: solve');
console.log('URL: https://github.com/veb86/zcadvelecAI');
console.log('Expected: solve-veb86-zcadvelecAI');
console.log('Got:      ' + generateScreenName('solve', 'https://github.com/veb86/zcadvelecAI'));

console.log('\n' + '='.repeat(60));
