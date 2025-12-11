#!/usr/bin/env node
// Example script demonstrating the monitoring database functionality
// This script shows how to use the monitoring database to track solve executions

import { createMonitoringDatabase } from '../src/monitoring-database.lib.mjs';
import { promises as fs } from 'fs';
import path from 'path';

async function main() {
  console.log('📊 Monitoring Database Example\n');

  // Create a test database directory
  const dbDir = path.join(process.cwd(), 'example-monitoring-db');
  console.log(`Creating monitoring database at: ${dbDir}\n`);

  // Initialize the database
  const db = await createMonitoringDatabase(dbDir);
  console.log('✅ Database initialized\n');

  // Simulate some solve executions
  console.log('Simulating solve executions...\n');

  // Run 1: Successful execution
  const runId1 = 'run-1-example';
  console.log(`[Run 1] Starting: ${runId1}`);
  await db.logRunStart(runId1, 'https://github.com/example/repo/issues/1', 'alice', 'sonnet');
  await db.logIssueDescription(runId1, 'Fix authentication bug in login flow');
  await new Promise(resolve => setTimeout(resolve, 100)); // Simulate work
  await db.logRunComplete(runId1);
  console.log(`[Run 1] Completed successfully\n`);

  // Run 2: Failed execution
  const runId2 = 'run-2-example';
  console.log(`[Run 2] Starting: ${runId2}`);
  await db.logRunStart(runId2, 'https://github.com/example/repo/issues/2', 'bob', 'opus');
  await db.logIssueDescription(runId2, 'Add dark mode support to dashboard');
  await new Promise(resolve => setTimeout(resolve, 100)); // Simulate work
  await db.logRunError(runId2, new Error('Network timeout'));
  console.log(`[Run 2] Failed with error\n`);

  // Run 3: Still running
  const runId3 = 'run-3-example';
  console.log(`[Run 3] Starting: ${runId3}`);
  await db.logRunStart(runId3, 'https://github.com/example/repo/issues/3', 'alice', 'sonnet');
  await db.logIssueDescription(runId3, 'Optimize database queries for performance');
  console.log(`[Run 3] Still running...\n`);

  // Query the database
  console.log('📈 Database Statistics:\n');

  const stats = await db.getStats();
  console.log(`Total runs: ${stats.totalRuns}`);
  console.log(`Successful runs: ${stats.successfulRuns}`);
  console.log(`Failed runs: ${stats.failedRuns}\n`);

  console.log('👥 User Statistics:');
  for (const [user, userStats] of Object.entries(stats.userStats)) {
    console.log(`  ${user}:`);
    console.log(`    Total: ${userStats.totalRuns}`);
    console.log(`    Successful: ${userStats.successfulRuns}`);
    console.log(`    Failed: ${userStats.failedRuns}`);
  }
  console.log('');

  console.log('🤖 Model Statistics:');
  for (const [model, modelStats] of Object.entries(stats.modelStats)) {
    console.log(`  ${model}:`);
    console.log(`    Total: ${modelStats.totalRuns}`);
    console.log(`    Successful: ${modelStats.successfulRuns}`);
    console.log(`    Failed: ${modelStats.failedRuns}`);
  }
  console.log('');

  // Query runs by status
  console.log('📋 Runs by Status:\n');

  const completedRuns = await db.getRunsByStatus('completed');
  console.log(`Completed runs (${completedRuns.length}):`);
  for (const run of completedRuns) {
    console.log(`  - ${run.runId}: ${run.issueUrl} (${run.user}, ${run.model})`);
    console.log(`    Duration: ${run.duration}ms`);
  }
  console.log('');

  const errorRuns = await db.getRunsByStatus('error');
  console.log(`Failed runs (${errorRuns.length}):`);
  for (const run of errorRuns) {
    console.log(`  - ${run.runId}: ${run.issueUrl} (${run.user}, ${run.model})`);
    console.log(`    Error: ${run.error}`);
  }
  console.log('');

  const runningRuns = await db.getRunsByStatus('running');
  console.log(`Running runs (${runningRuns.length}):`);
  for (const run of runningRuns) {
    console.log(`  - ${run.runId}: ${run.issueUrl} (${run.user}, ${run.model})`);
  }
  console.log('');

  // Show the raw database files
  console.log('📄 Database files created:');

  const linoPath = path.join(dbDir, 'db.lino');
  const linksPath = path.join(dbDir, 'db.links');

  const content = await fs.readFile(linoPath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  console.log(`  - db.lino: ${lines.length} events in human-readable Links Notation format`);

  try {
    const linksStats = await fs.stat(linksPath);
    console.log(`  - db.links: ${linksStats.size} bytes in binary doublets format`);
  } catch {
    console.log(`  - db.links: Not created (clink not installed)`);
  }
  console.log();

  console.log('Sample events from db.lino (first 3):');
  lines.slice(0, 3).forEach((line, i) => {
    console.log(`Event ${i + 1} (first 100 chars):`);
    console.log(`  ${line.substring(0, 100)}...\n`);
  });

  console.log('✨ Example complete!');
  console.log(`\nYou can inspect the database at: ${dbDir}`);
  console.log(`  - db.lino: Human-readable Links Notation format`);
  console.log(`  - db.links: Binary doublets format (requires clink to be installed)`);
  console.log(`  - Use the monitoring database API to query and analyze the data`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
