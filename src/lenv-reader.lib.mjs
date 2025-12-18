#!/usr/bin/env node

/**
 * lenv-reader.lib.mjs - LINO-based environment configuration reader
 *
 * Reads .lenv files (Links Notation environment files) and provides them as environment variables.
 * This is a simple replacement for traditional .env files, using LINO (Links Notation) format.
 *
 * Format comparison:
 *
 * Traditional .env:
 * VAR1=1
 * VAR2=2
 * LINO_LIST="(
 *   1
 *   2
 *   3
 * )"
 *
 * New .lenv (LINO):
 * VAR1: 1
 * VAR2: 2
 * LINO_LIST: (
 *   1
 *   2
 *   3
 * )
 *
 * Priority: .lenv takes precedence over .env if both exist
 */

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const linoModule = await use('links-notation');
const LinoParser = linoModule.Parser || linoModule.default?.Parser;

const fs = await import('fs');

/**
 * LenvReader - Reads and parses .lenv files using LINO notation
 */
export class LenvReader {
  constructor() {
    this.parser = new LinoParser();
  }

  /**
   * Parse LINO configuration string into environment variables object
   * @param {string} content - LINO configuration content
   * @returns {Object} - Object with environment variable key-value pairs
   */
  parse(content) {
    if (!content || typeof content !== 'string') {
      return {};
    }

    const result = {};

    try {
      // Parse the entire content as LINO
      const parsed = this.parser.parse(content);

      if (!parsed || parsed.length === 0) {
        return {};
      }

      // Process each top-level link as an environment variable
      for (const link of parsed) {
        // The ID of the link is the variable name
        const varName = link.id;

        if (!varName) {
          continue;
        }

        // The values are the variable value
        if (link.values && link.values.length > 0) {
          // If there are multiple values, format them as LINO notation
          const values = link.values.map(v => v.id || v);

          // If it's a single value, just use it as-is
          if (values.length === 1) {
            result[varName] = String(values[0]);
          } else {
            // Multiple values - format as LINO notation
            const formattedValues = values.map(v => `  ${v}`).join('\n');
            result[varName] = `(\n${formattedValues}\n)`;
          }
        } else if (link.id) {
          // No values means it might be a simple variable with no value
          // Try to extract value from the original source
          // For now, we'll just set it to empty string
          result[varName] = '';
        }
      }

      return result;
    } catch (error) {
      console.error(`Error parsing LINO configuration: ${error.message}`);
      return {};
    }
  }

  /**
   * Read and parse .lenv file
   * @param {string} filePath - Path to .lenv file
   * @returns {Object} - Object with environment variable key-value pairs
   */
  async readFile(filePath) {
    try {
      // Check if file exists using access
      await fs.promises.access(filePath);

      const content = await fs.promises.readFile(filePath, 'utf8');
      return this.parse(content);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      console.error(`Error reading .lenv file ${filePath}: ${error.message}`);
      return null;
    }
  }

  /**
   * Load configuration from file or string and inject into process.env
   * @param {Object} options - Configuration options
   * @param {string} options.path - Path to .lenv file (optional, defaults to '.lenv')
   * @param {string} options.configuration - LINO configuration string (optional)
   * @param {boolean} options.override - Whether to override existing env vars (default: false)
   * @param {boolean} options.quiet - Whether to suppress log messages (default: false)
   * @returns {Object} - Object with loaded variables
   */
  async config(options = {}) {
    const {
      path: configPath = '.lenv',
      configuration = null,
      override = false,
      quiet = false
    } = options;

    let envVars = {};

    // Priority 1: Configuration string from --configuration option
    if (configuration) {
      envVars = this.parse(configuration);
      if (!quiet && Object.keys(envVars).length > 0) {
        console.log(`Loaded ${Object.keys(envVars).length} variables from --configuration option`);
      }
    }
    // Priority 2: .lenv file
    else if (configPath) {
      const fileVars = await this.readFile(configPath);
      if (fileVars) {
        envVars = fileVars;
        if (!quiet && Object.keys(envVars).length > 0) {
          console.log(`Loaded ${Object.keys(envVars).length} variables from ${configPath}`);
        }
      }
    }

    // Inject into process.env
    for (const [key, value] of Object.entries(envVars)) {
      if (override || !process.env[key]) {
        process.env[key] = value;
      }
    }

    return envVars;
  }

  /**
   * Check if .lenv file exists and has priority over .env
   * @param {string} lenvPath - Path to .lenv file
   * @returns {boolean} - True if .lenv should be used
   */
  async shouldUseLenv(lenvPath = '.lenv') {
    // If .lenv exists, use it (has priority)
    try {
      await fs.promises.access(lenvPath);
      return true;
    } catch {
      return false;
    }
  }
}

export const lenvReader = new LenvReader();

/**
 * Load .lenv configuration if it exists
 * This function can be called early in the application to load .lenv configuration
 *
 * Priority:
 * 1. --configuration option (if provided)
 * 2. .lenv file (if exists)
 * 3. .env file (fallback, handled by dotenvx)
 *
 * @param {Object} options - Configuration options
 * @returns {Object} - Loaded environment variables
 */
export async function loadLenvConfig(options = {}) {
  return await lenvReader.config(options);
}
