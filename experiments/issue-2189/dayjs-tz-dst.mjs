/**
 * Issue #2189 / R25: dayjs 1.11.22 fixed "timezone plugin compute instance
 * .tz() offset without host DST" (iamkun/dayjs#3174, closes #3169). Hive Mind
 * calls `dayjs().tz(tz)` and `dayjs.tz(...)` in src/usage-limit.lib.mjs to turn
 * an agent's "resets at 8:00 PM" into a UTC instant, so a wrong offset moves a
 * resume time by an hour.
 *
 * Prints the same conversions under a host timezone that observes DST; run it
 * against 1.11.21 and 1.11.23 and diff.
 */
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const zones = ['America/Los_Angeles', 'Europe/Berlin', 'Australia/Sydney', 'Asia/Tokyo'];
const instants = ['2026-01-15T12:00:00Z', '2026-07-01T12:00:00Z'];

console.log(`host TZ=${process.env.TZ || '(system)'}`);
for (const instant of instants) {
  for (const zone of zones) {
    const instance = dayjs(instant).tz(zone);
    console.log(`  ${instant} .tz(${zone}) -> ${instance.format('YYYY-MM-DD HH:mm Z')} | utcOffset=${instance.utcOffset()}`);
  }
}
