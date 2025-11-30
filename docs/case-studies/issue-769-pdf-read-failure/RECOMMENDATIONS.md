# Recommendations for Preventing Tool Concurrency Failures

## Overview

This document provides recommendations for preventing the "API Error: 400 due to tool use concurrency issues" error encountered in PR #403.

---

## Immediate Solutions

### 1. Implement Automatic Retry with Session Recovery

When the solver encounters a tool concurrency error, it should automatically:

1. Save the current session ID
2. Wait for a brief period (e.g., 5 seconds)
3. Attempt to resume using the `/rewind` command
4. Continue execution from the recovered point

**Implementation Example**:
```javascript
async function executeWithRetry(command, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await executeClaudeCommand(command);
      if (result.includes('tool use concurrency issues')) {
        console.log(`Concurrency issue detected, attempt ${attempt + 1}/${maxRetries}`);
        await sleep(5000 * (attempt + 1)); // Exponential backoff
        if (result.sessionId) {
          await executeRewindCommand(result.sessionId);
        }
        continue;
      }
      return result;
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      await sleep(5000);
    }
  }
}
```

### 2. Serialize Tool Calls During PDF Processing

When processing PDFs, avoid making multiple concurrent tool calls. Instead, process sequentially:

**Before** (concurrent):
```javascript
const [pdfContent, issueDetails, repoFiles] = await Promise.all([
  readPDF(path),
  getIssueDetails(issue),
  listRepoFiles(dir)
]);
```

**After** (sequential):
```javascript
const pdfContent = await readPDF(path);
await delay(1000); // Brief pause
const issueDetails = await getIssueDetails(issue);
await delay(1000);
const repoFiles = await listRepoFiles(dir);
```

### 3. Add Tool Call Throttling

Implement a global throttle for tool calls:

```javascript
const toolCallQueue = [];
let lastToolCallTime = 0;
const MIN_TOOL_CALL_INTERVAL = 500; // 500ms between calls

async function throttledToolCall(toolFn) {
  const now = Date.now();
  const timeSinceLastCall = now - lastToolCallTime;

  if (timeSinceLastCall < MIN_TOOL_CALL_INTERVAL) {
    await sleep(MIN_TOOL_CALL_INTERVAL - timeSinceLastCall);
  }

  lastToolCallTime = Date.now();
  return toolFn();
}
```

---

## Long-term Solutions

### 1. Document Processing Isolation

Process documents in a dedicated "document phase" before other operations:

```javascript
// Phase 1: Document acquisition and reading
const documents = await documentPhase({
  pdfs: ['paper1.pdf', 'paper2.pdf'],
  throttle: 2000 // 2 seconds between reads
});

// Phase 2: Analysis (with documents in context)
const analysis = await analysisPhase(documents, {
  issue: issueDetails,
  repo: repoContext
});

// Phase 3: Implementation
await implementationPhase(analysis);
```

### 2. Session State Persistence

Save session state periodically to enable recovery:

```javascript
const SESSION_SAVE_INTERVAL = 60000; // Every minute

async function runWithStatePersistence(task) {
  const stateFile = `/tmp/session-${task.id}.json`;

  // Load existing state if available
  let state = await loadState(stateFile);

  // Set up periodic saves
  const saveInterval = setInterval(async () => {
    await saveState(stateFile, state);
  }, SESSION_SAVE_INTERVAL);

  try {
    // Execute task with state
    await executeTask(task, state);
  } finally {
    clearInterval(saveInterval);
    await cleanupState(stateFile);
  }
}
```

### 3. Better Error Classification

Classify errors to enable appropriate handling:

```javascript
const ERROR_TYPES = {
  TOOL_CONCURRENCY: {
    pattern: /tool use concurrency issues/i,
    action: 'retry_with_backoff',
    maxRetries: 3
  },
  TOKEN_LIMIT: {
    pattern: /token limit|context window/i,
    action: 'reduce_context',
    maxRetries: 2
  },
  PDF_SIZE: {
    pattern: /file size|too large/i,
    action: 'chunk_document',
    maxRetries: 1
  }
};

function classifyError(errorMessage) {
  for (const [type, config] of Object.entries(ERROR_TYPES)) {
    if (config.pattern.test(errorMessage)) {
      return { type, ...config };
    }
  }
  return { type: 'UNKNOWN', action: 'fail', maxRetries: 0 };
}
```

### 4. Monitoring and Alerting

Add metrics for tool call patterns:

```javascript
const metrics = {
  toolCallsPerMinute: 0,
  consecutiveErrors: 0,
  concurrencyErrors: 0,

  recordToolCall() {
    this.toolCallsPerMinute++;
  },

  recordError(type) {
    this.consecutiveErrors++;
    if (type === 'TOOL_CONCURRENCY') {
      this.concurrencyErrors++;
    }
  },

  shouldThrottle() {
    return this.toolCallsPerMinute > 30 || this.consecutiveErrors > 2;
  }
};
```

---

## Specific Recommendations for PDF Processing

### 1. Pre-check PDF Size

Before attempting to read a PDF, check its size:

```javascript
async function safeReadPDF(path) {
  const stats = await fs.stat(path);
  const sizeMB = stats.size / (1024 * 1024);

  if (sizeMB > 5) {
    console.warn(`Large PDF detected: ${sizeMB}MB`);
    return await readPDFInChunks(path);
  }

  return await readPDF(path);
}
```

### 2. Delay After PDF Read

Add a mandatory delay after reading a PDF:

```javascript
const POST_PDF_DELAY = 2000; // 2 seconds

async function readPDFWithDelay(path) {
  const content = await readPDF(path);
  await sleep(POST_PDF_DELAY);
  return content;
}
```

### 3. Batch PDF Processing

When multiple PDFs need to be read, batch them with delays:

```javascript
async function batchReadPDFs(paths, delayBetween = 3000) {
  const results = [];

  for (let i = 0; i < paths.length; i++) {
    console.log(`Reading PDF ${i + 1}/${paths.length}: ${paths[i]}`);
    const content = await readPDF(paths[i]);
    results.push(content);

    if (i < paths.length - 1) {
      await sleep(delayBetween);
    }
  }

  return results;
}
```

---

## Guidelines for Solver Configuration

Add these settings to the solver configuration:

```yaml
# solve-config.yaml
tool_settings:
  throttle:
    enabled: true
    min_interval_ms: 500
    max_calls_per_minute: 30

  pdf_processing:
    post_read_delay_ms: 2000
    max_size_mb: 5
    chunk_large_files: true

  retry:
    max_attempts: 3
    backoff_base_ms: 5000
    backoff_multiplier: 2

  concurrency_error:
    auto_rewind: true
    preserve_session: true
```

---

## Summary

The key recommendations are:

1. **Throttle tool calls** - Add delays between calls
2. **Serialize PDF processing** - Don't read multiple PDFs concurrently
3. **Implement retry logic** - Auto-retry on concurrency errors
4. **Use session recovery** - Preserve and restore session state
5. **Add monitoring** - Track tool call patterns and errors
6. **Configure appropriately** - Use settings files for tuning

These changes should significantly reduce the occurrence of "tool use concurrency issues" errors.
