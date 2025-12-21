#!/usr/bin/env node

/**
 * Diagnostic script to understand why messages might be incorrectly
 * classified as forwarded or reply
 */

console.log('🔍 Analyzing possible causes of false positive in isForwardedOrReply\n');

console.log('HYPOTHESIS 1: Empty object/array is truthy');
console.log('  if ({}) // truthy?', Boolean({}));
console.log('  if ([]) // truthy?', Boolean([]));
console.log('  if ("") // truthy?', Boolean(''));
console.log('  if (null) // truthy?', Boolean(null));
console.log('  if (undefined) // truthy?', Boolean(undefined));
console.log('');

console.log('HYPOTHESIS 2: Telegram might send forward_origin: {} for some messages');
const msgWithEmptyForwardOrigin = {
  message_id: 123,
  text: '/solve test',
  forward_origin: {}
};
console.log('  Message with forward_origin: {}');
console.log('  if (message.forward_origin) =>', Boolean(msgWithEmptyForwardOrigin.forward_origin));
console.log('  JSON.stringify(forward_origin) =>', JSON.stringify(msgWithEmptyForwardOrigin.forward_origin));
console.log('  Object.keys(forward_origin).length =>', Object.keys(msgWithEmptyForwardOrigin.forward_origin).length);
console.log('');

console.log('HYPOTHESIS 3: Telegram might send reply_to_message: {} for some messages');
const msgWithEmptyReply = {
  message_id: 123,
  text: '/solve test',
  reply_to_message: {}
};
console.log('  Message with reply_to_message: {}');
console.log('  if (message.reply_to_message) =>', Boolean(msgWithEmptyReply.reply_to_message));
console.log('  JSON.stringify(reply_to_message) =>', JSON.stringify(msgWithEmptyReply.reply_to_message));
console.log('  Object.keys(reply_to_message).length =>', Object.keys(msgWithEmptyReply.reply_to_message).length);
console.log('');

console.log('HYPOTHESIS 4: Fields might be set to false/null instead of undefined');
const msgWithNullFields = {
  message_id: 123,
  text: '/solve test',
  forward_origin: null,
  reply_to_message: null
};
console.log('  Message with null fields');
console.log('  if (message.forward_origin) =>', Boolean(msgWithNullFields.forward_origin));
console.log('  if (message.reply_to_message) =>', Boolean(msgWithNullFields.reply_to_message));
console.log('');

console.log('HYPOTHESIS 5: Fields might be set to false');
const msgWithFalseFields = {
  message_id: 123,
  text: '/solve test',
  forward_origin: false,
  reply_to_message: false
};
console.log('  Message with false fields');
console.log('  if (message.forward_origin) =>', Boolean(msgWithFalseFields.forward_origin));
console.log('  if (message.reply_to_message) =>', Boolean(msgWithFalseFields.reply_to_message));
console.log('');

console.log('📝 CONCLUSION:');
console.log('An empty object {} is truthy in JavaScript!');
console.log('If Telegram sends forward_origin: {} or reply_to_message: {}');
console.log('for certain message types, it would trigger false positives.');
console.log('');
console.log('🔧 SOLUTION:');
console.log('Check if the field exists AND is a non-empty object:');
console.log('  if (message.forward_origin && Object.keys(message.forward_origin).length > 0)');
console.log('OR more simply:');
console.log('  if (message.forward_origin?.type) // Check for expected subfield');
console.log('  if (message.reply_to_message?.message_id) // Check for expected subfield');
