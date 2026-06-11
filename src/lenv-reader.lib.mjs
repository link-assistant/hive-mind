#!/usr/bin/env node
import { ensureUseM } from './use-m-bootstrap.lib.mjs';

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
  await ensureUseM();
}

const linoModule = await use('links-notation');
const LinoParser = linoModule.Parser || linoModule.default?.Parser;

const fs = await import('fs');

function isCliOptionToken(value) {
  return /^--[a-zA-Z0-9][a-zA-Z0-9=_.-]*$/.test(value) || /^-[a-zA-Z]$/.test(value);
}

function collectStringValues(value, result = []) {
  if (value && typeof value === 'object' && Array.isArray(value.values)) {
    if (value.id !== null && value.id !== undefined) {
      result.push(String(value.id));
    }
    for (const child of value.values) {
      collectStringValues(child, result);
    }
  } else if (value !== null && value !== undefined) {
    result.push(String(value));
  }
  return result;
}

function validateNoBareSameLineOptions(content) {
  let currentVar = 'configuration';

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === '(' || trimmed === ')') continue;

    const topLevelMatch = !/^\s/.test(line) ? trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*):(?:\s*(.*))?$/) : null;
    const valueText = topLevelMatch ? (topLevelMatch[2] || '').trim() : trimmed;
    if (topLevelMatch) currentVar = topLevelMatch[1];
    if (!valueText || valueText === '(' || valueText === ')' || valueText.startsWith('(')) continue;

    const parts = valueText.split(/\s+/).filter(Boolean);
    if (parts.length > 1 && isCliOptionToken(parts[0])) {
      throw new Error(`Invalid LINO format in "${currentVar}": Multiple values on the same line are not supported.\n` + `Found: "${parts.join(' ')}"\n` + `Each value must be on its own line with proper indentation, or grouped explicitly as a parenthesized link.`);
    }
  }
}

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
      validateNoBareSameLineOptions(content);

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
          // Check for invalid characters in option-like values
          for (const valueStr of link.values.flatMap(v => collectStringValues(v))) {
            // Options should match pattern: --option-name or -o (with optional =value)
            if (typeof valueStr === 'string' && valueStr.startsWith('-')) {
              // This looks like a command-line option, validate it
              // Valid option pattern: -x, --option-name, --option-name=value
              // Invalid characters: ?, !, @, #, $, %, ^, &, *, etc.
              const invalidCharMatch = valueStr.match(/[^a-zA-Z0-9=_.-]/);
              if (invalidCharMatch) {
                throw new Error(`Invalid LINO format in "${varName}": Unrecognized character "${invalidCharMatch[0]}" in option.\n` + `Found: "${valueStr}"\n` + `Options should only contain letters, numbers, hyphens, underscores, and equals signs.`);
              }
            }
          }

          // If there are multiple values, format them as LINO notation
          const values = link.values.flatMap(v => collectStringValues(v));

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
      // Re-throw validation errors so users can correct their configuration
      if (error.message.includes('Invalid LINO format')) {
        throw error;
      }
      // For other parsing errors, log and return empty
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
    const { path: configPath = '.lenv', configuration = null, override = false, quiet = false } = options;

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
