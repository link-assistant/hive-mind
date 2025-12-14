/**
 * Object encoder/decoder for Links Notation format.
 */

import { Parser, Link } from 'links-notation';

/**
 * Codec for encoding/decoding JavaScript objects to/from Links Notation.
 */
export class ObjectCodec {
  // Type identifiers
  static TYPE_NULL = 'null';
  static TYPE_UNDEFINED = 'undefined';
  static TYPE_BOOL = 'bool';
  static TYPE_INT = 'int';
  static TYPE_FLOAT = 'float';
  static TYPE_STR = 'str';
  static TYPE_ARRAY = 'array';
  static TYPE_OBJECT = 'object';

  constructor() {
    this.parser = new Parser();
    // For tracking object identity during encoding
    this._encodeMemo = new Map();
    this._encodeCounter = 0;
    // For tracking which objects need IDs (referenced multiple times or circularly)
    this._needsId = new Set();
    // For tracking references during decoding
    this._decodeMemo = new Map();
  }

  /**
   * Create a Link from string parts.
   * @param {...string} parts - String parts to include in the link
   * @returns {Link} Link object with parts as Link values
   */
  _makeLink(...parts) {
    // Each part becomes a Link with that id
    const values = parts.map(part => new Link(part));
    return new Link(undefined, values);
  }

  /**
   * First pass: identify which objects need IDs (referenced multiple times or circularly).
   * @param {*} obj - The object to analyze
   * @param {Map} seen - Map tracking how many times we've seen each object
   */
  _findObjectsNeedingIds(obj, seen = new Map()) {
    // Only track mutable objects (arrays and objects)
    if (obj === null || typeof obj !== 'object') {
      return;
    }

    // If we've seen this object before, it needs an ID
    if (seen.has(obj)) {
      this._needsId.add(obj);
      return; // Don't recurse again
    }

    // Mark as seen
    seen.set(obj, 1);

    // Recurse into structure
    if (Array.isArray(obj)) {
      for (const item of obj) {
        this._findObjectsNeedingIds(item, seen);
      }
    } else if (typeof obj === 'object') {
      for (const [key, value] of Object.entries(obj)) {
        this._findObjectsNeedingIds(key, seen);
        this._findObjectsNeedingIds(value, seen);
      }
    }
  }

  /**
   * Encode a JavaScript object to Links Notation format.
   * @param {Object} options - Options
   * @param {*} options.obj - The JavaScript object to encode
   * @returns {string} String representation in Links Notation format
   */
  encode(options = {}) {
    const { obj } = options;
    // Reset state for each encode operation
    this._encodeMemo = new Map();
    this._encodeCounter = 0;
    this._needsId = new Set();

    // First pass: identify which objects need IDs (referenced multiple times or circularly)
    this._findObjectsNeedingIds(obj);

    // Encode the object
    const link = this._encodeValue(obj);

    // Return formatted link
    return link.format();
  }

  /**
   * Decode Links Notation format to a JavaScript object.
   * @param {Object} options - Options
   * @param {string} options.notation - String in Links Notation format
   * @returns {*} Reconstructed JavaScript object
   */
  decode(options = {}) {
    const { notation } = options;
    // Reset memo for each decode operation
    this._decodeMemo = new Map();
    this._allLinks = [];

    const links = this.parser.parse(notation);
    if (!links || links.length === 0) {
      return null;
    }

    // If there are multiple links, store them all for forward reference resolution
    if (links.length > 1) {
      this._allLinks = links;
      // Decode the first link (this will be the main result)
      // Forward references will be resolved automatically
      return this._decodeLink(links[0]);
    }

    let link = links[0];

    // Handle case where format() creates output like (obj_0) which parser wraps
    // The parser returns a wrapper Link with no ID, containing the actual Link as first value
    if (!link.id && link.values && link.values.length === 1 &&
        link.values[0].id && link.values[0].id.startsWith('obj_')) {
      // Extract the actual Link
      link = link.values[0];
    }

    return this._decodeLink(link);
  }

  /**
   * Encode a value into a Link.
   * @param {*} obj - The value to encode
   * @param {Set} visited - Set of object references currently being processed (for cycle detection)
   * @returns {Link} Link object
   */
  _encodeValue(obj, visited = new Set()) {
    // Check if we've seen this object before (for circular references and shared objects)
    // Only track objects and arrays (mutable types)
    if (obj !== null && (typeof obj === 'object')) {
      if (this._encodeMemo.has(obj)) {
        // Return a direct reference using the object's ID
        const refId = this._encodeMemo.get(obj);
        return new Link(refId);
      }

      // For mutable objects that need IDs, assign them
      if (this._needsId.has(obj)) {
        if (visited.has(obj)) {
          // We're in a cycle, create a direct reference
          if (!this._encodeMemo.has(obj)) {
            // Assign an ID for this object
            const refId = `obj_${this._encodeCounter}`;
            this._encodeCounter += 1;
            this._encodeMemo.set(obj, refId);
          }
          const refId = this._encodeMemo.get(obj);
          return new Link(refId);
        }

        // Add to visited set
        visited = new Set([...visited, obj]);

        // Assign an ID to this object
        const refId = `obj_${this._encodeCounter}`;
        this._encodeCounter += 1;
        this._encodeMemo.set(obj, refId);
      }
    }

    // Encode based on type
    if (obj === null) {
      return this._makeLink(ObjectCodec.TYPE_NULL);
    }

    if (obj === undefined) {
      return this._makeLink(ObjectCodec.TYPE_UNDEFINED);
    }

    if (typeof obj === 'boolean') {
      return this._makeLink(ObjectCodec.TYPE_BOOL, String(obj));
    }

    if (typeof obj === 'number') {
      // Handle special float values
      if (Number.isNaN(obj)) {
        return this._makeLink(ObjectCodec.TYPE_FLOAT, 'NaN');
      }
      if (!Number.isFinite(obj)) {
        if (obj > 0) {
          return this._makeLink(ObjectCodec.TYPE_FLOAT, 'Infinity');
        } else {
          return this._makeLink(ObjectCodec.TYPE_FLOAT, '-Infinity');
        }
      }
      // Check if it's an integer
      if (Number.isInteger(obj)) {
        return this._makeLink(ObjectCodec.TYPE_INT, String(obj));
      }
      return this._makeLink(ObjectCodec.TYPE_FLOAT, String(obj));
    }

    if (typeof obj === 'string') {
      // Encode strings as base64 to handle special characters, newlines, etc.
      const b64Encoded = Buffer.from(obj, 'utf-8').toString('base64');
      return this._makeLink(ObjectCodec.TYPE_STR, b64Encoded);
    }

    if (Array.isArray(obj)) {
      const parts = [];
      for (const item of obj) {
        // Encode each item
        const itemLink = this._encodeValue(item, visited);
        parts.push(itemLink);
      }
      // If this array has an ID, use self-reference format: (obj_id: array item1 item2 ...)
      if (this._encodeMemo.has(obj)) {
        const refId = this._encodeMemo.get(obj);
        // Return the inline definition with self-reference ID
        return new Link(refId, [new Link(ObjectCodec.TYPE_ARRAY), ...parts]);
      } else {
        // Wrap in a type marker for arrays without IDs: (array item1 item2 ...)
        return new Link(undefined, [new Link(ObjectCodec.TYPE_ARRAY), ...parts]);
      }
    }

    if (typeof obj === 'object') {
      const parts = [];
      for (const [key, value] of Object.entries(obj)) {
        // Encode key and value
        const keyLink = this._encodeValue(key, visited);
        const valueLink = this._encodeValue(value, visited);
        // Create a pair link
        const pair = new Link(undefined, [keyLink, valueLink]);
        parts.push(pair);
      }
      // If this object has an ID, use self-reference format: (obj_id: object (key val) ...)
      if (this._encodeMemo.has(obj)) {
        const refId = this._encodeMemo.get(obj);
        // Return the inline definition with self-reference ID
        return new Link(refId, [new Link(ObjectCodec.TYPE_OBJECT), ...parts]);
      } else {
        // Wrap in a type marker for objects without IDs: (object (key val) ...)
        return new Link(undefined, [new Link(ObjectCodec.TYPE_OBJECT), ...parts]);
      }
    }

    throw new TypeError(`Unsupported type: ${typeof obj}`);
  }

  /**
   * Decode a Link into a JavaScript value.
   * @param {Link} link - Link object to decode
   * @returns {*} Decoded JavaScript value
   */
  _decodeLink(link) {
    // Check if this is a direct reference to a previously decoded object
    // Direct references have an id but no values, or the id refers to an existing object
    if (link.id && this._decodeMemo.has(link.id)) {
      return this._decodeMemo.get(link.id);
    }

    if (!link.values || link.values.length === 0) {
      // Empty link - this might be a simple id, reference, or empty collection
      if (link.id) {
        // If it's in memo, return the cached object
        if (this._decodeMemo.has(link.id)) {
          return this._decodeMemo.get(link.id);
        }

        // If it starts with obj_, check if we have a forward reference in _allLinks
        if (link.id.startsWith('obj_') && this._allLinks.length > 0) {
          // Look for this ID in the remaining links
          for (const otherLink of this._allLinks) {
            if (otherLink.id === link.id) {
              // Found it! Decode it now
              return this._decodeLink(otherLink);
            }
          }

          // Not found in links - create empty array as fallback
          const result = [];
          this._decodeMemo.set(link.id, result);
          return result;
        }

        // Otherwise it's just a string ID
        return link.id;
      }
      return null;
    }

    // Check if this link has a self-reference ID (format: obj_0: type ...)
    let selfRefId = null;
    if (link.id && link.id.startsWith('obj_')) {
      selfRefId = link.id;
    }

    // Get the type marker from the first value
    const firstValue = link.values[0];
    if (!firstValue || !firstValue.id) {
      // Not a type marker we recognize
      return null;
    }

    const typeMarker = firstValue.id;

    if (typeMarker === ObjectCodec.TYPE_NULL) {
      return null;
    }

    if (typeMarker === ObjectCodec.TYPE_UNDEFINED) {
      return undefined;
    }

    if (typeMarker === ObjectCodec.TYPE_BOOL) {
      if (link.values.length > 1) {
        const boolValue = link.values[1];
        if (boolValue && boolValue.id) {
          return boolValue.id === 'true';
        }
      }
      return false;
    }

    if (typeMarker === ObjectCodec.TYPE_INT) {
      if (link.values.length > 1) {
        const intValue = link.values[1];
        if (intValue && intValue.id) {
          return parseInt(intValue.id, 10);
        }
      }
      return 0;
    }

    if (typeMarker === ObjectCodec.TYPE_FLOAT) {
      if (link.values.length > 1) {
        const floatValue = link.values[1];
        if (floatValue && floatValue.id) {
          const valueStr = floatValue.id;
          if (valueStr === 'NaN') {
            return NaN;
          } else if (valueStr === 'Infinity') {
            return Infinity;
          } else if (valueStr === '-Infinity') {
            return -Infinity;
          } else {
            return parseFloat(valueStr);
          }
        }
      }
      return 0.0;
    }

    if (typeMarker === ObjectCodec.TYPE_STR) {
      if (link.values.length > 1) {
        const strValue = link.values[1];
        if (strValue && strValue.id) {
          const b64Str = strValue.id;
          // Decode from base64
          try {
            return Buffer.from(b64Str, 'base64').toString('utf-8');
          } catch {
            // If decode fails, return the raw value
            return b64Str;
          }
        }
      }
      return '';
    }

    if (typeMarker === ObjectCodec.TYPE_ARRAY) {
      // New format with self-reference: (obj_0: array item1 item2 ...)
      // Old format (for backward compatibility): (array obj_id item1 item2 ...)
      let startIdx = 1;
      let arrayId = selfRefId;  // Use self-reference ID from link.id if present

      // Check for old format with obj_id as second element
      if (!arrayId && link.values.length > 1) {
        const second = link.values[1];
        if (second && second.id && second.id.startsWith('obj_')) {
          arrayId = second.id;
          startIdx = 2;
        }
      }

      const resultArray = [];
      if (arrayId) {
        this._decodeMemo.set(arrayId, resultArray);
      }

      for (let i = startIdx; i < link.values.length; i++) {
        const itemLink = link.values[i];
        const decodedItem = this._decodeLink(itemLink);
        resultArray.push(decodedItem);
      }
      return resultArray;
    }

    if (typeMarker === ObjectCodec.TYPE_OBJECT) {
      // New format with self-reference: (obj_0: object (key val) ...)
      // Old format (for backward compatibility): (object obj_id (key val) ...)
      let startIdx = 1;
      let objectId = selfRefId;  // Use self-reference ID from link.id if present

      // Check for old format with obj_id as second element
      if (!objectId && link.values.length > 1) {
        const second = link.values[1];
        if (second && second.id && second.id.startsWith('obj_')) {
          objectId = second.id;
          startIdx = 2;
        }
      }

      const resultObject = {};
      if (objectId) {
        this._decodeMemo.set(objectId, resultObject);
      }

      for (let i = startIdx; i < link.values.length; i++) {
        const pairLink = link.values[i];
        if (pairLink.values && pairLink.values.length >= 2) {
          const keyLink = pairLink.values[0];
          const valueLink = pairLink.values[1];

          const decodedKey = this._decodeLink(keyLink);
          const decodedValue = this._decodeLink(valueLink);

          resultObject[decodedKey] = decodedValue;
        }
      }
      return resultObject;
    }

    // Unknown type marker
    throw new Error(`Unknown type marker: ${typeMarker}`);
  }
}

// Convenience functions
const _defaultCodec = new ObjectCodec();

/**
 * Encode a JavaScript object to Links Notation format.
 * @param {Object} options - Options
 * @param {*} options.obj - The JavaScript object to encode
 * @returns {string} String representation in Links Notation format
 */
export function encode(options = {}) {
  return _defaultCodec.encode(options);
}

/**
 * Decode Links Notation format to a JavaScript object.
 * @param {Object} options - Options
 * @param {string} options.notation - String in Links Notation format
 * @returns {*} Reconstructed JavaScript object
 */
export function decode(options = {}) {
  return _defaultCodec.decode(options);
}
