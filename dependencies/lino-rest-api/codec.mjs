/**
 * LINO ObjectCodec - Encoding/decoding for Links Notation format
 *
 * This module provides encoding/decoding functionality for the Links Notation (LINO) format.
 * It converts between JavaScript objects and LINO string representation.
 *
 * Based on: https://github.com/link-foundation/lino-rest-api
 */

/**
 * ObjectCodec for LINO format
 */
export class ObjectCodec {
  constructor() {
    this.encodeMap = new WeakMap();
    this.decodeMap = new Map();
    this.nextId = 1;
  }

  /**
   * Reset the codec state for a new encode/decode operation
   */
  reset() {
    this.encodeMap = new WeakMap();
    this.decodeMap = new Map();
    this.nextId = 1;
  }

  /**
   * Encode a JavaScript value to LINO notation
   * @param {*} value - Value to encode
   * @returns {string} LINO string representation
   */
  encode(value) {
    this.reset();
    return this._encodeValue(value, 0);
  }

  /**
   * Internal method to encode a value with proper indentation
   * @param {*} value - Value to encode
   * @param {number} depth - Current indentation depth
   * @returns {string}
   */
  _encodeValue(value, depth) {
    const indent = '  '.repeat(depth);
    const childIndent = '  '.repeat(depth + 1);

    if (value === null) {
      return 'null';
    }

    if (value === undefined) {
      return 'undefined';
    }

    const type = typeof value;

    if (type === 'boolean') {
      return value ? 'true' : 'false';
    }

    if (type === 'number') {
      if (Number.isNaN(value)) return 'NaN';
      if (value === Infinity) return 'Infinity';
      if (value === -Infinity) return '-Infinity';
      return String(value);
    }

    if (type === 'string') {
      // Encode strings with base64 for special characters
      if (/^[\w.-]+$/.test(value) && value.length > 0) {
        return value;
      }
      return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`;
    }

    if (type === 'function') {
      return `function:${value.name || 'anonymous'}`;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        return '()';
      }

      const items = value.map(item => `${childIndent}${this._encodeValue(item, depth + 1)}`);
      return `(\n${items.join('\n')}\n${indent})`;
    }

    if (type === 'object') {
      const keys = Object.keys(value);
      if (keys.length === 0) {
        return '{}';
      }

      const pairs = keys.map(key => {
        const encodedKey = /^[\w.-]+$/.test(key) ? key : `"${key}"`;
        const encodedValue = this._encodeValue(value[key], depth + 1);
        return `${childIndent}${encodedKey}: ${encodedValue}`;
      });
      return `{\n${pairs.join('\n')}\n${indent}}`;
    }

    return String(value);
  }

  /**
   * Decode a LINO string to JavaScript value
   * @param {string} lino - LINO string to decode
   * @returns {*} Decoded JavaScript value
   */
  decode(lino) {
    this.reset();
    const trimmed = lino.trim();
    return this._parseValue(trimmed);
  }

  /**
   * Internal method to parse a LINO value
   * @param {string} str - String to parse
   * @returns {*}
   */
  _parseValue(str) {
    str = str.trim();

    // Special values
    if (str === 'null') return null;
    if (str === 'undefined') return undefined;
    if (str === 'true') return true;
    if (str === 'false') return false;
    if (str === 'NaN') return NaN;
    if (str === 'Infinity') return Infinity;
    if (str === '-Infinity') return -Infinity;

    // Number
    if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(str)) {
      return Number(str);
    }

    // Quoted string
    if (str.startsWith('"') && str.endsWith('"')) {
      const inner = str.slice(1, -1);
      return inner.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }

    // Empty array
    if (str === '()') {
      return [];
    }

    // Array
    if (str.startsWith('(') && str.endsWith(')')) {
      const inner = str.slice(1, -1).trim();
      if (!inner) return [];
      return this._parseArrayItems(inner);
    }

    // Empty object
    if (str === '{}') {
      return {};
    }

    // Object
    if (str.startsWith('{') && str.endsWith('}')) {
      const inner = str.slice(1, -1).trim();
      if (!inner) return {};
      return this._parseObjectPairs(inner);
    }

    // Bare identifier (simple string)
    return str;
  }

  /**
   * Parse array items from inner content
   * @param {string} inner - Content inside ()
   * @returns {Array}
   */
  _parseArrayItems(inner) {
    const items = [];
    const entries = this._splitTopLevelEntries(inner);

    for (const entry of entries) {
      const trimmed = entry.trim();
      if (trimmed) {
        items.push(this._parseValue(trimmed));
      }
    }

    return items;
  }

  /**
   * Parse object key-value pairs from inner content
   * @param {string} inner - Content inside {}
   * @returns {Object}
   */
  _parseObjectPairs(inner) {
    const obj = {};
    const entries = this._splitTopLevelEntries(inner);

    for (const entry of entries) {
      const trimmed = entry.trim();
      if (!trimmed) continue;

      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) continue;

      let key = trimmed.slice(0, colonIdx).trim();
      const value = trimmed.slice(colonIdx + 1).trim();

      // Handle quoted keys
      if (key.startsWith('"') && key.endsWith('"')) {
        key = key.slice(1, -1);
      }

      obj[key] = this._parseValue(value);
    }

    return obj;
  }

  /**
   * Split content into top-level entries, respecting nested braces/parentheses
   * @param {string} content - Content to split
   * @returns {string[]}
   */
  _splitTopLevelEntries(content) {
    const entries = [];
    let current = '';
    let depth = 0;
    let inQuote = false;
    let escapeNext = false;

    for (let i = 0; i < content.length; i++) {
      const char = content[i];

      if (escapeNext) {
        current += char;
        escapeNext = false;
        continue;
      }

      if (char === '\\') {
        current += char;
        escapeNext = true;
        continue;
      }

      if (char === '"') {
        inQuote = !inQuote;
        current += char;
        continue;
      }

      if (inQuote) {
        current += char;
        continue;
      }

      if (char === '{' || char === '(') {
        depth++;
        current += char;
        continue;
      }

      if (char === '}' || char === ')') {
        depth--;
        current += char;
        continue;
      }

      if (char === '\n' && depth === 0) {
        if (current.trim()) {
          entries.push(current);
        }
        current = '';
        continue;
      }

      current += char;
    }

    if (current.trim()) {
      entries.push(current);
    }

    return entries;
  }
}

// Default codec instance
const defaultCodec = new ObjectCodec();

/**
 * Encode a value to LINO format
 * @param {*} value - Value to encode
 * @returns {string}
 */
export function encode(value) {
  return defaultCodec.encode(value);
}

/**
 * Decode a LINO string to JavaScript value
 * @param {string} lino - LINO string
 * @returns {*}
 */
export function decode(lino) {
  return defaultCodec.decode(lino);
}

export default { ObjectCodec, encode, decode };
