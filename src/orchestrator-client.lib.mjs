#!/usr/bin/env node
/**
 * Orchestrator Client Library
 *
 * Client for communicating with the orchestrator REST API.
 * Used by solve, hive, and hive-telegram-bot commands when --use-orchestrator is specified.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1193
 */

/**
 * Default API version
 */
export const DEFAULT_API_VERSION = 'v0';

/**
 * Parse orchestrator URL from hostname:port format
 * @param {string} orchestratorUrl - URL in format hostname:port or full URL
 * @returns {string} Full URL
 */
export function parseOrchestratorUrl(orchestratorUrl) {
  if (!orchestratorUrl) return null;

  // If it's already a full URL, use it
  if (orchestratorUrl.startsWith('http://') || orchestratorUrl.startsWith('https://')) {
    return orchestratorUrl.replace(/\/$/, ''); // Remove trailing slash
  }

  // Otherwise, assume it's hostname:port
  return `http://${orchestratorUrl}`;
}

/**
 * OrchestratorClient for communicating with orchestrator API
 */
export class OrchestratorClient {
  /**
   * Create orchestrator client
   * @param {string} baseUrl - Base URL of orchestrator (e.g., http://localhost:8080)
   * @param {Object} options - Options
   * @param {string} options.apiVersion - API version (default: v0)
   * @param {boolean} options.verbose - Enable verbose logging
   */
  constructor(baseUrl, options = {}) {
    this.baseUrl = parseOrchestratorUrl(baseUrl);
    this.apiVersion = options.apiVersion || DEFAULT_API_VERSION;
    this.verbose = options.verbose || false;
  }

  /**
   * Get full API endpoint URL
   * @param {string} endpoint - Endpoint path
   * @returns {string}
   */
  getEndpoint(endpoint) {
    return `${this.baseUrl}/api/${this.apiVersion}${endpoint}`;
  }

  /**
   * Log message if verbose mode is enabled
   * @param {string} message
   */
  log(message) {
    if (this.verbose) {
      console.log(`[orchestrator-client] ${message}`);
    }
  }

  /**
   * Make HTTP request to orchestrator
   * @param {string} method - HTTP method
   * @param {string} endpoint - API endpoint
   * @param {Object} body - Request body (for POST/PUT)
   * @returns {Promise<Object>}
   */
  async request(method, endpoint, body = null) {
    const url = this.getEndpoint(endpoint);
    this.log(`${method} ${url}`);

    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
      this.log(`Body: ${JSON.stringify(body)}`);
    }

    try {
      const response = await fetch(url, options);
      const data = await response.json();

      this.log(`Response: ${response.status} ${JSON.stringify(data)}`);

      return {
        success: response.ok,
        status: response.status,
        data,
      };
    } catch (error) {
      this.log(`Error: ${error.message}`);
      return {
        success: false,
        status: 0,
        error: error.message,
        data: null,
      };
    }
  }

  /**
   * Check if orchestrator is available
   * @returns {Promise<{available: boolean, version?: string, error?: string}>}
   */
  async checkHealth() {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      if (!response.ok) {
        return { available: false, error: `HTTP ${response.status}` };
      }
      const data = await response.json();
      return {
        available: data.status === 'ok',
        version: data.version,
      };
    } catch (error) {
      return { available: false, error: error.message };
    }
  }

  /**
   * Get queue status
   * @returns {Promise<Object>}
   */
  async getQueueStatus() {
    return this.request('GET', '/solve/queue');
  }

  /**
   * Enqueue a solve task
   * @param {Object} options - Task options
   * @param {string} options.url - GitHub issue/PR URL
   * @param {string[]} options.args - Additional arguments for solve command
   * @param {string} options.requester - Requester identifier
   * @param {string} options.tool - Tool to use (claude, opencode, etc.)
   * @param {string} options.priority - Priority (low, normal, high)
   * @returns {Promise<Object>}
   */
  async enqueueSolveTask(options) {
    const { url, args, requester, tool, priority } = options;

    return this.request('POST', '/solve/enqueue', {
      url,
      args: args || [],
      requester: requester || 'client',
      tool: tool || 'claude',
      priority: priority || 'normal',
    });
  }

  /**
   * Get task status by ID
   * @param {string} taskId - Task ID
   * @returns {Promise<Object>}
   */
  async getTaskStatus(taskId) {
    return this.request('GET', `/solve/task/${taskId}`);
  }

  /**
   * Cancel a task by ID
   * @param {string} taskId - Task ID
   * @returns {Promise<Object>}
   */
  async cancelTask(taskId) {
    return this.request('DELETE', `/solve/task/${taskId}`);
  }

  /**
   * Get upstream orchestrators status (for load balancing mode)
   * @returns {Promise<Object>}
   */
  async getUpstreamStatus() {
    return this.request('GET', '/upstream/status');
  }

  /**
   * Enqueue to least loaded upstream
   * @param {Object} options - Task options
   * @returns {Promise<Object>}
   */
  async enqueueToUpstream(options) {
    return this.request('POST', '/upstream/enqueue', options);
  }
}

/**
 * Create an orchestrator client
 * @param {string} url - Orchestrator URL
 * @param {Object} options - Options
 * @returns {OrchestratorClient}
 */
export function createOrchestratorClient(url, options = {}) {
  return new OrchestratorClient(url, options);
}

/**
 * Enqueue solve task to orchestrator (convenience function)
 * @param {string} orchestratorUrl - Orchestrator URL
 * @param {string} issueUrl - GitHub issue/PR URL
 * @param {string[]} args - Additional arguments
 * @param {Object} options - Additional options
 * @returns {Promise<Object>}
 */
export async function enqueueToOrchestrator(orchestratorUrl, issueUrl, args = [], options = {}) {
  const client = new OrchestratorClient(orchestratorUrl, {
    verbose: options.verbose,
  });

  // Check if orchestrator is available
  const health = await client.checkHealth();
  if (!health.available) {
    return {
      success: false,
      error: `Orchestrator not available: ${health.error}`,
    };
  }

  // Enqueue the task
  const result = await client.enqueueSolveTask({
    url: issueUrl,
    args,
    requester: options.requester || 'client',
    tool: options.tool || 'claude',
    priority: options.priority || 'normal',
  });

  return result;
}

export default {
  OrchestratorClient,
  createOrchestratorClient,
  enqueueToOrchestrator,
  parseOrchestratorUrl,
  DEFAULT_API_VERSION,
};
