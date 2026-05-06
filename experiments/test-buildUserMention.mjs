#!/usr/bin/env node

import { buildUserMention } from '../src/buildUserMention.lib.mjs';

console.log('Testing buildUserMention function...\n');

// Test case 1: User with username
const user1 = { id: 123456, username: 'johndoe', first_name: 'John', last_name: 'Doe' };
console.log('Test 1: User with username');
console.log('Input:', user1);
console.log('Markdown:', buildUserMention({ user: user1, parseMode: 'Markdown' }));
console.log('HTML:', buildUserMention({ user: user1, parseMode: 'HTML' }));
console.log('MarkdownV2:', buildUserMention({ user: user1, parseMode: 'MarkdownV2' }));
console.log('');

// Test case 2: User without username (only first name)
const user2 = { id: 789012, first_name: 'Jane' };
console.log('Test 2: User without username (only first name)');
console.log('Input:', user2);
console.log('Markdown:', buildUserMention({ user: user2, parseMode: 'Markdown' }));
console.log('HTML:', buildUserMention({ user: user2, parseMode: 'HTML' }));
console.log('MarkdownV2:', buildUserMention({ user: user2, parseMode: 'MarkdownV2' }));
console.log('');

// Test case 3: User without username (first and last name)
const user3 = { id: 345678, first_name: 'Alice', last_name: 'Smith' };
console.log('Test 3: User without username (first and last name)');
console.log('Input:', user3);
console.log('Markdown:', buildUserMention({ user: user3, parseMode: 'Markdown' }));
console.log('HTML:', buildUserMention({ user: user3, parseMode: 'HTML' }));
console.log('MarkdownV2:', buildUserMention({ user: user3, parseMode: 'MarkdownV2' }));
console.log('');

// Test case 4: User without username or names (only ID)
const user4 = { id: 999999 };
console.log('Test 4: User without username or names (only ID)');
console.log('Input:', user4);
console.log('Markdown:', buildUserMention({ user: user4, parseMode: 'Markdown' }));
console.log('HTML:', buildUserMention({ user: user4, parseMode: 'HTML' }));
console.log('MarkdownV2:', buildUserMention({ user: user4, parseMode: 'MarkdownV2' }));
console.log('');

// Test case 5: User with special characters in name
const user5 = { id: 111222, first_name: 'Владимир', last_name: 'Петров' };
console.log('Test 5: User with special characters in name (Cyrillic)');
console.log('Input:', user5);
console.log('Markdown:', buildUserMention({ user: user5, parseMode: 'Markdown' }));
console.log('HTML:', buildUserMention({ user: user5, parseMode: 'HTML' }));
console.log('MarkdownV2:', buildUserMention({ user: user5, parseMode: 'MarkdownV2' }));
console.log('');

console.log('✅ All tests completed successfully!');
