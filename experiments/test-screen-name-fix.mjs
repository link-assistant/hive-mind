#!/usr/bin/env node
// Direct test of the fixed start-screen.mjs generateScreenName function

// Load use-m dynamically from unpkg (same as start-screen.mjs)
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

// Dynamically load parse-github-url using use-m
const parseGitHubUrlModule = await use('parse-github-url@1.0.3');
const parseGitHubUrlLib = parseGitHubUrlModule.default || parseGitHubUrlModule;

// Copy the FIXED parseGitHubUrl function from start-screen.mjs
function parseGitHubUrl(url) {
  if (!url || typeof url !== 'string') {
    return {
      valid: false,
      error: 'Invalid input: URL must be a non-empty string'
    };
  }

  try {
    // Use parse-github-url library loaded via use-m
    const parsed = parseGitHubUrlLib(url);

    if (!parsed || !parsed.owner || !parsed.name) {
      return {
        valid: false,
        error: 'Invalid GitHub URL: missing owner/repo'
      };
    }

    const result = {
      valid: true,
      normalized: parsed.href || url,
      hostname: parsed.host || 'github.com',
      owner: parsed.owner,
      repo: parsed.name,
      type: 'unknown',
      path: parsed.filepath || '',
      number: null
    };

    // Determine the type based on branch and filepath
    // Note: parse-github-url treats "issues" as a branch, not part of filepath
    if (parsed.branch === 'issues' && parsed.filepath && /^\d+$/.test(parsed.filepath)) {
      result.type = 'issue';
      result.number = parseInt(parsed.filepath, 10);
    } else if (parsed.branch === 'pull' && parsed.filepath && /^\d+$/.test(parsed.filepath)) {
      result.type = 'pr';
      result.number = parseInt(parsed.filepath, 10);
    } else if (parsed.owner && parsed.name) {
      result.type = 'repo';
    } else if (parsed.owner) {
      result.type = 'owner';
    }

    return result;
  } catch (error) {
    return {
      valid: false,
      error: 'Invalid GitHub URL format: ' + error.message
    };
  }
}

// Copy generateScreenName function from start-screen.mjs
function generateScreenName(command, githubUrl) {
  const parsed = parseGitHubUrl(githubUrl);

  if (!parsed.valid) {
    // Fallback to simple naming if parsing fails
    const sanitized = githubUrl.replace(/[^a-zA-Z0-9-]/g, '-').substring(0, 30);
    return `${command}-${sanitized}`;
  }

  // Build name parts
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

// Test cases
console.log('='.repeat(70));
console.log('Testing FIXED start-screen.mjs logic');
console.log('='.repeat(70));

const testCases = [
  {
    command: 'solve',
    url: 'https://github.com/veb86/zcadvelecAI/issues/19',
    expected: 'solve-veb86-zcadvelecAI-19',
    description: 'Issue #19 from the bug report'
  },
  {
    command: 'solve',
    url: 'https://github.com/link-assistant/hive-mind/issues/348',
    expected: 'solve-link-assistant-hive-mind-348',
    description: 'Current issue being fixed'
  },
  {
    command: 'hive',
    url: 'https://github.com/veb86/zcadvelecAI',
    expected: 'hive-veb86-zcadvelecAI',
    description: 'Repository without issue number'
  },
  {
    command: 'solve',
    url: 'https://github.com/openai/gpt-4/pull/100',
    expected: 'solve-openai-gpt-4-100',
    description: 'Pull request URL'
  }
];

let allPassed = true;

for (const testCase of testCases) {
  const { command, url, expected, description } = testCase;
  const result = generateScreenName(command, url);
  const passed = result === expected;

  if (!passed) allPassed = false;

  console.log(`\n${passed ? '✓' : '✗'} ${description}`);
  console.log(`  URL:      ${url}`);
  console.log(`  Expected: ${expected}`);
  console.log(`  Got:      ${result}`);

  if (passed) {
    console.log('  Status:   PASS');
  } else {
    console.log('  Status:   FAIL');
  }
}

console.log('\n' + '='.repeat(70));
if (allPassed) {
  console.log('✓ All tests PASSED!');
  process.exit(0);
} else {
  console.log('✗ Some tests FAILED!');
  process.exit(1);
}
