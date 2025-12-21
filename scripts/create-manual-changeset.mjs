#!/usr/bin/env node

/**
 * Create a changeset file for manual releases
 * Usage: node scripts/create-manual-changeset.mjs --bump-type <major|minor|patch> [--description <description>]
 *
 * Uses link-foundation libraries:
 * - use-m: Dynamic package loading without package.json dependencies
 * - command-stream: Modern shell command execution with streaming support
 * - lino-arguments: Unified configuration from CLI args, env vars, and .lenv files
 */

import { writeFileSync } from 'fs';
import { randomBytes } from 'crypto';

const PACKAGE_NAME = '@link-assistant/hive-mind';

// Load use-m dynamically
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

// Import link-foundation libraries
const { $ } = await use('command-stream');
const { makeConfig } = await use('lino-arguments');

// Parse CLI arguments using lino-arguments
const config = makeConfig({
  yargs: ({ yargs, getenv }) =>
    yargs
      .option('bump-type', {
        type: 'string',
        default: getenv('BUMP_TYPE', ''),
        describe: 'Version bump type: major, minor, or patch',
        choices: ['major', 'minor', 'patch']
      })
      .option('description', {
        type: 'string',
        default: getenv('DESCRIPTION', ''),
        describe: 'Description for the changeset'
      })
});

try {
  const { bumpType, description: descriptionArg } = config;

  // Use provided description or default based on bump type
  const description = descriptionArg || `Manual ${bumpType} release`;

  if (!bumpType || !['major', 'minor', 'patch'].includes(bumpType)) {
    console.error(
      'Usage: node scripts/create-manual-changeset.mjs --bump-type <major|minor|patch> [--description <description>]'
    );
    process.exit(1);
  }

  // Generate a random changeset ID
  const changesetId = randomBytes(4).toString('hex');
  const changesetFile = `.changeset/manual-release-${changesetId}.md`;

  // Create the changeset file with single quotes to match Prettier config
  const content = `---
'${PACKAGE_NAME}': ${bumpType}
---

${description}
`;

  writeFileSync(changesetFile, content, 'utf-8');

  console.log(`Created changeset: ${changesetFile}`);
  console.log('Content:');
  console.log(content);

  // Format with Prettier
  console.log('\nFormatting with Prettier...');
  await $`npx prettier --write "${changesetFile}"`;

  console.log('\nChangeset created and formatted successfully');
} catch (error) {
  console.error('Error creating changeset:', error.message);
  if (process.env.DEBUG) {
    console.error('Stack trace:', error.stack);
  }
  process.exit(1);
}
