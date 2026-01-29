#!/usr/bin/env node
/**
 * Orchestrator Configuration Library
 *
 * Provides CLI configuration and argument parsing for the orchestrator command.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1193
 */

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG = {
  port: 8080,
  hostname: '0.0.0.0',
  apiVersion: 'v0',
  verbose: false,
  maxQueueSize: 1000,
  solveCommand: 'solve',
};

/**
 * Create yargs configuration for orchestrator command
 * @param {Object} yargsInstance - Yargs instance
 * @returns {Object} Configured yargs instance
 */
export function createYargsConfig(yargsInstance) {
  return yargsInstance
    .usage('Usage: orchestrator [options]')
    .option('port', {
      type: 'number',
      alias: 'p',
      description: 'Port to listen on for API requests',
      default: DEFAULT_CONFIG.port,
    })
    .option('hostname', {
      type: 'string',
      alias: 'H',
      description: 'Hostname to bind the server to',
      default: DEFAULT_CONFIG.hostname,
    })
    .option('api-version', {
      type: 'string',
      description: 'API version prefix (e.g., v0, v1)',
      default: DEFAULT_CONFIG.apiVersion,
    })
    .option('verbose', {
      type: 'boolean',
      alias: 'v',
      description: 'Enable verbose logging for debugging',
      default: DEFAULT_CONFIG.verbose,
    })
    .option('max-queue-size', {
      type: 'number',
      description: 'Maximum number of items allowed in queue',
      default: DEFAULT_CONFIG.maxQueueSize,
    })
    .option('solve-command', {
      type: 'string',
      description: 'Command to execute for solving (e.g., solve, ./solve.mjs)',
      default: DEFAULT_CONFIG.solveCommand,
    })
    .option('upstream', {
      type: 'array',
      alias: 'u',
      description: 'Upstream orchestrator URLs for load balancing (can specify multiple)',
      default: [],
    })
    .option('dry-run', {
      type: 'boolean',
      alias: 'n',
      description: 'Validate configuration and exit without starting server',
      default: false,
    })
    .help('h')
    .alias('h', 'help')
    .version(false) // We handle version separately
    .strict()
    .parserConfiguration({
      'strip-dashed': true,
    });
}

/**
 * Parse arguments using yargs
 * @param {Object} yargs - Yargs module
 * @param {Function} hideBin - hideBin helper from yargs/helpers
 * @returns {Promise<Object>} Parsed arguments
 */
export async function parseArguments(yargs, hideBin) {
  const rawArgs = hideBin(process.argv);
  const yargsInstance = createYargsConfig(yargs(rawArgs));
  return yargsInstance.parse();
}

/**
 * Validate configuration
 * @param {Object} config - Configuration object
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateConfig(config) {
  const errors = [];

  if (config.port < 1 || config.port > 65535) {
    errors.push(`Invalid port number: ${config.port}. Must be between 1 and 65535.`);
  }

  if (config.maxQueueSize < 1) {
    errors.push(`Invalid max-queue-size: ${config.maxQueueSize}. Must be at least 1.`);
  }

  if (config.upstream && Array.isArray(config.upstream)) {
    for (const url of config.upstream) {
      try {
        new URL(url);
      } catch {
        errors.push(`Invalid upstream URL: ${url}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export default {
  DEFAULT_CONFIG,
  createYargsConfig,
  parseArguments,
  validateConfig,
};
