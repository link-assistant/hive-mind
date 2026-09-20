/**
 * Issue #2189 / R25: dayjs 1.11.22 and 1.11.23 both fix the timezone plugin.
 * src/usage-limit.lib.mjs parses agent-supplied text with `dayjs.tz(value, …)`,
 * so "invalid value" is a reachable input, not a hypothetical one.
 *
 * Prints what the installed dayjs does with an unparseable value: an Invalid
 * Date (recoverable, `isValid()` is false) or a thrown RangeError.
 */
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

console.log('dayjs', dayjs.version);
for (const [label, run] of [
  ['dayjs.tz(<garbage>, <format>, tz)', () => dayjs.tz('not a date at all', 'h:mma', 'America/Los_Angeles')],
  ['dayjs.tz(<garbage>, tz)', () => dayjs.tz('not a date at all', 'America/Los_Angeles')],
  ['dayjs(<garbage>).tz(tz)', () => dayjs('not a date at all').tz('America/Los_Angeles')],
]) {
  try {
    const value = run();
    console.log(`  ${label} -> ${value.isValid() ? value.format() : 'Invalid Date'} (no throw)`);
  } catch (error) {
    console.log(`  ${label} -> THREW ${error.constructor.name}: ${error.message}`);
  }
}
