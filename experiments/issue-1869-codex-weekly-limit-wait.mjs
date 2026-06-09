#!/usr/bin/env node

/**
 * Issue #1869 — Phase 2 reproduction.
 *
 * Demonstrates the two defects in the auto-resume wait calculation
 * (`src/solve.validation.lib.mjs`) when Codex reports a weekly usage limit
 * with an explicit year (e.g. "Jun 11th, 2026 12:27 AM" → normalized to
 * "Jun 11, 2026, 12:27 AM"):
 *
 *   1. Before the fix: `calculateWaitTime` threw "Invalid time format" on the
 *      year-bearing string, crashing the auto-resume flow.
 *   2. Before the fix: `calculateWaitTime` discarded the date entirely and only
 *      used the time-of-day, so a multi-day-out reset resolved to today/tomorrow
 *      (auto-resume woke up far too early).
 *
 * Run from the repo root: node experiments/issue-1869-codex-weekly-limit-wait.mjs
 */

import { calculateWaitTime } from '../src/solve.validation.lib.mjs';

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Defect 1: year-bearing weekly format must not throw.
try {
  const ms = calculateWaitTime('Jun 11, 2026, 12:27 AM');
  console.log(`year format         → ${(ms / 3600000).toFixed(2)} h (no throw ✅)`);
} catch (e) {
  console.log(`year format         → THROW: ${e.message} ❌`);
}

// Defect 2: a reset 3 days out must wait ~3 days, not < 24h.
const threeDaysOut = new Date(Date.now() + 3 * 24 * 3600 * 1000);
const str = `${months[threeDaysOut.getMonth()]} ${threeDaysOut.getDate()}, 10:00 AM`;
const ms = calculateWaitTime(str);
console.log(`'${str}' → ${(ms / 3600000).toFixed(2)} h (expected ~72 h)`);
