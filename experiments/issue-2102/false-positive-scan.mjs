/**
 * Issue #2102 — widening the requirement corpus to agent instruction files
 * feeds prose written for agents into the detector, so the false-positive
 * budget from issues #2077 and #2080 has to be re-measured against real
 * `AGENTS.md`/`CLAUDE.md` documents rather than issue bodies.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import { detectRequiredCodexCapabilities } from '../../src/codex-capability-preflight.lib.mjs';

const corpusDir = path.join(import.meta.dirname, 'corpus');
const files = (await fs.readdir(corpusDir)).sort();
let detections = 0;
for (const file of files) {
  const text = await fs.readFile(path.join(corpusDir, file), 'utf8');
  const detected = detectRequiredCodexCapabilities(text);
  detections += detected.plugins.length + detected.skills.length;
  console.log(`=== ${file} (${text.length} chars) ===`);
  console.log(`  plugins : ${detected.plugins.join(', ') || 'none'}`);
  console.log(`  skills  : ${detected.skills.join(', ') || 'none'}`);
  console.log(`  rejected: ${detected.rejected.map(entry => entry.capability).join(', ') || 'none'}`);
}
console.log(`\nTotal detections across ${files.length} real-world instruction files: ${detections}`);
