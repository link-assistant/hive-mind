#!/usr/bin/env node
// Quick script to check model pricing from API

import { fetchModelInfo } from '../src/claude.lib.mjs';

async function checkPricing() {
  console.log('🔍 Checking model pricing from API\n');

  try {
    const grokFast = await fetchModelInfo('grok-code-fast-1');
    console.log('grok-code-fast-1 pricing:');
    console.log(JSON.stringify(grokFast?.cost, null, 2));

    const grokCode = await fetchModelInfo('grok-code');
    console.log('\ngrok-code pricing:');
    console.log(JSON.stringify(grokCode?.cost, null, 2));
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
}

checkPricing();