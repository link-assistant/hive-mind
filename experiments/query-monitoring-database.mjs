#!/usr/bin/env node
// Script to query an existing monitoring database
// Usage: node experiments/query-monitoring-database.mjs <database-directory>

import { createMonitoringDatabase } from '../src/monitoring-database.lib.mjs';
import path from 'path';

async function main() {
  const dbDir = process.argv[2] || path.join(process.cwd(), 'example-monitoring-db');

  console.log('📊 Querying Monitoring Database\n');
  console.log(`Database location: ${dbDir}\n`);

  try {
    const db = await createMonitoringDatabase(dbDir);

    // Get all events
    const events = await db.readAllEvents();
    console.log(`Total events: ${events.length}\n`);

    // Get snapshot
    const snapshot = await db.buildSnapshot();

    // Display statistics
    console.log('📈 Overall Statistics:');
    console.log(`  Total runs: ${snapshot.stats.totalRuns}`);
    console.log(`  Successful: ${snapshot.stats.successfulRuns}`);
    console.log(`  Failed: ${snapshot.stats.failedRuns}`);
    console.log(`  Running: ${snapshot.stats.totalRuns - snapshot.stats.successfulRuns - snapshot.stats.failedRuns}\n`);

    // User statistics
    if (Object.keys(snapshot.stats.userStats).length > 0) {
      console.log('👥 User Statistics:');
      const userEntries = Object.entries(snapshot.stats.userStats).sort((a, b) => b[1].totalRuns - a[1].totalRuns);
      for (const [user, stats] of userEntries) {
        const successRate = stats.totalRuns > 0 ? ((stats.successfulRuns / stats.totalRuns) * 100).toFixed(1) : 0;
        console.log(`  ${user}:`);
        console.log(`    Total: ${stats.totalRuns} | Success: ${stats.successfulRuns} | Failed: ${stats.failedRuns} | Success Rate: ${successRate}%`);
      }
      console.log('');
    }

    // Model statistics
    if (Object.keys(snapshot.stats.modelStats).length > 0) {
      console.log('🤖 Model Statistics:');
      const modelEntries = Object.entries(snapshot.stats.modelStats).sort((a, b) => b[1].totalRuns - a[1].totalRuns);
      for (const [model, stats] of modelEntries) {
        const successRate = stats.totalRuns > 0 ? ((stats.successfulRuns / stats.totalRuns) * 100).toFixed(1) : 0;
        console.log(`  ${model}:`);
        console.log(`    Total: ${stats.totalRuns} | Success: ${stats.successfulRuns} | Failed: ${stats.failedRuns} | Success Rate: ${successRate}%`);
      }
      console.log('');
    }

    // List all runs
    console.log('📋 All Runs:');
    const runs = Object.values(snapshot.runs).sort((a, b) => a.startTime - b.startTime);

    if (runs.length === 0) {
      console.log('  No runs found\n');
    } else {
      for (const run of runs) {
        const status = run.status === 'completed' ? '✅' : run.status === 'error' ? '❌' : '🔄';
        const duration = run.duration ? ` (${run.duration}ms)` : '';
        console.log(`  ${status} ${run.runId}:`);
        console.log(`     Issue: ${run.issueUrl}`);
        console.log(`     User: ${run.user} | Model: ${run.model}${duration}`);
        if (run.error) {
          console.log(`     Error: ${run.error}`);
        }
        if (run.description) {
          console.log(`     Description: ${run.description.substring(0, 80)}${run.description.length > 80 ? '...' : ''}`);
        }
        console.log('');
      }
    }

  } catch (err) {
    console.error('❌ Error querying database:', err.message);
    console.error('\nMake sure the database directory exists and contains a valid monitoring database.');
    console.error(`Path: ${dbDir}`);
    process.exit(1);
  }
}

main();
