// Test URL parsing for issue #1102
// This script tests the parseGitHubUrl function with the problematic URLs

import { parseGitHubUrl } from '../../src/github.lib.mjs';

const testUrls = ['https://github.com/VisageDvachevsky/StoryGraph', 'https://github.com/VisageDvachevsky/StoryGraph/issues', 'https://github.com/VisageDvachevsky/StoryGraph/issues/1'];

console.log('Testing URL parsing for issue #1102\n');
console.log('='.repeat(60));

for (const url of testUrls) {
  console.log(`\nURL: ${url}`);
  const parsed = parseGitHubUrl(url);
  console.log('Parsed:', JSON.stringify(parsed, null, 2));
}

// Test which URL types are allowed for /hive command
const hiveAllowedTypes = ['repo', 'organization', 'user'];
console.log('\n' + '='.repeat(60));
console.log('\n/hive command allowed types:', hiveAllowedTypes);
console.log('\nValidation results:');

for (const url of testUrls) {
  const parsed = parseGitHubUrl(url);
  const isAllowed = parsed.valid && hiveAllowedTypes.includes(parsed.type);
  console.log(`\n${url}:`);
  console.log(`  Type: ${parsed.type}`);
  console.log(`  Valid: ${parsed.valid}`);
  console.log(`  Allowed for /hive: ${isAllowed}`);
}
