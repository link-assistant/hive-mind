#!/usr/bin/env node
// Experiment: validate usage-limit detection and reset-time extraction

import { detectUsageLimit } from '../src/usage-limit.lib.mjs';

const messages = [
  'Weekly limit reached ∙ resets 5am',
  'Session limit reached ∙ resets 10am',
  "You've hit your usage limit. Please try again at 12:16 PM.",
  'Rate limit exceeded. Available at 09:00 pm',
  'Random error message with no limits'
];

for (const m of messages) {
  const info = detectUsageLimit(m);
  console.log(`${m} -> isUsageLimit=${info.isUsageLimit}, resetTime=${info.resetTime}`);
}

