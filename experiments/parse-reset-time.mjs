#!/usr/bin/env node
// Quick experiment to validate parseResetTime() formats

import { parseResetTime, calculateWaitTime } from '../src/solve.validation.lib.mjs';

const samples = [
  '5:30am',
  '11:45pm',
  '12:16 PM',
  '07:05 Am',
  '5am',
  '9:00PM',
  '09:00 pm',
  'bad-format'
];

for (const s of samples) {
  try {
    const { hour, minute } = parseResetTime(s);
    const waitMs = calculateWaitTime(s);
    console.log(`${s} -> hour=${hour}, minute=${minute}, waitMs=${waitMs}`);
  } catch (e) {
    console.log(`${s} -> ERROR: ${e.message}`);
  }
}
