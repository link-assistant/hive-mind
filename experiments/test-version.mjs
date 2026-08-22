#!/usr/bin/env node
import { getVersionInfo } from '../src/lib.mjs';

console.log('Testing version detection...');
const version = await getVersionInfo();
console.log('Version:', version);
