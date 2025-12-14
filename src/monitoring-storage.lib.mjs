// Storage interface abstraction for monitoring database
// This module provides a common interface for both .lino (text) and .links (binary) formats
// allowing them to be tested separately while used together for fault tolerance.

import { promises as fs } from 'fs';
import path from 'path';
import { encode, decode } from './vendor/link-notation-objects-codec/index.js';
import { createLinkDB } from './link-db-service.lib.mjs';

/**
 * Abstract storage interface for monitoring database events.
 * Both text (.lino) and binary (.links) formats implement this interface.
 */
export class StorageInterface {
  /**
   * Append an event to the storage
   * @param {object} eventRecord - The event record to store
   * @returns {Promise<boolean>} - True if write was successful
   */
  // eslint-disable-next-line no-unused-vars
  async append(eventRecord) {
    throw new Error('Not implemented');
  }

  /**
   * Verify that the last appended event was saved correctly
   * @param {object} eventRecord - The event record that was written
   * @returns {Promise<boolean>} - True if verification passed
   */
  // eslint-disable-next-line no-unused-vars
  async verify(eventRecord) {
    throw new Error('Not implemented');
  }

  /**
   * Read all events from storage
   * @returns {Promise<Array>} - Array of event records
   */
  async readAll() {
    throw new Error('Not implemented');
  }

  /**
   * Check if storage is available/initialized
   * @returns {Promise<boolean>} - True if storage is ready
   */
  async isAvailable() {
    throw new Error('Not implemented');
  }
}

/**
 * Text storage implementation using Links Notation (.lino) format.
 * This is the primary storage format - human-readable and always available.
 */
export class LinoStorage extends StorageInterface {
  constructor(filePath) {
    super();
    this.filePath = filePath;
  }

  /**
   * Initialize the storage file
   */
  async initialize() {
    try {
      await fs.access(this.filePath);
    } catch {
      // Create directory if needed
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, '', 'utf-8');
    }
  }

  async isAvailable() {
    try {
      await fs.access(this.filePath);
      return true;
    } catch {
      return false;
    }
  }

  async append(eventRecord) {
    try {
      const encodedEvent = encode({ obj: eventRecord });
      await fs.appendFile(this.filePath, encodedEvent + '\n', 'utf-8');
      return true;
    } catch (error) {
      console.error('LinoStorage: Failed to append event:', error.message);
      return false;
    }
  }

  async verify(eventRecord) {
    try {
      // Read the file and check if the last line contains our event
      const content = await fs.readFile(this.filePath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());

      if (lines.length === 0) {
        return false;
      }

      // Get the last line and decode it
      const lastLine = lines[lines.length - 1];
      const decodedEvent = decode({ notation: lastLine });

      // Verify the event ID matches
      if (decodedEvent && decodedEvent.id === eventRecord.id) {
        return true;
      }

      // If last line doesn't match, search for the event (in case of concurrent writes)
      for (let i = lines.length - 1; i >= Math.max(0, lines.length - 10); i--) {
        try {
          const decoded = decode({ notation: lines[i] });
          if (decoded && decoded.id === eventRecord.id) {
            return true;
          }
        } catch {
          // Continue searching
        }
      }

      return false;
    } catch (error) {
      console.error('LinoStorage: Failed to verify event:', error.message);
      return false;
    }
  }

  async readAll() {
    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());

      const events = [];
      for (const line of lines) {
        try {
          const event = decode({ notation: line });
          if (event) {
            events.push(event);
          }
        } catch (err) {
          console.error('LinoStorage: Failed to decode line:', err.message);
        }
      }
      return events;
    } catch (err) {
      if (err.code === 'ENOENT') {
        return [];
      }
      throw err;
    }
  }

  /**
   * Get the count of events in storage
   * @returns {Promise<number>} - Number of events
   */
  async count() {
    const events = await this.readAll();
    return events.length;
  }
}

/**
 * Binary storage implementation using .links doublet format.
 * This is the secondary storage format - requires clink to be installed.
 */
export class LinksStorage extends StorageInterface {
  constructor(filePath) {
    super();
    this.filePath = filePath;
    this.linkDB = null;
    this.available = false;
  }

  /**
   * Initialize the storage and check if clink is available
   */
  async initialize() {
    this.linkDB = createLinkDB(this.filePath);
    try {
      this.available = await this.linkDB.checkClinkAvailable();
    } catch {
      this.available = false;
    }
    return this.available;
  }

  async isAvailable() {
    return this.available;
  }

  /**
   * Simple string hash function for converting event IDs to numbers
   */
  hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash) % 1000000;
  }

  async append(eventRecord) {
    if (!this.available) {
      return false;
    }

    try {
      // For the .links binary format, we encode the event as a doublet
      // source: hash of the event ID (to make it unique)
      // target: timestamp
      const eventIdHash = this.hashString(eventRecord.id);
      const timestamp = eventRecord.timestamp;

      await this.linkDB.createLink(eventIdHash, timestamp);
      return true;
    } catch (error) {
      console.error('LinksStorage: Failed to append event:', error.message);
      return false;
    }
  }

  async verify(eventRecord) {
    if (!this.available) {
      return false;
    }

    try {
      // Verify by searching for the link with matching source hash
      const eventIdHash = this.hashString(eventRecord.id);
      const links = await this.linkDB.findBySource(eventIdHash);

      // Check if any link matches our timestamp
      for (const link of links) {
        if (link.target === eventRecord.timestamp) {
          return true;
        }
      }
      return false;
    } catch (error) {
      console.error('LinksStorage: Failed to verify event:', error.message);
      return false;
    }
  }

  async readAll() {
    if (!this.available) {
      return [];
    }

    try {
      return await this.linkDB.readAllLinks();
    } catch (error) {
      console.error('LinksStorage: Failed to read all links:', error.message);
      return [];
    }
  }

  /**
   * Get the count of links in storage
   * @returns {Promise<number>} - Number of links
   */
  async count() {
    if (!this.available) {
      return 0;
    }
    try {
      return await this.linkDB.count();
    } catch {
      return 0;
    }
  }
}

/**
 * Dual storage that combines both text (.lino) and binary (.links) formats.
 * Provides fault tolerance by writing to both formats simultaneously.
 */
export class DualStorage {
  constructor(databaseDir) {
    this.databaseDir = databaseDir;
    this.linoStorage = new LinoStorage(path.join(databaseDir, 'db.lino'));
    this.linksStorage = new LinksStorage(path.join(databaseDir, 'db.links'));
    this.initialized = false;
  }

  /**
   * Initialize both storage backends
   */
  async initialize() {
    await this.linoStorage.initialize();
    const linksAvailable = await this.linksStorage.initialize();

    if (!linksAvailable) {
      console.warn('Warning: clink (link-cli) is not installed. The .links binary database will not be created.');
      console.warn('To enable .links support, install link-cli: dotnet tool install --global clink');
    }

    this.initialized = true;
  }

  /**
   * Check if both storages are available
   * @returns {object} - Availability status for each storage
   */
  async getAvailability() {
    return {
      lino: await this.linoStorage.isAvailable(),
      links: await this.linksStorage.isAvailable()
    };
  }

  /**
   * Append an event to both storages and verify
   * @param {object} eventRecord - The event record to store
   * @returns {object} - Result object with success status and verification results
   */
  async appendAndVerify(eventRecord) {
    const result = {
      success: false,
      linoWritten: false,
      linoVerified: false,
      linksWritten: false,
      linksVerified: false,
      errors: []
    };

    // Write to .lino storage (primary)
    result.linoWritten = await this.linoStorage.append(eventRecord);
    if (!result.linoWritten) {
      result.errors.push('Failed to write to .lino storage');
    } else {
      // Verify .lino write
      result.linoVerified = await this.linoStorage.verify(eventRecord);
      if (!result.linoVerified) {
        result.errors.push('Failed to verify .lino write');
      }
    }

    // Write to .links storage (secondary, if available)
    if (await this.linksStorage.isAvailable()) {
      result.linksWritten = await this.linksStorage.append(eventRecord);
      if (!result.linksWritten) {
        result.errors.push('Failed to write to .links storage');
      } else {
        // Verify .links write
        result.linksVerified = await this.linksStorage.verify(eventRecord);
        if (!result.linksVerified) {
          result.errors.push('Failed to verify .links write');
        }
      }
    }

    // Overall success requires at least .lino to succeed (it's the primary format)
    result.success = result.linoWritten && result.linoVerified;

    return result;
  }

  /**
   * Read all events from .lino storage (primary source of truth)
   * @returns {Promise<Array>} - Array of event records
   */
  async readAllEvents() {
    return await this.linoStorage.readAll();
  }

  /**
   * Get storage statistics
   * @returns {object} - Statistics for both storages
   */
  async getStorageStats() {
    const linoCount = await this.linoStorage.count();
    const linksCount = await this.linksStorage.count();
    const linksAvailable = await this.linksStorage.isAvailable();

    return {
      linoEventCount: linoCount,
      linksEventCount: linksCount,
      linksAvailable,
      inSync: linksAvailable ? linoCount === linksCount : true
    };
  }
}

/**
 * Create a dual storage instance
 * @param {string} databaseDir - Path to database directory
 * @returns {Promise<DualStorage>} - Initialized dual storage
 */
export async function createDualStorage(databaseDir) {
  const storage = new DualStorage(databaseDir);
  await storage.initialize();
  return storage;
}
