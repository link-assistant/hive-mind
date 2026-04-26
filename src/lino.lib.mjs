if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const linoModule = await use('links-notation');
const LinoParser = linoModule.Parser || linoModule.default?.Parser;

const fs = await import('fs');
const path = await import('path');
const os = await import('os');

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
          values.push(...collectStringValues(value));
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
          for (const linkValue of collectStringValues(value)) {
            const num = parseInt(linkValue);
            if (!isNaN(num)) {
              ids.push(num);
            }
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
      const links = [];

      if (link.values && link.values.length > 0) {
        for (const value of link.values) {
          for (const linkStr of collectStringValues(value)) {
            links.push(linkStr);
          }
        }
      } else if (link.id) {
        if (typeof link.id === 'string') {
          links.push(link.id);
        }
      }

      return links;
    }

    return [];
  }

  parseLinks(input) {
    if (!input) return [];

    const parsed = this.parser.parse(input);
    if (!parsed || parsed.length === 0) return [];

    const link = parsed[0];
    const pairs = [];

    if (link.values && link.values.length > 0) {
      const flatNumbers = [];

      for (const value of link.values) {
        if (value.id === null && value.values && value.values.length >= 2) {
          const source = parseInt(value.values[0]?.id || value.values[0], 10);
          const target = parseInt(value.values[1]?.id || value.values[1], 10);
          if (!isNaN(source) && !isNaN(target)) {
            pairs.push({ source, target });
          }
        } else if (value.id) {
          const num = parseInt(value.id, 10);
          if (!isNaN(num)) {
            flatNumbers.push(num);
          }
        }
      }

      for (let i = 0; i < flatNumbers.length - 1; i += 2) {
        pairs.push({ source: flatNumbers[i], target: flatNumbers[i + 1] });
      }
    }

    return pairs;
  }

  formatLinks(pairs) {
    if (!pairs || pairs.length === 0) return '()';

    const formattedValues = pairs.map(pair => `  ${pair.source} ${pair.target}`).join('\n');
    return `(\n${formattedValues}\n)`;
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
