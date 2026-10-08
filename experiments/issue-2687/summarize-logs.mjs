// Scan captured logs in batches of at most 1500 lines without printing embedded images.
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const interesting = /file: command not found|"api_error": "usage_limit_reached"|"is_error": true|"subtype": "success"|session limit|Final tool result failed|Claude command failed with exit code|OOMKilled:|\[RESOURCES\]|preserving uncommitted|Work Session|working session|Resource not accessible by integration/;
for (const filename of process.argv.slice(2)) {
  console.log(`\n${filename}`);
  const lines = createInterface({ input: createReadStream(filename), crlfDelay: Infinity });
  let number = 0;
  let matches = 0;
  for await (const line of lines) {
    number++;
    if (interesting.test(line) && line.length < 10000) {
      console.log(`${number}: ${line.slice(0, 600)}`);
      matches++;
    }
    if (number % 1500 === 0) console.log(`Reviewed lines ${number - 1499}-${number}; ${matches} relevant lines so far.`);
  }
  console.log(`Reviewed ${number} lines; ${matches} relevant lines.`);
}
