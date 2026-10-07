// Producer/consumer queue of issue URLs shared by hive's monitoring loop and its workers.
// Extracted from hive.mjs (issue #2615) so hive.mjs stays under the line-limit threshold.

export class IssueQueue {
  constructor() {
    this.queue = [];
    this.processing = new Set();
    this.completed = new Set();
    this.failed = new Set();
    this.deferrals = new Map(); // Issue #2160: issueUrl -> environment deferral count
    this.waiting = new Set(); // Issue #2615: dequeued, then found blocked by an issue relation
    this.workers = [];
    this.isRunning = true;
  }
  // Add issue to queue if not already processed or in queue.
  // Issue #2615: `skipFailed` keeps extra --once rounds from retrying failed issues.
  enqueue(issueUrl, { skipFailed = false } = {}) {
    if (this.completed.has(issueUrl) || this.processing.has(issueUrl) || this.queue.includes(issueUrl)) {
      return false;
    }
    if (skipFailed && this.failed.has(issueUrl)) return false;
    this.waiting.delete(issueUrl);
    this.queue.push(issueUrl);
    return true;
  }
  // Get next issue from queue
  dequeue() {
    if (this.queue.length === 0) {
      return null;
    }
    const issue = this.queue.shift();
    this.processing.add(issue);
    return issue;
  }
  // Mark issue as completed
  markCompleted(issueUrl) {
    this.processing.delete(issueUrl);
    this.completed.add(issueUrl);
  }
  // Mark issue as failed
  markFailed(issueUrl) {
    this.processing.delete(issueUrl);
    this.failed.add(issueUrl);
  }
  // Issue #2160: put an issue back at the head of the queue after an *environment* block (a
  // full host disk). It is neither completed nor failed — the task was never attempted.
  // Returns how many times this issue has been deferred so the caller can stop looping.
  requeue(issueUrl) {
    this.processing.delete(issueUrl);
    const deferrals = (this.deferrals.get(issueUrl) || 0) + 1;
    this.deferrals.set(issueUrl, deferrals);
    if (!this.completed.has(issueUrl) && !this.queue.includes(issueUrl)) {
      this.queue.unshift(issueUrl);
    }
    return deferrals;
  }
  // Issue #2615: the issue gained an open blocker (or sub-issue) after it was queued. Drop it
  // without marking it completed, so a later polling iteration queues it again once it is ready.
  defer(issueUrl) {
    this.processing.delete(issueUrl);
    this.waiting.add(issueUrl);
  }
  // Get queue statistics
  getStats() {
    return {
      queued: this.queue.length,
      processing: this.processing.size,
      completed: this.completed.size,
      failed: this.failed.size,
      waiting: this.waiting.size,
      processingIssues: Array.from(this.processing),
    };
  }
  // Stop all workers
  stop() {
    this.isRunning = false;
  }
}
