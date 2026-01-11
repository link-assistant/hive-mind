#!/usr/bin/env node

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const linoModule = await use('links-notation');
const LinoParser = linoModule.Parser || linoModule.default.Parser;
const parser = new LinoParser();

// Original parseStringValues (before my fix)
function parseStringValuesOriginal(input) {
  if (!input) return [];
  const parsed = parser.parse(input);
  if (parsed && parsed.length > 0) {
    const link = parsed[0];
    const links = [];
    if (link.values && link.values.length > 0) {
      for (const value of link.values) {
        const linkStr = value.id || value;
        if (typeof linkStr === 'string') {
          links.push(linkStr);
        }
      }
    } else if (link.id) {
      if (typeof link.id === 'string') {
        links.push(link.id);
      }
    }
    return links;
  }
  return [];
}

// Test with same-line options
const sameLineOptions = '(\n  --auto-resume-on-limit-reset?  --tokens-budget-stats\n)';
console.log('Same line options:');
console.log('Input:', JSON.stringify(sameLineOptions));
console.log('Result:', parseStringValuesOriginal(sameLineOptions));

// Test with the full config like in issue
const fullConfig = '(\n  --all-issues\n  --once\n  --skip-issues-with-prs\n  --attach-logs\n  --verbose\n  --no-tool-check\n  --auto-resume-on-limit-reset?  --tokens-budget-stats\n)';
console.log('\nFull config (with same-line options at end):');
console.log('Result:', parseStringValuesOriginal(fullConfig));
console.log('Count:', parseStringValuesOriginal(fullConfig).length);

// Test raw parser output
console.log('\n--- Raw parser output for full config ---');
console.log(JSON.stringify(parser.parse(fullConfig), null, 2));
