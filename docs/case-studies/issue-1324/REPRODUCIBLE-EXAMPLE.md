# Reproducible Example: UTF-16 Surrogate Truncation Bug

## Minimal Reproduction

### Method 1: Direct String Truncation (Simulated)

```javascript
// Demonstrate how truncation can create orphaned surrogates

// The robot emoji 🤖 (U+1F916)
const emoji = '🤖';
console.log('Original emoji:', emoji);
console.log('Length (JS string):', emoji.length); // 2 (surrogate pair)
console.log('Code points:', [...emoji].length); // 1 (single character)

// Simulate truncation that splits the surrogate pair
const highSurrogate = emoji.charCodeAt(0).toString(16); // d83e
const lowSurrogate = emoji.charCodeAt(1).toString(16);  // dd16
console.log('High surrogate:', highSurrogate);
console.log('Low surrogate:', lowSurrogate);

// Create orphaned high surrogate (what happens after truncation)
const orphanedHigh = String.fromCharCode(0xD83E);
console.log('Orphaned high surrogate:', orphanedHigh.length, 'chars');

// Try to JSON.stringify it
try {
  JSON.stringify({ text: orphanedHigh });
  console.log('JSON.stringify succeeded (browser may handle differently)');
} catch (error) {
  console.log('JSON.stringify failed:', error.message);
}

// Node.js allows it but the result is invalid JSON for strict parsers
const jsonResult = JSON.stringify({ text: orphanedHigh });
console.log('JSON result:', jsonResult);
console.log('Contains invalid escape:', jsonResult.includes('\\ud83e'));
```

### Method 2: Claude Code Reproduction Steps

1. Create a GitHub comment with emojis:
   ```bash
   gh issue comment 123 --body "🤖 Testing emoji truncation 🚀"
   ```

2. Use Claude Code to read a large amount of GitHub content that will trigger truncation:
   ```bash
   claude -p "Read all comments from issue #123 and analyze them"
   ```

3. If the truncated content happens to cut through an emoji, the next API call will fail.

### Method 3: Using mutation testing tools

As documented in [issue #16294](https://github.com/anthropics/claude-code/issues/16294):

```bash
# mutmut produces terminal graphics that can contain partial escape sequences
source .venv/bin/activate && mutmut run --max-children 4 2>&1 | tail -30
```

## Verification Script

Save as `test-surrogate-bug.mjs`:

```javascript
#!/usr/bin/env node

// Test script to verify surrogate handling

const testCases = [
  { name: 'Valid emoji', input: '🤖' },
  { name: 'Orphaned high', input: String.fromCharCode(0xD83E) },
  { name: 'Orphaned low', input: String.fromCharCode(0xDD16) },
  { name: 'Text with emoji', input: 'Hello 🤖 World' },
  { name: 'Truncated at surrogate', input: 'Hello ' + String.fromCharCode(0xD83E) },
];

console.log('Testing JSON serialization of surrogate characters:\n');

for (const { name, input } of testCases) {
  const charCodes = [...input].map(c => {
    const code = c.codePointAt(0);
    return code > 0xFFFF ? `U+${code.toString(16).toUpperCase()}` : `U+${code.toString(16).padStart(4, '0').toUpperCase()}`;
  });

  console.log(`Test: ${name}`);
  console.log(`  Input chars: ${input.length}`);
  console.log(`  Code points: ${charCodes.join(', ')}`);

  try {
    const json = JSON.stringify({ text: input });
    console.log(`  JSON.stringify: OK (${json.length} bytes)`);

    // Check if it contains escaped surrogates
    if (json.includes('\\ud') || json.includes('\\uD')) {
      console.log(`  Warning: Contains escaped surrogate: ${json}`);
    }
  } catch (error) {
    console.log(`  JSON.stringify: FAILED - ${error.message}`);
  }
  console.log();
}

// Demonstrate fix
console.log('--- DEMONSTRATION OF FIX ---\n');

function sanitizeUnicode(text) {
  // Regex to match orphaned surrogates
  // High surrogate not followed by low surrogate OR low surrogate not preceded by high surrogate
  return text.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    '\uFFFD' // Unicode replacement character
  );
}

const problematicText = 'Hello ' + String.fromCharCode(0xD83E) + ' World';
console.log('Before sanitization:', problematicText.length, 'chars');
console.log('After sanitization:', sanitizeUnicode(problematicText));
console.log('JSON.stringify after fix:', JSON.stringify({ text: sanitizeUnicode(problematicText) }));
```

Run with:
```bash
node test-surrogate-bug.mjs
```

## Expected Output (Before Fix)

```
Test: Orphaned high
  Input chars: 1
  Code points: U+D83E
  JSON.stringify: OK (19 bytes)
  Warning: Contains escaped surrogate: {"text":"\ud83e"}
```

The JSON is technically valid JavaScript, but strict JSON parsers (like the Anthropic API uses) reject orphaned surrogates.

## Solution Applied

The fix replaces orphaned surrogates with the Unicode Replacement Character (U+FFFD, displayed as `�`):

```javascript
// Before: "Hello \ud83e World"
// After:  "Hello � World"
```

This maintains text readability while ensuring valid JSON.
