/**
 * Structural checks for the bash test/verification scripts run by CI.
 *
 * Why this exists (issue #2082, finding F3):
 *   scripts/test-auto-fork-option.sh asserted three things and reported none of
 *   them. Every check had the shape
 *
 *     if grep -q "marker" out.log; then
 *       echo "flag is recognized"
 *     else
 *       echo "Could not verify flag"      # <- no exit, script continues
 *     fi
 *
 *   so a failed assertion printed a sentence nobody reads and the script still
 *   exited 0. The job had been green while verifying nothing: the underlying
 *   command needed ~32s to reach the marker and was being killed by a
 *   `timeout 10s`, so the grep had in fact been failing every run.
 *
 *   That is the exact false positive issue #2082 asks us to eliminate, and the
 *   pattern is cheap to reproduce by hand, so it is worth enforcing rather than
 *   fixing once.
 *
 * Nothing off the shelf catches this. ShellCheck models the shell's semantics,
 * not the script's intent — an `else` branch that only echoes is perfectly valid
 * bash, so there is no rule for it (and SC2181-style checks address the inverse
 * problem, testing `$?` instead of the command). The judgement "this branch is
 * reporting a failure" is repo-specific, which is why it lives here.
 *
 * Uses only Node built-ins so it keeps working whatever state node_modules is in
 * (the same constraint that shaped scripts/run-command.lib.mjs).
 */

/**
 * Phrases that mark a branch as reporting a failed check rather than an
 * alternative success path. Kept explicit rather than clever: a false positive
 * here would force `exit` into a branch that legitimately continues.
 */
const FAILURE_PHRASES = [/\bcould not\b/i, /\bcouldn't\b/i, /\bnot found\b/i, /\bnot verif/i, /\bunable to\b/i, /\bmissing\b/i, /\bfailed\b/i, /\bunexpected\b/i];

/** Constructs that actually propagate a failure out of the branch. */
const PROPAGATES_FAILURE = /(^|[\s;&|(])(exit\s+[1-9]|return\s+[1-9]|false)(\s|;|$)/m;

/**
 * Recording the failure in a variable that a later check acts on, e.g.
 * `FAILURES+=("$file")` or `BROWSERS_MISSING="$BROWSERS_MISSING $browser"`.
 * The branch does not fail, but the script still does.
 */
const RECORDS_FAILURE = /^\s*[A-Za-z_][A-Za-z0-9_]*(\+?=)/m;

/**
 * Opt-out for a branch that is deliberately non-fatal — a diagnostic dump inside
 * an already-failing path, or a tolerated environment difference. Requiring the
 * marker (and a reason after it) turns a silent fall-through into a decision
 * someone signed off on.
 */
const ALLOW_MARKER = /#\s*shell-lint:\s*allow-nonfatal\b/;

/**
 * A branch that announces a failed check but lets the script continue.
 * @typedef {object} VacuousCheck
 * @property {number} line 1-indexed line of the `else` that opens the branch.
 * @property {string} message The failure text the branch prints.
 */

/**
 * Find `else` branches that report a failure without failing.
 *
 * The scan is nesting-aware: it pairs each `else` with the `fi` that closes its
 * own `if`, so an inner `if ... exit 1 ... fi` is not credited to an outer
 * branch and vice versa.
 *
 * @param {string} script Contents of a bash script.
 * @returns {VacuousCheck[]}
 */
export function findVacuousChecks(script) {
  const lines = String(script || '').split('\n');
  const offenders = [];

  for (let index = 0; index < lines.length; index++) {
    if (!/^\s*else\s*(#.*)?$/.test(lines[index])) {
      continue;
    }

    if (ALLOW_MARKER.test(lines[index])) {
      continue;
    }

    // Collect the branch body up to the `fi` that closes this `else`'s own `if`,
    // keeping only the lines at the branch's own nesting level. Lines inside a
    // nested `if` belong to that inner check: its `exit 1` answers its own
    // condition, not this branch's, so counting it here would launder an outer
    // branch that really does fall through.
    const body = [];
    let depth = 0;
    for (let cursor = index + 1; cursor < lines.length; cursor++) {
      const line = lines[cursor];
      if (/^\s*if\s/.test(line)) {
        depth++;
        continue;
      }
      if (/^\s*fi\s*(#.*)?$/.test(line)) {
        if (depth === 0) {
          break;
        }
        depth--;
        continue;
      }
      if (depth === 0) {
        body.push(line);
      }
    }

    const text = body.join('\n');
    if (PROPAGATES_FAILURE.test(text) || RECORDS_FAILURE.test(text) || ALLOW_MARKER.test(text)) {
      continue;
    }

    const reported = body.find(line => FAILURE_PHRASES.some(phrase => phrase.test(line)));
    if (reported) {
      offenders.push({ line: index + 1, message: reported.trim() });
    }
  }

  return offenders;
}
