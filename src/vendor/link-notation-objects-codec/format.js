/**
 * Formatting utilities for Links Notation.
 *
 * These utilities provide core functions for converting between JSON and Links Notation,
 * as well as escaping strings for safe use in Links Notation format.
 *
 * These tools enable easy implementation of higher-level features like:
 * - LinksNotationManager (from https://github.com/konard/follow/blob/main/lino.lib.mjs)
 * - Q&A database (from https://github.com/konard/hh-job-application-automation/blob/main/src/qa-database.mjs)
 *
 * @module link-notation-objects-codec/format
 */

import { Parser as LinoParser } from 'links-notation';

// Shared parser instance
const parser = new LinoParser();

/**
 * Escape a reference for Links Notation.
 *
 * In Links Notation, we have only references and links:
 * - Reference: An identifier or value (string, number, boolean)
 * - Link: A parenthesized sequence of references or nested links
 *
 * References need escaping when they contain spaces, quotes, parentheses, colons, or newlines:
 * - Use single quotes '' if the string contains spaces or double quotes
 * - Use double quotes "" if the string contains single quotes
 * - Use double quotes "" if it contains both (escape internal double quotes)
 *
 * @param {Object} options - Options
 * @param {*} options.value - The value to escape
 * @returns {string} The escaped reference
 */
export function escapeReference(options = {}) {
  const { value } = options;
  // Numbers and booleans don't need escaping
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  const str = String(value);

  // Check if escaping is needed (contains spaces, quotes, parentheses, colons, or newlines)
  const needsEscaping = /[\s()'":]/g.test(str) || str.includes('\n');

  if (!needsEscaping) {
    return str;
  }

  // If contains single quotes but not double quotes, use double quotes
  if (str.includes("'") && !str.includes('"')) {
    return `"${str}"`;
  }

  // If contains double quotes but not single quotes, use single quotes
  if (str.includes('"') && !str.includes("'")) {
    return `'${str}'`;
  }

  // If contains both quotes, count which one appears more
  // and use the other one to minimize escaping
  if (str.includes("'") && str.includes('"')) {
    const singleQuoteCount = (str.match(/'/g) || []).length;
    const doubleQuoteCount = (str.match(/"/g) || []).length;

    if (doubleQuoteCount < singleQuoteCount) {
      // Use double quotes, escape internal double quotes by doubling
      return `"${str.replace(/"/g, '""')}"`;
    } else {
      // Use single quotes, escape internal single quotes by doubling
      return `'${str.replace(/'/g, "''")}'`;
    }
  }

  // Just spaces or other special characters, use single quotes by default
  return `'${str}'`;
}

/**
 * Unescape a reference from Links Notation format.
 *
 * Reverses the escaping done by escapeReference:
 * - Doubled quotes "" become single "
 * - Doubled quotes '' become single '
 *
 * @param {Object} options - Options
 * @param {string} options.str - The escaped reference
 * @returns {string} The unescaped string
 */
export function unescapeReference(options = {}) {
  const { str } = options;
  if (!str) return str;

  // Unescape doubled quotes (Links Notation escape sequences)
  let unescaped = str.replace(/""/g, '"'); // "" -> "
  unescaped = unescaped.replace(/''/g, "'"); // '' -> '

  return unescaped;
}

/**
 * Convert JSON data to Links Notation recursively.
 *
 * Conversion rules:
 * - Primitives (number, boolean, string, null): Converted to references
 * - Array: Converted to a link (parenthesized sequence)
 * - Object: Converted to a link with key-value doublet pairs
 *   Each key-value pair becomes a nested link
 *
 * Example:
 *   { name: "John Doe", age: 30, active: true }
 * Becomes:
 *   ((name 'John Doe') (age 30) (active true))
 *
 * @param {Object} options - Options
 * @param {*} options.json - The JSON data to convert
 * @returns {string} Links Notation representation
 */
export function jsonToLino(options = {}) {
  const { json } = options;

  // Handle null and undefined
  if (json === null || json === undefined) {
    return 'null';
  }

  // Handle primitives
  if (typeof json === 'number' || typeof json === 'boolean') {
    return String(json);
  }

  if (typeof json === 'string') {
    return escapeReference({ value: json });
  }

  // Handle arrays - convert to link
  if (Array.isArray(json)) {
    if (json.length === 0) {
      return '()';
    }
    const elements = json.map(item => jsonToLino({ json: item }));
    return `(${elements.join(' ')})`;
  }

  // Handle objects - convert to key-value doublet pairs
  // Objects are ALWAYS represented as a link of pairs: ((key1 value1) (key2 value2) ...)
  // This makes the structure unambiguous
  if (typeof json === 'object') {
    const entries = Object.entries(json);
    if (entries.length === 0) {
      return '()';
    }

    // Wrap each key-value pair in its own link
    // ((key1 value1) (key2 value2) ...)
    const pairs = entries.map(([key, value]) => {
      const escapedKey = escapeReference({ value: key });
      const convertedValue = jsonToLino({ json: value });
      return `(${escapedKey} ${convertedValue})`;
    });

    return `(${pairs.join(' ')})`;
  }

  // Fallback for unknown types
  return escapeReference({ value: String(json) });
}

/**
 * Parse a reference to its primitive value.
 * @private
 */
function parseReference(ref) {
  const str = String(ref);

  // Try boolean
  if (str === 'true') return true;
  if (str === 'false') return false;

  // Try null
  if (str === 'null') return null;

  // Try number
  const num = Number(str);
  if (!isNaN(num) && str.trim() !== '') {
    return num;
  }

  // Return as string
  return str;
}

/**
 * Internal helper to convert parsed Links Notation to JSON.
 * @private
 */
function convertParsedToJson(element) {
  // If element is a simple value (reference)
  if (typeof element === 'string' || typeof element === 'number') {
    return parseReference(element);
  }

  // If element has an id and empty values array, it's a reference/primitive or empty link
  if (element.values && element.values.length === 0) {
    // If id is null, it's an empty link ()
    if (element.id === null) {
      return [];
    }
    // Otherwise it's a primitive reference
    return parseReference(element.id);
  }

  // If element is a link (has non-empty values)
  if (element.values && Array.isArray(element.values) && element.values.length > 0) {
    // Simple rule: If link contains pairs (all children are 2-element links), it's an object
    // Otherwise, it's an array

    const allPairs = element.values.every(child => {
      // Must be a link with exactly 2 elements
      if (!child.values || !Array.isArray(child.values) || child.values.length !== 2) {
        return false;
      }
      // First element (key) must be a primitive
      const keyElement = child.values[0];
      if (!(keyElement.id !== undefined && keyElement.values && keyElement.values.length === 0)) {
        return false;
      }
      // Key should be string-like (not a pure number)
      const keyValue = parseReference(keyElement.id);
      if (typeof keyValue === 'number') {
        return false;
      }
      return true;
    });

    if (allPairs) {
      // This is an object: ((key1 value1) (key2 value2) ...)
      const obj = {};
      for (const child of element.values) {
        const key = parseReference(child.values[0].id);
        const value = convertParsedToJson(child.values[1]);
        obj[key] = value;
      }
      return obj;
    }

    // Not pairs, so it's an array
    return element.values.map(v => convertParsedToJson(v));
  }

  return null;
}

/**
 * Convert Links Notation to JSON recursively.
 *
 * Conversion rules:
 * - References are converted to primitives (try number, boolean, then string)
 * - Links are analyzed:
 *   - If all elements are 2-element links with string-like keys, parse as object
 *   - Otherwise, parse as array
 *
 * @param {Object} options - Options
 * @param {string} options.lino - The Links Notation string
 * @returns {*} JSON representation
 */
export function linoToJson(options = {}) {
  const { lino } = options;
  if (!lino || typeof lino !== 'string') {
    return null;
  }

  const parsed = parser.parse(lino);

  if (!parsed || parsed.length === 0) {
    return null;
  }

  const result = convertParsedToJson(parsed[0]);

  // If the parser wrapped a single primitive in an array, unwrap it
  if (
    Array.isArray(result) &&
    result.length === 1 &&
    (typeof result[0] === 'string' ||
      typeof result[0] === 'number' ||
      typeof result[0] === 'boolean' ||
      result[0] === null)
  ) {
    return result[0];
  }

  return result;
}

/**
 * Format an array as Links Notation with proper indentation.
 *
 * @param {Object} options - Options
 * @param {Array} options.values - Array of values to format
 * @returns {string} Formatted Links Notation string
 */
export function formatAsLino(options = {}) {
  const { values } = options;
  if (!values || values.length === 0) return '()';

  const formattedValues = values.map(value => `  ${value}`).join('\n');
  return `(\n${formattedValues}\n)`;
}
