import assert from 'node:assert/strict';
import console from 'node:console';

// The json-file driver can return a 16 KiB partial record without a newline.
const time = '2026-11-23T03:05:11.819268264Z ';
const stdoutFirst = `${time}${'{"body":"'.padEnd(16 * 1024, 'a')}`;
const stdoutLast = `${time}rest"}\n`;
const stderr = '2026-11-23T03:05:11.820000000Z stderr-marker\n';

// start-command merges both streams as they arrive. The reporter captures the
// streams independently and appends stderr to stdout after the process exits.
const stripTimestamp = line => line.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z\s?/, '');
const wrapper = `${stdoutFirst}${stderr}${stdoutLast}`;
const separateCapture = `${(stdoutFirst + stdoutLast).trim()}\n${stderr.trim()}`;
const known = new Set(wrapper.split('\n').flatMap(line => [line.trim(), stripTimestamp(line).trim()]));
const countMissing = capture => capture.split('\n').filter(line => stripTimestamp(line).trim() && !known.has(line.trim()) && !known.has(stripTimestamp(line).trim())).length;

assert.equal(countMissing(separateCapture), 2);
assert.equal(countMissing(wrapper), 0);

console.log('Two Docker lines were reported missing even though all three records were captured.');
