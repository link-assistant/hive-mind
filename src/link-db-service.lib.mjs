// LinkDBService - Service wrapper for link-cli (clink) database operations
// This module provides a JavaScript interface to .links binary database files
// using the clink CLI tool from link-foundation/link-cli

import { exec } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';

const execAsync = promisify(exec);

/**
 * LinkDBService - Wrapper for link-cli database operations
 * Uses the clink tool (link-cli) for associative link-based data storage
 *
 * Each link is a triplet: (id: source target)
 * This is the fundamental doublet structure required by the Links platform
 */
export class LinkDBService {
  constructor(dbPath) {
    this.dbPath = dbPath;
  }

  /**
   * Check if clink is installed and accessible
   */
  async checkClinkAvailable() {
    try {
      const env = {
        ...process.env,
        PATH: `${process.env.HOME}/.dotnet/tools:${process.env.PATH}`
      };

      await execAsync('clink --help', { env });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Execute a clink command
   * @param {string} query - LiNo query string
   * @param {object} options - Additional options
   * @returns {Promise<string>} - Command output
   */
  async executeQuery(query, options = {}) {
    const { before = false, changes = false, after = false, trace = false } = options;

    const flags = [];
    if (before) flags.push('--before');
    if (changes) flags.push('--changes');
    if (after) flags.push('--after');
    if (trace) flags.push('--trace');

    const command = `clink '${query}' --db "${this.dbPath}" ${flags.join(' ')}`;

    try {
      // Set PATH to include .dotnet/tools directory where clink is installed
      const env = {
        ...process.env,
        PATH: `${process.env.HOME}/.dotnet/tools:${process.env.PATH}`
      };

      const { stdout, stderr } = await execAsync(command, { env });

      if (stderr && !stderr.includes('warning')) {
        throw new Error(`clink stderr: ${stderr}`);
      }

      return stdout.trim();
    } catch (error) {
      // Check if clink is not installed
      if (error.message.includes('clink') && (error.message.includes('not found') || error.message.includes('command not found'))) {
        throw new Error('LinkDB not available: clink command not found. Please install link-cli: dotnet tool install --global clink');
      }

      throw new Error(`LinkDB query failed: ${error.message}`);
    }
  }

  /**
   * Parse clink output to extract links
   * Format: (id: source target)
   * @param {string} output - Raw clink output
   * @returns {Array<object>} - Parsed links
   */
  parseLinks(output) {
    if (!output || output.trim() === '') {
      return [];
    }

    const lines = output.split('\n').filter(line => line.trim());
    const links = [];

    for (const line of lines) {
      // Match pattern: (id: source target)
      const match = line.match(/\((\d+):\s+(\d+)\s+(\d+)\)/);
      if (match) {
        links.push({
          id: parseInt(match[1]),
          source: parseInt(match[2]),
          target: parseInt(match[3])
        });
      }
    }

    return links;
  }

  /**
   * Create a new link (doublet)
   * @param {number} source - Source link ID
   * @param {number} target - Target link ID
   * @returns {Promise<object>} - Created link
   */
  async createLink(source, target) {
    const query = `() ((${source} ${target}))`;
    const output = await this.executeQuery(query, { changes: true });

    // Parse the created link from output
    const match = output.match(/\((\d+):\s+(\d+)\s+(\d+)\)/);
    if (match) {
      return {
        id: parseInt(match[1]),
        source: parseInt(match[2]),
        target: parseInt(match[3])
      };
    }

    throw new Error('Failed to parse created link');
  }

  /**
   * Read all links from database
   * @returns {Promise<Array<object>>} - All links
   */
  async readAllLinks() {
    try {
      const query = '((($i: $s $t)) (($i: $s $t)))';
      const output = await this.executeQuery(query, { after: true });
      return this.parseLinks(output);
    } catch (error) {
      // If database file doesn't exist yet, return empty array
      if (error.message.includes('No such file')) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Read a specific link by ID
   * @param {number} id - Link ID
   * @returns {Promise<object|null>} - Link or null if not found
   */
  async readLink(id) {
    const query = `(((${id}: $s $t)) ((${id}: $s $t)))`;
    const output = await this.executeQuery(query, { after: true });
    const links = this.parseLinks(output);
    return links.length > 0 ? links[0] : null;
  }

  /**
   * Update a link
   * @param {number} id - Link ID
   * @param {number} newSource - New source value
   * @param {number} newTarget - New target value
   * @returns {Promise<object>} - Updated link
   */
  async updateLink(id, newSource, newTarget) {
    const query = `(((${id}: $s $t)) ((${id}: ${newSource} ${newTarget})))`;
    const output = await this.executeQuery(query, { changes: true });

    const match = output.match(/\((\d+):\s+(\d+)\s+(\d+)\)/);
    if (match) {
      return {
        id: parseInt(match[1]),
        source: parseInt(match[2]),
        target: parseInt(match[3])
      };
    }

    throw new Error('Failed to parse updated link');
  }

  /**
   * Delete a link
   * @param {number} id - Link ID
   * @returns {Promise<void>}
   */
  async deleteLink(id) {
    const query = `(((${id}: $s $t)) ())`;
    await this.executeQuery(query, { changes: true });
  }

  /**
   * Search links by source
   * @param {number} source - Source value
   * @returns {Promise<Array<object>>} - Matching links
   */
  async findBySource(source) {
    const query = `((($i: ${source} $t)) (($i: ${source} $t)))`;
    const output = await this.executeQuery(query, { after: true });
    return this.parseLinks(output);
  }

  /**
   * Search links by target
   * @param {number} target - Target value
   * @returns {Promise<Array<object>>} - Matching links
   */
  async findByTarget(target) {
    const query = `((($i: $s ${target})) (($i: $s ${target})))`;
    const output = await this.executeQuery(query, { after: true });
    return this.parseLinks(output);
  }

  /**
   * Count total links in database
   * @returns {Promise<number>} - Link count
   */
  async count() {
    const links = await this.readAllLinks();
    return links.length;
  }

  /**
   * Check if database file exists
   * @returns {Promise<boolean>}
   */
  async exists() {
    try {
      await fs.access(this.dbPath);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Create a LinkDB service instance
 * @param {string} dbPath - Path to .links database file
 * @returns {LinkDBService}
 */
export function createLinkDB(dbPath) {
  return new LinkDBService(dbPath);
}
