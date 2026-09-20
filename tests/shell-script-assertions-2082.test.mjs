/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2082, finding F3.
 *
 * scripts/test-auto-fork-option.sh ran three assertions and reported none of
 * them: each failed branch printed "Could not verify ..." and the script carried
 * on to `echo "All --auto-fork option tests completed"` and exit 0.
 *
 * It was not a theoretical gap. Reproduced locally, the marker the script greps
 * for ("Auto-fork:") first appears ~32s into the run, because solve.mjs makes
 * several GitHub API calls before it gets there. The script killed the command
 * with `timeout 10s`. So the grep had been failing on every run, and the job had
 * been green the whole time — a false positive of exactly the kind issue #2082
 * is about.
 *
 * These tests pin both halves: the scanner that finds the pattern, and the
 * absence of the pattern in the scripts CI actually runs.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2082
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { findVacuousChecks } from '../scripts/shell-lint.lib.mjs';

// --- The scanner ----------------------------------------------------------

{
  // The exact shape that was live in test-auto-fork-option.sh.
  const script = `if grep -q "marker" out.log; then
  echo "solve.mjs recognizes --auto-fork flag"
else
  echo "Could not verify --auto-fork flag in solve output"
fi
`;
  const offenders = findVacuousChecks(script);
  assert.equal(offenders.length, 1, 'a branch that reports a failed check without failing is flagged');
  assert.equal(offenders[0].line, 3, 'the offending branch is reported at its `else` so the message is actionable');
  assert.match(offenders[0].message, /Could not verify/, 'the reported message is the one the branch prints');
}

{
  const script = `if grep -q "marker" out.log; then
  echo "found"
else
  echo "Version NOT found in log file"
  exit 1
fi
`;
  assert.deepEqual(findVacuousChecks(script), [], 'a branch that exits non-zero is correct and must not be flagged');
}

{
  // An `else` that is simply an alternative outcome, not a failure report.
  const script = `if [ -n "$DESCRIPTION" ]; then
  echo "using description"
else
  echo "no description supplied, continuing"
fi
`;
  assert.deepEqual(findVacuousChecks(script), [], 'a branch that reports an alternative outcome is not a failed assertion');
}

{
  // Accumulating into a variable that a later check acts on: the branch does not
  // fail, but the script still does. Flagging this would be a false positive in
  // the checker meant to remove false positives.
  const script = `if [ -d "$dir" ]; then
  echo "  $browser: OK"
else
  echo "  $browser: MISSING"
  BROWSERS_MISSING="$BROWSERS_MISSING $browser"
fi
`;
  assert.deepEqual(findVacuousChecks(script), [], 'a branch that records the failure for a later check is not vacuous');
}

{
  // A deliberately non-fatal branch must say so explicitly.
  const tolerated = `if command -v configure-claude; then
  echo "ok"
else
  # shell-lint: allow-nonfatal — PR builds install @latest, which can pre-date this PR.
  echo "configure-claude not found, tolerated for PR builds"
fi
`;
  assert.deepEqual(findVacuousChecks(tolerated), [], 'an explicitly marked non-fatal branch is allowed');

  const unmarked = tolerated.replace(/^\s*# shell-lint.*\n/m, '');
  assert.equal(findVacuousChecks(unmarked).length, 1, 'without the marker the same branch is flagged — the exemption must be deliberate, not incidental');
}

{
  // Nesting: the inner `exit 1` belongs to the inner branch, and must not
  // launder the outer one.
  const script = `if check_a; then
  echo "a ok"
else
  if check_b; then
    echo "b ok"
  else
    echo "b failed"
    exit 1
  fi
  echo "Could not verify a"
fi
`;
  const offenders = findVacuousChecks(script);
  assert.equal(offenders.length, 1, 'an inner branch that exits does not excuse the outer branch');
  assert.match(offenders[0].message, /Could not verify a/, 'the outer branch is the one flagged');
  assert.equal(offenders[0].line, 3, 'the outer `else` is reported, not the inner one');
}

// --- The scripts CI actually runs -----------------------------------------

{
  const scriptDir = path.join(process.cwd(), 'scripts');
  const files = readdirSync(scriptDir).filter(file => file.endsWith('.sh'));

  assert.ok(files.length > 0, 'shell scripts are found — an empty glob would make this test vacuous');

  const offenders = [];
  for (const file of files) {
    for (const check of findVacuousChecks(readFileSync(path.join(scriptDir, file), 'utf8'))) {
      offenders.push(`scripts/${file}:${check.line}  ${check.message}`);
    }
  }

  assert.deepEqual(offenders, [], `a CI script must fail when its assertion fails, not print a note and exit 0.\nOffending branches:\n  ${offenders.join('\n  ')}`);
}

console.log('shell-script-assertions-2082.test.mjs: all assertions passed');
