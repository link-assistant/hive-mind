#!/usr/bin/env node

// Use use-m to dynamically import modules for cross-runtime compatibility
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

const yargs = (await use('yargs@latest')).default;
const path = (await use('path')).default;
const fs = (await use('fs')).promises;

// Global log file reference
let logFile = null;

// Helper function to log to both console and file
const log = async (message, options = {}) => {
  const { level = 'info', verbose = false } = options;
  
  // Skip verbose logs unless --verbose is enabled
  if (verbose && !global.verboseMode) {
    return;
  }
  
  // Write to file if log file is set
  if (logFile) {
    const logMessage = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`;
    await fs.appendFile(logFile, logMessage + '\n').catch(() => {});
  }
  
  // Write to console based on level
  switch (level) {
    case 'error':
      console.error(message);
      break;
    case 'warning':
    case 'warn':
      console.warn(message);
      break;
    case 'info':
    default:
      console.log(message);
      break;
  }
};

// Configure command line arguments
const argv = yargs(process.argv.slice(2))
  .usage('Usage: $0 <github-url> [options]')
  .positional('github-url', {
    type: 'string',
    description: 'GitHub organization, repository, or user URL to monitor for pull requests'
  })
  .option('review-label', {
    type: 'string',
    description: 'GitHub label to identify PRs needing review',
    default: 'needs-review',
    alias: 'l'
  })
  .option('all-prs', {
    type: 'boolean',
    description: 'Review all open pull requests regardless of labels',
    default: false,
    alias: 'a'
  })
  .option('skip-draft', {
    type: 'boolean',
    description: 'Skip draft pull requests',
    default: true,
    alias: 'd'
  })
  .option('skip-approved', {
    type: 'boolean',
    description: 'Skip pull requests that already have approvals',
    default: true
  })
  .option('concurrency', {
    type: 'number',
    description: 'Number of concurrent review.mjs instances',
    default: 2,
    alias: 'c'
  })
  .option('reviews-per-pr', {
    type: 'number',
    description: 'Number of reviews to generate per PR (for diverse perspectives)',
    default: 1,
    alias: 'r'
  })
  .option('model', {
    type: 'string',
    description: 'Model to use for review.mjs (opus or sonnet)',
    alias: 'm',
    default: 'opus',
    choices: ['opus', 'sonnet']
  })
  .option('focus', {
    type: 'string',
    description: 'Focus areas for reviews (security, performance, logic, style, tests, all)',
    default: 'all',
    alias: 'f'
  })
  .option('auto-approve', {
    type: 'boolean',
    description: 'Auto-approve PRs that pass review criteria',
    default: false
  })
  .option('interval', {
    type: 'number',
    description: 'Polling interval in seconds',
    default: 300, // 5 minutes
    alias: 'i'
  })
  .option('max-prs', {
    type: 'number',
    description: 'Maximum number of PRs to process (0 = unlimited)',
    default: 0
  })
  .option('dry-run', {
    type: 'boolean',
    description: 'List PRs that would be reviewed without actually reviewing them',
    default: false
  })
  .option('verbose', {
    type: 'boolean',
    description: 'Enable verbose logging',
    alias: 'v',
    default: false
  })
  .option('once', {
    type: 'boolean',
    description: 'Run once and exit instead of continuous monitoring',
    default: false
  })
  .demandCommand(1, 'GitHub URL is required')
  .help('h')
  .alias('h', 'help')
  .argv;

const githubUrl = argv['github-url'] || argv._[0];

// Set global verbose mode
global.verboseMode = argv.verbose;

// Create log file with timestamp
const scriptDir = path.dirname(process.argv[1]);
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
logFile = path.join(scriptDir, `reviewers-hive-${timestamp}.log`);

// Create the log file immediately
await fs.writeFile(logFile, `# Reviewers-Hive.mjs Log - ${new Date().toISOString()}\n\n`);
await log(`📁 Log file: ${logFile}`);
await log('   (All output will be logged here)\n');

// Parse GitHub URL to determine organization, repository, or user
let scope = 'repository';
let owner = null;
let repo = null;

// Parse URL format: https://github.com/owner or https://github.com/owner/repo
const urlMatch = githubUrl.match(/^https:\/\/github\.com\/([^/]+)(\/([^/]+))?$/);
if (!urlMatch) {
  await log('Error: Invalid GitHub URL format', { level: 'error' });
  await log('Expected: https://github.com/owner or https://github.com/owner/repo', { level: 'error' });
  process.exit(1);
}

owner = urlMatch[1];
repo = urlMatch[3] || null;

// Determine scope
if (!repo) {
  // Check if it's an organization or user
  try {
    const typeResult = await $`gh api users/${owner} --jq .type`;
    const accountType = typeResult.stdout.toString().trim();
    scope = accountType === 'Organization' ? 'organization' : 'user';
  } catch {
    // Default to user if API call fails
    scope = 'user';
  }
} else {
  scope = 'repository';
}

await log('🎯 PR Review Monitoring Configuration:');
await log(`   📍 Target: ${scope.charAt(0).toUpperCase() + scope.slice(1)} - ${owner}${repo ? `/${repo}` : ''}`);
if (argv.allPrs) {
  await log('   🏷️  Mode: ALL PULL REQUESTS (no label filter)');
} else {
  await log(`   🏷️  Label: "${argv.reviewLabel}"`);
}
if (argv.skipDraft) {
  await log('   🚫 Skipping: Draft PRs');
}
if (argv.skipApproved) {
  await log('   🚫 Skipping: Already approved PRs');
}
await log(`   🔄 Concurrency: ${argv.concurrency} parallel reviewers`);
await log(`   📊 Reviews per PR: ${argv.reviewsPerPr}`);
await log(`   🤖 Model: ${argv.model}`);
await log(`   🎯 Focus: ${argv.focus}`);
if (argv.autoApprove) {
  await log('   ✅ Auto-approve: Enabled');
}
if (!argv.once) {
  await log(`   ⏱️  Polling Interval: ${argv.interval} seconds`);
}
await log(`   ${argv.once ? '🚀 Mode: Single run' : '♾️  Mode: Continuous monitoring'}`);
if (argv.maxPrs > 0) {
  await log(`   🔢 Max PRs: ${argv.maxPrs}`);
}
if (argv.dryRun) {
  await log('   🧪 DRY RUN MODE - No actual reviewing');
}
await log('');

// Producer/Consumer Queue implementation for PRs
class PRQueue {
  constructor() {
    this.queue = [];
    this.processing = new Set();
    this.completed = new Set();
    this.failed = new Set();
    this.workers = [];
    this.isRunning = true;
  }

  // Add PR to queue if not already processed or in queue
  enqueue(prUrl) {
    if (this.completed.has(prUrl) || 
        this.processing.has(prUrl) || 
        this.queue.includes(prUrl)) {
      return false;
    }
    this.queue.push(prUrl);
    return true;
  }

  // Get next PR from queue
  dequeue() {
    if (this.queue.length === 0) {
      return null;
    }
    const pr = this.queue.shift();
    this.processing.add(pr);
    return pr;
  }

  // Mark PR as completed
  markCompleted(prUrl) {
    this.processing.delete(prUrl);
    this.completed.add(prUrl);
  }

  // Mark PR as failed
  markFailed(prUrl) {
    this.processing.delete(prUrl);
    this.failed.add(prUrl);
  }

  // Get queue statistics
  getStats() {
    return {
      queued: this.queue.length,
      processing: this.processing.size,
      completed: this.completed.size,
      failed: this.failed.size
    };
  }

  // Stop all workers
  stop() {
    this.isRunning = false;
  }
}

// Create global queue instance
const prQueue = new PRQueue();

// Worker function to review PRs from queue
async function reviewer(reviewerId) {
  await log(`🔍 Reviewer ${reviewerId} started`, { verbose: true });
  
  while (prQueue.isRunning) {
    const prUrl = prQueue.dequeue();
    
    if (!prUrl) {
      // No work available, wait a bit
      await new Promise(resolve => setTimeout(resolve, 5000));
      continue;
    }

    await log(`\n👀 Reviewer ${reviewerId} reviewing: ${prUrl}`);
    
    // Review the PR multiple times if needed (for diverse perspectives)
    for (let reviewNum = 1; reviewNum <= argv.reviewsPerPr; reviewNum++) {
      if (argv.reviewsPerPr > 1) {
        await log(`   📝 Creating review ${reviewNum}/${argv.reviewsPerPr} for PR`);
      }
      
      try {
        if (argv.dryRun) {
          await log(`   🧪 [DRY RUN] Would execute: ./review.mjs "${prUrl}" --model ${argv.model} --focus ${argv.focus}${argv.autoApprove ? ' --approve' : ''}`);
          await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate work
        } else {
          // Execute review.mjs using command-stream
          await log(`   🚀 Executing review.mjs for ${prUrl}...`);
          
          const startTime = Date.now();
          let reviewCommand = $`./review.mjs "${prUrl}" --model ${argv.model} --focus ${argv.focus}`;
          
          if (argv.autoApprove) {
            reviewCommand = $`./review.mjs "${prUrl}" --model ${argv.model} --focus ${argv.focus} --approve`;
          }
          
          // Stream output and capture result
          let exitCode = 0;
          for await (const chunk of reviewCommand.stream()) {
            if (chunk.type === 'stdout') {
              const output = chunk.data.toString().trim();
              if (output) {
                await log(`   [review.mjs] ${output}`, { verbose: true });
              }
            } else if (chunk.type === 'stderr') {
              const error = chunk.data.toString().trim();
              if (error) {
                await log(`   [review.mjs ERROR] ${error}`, { level: 'error', verbose: true });
              }
            } else if (chunk.type === 'exit') {
              exitCode = chunk.code;
            }
          }
          
          const duration = Math.round((Date.now() - startTime) / 1000);
          
          if (exitCode === 0) {
            await log(`   ✅ Reviewer ${reviewerId} completed ${prUrl} (${duration}s)`);
          } else {
            throw new Error(`review.mjs exited with code ${exitCode}`);
          }
        }
        
        // Small delay between multiple reviews for same PR
        if (reviewNum < argv.reviewsPerPr) {
          await new Promise(resolve => setTimeout(resolve, 10000));
        }
      } catch (error) {
        await log(`   ❌ Reviewer ${reviewerId} failed on ${prUrl}: ${error.message}`, { level: 'error' });
        prQueue.markFailed(prUrl);
        break; // Stop trying more reviews for this PR
      }
    }
    
    prQueue.markCompleted(prUrl);
    
    // Show queue stats
    const stats = prQueue.getStats();
    await log(`   📊 Queue: ${stats.queued} waiting, ${stats.processing} reviewing, ${stats.completed} completed, ${stats.failed} failed`);
  }
  
  await log(`🔍 Reviewer ${reviewerId} stopped`, { verbose: true });
}

// Function to check if a PR already has approvals
async function hasApprovals(prUrl) {
  try {
    const { execSync } = await import('child_process');
    
    // Extract owner, repo, and PR number from URL
    const urlMatch = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!urlMatch) return false;
    
    const [, prOwner, prRepo, prNumber] = urlMatch;
    
    // Check for reviews using GitHub API
    const cmd = `gh api repos/${prOwner}/${prRepo}/pulls/${prNumber}/reviews --jq '[.[] | select(.state == "APPROVED")] | length'`;
    
    const output = execSync(cmd, { encoding: 'utf8' }).trim();
    const approvalCount = parseInt(output) || 0;
    
    if (approvalCount > 0) {
      await log(`      ↳ Skipping (has ${approvalCount} approval${approvalCount > 1 ? 's' : ''})`, { verbose: true });
      return true;
    }
    
    return false;
  } catch (error) {
    // If we can't check, assume no approvals
    await log(`      ↳ Could not check for approvals: ${error.message.split('\n')[0]}`, { verbose: true });
    return false;
  }
}

// Function to fetch pull requests from GitHub
async function fetchPullRequests() {
  if (argv.allPrs) {
    await log('\n🔍 Fetching ALL open pull requests...');
  } else {
    await log(`\n🔍 Fetching pull requests with label "${argv.reviewLabel}"...`);
  }
  
  try {
    let prs = [];
    
    if (argv.allPrs) {
      // Fetch all open PRs without label filter
      let searchCmd;
      if (scope === 'repository') {
        searchCmd = `gh pr list --repo ${owner}/${repo} --state open --limit 100 --json url,title,number,isDraft`;
      } else if (scope === 'organization') {
        searchCmd = `gh search prs org:${owner} is:open --limit 100 --json url,title,number,repository,isDraft`;
      } else {
        // User scope
        searchCmd = `gh search prs user:${owner} is:open --limit 100 --json url,title,number,repository,isDraft`;
      }
      
      await log(`   🔎 Command: ${searchCmd}`, { verbose: true });
      
      // Use execSync to avoid escaping issues
      const { execSync } = await import('child_process');
      const output = execSync(searchCmd, { encoding: 'utf8' });
      prs = JSON.parse(output || '[]');
      
    } else {
      // Use label filter
      const { execSync } = await import('child_process');
      
      // For repositories, use gh pr list which works better
      if (scope === 'repository') {
        const listCmd = `gh pr list --repo ${owner}/${repo} --state open --label "${argv.reviewLabel}" --limit 100 --json url,title,number,isDraft`;
        await log(`   🔎 Command: ${listCmd}`, { verbose: true });
        
        try {
          const output = execSync(listCmd, { encoding: 'utf8' });
          prs = JSON.parse(output || '[]');
        } catch (listError) {
          await log(`   ⚠️  List failed: ${listError.message.split('\n')[0]}`, { verbose: true });
          prs = [];
        }
      } else {
        // For organizations and users, use search
        let baseQuery;
        if (scope === 'organization') {
          baseQuery = `org:${owner} is:pr is:open`;
        } else {
          baseQuery = `user:${owner} is:pr is:open`;
        }
        
        // Handle label with potential spaces
        let searchQuery;
        let searchCmd;
        
        if (argv.reviewLabel.includes(' ')) {
          searchQuery = `${baseQuery} label:"${argv.reviewLabel}"`;
          searchCmd = `gh search prs '${searchQuery}' --limit 100 --json url,title,number,repository,isDraft`;
        } else {
          searchQuery = `${baseQuery} label:${argv.reviewLabel}`;
          searchCmd = `gh search prs '${searchQuery}' --limit 100 --json url,title,number,repository,isDraft`;
        }
        
        await log(`   🔎 Search query: ${searchQuery}`, { verbose: true });
        await log(`   🔎 Command: ${searchCmd}`, { verbose: true });
        
        try {
          const output = execSync(searchCmd, { encoding: 'utf8' });
          prs = JSON.parse(output || '[]');
        } catch (searchError) {
          await log(`   ⚠️  Search failed: ${searchError.message.split('\n')[0]}`, { verbose: true });
          prs = [];
        }
      }
    }
    
    if (prs.length === 0) {
      if (argv.allPrs) {
        await log('   ℹ️  No open pull requests found');
      } else {
        await log(`   ℹ️  No pull requests found with label "${argv.reviewLabel}"`);
      }
      return [];
    }
    
    if (argv.allPrs) {
      await log(`   📋 Found ${prs.length} open pull request(s)`);
    } else {
      await log(`   📋 Found ${prs.length} pull request(s) with label "${argv.reviewLabel}"`);
    }
    
    // Filter out draft PRs if option is enabled
    if (argv.skipDraft) {
      const nonDraftPrs = prs.filter(pr => !pr.isDraft);
      const draftCount = prs.length - nonDraftPrs.length;
      if (draftCount > 0) {
        await log(`   ⏭️  Filtered out ${draftCount} draft PR(s)`);
      }
      prs = nonDraftPrs;
    }
    
    // Apply max PRs limit if set
    let prsToProcess = prs;
    if (argv.maxPrs > 0 && prs.length > argv.maxPrs) {
      prsToProcess = prs.slice(0, argv.maxPrs);
      await log(`   🔢 Limiting to first ${argv.maxPrs} PRs`);
    }
    
    // Filter out PRs with approvals if option is enabled
    if (argv.skipApproved) {
      await log('   🔍 Checking for existing approvals...');
      const filteredPrs = [];
      
      for (const pr of prsToProcess) {
        const hasApproval = await hasApprovals(pr.url);
        if (hasApproval) {
          await log(`      ⏭️  Skipping (approved): ${pr.title || 'Untitled'} (${pr.url})`, { verbose: true });
        } else {
          filteredPrs.push(pr);
        }
      }
      
      const skippedCount = prsToProcess.length - filteredPrs.length;
      if (skippedCount > 0) {
        await log(`   ⏭️  Skipped ${skippedCount} PR(s) with existing approvals`);
      }
      prsToProcess = filteredPrs;
    }
    
    // In dry-run mode, show the PRs that would be reviewed
    if (argv.dryRun && prsToProcess.length > 0) {
      await log('\n   📝 PRs that would be reviewed:');
      for (const pr of prsToProcess) {
        await log(`      - ${pr.title || 'Untitled'} (${pr.url})`);
      }
    }
    
    return prsToProcess.map(pr => pr.url);
    
  } catch (error) {
    await log(`   ❌ Error fetching pull requests: ${error.message}`, { level: 'error' });
    return [];
  }
}

// Main monitoring loop
async function monitor() {
  await log('\n🚀 Starting Reviewers Hive Mind monitoring system...');
  
  // Start reviewers
  await log(`\n👀 Starting ${argv.concurrency} reviewers...`);
  for (let i = 1; i <= argv.concurrency; i++) {
    prQueue.workers.push(reviewer(i));
  }
  
  // Main monitoring loop
  let iteration = 0;
  while (true) {
    iteration++;
    await log(`\n🔄 Monitoring iteration ${iteration} at ${new Date().toISOString()}`);
    
    // Fetch PRs
    const prUrls = await fetchPullRequests();
    
    // Add new PRs to queue
    let newPrs = 0;
    for (const url of prUrls) {
      if (prQueue.enqueue(url)) {
        newPrs++;
        await log(`   ➕ Added to review queue: ${url}`);
      }
    }
    
    if (newPrs > 0) {
      await log(`   📥 Added ${newPrs} new PR(s) to review queue`);
    } else {
      await log('   ℹ️  No new PRs to add (all already reviewed or in queue)');
    }
    
    // Show current stats
    const stats = prQueue.getStats();
    await log('\n📊 Current Status:');
    await log(`   📋 Queued: ${stats.queued}`);
    await log(`   ⚙️  Reviewing: ${stats.processing}`);
    await log(`   ✅ Completed: ${stats.completed}`);
    await log(`   ❌ Failed: ${stats.failed}`);
    
    // If running once, wait for queue to empty then exit
    if (argv.once) {
      await log('\n🏁 Single run mode - waiting for review queue to empty...');
      
      while (stats.queued > 0 || stats.processing > 0) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        const currentStats = prQueue.getStats();
        if (currentStats.queued !== stats.queued || currentStats.processing !== stats.processing) {
          await log(`   ⏳ Waiting... Queue: ${currentStats.queued}, Reviewing: ${currentStats.processing}`);
        }
        Object.assign(stats, currentStats);
      }
      
      await log('\n✅ All PRs reviewed!');
      await log(`   Completed: ${stats.completed}`);
      await log(`   Failed: ${stats.failed}`);
      break;
    }
    
    // Wait for next iteration
    await log(`\n⏰ Next check in ${argv.interval} seconds...`);
    await new Promise(resolve => setTimeout(resolve, argv.interval * 1000));
  }
  
  // Stop reviewers
  prQueue.stop();
  await Promise.all(prQueue.workers);
  
  await log('\n👋 Reviewers Hive Mind monitoring stopped');
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  await log('\n\n🛑 Received interrupt signal, shutting down gracefully...');
  prQueue.stop();
  await Promise.all(prQueue.workers);
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await log('\n\n🛑 Received termination signal, shutting down gracefully...');
  prQueue.stop();
  await Promise.all(prQueue.workers);
  process.exit(0);
});

// Start monitoring
try {
  await monitor();
} catch (error) {
  await log(`\n❌ Fatal error: ${error.message}`, { level: 'error' });
  process.exit(1);
}