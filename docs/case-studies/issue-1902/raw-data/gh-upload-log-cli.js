#!/usr/bin/env bun

/**
 * gh-upload-log CLI
 *
 * Command-line interface for uploading log files to GitHub
 */

import { makeConfig } from 'lino-arguments';
import { uploadLog, getFileSize, formatFileSize, fileExists, isENOSPC } from './index.js';

// Parse command-line arguments with environment variable and .lenv support
const config = makeConfig({
  yargs: ({ yargs, getenv }) =>
    yargs
      .usage('Usage: $0 <log-file> [options]')
      .command('$0 [logFile]', 'Upload a log file to GitHub', yargs => {
        yargs.positional('logFile', {
          describe: 'Path to the log file to upload',
          type: 'string',
        });
      })
      .option('public', {
        alias: 'p',
        type: 'boolean',
        description: 'Make the upload public (default: private)',
      })
      .option('private', {
        type: 'boolean',
        description: 'Make the upload private (default)',
      })
      .option('auto', {
        type: 'boolean',
        description: 'Automatically choose upload strategy based on file size (default)',
        default: getenv('GH_UPLOAD_LOG_AUTO', true),
      })
      .option('only-gist', {
        type: 'boolean',
        description: 'Upload only as GitHub Gist (disables auto mode)',
      })
      .option('only-repository', {
        type: 'boolean',
        description: 'Upload only as GitHub Repository (disables auto mode)',
      })
      .option('shared-repository', {
        type: 'boolean',
        description: 'Upload large repository-mode logs into shared private-logs/public-logs repositories (default: true)',
        default: getenv('GH_UPLOAD_LOG_SHARED_REPOSITORY', true),
      })
      .option('dry-mode', {
        alias: 'dry',
        type: 'boolean',
        description: 'Dry run mode - show what would be done without uploading',
        default: getenv('GH_UPLOAD_LOG_DRY_MODE', false),
      })
      .option('description', {
        alias: 'd',
        type: 'string',
        description: 'Description for the upload',
        default: getenv('GH_UPLOAD_LOG_DESCRIPTION', ''),
      })
      .option('verbose', {
        alias: 'v',
        type: 'boolean',
        description: 'Enable verbose output',
        default: getenv('GH_UPLOAD_LOG_VERBOSE', false),
      })
      .option('test', {
        alias: 't',
        type: 'boolean',
        description: 'Run self-test to verify upload functionality',
        default: false,
      })
      .option('quick', {
        alias: 'q',
        type: 'boolean',
        description: 'Run quick self-test (only 1MB file)',
        default: false,
      })
      .conflicts('public', 'private')
      .conflicts('only-gist', 'only-repository')
      .check(argv => {
        // Skip validation if running self-test
        if (argv.test || argv.quick) {
          return true;
        }
        // If --no-auto is used, require either --only-gist or --only-repository
        if (argv.auto === false && !argv.onlyGist && !argv.onlyRepository) {
          throw new Error('When using --no-auto, you must specify either --only-gist or --only-repository');
        }
        // If --only-gist or --only-repository is used, auto mode is disabled
        if (argv.onlyGist || argv.onlyRepository) {
          argv.auto = false;
        }
        return true;
      })
      .example('$0 /var/log/app.log', 'Upload log file (auto mode, private)')
      .example('$0 /var/log/app.log --public', 'Upload log file (auto mode, public)')
      .example('$0 ./error.log --only-gist', 'Upload only as gist')
      .example('$0 ./large.log --only-repository --public', 'Upload only as public repository')
      .example('$0 ./large.log --only-repository --no-shared-repository', 'Use the legacy dedicated repository mode for a large file')
      .example('$0 ./app.log --dry-mode', 'Dry run - show what would be done')
      .example('$0 --test', 'Run self-test to verify functionality')
      .example('$0 --quick', 'Run quick self-test (1MB file only)')
      .help('h')
      .alias('h', 'help')
      .version('0.1.0')
      .strict(),
});

/**
 * Main CLI function
 */
async function main() {
  try {
    // Handle self-test mode
    if (config.test || config.quick) {
      const { runSelfTest } = await import('./self-test.js');
      const result = await runSelfTest({
        verbose: config.verbose,
        quick: config.quick,
      });
      process.exit(result.passed ? 0 : 1);
    }

    const logFile = config.logFile;

    if (!logFile) {
      console.error('❌ Error: Log file path is required');
      console.error('Usage: gh-upload-log <log-file> [options]');
      console.error('Run "gh-upload-log --help" for more information');
      process.exit(1);
    }

    if (!fileExists(logFile)) {
      console.error(`❌ Error: File does not exist: ${logFile}`);
      process.exit(1);
    }

    // Prepare options
    // If neither public nor private is specified, default to private
    const isPublic = config.public === true ? true : config.private === false ? true : false;

    const options = {
      filePath: logFile,
      isPublic,
      auto: config.auto,
      onlyGist: config.onlyGist,
      onlyRepository: config.onlyRepository,
      useSharedRepository: config.sharedRepository,
      dryMode: config.dryMode,
      description: config.description,
      verbose: config.verbose,
    };

    if (options.verbose) {
      console.log('Options:', options);
      console.log('');
    }

    // Get file size for display (file existence already verified above)
    const fileSize = getFileSize(logFile);

    // Show concise upload status
    const visibility = isPublic ? '🌐 public' : '🔒 private';
    const dryModePrefix = options.dryMode ? '[DRY] ' : '';

    if (options.verbose) {
      console.log(`📁 ${logFile}`);
      console.log(`📊 ${formatFileSize(fileSize)}`);
      console.log('');
    }

    console.log(`${dryModePrefix}⏳ Uploading ${formatFileSize(fileSize)} (${visibility})...`);

    const result = await uploadLog(options);

    // Display concise results
    const typeEmoji = result.type === 'gist' ? '📝' : '📦';
    const typeLabel = result.type === 'gist' ? 'Gist' : 'Repository';
    const successEmoji = result.dryMode ? '🔍' : result.deduplicated ? 'ℹ️' : '✅';
    const actionLabel = result.dryMode ? 'would be created' : result.deduplicated ? 'already exists' : 'created';

    console.log(`${successEmoji} ${typeLabel} ${actionLabel} (${visibility})`);

    if (result.url && !result.dryMode) {
      console.log(`🔗 ${result.url}`);
    }

    // Display raw file URL if available (single file only)
    if (result.rawUrl && !result.dryMode) {
      console.log(`📄 ${result.rawUrl}`);
      // Add expiration warning for private repository raw URLs
      if (result.type === 'repo' && !result.isPublic && result.rawUrl.includes('?token=')) {
        console.log(`⚠️  Note: Raw URL token expires in ~10 minutes for private repositories`);
      }
    }

    // Show additional details only in verbose mode
    if (options.verbose) {
      console.log('');
      console.log('Details:');
      console.log(`  Type: ${typeEmoji} ${typeLabel}`);
      console.log(`  Visibility: ${result.isPublic ? 'public' : 'private'}`);
      console.log(`  File count: ${result.fileCount || 1}`);
      if (result.type === 'gist') {
        console.log(`  File name: ${result.fileName}`);
      } else if (result.type === 'repo') {
        console.log(`  Repository: ${result.repositoryName}`);
        if (result.repositoryPath) {
          console.log(`  Path: ${result.repositoryPath}`);
        }
      }
      if (result.rawUrl) {
        console.log(`  Raw URL: ${result.rawUrl}`);
      }
    }

    process.exit(0);
  } catch (error) {
    if (isENOSPC(error)) {
      console.error('❌ Error: No space left on device');
      console.error('');
      console.error('Suggestions to free disk space:');
      console.error('  • Check ~/.claude/debug for large debug files');
      console.error('  • Clean /tmp directory: rm -rf /tmp/log-*');
      console.error('  • Check disk usage: df -h && du -sh /tmp ~/.claude');
      if (error.message && error.message.includes('--only-gist')) {
        console.error('');
        console.error('💡 Hint: This file fits in a gist. Try --only-gist to upload');
        console.error('   without requiring temporary disk space.');
      }
    } else {
      console.error('❌ Error:', error.message);
    }

    if (config.verbose) {
      console.error('');
      console.error('Stack trace:');
      console.error(error.stack);
      if (error.originalError) {
        console.error('');
        console.error('Original error:');
        console.error(error.originalError.stack || error.originalError.message);
      }
    }

    process.exit(1);
  }
}

// Run the CLI
main();
