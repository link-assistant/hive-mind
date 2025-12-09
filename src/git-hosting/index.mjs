#!/usr/bin/env node
/**
 * Git Hosting Provider Factory and Registry
 *
 * This module provides a unified entry point for working with different
 * git hosting providers (GitHub, GitLab, BitBucket).
 *
 * Features:
 * - Provider detection based on URL
 * - Provider factory for creating instances
 * - Provider registry for managing custom providers
 */

// Check if use is already defined
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

// Import provider implementations
import { GitHostingProvider } from './provider.interface.mjs';
import { GitHubProvider, createGitHubProvider } from './github.provider.mjs';
import { GitLabProvider, createGitLabProvider } from './gitlab.provider.mjs';
import { BitBucketProvider, createBitBucketProvider } from './bitbucket.provider.mjs';

/**
 * Provider registry for managing available providers
 */
class ProviderRegistry {
  constructor() {
    this._providers = new Map();
    this._urlPatterns = [];

    // Register built-in providers
    this._registerBuiltInProviders();
  }

  /**
   * Register built-in providers
   * @private
   */
  _registerBuiltInProviders() {
    // GitHub
    this.register({
      name: 'github',
      factory: createGitHubProvider,
      hostnames: ['github.com', 'www.github.com'],
      priority: 100
    });

    // GitLab
    this.register({
      name: 'gitlab',
      factory: createGitLabProvider,
      hostnames: ['gitlab.com'],
      priority: 90
    });

    // BitBucket
    this.register({
      name: 'bitbucket',
      factory: createBitBucketProvider,
      hostnames: ['bitbucket.org'],
      priority: 80
    });
  }

  /**
   * Register a provider
   * @param {Object} config - Provider configuration
   * @param {string} config.name - Provider name
   * @param {Function} config.factory - Factory function to create provider instances
   * @param {string[]} config.hostnames - Hostnames this provider handles
   * @param {number} [config.priority=50] - Priority for URL matching (higher = checked first)
   */
  register(config) {
    const { name, factory, hostnames, priority = 50 } = config;

    this._providers.set(name, {
      name,
      factory,
      hostnames,
      priority
    });

    // Add URL patterns
    for (const hostname of hostnames) {
      this._urlPatterns.push({
        hostname: hostname.toLowerCase(),
        providerName: name,
        priority
      });
    }

    // Sort patterns by priority (descending)
    this._urlPatterns.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get a provider by name
   * @param {string} name - Provider name
   * @param {Object} [options] - Options to pass to factory
   * @returns {GitHostingProvider|null} Provider instance or null
   */
  getProvider(name, options = {}) {
    const config = this._providers.get(name);
    if (!config) {
      return null;
    }
    return config.factory(options);
  }

  /**
   * Detect provider from URL
   * @param {string} url - URL to check
   * @returns {{name: string, hostname: string}|null} Provider info or null
   */
  detectFromUrl(url) {
    if (!url || typeof url !== 'string') {
      return null;
    }

    const lowerUrl = url.toLowerCase().trim();

    // Try to extract hostname from URL
    let hostname = null;

    // Handle full URLs
    const urlMatch = lowerUrl.match(/^(?:https?:\/\/)?([^/\s]+)/);
    if (urlMatch) {
      hostname = urlMatch[1];
    }

    // If we have a hostname, find matching provider
    if (hostname) {
      for (const pattern of this._urlPatterns) {
        if (hostname === pattern.hostname || hostname === 'www.' + pattern.hostname) {
          return {
            name: pattern.providerName,
            hostname: pattern.hostname
          };
        }
      }
    }

    // Try each provider's isProviderUrl method as fallback
    for (const [name, config] of this._providers) {
      const provider = config.factory({});
      if (provider.isProviderUrl(url)) {
        return {
          name,
          hostname: config.hostnames[0]
        };
      }
    }

    return null;
  }

  /**
   * Get provider instance for a URL
   * @param {string} url - URL to get provider for
   * @param {Object} [options] - Options to pass to factory
   * @returns {GitHostingProvider|null} Provider instance or null
   */
  getProviderForUrl(url, options = {}) {
    const detected = this.detectFromUrl(url);
    if (!detected) {
      return null;
    }
    return this.getProvider(detected.name, { ...options, hostname: detected.hostname });
  }

  /**
   * Get all registered provider names
   * @returns {string[]} Array of provider names
   */
  getProviderNames() {
    return Array.from(this._providers.keys());
  }

  /**
   * Check if a provider is registered
   * @param {string} name - Provider name
   * @returns {boolean} True if registered
   */
  hasProvider(name) {
    return this._providers.has(name);
  }
}

// Create singleton instance
const registry = new ProviderRegistry();

// ============================================================================
// Exported Functions
// ============================================================================

/**
 * Detect the git hosting provider from a URL
 * @param {string} url - URL to check
 * @returns {{name: string, hostname: string}|null} Provider info or null
 */
export function detectProvider(url) {
  return registry.detectFromUrl(url);
}

/**
 * Get a provider instance for a URL
 * @param {string} url - URL to get provider for
 * @param {Object} [options] - Options to pass to provider
 * @returns {GitHostingProvider|null} Provider instance or null
 */
export function getProviderForUrl(url, options = {}) {
  return registry.getProviderForUrl(url, options);
}

/**
 * Get a provider instance by name
 * @param {string} name - Provider name ('github', 'gitlab', 'bitbucket')
 * @param {Object} [options] - Options to pass to provider
 * @returns {GitHostingProvider|null} Provider instance or null
 */
export function getProvider(name, options = {}) {
  return registry.getProvider(name, options);
}

/**
 * Register a custom provider
 * @param {Object} config - Provider configuration
 * @param {string} config.name - Provider name
 * @param {Function} config.factory - Factory function
 * @param {string[]} config.hostnames - Hostnames to handle
 * @param {number} [config.priority] - Priority (higher = checked first)
 */
export function registerProvider(config) {
  registry.register(config);
}

/**
 * Check if a URL is from a supported provider
 * @param {string} url - URL to check
 * @returns {boolean} True if URL is from a supported provider
 */
export function isSupportedUrl(url) {
  return registry.detectFromUrl(url) !== null;
}

/**
 * Get all supported provider names
 * @returns {string[]} Array of provider names
 */
export function getSupportedProviders() {
  return registry.getProviderNames();
}

/**
 * Parse a URL using the appropriate provider
 * @param {string} url - URL to parse
 * @returns {Object|null} Parsed URL or null if not supported
 */
export function parseUrl(url) {
  const provider = getProviderForUrl(url);
  if (!provider) {
    return null;
  }
  return provider.parseUrl(url);
}

/**
 * Normalize a URL using the appropriate provider
 * @param {string} url - URL to normalize
 * @returns {string|null} Normalized URL or null if not supported
 */
export function normalizeUrl(url) {
  const provider = getProviderForUrl(url);
  if (!provider) {
    return null;
  }
  return provider.normalizeUrl(url);
}

// ============================================================================
// Re-exports
// ============================================================================

export {
  // Base class
  GitHostingProvider,

  // Provider implementations
  GitHubProvider,
  GitLabProvider,
  BitBucketProvider,

  // Factory functions
  createGitHubProvider,
  createGitLabProvider,
  createBitBucketProvider,

  // Registry (for advanced use)
  ProviderRegistry
};

// Default export
export default {
  detectProvider,
  getProviderForUrl,
  getProvider,
  registerProvider,
  isSupportedUrl,
  getSupportedProviders,
  parseUrl,
  normalizeUrl,
  GitHostingProvider,
  GitHubProvider,
  GitLabProvider,
  BitBucketProvider,
  createGitHubProvider,
  createGitLabProvider,
  createBitBucketProvider
};
