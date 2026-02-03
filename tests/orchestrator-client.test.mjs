#!/usr/bin/env node
/**
 * Tests for Orchestrator Client Library
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1193
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';

// Import the client
import { OrchestratorClient, createOrchestratorClient, parseOrchestratorUrl, DEFAULT_API_VERSION } from '../src/orchestrator-client.lib.mjs';

describe('parseOrchestratorUrl', () => {
  it('should return null for empty input', () => {
    assert.strictEqual(parseOrchestratorUrl(null), null);
    assert.strictEqual(parseOrchestratorUrl(undefined), null);
    assert.strictEqual(parseOrchestratorUrl(''), null);
  });

  it('should pass through http URLs', () => {
    const url = 'http://localhost:8080';
    assert.strictEqual(parseOrchestratorUrl(url), url);
  });

  it('should pass through https URLs', () => {
    const url = 'https://orchestrator.example.com';
    assert.strictEqual(parseOrchestratorUrl(url), url);
  });

  it('should remove trailing slash from URLs', () => {
    assert.strictEqual(parseOrchestratorUrl('http://localhost:8080/'), 'http://localhost:8080');
  });

  it('should add http:// prefix to hostname:port', () => {
    assert.strictEqual(parseOrchestratorUrl('localhost:8080'), 'http://localhost:8080');
    assert.strictEqual(parseOrchestratorUrl('192.168.1.1:3000'), 'http://192.168.1.1:3000');
  });
});

describe('OrchestratorClient', () => {
  it('should create client with default options', () => {
    const client = new OrchestratorClient('http://localhost:8080');

    assert.strictEqual(client.baseUrl, 'http://localhost:8080');
    assert.strictEqual(client.apiVersion, DEFAULT_API_VERSION);
    assert.strictEqual(client.verbose, false);
  });

  it('should create client with custom options', () => {
    const client = new OrchestratorClient('http://localhost:8080', {
      apiVersion: 'v1',
      verbose: true,
    });

    assert.strictEqual(client.apiVersion, 'v1');
    assert.strictEqual(client.verbose, true);
  });

  it('should parse hostname:port format', () => {
    const client = new OrchestratorClient('localhost:8080');
    assert.strictEqual(client.baseUrl, 'http://localhost:8080');
  });

  it('should generate correct endpoint URLs', () => {
    const client = new OrchestratorClient('http://localhost:8080', {
      apiVersion: 'v0',
    });

    assert.strictEqual(client.getEndpoint('/solve/queue'), 'http://localhost:8080/api/v0/solve/queue');

    assert.strictEqual(client.getEndpoint('/solve/enqueue'), 'http://localhost:8080/api/v0/solve/enqueue');
  });
});

describe('createOrchestratorClient', () => {
  it('should create client instance', () => {
    const client = createOrchestratorClient('http://localhost:8080');

    assert.ok(client instanceof OrchestratorClient);
    assert.strictEqual(client.baseUrl, 'http://localhost:8080');
  });

  it('should pass options to client', () => {
    const client = createOrchestratorClient('http://localhost:8080', {
      verbose: true,
    });

    assert.strictEqual(client.verbose, true);
  });
});

describe('DEFAULT_API_VERSION', () => {
  it('should be v0', () => {
    assert.strictEqual(DEFAULT_API_VERSION, 'v0');
  });
});

// Run tests
console.log('Running orchestrator-client tests...');
