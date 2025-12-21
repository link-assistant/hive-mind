#!/usr/bin/env node
/**
 * Agent Configuration Example
 * Demonstrates typed configuration for Hive Mind agents
 */

/**
 * @typedef {Object} AgentConfig
 * @property {'sonnet'|'haiku'|'opus'} model - AI model to use
 * @property {'low'|'medium'|'high'|'critical'} priority - Task priority
 * @property {string[]} specialization - Agent specializations
 * @property {number} maxConcurrentTasks - Max concurrent tasks
 * @property {number} timeout - Timeout in milliseconds
 */

/**
 * @typedef {Object} HiveConfig
 * @property {Record<string, AgentConfig>} agents - Agent configurations
 * @property {Object} orchestrator - Orchestrator settings
 * @property {number} orchestrator.consensusThreshold - Consensus threshold (0.5-1.0)
 * @property {'majority'|'weighted'|'human'} orchestrator.conflictResolution - Conflict resolution method
 */

// Example configuration
/** @type {HiveConfig} */
export const productionConfig = {
  agents: {
    'issue-solver': {
      model: 'sonnet',
      priority: 'high',
      specialization: ['github-integration', 'code-generation', 'testing'],
      maxConcurrentTasks: 3,
      timeout: 600000 // 10 minutes
    },
    'code-reviewer': {
      model: 'opus',
      priority: 'critical',
      specialization: ['security-analysis', 'architecture-review', 'performance'],
      maxConcurrentTasks: 2,
      timeout: 300000 // 5 minutes
    },
    coordinator: {
      model: 'haiku',
      priority: 'medium',
      specialization: ['task-management', 'communication', 'monitoring'],
      maxConcurrentTasks: 10,
      timeout: 30000 // 30 seconds
    }
  },
  orchestrator: {
    consensusThreshold: 0.8,
    conflictResolution: 'weighted'
  }
};

/**
 * Validate configuration
 * @param {HiveConfig} config - Configuration to validate
 * @returns {boolean} True if valid
 * @throws {Error} If configuration is invalid
 */
export function validateConfig(config) {
  // Ensure at least one agent is configured
  if (Object.keys(config.agents).length === 0) {
    throw new Error('At least one agent must be configured');
  }

  // Validate consensus threshold
  if (config.orchestrator.consensusThreshold < 0.5 || config.orchestrator.consensusThreshold > 1.0) {
    throw new Error('Consensus threshold must be between 0.5 and 1.0');
  }

  // Validate each agent
  for (const [name, agent] of Object.entries(config.agents)) {
    if (agent.maxConcurrentTasks < 1) {
      throw new Error(`Agent ${name} must handle at least 1 concurrent task`);
    }
    if (agent.timeout < 1000) {
      throw new Error(`Agent ${name} timeout must be at least 1 second`);
    }
  }

  return true;
}

// Usage example
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('🤖 Validating production configuration...');

  try {
    validateConfig(productionConfig);
    console.log('✅ Configuration is valid');
    console.log('📊 Agents configured:', Object.keys(productionConfig.agents).length);
  } catch (error) {
    console.error('❌ Configuration error:', error.message);
    process.exit(1);
  }
}
