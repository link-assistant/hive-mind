#!/usr/bin/env node

import { getResourceSnapshot } from '../memory-check.mjs';

console.log('Testing getResourceSnapshot function...');

const snapshot = await getResourceSnapshot();
console.log('Snapshot result:', JSON.stringify(snapshot, null, 2));

if (snapshot.memory) {
  console.log('Memory field exists');
  console.log('Memory value:', snapshot.memory);
  console.log('Memory lines:', snapshot.memory.split('\n'));
  if (snapshot.memory.split('\n').length > 1) {
    console.log('Second line:', snapshot.memory.split('\n')[1]);
  }
} else {
  console.log('Memory field is undefined or missing');
}
