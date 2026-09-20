// Adversarial check of setTomlTableBoolean from src/codex-capability-preflight.lib.mjs.
// Every produced document is parsed with python tomllib, so a duplicate key or a
// mangled value is caught by a real TOML parser rather than by a regexp that
// shares the editor's assumptions.
import { writeFile, mkdtemp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { setTomlTableBoolean } from '../../src/codex-capability-preflight.lib.mjs';

const tmp = await mkdtemp(path.join(os.tmpdir(), 'toml-cases-'));
let index = 0;
const parse = async text => {
  const file = path.join(tmp, `case-${index++}.toml`);
  await writeFile(file, text);
  try {
    const out = execFileSync('python3', ['-c', 'import sys,tomllib,json;print(json.dumps(tomllib.load(open(sys.argv[1],"rb"))))', file], { encoding: 'utf8' });
    return { ok: true, value: JSON.parse(out) };
  } catch (error) {
    return {
      ok: false,
      error: String(error.stderr || error.message)
        .trim()
        .split('\n')
        .pop(),
    };
  }
};

const cases = [
  ['empty config', ''],
  ['no features table', 'model = "gpt-5"\n\n[plugins."superpowers@openai-curated"]\nenabled = true\n'],
  ['existing features with other keys', '[features]\nweb_search = true\nremote_plugin = true\n'],
  ['remote_plugin true with trailing comment', '[features]\nremote_plugin = true # operator note\n'],
  ['remote_plugin already false', '[features]\nremote_plugin = false\n'],
  ['features header with trailing comment', '[features] # runtime toggles\nremote_plugin = true\n'],
  ['features header with tight comment', '[features]# runtime toggles\nremote_plugin = true\n'],
  ['features sub-table follows', '[features]\nweb_search = true\n\n[features.experimental]\nfoo = true\n'],
  ['remote_plugin in a different table first', '[foo]\nremote_plugin = true\n\n[features]\nweb_search = true\n'],
  ['remote_plugin only in a different table', '[foo]\nremote_plugin = true\n'],
  ['dotted key form', 'features.remote_plugin = true\nmodel = "gpt-5"\n'],
  ['inline table form', 'features = { remote_plugin = true }\n'],
  ['CRLF config', '[features]\r\nremote_plugin = true\r\n'],
  ['features after plugin blocks', '[plugins."superpowers@openai-curated"]\nenabled = true\n\n[features]\nweb_search = true\n'],
  ['features before plugin blocks, comment attached to next table', '[features]\nweb_search = true\n\n# plugin registry\n[plugins."superpowers@openai-curated"]\nenabled = true\n'],
  ['array-of-tables after features', '[features]\nweb_search = true\n\n[[servers]]\nname = "a"\n'],
  ['remote_plugin non-boolean value', '[features]\nremote_plugin = 1\n'],
  ['indented key inside features', '[features]\n  remote_plugin = true\n'],
  ['multiline array inside features', '[features]\nlist = [\n  "a",\n  "b",\n]\nremote_plugin = true\n'],
  ['dotted subtable key inside features', '[features]\nexperimental.remote_plugin = true\nremote_plugin = true\n'],
  ['dotted key without other root keys', 'features.remote_plugin = true\n'],
  ['dotted key with spaces', 'features . remote_plugin = true\n'],
  ['dotted key with quoted segments', '"features"."remote_plugin" = true\n'],
  ['dotted key after a table header is not root scope', '[other]\nfeatures.remote_plugin = true\n'],
  ['inline table with several keys', 'features = { web_search = true, remote_plugin = true }\n'],
  ['inline table without the key', 'features = { web_search = true }\n'],
  ['empty inline table', 'features = {}\n'],
  ['multiline string containing a table header', 'notice = """\n[features]\nremote_plugin = true\n"""\n'],
  ['multiline string inside features', '[features]\nnotice = """\n[other]\n"""\nweb_search = true\n'],
  ['quoted key inside features', '[features]\n"remote_plugin" = true\n'],
  ['idempotency: run twice', null],
];

let failures = 0;
for (const [name, input] of cases) {
  if (input === null) continue;
  const output = setTomlTableBoolean({ config: input, table: 'features', key: 'remote_plugin', value: false });
  const parsed = await parse(output);
  const value = parsed.ok ? parsed.value?.features?.remote_plugin : undefined;
  const correct = parsed.ok && value === false;
  if (!correct) failures++;
  console.log(`\n=== ${name} :: ${correct ? 'OK' : 'WRONG'} ===`);
  console.log('--- input ---\n' + JSON.stringify(input));
  console.log('--- output ---\n' + JSON.stringify(output));
  if (!parsed.ok) console.log('--- toml parse error: ' + parsed.error);
  else console.log('--- features.remote_plugin = ' + JSON.stringify(value));
}

// idempotency
const once = setTomlTableBoolean({ config: '[features]\nweb_search = true\n', table: 'features', key: 'remote_plugin', value: false });
const twice = setTomlTableBoolean({ config: once, table: 'features', key: 'remote_plugin', value: false });
console.log(`\n=== idempotency :: ${once === twice ? 'OK' : 'WRONG'} ===`);
console.log(JSON.stringify(once), JSON.stringify(twice));
if (once !== twice) failures++;

console.log(`\n${failures} failing case(s)`);
