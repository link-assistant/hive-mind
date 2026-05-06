#!/usr/bin/env node

/**
 * Test script for i18n functionality
 * Tests English and Russian language support
 */

import { getTranslations, getAvailableLanguages, isLanguageSupported } from '../src/i18n.lib.mjs';
import { buildUserPrompt, buildSystemPrompt } from '../src/claude.prompts.lib.mjs';

console.log('🌍 Testing i18n functionality...\n');

console.log('1. Available languages:', getAvailableLanguages());
console.log('2. Language support checks:');
console.log('   - English (en):', isLanguageSupported('en'));
console.log('   - Russian (ru):', isLanguageSupported('ru'));
console.log('   - French (fr):', isLanguageSupported('fr'), '\n');

console.log('3. Testing English translations:');
const enTranslations = getTranslations('en');
console.log('   - System prompt intro:', enTranslations.systemPrompt.youAre);
console.log('   - User prompt proceed:', enTranslations.userPrompt.proceed);
console.log('   - User prompt think:', enTranslations.userPrompt.think, '\n');

console.log('4. Testing Russian translations:');
const ruTranslations = getTranslations('ru');
console.log('   - System prompt intro:', ruTranslations.systemPrompt.youAre);
console.log('   - User prompt proceed:', ruTranslations.userPrompt.proceed);
console.log('   - User prompt think:', ruTranslations.userPrompt.think, '\n');

console.log('5. Testing buildUserPrompt with English:');
const enUserPrompt = buildUserPrompt({
  issueUrl: 'https://github.com/test/repo/issues/1',
  issueNumber: '1',
  branchName: 'test-branch',
  tempDir: '/tmp/test',
  isContinueMode: false,
  owner: 'test',
  repo: 'repo',
  argv: { language: 'en' },
});
console.log('--- English User Prompt ---');
console.log(enUserPrompt);
console.log('--- End ---\n');

console.log('6. Testing buildUserPrompt with Russian:');
const ruUserPrompt = buildUserPrompt({
  issueUrl: 'https://github.com/test/repo/issues/1',
  issueNumber: '1',
  branchName: 'test-branch',
  tempDir: '/tmp/test',
  isContinueMode: false,
  owner: 'test',
  repo: 'repo',
  argv: { language: 'ru' },
});
console.log('--- Russian User Prompt ---');
console.log(ruUserPrompt);
console.log('--- End ---\n');

console.log('7. Testing buildSystemPrompt with English (first 500 chars):');
const enSystemPrompt = buildSystemPrompt({
  owner: 'test',
  repo: 'repo',
  issueNumber: '1',
  prNumber: '2',
  branchName: 'test-branch',
  argv: { language: 'en' },
});
console.log('--- English System Prompt (truncated) ---');
console.log(enSystemPrompt.substring(0, 500) + '...');
console.log('--- End ---\n');

console.log('8. Testing buildSystemPrompt with Russian (first 500 chars):');
const ruSystemPrompt = buildSystemPrompt({
  owner: 'test',
  repo: 'repo',
  issueNumber: '1',
  prNumber: '2',
  branchName: 'test-branch',
  argv: { language: 'ru' },
});
console.log('--- Russian System Prompt (truncated) ---');
console.log(ruSystemPrompt.substring(0, 500) + '...');
console.log('--- End ---\n');

console.log('9. Testing with think modes:');
const enThinkPrompt = buildUserPrompt({
  issueUrl: 'https://github.com/test/repo/issues/1',
  issueNumber: '1',
  branchName: 'test-branch',
  tempDir: '/tmp/test',
  isContinueMode: false,
  owner: 'test',
  repo: 'repo',
  argv: { language: 'en', think: 'max' },
});
console.log('English with think=max:', enThinkPrompt.split('\n').pop());

const ruThinkPrompt = buildUserPrompt({
  issueUrl: 'https://github.com/test/repo/issues/1',
  issueNumber: '1',
  branchName: 'test-branch',
  tempDir: '/tmp/test',
  isContinueMode: false,
  owner: 'test',
  repo: 'repo',
  argv: { language: 'ru', think: 'max' },
});
console.log('Russian with think=max:', ruThinkPrompt.split('\n').pop(), '\n');

console.log('✅ All i18n tests completed successfully!');
