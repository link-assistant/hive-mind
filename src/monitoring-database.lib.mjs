// Monitoring database module for solve command
// This module implements an append-only database using Links Notation (.lino) format
// for tracking solve command executions, statistics, and costs

import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { encode, decode } from 'link-notation-objects-codec';

/**
 * Event types for the monitoring database
 */
export const EventType = {
  RUN_START: 'run_start',
  RUN_COMPLETE: 'run_complete',
  RUN_ERROR: 'run_error',
  ISSUE_DESCRIPTION: 'issue_description'
};

/**
 * Database lock with timeout functionality
 */
class DatabaseLock {
  constructor(lockFilePath, timeoutMs = 300000) { // 5 minutes default
    this.lockFilePath = lockFilePath;
    this.timeoutMs = timeoutMs;
    this.lockAcquired = false;
  }

  /**
   * Acquire the lock with timeout
   */
  async acquire() {
    const maxAttempts = 50;
    const delayMs = 100;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // Check if lock file exists
        try {
          const lockContent = await fs.readFile(this.lockFilePath, 'utf-8');
          const lockData = decode(lockContent);

          // Check if lock has timed out
          const lockAge = Date.now() - lockData.timestamp;
          if (lockAge > this.timeoutMs) {
            // Lock has expired, remove it
            await fs.unlink(this.lockFilePath).catch(() => {});
          } else {
            // Lock is still valid, wait and retry
            await new Promise(resolve => setTimeout(resolve, delayMs));
            continue;
          }
        } catch {
          // Lock file doesn't exist or is invalid, proceed to create it
        }

        // Try to create lock file atomically
        const lockData = {
          timestamp: Date.now(),
          pid: process.pid,
          hostname: os.hostname()
        };

        // Use wx flag to ensure exclusive creation
        await fs.writeFile(this.lockFilePath, encode(lockData), { flag: 'wx' });
        this.lockAcquired = true;
        return true;
      } catch (err) {
        if (err.code === 'EEXIST') {
          // Lock file was created by another process, retry
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
        throw err;
      }
    }

    throw new Error(`Failed to acquire database lock after ${maxAttempts} attempts`);
  }

  /**
   * Release the lock
   */
  async release() {
    if (this.lockAcquired) {
      try {
        await fs.unlink(this.lockFilePath);
        this.lockAcquired = false;
      } catch {
        // Ignore errors when releasing lock
      }
    }
  }
}

/**
 * Monitoring database class
 */
export class MonitoringDatabase {
  constructor(databaseDir) {
    this.databaseDir = databaseDir;
    this.linoPath = path.join(databaseDir, 'db.lino');
    this.lockPath = path.join(databaseDir, 'db.lock.lino');
    this.snapshotCache = null;
    this.snapshotCacheTime = 0;
  }

  /**
   * Initialize the database directory
   */
  async initialize() {
    await fs.mkdir(this.databaseDir, { recursive: true });

    // Create empty database file if it doesn't exist
    try {
      await fs.access(this.linoPath);
    } catch {
      await fs.writeFile(this.linoPath, '', 'utf-8');
    }
  }

  /**
   * Append an event to the database in append-only mode
   */
  async appendEvent(event) {
    const lock = new DatabaseLock(this.lockPath);

    try {
      await lock.acquire();

      // Create event record
      const eventRecord = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        ...event
      };

      // Encode event to Links Notation
      const encodedEvent = encode(eventRecord);

      // Append to .lino file with newline separator
      await fs.appendFile(this.linoPath, encodedEvent + '\n', 'utf-8');

      // Invalidate cache
      this.snapshotCache = null;

      return eventRecord.id;
    } finally {
      await lock.release();
    }
  }

  /**
   * Read all events from the database
   */
  async readAllEvents() {
    try {
      const content = await fs.readFile(this.linoPath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());

      return lines.map(line => {
        try {
          return decode(line);
        } catch (err) {
          console.error('Failed to decode event:', err);
          return null;
        }
      }).filter(event => event !== null);
    } catch (err) {
      if (err.code === 'ENOENT') {
        return [];
      }
      throw err;
    }
  }

  /**
   * Build in-memory snapshot from events
   */
  async buildSnapshot() {
    // Use cached snapshot if available and recent (< 1 second old)
    if (this.snapshotCache && (Date.now() - this.snapshotCacheTime) < 1000) {
      return this.snapshotCache;
    }

    const events = await this.readAllEvents();

    const snapshot = {
      runs: {},
      stats: {
        totalRuns: 0,
        successfulRuns: 0,
        failedRuns: 0,
        userStats: {},
        modelStats: {}
      }
    };

    // Process events to build snapshot
    for (const event of events) {
      switch (event.type) {
        case EventType.RUN_START:
          snapshot.runs[event.runId] = {
            runId: event.runId,
            issueUrl: event.issueUrl,
            user: event.user,
            model: event.model,
            startTime: event.timestamp,
            status: 'running',
            description: null
          };
          snapshot.stats.totalRuns++;

          // Initialize user stats if needed
          if (!snapshot.stats.userStats[event.user]) {
            snapshot.stats.userStats[event.user] = {
              totalRuns: 0,
              successfulRuns: 0,
              failedRuns: 0
            };
          }
          snapshot.stats.userStats[event.user].totalRuns++;

          // Initialize model stats if needed
          if (!snapshot.stats.modelStats[event.model]) {
            snapshot.stats.modelStats[event.model] = {
              totalRuns: 0,
              successfulRuns: 0,
              failedRuns: 0
            };
          }
          snapshot.stats.modelStats[event.model].totalRuns++;
          break;

        case EventType.RUN_COMPLETE:
          if (snapshot.runs[event.runId]) {
            snapshot.runs[event.runId].status = 'completed';
            snapshot.runs[event.runId].endTime = event.timestamp;
            snapshot.runs[event.runId].duration = event.timestamp - snapshot.runs[event.runId].startTime;

            snapshot.stats.successfulRuns++;

            const user = snapshot.runs[event.runId].user;
            if (snapshot.stats.userStats[user]) {
              snapshot.stats.userStats[user].successfulRuns++;
            }

            const model = snapshot.runs[event.runId].model;
            if (snapshot.stats.modelStats[model]) {
              snapshot.stats.modelStats[model].successfulRuns++;
            }
          }
          break;

        case EventType.RUN_ERROR:
          if (snapshot.runs[event.runId]) {
            snapshot.runs[event.runId].status = 'error';
            snapshot.runs[event.runId].endTime = event.timestamp;
            snapshot.runs[event.runId].duration = event.timestamp - snapshot.runs[event.runId].startTime;
            snapshot.runs[event.runId].error = event.error;

            snapshot.stats.failedRuns++;

            const user = snapshot.runs[event.runId].user;
            if (snapshot.stats.userStats[user]) {
              snapshot.stats.userStats[user].failedRuns++;
            }

            const model = snapshot.runs[event.runId].model;
            if (snapshot.stats.modelStats[model]) {
              snapshot.stats.modelStats[model].failedRuns++;
            }
          }
          break;

        case EventType.ISSUE_DESCRIPTION:
          if (snapshot.runs[event.runId]) {
            snapshot.runs[event.runId].description = event.description;
          }
          break;
      }
    }

    // Cache the snapshot
    this.snapshotCache = snapshot;
    this.snapshotCacheTime = Date.now();

    return snapshot;
  }

  /**
   * Log a run start event
   */
  async logRunStart(runId, issueUrl, user, model) {
    return await this.appendEvent({
      type: EventType.RUN_START,
      runId,
      issueUrl,
      user,
      model
    });
  }

  /**
   * Log a run complete event
   */
  async logRunComplete(runId) {
    return await this.appendEvent({
      type: EventType.RUN_COMPLETE,
      runId
    });
  }

  /**
   * Log a run error event
   */
  async logRunError(runId, error) {
    return await this.appendEvent({
      type: EventType.RUN_ERROR,
      runId,
      error: error.message || String(error)
    });
  }

  /**
   * Log issue description
   */
  async logIssueDescription(runId, description) {
    return await this.appendEvent({
      type: EventType.ISSUE_DESCRIPTION,
      runId,
      description
    });
  }

  /**
   * Query runs by status
   */
  async getRunsByStatus(status) {
    const snapshot = await this.buildSnapshot();
    return Object.values(snapshot.runs).filter(run => run.status === status);
  }

  /**
   * Get run by ID
   */
  async getRunById(runId) {
    const snapshot = await this.buildSnapshot();
    return snapshot.runs[runId] || null;
  }

  /**
   * Get statistics
   */
  async getStats() {
    const snapshot = await this.buildSnapshot();
    return snapshot.stats;
  }
}

/**
 * Create a monitoring database instance
 */
export async function createMonitoringDatabase(databaseDir) {
  const db = new MonitoringDatabase(databaseDir);
  await db.initialize();
  return db;
}
