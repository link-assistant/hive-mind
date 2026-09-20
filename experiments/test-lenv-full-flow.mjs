#!/usr/bin/env node

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const linoModule = await use('links-notation');
const LinoParser = linoModule.Parser || linoModule.default.Parser;
const parser = new LinoParser();

// Test lenv-reader's parse method
function lenvReaderParse(content) {
  if (!content || typeof content !== 'string') {
    return {};
  }

  const result = {};

  try {
    const parsed = parser.parse(content);

    if (!parsed || parsed.length === 0) {
      return {};
    }

    for (const link of parsed) {
      const varName = link.id;

      if (!varName) {
        continue;
      }

      if (link.values && link.values.length > 0) {
        const values = link.values.map(v => v.id || v);

        if (values.length === 1) {
          result[varName] = String(values[0]);
        } else {
          const formattedValues = values.map(v => `  ${v}`).join('\n');
          result[varName] = `(\n${formattedValues}\n)`;
        }
      } else if (link.id) {
        result[varName] = '';
      }
    }

    return result;
  } catch (error) {
    console.error(`Error parsing LINO configuration: ${error.message}`);
    return {};
  }
}

// Test the exact config from the issue
const issueConfig = `TELEGRAM_BOT_TOKEN: '849...55:AA...gk_YZ...PU'
TELEGRAM_ALLOWED_CHATS:
  -1002975819706
  -1002861722681
TELEGRAM_HIVE_OVERRIDES:
  --all-issues
  --once
  --skip-issues-with-prs
  --attach-logs
  --verbose
  --no-tool-check
  --auto-resume-on-limit-reset?  --tokens-budget-stats
TELEGRAM_SOLVE_OVERRIDES:
  --attach-logs
  --verbose
  --no-tool-check
  --auto-resume-on-limit-reset
  --tokens-budget-stats
TELEGRAM_BOT_VERBOSE: true`;

console.log('=== Test: LENV parsing of issue configuration ===\n');
console.log('Input config:');
console.log(issueConfig);
console.log('\n---\n');

const envVars = lenvReaderParse(issueConfig);
console.log('Parsed environment variables:');
console.log(JSON.stringify(envVars, null, 2));

console.log('\n---\n');

console.log('TELEGRAM_HIVE_OVERRIDES value:');
console.log(envVars['TELEGRAM_HIVE_OVERRIDES']);

console.log('\n---\n');

// Now parse the TELEGRAM_HIVE_OVERRIDES value
function parseStringValues(input) {
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

console.log('parseStringValues result:');
const hiveOverrides = parseStringValues(envVars['TELEGRAM_HIVE_OVERRIDES']);
console.log(hiveOverrides);
console.log('Count:', hiveOverrides.length);

console.log('\n=== Raw parse of TELEGRAM_HIVE_OVERRIDES ===');
console.log(JSON.stringify(parser.parse(issueConfig), null, 2));
