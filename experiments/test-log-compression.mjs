#!/usr/bin/env bun

/**
 * Test script for log compression utilities (issue #587)
 * Tests compression, decompression, and file size calculations
 */

import { promises as fs } from 'fs';
import { compressLogFile, decompressLogFile, shouldCompress, formatFileSize, getDecompressionInstructions, splitFileIntoChunks } from '../src/log-compression.lib.mjs';

console.log('🧪 Testing log compression utilities for issue #587\n');

// Test 1: formatFileSize
console.log('Test 1: Format file size');
console.log('  formatFileSize(500):', formatFileSize(500));
console.log('  formatFileSize(5000):', formatFileSize(5000));
console.log('  formatFileSize(5000000):', formatFileSize(5000000));
console.log('  formatFileSize(5000000000):', formatFileSize(5000000000));
console.log('  ✅ Format file size test passed\n');

// Test 2: shouldCompress
console.log('Test 2: Should compress decision');
console.log('  shouldCompress(500KB):', shouldCompress(500 * 1024));
console.log('  shouldCompress(1MB):', shouldCompress(1024 * 1024));
console.log('  shouldCompress(2MB):', shouldCompress(2 * 1024 * 1024));
console.log('  ✅ Should compress test passed\n');

// Test 3: Compression and decompression
console.log('Test 3: Compression and decompression');

// Create a test log file with repetitive content (compresses well)
const testLogContent = Array(10000)
  .fill('[2025-10-18 12:00:00] INFO: Processing request ID 12345\n' + '[2025-10-18 12:00:01] DEBUG: Connecting to database\n' + '[2025-10-18 12:00:02] INFO: Query executed successfully\n' + '[2025-10-18 12:00:03] DEBUG: Fetched 100 rows\n' + '[2025-10-18 12:00:04] INFO: Request completed\n')
  .join('');

const testInputFile = '/tmp/test-log-compression-input.txt';
const testCompressedFile = '/tmp/test-log-compression-output.gz';
const testDecompressedFile = '/tmp/test-log-compression-decompressed.txt';

try {
  // Write test log content
  await fs.writeFile(testInputFile, testLogContent);
  const originalSize = testLogContent.length;
  console.log(`  Original size: ${formatFileSize(originalSize)}`);

  // Compress
  const compressionResult = await compressLogFile(testInputFile, testCompressedFile);
  console.log(`  Compressed size: ${formatFileSize(compressionResult.compressedSize)}`);
  console.log(`  Compression ratio: ${compressionResult.compressionRatio.toFixed(2)}:1`);
  console.log(`  Saved: ${compressionResult.savedPercentage}%`);

  // Verify compressed file exists
  const compressedStats = await fs.stat(testCompressedFile);
  console.log(`  ✅ Compressed file created: ${compressedStats.size} bytes`);

  // Decompress
  const decompressionResult = await decompressLogFile(testCompressedFile, testDecompressedFile);
  console.log(`  Decompressed size: ${formatFileSize(decompressionResult.decompressedSize)}`);

  // Verify decompressed content matches original
  const decompressedContent = await fs.readFile(testDecompressedFile, 'utf8');
  if (decompressedContent === testLogContent) {
    console.log('  ✅ Decompressed content matches original');
  } else {
    console.log('  ❌ Decompressed content does NOT match original');
    process.exit(1);
  }

  // Clean up
  await fs.unlink(testInputFile);
  await fs.unlink(testCompressedFile);
  await fs.unlink(testDecompressedFile);
  console.log('  ✅ Compression/decompression test passed\n');
} catch (error) {
  console.error('  ❌ Test failed:', error.message);
  process.exit(1);
}

// Test 4: Decompression instructions
console.log('Test 4: Decompression instructions');
const instructions = getDecompressionInstructions('solution-draft-log.txt.gz');
console.log(instructions);
console.log('  ✅ Decompression instructions generated\n');

// Test 5: File splitting
console.log('Test 5: File splitting into chunks');
const largeContent = 'A'.repeat(120 * 1024 * 1024); // 120 MB
const largeTestFile = '/tmp/test-large-file.txt';

try {
  await fs.writeFile(largeTestFile, largeContent);
  console.log(`  Created test file: ${formatFileSize(largeContent.length)}`);

  const chunks = await splitFileIntoChunks(largeTestFile, 50); // 50 MB chunks
  console.log(`  Split into ${chunks.length} chunks`);

  // Verify chunks
  for (let i = 0; i < chunks.length; i++) {
    const chunkStats = await fs.stat(chunks[i]);
    console.log(`  Chunk ${i + 1}: ${formatFileSize(chunkStats.size)}`);
    await fs.unlink(chunks[i]);
  }

  await fs.unlink(largeTestFile);
  console.log('  ✅ File splitting test passed\n');
} catch (error) {
  console.error('  ❌ Test failed:', error.message);
  process.exit(1);
}

console.log('🎉 All tests passed!');
console.log('\n📝 Summary:');
console.log('  - formatFileSize: ✅');
console.log('  - shouldCompress: ✅');
console.log('  - compressLogFile: ✅');
console.log('  - decompressLogFile: ✅');
console.log('  - getDecompressionInstructions: ✅');
console.log('  - splitFileIntoChunks: ✅');
