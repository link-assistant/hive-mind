#!/usr/bin/env node
/**
 * Orchestrator CLI
 *
 * REST API server for managing solve task queues and load balancing.
 * Implements the LINO REST API specification.
 *
 * Features:
 * - Configurable --api-port and --api-hostname
 * - Enqueue solve tasks via POST /api/v0/solve/enqueue
 * - Get queue status via GET /api/v0/solve/queue
 * - Load balancing support via --upstream option
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1193
 */

// Early exit paths - handle these before loading all modules
const earlyArgs = process.argv.slice(2);
if (earlyArgs.includes('--version')) {
  const { getVersion } = await import('./version.lib.mjs');
  try {
    const version = await getVersion();
    console.log(version);
  } catch {
    console.error('Error: Unable to determine version');
    process.exit(1);
  }
  process.exit(0);
}

if (earlyArgs.includes('--help') || earlyArgs.includes('-h')) {
  if (typeof use === 'undefined') {
    globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
  }
  const yargsModule = await use('yargs@17.7.2');
  const yargs = yargsModule.default || yargsModule;
  const { hideBin } = await use('yargs@17.7.2/helpers');
  const { createYargsConfig } = await import('./orchestrator.config.lib.mjs');
  const rawArgs = hideBin(process.argv);
  createYargsConfig(yargs(rawArgs)).showHelp();
  process.exit(0);
}

// Load all modules for normal operation
if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;
const { hideBin } = await use('yargs@17.7.2/helpers');

// Import configuration
const configLib = await import('./orchestrator.config.lib.mjs');
const { createYargsConfig, validateConfig } = configLib;

// Import queue
const queueLib = await import('./orchestrator-queue.lib.mjs');
const { getOrchestratorQueue } = queueLib;

// Import LINO REST API
const linoApi = await import('../dependencies/lino-rest-api/index.mjs');
const { createLinoApp } = linoApi;

// Import version info
const { getVersionInfo } = await import('./version-info.lib.mjs');

// Parse arguments
let argv;
try {
  const rawArgs = hideBin(process.argv);
  argv = await createYargsConfig(yargs(rawArgs)).parse();
} catch (error) {
  console.error(`❌ ${error.message}`);
  process.exit(1);
}

// Validate configuration
const validation = validateConfig(argv);
if (!validation.valid) {
  console.error('❌ Configuration errors:');
  for (const error of validation.errors) {
    console.error(`   - ${error}`);
  }
  process.exit(1);
}

// Handle dry-run mode
if (argv.dryRun) {
  console.log('✅ Configuration validated successfully');
  console.log(`   Port: ${argv.port}`);
  console.log(`   Hostname: ${argv.hostname}`);
  console.log(`   API Version: ${argv.apiVersion}`);
  console.log(`   Solve Command: ${argv.solveCommand}`);
  if (argv.upstream && argv.upstream.length > 0) {
    console.log(`   Upstream Orchestrators: ${argv.upstream.join(', ')}`);
  }
  process.exit(0);
}

// Get version for display
const version = await getVersionInfo();

console.log(`🎯 Orchestrator v${version}`);
console.log(`   Starting server on ${argv.hostname}:${argv.port}...`);

// Initialize queue
const queue = getOrchestratorQueue({
  verbose: argv.verbose,
  solveCommand: argv.solveCommand,
});

// Create LINO REST API app
const app = createLinoApp();

// API version prefix
const apiPrefix = `/api/${argv.apiVersion}`;

/**
 * Health check endpoint
 */
app.get('/health', async () => {
  return {
    status: 'ok',
    version,
    timestamp: new Date().toISOString(),
  };
});

/**
 * Get API info
 */
app.get(apiPrefix, async () => {
  return {
    name: 'orchestrator',
    version,
    apiVersion: argv.apiVersion,
    endpoints: [`GET ${apiPrefix}/solve/queue`, `POST ${apiPrefix}/solve/enqueue`, `GET ${apiPrefix}/solve/task/:id`, `DELETE ${apiPrefix}/solve/task/:id`],
  };
});

/**
 * Get queue status
 * This endpoint allows other orchestrators and clients to check how loaded this orchestrator is
 */
app.get(`${apiPrefix}/solve/queue`, async () => {
  const stats = queue.getStats();
  const summary = queue.getQueueSummary();

  return {
    success: true,
    stats,
    summary,
    timestamp: new Date().toISOString(),
  };
});

/**
 * Enqueue a solve task
 * This is the main endpoint for adding tasks to the queue
 */
app.post(`${apiPrefix}/solve/enqueue`, async (ctx, res) => {
  const { url, args, requester, tool, priority } = ctx.body;

  // Validate required fields
  if (!url) {
    return res.lino(
      {
        success: false,
        error: 'Missing required field: url',
      },
      400
    );
  }

  // Check if URL is already in queue
  const existingItem = queue.findByUrl(url);
  if (existingItem) {
    return res.lino(
      {
        success: false,
        error: 'URL already in queue',
        existingTask: existingItem.toJSON(),
      },
      409
    );
  }

  // Check queue size limit
  const stats = queue.getStats();
  if (stats.queued >= argv.maxQueueSize) {
    return res.lino(
      {
        success: false,
        error: 'Queue is full',
        queueSize: stats.queued,
        maxSize: argv.maxQueueSize,
      },
      503
    );
  }

  // Enqueue the task
  const item = queue.enqueue({
    url,
    args: args || [],
    requester: requester || 'api',
    tool: tool || 'claude',
    priority: priority || 'normal',
  });

  console.log(`[orchestrator] Enqueued task: ${item.id} for ${url}`);

  return {
    success: true,
    task: item.toJSON(),
    queuePosition: stats.queued + 1,
  };
});

/**
 * Get task status by ID
 */
app.get(`${apiPrefix}/solve/task/:id`, async ctx => {
  const { id } = ctx.params;

  const item = queue.findById(id);
  if (!item) {
    return {
      success: false,
      error: 'Task not found',
      id,
    };
  }

  return {
    success: true,
    task: item.toJSON(),
  };
});

/**
 * Cancel a task by ID
 */
app.delete(`${apiPrefix}/solve/task/:id`, async (ctx, res) => {
  const { id } = ctx.params;

  const cancelled = queue.cancel(id);
  if (!cancelled) {
    return res.lino(
      {
        success: false,
        error: 'Task not found or cannot be cancelled (already processing)',
        id,
      },
      404
    );
  }

  console.log(`[orchestrator] Cancelled task: ${id}`);

  return {
    success: true,
    message: 'Task cancelled',
    id,
  };
});

/**
 * Upstream orchestrator endpoints (for load balancing mode)
 */
if (argv.upstream && argv.upstream.length > 0) {
  console.log(`   Load balancing mode enabled with ${argv.upstream.length} upstream orchestrator(s)`);

  /**
   * Get combined queue status from all upstreams
   */
  app.get(`${apiPrefix}/upstream/status`, async () => {
    const upstreamStatus = await Promise.all(
      argv.upstream.map(async upstreamUrl => {
        try {
          const response = await fetch(`${upstreamUrl}${apiPrefix}/solve/queue`);
          const data = await response.json();
          return {
            url: upstreamUrl,
            available: true,
            stats: data.stats,
          };
        } catch (error) {
          return {
            url: upstreamUrl,
            available: false,
            error: error.message,
          };
        }
      })
    );

    return {
      success: true,
      upstreams: upstreamStatus,
      timestamp: new Date().toISOString(),
    };
  });

  /**
   * Enqueue to least loaded upstream
   */
  app.post(`${apiPrefix}/upstream/enqueue`, async (ctx, res) => {
    const { url, args, requester, tool, priority } = ctx.body;

    if (!url) {
      return res.lino(
        {
          success: false,
          error: 'Missing required field: url',
        },
        400
      );
    }

    // Find least loaded upstream
    let leastLoaded = null;
    let minQueueSize = Infinity;

    for (const upstreamUrl of argv.upstream) {
      try {
        const response = await fetch(`${upstreamUrl}${apiPrefix}/solve/queue`);
        const data = await response.json();
        if (data.stats && data.stats.queued < minQueueSize) {
          minQueueSize = data.stats.queued;
          leastLoaded = upstreamUrl;
        }
      } catch {
        // Skip unavailable upstream
      }
    }

    if (!leastLoaded) {
      return res.lino(
        {
          success: false,
          error: 'No upstream orchestrators available',
        },
        503
      );
    }

    // Forward request to least loaded upstream
    try {
      const response = await fetch(`${leastLoaded}${apiPrefix}/solve/enqueue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, args, requester, tool, priority }),
      });
      const data = await response.json();

      return {
        success: data.success,
        task: data.task,
        upstream: leastLoaded,
        queueSize: minQueueSize,
      };
    } catch (error) {
      return res.lino(
        {
          success: false,
          error: `Failed to forward to upstream: ${error.message}`,
          upstream: leastLoaded,
        },
        502
      );
    }
  });
}

// Start server
try {
  await app.listen(argv.port, argv.hostname);
  console.log(`✅ Server ready at http://${argv.hostname}:${argv.port}`);
  console.log(`   API endpoint: http://${argv.hostname}:${argv.port}${apiPrefix}`);
  console.log(`   Health check: http://${argv.hostname}:${argv.port}/health`);
  if (argv.verbose) {
    console.log(`   Verbose mode: enabled`);
  }
} catch (error) {
  console.error(`❌ Failed to start server: ${error.message}`);
  process.exit(1);
}

// Handle shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down orchestrator...');
  queue.stop();
  await app.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down orchestrator...');
  queue.stop();
  await app.close();
  process.exit(0);
});
