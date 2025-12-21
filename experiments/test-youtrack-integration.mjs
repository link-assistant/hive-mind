#!/usr/bin/env node
// Test script for YouTrack integration

// Import YouTrack library
import {
  parseYouTrackIssueId,
  createYouTrackConfigFromEnv,
  validateYouTrackConfig,
  convertYouTrackIssueForGitHub
} from '../youtrack.lib.mjs';

async function testYouTrackIntegration() {
  console.log('🧪 Testing YouTrack Integration...\n');

  // Test 1: Parse YouTrack issue IDs
  console.log('1. Testing YouTrack issue ID parsing:');
  const testInputs = [
    'PROJECT-123',
    'youtrack://PROJECT-456',
    'https://company.youtrack.cloud/issue/ABC-789',
    'invalid-input',
    null
  ];

  for (const input of testInputs) {
    const parsed = parseYouTrackIssueId(input);
    console.log(`   "${input}" -> ${parsed}`);
  }

  // Test 2: Environment configuration
  console.log('\n2. Testing environment configuration:');
  const config = createYouTrackConfigFromEnv();
  if (config) {
    console.log('   ✅ YouTrack config found in environment');
    console.log(`   URL: ${config.url}`);
    console.log(`   Project: ${config.projectCode}`);
    console.log(`   Stage: ${config.stage}`);
  } else {
    console.log('   ❌ No YouTrack config in environment (expected for test)');
  }

  // Test 3: Validation
  console.log('\n3. Testing configuration validation:');
  const testConfig = {
    url: 'https://test.youtrack.cloud',
    apiKey: 'test-key',
    projectCode: 'TEST',
    stage: 'Ready'
  };

  try {
    validateYouTrackConfig(testConfig);
    console.log('   ✅ Valid config passed validation');
  } catch (error) {
    console.log(`   ❌ Validation failed: ${error.message}`);
  }

  // Test invalid config
  try {
    validateYouTrackConfig({});
    console.log('   ❌ Empty config should have failed');
  } catch (error) {
    console.log('   ✅ Empty config correctly failed validation');
  }

  // Test 4: Issue conversion
  console.log('\n4. Testing issue conversion:');
  const mockYouTrackIssue = {
    id: 'TEST-123',
    summary: 'Test Issue',
    description: 'This is a test issue',
    stage: 'Ready',
    url: 'https://test.youtrack.cloud/issue/TEST-123',
    reporter: 'Test User',
    assignee: null
  };

  const convertedIssue = convertYouTrackIssueForGitHub(mockYouTrackIssue, 'https://github.com/test/repo');
  console.log('   ✅ Issue converted successfully:');
  console.log(`   URL: ${convertedIssue.url}`);
  console.log(`   Title: ${convertedIssue.title}`);
  console.log(`   YouTrack ID: ${convertedIssue.youtrack.id}`);

  console.log('\n✅ YouTrack integration tests completed!');
}

// Run tests
testYouTrackIntegration().catch(console.error);
