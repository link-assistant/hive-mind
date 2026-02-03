#!/usr/bin/env node
/**
 * Tests for LINO Codec (Links Notation encoding/decoding)
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1193
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';

// Import the codec
import { encode, decode, ObjectCodec } from '../dependencies/lino-rest-api/codec.mjs';

describe('LINO Codec - Primitive Values', () => {
  it('should encode/decode null', () => {
    const encoded = encode(null);
    assert.strictEqual(encoded, 'null');
    assert.strictEqual(decode(encoded), null);
  });

  it('should encode/decode undefined', () => {
    const encoded = encode(undefined);
    assert.strictEqual(encoded, 'undefined');
    assert.strictEqual(decode(encoded), undefined);
  });

  it('should encode/decode booleans', () => {
    assert.strictEqual(encode(true), 'true');
    assert.strictEqual(encode(false), 'false');
    assert.strictEqual(decode('true'), true);
    assert.strictEqual(decode('false'), false);
  });

  it('should encode/decode integers', () => {
    assert.strictEqual(encode(42), '42');
    assert.strictEqual(encode(-17), '-17');
    assert.strictEqual(encode(0), '0');
    assert.strictEqual(decode('42'), 42);
    assert.strictEqual(decode('-17'), -17);
  });

  it('should encode/decode floats', () => {
    assert.strictEqual(encode(3.14), '3.14');
    assert.strictEqual(decode('3.14'), 3.14);
  });

  it('should encode/decode special float values', () => {
    assert.strictEqual(encode(NaN), 'NaN');
    assert.strictEqual(encode(Infinity), 'Infinity');
    assert.strictEqual(encode(-Infinity), '-Infinity');
    assert.ok(Number.isNaN(decode('NaN')));
    assert.strictEqual(decode('Infinity'), Infinity);
    assert.strictEqual(decode('-Infinity'), -Infinity);
  });

  it('should encode/decode simple strings', () => {
    const encoded = encode('hello');
    assert.strictEqual(encoded, 'hello');
    assert.strictEqual(decode(encoded), 'hello');
  });

  it('should encode/decode strings with special characters', () => {
    const encoded = encode('hello world');
    assert.ok(encoded.startsWith('"'));
    assert.ok(encoded.endsWith('"'));
    assert.strictEqual(decode(encoded), 'hello world');
  });

  it('should encode/decode strings with escapes', () => {
    const str = 'line1\nline2';
    const encoded = encode(str);
    const decoded = decode(encoded);
    assert.strictEqual(decoded, str);
  });
});

describe('LINO Codec - Arrays', () => {
  it('should encode/decode empty arrays', () => {
    const encoded = encode([]);
    assert.strictEqual(encoded, '()');
    assert.deepStrictEqual(decode('()'), []);
  });

  it('should encode/decode simple arrays', () => {
    const arr = [1, 2, 3];
    const encoded = encode(arr);
    assert.ok(encoded.includes('1'));
    assert.ok(encoded.includes('2'));
    assert.ok(encoded.includes('3'));

    const decoded = decode(encoded);
    assert.deepStrictEqual(decoded, arr);
  });

  it('should encode/decode mixed arrays', () => {
    const arr = ['hello', 42, true];
    const encoded = encode(arr);
    const decoded = decode(encoded);
    assert.deepStrictEqual(decoded, arr);
  });
});

describe('LINO Codec - Objects', () => {
  it('should encode/decode empty objects', () => {
    const encoded = encode({});
    assert.strictEqual(encoded, '{}');
    assert.deepStrictEqual(decode('{}'), {});
  });

  it('should encode/decode simple objects', () => {
    const obj = { name: 'test', count: 5 };
    const encoded = encode(obj);
    assert.ok(encoded.includes('name'));
    assert.ok(encoded.includes('test'));
    assert.ok(encoded.includes('count'));
    assert.ok(encoded.includes('5'));

    const decoded = decode(encoded);
    assert.deepStrictEqual(decoded, obj);
  });

  it('should encode/decode nested objects', () => {
    const obj = {
      user: {
        name: 'John',
        age: 30,
      },
      active: true,
    };

    const encoded = encode(obj);
    const decoded = decode(encoded);

    assert.strictEqual(decoded.user.name, 'John');
    assert.strictEqual(decoded.user.age, 30);
    assert.strictEqual(decoded.active, true);
  });
});

describe('LINO Codec - Complex Structures', () => {
  it('should encode/decode API response-like objects', () => {
    const response = {
      success: true,
      data: {
        id: 123,
        items: [1, 2, 3],
      },
      error: null,
    };

    const encoded = encode(response);
    const decoded = decode(encoded);

    assert.strictEqual(decoded.success, true);
    assert.strictEqual(decoded.data.id, 123);
    assert.deepStrictEqual(decoded.data.items, [1, 2, 3]);
    assert.strictEqual(decoded.error, null);
  });
});

describe('ObjectCodec Instance', () => {
  it('should create new codec instances', () => {
    const codec = new ObjectCodec();
    assert.ok(codec instanceof ObjectCodec);
  });

  it('should reset state between operations', () => {
    const codec = new ObjectCodec();

    const result1 = codec.encode({ a: 1 });
    const result2 = codec.encode({ b: 2 });

    // Both should encode independently
    assert.ok(result1.includes('a'));
    assert.ok(result2.includes('b'));
  });
});

// Run tests
console.log('Running lino-codec tests...');
