if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const linoModule = await use('links-notation');
const LinoParser = linoModule.Parser || linoModule.default?.Parser;

const fs = await import('fs');
const path = await import('path');
const os = await import('os');

export class LinksNotationManager {
  constructor() {
    this.parser = new LinoParser();
    this.cacheDir = path.join(os.homedir(), '.hive-mind');
  }

  parse(input) {
    if (!input) return [];

    const parsed = this.parser.parse(input);

    if (parsed && parsed.length > 0) {
      const link = parsed[0];
      const values = [];

      if (link.values && link.values.length > 0) {
        for (const value of link.values) {
          const val = value.id || value;
          values.push(val);
        }
      } else if (link.id) {
        values.push(link.id);
      }

      return values;
    }

    return [];
  }

  parseNumericIds(input) {
    if (!input) return [];

    const parsed = this.parser.parse(input);

    if (parsed && parsed.length > 0) {
      const link = parsed[0];
      const ids = [];

      if (link.values && link.values.length > 0) {
        for (const value of link.values) {
          const num = parseInt(value.id || value);
          if (!isNaN(num)) {
            ids.push(num);
          }
        }
      } else if (link.id) {
        const nums = link.id.match(/\d+/g);
        if (nums) {
          ids.push(...nums.map(n => parseInt(n)).filter(n => !isNaN(n)));
        }
      }

      return ids;
    }

    return [];
  }

  parseStringValues(input) {
    if (!input) return [];

    const parsed = this.parser.parse(input);

    if (parsed && parsed.length > 0) {
      const link = parsed[0];

      // Recursively extract all string values from nested structures
      // This handles cases where options are placed on the same line,
      // which creates nested tuples in LINO format (issue #1086)
      const extractStrings = linkNode => {
        const results = [];

        // If the node has an 'id', add it to results
        if (linkNode.id && typeof linkNode.id === 'string') {
          results.push(linkNode.id);
        }

        // Recursively process nested values
        if (linkNode.values && linkNode.values.length > 0) {
          for (const value of linkNode.values) {
            if (typeof value === 'string') {
              results.push(value);
            } else if (value && typeof value === 'object') {
              // Recursively extract from nested objects
              results.push(...extractStrings(value));
            }
          }
        }

        return results;
      };

      return extractStrings(link);
    }

    return [];
  }

  format(values) {
    if (!values || values.length === 0) return '()';

    const formattedValues = values.map(value => `  ${value}`).join('\n');
    return `(\n${formattedValues}\n)`;
  }

  async ensureCacheDir() {
    try {
      await fs.promises.access(this.cacheDir);
      return false;
    } catch {
      await fs.promises.mkdir(this.cacheDir, { recursive: true });
      return true;
    }
  }

  async saveToCache(filename, values) {
    await this.ensureCacheDir();
    const cacheFile = path.join(this.cacheDir, filename);
    const linksNotation = this.format(values);
    await fs.promises.writeFile(cacheFile, linksNotation);
    return cacheFile;
  }

  async loadFromCache(filename) {
    const cacheFile = path.join(this.cacheDir, filename);

    try {
      await fs.promises.access(cacheFile);
    } catch {
      return null;
    }

    const content = await fs.promises.readFile(cacheFile, 'utf8');
    return {
      raw: content,
      parsed: this.parse(content),
      numericIds: this.parseNumericIds(content),
      stringValues: this.parseStringValues(content),
      file: cacheFile,
    };
  }

  async cacheExists(filename) {
    const cacheFile = path.join(this.cacheDir, filename);
    try {
      await fs.promises.access(cacheFile);
      return true;
    } catch {
      return false;
    }
  }

  getCachePath(filename) {
    return path.join(this.cacheDir, filename);
  }

  async requireCache(filename, errorMessage) {
    const cache = await this.loadFromCache(filename);

    if (!cache) {
      const cacheFile = this.getCachePath(filename);
      console.error(`❌ ${errorMessage || `Cache file not found: ${cacheFile}`}`);
      console.log('💡 Run the appropriate script first to create the cache file');
      process.exit(1);
    }

    console.log(`📂 Using cached data from: ${cache.file}\n`);
    return cache;
  }
}

export const CACHE_FILES = {
  TELEGRAM_CHATS: 'telegram-chats.lino',
};

export const lino = new LinksNotationManager();
