#!/usr/bin/env node
/**
 * Test script for language detection functionality
 * Tests the i18n module with various text samples
 */

import { detectIssueLanguageFromText } from '../src/auto-language.lib.mjs';

function detectLanguage(text) {
  return detectIssueLanguageFromText(text).language;
}

function detectLanguageFromIssue(title, body) {
  return detectIssueLanguageFromText([title, body].filter(Boolean).join('\n\n')).language;
}

// Test cases
const testCases = [
  {
    name: 'English text (simple)',
    text: 'This is a simple English text for testing',
    expected: 'en',
  },
  {
    name: 'Russian text (simple)',
    text: 'Это простой русский текст для тестирования',
    expected: 'ru',
  },
  {
    name: 'Mixed text (mostly English)',
    text: 'This is English text with некоторые Russian words',
    expected: 'en',
  },
  {
    name: 'Mixed text (exactly 50% Russian - should be English)',
    text: 'русский текст English words',
    expected: 'en', // Since it's not >51%, should be English
  },
  {
    name: 'English text (60% threshold)',
    text: 'This is a longer English text абвгд',
    expected: 'en',
  },
  {
    name: 'Russian text (60% threshold)',
    text: 'Это более длинный русский текст abc',
    expected: 'ru',
  },
  {
    name: 'Empty text',
    text: '',
    expected: 'en',
  },
  {
    name: 'Numbers and symbols only',
    text: '12345 !@#$%',
    expected: 'en',
  },
  {
    name: 'Real issue example (English)',
    title: 'Add new feature for user authentication',
    body: 'We need to implement a new authentication system that supports OAuth2 and JWT tokens. This should include proper error handling and validation.',
    expected: 'en',
  },
  {
    name: 'Real issue example (Russian)',
    title: 'Добавить поддержку языков',
    body: 'Необходимо реализовать поддержку множественных языков в приложении. Должна быть автоматическая детекция языка и возможность принудительного выбора.',
    expected: 'ru',
  },
  {
    name: 'Issue with code snippets (English)',
    title: 'Fix bug in authentication',
    body: 'The function `authenticate(user, pass)` is not working properly. Code: ```js\nfunction test() { return true; }\n```',
    expected: 'en',
  },
  {
    name: 'Issue with code snippets (Russian)',
    title: 'Исправить ошибку в аутентификации',
    body: 'Функция `authenticate(user, pass)` работает неправильно. Код ниже помогает воспроизвести проблему, но описание задачи остается русским: ```js\nfunction test() { return true; }\n```',
    expected: 'ru',
  },
  {
    name: 'Russian above 51%',
    text: 'один два three',
    expected: 'ru',
  },
  {
    name: 'Russian below 51%',
    text: 'один two three',
    expected: 'en',
  },
];

// Run tests
console.log('🧪 Testing language detection...\n');

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
  let result;

  if (testCase.title !== undefined) {
    // Test with title and body
    result = detectLanguageFromIssue(testCase.title, testCase.body);
  } else {
    // Test with plain text
    result = detectLanguage(testCase.text);
  }

  const success = result === testCase.expected;

  if (success) {
    passed++;
    console.log(`✅ ${testCase.name}`);
    console.log(`   Expected: ${testCase.expected}, Got: ${result}\n`);
  } else {
    failed++;
    console.log(`❌ ${testCase.name}`);
    console.log(`   Expected: ${testCase.expected}, Got: ${result}`);
    if (testCase.title !== undefined) {
      console.log(`   Title: "${testCase.title}"`);
      console.log(`   Body: "${testCase.body}"\n`);
    } else {
      console.log(`   Text: "${testCase.text}"\n`);
    }
  }
}

// Summary
console.log('─'.repeat(50));
console.log(`📊 Test Summary: ${passed} passed, ${failed} failed`);

if (failed === 0) {
  console.log('✅ All tests passed!');
  process.exit(0);
} else {
  console.log(`❌ ${failed} test(s) failed`);
  process.exit(1);
}
